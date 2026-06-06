import 'dotenv/config'
import './lib/env'

import { initSentry, sentry } from './lib/sentry'
initSentry() // chama antes de criar Express pra capturar erros do boot

import express    from 'express'
import http       from 'http'
import { Server as SocketServer } from 'socket.io'
import cors       from 'cors'
import cookieParser from 'cookie-parser'

import { env }            from './lib/env'
import { secureHeaders, hidePoweredBy } from './middleware/secureHeaders'
import { sanitizeInputs } from './middleware/sanitize'
import { globalLimiter }  from './middleware/rateLimiter'
import { reqContext }     from './middleware/reqContext'
import { httpMetrics }    from './middleware/httpMetrics'
import { setupSocket }    from './config/socket'
import { initBot }        from './lib/bot'
import './config/passport'

import authRouter            from './routes/auth'
import profileRouter         from './routes/profile'
import inviteRouter          from './routes/invites'
import { serversRouter, channelsRouter } from './routes/servers'
import { createMessagesRouter }          from './routes/messages'
import { createReactionsRouter }         from './routes/reactions'
import { createPollsRouter }             from './routes/polls'
import { createReadsRouter }             from './routes/reads'
import { createDMRouter }                from './routes/dm'
import { createThreadsRouter }           from './routes/threads'
import searchRouter                      from './routes/search'
import uploadRouter, { UPLOAD_DIR }      from './routes/upload'
import { startRetentionWorker }          from './lib/retentionWorker'
import pushRouter                        from './routes/push'
import { initPush }                      from './lib/push'
import gifRouter                         from './routes/gif'
import { rolesRouter }                   from './routes/roles'
import { bansRouter }                    from './routes/bans'
import { healthRouter }                  from './routes/health'
import notificationsRouter               from './routes/notifications'
import bookmarksRouter                    from './routes/bookmarks'
import remindersRouter                    from './routes/reminders'
import translateRouter                    from './routes/translate'
import friendsRouter                      from './routes/friends'
import voiceRouter                        from './routes/voice'
import wishesRouter                       from './routes/wishes'
import sessionsRouter                     from './routes/sessions'
import { startReminderWorker }            from './lib/reminders'
import { HttpError }                     from './lib/errors'
import { logger }                        from './lib/logger'

const app        = express()
// Atrás de proxy reverso (Render/Railway/Fly/nginx): confia no header
// X-Forwarded-* pra que:
//  - req.ip retorne IP real do user (não do proxy) → rate-limit funciona por user
//  - req.protocol retorne 'https' quando o user acessou via HTTPS → OAuth callback
//    URL é construída com scheme certo, secure-cookies enviam, redirects funcionam
//
// '1' = confia em EXATAMENTE 1 hop (o proxy do hosting). Confiar em 'true' aceitaria
// qualquer X-Forwarded-For falsificado pelo cliente → IP spoofing trivial.
app.set('trust proxy', 1)

const httpServer = http.createServer(app)

// Socket.IO CORS: mesmo padrão do HTTP CORS — aceita CLIENT_URL exato
// + localhost:* em dev (Vite port juggling).
const socketAllowedOrigin = (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
  if (!origin) return cb(null, true)
  if (origin === env.CLIENT_URL) return cb(null, true)
  if (env.NODE_ENV === 'development' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    return cb(null, true)
  }
  cb(new Error('CORS blocked'))
}
const io = new SocketServer(httpServer, {
  cors:              { origin: socketAllowedOrigin, credentials: true },
  perMessageDeflate: false,
  pingTimeout:       20_000,
  pingInterval:      25_000,
})
setupSocket(io)

// ── Security ──────────────────────────────────────────────────
app.use(hidePoweredBy)
app.use(secureHeaders)

// CORS: aceita CLIENT_URL exato. Em dev, também aceita qualquer
// localhost:PORT pra cobrir quando Vite pula porta (5173→5174→5175)
// quando a anterior tá ocupada — esse cenário pegou a gente no bug
// silencioso do ProfileCard. Sem isso, request hangs em refresh loop.
const ALLOW_LOCALHOST_DEV = env.NODE_ENV === 'development'
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)  // server-to-server, curl, etc.
    if (origin === env.CLIENT_URL) return cb(null, true)
    if (ALLOW_LOCALHOST_DEV && LOCALHOST_RE.test(origin)) return cb(null, true)
    cb(new Error('CORS blocked'))
  },
  credentials:     true,
  methods:         ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders:  ['Content-Type','Authorization','X-Request-Id'],
  maxAge:          600,
}))

app.use(cookieParser())
// reqContext ANTES dos parsers pra que logs de body-parse já tenham reqId
app.use(reqContext)
app.use(httpMetrics)
// /api/profile: limit 4MB pra acomodar avatar/banner em base64
// (data:image/webp;base64 de ~3MB = imagem ~2.2MB). Reduzido de 8MB.
// Maior que isso: usar upload multipart em /api/upload.
app.use('/api/profile', express.json({ limit: '4mb' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '128kb' }))
app.use(sanitizeInputs)
app.use(globalLimiter)

// ── Health/Metrics (antes dos routers de negócio, sem rate-limit) ──
app.use(healthRouter)

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',     authRouter)
app.use('/api/profile',  profileRouter)
app.use('/api/invites',  inviteRouter)
app.use('/api/servers',  serversRouter)
app.use('/api/servers',  channelsRouter)
app.use('/api/channels/:channelId/messages', createMessagesRouter(io))
app.use('/api/channels/:channelId/polls',    createPollsRouter(io))
app.use('/api',                              createReadsRouter(io))
app.use('/api/dm', createDMRouter(io))
app.use('/api', createThreadsRouter(io))
app.use('/api/search', searchRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/push', pushRouter)
app.use('/api/gif',  gifRouter)
app.use('/api/servers', rolesRouter)
app.use('/api/servers', bansRouter)
app.use('/api',         notificationsRouter)
app.use('/api/bookmarks', bookmarksRouter)
app.use('/api/reminders', remindersRouter)
app.use('/api/translate', translateRouter)
app.use('/api/friends',   friendsRouter)
app.use('/api/voice',     voiceRouter)
app.use('/api/wishes',    wishesRouter)
app.use('/api/sessions',  sessionsRouter)
// Static files: serve uploads. Cache 1d (immutable nomes únicos)
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d', immutable: true, fallthrough: true }))

// Reactions: /api/channels/:channelId/messages/:messageId/react
app.use(
  '/api/channels/:channelId/messages/:messageId/react',
  createReactionsRouter(io)
)

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }))

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // HttpError → resposta estruturada com status correto e sem leak de stack
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.meta ? { meta: err.meta } : {}),
    })
  }

  const cause = err?.cause ?? err
  const dbInfo = cause !== err ? {
    code:       cause?.code,
    constraint: cause?.constraint,
    detail:     cause?.detail,
    table:      cause?.table,
    column:     cause?.column,
  } : null
  logger.error('Error', err?.message ?? 'unknown', err, dbInfo ?? '')

  // Reporta erros 5xx no Sentry com tags de contexto
  sentry.captureException(err, {
    tags: { route: req.route?.path ?? req.path, method: req.method, reqId: req.reqId ?? '' },
    user: req.userId ? { id: req.userId } : undefined,
  })

  if (env.NODE_ENV === 'production') return res.status(500).json({ error: 'Erro interno', reqId: req.reqId })
  res.status(500).json({
    error: err.message,
    cause: dbInfo ?? undefined,
    stack: err.stack,
    reqId: req.reqId,
  })
})

process.on('unhandledRejection', (r) => {
  logger.error('UnhandledRejection', String(r), r)
  sentry.captureException(r)
  process.exit(1)
})
process.on('uncaughtException', (e) => {
  logger.error('UncaughtException', String(e), e)
  sentry.captureException(e)
  process.exit(1)
})

httpServer.listen(env.PORT, async () => {
  logger.info('Astra API', `http://localhost:${env.PORT} (${env.NODE_ENV})`)
  await initBot()
  logger.info('Bot', 'Pronto.')
  startRetentionWorker()
  logger.info('Retention', 'Worker iniciado (1h)')
  startReminderWorker(io)
  logger.info('Reminders', 'Worker iniciado (30s)')
  initPush()
})
