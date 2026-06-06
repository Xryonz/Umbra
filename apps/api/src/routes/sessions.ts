import { Router, Request, Response } from 'express'
import { and, desc, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../db'
import { refreshTokens } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { hashToken } from '../lib/jwt'

const router = Router()

/**
 * GET /api/sessions — lista todas as sessões ativas (refresh tokens não-revogados,
 * não-expirados) do user. A sessão CORRENTE é marcada via match com o refresh
 * Bearer no body (opcional — frontend pode mandar pra UI destacar "este device").
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await db.select({
      id:         refreshTokens.id,
      createdAt:  refreshTokens.createdAt,
      lastUsedAt: refreshTokens.lastUsedAt,
      expiresAt:  refreshTokens.expiresAt,
      userAgent:  refreshTokens.userAgent,
      ip:         refreshTokens.ip,
    })
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.userId, req.userId!),
        isNull(refreshTokens.revokedAt),
      ))
      .orderBy(desc(refreshTokens.lastUsedAt))

    const now = Date.now()
    const active = rows.filter((r) => r.expiresAt.getTime() > now)

    res.json({ data: { sessions: active } })
  })
)

/**
 * DELETE /api/sessions/:id — revoga uma sessão específica (refresh token).
 * User só pode revogar o que é dele. Não revoga a sessão CORRENTE — frontend
 * precisa fazer logout normal pra essa.
 */
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id
    const result = await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(refreshTokens.id, id),
        eq(refreshTokens.userId, req.userId!),
        isNull(refreshTokens.revokedAt),
      ))
      .returning({ id: refreshTokens.id })

    if (result.length === 0) {
      return res.status(404).json({ error: 'Sessão não encontrada ou já revogada' })
    }
    res.json({ data: { revoked: result[0].id } })
  })
)

/**
 * POST /api/sessions/revoke-others — revoga TODAS as sessões exceto a atual.
 * Identifica a atual pelo refresh token no body (Bearer não serve aqui —
 * Authorization carrega o access token). Útil pro botão "encerrar outros
 * dispositivos" — flow padrão pós-troca de senha ou suspeita de comprometido.
 */
router.post(
  '/revoke-others',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const refreshTokenRaw = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : ''
    if (!refreshTokenRaw) {
      return res.status(400).json({ error: 'refreshToken da sessão atual é obrigatório' })
    }
    const tokenHash = hashToken(refreshTokenRaw)

    const result = await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(refreshTokens.userId, req.userId!),
        isNull(refreshTokens.revokedAt),
        ne(refreshTokens.token, tokenHash),
      ))
      .returning({ id: refreshTokens.id })

    res.json({ data: { revokedCount: result.length } })
  })
)

export default router
