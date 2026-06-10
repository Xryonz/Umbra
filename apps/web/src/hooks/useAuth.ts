import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setStoredRefreshToken, clearStoredRefreshToken, getStoredRefreshToken } from '@/lib/api'
import { connectSocket, disconnectSocket } from '@/lib/socket'
import { completeOAuthLogin } from '@/lib/oauth'
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
  // Lógica em lib/oauth.ts — compartilhada com o deep link do app nativo.
  const handleOAuthCallback = useCallback(
    (refreshToken: string) => completeOAuthLogin(refreshToken),
    [],
  )

  return { user, isAuthenticated, login, register, logout, handleOAuthCallback }
}
