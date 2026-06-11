/**
 * Cache offline mínimo: persiste servers + lista de DMs no localStorage.
 * Abrir o app sem rede (metrô, elevador) mostra o shell imediatamente;
 * com rede, hydrate entra como STALE (updatedAt: 0) → refetch imediato
 * por trás (stale-while-revalidate).
 *
 * De propósito NÃO persiste mensagens: volume grande pede IndexedDB —
 * fica pra uma sessão dedicada (ver MOBILE.md).
 */
import type { QueryClient } from '@tanstack/react-query'

const KEY = 'astra-offline-cache-v1'
const PERSIST_KEYS = ['servers', 'dm-list'] as const

export function setupOfflineCache(qc: QueryClient): void {
  // Hydrate no boot
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>
      for (const k of PERSIST_KEYS) {
        if (saved[k] !== undefined) qc.setQueryData([k], saved[k], { updatedAt: 0 })
      }
    }
  } catch { /* cache corrompido — ignora, rede resolve */ }

  // Persiste com throttle de 1s — o subscribe dispara em rajadas
  let timer: number | null = null
  qc.getQueryCache().subscribe(() => {
    if (timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      try {
        const out: Record<string, unknown> = {}
        for (const k of PERSIST_KEYS) {
          const data = qc.getQueryData([k])
          if (data !== undefined) out[k] = data
        }
        localStorage.setItem(KEY, JSON.stringify(out))
      } catch { /* quota cheia — sem cache, sem crash */ }
    }, 1000)
  })
}

/** Logout: limpa o snapshot — outro user no mesmo device não vê o anterior. */
export function clearOfflineCache(): void {
  try { localStorage.removeItem(KEY) } catch {}
}
