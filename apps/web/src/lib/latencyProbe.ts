/**
 * latencyProbe — instrumenta round-trip de envio de mensagem.
 *
 * Fluxo medido: cliente chama probeStart(nonce) ao iniciar POST →
 * server processa e emite 'new_message' com mesmo clientNonce →
 * useSocket handler chama probeEnd(nonce) ao receber de volta.
 *
 * Mantém ring buffer dos últimos N samples pra p50/p95. Expõe em
 * dev via window.__astraLatency.summary().
 *
 * Em prod, samples ainda são coletados (custo zero, ~Float64 por
 * sample) mas nada é loggado por padrão. Use o summary manualmente
 * pra debug ad-hoc.
 */
const STARTS = new Map<string, number>()
const RING_SIZE = 200
const samples: number[] = []
let ringIdx = 0

export function probeStart(nonce: string): void {
  if (!nonce) return
  STARTS.set(nonce, performance.now())
}

export function probeEnd(nonce?: string | null): number | null {
  if (!nonce) return null
  const t = STARTS.get(nonce)
  if (t == null) return null
  STARTS.delete(nonce)
  const dt = performance.now() - t
  if (samples.length < RING_SIZE) samples.push(dt)
  else { samples[ringIdx] = dt; ringIdx = (ringIdx + 1) % RING_SIZE }
  return dt
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

export function latencySummary(): { count: number; p50: number; p95: number; p99: number; mean: number } {
  if (samples.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, mean: 0 }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  return {
    count: samples.length,
    p50:   Math.round(percentile(samples, 0.5)),
    p95:   Math.round(percentile(samples, 0.95)),
    p99:   Math.round(percentile(samples, 0.99)),
    mean:  Math.round(mean),
  }
}

// Dev: expor pra console (window.__astraLatency.summary() em DevTools).
if (typeof window !== 'undefined') {
  ;(window as unknown as { __astraLatency: { summary: typeof latencySummary } }).__astraLatency = {
    summary: latencySummary,
  }
}
