import { Server, Socket } from 'socket.io'
import { randomUUID } from 'node:crypto'
import { and, eq, or } from 'drizzle-orm'
import { db } from '../db'
import { users, dmConversations, channels, messages, serverMembers } from '../db/schema'
import { verifyAccessToken } from '../lib/jwt'
import { isTokenBlacklisted, setUserOnline, setUserOffline, refreshPresence } from '../lib/redis'
import { trackMessage, isUserMuted, muteUser, getMuteExpiry } from '../lib/spamDetector'
import { getBotId, askBot, handleBotCommand } from '../lib/bot'
import { socketConnections, socketEventsTotal, messagesSentTotal } from '../lib/metrics'
import { parseMentions } from '../lib/mentions'
import { selectAuthorById, selectMemberColor } from '../db/prepared'

const userSockets = new Map<string, Set<string>>()

// Throttle DB writes do status: user zapando IDLE/ONLINE não deve escrever a cada tick.
// Redis (setUserOnline) é hot path e sempre roda; DB persiste só a cada 5s OU em mudança final.
const STATUS_DB_TTL_MS = 5_000
const lastStatusDbWrite = new Map<string, { at: number; status: string }>()
function shouldPersistStatus(userId: string, status: string): boolean {
  const prev = lastStatusDbWrite.get(userId)
  const now  = Date.now()
  // Se mudou pra um status diferente, sempre persiste; senão throttle 5s.
  if (!prev || prev.status !== status || now - prev.at > STATUS_DB_TTL_MS) {
    lastStatusDbWrite.set(userId, { at: now, status })
    return true
  }
  return false
}

// Reutiliza helper central (respeita canais privados por role)
import { userCanSeeChannel } from '../lib/permissions'
async function userCanAccessChannel(userId: string, channelId: string): Promise<boolean> {
  return userCanSeeChannel(userId, channelId)
}

/**
 * Confere se o user participa da DM conversation.
 */
async function userCanAccessDM(userId: string, conversationId: string): Promise<boolean> {
  const [row] = await db.select({ id: dmConversations.id }).from(dmConversations)
    .where(and(
      eq(dmConversations.id, conversationId),
      or(eq(dmConversations.userAId, userId), eq(dmConversations.userBId, userId)),
    ))
    .limit(1)
  return !!row
}

export function setupSocket(io: Server) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('AUTH_REQUIRED'))

    try {
      const payload = verifyAccessToken(token)
      const revoked = await isTokenBlacklisted(payload.jti)
      if (revoked) return next(new Error('TOKEN_REVOKED'))

      const [user] = await db.select({
        username:    users.username,
        displayName: users.displayName,
        status:      users.status,
      }).from(users).where(eq(users.id, payload.userId)).limit(1)

      socket.data.userId      = payload.userId
      socket.data.username    = user?.username    ?? 'usuario'
      socket.data.displayName = user?.displayName ?? 'Usuário'
      socket.data.status      = (user?.status as 'ONLINE'|'IDLE'|'DND'|'INVISIBLE') ?? 'ONLINE'
      next()
    } catch {
      next(new Error('INVALID_TOKEN'))
    }
  })

  io.on('connection', async (socket: Socket) => {
    const userId: string = socket.data.userId

    if (!userSockets.has(userId)) userSockets.set(userId, new Set())
    userSockets.get(userId)!.add(socket.id)
    socketConnections.inc()

    const chosenStatus = (socket.data.status as 'ONLINE'|'IDLE'|'DND'|'INVISIBLE') ?? 'ONLINE'
    await setUserOnline(userId, chosenStatus)
    // INVISIBLE → broadcast como offline pra não revelar presença
    const broadcastStatus = chosenStatus === 'INVISIBLE' ? 'OFFLINE' : chosenStatus
    socket.broadcast.emit('presence_update', { userId, status: broadcastStatus })

    // Cliente pode mudar status em runtime
    socket.on('set_status', async (newStatus: 'ONLINE'|'IDLE'|'DND'|'INVISIBLE') => {
      if (!['ONLINE','IDLE','DND','INVISIBLE'].includes(newStatus)) return
      socket.data.status = newStatus
      await setUserOnline(userId, newStatus)
      // Persistir DB só quando muda OU passou 5s — IDLE→ONLINE espontâneo
      // do client (heartbeat-driven) não justifica write em cada tick.
      if (shouldPersistStatus(userId, newStatus)) {
        try { await db.update(users).set({ status: newStatus }).where(eq(users.id, userId)) } catch {}
      }
      const out = newStatus === 'INVISIBLE' ? 'OFFLINE' : newStatus
      socket.broadcast.emit('presence_update', { userId, status: out })
      socket.emit('presence_update', { userId, status: newStatus }) // self vê o real
    })

    // ── Personal room for mention notifications ───────────────
    // Every connected user joins "user:<id>" so we can target them directly
    socket.join(`user:${userId}`)

    socket.on('heartbeat', () => {
      socketEventsTotal.inc({ event: 'heartbeat', direction: 'in' })
      refreshPresence(userId)
    })

    // ── Channel rooms ─────────────────────────────────────────
    socket.on('join_channel', async (channelId: string) => {
      if (typeof channelId !== 'string' || !channelId) return
      const ok = await userCanAccessChannel(userId, channelId)
      if (!ok) { socket.emit('join_denied', { channelId, reason: 'not_a_member' }); return }
      socket.join(`channel:${channelId}`)
    })
    socket.on('leave_channel', (channelId: string) => {
      if (typeof channelId !== 'string' || !channelId) return
      socket.leave(`channel:${channelId}`)
      socket.to(`channel:${channelId}`).emit('user_stopped_typing', { userId, channelId })
    })

    // ── DM rooms ──────────────────────────────────────────────
    socket.on('join_dm', async (conversationId: string) => {
      if (typeof conversationId !== 'string' || !conversationId) return
      const ok = await userCanAccessDM(userId, conversationId)
      if (!ok) { socket.emit('join_denied', { conversationId, reason: 'not_a_participant' }); return }
      socket.join(`dm:${conversationId}`)
    })
    socket.on('leave_dm', (conversationId: string) => {
      if (typeof conversationId !== 'string' || !conversationId) return
      socket.leave(`dm:${conversationId}`)
    })

    // ── DM call signaling (voice/video) ───────────────────────
    // Convida outro user pra entrar numa chamada LiveKit. Server só faz
    // signaling — o handshake real (token, conexão SFU) acontece via REST + WebRTC.
    socket.on('dm_call_invite', async (p: { conversationId: string; toUserId: string }) => {
      if (!p || typeof p.conversationId !== 'string' || typeof p.toUserId !== 'string') return
      const ok = await userCanAccessDM(userId, p.conversationId)
      if (!ok) return
      io.to(`user:${p.toUserId}`).emit('dm_call_invite', {
        conversationId: p.conversationId,
        fromUserId:     userId,
        fromUsername:   socket.data.username,
        fromDisplayName: socket.data.displayName,
      })
    })

    socket.on('dm_call_accept', async (p: { conversationId: string; toUserId: string }) => {
      if (!p || typeof p.conversationId !== 'string' || typeof p.toUserId !== 'string') return
      const ok = await userCanAccessDM(userId, p.conversationId)
      if (!ok) return
      io.to(`user:${p.toUserId}`).emit('dm_call_accept', {
        conversationId: p.conversationId,
        byUserId:       userId,
      })
    })

    socket.on('dm_call_reject', async (p: { conversationId: string; toUserId: string }) => {
      if (!p || typeof p.conversationId !== 'string' || typeof p.toUserId !== 'string') return
      const ok = await userCanAccessDM(userId, p.conversationId)
      if (!ok) return
      io.to(`user:${p.toUserId}`).emit('dm_call_reject', {
        conversationId: p.conversationId,
        byUserId:       userId,
      })
    })

    // ── Typing ────────────────────────────────────────────────
    // Só emite pros rooms onde o user já entrou (joinedRoom previne broadcast spoof).
    socket.on('typing_start', (channelId: string) => {
      if (typeof channelId !== 'string' || !channelId) return
      const room = `channel:${channelId}`
      if (!socket.rooms.has(room)) return
      socket.to(room).emit('user_typing', { userId, username: socket.data.username, channelId })
    })
    socket.on('typing_stop', (channelId: string) => {
      if (typeof channelId !== 'string' || !channelId) return
      const room = `channel:${channelId}`
      if (!socket.rooms.has(room)) return
      socket.to(room).emit('user_stopped_typing', { userId, channelId })
    })

    // DM typing — mesma lógica mas com room `dm:${convId}`.
    socket.on('dm_typing_start', (conversationId: string) => {
      if (typeof conversationId !== 'string' || !conversationId) return
      const room = `dm:${conversationId}`
      if (!socket.rooms.has(room)) return
      socket.to(room).emit('dm_user_typing', { userId, username: socket.data.username, conversationId })
    })
    socket.on('dm_typing_stop', (conversationId: string) => {
      if (typeof conversationId !== 'string' || !conversationId) return
      const room = `dm:${conversationId}`
      if (!socket.rooms.has(room)) return
      socket.to(room).emit('dm_user_stopped_typing', { userId, conversationId })
    })

    // ── Spam check ────────────────────────────────────────────
    socket.on('check_message', async (payload: { channelId: string; serverId: string }) => {
      const { channelId, serverId } = payload
      if (!channelId || !serverId) return

      const muted = await isUserMuted(userId, serverId)
      if (muted) {
        const secs = await getMuteExpiry(userId, serverId)
        socket.emit('message_blocked', { channelId, reason: 'muted', secondsLeft: secs })
        return
      }

      const { spamDetected } = await trackMessage(userId, channelId)
      if (spamDetected) {
        const botId = await getBotId()
        if (botId) {
          await muteUser(userId, serverId, botId)
          const botMsg = {
            id: `bot-mute-${randomUUID()}`,
            content: `🔇 **@${socket.data.username}** foi silenciado por **5 minutos** por spam.`,
            channelId, edited: false, createdAt: new Date().toISOString(),
            authorColor: null, reactions: [], mentions: [],
            author: { id: botId, username: 'astra_bot', displayName: 'Astra', avatarUrl: null },
          }
          io.to(`channel:${channelId}`).emit('new_message', botMsg)
        }
        const secs = await getMuteExpiry(userId, serverId)
        socket.emit('message_blocked', { channelId, reason: 'spam', secondsLeft: secs })
        return
      }

      socket.emit('message_allowed', { channelId })
    })

    // ── Fast send (texto simples, sem anexo/reply/TTL/poll) ───
    // Pula HTTP handshake do POST: cliente emite via socket persistente.
    // Pra casos complexos (anexos, reply, poll, TTL) continua HTTP em
    // /api/channels/:id/messages. Cobre ~80% dos sends.
    //
    // Contrato:
    //   in:  { channelId, content, clientNonce }
    //   ack: { ok: true, msg } | { ok: false, error, code? }
    //   Broadcast: io.to(`channel:${channelId}`).emit('new_message', msg)
    socket.on('fast_send_text', async (
      payload: { channelId: string; content: string; clientNonce?: string },
      ack?: (r: { ok: boolean; error?: string; code?: string; msg?: unknown }) => void,
    ) => {
      const safeAck = typeof ack === 'function' ? ack : () => {}
      try {
        const { channelId, content, clientNonce } = payload ?? {}
        if (typeof channelId !== 'string' || typeof content !== 'string') {
          return safeAck({ ok: false, error: 'Payload inválido' })
        }
        const trimmed = content.trim()
        if (trimmed.length === 0 || trimmed.length > 4000) {
          return safeAck({ ok: false, error: 'Conteúdo inválido' })
        }

        // 1. Membership + canal acessível
        const [ch] = await db.select({ id: channels.id, serverId: channels.serverId })
          .from(channels).where(eq(channels.id, channelId)).limit(1)
        if (!ch) return safeAck({ ok: false, error: 'Canal não encontrado' })
        const canAccess = await userCanAccessChannel(userId, channelId)
        if (!canAccess) return safeAck({ ok: false, error: 'Acesso negado' })

        // 2. Mute check
        const muted = await isUserMuted(userId, ch.serverId)
        if (muted) {
          const secondsLeft = await getMuteExpiry(userId, ch.serverId)
          return safeAck({ ok: false, error: 'Silenciado', code: 'MUTED', ...{ secondsLeft } } as any)
        }

        // 3. Spam check
        const { spamDetected } = await trackMessage(userId, channelId)
        if (spamDetected) {
          const botId = await getBotId()
          if (botId) await muteUser(userId, ch.serverId, botId)
          return safeAck({ ok: false, error: 'Spam detectado', code: 'SPAM_MUTED' })
        }

        // 4. Paralelo: membership color + mentions + author lookup
        const [membership, mentionedIds, author] = await Promise.all([
          selectMemberColor.execute({ userId, serverId: ch.serverId }).then((rows) => rows[0]),
          parseMentions(trimmed, ch.serverId),
          selectAuthorById.execute({ userId }).then((rows) => rows[0]),
        ])

        // 5. INSERT
        const [inserted] = await db.insert(messages).values({
          content:     trimmed,
          channelId,
          authorId:    userId,
          authorColor: membership?.nameColor ?? null,
          mentions:    mentionedIds.join(','),
          attachments: '[]',
        }).returning()

        const payload2 = {
          ...inserted,
          author,
          reactions:   [],
          mentions:    mentionedIds,
          attachments: [],
          replyTo:     null,
          clientNonce: clientNonce ?? null,
        }

        // 6. Broadcast + ack
        io.to(`channel:${channelId}`).emit('new_message', payload2)
        messagesSentTotal.inc({ kind: 'channel' })
        safeAck({ ok: true, msg: payload2 })

        // 7. Background: notif mentions + channel_activity
        setImmediate(() => {
          void (async () => {
            try {
              const allMembers = await db.select({ userId: serverMembers.userId })
                .from(serverMembers).where(eq(serverMembers.serverId, ch.serverId))
              const now = (inserted.createdAt instanceof Date ? inserted.createdAt : new Date()).toISOString()
              for (const m of allMembers) {
                if (m.userId === userId) continue
                io.to(`user:${m.userId}`).emit('channel_activity', { channelId, lastMessageAt: now })
              }
              for (const targetId of mentionedIds) {
                if (targetId === userId) continue
                io.to(`user:${targetId}`).emit('mention', {
                  channelId, messageId: inserted.id, from: socket.data.username,
                })
              }
            } catch (e) {
              console.error('[fast_send_text/background]', e)
            }
          })()
        })
      } catch (e) {
        console.error('[fast_send_text]', e)
        safeAck({ ok: false, error: 'Erro interno' })
      }
    })

    // ── Bot command ───────────────────────────────────────────
    socket.on('bot_command', async (payload: { channelId: string; serverId: string; content: string }) => {
      const { channelId, serverId, content } = payload ?? {}
      if (typeof channelId !== 'string' || typeof serverId !== 'string' || typeof content !== 'string') return
      if (!content.toLowerCase().startsWith('/astra')) return
      // Confirma membership pra impedir injeção de mensagem do bot em canal alheio
      const canAccess = await userCanAccessChannel(userId, channelId)
      if (!canAccess) return

      const botId = await getBotId()
      if (!botId) return

      const muted           = await isUserMuted(userId, serverId)
      const muteSecondsLeft = muted ? await getMuteExpiry(userId, serverId) : 0

      const commandResponse = await handleBotCommand(content, {
        username: socket.data.username,
        isMuted:  muted,
        muteSecondsLeft,
        userId,
        channelId,
      })

      let reply: string
      if (commandResponse) {
        reply = commandResponse
      } else {
        const userMessage = content.replace(/^\/astra\s*/i, '').trim()
        if (!userMessage) {
          reply = 'Como posso ajudar? Tente `/astra help` pra ver comandos.'
        } else {
          const result = await askBot({
            userMessage,
            ctx: { userId, channelId, serverId, username: socket.data.username },
          })
          reply = result.text
          if (result.truncated === 'tokens') reply += '\n\n_(seu limite diário foi atingido)_'
          if (result.truncated === 'tools')  reply += '\n\n_(limite diário de ferramentas atingido)_'
        }
      }

      const botMsg = {
        id: `bot-${randomUUID()}`,
        content: reply, channelId,
        edited: false, createdAt: new Date().toISOString(),
        authorColor: null, reactions: [], mentions: [],
        author: { id: botId, username: 'astra_bot', displayName: 'Astra', avatarUrl: null },
      }
      io.to(`channel:${channelId}`).emit('new_message', botMsg)
    })

    // ── Disconnect ────────────────────────────────────────────
    socket.on('disconnect', async () => {
      const sockets = userSockets.get(userId)
      sockets?.delete(socket.id)
      if (!sockets?.size) {
        userSockets.delete(userId)
        await setUserOffline(userId)
        socket.broadcast.emit('presence_update', { userId, status: 'OFFLINE' })
      }
      socketConnections.dec()
    })
  })
}

export { userSockets }