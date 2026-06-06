import { Router, Request, Response } from 'express'
import { Server as SocketServer } from 'socket.io'
import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { users, dmConversations, directMessages } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { messageLimiter } from '../middleware/rateLimiter'
import { MessageCursorSchema } from '@astra/types'
import { notify } from '../lib/notifications'
import { messagesSentTotal } from '../lib/metrics'
import { getOrCreateConversation } from '../lib/dmCore'

// DM aceita anexos + reply + efêmera (mas sem mentions/poll/threads).
const SendDMSchema = z.object({
  content:     z.string().min(0).max(4000),
  attachments: z.array(z.object({
    url:    z.string(),
    type:   z.string(),
    name:   z.string(),
    size:   z.number(),
    width:  z.number().optional(),
    height: z.number().optional(),
  })).max(10).optional(),
  replyToId:   z.string().optional(),
  ttlSeconds:  z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
  clientNonce: z.string().max(64).optional(),
}).refine(
  (d) => (d.content?.trim().length ?? 0) > 0 || (d.attachments?.length ?? 0) > 0,
  { message: 'Mensagem vazia' },
)

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function createDMRouter(io: SocketServer) {
  const router = Router()

  // GET /api/dm — lista das conversas do user
  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.userId!

      const convs = await db.select().from(dmConversations)
        .where(or(eq(dmConversations.userAId, userId), eq(dmConversations.userBId, userId)))
        .orderBy(desc(dmConversations.updatedAt))

      if (convs.length === 0) return res.json({ data: [] })

      // Carrega "outro usuário" de cada conv + última mensagem em batch
      const otherIds = convs.map((c) => (c.userAId === userId ? c.userBId : c.userAId))
      const convIds  = convs.map((c) => c.id)

      const [otherUsers, lastMessages] = await Promise.all([
        db.select({
          id: users.id, username: users.username,
          displayName: users.displayName, avatarUrl: users.avatarUrl,
        }).from(users).where(inArray(users.id, otherIds)),
        // Última mensagem por conv: pega todas não-deletadas e seleciona em JS.
        // OK pra MVP; otimizar com window function depois se virar gargalo.
        db.select().from(directMessages)
          .where(and(inArray(directMessages.conversationId, convIds), isNull(directMessages.deletedAt)))
          .orderBy(desc(directMessages.createdAt)),
      ])

      const usersById = new Map(otherUsers.map((u) => [u.id, u]))
      const lastByConv = new Map<string, typeof lastMessages[number]>()
      for (const m of lastMessages) {
        if (!lastByConv.has(m.conversationId)) lastByConv.set(m.conversationId, m)
      }

      const shaped = convs.map((c) => ({
        id:          c.id,
        otherUser:   usersById.get(c.userAId === userId ? c.userBId : c.userAId) ?? null,
        lastMessage: lastByConv.get(c.id) ?? null,
        updatedAt:   c.updatedAt,
      }))

      res.json({ data: shaped })
    })
  )

  // POST /api/dm/open  body: { userId? , username? }
  // Variante body-driven usada pelo FriendsPage e por flows que já têm userId.
  router.post(
    '/open',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, username } = (req.body ?? {}) as { userId?: string; username?: string }
      if (!userId && !username) return res.status(400).json({ error: 'Informe userId ou username' })

      const [target] = await db.select({
        id: users.id, username: users.username,
        displayName: users.displayName, avatarUrl: users.avatarUrl, bio: users.bio,
      }).from(users)
        .where(userId ? eq(users.id, userId) : eq(users.username, username!))
        .limit(1)

      if (!target) return res.status(404).json({ error: 'Usuário não encontrado' })
      if (target.id === req.userId) return res.status(400).json({ error: 'Não pode abrir DM consigo mesmo' })

      const conversation = await getOrCreateConversation(req.userId!, target.id)
      res.json({ data: { conversationId: conversation.id, otherUser: target } })
    })
  )

  // POST /api/dm/open/:username (legacy / atalho por URL)
  router.post(
    '/open/:username',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const [target] = await db.select({
        id: users.id, username: users.username,
        displayName: users.displayName, avatarUrl: users.avatarUrl, bio: users.bio,
      }).from(users).where(eq(users.username, req.params.username)).limit(1)

      if (!target) return res.status(404).json({ error: 'Usuário não encontrado' })
      if (target.id === req.userId) return res.status(400).json({ error: 'Você não pode abrir um DM consigo mesmo' })

      const conversation = await getOrCreateConversation(req.userId!, target.id)
      res.json({ data: { conversationId: conversation.id, otherUser: target } })
    })
  )

  // GET /api/dm/:conversationId/messages
  router.get(
    '/:conversationId/messages',
    requireAuth,
    validate(MessageCursorSchema, 'query'),
    asyncHandler(async (req: Request, res: Response) => {
      const { conversationId } = req.params
      const { cursor, limit }  = req.query as unknown as { cursor?: string; limit: number }
      const take = Number(limit) || 30

      const [conv] = await db.select().from(dmConversations)
        .where(and(
          eq(dmConversations.id, conversationId),
          or(eq(dmConversations.userAId, req.userId!), eq(dmConversations.userBId, req.userId!)),
        ))
        .limit(1)
      if (!conv) return res.status(403).json({ error: 'Acesso negado' })

      const conditions = [
        eq(directMessages.conversationId, conversationId),
        isNull(directMessages.deletedAt),
      ]
      if (cursor) conditions.push(lt(directMessages.id, cursor))

      // Esconde mensagens já expiradas (expiresAt no futuro OU null)
      const now = new Date()
      conditions.push(
        or(isNull(directMessages.expiresAt), gt(directMessages.expiresAt, now)) as any,
      )

      const rows = await db.select({
        id:             directMessages.id,
        content:        directMessages.content,
        senderId:       directMessages.senderId,
        receiverId:     directMessages.receiverId,
        conversationId: directMessages.conversationId,
        attachments:    directMessages.attachments,
        replyToId:      directMessages.replyToId,
        expiresAt:      directMessages.expiresAt,
        edited:         directMessages.edited,
        deletedAt:      directMessages.deletedAt,
        createdAt:      directMessages.createdAt,
        // alias `sender` → `author` pra casar com MessageWithAuthor
        author: {
          id: users.id, username: users.username,
          displayName: users.displayName, avatarUrl: users.avatarUrl,
        },
      })
        .from(directMessages)
        .innerJoin(users, eq(users.id, directMessages.senderId))
        .where(and(...conditions))
        .orderBy(desc(directMessages.createdAt))
        .limit(take + 1)

      const hasMore   = rows.length > take
      const items     = hasMore ? rows.slice(0, take) : rows
      const nextCursor = hasMore ? items[items.length - 1].id : null

      // Batch fetch replyTo snapshots
      const replyIds = items.map((m) => m.replyToId).filter(Boolean) as string[]
      let replyMap = new Map<string, { id: string; content: string; authorName: string; authorAvatar: string | null }>()
      if (replyIds.length > 0) {
        const replies = await db.select({
          id:      directMessages.id,
          content: directMessages.content,
          author: {
            displayName: users.displayName,
            avatarUrl:   users.avatarUrl,
          },
        })
          .from(directMessages)
          .innerJoin(users, eq(users.id, directMessages.senderId))
          .where(inArray(directMessages.id, replyIds))
        replyMap = new Map(replies.map((r) => [r.id, {
          id:           r.id,
          content:      r.content.slice(0, 160),
          authorName:   r.author.displayName,
          authorAvatar: r.author.avatarUrl,
        }]))
      }

      const shaped = items.map((m) => ({
        ...m,
        attachments: safeJson<unknown[]>(m.attachments, []),
        replyTo:     m.replyToId ? replyMap.get(m.replyToId) ?? null : null,
      }))

      res.json({ data: { items: shaped.reverse(), nextCursor, hasMore } })
    })
  )

  // POST /api/dm/:conversationId/messages
  router.post(
    '/:conversationId/messages',
    requireAuth,
    messageLimiter,
    validate(SendDMSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { conversationId } = req.params
      const { content, attachments = [], replyToId, ttlSeconds } = req.body as z.infer<typeof SendDMSchema>

      const [conv] = await db.select().from(dmConversations)
        .where(and(
          eq(dmConversations.id, conversationId),
          or(eq(dmConversations.userAId, req.userId!), eq(dmConversations.userBId, req.userId!)),
        ))
        .limit(1)
      if (!conv) return res.status(403).json({ error: 'Acesso negado' })

      const receiverId = conv.userAId === req.userId ? conv.userBId : conv.userAId

      // Valida reply: deve ser msg dessa mesma conv
      let validReplyToId: string | null = null
      let replySnapshot: { id: string; content: string; authorName: string; authorAvatar: string | null } | null = null
      if (replyToId) {
        const [r] = await db.select({
          id:        directMessages.id,
          content:   directMessages.content,
          authorName: users.displayName,
          authorAvatar: users.avatarUrl,
        })
          .from(directMessages)
          .innerJoin(users, eq(users.id, directMessages.senderId))
          .where(and(eq(directMessages.id, replyToId), eq(directMessages.conversationId, conversationId)))
          .limit(1)
        if (r) {
          validReplyToId = r.id
          replySnapshot  = { id: r.id, content: r.content.slice(0, 160), authorName: r.authorName, authorAvatar: r.authorAvatar }
        }
      }

      const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null

      // ── PARALELIZAR INSERT + SELECT author (independentes) ───
      const [insertedRows, authorRows] = await Promise.all([
        db.insert(directMessages).values({
          content, senderId: req.userId!, receiverId, conversationId,
          attachments: JSON.stringify(attachments),
          replyToId:   validReplyToId,
          expiresAt:   expiresAt as any,
        }).returning(),
        db.select({
          id: users.id, username: users.username,
          displayName: users.displayName, avatarUrl: users.avatarUrl,
        }).from(users).where(eq(users.id, req.userId!)).limit(1),
      ])
      const inserted = insertedRows[0]
      const author   = authorRows[0]

      const message = {
        ...inserted,
        attachments,
        replyTo: replySnapshot,
        author,
      }

      // ── EMIT ASAP + responde REST imediato ───────────────────
      io.to(`dm:${conversationId}`).emit('new_dm', message)
      messagesSentTotal.inc({ kind: 'dm' })
      res.status(201).json({ data: message })

      // ── BACKGROUND: bump conv + notify ───────────────────────
      setImmediate(() => {
        void (async () => {
          try {
            await db.update(dmConversations).set({ updatedAt: new Date() })
              .where(eq(dmConversations.id, conversationId))

            await notify({
              io, userId: receiverId, actorId: req.userId!, type: 'dm',
              payload: {
                messageId:      inserted.id,
                conversationId,
                authorId:       author?.id,
                authorName:     author?.displayName ?? 'Alguém',
                authorAvatar:   author?.avatarUrl ?? null,
                preview:        content.slice(0, 140),
              },
              push: {
                title: `Nova DM de ${author?.displayName ?? 'Alguém'}`,
                body:  content.slice(0, 140),
                url:   '/app/dm',
                tag:   `dm-${conversationId}`,
                icon:  author?.avatarUrl ?? undefined,
              },
            }).catch(() => {})
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[dm POST] background work failed:', err)
          }
        })()
      })
    })
  )

  // DELETE /api/dm/:conversationId/messages/:messageId
  router.delete(
    '/:conversationId/messages/:messageId',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { conversationId, messageId } = req.params

      const [message] = await db.select().from(directMessages)
        .where(and(
          eq(directMessages.id, messageId),
          eq(directMessages.conversationId, conversationId),
          isNull(directMessages.deletedAt),
        ))
        .limit(1)

      if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' })
      if (message.senderId !== req.userId) return res.status(403).json({ error: 'Sem permissão' })

      await db.update(directMessages).set({ deletedAt: new Date() }).where(eq(directMessages.id, messageId))

      io.to(`dm:${conversationId}`).emit('dm_deleted', { messageId, conversationId })
      res.json({ message: 'Mensagem removida' })
    })
  )

  return router
}
