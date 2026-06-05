/**
 * Voice/video calls via LiveKit.
 *
 *   POST /api/voice/token { roomKind: 'channel'|'dm', roomId } → { token, url }
 *
 * Token é JWT assinado com LIVEKIT_API_SECRET, vale 6h, dá permissão pra
 * publicar/subscrever na room específica como esse user.
 *
 * Permission checks:
 *  - roomKind='channel': user precisa ser membro do server dono + ver canal
 *    (respeita canais privados via userCanSeeChannel)
 *  - roomKind='dm':      user precisa ser participante da conv
 *
 * Sem LIVEKIT_* env vars setadas → 503 (chamadas desligadas).
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { and, eq, or } from 'drizzle-orm'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { db } from '../db'
import { dmConversations, channels } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { env } from '../lib/env'
import { userCanSeeChannel } from '../lib/permissions'
import { forbidden, badRequest } from '../lib/errors'

const router = Router()

// Cache curto pra presence — listRooms/listParticipants pesam,
// e polling do client é a cada ~10s. 5s de TTL = no pior caso
// um participante atrasa 5s pra aparecer/sumir. Aceitável.
const PRESENCE_TTL_MS = 5_000
const presenceCache = new Map<string, { at: number; ids: string[] }>()

function getRoomService(): RoomServiceClient | null {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null
  return new RoomServiceClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET)
}

const TokenSchema = z.object({
  roomKind: z.enum(['channel', 'dm']),
  roomId:   z.string().min(1).max(64),
})

router.get('/config', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  // Frontend usa pra detectar se voice está disponível antes de mostrar botões
  res.json({
    data: {
      enabled: !!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
      url:     env.LIVEKIT_URL ?? null,
    },
  })
}))

router.post('/token', requireAuth, validate(TokenSchema), asyncHandler(async (req: Request, res: Response) => {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'Chamadas não configuradas no servidor' })
  }

  const { roomKind, roomId } = req.body as z.infer<typeof TokenSchema>

  // Permission check por tipo de room
  if (roomKind === 'channel') {
    // Confirma que é canal voice e que o user pode ver
    const [ch] = await db.select({ type: channels.type }).from(channels)
      .where(eq(channels.id, roomId)).limit(1)
    if (!ch) throw badRequest('Canal não encontrado')
    if (ch.type !== 'VOICE') throw badRequest('Canal não é de voz')
    const ok = await userCanSeeChannel(req.userId!, roomId)
    if (!ok) throw forbidden('Sem acesso a esse canal')
  } else {
    // DM: precisa ser participante
    const [conv] = await db.select({ id: dmConversations.id }).from(dmConversations)
      .where(and(
        eq(dmConversations.id, roomId),
        or(eq(dmConversations.userAId, req.userId!), eq(dmConversations.userBId, req.userId!)),
      ))
      .limit(1)
    if (!conv) throw forbidden('Sem acesso à DM')
  }

  // Room name = <kind>:<id> pra evitar colisão entre channels e DMs
  const roomName = `${roomKind}:${roomId}`
  const identity = req.userId!

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    ttl: '6h',
  })
  at.addGrant({
    room:        roomName,
    roomJoin:    true,
    canPublish:  true,
    canSubscribe: true,
    canPublishData: true,
  })

  const token = await at.toJwt()
  res.json({
    data: {
      token,
      url:      env.LIVEKIT_URL,
      roomName,
      identity,
    },
  })
}))

/**
 * GET /api/voice/presence?channelIds=a,b,c
 *   -> { [channelId]: identities[] }
 *
 * Usado pela Sidebar pra renderizar "quem está em cada canal voice".
 * Polling client a cada ~10s. Cache server 5s.
 *
 * Só retorna canais que o user pode ver — bloqueio por userCanSeeChannel.
 */
const PresenceSchema = z.object({
  channelIds: z.string().min(1).max(2000),
})
router.get('/presence', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const parsed = PresenceSchema.safeParse(req.query)
  if (!parsed.success) {
    return res.json({ data: {} })
  }
  const svc = getRoomService()
  if (!svc) return res.json({ data: {} })

  const ids = parsed.data.channelIds.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 64)
  if (ids.length === 0) return res.json({ data: {} })

  const out: Record<string, string[]> = {}
  const now = Date.now()

  await Promise.all(ids.map(async (channelId) => {
    const roomName = `channel:${channelId}`
    const cached = presenceCache.get(roomName)
    if (cached && now - cached.at < PRESENCE_TTL_MS) {
      // Cache hit — pula perm-check porque o conteúdo é só identities (públicas)
      // PORÉM ainda precisamos validar que esse user pode ver o canal pra evitar
      // disclosure de quem-tá-onde em canal privado.
      const ok = await userCanSeeChannel(req.userId!, channelId)
      if (ok) out[channelId] = cached.ids
      return
    }
    const ok = await userCanSeeChannel(req.userId!, channelId)
    if (!ok) return
    try {
      const participants = await svc.listParticipants(roomName)
      const identities = participants.map((p) => p.identity)
      presenceCache.set(roomName, { at: now, ids: identities })
      out[channelId] = identities
    } catch {
      // Room não existe (ninguém entrou ainda) → array vazio. Cacheia também.
      presenceCache.set(roomName, { at: now, ids: [] })
      out[channelId] = []
    }
  }))

  res.json({ data: out })
}))

export default router
