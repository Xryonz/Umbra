import { api, setStoredRefreshToken } from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/authStore'

/**
 * Completa o login OAuth a partir do refresh token entregue pelo backend
 * (hash fragment no web, deep link astra:// no app nativo).
 * Module-level pra ser chamável fora de React (listener appUrlOpen do
 * Capacitor) — useAuth.handleOAuthCallback delega pra cá.
 */
export async function completeOAuthLogin(refreshToken: string): Promise<void> {
  setStoredRefreshToken(refreshToken)
  const refreshRes = await api.post('/api/auth/refresh', {}, {
    headers: { Authorization: `Bearer ${refreshToken}` },
  })
  const newAccess  = refreshRes.data.data.accessToken
  const newRefresh = refreshRes.data.data.refreshToken
  setStoredRefreshToken(newRefresh)
  useAuthStore.getState().setAccessToken(newAccess)

  const meRes = await api.get('/api/auth/me')
  useAuthStore.getState().setAuth(meRes.data.data.user, newAccess)
  connectSocket()
}
