import axios from 'axios'
import { useAuthStore } from '@/store/authStore'
import { sentry } from '@/lib/sentry'

const API_URL = (import.meta as any).env?.VITE_API_URL ?? ''
export const apiBaseUrl = API_URL
/** Resolve uma URL relativa (ex. "/uploads/abc.png") pro endpoint do backend. */
export const resolveApiUrl = (url: string) =>
  url.startsWith('http') || url.startsWith('data:') ? url : `${API_URL}${url}`

const REFRESH_KEY = 'astra-refresh'
export const getStoredRefreshToken = () => localStorage.getItem(REFRESH_KEY) || null
export const setStoredRefreshToken = (token: string) => localStorage.setItem(REFRESH_KEY, token)
export const clearStoredRefreshToken = () => localStorage.removeItem(REFRESH_KEY)

export const api = axios.create({ baseURL: API_URL })

// ── Interceptor de request: injeta access token ──────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Interceptor de response: renova token automaticamente ────
let isRefreshing = false
let pendingRequests: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

const REFRESH_TIMEOUT_MS = 8000

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retried) {
      originalRequest._retried = true

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingRequests.push({
            resolve: (token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`
              resolve(api(originalRequest))
            },
            reject,
          })
        })
      }

      const storedRefresh = getStoredRefreshToken()
      if (!storedRefresh) {
        useAuthStore.getState().logout()
        return Promise.reject(error)
      }

      isRefreshing = true

      try {
        const { data } = await axios.post(
          `${API_URL}/api/auth/refresh`,
          {},
          {
            headers: { Authorization: `Bearer ${storedRefresh}` },
            timeout: REFRESH_TIMEOUT_MS,
          }
        )
        const newAccess  = data.data.accessToken
        const newRefresh = data.data.refreshToken
        useAuthStore.getState().setAccessToken(newAccess)
        setStoredRefreshToken(newRefresh)

        pendingRequests.forEach((p) => p.resolve(newAccess))
        pendingRequests = []

        originalRequest.headers.Authorization = `Bearer ${newAccess}`
        return api(originalRequest)
      } catch (refreshError) {
        pendingRequests.forEach((p) => p.reject(refreshError))
        pendingRequests = []

        clearStoredRefreshToken()
        useAuthStore.getState().logout()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    const status = error.response?.status
    if (status && status >= 500) {
      sentry.captureException(error)
    }
    return Promise.reject(error)
  }
)
