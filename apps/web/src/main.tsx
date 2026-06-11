import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { restoreTheme } from '@/lib/theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import { initSentry } from '@/lib/sentry'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { migrateLocalStorage } from '@/lib/migrateLocalStorage'
import { setupOfflineCache } from '@/lib/offlineCache'
import { initNativeApp } from '@/lib/native'

migrateLocalStorage()  // rebrand umbra-* → astra-*
initSentry()
restoreTheme()
void initNativeApp()   // no-op no web; app nativo: deep links + back button

// Preconnect pra API/WS — abre conexão TCP+TLS o quanto antes (~150ms
// de economia na 1ª chamada). API URL só existe via env, então injeta
// runtime em vez de hardcode no HTML.
const apiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined
if (apiUrl && /^https?:/.test(apiUrl)) {
  try {
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = apiUrl
    link.crossOrigin = ''
    document.head.appendChild(link)
  } catch {}
}

// Registra SW pra cache de assets + offline fallback. Em dev pulamos
// (Vite serve direto, SW atrapalha HMR). Em prod, SW também escuta push
// — registro idempotente compartilhado com usePushNotifications.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale-while-revalidate global. 60s é o sweet spot: rápido o suficiente
      // pra UI mostrar mudanças que vieram fora de banda (ex.: amigo aceitou
      // pedido em outro device), mas longo o suficiente pra não saturar a API
      // em navegação rápida. Cada query crítica override pra valor próprio.
      staleTime:          60 * 1000,
      gcTime:             10 * 60 * 1000,
      retry:              1,
      refetchOnWindowFocus: false,
      refetchOnReconnect:   'always',
    },
  },
})

// Offline-first leve: servers + DMs hidratam do localStorage no boot
// (shell instantâneo sem rede) e revalidam por trás.
setupOfflineCache(queryClient)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <App />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
