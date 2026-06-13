import helmet from 'helmet'
import { env } from '../lib/env'

const isProd = env.NODE_ENV === 'production'

/**
 * Helmet configured with a real Content Security Policy.
 *
 * Why this matters:
 * - Default Helmet without CSP is like wearing a helmet with no straps.
 * - CSP blocks XSS even if sanitization misses something.
 * - In dev we loosen it to allow Vite HMR; in prod it's tight.
 */
export const secureHeaders = helmet({
  // ── Content Security Policy ────────────────────────────────
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:', 'https:'],
      // blob: = preview de áudio gravado localmente; https: = anexos servidos
      // do R2 (cross-origin). Sem isso, áudio/vídeo do bucket é bloqueado.
      mediaSrc:       ["'self'", 'blob:', 'https:'],
      connectSrc:     ["'self'", env.CLIENT_URL, ...(isProd ? [] : ['ws://localhost:*'])],
      frameSrc:       ["'none'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },

  // ── Other Helmet defaults — hardened ──────────────────────
  crossOriginEmbedderPolicy: false,   // breaks OAuth redirects if true
  crossOriginOpenerPolicy:   { policy: 'same-origin-allow-popups' },
  // 'cross-origin' permite que o front em outra porta carregue imagens/arquivos
  // do /uploads servido pelo backend. Sem isso o browser bloqueia <img> cross-origin.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy:            { policy: 'strict-origin-when-cross-origin' },
  hsts: isProd
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,
  noSniff:                   true,    // X-Content-Type-Options
  xssFilter:                 true,    // Legacy X-XSS-Protection (still useful for IE)
  frameguard:                { action: 'deny' },
})

/**
 * Removes the X-Powered-By header (prevents fingerprinting the stack).
 * Helmet's `hidePoweredBy` option does the same — this is explicit documentation.
 */
export function hidePoweredBy(_req: unknown, res: any, next: () => void) {
  res.removeHeader('X-Powered-By')
  next()
}