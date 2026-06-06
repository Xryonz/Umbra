import axios from 'axios'
import { useAuthStore } from '@/store/authStore'
import { connectSocket } from '@/lib/socket'
import { getStoredRefreshToken, setStoredRefreshToken, clearStoredRefreshToken, api } from '@/lib/api'
import { applyTheme } from '@/lib/theme'

/**
 * Em cold load, tenta restaurar sessão usando refreshToken de localStorage.
 *
 * Refresh token (localStorage) é a fonte de verdade — persiste mesmo quando
 * sessionStorage é limpo (fechou browser, nova aba). Se POST /refresh OK,
 * busca user em /me e reativa auth completo. Antes o bootstrap dava early-
 * return em !isAuthenticated (sessionStorage), o que quebrava auto-login
 * em qualquer reabrir de navegador.
 *
 * Dedup em nível de módulo: refresh é rotacionado a cada uso, então
 * chamar 2x em paralelo (StrictMode) quebraria a segunda chamada.
 */
let inFlight: Promise<boolean> | null = null

export function bootstrapAuth(): Promise<boolean> {
  if (inFlight) return inFlight
  inFlight = doBootstrap().finally(() => { inFlight = null })
  return inFlight
}

async function doBootstrap(): Promise<boolean> {
  const { accessToken } = useAuthStore.getState()
  if (accessToken) return true

  const storedRefresh = getStoredRefreshToken()
  if (!storedRefresh) {
    useAuthStore.getState().logout()
    return false
  }

  try {
    const apiUrl = import.meta.env.VITE_API_URL
    const { data: refreshData } = await axios.post(
      `${apiUrl}/api/auth/refresh`,
      {},
      { headers: { Authorization: `Bearer ${storedRefresh}` } }
    )
    const newAccess  = refreshData.data.accessToken
    const newRefresh = refreshData.data.refreshToken
    setStoredRefreshToken(newRefresh)

    // Se sessionStorage ainda tem o user (mesma aba) usa direto; senão GET /me.
    const cachedUser = useAuthStore.getState().user
    if (cachedUser) {
      useAuthStore.getState().setAuth(cachedUser, newAccess)
    } else {
      const { data: meData } = await axios.get(`${apiUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${newAccess}` },
      })
      useAuthStore.getState().setAuth(meData.data.user, newAccess)
    }

    try { connectSocket() } catch { /* ignore */ }
    void syncPreferencesFromServer()
    return true
  } catch {
    clearStoredRefreshToken()
    useAuthStore.getState().logout()
    return false
  }
}

// ── Preferências cross-device ─────────────────────────────────
// Fluxo: GET /preferences. Se server tem accent/bg → aplica (vence localStorage).
// Se server vazio → push localStorage como 1ª sync. Idempotente.
async function syncPreferencesFromServer() {
  try {
    const { data } = await api.get('/api/profile/preferences')
    const prefs = data?.data?.preferences ?? {}
    const accent = typeof prefs.accent === 'string' ? prefs.accent : null
    const bg     = typeof prefs.bg     === 'string' ? prefs.bg     : null

    if (accent || bg) {
      applyTheme(
        accent ?? localStorage.getItem('astra-accent') ?? localStorage.getItem('umbra-accent') ?? 'gold',
        bg     ?? localStorage.getItem('astra-bg')     ?? localStorage.getItem('umbra-bg')     ?? 'void',
      )
    } else {
      // 1º login: server vazio, empurra o que está local.
      const localAccent = localStorage.getItem('astra-accent') ?? localStorage.getItem('umbra-accent')
      const localBg     = localStorage.getItem('astra-bg')     ?? localStorage.getItem('umbra-bg')
      if (localAccent || localBg) {
        await api.patch('/api/profile/preferences', {
          preferences: { accent: localAccent ?? 'gold', bg: localBg ?? 'void' },
        })
      }
    }
  } catch { /* sem internet / endpoint 404 — fica com local mesmo */ }
}
