/**
 * Per-channel notification preferences.
 *
 * Routes:
 *   GET  /api/channels/notification-prefs       → lista todas do user (Map)
 *   PUT  /api/channels/:channelId/notification-pref { mode } → upsert
 *   DELETE /api/channels/:channelId/notification-pref → reseta pra default
 */
import { Router, Request, Response } from 'express'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { channelNotifPrefs, channels, serverMembers } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { userCanSeeChannel } from '../lib/permissions'

const router = Router()

const MODES = ['all', 'mentions', 'mute'] as const
const PrefSchema = z.object({ mode: z.enum(MODES) })

// GET /api/channels/notification-prefs
router.get(
  '/channels/notification-prefs',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await db.select({
      channelId: channelNotifPrefs.channelId,
      mode:      channelNotifPrefs.mode,
    }).from(channelNotifPrefs).where(eq(channelNotifPrefs.userId, req.userId!))
    res.json({ data: rows })
  }),
)

// PUT /api/channels/:channelId/notification-pref
router.put(
  '/channels/:channelId/notification-pref',
  requireAuth,
  validate(PrefSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { channelId } = req.params
    const { mode } = req.body as z.infer<typeof PrefSchema>

    // Membership / visibilidade
    const allowed = await userCanSeeChannel(req.userId!, channelId)
    if (!allowed) return res.status(403).json({ error: 'Acesso negado' })

    // upsert via ON CONFLICT (unique idx userId+channelId)
    await db.insert(channelNotifPrefs).values({
      userId:    req.userId!,
      channelId,
      mode,
    }).onConflictDoUpdate({
      target: [channelNotifPrefs.userId, channelNotifPrefs.channelId],
      set:    { mode },
    })

    res.json({ data: { channelId, mode } })
  }),
)

// DELETE /api/channels/:channelId/notification-pref
router.delete(
  '/channels/:channelId/notification-pref',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { channelId } = req.params
    await db.delete(channelNotifPrefs).where(and(
      eq(channelNotifPrefs.userId,    req.userId!),
      eq(channelNotifPrefs.channelId, channelId),
    ))
    res.json({ data: { channelId, mode: 'all' } })
  }),
)

/**
 * Helper pra usar no notification dispatcher: retorna o mode efetivo
 * pra um conjunto de user/channel pairs. Default 'all' se sem row.
 *
 * Bulk lookup (1 query pra N pairs) pra evitar N+1 em hot path.
 */
export async function getNotifModesFor(
  channelId: string,
  userIds: string[],
): Promise<Map<string, 'all' | 'mentions' | 'mute'>> {
  const out = new Map<string, 'all' | 'mentions' | 'mute'>()
  for (const id of userIds) out.set(id, 'all')
  if (userIds.length === 0) return out
  const rows = await db.select({ userId: channelNotifPrefs.userId, mode: channelNotifPrefs.mode })
    .from(channelNotifPrefs)
    .where(and(
      eq(channelNotifPrefs.channelId, channelId),
      inArray(channelNotifPrefs.userId, userIds),
    ))
  for (const r of rows) {
    if (r.mode === 'mentions' || r.mode === 'mute') out.set(r.userId, r.mode)
  }
  return out
}

export default router

// ── Suppress unused-import (tabela 'channels'/'serverMembers' usadas
//    apenas em type-checks de FK durante schema gen).
void channels; void serverMembers;
