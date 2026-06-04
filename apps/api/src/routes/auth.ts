import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { eq, or, and, isNull, gt } from 'drizzle-orm'
import passport from '../config/passport'
import { db } from '../db'
import { users, refreshTokens } from '../db/schema'
import { blacklistToken } from '../lib/redis'
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../lib/jwt'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { authLimiter } from '../middleware/rateLimiter'
import { requireSameOrigin } from '../middleware/csrf'
import { asyncHandler } from '../lib/asyncHandler'
import { RegisterSchema, LoginSchema } from '@umbra/types'

const router = Router()

// Subset de colunas seguras de User pra retornar em endpoints de auth.
// (Drizzle não tem `.select(USER_SELECT)` — usamos object map abaixo).
const userSafeColumns = {
  id:          users.id,
  email:       users.email,
  username:    users.username,
  displayName: users.displayName,
  avatarUrl:   users.avatarUrl,
  bio:         users.bio,
  bannerUrl:   users.bannerUrl,
  bannerColor: users.bannerColor,
  profileTheme: users.profileTheme,
  bannerPositionY: users.bannerPositionY,
  bannerScale:     users.bannerScale,
  bannerBorder:    users.bannerBorder,
  bannerTextColor: users.bannerTextColor,
  pronouns:        users.pronouns,
  statusEmoji:     users.statusEmoji,
  displayFont:     users.displayFont,
}

// sameSite/secure depende do contexto:
//  - prod (HTTPS, web em domínio diferente da API): 'none' obriga secure=true.
//    'strict' falharia cross-site → browser nunca envia o cookie em XHR do
//    frontend → refresh token nunca chega → user é deslogado a cada reload.
//  - dev (HTTP, mesma localhost): 'lax' (não pode 'none' sem secure).
const isProd = process.env.NODE_ENV === 'production'
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProd,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,
  path:     '/',
}

// ── POST /api/auth/register ───────────────────────────────────
router.post(
  '/register',
  authLimiter,
  validate(RegisterSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, username, displayName, password } = req.body

    const [exists] = await db.select({ email: users.email, username: users.username })
      .from(users)
      .where(or(eq(users.email, email), eq(users.username, username)))
      .limit(1)

    if (exists) {
      const field = exists.email === email ? 'e-mail' : 'username'
      return res.status(409).json({ error: `Este ${field} já está em uso` })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const [user] = await db.insert(users)
      .values({ email, username, displayName, passwordHash })
      .returning(userSafeColumns)

    const { token: accessToken } = generateAccessToken(user.id)
    const { refreshToken }       = await createRefreshToken(user.id)

    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)
    res.status(201).json({ data: { user, accessToken } })
  })
)

// ── POST /api/auth/login ──────────────────────────────────────
router.post(
  '/login',
  authLimiter,
  validate(LoginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body

    const [user] = await db.select({ ...userSafeColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    // Timing-safe: compara hash mesmo quando usuário não existe
    const fakeHash = '$2b$12$invalidhashtopreventtimingattacks000000000000000000000'
    const valid = user
      ? await bcrypt.compare(password, user.passwordHash ?? fakeHash)
      : await bcrypt.compare(password, fakeHash).then(() => false)

    if (!valid || !user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos' })
    }

    const { token: accessToken } = generateAccessToken(user.id)
    const { refreshToken }       = await createRefreshToken(user.id)
    const { passwordHash: _, ...userSafe } = user

    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)
    res.json({ data: { user: userSafe, accessToken } })
  })
)

// ── POST /api/auth/refresh ────────────────────────────────────
router.post(
  '/refresh',
  requireSameOrigin,
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken
    if (!token) return res.status(401).json({ error: 'Refresh token não encontrado' })

    let payload: ReturnType<typeof verifyRefreshToken>
    try {
      payload = verifyRefreshToken(token)
    } catch {
      res.clearCookie('refreshToken', { path: '/' })
      return res.status(401).json({ error: 'Refresh token inválido' })
    }

    const tokenHash = hashToken(token)

    // Claim atômico: UPDATE...RETURNING garante que só 1 refresh ganha em
    // chamadas paralelas (o segundo recebe array vazio → 401). Previne
    // tokens órfãos no DB e replay attack se o cliente repetir o mesmo token.
    const claimed = await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(refreshTokens.token, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ))
      .returning({ id: refreshTokens.id, userId: refreshTokens.userId })

    if (claimed.length === 0) {
      res.clearCookie('refreshToken', { path: '/' })
      return res.status(401).json({ error: 'Refresh token inválido ou expirado' })
    }

    const { token: newAccessToken } = generateAccessToken(payload.userId)
    const { refreshToken: newRefreshToken } = await createRefreshToken(payload.userId)

    res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS)
    res.json({ data: { accessToken: newAccessToken } })
  })
)

// ── POST /api/auth/logout ─────────────────────────────────────
router.post(
  '/logout',
  requireSameOrigin,
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken
    if (token) {
      const tokenHash = hashToken(token)
      await db.update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.token, tokenHash))
    }
    if (req.jti) await blacklistToken(req.jti, 15 * 60)
    res.clearCookie('refreshToken', { path: '/' })
    res.json({ message: 'Logout realizado' })
  })
)

// ── GET /api/auth/me ──────────────────────────────────────────
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const [user] = await db.select(userSafeColumns).from(users)
      .where(eq(users.id, req.userId!))
      .limit(1)
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })
    res.json({ data: { user } })
  })
)

// ── Google OAuth ──────────────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }))

router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.CLIENT_URL}/login?error=oauth`,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as { id: string }
    const { refreshToken } = await createRefreshToken(user.id)
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)
    res.redirect(`${process.env.CLIENT_URL}/auth/callback`)
  })
)

// ── Helper ────────────────────────────────────────────────────
async function createRefreshToken(userId: string) {
  const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const refreshToken = generateRefreshToken(userId)
  const tokenHash    = hashToken(refreshToken)
  await db.insert(refreshTokens).values({ token: tokenHash, userId, expiresAt })
  return { refreshToken }
}

export default router
