import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UserPublic } from '@astra/types'
import { sentry } from '@/lib/sentry'

export type { UserPublic }

interface AuthState {
  user:            UserPublic | null
  accessToken:     string | null
  isAuthenticated: boolean

  setAuth:        (user: UserPublic, accessToken: string) => void
  setAccessToken: (token: string) => void
  updateUser:     (patch: Partial<UserPublic>) => void
  logout:         () => void
}

// O accessToken NUNCA é persistido em storage (vulnerável a XSS).
// Ele vive só em memória; em cold load chamamos /api/auth/refresh
// (que usa o cookie httpOnly) para obter um novo.
//
// Só `user` e `isAuthenticated` são persistidos — para evitar uma
// flicker de login durante o bootstrap.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:            null,
      accessToken:     null,
      isAuthenticated: false,

      setAuth: (user, accessToken) => {
        sentry.setUser(user.id)
        set({ user, accessToken, isAuthenticated: true })
      },

      setAccessToken: (accessToken) => set({ accessToken }),

      updateUser: (patch) =>
        set((s) => ({ user: s.user ? { ...s.user, ...patch } : s.user })),

      logout: () => {
        sentry.setUser(null)
        set({ user: null, accessToken: null, isAuthenticated: false })
      },
    }),
    {
      name:    'astra-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        user:            s.user,
        isAuthenticated: s.isAuthenticated,
      }),
    }
  )
)