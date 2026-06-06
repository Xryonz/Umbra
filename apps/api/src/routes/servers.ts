import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { servers, serverMembers, channels, channelRolePerms, users, roles, memberRoles, serverBans, auditLogs, messages, friendships, notifications } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { CreateServerSchema, CreateChannelSchema } from '@astra/types'
import { PERMS, getMemberPerms, filterVisibleChannels } from '../lib/permissions'
import { AUDIT, audit } from '../lib/audit'
import { createId } from '../db/cuid'

export const serversRouter = Router()

/**
 * Helper: monta a lista de servidores (com channels[] e _count.members)
 * pra um usuário específico. Prisma fazia em 1 query via include — em
 * Drizzle quebramos em 3 queries paralelas e juntamos em JS (clareza > magia).
 */
async function listServersForUser(userId: string) {
  // Servidores onde o user é membro
  const myMemberships = await db.select({ serverId: serverMembers.serverId })
    .from(serverMembers)
    .where(eq(serverMembers.userId, userId))

  const serverIds = myMemberships.map((m) => m.serverId)
  if (serverIds.length === 0) return []

  const [srvRows, chRows, countRows] = await Promise.all([
    db.select().from(servers).where(inArray(servers.id, serverIds)).orderBy(asc(servers.createdAt)),
    db.select().from(channels).where(inArray(channels.serverId, serverIds)).orderBy(asc(channels.createdAt)),
    db.select({ serverId: serverMembers.serverId, count: sql<number>`count(*)::int` })
      .from(serverMembers)
      .where(inArray(serverMembers.serverId, serverIds))
      .groupBy(serverMembers.serverId),
  ])

  // lastMessageAt por canal — pra unread indicator no sidebar comparar
  // com lastReadAt do ChannelRead. 1 query agrupada (max createdAt).
  const channelIds = chRows.map((c) => c.id)
  let lastByChannel = new Map<string, Date>()
  if (channelIds.length > 0) {
    const lastRows = await db.select({
      channelId: messages.channelId,
      lastAt:    sql<Date>`MAX(${messages.createdAt})`.as('lastAt'),
    })
      .from(messages)
      .where(inArray(messages.channelId, channelIds))
      .groupBy(messages.channelId)
    lastByChannel = new Map(lastRows.map((r) => [r.channelId, r.lastAt]))
  }

  // Filtra canais por visibilidade (privados só pra quem tem role)
  const visible = await filterVisibleChannels(userId, channelIds)
  const channelsByServer = new Map<string, Array<typeof chRows[number] & { lastMessageAt: Date | null }>>()
  for (const c of chRows) {
    if (!visible.has(c.id)) continue
    const enriched = { ...c, lastMessageAt: lastByChannel.get(c.id) ?? null }
    const arr = channelsByServer.get(c.serverId) ?? []
    arr.push(enriched)
    channelsByServer.set(c.serverId, arr)
  }
  const countByServer = new Map(countRows.map((r) => [r.serverId, r.count]))

  return srvRows.map((s) => ({
    ...s,
    channels: channelsByServer.get(s.id) ?? [],
    _count:   { members: countByServer.get(s.id) ?? 0 },
  }))
}

async function serverWithChannelsAndCount(serverId: string) {
  const [srv] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
  if (!srv) return null
  const [chRows, [countRow]] = await Promise.all([
    db.select().from(channels).where(eq(channels.serverId, serverId)).orderBy(asc(channels.createdAt)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(serverMembers)
      .where(eq(serverMembers.serverId, serverId)),
  ])
  return { ...srv, channels: chRows, _count: { members: countRow?.count ?? 0 } }
}

// GET /api/servers
serversRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const list = await listServersForUser(req.userId!)
    res.json({ data: list })
  })
)

// POST /api/servers
serversRouter.post(
  '/',
  requireAuth,
  validate(CreateServerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, iconUrl, isGroup = false } = req.body

    const server = await db.transaction(async (tx) => {
      const [s] = await tx.insert(servers).values({
        name, iconUrl, isGroup, ownerId: req.userId!,
      }).returning()
      await tx.insert(serverMembers).values({ userId: req.userId!, serverId: s.id, role: 'OWNER' })
      await tx.insert(channels).values({ name: 'geral', type: 'TEXT', serverId: s.id })
      return s
    })

    const full = await serverWithChannelsAndCount(server.id)
    res.status(201).json({ data: full })
  })
)

// ── PATCH /api/servers/:serverId — rename / change icon ───────
const ALLOWED_ICON_HOSTS = [
  'i.imgur.com','media.giphy.com','cdn.discordapp.com','media.tenor.com',
  'i.postimg.cc','images.unsplash.com','lh3.googleusercontent.com',
  'pbs.twimg.com','media.discordapp.net','cdn.jsdelivr.net','raw.githubusercontent.com',
]
function isAllowedIcon(url: string | null | undefined): boolean {
  if (!url) return true
  if (url.startsWith('data:image/')) return true
  try { const { hostname } = new URL(url); return ALLOWED_ICON_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)) }
  catch { return false }
}
function isIconTooBig(url: string | null | undefined): boolean {
  if (!url || !url.startsWith('data:')) return false
  return url.length * 0.75 > 5 * 1024 * 1024
}

const UpdateServerSchema = z.object({
  name:    z.string().min(1).max(100).optional(),
  iconUrl: z.string().optional().nullable(),
  messageRetentionDays: z.number().int().min(0).max(365).optional().nullable(),
})

serversRouter.patch(
  '/:serverId',
  requireAuth,
  validate(UpdateServerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params
    const { name, iconUrl, messageRetentionDays } = req.body as {
      name?: string; iconUrl?: string | null; messageRetentionDays?: number | null
    }

    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.memberId) return res.status(403).json({ error: 'Você não é membro' })
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Sem permissão pra editar o servidor' })
    }

    if (iconUrl && !isAllowedIcon(iconUrl)) return res.status(422).json({ error: 'URL de ícone não permitida' })
    if (isIconTooBig(iconUrl)) return res.status(413).json({ error: 'Ícone muito grande (max 5MB)' })

    const patch: Record<string, unknown> = {}
    if (name    !== undefined) patch.name    = name
    if (iconUrl !== undefined) patch.iconUrl = iconUrl
    if (messageRetentionDays !== undefined)
      patch.messageRetentionDays = messageRetentionDays === 0 ? null : messageRetentionDays
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nada para atualizar' })

    await db.update(servers).set(patch).where(eq(servers.id, serverId))
    void audit({
      serverId, actorId: req.userId!, action: AUDIT.SERVER_UPDATE,
      targetId: serverId, metadata: { fields: Object.keys(patch) },
    })
    const updated = await serverWithChannelsAndCount(serverId)
    res.json({ data: updated })
  })
)

// ── POST /api/servers/:serverId/regenerate-invite ─────────────
// Rotaciona o inviteCode: links antigos param de funcionar imediatamente.
// Usado quando o convite vazou ou simplesmente o owner quer trocar.
serversRouter.post(
  '/:serverId/regenerate-invite',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params

    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.memberId) return res.status(403).json({ error: 'Você não é membro' })
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_SERVER)) {
      return res.status(403).json({ error: 'Sem permissão pra regenerar o convite' })
    }

    const newCode = createId()
    await db.update(servers).set({ inviteCode: newCode }).where(eq(servers.id, serverId))
    void audit({
      serverId, actorId: req.userId!, action: AUDIT.SERVER_UPDATE,
      targetId: serverId, metadata: { fields: ['inviteCode'] },
    })

    res.json({ data: { inviteCode: newCode } })
  })
)

// ── POST /api/servers/:serverId/add-friend ────────────────────
// Adiciona um amigo (friendship accepted) direto ao servidor — sem precisar
// passar pelo invite link. Notifica o amigo via Notification + invalida queries.
// Requer apenas que o caller seja membro (qualquer um pode convidar amigos).
const AddFriendSchema = z.object({
  friendUserId: z.string().min(1, 'friendUserId obrigatório'),
})

serversRouter.post(
  '/:serverId/add-friend',
  requireAuth,
  validate(AddFriendSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params
    const { friendUserId } = req.body as { friendUserId: string }
    const callerId = req.userId!

    // 1) Caller é membro do server?
    const [callerMember] = await db.select({ id: serverMembers.id })
      .from(serverMembers)
      .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, callerId)))
      .limit(1)
    if (!callerMember) return res.status(403).json({ error: 'Você não é membro deste servidor' })

    // 2) São amigos aceitos? (par sempre normalizado userA < userB no schema)
    const [a, b] = callerId < friendUserId ? [callerId, friendUserId] : [friendUserId, callerId]
    const [friendship] = await db.select({ id: friendships.id, status: friendships.status })
      .from(friendships)
      .where(and(eq(friendships.userAId, a), eq(friendships.userBId, b)))
      .limit(1)
    if (!friendship || friendship.status !== 'accepted') {
      return res.status(403).json({ error: 'Você só pode adicionar amigos aceitos' })
    }

    // 3) Friend está banido do server?
    const [banned] = await db.select({ id: serverBans.id }).from(serverBans)
      .where(and(eq(serverBans.serverId, serverId), eq(serverBans.userId, friendUserId)))
      .limit(1)
    if (banned) return res.status(403).json({ error: 'Esse amigo está banido do servidor' })

    // 4) Já é membro?
    const [already] = await db.select({ id: serverMembers.id }).from(serverMembers)
      .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, friendUserId)))
      .limit(1)
    if (already) return res.status(409).json({ error: 'Esse amigo já é membro' })

    // 5) Server existe?
    const [server] = await db.select({ id: servers.id, name: servers.name, isGroup: servers.isGroup })
      .from(servers).where(eq(servers.id, serverId)).limit(1)
    if (!server) return res.status(404).json({ error: 'Servidor não encontrado' })

    // 6) Insert + notification
    await db.insert(serverMembers).values({ userId: friendUserId, serverId })
    await db.insert(notifications).values({
      userId: friendUserId,
      type:   'server_invite',
      payload: JSON.stringify({
        serverId,
        serverName: server.name,
        isGroup:    server.isGroup,
        addedBy:    callerId,
      }),
    })
    void audit({
      serverId, actorId: callerId, action: AUDIT.SERVER_UPDATE,
      targetId: friendUserId, metadata: { kind: 'add_friend' },
    })

    res.json({ data: { ok: true, friendUserId } })
  })
)

// ── PATCH /api/servers/:serverId/members/:memberId — role change (OWNER only)
const RoleSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) })

serversRouter.patch(
  '/:serverId/members/:memberId',
  requireAuth,
  validate(RoleSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId, memberId } = req.params
    const { role } = req.body as { role: 'ADMIN' | 'MEMBER' }

    const [server] = await db.select({ ownerId: servers.ownerId }).from(servers)
      .where(eq(servers.id, serverId)).limit(1)
    if (!server) return res.status(404).json({ error: 'Servidor não encontrado' })
    if (server.ownerId !== req.userId) return res.status(403).json({ error: 'Apenas o dono pode mudar cargos' })

    const [target] = await db.select({ id: serverMembers.id, role: serverMembers.role, userId: serverMembers.userId })
      .from(serverMembers)
      .where(and(eq(serverMembers.id, memberId), eq(serverMembers.serverId, serverId)))
      .limit(1)
    if (!target) return res.status(404).json({ error: 'Membro não encontrado' })
    if (target.role === 'OWNER') return res.status(400).json({ error: 'Não é possível alterar o cargo do dono' })

    await db.update(serverMembers).set({ role }).where(eq(serverMembers.id, memberId))
    res.json({ data: { id: memberId, role } })
  })
)

// ── DELETE /api/servers/:serverId/members/:memberId — kick (OWNER/ADMIN)
serversRouter.delete(
  '/:serverId/members/:memberId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId, memberId } = req.params

    const requester = await getMemberPerms(req.userId!, serverId)
    if (!requester.memberId) return res.status(403).json({ error: 'Você não é membro' })
    if (!requester.isOwner && !requester.permissions.has(PERMS.KICK_MEMBERS))
      return res.status(403).json({ error: 'Sem permissão para remover membros' })

    const [target] = await db.select({ id: serverMembers.id, role: serverMembers.role, userId: serverMembers.userId })
      .from(serverMembers)
      .where(and(eq(serverMembers.id, memberId), eq(serverMembers.serverId, serverId)))
      .limit(1)
    if (!target) return res.status(404).json({ error: 'Membro não encontrado' })
    if (target.role === 'OWNER') return res.status(400).json({ error: 'Não é possível remover o dono' })
    if (target.userId === req.userId) return res.status(400).json({ error: 'Use sair do servidor para se remover' })
    // Sem-owner não pode kickar quem também tem KICK_MEMBERS (igual hierarquia Discord)
    if (!requester.isOwner) {
      const targetPerms = await getMemberPerms(target.userId, serverId)
      if (targetPerms.isOwner || targetPerms.permissions.has(PERMS.KICK_MEMBERS))
        return res.status(403).json({ error: 'Não pode remover alguém com mesma permissão' })
    }

    await db.delete(serverMembers).where(eq(serverMembers.id, memberId))
    void audit({
      serverId, actorId: req.userId!, action: AUDIT.MEMBER_KICK,
      targetId: target.userId,
    })
    res.json({ message: 'Membro removido' })
  })
)

// ── DELETE /api/servers/:serverId — delete (owner only) ───────
serversRouter.delete(
  '/:serverId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params

    const [server] = await db.select({ ownerId: servers.ownerId }).from(servers)
      .where(eq(servers.id, serverId)).limit(1)
    if (!server) return res.status(404).json({ error: 'Servidor não encontrado' })

    if (server.ownerId !== req.userId) {
      return res.status(403).json({ error: 'Apenas o dono pode excluir o servidor' })
    }

    // Cascade no schema → apaga members/channels/messages
    await db.delete(servers).where(eq(servers.id, serverId))
    res.json({ message: 'Servidor excluído com sucesso' })
  })
)

// ── DELETE /api/servers/:serverId/leave ───────────────────────
serversRouter.delete(
  '/:serverId/leave',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params

    const [server] = await db.select({ ownerId: servers.ownerId }).from(servers)
      .where(eq(servers.id, serverId)).limit(1)
    if (!server) return res.status(404).json({ error: 'Servidor não encontrado' })

    if (server.ownerId === req.userId) {
      return res.status(400).json({
        error: 'O dono não pode sair do servidor. Exclua-o ou transfira a propriedade.',
      })
    }

    const [membership] = await db.select({ id: serverMembers.id }).from(serverMembers)
      .where(and(eq(serverMembers.userId, req.userId!), eq(serverMembers.serverId, serverId)))
      .limit(1)
    if (!membership) return res.status(404).json({ error: 'Você não é membro deste servidor' })

    await db.delete(serverMembers).where(eq(serverMembers.id, membership.id))
    res.json({ message: 'Você saiu do servidor' })
  })
)

// ── POST /api/servers/join/:inviteCode ────────────────────────
serversRouter.post(
  '/join/:inviteCode',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const [server] = await db.select().from(servers)
      .where(eq(servers.inviteCode, req.params.inviteCode)).limit(1)
    if (!server) return res.status(404).json({ error: 'Convite inválido' })

    const [banned] = await db.select({ id: serverBans.id }).from(serverBans)
      .where(and(eq(serverBans.userId, req.userId!), eq(serverBans.serverId, server.id)))
      .limit(1)
    if (banned) return res.status(403).json({ error: 'Você está banido deste servidor' })

    const [already] = await db.select({ id: serverMembers.id }).from(serverMembers)
      .where(and(eq(serverMembers.userId, req.userId!), eq(serverMembers.serverId, server.id)))
      .limit(1)
    if (already) return res.status(409).json({ error: 'Você já é membro deste servidor' })

    await db.insert(serverMembers).values({ userId: req.userId!, serverId: server.id })
    res.json({ data: server })
  })
)

// ── GET /api/servers/:serverId/members ────────────────────────
serversRouter.get(
  '/:serverId/members',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params
    const [me] = await db.select({ id: serverMembers.id }).from(serverMembers)
      .where(and(eq(serverMembers.userId, req.userId!), eq(serverMembers.serverId, serverId)))
      .limit(1)
    if (!me) return res.status(403).json({ error: 'Acesso negado' })

    const members = await db.select({
      id:        serverMembers.id,
      userId:    serverMembers.userId,
      serverId:  serverMembers.serverId,
      role:      serverMembers.role,
      nameColor: serverMembers.nameColor,
      joinedAt:  serverMembers.joinedAt,
      user: {
        id:          users.id,
        username:    users.username,
        displayName: users.displayName,
        avatarUrl:   users.avatarUrl,
        bio:         users.bio,
      },
    })
      .from(serverMembers)
      .innerJoin(users, eq(users.id, serverMembers.userId))
      .where(eq(serverMembers.serverId, serverId))
      .orderBy(asc(serverMembers.joinedAt))

    // Anexa roles[] e topColor pra cada member em 1 query
    const memberIds = members.map((m) => m.id)
    let rolesByMember = new Map<string, Array<{ id: string; name: string; color: string|null; position: number; hoist: boolean }>>()
    if (memberIds.length > 0) {
      const assignments = await db.select({
        memberId: memberRoles.memberId,
        roleId:   roles.id,
        name:     roles.name,
        color:    roles.color,
        position: roles.position,
        hoist:    roles.hoist,
      })
        .from(memberRoles)
        .innerJoin(roles, eq(roles.id, memberRoles.roleId))
        .where(eq(roles.serverId, serverId))

      for (const a of assignments) {
        if (!rolesByMember.has(a.memberId)) rolesByMember.set(a.memberId, [])
        rolesByMember.get(a.memberId)!.push({
          id: a.roleId, name: a.name, color: a.color, position: a.position, hoist: a.hoist,
        })
      }
      // Sort por position desc dentro de cada member
      for (const arr of rolesByMember.values()) arr.sort((a, b) => b.position - a.position)
    }

    const enriched = members.map((m) => {
      const rs = rolesByMember.get(m.id) ?? []
      const topColored = rs.find((r) => r.color)
      return { ...m, roles: rs, topColor: topColored?.color ?? null }
    })

    res.json({ data: enriched })
  })
)

// ── POST /api/servers/:serverId/invite/:username ──────────────
serversRouter.post(
  '/:serverId/invite/:username',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId, username } = req.params

    const [server] = await db.select({ id: servers.id }).from(servers)
      .where(eq(servers.id, serverId)).limit(1)
    if (!server) return res.status(404).json({ error: 'Servidor não encontrado' })

    const requester = await getMemberPerms(req.userId!, serverId)
    if (!requester.memberId) return res.status(403).json({ error: 'Você não é membro' })
    if (!requester.isOwner && !requester.permissions.has(PERMS.MANAGE_SERVER))
      return res.status(403).json({ error: 'Sem permissão pra adicionar membros' })

    const [target] = await db.select({ id: users.id, displayName: users.displayName }).from(users)
      .where(eq(users.username, username)).limit(1)
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' })

    const [tBan] = await db.select({ id: serverBans.id }).from(serverBans)
      .where(and(eq(serverBans.userId, target.id), eq(serverBans.serverId, serverId)))
      .limit(1)
    if (tBan) return res.status(403).json({ error: 'Usuário está banido deste servidor' })

    const [already] = await db.select({ id: serverMembers.id }).from(serverMembers)
      .where(and(eq(serverMembers.userId, target.id), eq(serverMembers.serverId, serverId)))
      .limit(1)
    if (already) return res.status(409).json({ error: 'Usuário já é membro' })

    await db.insert(serverMembers).values({ userId: target.id, serverId, role: 'MEMBER' })
    res.json({ message: `${target.displayName} adicionado com sucesso` })
  })
)

// ── PATCH /api/servers/:serverId/my-color ─────────────────────
const NameColorSchema = z.object({
  nameColor: z.string().regex(/^(#[0-9a-fA-F]{6}|gradient:\d+:#[0-9a-fA-F]{6}:#[0-9a-fA-F]{6})$/, 'Formato inválido').nullable(),
})

serversRouter.patch(
  '/:serverId/my-color',
  requireAuth,
  validate(NameColorSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params

    const [member] = await db.select({ id: serverMembers.id }).from(serverMembers)
      .where(and(eq(serverMembers.userId, req.userId!), eq(serverMembers.serverId, serverId)))
      .limit(1)
    if (!member) return res.status(403).json({ error: 'Você não é membro deste servidor' })

    const [updated] = await db.update(serverMembers)
      .set({ nameColor: req.body.nameColor })
      .where(eq(serverMembers.id, member.id))
      .returning({ nameColor: serverMembers.nameColor })

    res.json({ data: { nameColor: updated.nameColor } })
  })
)

// ── GET /api/servers/:serverId/audit — trilha de ações administrativas
serversRouter.get(
  '/:serverId/audit',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params
    const limit = Math.min(Number(req.query.limit) || 50, 200)

    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_SERVER))
      return res.status(403).json({ error: 'Sem permissão pra ver audit log' })

    const rows = await db.select({
      id:        auditLogs.id,
      action:    auditLogs.action,
      actorId:   auditLogs.actorId,
      targetId:  auditLogs.targetId,
      metadata:  auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actor: {
        id:          users.id,
        username:    users.username,
        displayName: users.displayName,
        avatarUrl:   users.avatarUrl,
      },
    })
      .from(auditLogs)
      .innerJoin(users, eq(users.id, auditLogs.actorId))
      .where(eq(auditLogs.serverId, serverId))
      .orderBy(sql`${auditLogs.createdAt} DESC`)
      .limit(limit)

    const shaped = rows.map((r) => ({
      ...r,
      metadata: safeParseObj(r.metadata),
    }))
    res.json({ data: shaped })
  })
)

function safeParseObj(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {}
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {} } catch { return {} }
}

// ── GET /api/servers/:serverId/me — perms do user atual neste server
serversRouter.get(
  '/:serverId/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params
    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.memberId && !m.isOwner) return res.status(403).json({ error: 'Você não é membro' })
    res.json({ data: {
      isOwner:     m.isOwner,
      isAdmin:     m.isAdmin,
      permissions: Array.from(m.permissions),
    } })
  })
)

// ─── CHANNELS ROUTER ──────────────────────────────────────────
export const channelsRouter = Router()

channelsRouter.post(
  '/:serverId/channels',
  requireAuth,
  validate(CreateChannelSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId } = req.params
    const { name, type } = req.body

    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.memberId) return res.status(403).json({ error: 'Você não é membro' })
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_CHANNELS))
      return res.status(403).json({ error: 'Sem permissão pra criar canais' })

    const [channel] = await db.insert(channels).values({ name, type, serverId }).returning()
    void audit({
      serverId, actorId: req.userId!, action: AUDIT.CHANNEL_CREATE,
      targetId: channel.id, metadata: { name, type },
    })
    res.status(201).json({ data: channel })
  })
)

// ── Visibility: GET/PATCH /api/servers/:serverId/channels/:channelId/visibility
// Body PATCH: { isPrivate: bool, roleIds?: string[] }
// roleIds vazio + isPrivate=true → canal escondido pra todos (exceto owner)
channelsRouter.get(
  '/:serverId/channels/:channelId/visibility',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId, channelId } = req.params
    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_CHANNELS))
      return res.status(403).json({ error: 'Sem permissão' })

    const [ch] = await db.select({ id: channels.id, isPrivate: channels.isPrivate })
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.serverId, serverId)))
      .limit(1)
    if (!ch) return res.status(404).json({ error: 'Canal não encontrado' })

    const perms = await db.select({ roleId: channelRolePerms.roleId })
      .from(channelRolePerms).where(eq(channelRolePerms.channelId, channelId))
    res.json({ data: { isPrivate: ch.isPrivate, roleIds: perms.map((p) => p.roleId) } })
  })
)

const VisibilitySchema = z.object({
  isPrivate: z.boolean(),
  roleIds:   z.array(z.string()).max(50).optional(),
})

channelsRouter.patch(
  '/:serverId/channels/:channelId/visibility',
  requireAuth,
  validate(VisibilitySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId, channelId } = req.params
    const { isPrivate, roleIds = [] } = req.body as z.infer<typeof VisibilitySchema>

    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_CHANNELS))
      return res.status(403).json({ error: 'Sem permissão' })

    // Confere canal pertence ao server
    const [ch] = await db.select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.serverId, serverId)))
      .limit(1)
    if (!ch) return res.status(404).json({ error: 'Canal não encontrado' })

    // Filtra roleIds pra garantir que pertencem a esse server
    let validRoleIds: string[] = []
    if (roleIds.length > 0) {
      const validRoles = await db.select({ id: roles.id }).from(roles)
        .where(and(eq(roles.serverId, serverId), inArray(roles.id, roleIds)))
      validRoleIds = validRoles.map((r) => r.id)
    }

    await db.transaction(async (tx) => {
      await tx.update(channels).set({ isPrivate }).where(eq(channels.id, channelId))
      await tx.delete(channelRolePerms).where(eq(channelRolePerms.channelId, channelId))
      if (validRoleIds.length > 0) {
        await tx.insert(channelRolePerms).values(
          validRoleIds.map((roleId) => ({ channelId, roleId })),
        )
      }
    })

    void audit({
      serverId, actorId: req.userId!, action: AUDIT.CHANNEL_UPDATE,
      targetId: channelId, metadata: { isPrivate, roleIds: validRoleIds },
    })
    res.json({ data: { isPrivate, roleIds: validRoleIds } })
  })
)

// PATCH /api/servers/:serverId/channels/:channelId — rename
const RenameChannelSchema = z.object({ name: z.string().min(1).max(50) })
channelsRouter.patch(
  '/:serverId/channels/:channelId',
  requireAuth,
  validate(RenameChannelSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId, channelId } = req.params
    const { name } = req.body as z.infer<typeof RenameChannelSchema>

    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_CHANNELS))
      return res.status(403).json({ error: 'Sem permissão' })

    const r = await db.update(channels)
      .set({ name })
      .where(and(eq(channels.id, channelId), eq(channels.serverId, serverId)))
      .returning({ id: channels.id, name: channels.name })
    if (r.length === 0) return res.status(404).json({ error: 'Canal não encontrado' })

    void audit({
      serverId, actorId: req.userId!, action: AUDIT.CHANNEL_UPDATE,
      targetId: channelId, metadata: { name },
    })
    res.json({ data: r[0] })
  })
)

// DELETE /api/servers/:serverId/channels/:channelId
channelsRouter.delete(
  '/:serverId/channels/:channelId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { serverId, channelId } = req.params

    const m = await getMemberPerms(req.userId!, serverId)
    if (!m.memberId && !m.isOwner) return res.status(403).json({ error: 'Você não é membro' })
    if (!m.isOwner && !m.permissions.has(PERMS.MANAGE_CHANNELS))
      return res.status(403).json({ error: 'Sem permissão pra excluir canais' })

    // Garante que o canal pertence a este servidor (defesa em profundidade)
    const r = await db.delete(channels)
      .where(and(eq(channels.id, channelId), eq(channels.serverId, serverId)))
      .returning({ id: channels.id, name: channels.name })
    if (r.length === 0) return res.status(404).json({ error: 'Canal não encontrado' })

    void audit({
      serverId, actorId: req.userId!, action: AUDIT.CHANNEL_DELETE,
      targetId: channelId, metadata: { name: r[0].name },
    })
    res.json({ message: 'Canal excluído' })
  })
)
