import { Router, Request, Response } from 'express'
import { Server as SocketServer } from 'socket.io'
import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm'
import { db } from '../db'
import { alias } from 'drizzle-orm/pg-core'
import {
  channels, servers, serverMembers, messages, users, messageReactions, messageEdits,
} from '../db/schema'
import { parseMentions } from '../lib/mentions'
import { selectAuthorById, selectMemberColor } from '../db/prepared'
import { getNotifModesFor } from './channelNotifPrefs'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { messageLimiter } from '../middleware/rateLimiter'
import { asyncHandler } from '../lib/asyncHandler'
import { SendMessageSchema, EditMessageSchema, MessageCursorSchema } from '@astra/types'
import { getMuteExpiry, isUserMuted, muteUser, trackMessage } from '../lib/spamDetector'
import { getBotId } from '../lib/bot'
import { notify } from '../lib/notifications'
import { PERMS, getMemberPerms, userCanSeeChannel } from '../lib/permissions'
import { AUDIT, audit } from '../lib/audit'
import { safeParsePoll } from './polls'
import { messagesSentTotal } from '../lib/metrics'

interface CursorPayload {
  createdAt: Date
  id: string
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url')
}

function parseCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: string
      id?: string
    }
    if (!raw.createdAt || !raw.id) return null
    const createdAt = new Date(raw.createdAt)
    if (Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id: raw.id }
  } catch {
    return null
  }
}


function safeParseAttachments(raw: unknown): any[] {
  if (!raw || typeof raw !== 'string') return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

/**
 * Anexa o resumo de reactions a uma lista de mensagens em 1 query.
 */
async function attachReactions<T extends { id: string }>(messageList: T[]) {
  if (messageList.length === 0) return messageList
  const ids = messageList.map((m) => m.id)
  const allReactions = await db.select({
    emoji:     messageReactions.emoji,
    userId:    messageReactions.userId,
    messageId: messageReactions.messageId,
  })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, ids))
    .orderBy(messageReactions.createdAt)

  const byMessage = new Map<string, { emoji: string; userId: string }[]>()
  for (const r of allReactions) {
    const arr = byMessage.get(r.messageId) ?? []
    arr.push({ emoji: r.emoji, userId: r.userId })
    byMessage.set(r.messageId, arr)
  }

  return messageList.map((msg) => {
    const raw = byMessage.get(msg.id) ?? []
    const emojiMap = new Map<string, string[]>()
    for (const r of raw) {
      const arr = emojiMap.get(r.emoji) ?? []
      arr.push(r.userId)
      emojiMap.set(r.emoji, arr)
    }
    return {
      ...msg,
      reactions: Array.from(emojiMap.entries()).map(([emoji, ids]) => ({
        emoji, count: ids.length, users: ids,
      })),
    }
  })
}

export function createMessagesRouter(io: SocketServer) {
  const router = Router({ mergeParams: true })

  /**
   * Verifica acesso ao canal (respeita visibilidade por role) e devolve canal+server.
   */
  async function assertChannelAccess(userId: string, channelId: string) {
    const [row] = await db.select({
      channelId:  channels.id,
      channelName: channels.name,
      serverId:   channels.serverId,
      serverName: servers.name,
      membershipId: serverMembers.id,
    })
      .from(channels)
      .innerJoin(servers, eq(servers.id, channels.serverId))
      .leftJoin(serverMembers, and(
        eq(serverMembers.serverId, channels.serverId),
        eq(serverMembers.userId,   userId),
      ))
      .where(eq(channels.id, channelId))
      .limit(1)

    if (!row || !row.membershipId) return null
    // Visibilidade por role: re-usa helper (cobre owner + canal público + privado match)
    const canSee = await userCanSeeChannel(userId, channelId)
    if (!canSee) return null
    return row
  }

  // GET /api/channels/:channelId/messages
  router.get(
    '/',
    requireAuth,
    validate(MessageCursorSchema, 'query'),
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId } = req.params
      const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number }
      const take = Number(limit) || 30
      const parsedCursor = parseCursor(cursor)

      const channel = await assertChannelAccess(req.userId!, channelId)
      if (!channel) return res.status(403).json({ error: 'Acesso negado' })

      // Filtro efêmeras expiradas: expiresAt null OU > now
      const now = new Date()
      const conditions = [
        eq(messages.channelId, channelId),
        isNull(messages.deletedAt),
        isNull(messages.threadId),
        or(isNull(messages.expiresAt), gt(messages.expiresAt, now))!,
      ]
      if (parsedCursor) {
        conditions.push(or(
          lt(messages.createdAt, parsedCursor.createdAt),
          and(eq(messages.createdAt, parsedCursor.createdAt), lt(messages.id, parsedCursor.id))
        )!)
      }

      const parent       = alias(messages, 'parent')
      const parentAuthor = alias(users,    'parentAuthor')

      const rows = await db.select({
        id:          messages.id,
        content:     messages.content,
        authorId:    messages.authorId,
        channelId:   messages.channelId,
        authorColor: messages.authorColor,
        attachments: messages.attachments,
        mentions:    messages.mentions,
        edited:      messages.edited,
        pinned:      messages.pinned,
        poll:        messages.poll,
        replyToId:   messages.replyToId,
        deletedAt:   messages.deletedAt,
        createdAt:   messages.createdAt,
        updatedAt:   messages.updatedAt,
        author: {
          id:          users.id,
          username:    users.username,
          displayName: users.displayName,
          avatarUrl:   users.avatarUrl,
        },
        parentId:           parent.id,
        parentContent:      parent.content,
        parentAuthorName:   parentAuthor.displayName,
        parentAuthorAvatar: parentAuthor.avatarUrl,
      })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.authorId))
        .leftJoin(parent,       eq(parent.id, messages.replyToId))
        .leftJoin(parentAuthor, eq(parentAuthor.id, parent.authorId))
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(take + 1)

      const hasMore   = rows.length > take
      const items     = hasMore ? rows.slice(0, take) : rows
      const lastItem  = items[items.length - 1]
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null

      // Transforma rows: extrai replyTo nested + parse attachments + parse poll
      const shaped = items.map((r: any) => ({
        ...r,
        attachments: safeParseAttachments(r.attachments),
        poll:        safeParsePoll(r.poll),
        replyTo: r.parentId ? {
          id:           r.parentId,
          content:      (r.parentContent ?? '').slice(0, 160),
          authorName:   r.parentAuthorName ?? 'Usuário',
          authorAvatar: r.parentAuthorAvatar ?? null,
        } : null,
        parentId: undefined, parentContent: undefined, parentAuthorName: undefined, parentAuthorAvatar: undefined,
      }))

      const withReactions = await attachReactions(shaped.reverse())
      res.json({ data: { items: withReactions, nextCursor, hasMore } })
    })
  )

  // POST /api/channels/:channelId/messages
  router.post(
    '/',
    requireAuth,
    messageLimiter,
    validate(SendMessageSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId } = req.params
      const { content, replyToId, attachments, clientNonce, ttlSeconds } = req.body as {
        content: string; replyToId?: string; attachments?: any[]; clientNonce?: string; ttlSeconds?: number
      }

      const channel = await assertChannelAccess(req.userId!, channelId)
      if (!channel) return res.status(403).json({ error: 'Acesso negado' })

      // Valida replyToId — tem que ser msg do MESMO canal e não deletada
      let validReplyToId: string | null = null
      let replyParent: { id: string; content: string; authorId: string; authorName: string; authorAvatar: string | null } | null = null
      if (replyToId) {
        const [parent] = await db.select({
          id:           messages.id,
          content:      messages.content,
          authorId:     messages.authorId,
          authorName:   users.displayName,
          authorAvatar: users.avatarUrl,
        })
          .from(messages)
          .innerJoin(users, eq(users.id, messages.authorId))
          .where(and(eq(messages.id, replyToId), eq(messages.channelId, channelId), isNull(messages.deletedAt)))
          .limit(1)
        if (parent) {
          validReplyToId = parent.id
          replyParent = {
            id:           parent.id,
            content:      (parent.content ?? '').slice(0, 160),
            authorId:     parent.authorId,
            authorName:   parent.authorName,
            authorAvatar: parent.authorAvatar,
          }
        }
      }

      const muted = await isUserMuted(req.userId!, channel.serverId)
      if (muted) {
        const secondsLeft = await getMuteExpiry(req.userId!, channel.serverId)
        return res.status(429).json({
          error: 'Voce esta silenciado temporariamente neste servidor.',
          code: 'MUTED',
          secondsLeft,
        })
      }

      const { spamDetected } = await trackMessage(req.userId!, channelId)
      if (spamDetected) {
        const botId = await getBotId()
        if (botId) {
          await muteUser(req.userId!, channel.serverId, botId)
          const secondsLeft = await getMuteExpiry(req.userId!, channel.serverId)
          const [offender] = await db.select({ username: users.username }).from(users)
            .where(eq(users.id, req.userId!)).limit(1)

          const botMsg = {
            id: `bot-mute-${Date.now()}`,
            content: `**@${offender?.username ?? 'usuario'}** foi silenciado por 5 minutos por spam.`,
            channelId,
            edited: false,
            createdAt: new Date().toISOString(),
            authorColor: null,
            reactions: [],
            mentions: [],
            author: { id: botId, username: 'astra_bot', displayName: 'Astra', avatarUrl: null },
          }
          io.to(`channel:${channelId}`).emit('new_message', botMsg)
          return res.status(429).json({
            error: 'Envio excessivo de mensagens. Voce foi silenciado temporariamente.',
            code: 'SPAM_MUTED',
            secondsLeft,
          })
        }
      }

      const attachmentsJson = JSON.stringify(Array.isArray(attachments) ? attachments.slice(0, 10) : [])
      const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null

      // ── PARALELIZAR queries independentes pré-INSERT ─────────
      // Antes: sequencial (mem→mentions = 2 RTTs). Agora: 1 RTT.
      // SELECTs viram prepared statements (plan cacheado no pg-pool).
      const [membership, mentionedIds, author] = await Promise.all([
        selectMemberColor.execute({ userId: req.userId!, serverId: channel.serverId }).then((rows) => rows[0]),
        parseMentions(content, channel.serverId),
        selectAuthorById.execute({ userId: req.userId! }).then((rows) => rows[0]),
      ])

      const authorColor = membership?.nameColor ?? null
      const mentionsStr = mentionedIds.join(',')

      // INSERT em DSL ad-hoc — prepared statement com nullable placeholders
      // (replyToId/expiresAt) deu instabilidade; mantemos só SELECTs prepared.
      const [inserted] = await db.insert(messages).values({
        content, channelId, authorId: req.userId!, authorColor, mentions: mentionsStr,
        attachments: attachmentsJson,
        replyToId: validReplyToId,
        expiresAt,
      }).returning()

      const msgWithReactions = {
        ...inserted, author, reactions: [], mentions: mentionedIds,
        attachments: safeParseAttachments(inserted.attachments),
        replyTo: replyParent,
      }

      // ── EMIT ASAP ────────────────────────────────────────────
      // Antes desse emit, só INSERT + 1 Promise.all (3 SELECTs em paralelo).
      // Receptores recebem msg em ~50ms ao invés de ~200ms+.
      io.to(`channel:${channelId}`).emit('new_message', { ...msgWithReactions, clientNonce: clientNonce ?? null })
      messagesSentTotal.inc({ kind: 'channel' })

      // ── Resposta REST imediata (autor pode confirmar UI) ─────
      res.status(201).json({ data: msgWithReactions })

      // ── BACKGROUND: trabalho não-crítico após response ───────
      // setImmediate libera o event loop pra Express finalizar a response
      // antes desse trabalho rodar. Errors logados, não afetam o client.
      setImmediate(() => {
        void (async () => {
          try {
            // 1. Notifica sidebar de membros do server (channel_activity).
            //    Lookup per-channel notif pref pra suprimir em 'mute' (e
            //    em 'mentions' se o user não foi mencionado).
            const allMembers = await db.select({ userId: serverMembers.userId }).from(serverMembers)
              .where(eq(serverMembers.serverId, channel.serverId))
            const memberIds = allMembers.map((m) => m.userId).filter((id) => id !== req.userId)
            const notifModes = await getNotifModesFor(channelId, memberIds)
            const mentionedSet = new Set(mentionedIds)
            const now = inserted.createdAt.toISOString()
            for (const userId of memberIds) {
              const mode = notifModes.get(userId) ?? 'all'
              if (mode === 'mute') continue
              if (mode === 'mentions' && !mentionedSet.has(userId)) continue
              io.to(`user:${userId}`).emit('channel_activity', { channelId, lastMessageAt: now })
            }

            // 2. Mentions: legacy event + notify (feed + push).
            //    Suprime se user setou 'mute' explicitamente — 'mentions' aqui
            //    deixa passar (justamente o caso pra menção).
            for (const userId of mentionedIds) {
              if (userId === req.userId) continue
              if (notifModes.get(userId) === 'mute') continue
              io.to(`user:${userId}`).emit('mention', {
                messageId:   inserted.id,
                channelId,
                serverId:    channel.serverId,
                serverName:  channel.serverName,
                channelName: channel.channelName,
                authorName:  author.displayName,
                preview:     content.slice(0, 80),
              })
              void notify({
                io, userId, actorId: req.userId!, type: 'mention',
                payload: {
                  messageId:   inserted.id,
                  channelId,
                  serverId:    channel.serverId,
                  serverName:  channel.serverName,
                  channelName: channel.channelName,
                  authorId:    author.id,
                  authorName:  author.displayName,
                  authorAvatar: author.avatarUrl,
                  preview:     content.slice(0, 140),
                },
                push: {
                  title: `${author.displayName} mencionou você em #${channel.channelName}`,
                  body:  content.slice(0, 140),
                  url:   '/app',
                  tag:   `mention-${channelId}`,
                  icon:  author.avatarUrl ?? undefined,
                  actionable: true,
                  channelId,
                },
              }).catch(() => {})
            }

            // 3. Reply notif
            if (validReplyToId && replyParent && replyParent.authorId !== req.userId) {
              void notify({
                io, userId: replyParent.authorId, actorId: req.userId!, type: 'reply',
                payload: {
                  messageId:   inserted.id,
                  channelId,
                  serverId:    channel.serverId,
                  serverName:  channel.serverName,
                  channelName: channel.channelName,
                  authorId:    author.id,
                  authorName:  author.displayName,
                  authorAvatar: author.avatarUrl,
                  preview:     content.slice(0, 140),
                  replyToContent: replyParent.content?.slice(0, 80) ?? '',
                },
                push: {
                  title: `${author.displayName} respondeu você em #${channel.channelName}`,
                  body:  content.slice(0, 140),
                  url:   '/app',
                  tag:   `reply-${inserted.id}`,
                  icon:  author.avatarUrl ?? undefined,
                  actionable: true,
                  channelId,
                },
              }).catch(() => {})
            }
          } catch (err) {
            // Background work falhou — não afeta o client, mas registra.
            // eslint-disable-next-line no-console
            console.error('[messages POST] background work failed:', err)
          }
        })()
      })
    })
  )

  // PATCH /api/channels/:channelId/messages/:messageId
  router.patch(
    '/:messageId',
    requireAuth,
    validate(EditMessageSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId, messageId } = req.params
      const { content }              = req.body

      const [message] = await db.select().from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId), isNull(messages.deletedAt)))
        .limit(1)
      if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' })
      if (message.authorId !== req.userId) return res.status(403).json({ error: 'Sem permissão' })

      const [channel] = await db.select({ serverId: channels.serverId }).from(channels)
        .where(eq(channels.id, channelId)).limit(1)
      const mentionedIds = channel ? await parseMentions(content, channel.serverId) : []

      // Salva versão anterior em MessageEdit antes de sobrescrever
      // (só se conteúdo mudou de fato, não polui histórico com edits no-op)
      if (message.content !== content) {
        await db.insert(messageEdits).values({
          messageId,
          content: message.content,
        })
      }

      const [updated] = await db.update(messages)
        .set({ content, edited: true, mentions: mentionedIds.join(',') })
        .where(eq(messages.id, messageId))
        .returning()

      io.to(`channel:${channelId}`).emit('message_edited', {
        messageId, content: updated.content, channelId, edited: true,
      })

      res.json({ data: updated })
    })
  )

  // POST /api/channels/:channelId/messages/:messageId/pin
  router.post(
    '/:messageId/pin',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId, messageId } = req.params

      const channel = await assertChannelAccess(req.userId!, channelId)
      if (!channel) return res.status(403).json({ error: 'Acesso negado' })

      // Verifica role: OWNER/ADMIN OU autor da mensagem
      const [msg] = await db.select({ authorId: messages.authorId }).from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId), isNull(messages.deletedAt)))
        .limit(1)
      if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' })

      const m = await getMemberPerms(req.userId!, channel.serverId)
      const canPin = msg.authorId === req.userId || m.isOwner || m.permissions.has(PERMS.MANAGE_MESSAGES)
      if (!canPin) return res.status(403).json({ error: 'Sem permissão' })

      await db.update(messages).set({ pinned: true }).where(eq(messages.id, messageId))
      io.to(`channel:${channelId}`).emit('message_pinned', { messageId, channelId, pinned: true })
      void audit({
        serverId: channel.serverId, actorId: req.userId!, action: AUDIT.MESSAGE_PIN,
        targetId: messageId, metadata: { channelId },
      })
      res.json({ data: { messageId, pinned: true } })
    })
  )

  // DELETE /api/channels/:channelId/messages/:messageId/pin
  router.delete(
    '/:messageId/pin',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId, messageId } = req.params

      const channel = await assertChannelAccess(req.userId!, channelId)
      if (!channel) return res.status(403).json({ error: 'Acesso negado' })

      const [msg] = await db.select({ authorId: messages.authorId }).from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId), isNull(messages.deletedAt)))
        .limit(1)
      if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' })

      const m = await getMemberPerms(req.userId!, channel.serverId)
      const canUnpin = msg.authorId === req.userId || m.isOwner || m.permissions.has(PERMS.MANAGE_MESSAGES)
      if (!canUnpin) return res.status(403).json({ error: 'Sem permissão' })

      await db.update(messages).set({ pinned: false }).where(eq(messages.id, messageId))
      io.to(`channel:${channelId}`).emit('message_pinned', { messageId, channelId, pinned: false })
      void audit({
        serverId: channel.serverId, actorId: req.userId!, action: AUDIT.MESSAGE_UNPIN,
        targetId: messageId, metadata: { channelId },
      })
      res.json({ data: { messageId, pinned: false } })
    })
  )

  // GET /api/channels/:channelId/pinned
  router.get(
    '/pinned',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId } = req.params
      const channel = await assertChannelAccess(req.userId!, channelId)
      if (!channel) return res.status(403).json({ error: 'Acesso negado' })

      const rows = await db.select({
        id:          messages.id,
        content:     messages.content,
        authorId:    messages.authorId,
        channelId:   messages.channelId,
        authorColor: messages.authorColor,
        mentions:    messages.mentions,
        edited:      messages.edited,
        pinned:      messages.pinned,
        createdAt:   messages.createdAt,
        updatedAt:   messages.updatedAt,
        author: {
          id:          users.id,
          username:    users.username,
          displayName: users.displayName,
          avatarUrl:   users.avatarUrl,
        },
      })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.authorId))
        .where(and(
          eq(messages.channelId, channelId),
          eq(messages.pinned, true),
          isNull(messages.deletedAt),
        ))
        .orderBy(desc(messages.createdAt))
        .limit(50)

      res.json({ data: rows })
    })
  )

  // GET /api/channels/:channelId/messages/:messageId/edits — histórico de edições
  router.get(
    '/:messageId/edits',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId, messageId } = req.params
      const channel = await assertChannelAccess(req.userId!, channelId)
      if (!channel) return res.status(403).json({ error: 'Acesso negado' })

      // Confere que a mensagem pertence ao canal antes de devolver histórico
      const [msg] = await db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
        .limit(1)
      if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' })

      const rows = await db.select({
        id:       messageEdits.id,
        content:  messageEdits.content,
        editedAt: messageEdits.editedAt,
      })
        .from(messageEdits)
        .where(eq(messageEdits.messageId, messageId))
        .orderBy(desc(messageEdits.editedAt))
        .limit(20)

      res.json({ data: rows })
    })
  )

  // DELETE /api/channels/:channelId/messages/:messageId
  router.delete(
    '/:messageId',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId, messageId } = req.params

      const [message] = await db.select({
        id: messages.id, authorId: messages.authorId, serverId: channels.serverId,
      })
        .from(messages)
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .where(and(
          eq(messages.id, messageId),
          eq(messages.channelId, channelId),
          isNull(messages.deletedAt),
        ))
        .limit(1)
      if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' })

      const m = await getMemberPerms(req.userId!, message.serverId)
      const canDelete = message.authorId === req.userId || m.isOwner || m.permissions.has(PERMS.MANAGE_MESSAGES)
      if (!canDelete) return res.status(403).json({ error: 'Sem permissão' })

      await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId))
      io.to(`channel:${channelId}`).emit('message_deleted', { messageId, channelId })
      if (message.authorId !== req.userId) {
        void audit({
          serverId: message.serverId, actorId: req.userId!, action: AUDIT.MESSAGE_DELETE,
          targetId: messageId, metadata: { channelId, authorId: message.authorId },
        })
      }
      res.json({ message: 'Mensagem removida' })
    })
  )

  return router
}
