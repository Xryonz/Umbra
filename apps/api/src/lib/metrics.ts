/**
 * Métricas Prometheus.
 *
 * - Default metrics (process_cpu, heap, event_loop_lag, etc) via prom-client
 * - Custom counters/histograms pra app-level: requests, errors, socket, bot, mensagens
 *
 * Endpoint /metrics fica protegido por METRICS_TOKEN (Bearer). Sem token, /metrics
 * fica off em produção; em dev/test fica livre pra facilitar scrape local.
 *
 * Convenção de naming: snake_case, sufixo _total pra counters, _ms/_bytes pra unidades.
 */
import client from 'prom-client'

export const registry = new client.Registry()
registry.setDefaultLabels({ service: 'astra-api' })
client.collectDefaultMetrics({ register: registry })

// ── HTTP ─────────────────────────────────────────────────────────
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
})

export const httpDurationMs = new client.Histogram({
  name: 'http_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status'] as const,
  // Buckets editoriais: <5ms (cache), <50ms (db rápido), <500ms (rota normal), >1s (lento)
  buckets: [5, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
})

// ── Sockets ──────────────────────────────────────────────────────
export const socketConnections = new client.Gauge({
  name: 'socket_active_connections',
  help: 'Sockets atualmente conectados',
  registers: [registry],
})

export const socketEventsTotal = new client.Counter({
  name: 'socket_events_total',
  help: 'Eventos socket recebidos/enviados',
  labelNames: ['event', 'direction'] as const, // direction = in|out
  registers: [registry],
})

// ── Domínio ──────────────────────────────────────────────────────
export const messagesSentTotal = new client.Counter({
  name: 'messages_sent_total',
  help: 'Mensagens criadas (channel + DM)',
  labelNames: ['kind'] as const, // channel|dm|thread
  registers: [registry],
})

export const botInvocationsTotal = new client.Counter({
  name: 'bot_invocations_total',
  help: 'Chamadas ao bot Claude',
  labelNames: ['status'] as const, // ok|tool_loop|error|rate_limited
  registers: [registry],
})

export const botTokensTotal = new client.Counter({
  name: 'bot_tokens_total',
  help: 'Tokens consumidos pelo bot',
  labelNames: ['kind'] as const, // input|output|cache_read|cache_write
  registers: [registry],
})

export const dbQueryDurationMs = new client.Histogram({
  name: 'db_query_duration_ms',
  help: 'Duração de queries DB críticas',
  labelNames: ['op'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
})

/** Helper: cronometra uma função e registra no histogram. */
export async function timed<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const end = dbQueryDurationMs.startTimer({ op })
  try { return await fn() }
  finally { end() }
}

/** Render do registry pro endpoint /metrics. */
export async function renderMetrics(): Promise<string> {
  return registry.metrics()
}

export function metricsContentType(): string {
  return registry.contentType
}
