import { Request, Response, NextFunction } from 'express'
import { env } from '../lib/env'
import { isAllowedOrigin } from '../lib/allowedOrigins'

/**
 * Proteção CSRF leve para endpoints que usam o refresh cookie.
 *
 * Estratégia: validamos o header `Origin` (e `Referer` como fallback).
 * O browser sempre seta esses em requisições cross-site e o atacante
 * não consegue forjá-los via XHR/fetch. Combinado com SameSite=strict
 * no cookie, isso bloqueia o vetor CSRF clássico.
 *
 * Use APENAS em endpoints que mutam estado e dependem de cookie.
 * Endpoints com Authorization: Bearer já estão imunes a CSRF (atacante
 * não consegue ler o token de outro origin).
 *
 * Whitelist de origins centralizada em lib/allowedOrigins (inclui app
 * Capacitor — WebView nativo manda Origin https://localhost).
 */
// Em dev, Referer de localhost:* também passa (Vite port juggling).
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/

export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin  = req.headers.origin
  const referer = req.headers.referer
  const expected = env.CLIENT_URL

  if (isAllowedOrigin(origin)) return next()

  // Fallback: Referer começando com a URL do client (ou localhost em dev)
  if (!origin && referer) {
    if (referer.startsWith(expected)) return next()
    if (env.NODE_ENV === 'development' && LOCALHOST_RE.test(referer.split('/').slice(0, 3).join('/'))) {
      return next()
    }
  }

  return res.status(403).json({ error: 'Origin inválido', code: 'CSRF_BLOCKED' })
}
