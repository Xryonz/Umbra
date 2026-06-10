import { env } from './env'

/**
 * Validação central de Origin — usada por HTTP CORS, Socket.IO CORS e CSRF.
 * Antes a mesma lógica vivia triplicada em index.ts (2x) e csrf.ts; divergiam
 * silenciosamente quando uma mudava.
 *
 * Aceita:
 *  - CLIENT_URL exato (prod web)
 *  - Origins do app Capacitor: o WebView nativo NÃO serve a página do nosso
 *    domínio — Android usa https://localhost (androidScheme em capacitor.config),
 *    iOS usa capacitor://localhost. Sem isso, toda request da API falha no app.
 *  - localhost:* em dev (Vite pula porta 5173→5174 quando ocupada)
 */
const CAPACITOR_ORIGINS = new Set([
  'https://localhost',     // Android (androidScheme: 'https')
  'capacitor://localhost', // iOS
])

const LOCALHOST_DEV_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  if (origin === env.CLIENT_URL) return true
  if (CAPACITOR_ORIGINS.has(origin)) return true
  if (env.NODE_ENV === 'development' && LOCALHOST_DEV_RE.test(origin)) return true
  return false
}
