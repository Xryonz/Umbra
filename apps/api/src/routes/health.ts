/**
 * Health endpoints — convenção Kubernetes-style:
 *  - /live   liveness: processo respira (sempre 200 se Node tá vivo)
 *  - /ready  readiness: DB + Redis respondem; 503 se algo falha
 *  - /health legado: equivalente a /ready
 *  - /metrics Prometheus scrape (protegido por METRICS_TOKEN)
 *
 * Liveness != Readiness intencionalmente: orquestrador não deve
 * reiniciar o pod só porque o Redis tá lento; deve só tirar do LB.
 */
import { Router } from 'express'
import { pool } from '../db'
import { redis } from '../lib/redis'
import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { renderMetrics, metricsContentType } from '../lib/metrics'

const PING_TIMEOUT_MS = 1500

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)),
  ])
}

async function checkDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now()
  try {
    await withTimeout(pool.query('SELECT 1'), PING_TIMEOUT_MS, 'db')
    return { ok: true, latencyMs: Date.now() - start }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown' }
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now()
  try {
    await withTimeout(redis.ping().then(() => undefined), PING_TIMEOUT_MS, 'redis')
    return { ok: true, latencyMs: Date.now() - start }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown' }
  }
}

export const healthRouter = Router()

healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

healthRouter.get(['/health', '/ready'], async (_req, res) => {
  const [db, rd] = await Promise.all([checkDb(), checkRedis()])
  const ok = db.ok && rd.ok
  res.status(ok ? 200 : 503).json({
    status:    ok ? 'ok' : 'degraded',
    ts:        new Date().toISOString(),
    uptimeS:   Math.round(process.uptime()),
    release:   env.RELEASE ?? null,
    voiceCfg:  !!env.LIVEKIT_URL,
    checks:    { db, redis: rd },
  })
})

healthRouter.get('/metrics', async (req, res) => {
  // Proteção: em prod exige Bearer; em dev/test fica livre pra scrape local
  if (env.NODE_ENV === 'production') {
    if (!env.METRICS_TOKEN) {
      return res.status(404).json({ error: 'metrics disabled' })
    }
    const auth = req.header('authorization') ?? ''
    if (auth !== `Bearer ${env.METRICS_TOKEN}`) {
      return res.status(401).json({ error: 'unauthorized' })
    }
  }
  try {
    res.setHeader('content-type', metricsContentType())
    res.send(await renderMetrics())
  } catch (e: any) {
    logger.error('Metrics', 'render fail', e)
    res.status(500).json({ error: 'metrics render failed' })
  }
})
