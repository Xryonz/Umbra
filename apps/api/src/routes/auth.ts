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
import { asyncHandler } from '../lib/asyncHandler'
import { RegisterSchema, LoginSchema } from '@astra/types'
import { createId } from '../db/cuid'
import { generateCoordinate } from '../lib/coordinate'

const router = Router()

const userSafeColumns = {
  id:          users.id,
  email:       users.email,
  username:    users.username,
  coordinate:  users.coordinate,
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

// Refresh token: localStorage no front + Authorization: Bearer no /refresh.
// Trade-off: vulnerável a XSS, MAS desbloqueia deploy cross-domain
// (vercel.app ↔ railway.app) onde cookies Set-Cookie cross-site são
// rejeitados pelo browser (Public Suffix List + 3rd-party cookie policy).
// Mitigação: React 19 escapa HTML por default, CSP em secureHeaders.ts.

function extractRefreshToken(req: Request): string | undefined {
  const auth = req.header('authorization')
  if (!auth?.startsWith('Bearer ')) return undefined
  return auth.slice(7).trim() || undefined
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
    const newUserId = createId()
    const [user] = await db.insert(users)
      .values({
        id: newUserId,
        email, username, displayName, passwordHash,
        coordinate: generateCoordinate(newUserId),
      })
      .returning(userSafeColumns)

    const { token: accessToken } = generateAccessToken(user.id)
    const { refreshToken }       = await createRefreshToken(user.id)

    res.status(201).json({ data: { user, accessToken, refreshToken } })
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

    res.json({ data: { user: userSafe, accessToken, refreshToken } })
  })
)

// ── POST /api/auth/refresh ────────────────────────────────────
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const token = extractRefreshToken(req)
    if (!token) return res.status(401).json({ error: 'Refresh token não encontrado' })

    let payload: ReturnType<typeof verifyRefreshToken>
    try {
      payload = verifyRefreshToken(token)
    } catch {
      return res.status(401).json({ error: 'Refresh token inválido' })
    }

    const tokenHash = hashToken(token)

    // Claim atômico: UPDATE...RETURNING garante que só 1 refresh ganha em
    // chamadas paralelas. Previne replay attack se cliente repetir o token.
    const claimed = await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(refreshTokens.token, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ))
      .returning({ id: refreshTokens.id, userId: refreshTokens.userId })

    if (claimed.length === 0) {
      return res.status(401).json({ error: 'Refresh token inválido ou expirado' })
    }

    const { token: newAccessToken } = generateAccessToken(payload.userId)
    const { refreshToken: newRefreshToken } = await createRefreshToken(payload.userId)

    res.json({ data: { accessToken: newAccessToken, refreshToken: newRefreshToken } })
  })
)

// ── POST /api/auth/logout ─────────────────────────────────────
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    // refreshToken vem no body (header Authorization carrega o access).
    const refreshTokenRaw = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : ''
    if (refreshTokenRaw) {
      const tokenHash = hashToken(refreshTokenRaw)
      await db.update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.token, tokenHash))
    }
    if (req.jti) await blacklistToken(req.jti, 15 * 60)
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
  (req: Request, res: Response, next) => {
    // Callback custom pra capturar `info` (3º arg do done()) com email
    // não-registrado e redirecionar pra /login com query param amigável.
    passport.authenticate('google', { session: false }, async (err: Error | null, user: { id: string } | false, info: { code?: string; email?: string } | undefined) => {
      if (err) {
        return res.redirect(`${process.env.CLIENT_URL}/login?error=oauth`)
      }
      if (!user) {
        if (info?.code === 'email_not_registered' && info.email) {
          const q = new URLSearchParams({
            error: 'google_email_unregistered',
            email: info.email,
          })
          return res.redirect(`${process.env.CLIENT_URL}/login?${q.toString()}`)
        }
        return res.redirect(`${process.env.CLIENT_URL}/login?error=oauth`)
      }
      try {
        const { refreshToken } = await createRefreshToken(user.id)
        // Hash fragment: não aparece em access logs, server nunca vê.
        res.redirect(`${process.env.CLIENT_URL}/auth/callback#refresh=${encodeURIComponent(refreshToken)}`)
      } catch (e) {
        next(e)
      }
    })(req, res, next)
  }
)

// ── Helper ────────────────────────────────────────────────────
// Refresh TTL: 30 dias. Como /refresh emite NOVO token e revoga o velho
// via UPDATE atômico, isso é sliding window de fato — cada uso renova
// outros 30d. Cobertura típica: user que abre o app ao menos 1x/mês
// fica logado pra sempre. Discord/WhatsApp Web usam padrão similar.
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
async function createRefreshToken(userId: string) {
  const expiresAt    = new Date(Date.now() + REFRESH_TTL_MS)
  const refreshToken = generateRefreshToken(userId)
  const tokenHash    = hashToken(refreshToken)
  await db.insert(refreshTokens).values({ token: tokenHash, userId, expiresAt })
  return { refreshToken }
}

export default router
