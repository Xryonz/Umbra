import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setStoredRefreshToken, clearStoredRefreshToken, getStoredRefreshToken } from '@/lib/api'
import { connectSocket, disconnectSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/authStore'
import type { LoginInput, RegisterInput } from '@astra/types'

export function useAuth() {
  const navigate = useNavigate()
  const { setAuth, logout: clearAuth, user, isAuthenticated } = useAuthStore()

  const login = useCallback(async (data: LoginInput) => {
    const res = await api.post('/api/auth/login', data)
    const { user, accessToken, refreshToken } = res.data.data
    setStoredRefreshToken(refreshToken)
    setAuth(user, accessToken)
    connectSocket()
    navigate('/app')
  }, [setAuth, navigate])

  const register = useCallback(async (data: RegisterInput) => {
    const res = await api.post('/api/auth/register', data)
    const { user, accessToken, refreshToken } = res.data.data
    setStoredRefreshToken(refreshToken)
    setAuth(user, accessToken)
    connectSocket()
    navigate('/app')
  }, [setAuth, navigate])

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken()
    try {
      await api.post('/api/auth/logout', { refreshToken })
    } catch {
      // Mesmo com erro, limpa estado local
    } finally {
      clearStoredRefreshToken()
      disconnectSocket()
      clearAuth()
      navigate('/login')
    }
  }, [clearAuth, navigate])

  // Após callback OAuth, o backend redirecionou com #refresh=<token> na hash.
  // Extraímos, salvamos em localStorage e fazemos refresh pra access token.
  const handleOAuthCallback = useCallback(async (refreshToken: string) => {
    setStoredRefreshToken(refreshToken)
    const refreshRes = await api.post('/api/auth/refresh', {}, {
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
    const newAccess  = refreshRes.data.data.accessToken
    const newRefresh = refreshRes.data.data.refreshToken
    setStoredRefreshToken(newRefresh)
    useAuthStore.getState().setAccessToken(newAccess)

    const meRes = await api.get('/api/auth/me')
    setAuth(meRes.data.data.user, newAccess)
    connectSocket()
  }, [setAuth])

  return { user, isAuthenticated, login, register, logout, handleOAuthCallback }
}
