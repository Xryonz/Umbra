/**
 * Migra chaves `umbra-*` legadas para `astra-*` (rebrand).
 *
 * Roda 1x no boot, antes de qualquer leitura de tema/refresh/etc. Idempotente:
 * só copia se a chave nova ainda não existe (preserva mudanças pós-rebrand).
 * Remove a chave antiga depois pra não inflar storage.
 */
const LOCAL_KEYS: Record<string, string> = {
  'umbra-accent':            'astra-accent',
  'umbra-bg':                'astra-bg',
  'umbra-refresh':           'astra-refresh',
  'umbra-voice-volume':      'astra-voice-volume',
  'umbra-voice-pip-pos':     'astra-voice-pip-pos',
  'umbra-incoming-pos':      'astra-incoming-pos',
  'umbra-sound':             'astra-sound',
  'umbra-sidebar-collapsed': 'astra-sidebar-collapsed',
}

// sessionStorage é efêmero, mas dentro da MESMA sessão (Ctrl+R p.ex.)
// queremos preservar o auth state que existia antes do deploy do rebrand.
const SESSION_KEYS: Record<string, string> = {
  'umbra-auth': 'astra-auth',
}

function migrate(store: Storage, map: Record<string, string>) {
  for (const [oldKey, newKey] of Object.entries(map)) {
    const old = store.getItem(oldKey)
    if (old === null) continue
    if (store.getItem(newKey) === null) store.setItem(newKey, old)
    store.removeItem(oldKey)
  }
}

export function migrateLocalStorage(): void {
  try { migrate(localStorage,   LOCAL_KEYS)   } catch {}
  try { migrate(sessionStorage, SESSION_KEYS) } catch {}
}
