import { Router, Request, Response } from 'express'
import { Server as SocketServer } from 'socket.io'
import { z } from 'zod'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '../db'
import { threads, messages, channels, serverMembers, users } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { SendMessageSchema } from '@astra/types'
import { messagesSentTotal } from '../lib/metrics'

interface CursorPayload { createdAt: Date; id: string }
function encodeCursor(d: Date, id: string) { return Buffer.from(JSON.stringify({ createdAt: d.toISOString(), id })).toString('base64url') }
function parseCursor(c?: string): CursorPayload | null {
  if (!c) return null
  try {
    const r = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as { createdAt?: string; id?: string }
    if (!r.createdAt || !r.id) return null
    const d = new Date(r.createdAt); if (Number.isNaN(d.getTime())) return null
    return { createdAt: d, id: r.id }
  } catch { return null }
}

async function assertChannelMembership(userId: string, channelId: string) {
  const [row] = await db.select({
    channelId: channels.id, serverId: channels.serverId, membershipId: serverMembers.id,
  })
    .from(channels)
    .leftJoin(serverMembers, and(eq(serverMembers.serverId, channels.serverId), eq(serverMembers.userId, userId)))
    .where(eq(channels.id, channelId))
    .limit(1)
  return row && row.membershipId ? row : null
}

const CreateThreadSchema = z.object({
  parentMessageId: z.string().min(1),
  name:            z.string().min(1).max(80),
})

export function createThreadsRouter(io: SocketServer) {
  const router = Router()

  // GET /api/channels/:channelId/threads — lista threads do canal
  router.get(
    '/channels/:channelId/threads',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId } = req.params
      const access = await assertChannelMembership(req.userId!, channelId)
      if (!access) return res.status(403).json({ error: 'Acesso negado' })

      const rows = await db.select({
        id:              threads.id,
        name:            threads.name,
        channelId:       threads.channelId,
        parentMessageId: threads.parentMessageId,
        createdAt:       threads.createdAt,
        createdBy:       { id: users.id, displayName: users.displayName, username: users.username, avatarUrl: users.avatarUrl },
      })
        .from(threads)
        .innerJoin(users, eq(users.id, threads.createdById))
        .where(eq(threads.channelId, channelId))
        .orderBy(desc(threads.updatedAt))
        .limit(50)

      res.json({ data: rows })
    })
  )

  // POST /api/channels/:channelId/threads — cria thread a partir de uma msg
  router.post(
    '/channels/:channelId/threads',
    requireAuth,
    validate(CreateThreadSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { channelId } = req.params
      const { parentMessageId, name } = req.body as { parentMessageId: string; name: string }
      const access = await assertChannelMembership(req.userId!, channelId)
      if (!access) return res.status(403).json({ error: 'Acesso negado' })

      // Verifica que parent existe no mesmo canal e não tá deletada
      const [parent] = await db.select({ id: messages.id })
        .from(messages)
        .where(and(
          eq(messages.id, parentMessageId),
          eq(messages.channelId, channelId),
          isNull(messages.deletedAt),
          isNull(messages.threadId),
        ))
        .limit(1)
      if (!parent) return res.status(404).json({ error: 'Mensagem âncora não encontrada' })

      const [t] = await db.insert(threads).values({
        channelId, parentMessageId, name, createdById: req.userId!,
      }).returning()

      io.to(`channel:${channelId}`).emit('thread_created', { threadId: t.id, channelId, parentMessageId, name })
      res.status(201).json({ data: t })
    })
  )

  // GET /api/threads/:threadId/messages
  router.get(
    '/threads/:threadId/messages',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { threadId } = req.params
      const { cursor } = req.query as { cursor?: string }
      const take = 30
      const parsed = parseCursor(cursor)

      const [thread] = await db.select({ channelId: threads.channelId }).from(threads).where(eq(threads.id, threadId)).limit(1)
      if (!thread) return res.status(404).json({ error: 'Thread não encontrada' })
      const access = await assertChannelMembership(req.userId!, thread.channelId)
      if (!access) return res.status(403).json({ error: 'Acesso negado' })

      const conds = [eq(messages.threadId, threadId), isNull(messages.deletedAt)]
      if (parsed) {
        conds.push(or(
          lt(messages.createdAt, parsed.createdAt),
          and(eq(messages.createdAt, parsed.createdAt), lt(messages.id, parsed.id))
        )!)
      }

      const rows = await db.select({
        id: messages.id, content: messages.content, channelId: messages.channelId, threadId: messages.threadId,
        authorColor: messages.authorColor, mentions: messages.mentions, edited: messages.edited, pinned: messages.pinned,
        createdAt: messages.createdAt, updatedAt: messages.updatedAt,
        author: { id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl, displayFont: users.displayFont },
      })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.authorId))
        .where(and(...conds))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(take + 1)

      const hasMore = rows.length > take
      const items = hasMore ? rows.slice(0, take) : rows
      const last = items[items.length - 1]
      const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null
      res.json({ data: { items: items.reverse(), nextCursor, hasMore } })
    })
  )

  // POST /api/threads/:threadId/messages
  router.post(
    '/threads/:threadId/messages',
    requireAuth,
    validate(SendMessageSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { threadId } = req.params
      const { content } = req.body as { content: string }

      const [thread] = await db.select({ channelId: threads.channelId }).from(threads).where(eq(threads.id, threadId)).limit(1)
      if (!thread) return res.status(404).json({ error: 'Thread não encontrada' })
      const access = await assertChannelMembership(req.userId!, thread.channelId)
      if (!access) return res.status(403).json({ error: 'Acesso negado' })

      const [inserted] = await db.insert(messages).values({
        content, channelId: thread.channelId, authorId: req.userId!, threadId,
      }).returning()

      const [author] = await db.select({
        id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl,
      }).from(users).where(eq(users.id, req.userId!)).limit(1)

      // touch updatedAt da thread pra ordenar por atividade
      await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId))

      const payload = { ...inserted, author, reactions: [], mentions: [] }
      io.to(`channel:${thread.channelId}`).emit('thread_message', { threadId, message: payload })
      messagesSentTotal.inc({ kind: 'thread' })
      res.status(201).json({ data: payload })
    })
  )

  return router
}
