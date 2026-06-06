import { z } from 'zod'

/**
 * Valida todas as variáveis de ambiente no startup.
 * O processo trava imediatamente se algo estiver faltando ou inválido —
 * melhor falhar rápido do que ter comportamento imprevisível em produção.
 */
const EnvSchema = z.object({
  // Server
  NODE_ENV:  z.enum(['development', 'production', 'test']).default('development'),
  PORT:      z.coerce.number().default(3001),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL válida'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL deve ser uma URL válida').default('redis://localhost:6379'),

  // JWT — exige segredos fortes em produção
  JWT_ACCESS_SECRET:  z.string().min(32, 'JWT_ACCESS_SECRET deve ter ao menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET deve ter ao menos 32 caracteres'),

  // OAuth
  GOOGLE_CLIENT_ID:     z.string().min(1, 'GOOGLE_CLIENT_ID obrigatório'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET obrigatório'),

  // CORS / Client
  CLIENT_URL: z.string().url('CLIENT_URL deve ser uma URL válida'),
  API_URL:    z.string().url('API_URL deve ser uma URL válida').optional(),

  // Bot (opcional — bot fica em modo "fallback" sem a chave)
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Web Push (opcional — push notifications desligadas sem essas keys)
  // Gerar com: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY:  z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT:     z.string().default('mailto:dev@astra.local'),

  // Giphy GIF API (opcional — picker de GIF fica desligado sem key)
  // Grátis em developers.giphy.com → Create an App → tipo API
  GIPHY_API_KEY: z.string().optional(),

  // Observabilidade (todos opcionais — degrada bonito sem)
  SENTRY_DSN:           z.string().url().optional(),
  SENTRY_TRACES_SAMPLE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_ENVIRONMENT:   z.string().optional(),
  // Token simples pra proteger /metrics — se não setado, /metrics fica off em prod
  METRICS_TOKEN:        z.string().optional(),
  LOG_LEVEL:            z.enum(['debug', 'info', 'warn', 'error']).optional(),
  // Releases pra Sentry (commit SHA / tag) — opcional
  RELEASE:              z.string().optional(),

  // LiveKit (voice/video) — opcional. Sem isso, chamadas ficam desabilitadas.
  LIVEKIT_URL:          z.string().url().optional(),
  LIVEKIT_API_KEY:      z.string().optional(),
  LIVEKIT_API_SECRET:   z.string().optional(),
})

const result = EnvSchema.safeParse(process.env)

if (!result.success) {
  console.error('\n[ENV] ❌ Variáveis de ambiente inválidas:\n')
  result.error.issues.forEach((issue) => {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`)
  })
  console.error('\nVerifique o arquivo .env e reinicie o servidor.\n')
  process.exit(1)
}

export const env = result.data