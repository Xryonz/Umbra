import { Capacitor } from '@capacitor/core'
import { completeOAuthLogin } from '@/lib/oauth'

/** true quando rodando dentro do app Capacitor (Android/iOS). */
export const isNative = Capacitor.isNativePlatform()

/**
 * Liga os listeners nativos do app. Chamado uma vez no main.tsx.
 * No web é no-op — e os plugins são dynamic import, então o bundle
 * web não paga o peso deles.
 *
 * Cobre os dois P0 de UX nativa:
 *  1. appUrlOpen — deep link astra://auth/callback#refresh=<token> que o
 *     backend manda após OAuth na Custom Tab (Google bloqueia OAuth em
 *     WebView embarcado, então o login acontece fora do app).
 *  2. backButton — botão/gesto voltar do Android. Sem handler o app FECHA.
 *     Ordem: fecha dialog aberto → volta na história → minimiza app.
 */
export async function initNativeApp(): Promise<void> {
  if (!isNative) return

  const { App } = await import('@capacitor/app')

  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith('astra://')) return

    // Fecha a Custom Tab/Safari View que sobrou do OAuth
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.close()
    } catch { /* Android Custom Tab fecha sozinha — close() pode lançar */ }

    if (url.startsWith('astra://auth/callback')) {
      const fragment = url.split('#')[1] ?? ''
      const refresh  = new URLSearchParams(fragment).get('refresh')
      if (!refresh) { window.location.href = '/login?error=oauth_failed'; return }
      try {
        await completeOAuthLogin(refresh)
        window.location.href = '/app'
      } catch {
        window.location.href = '/login?error=oauth_failed'
      }
      return
    }

    if (url.startsWith('astra://login')) {
      // Backend redirecionou erro de OAuth pro app (ex: email não registrado)
      const query = url.split('?')[1] ?? ''
      window.location.href = query ? `/login?${query}` : '/login'
    }
  })

  App.addListener('backButton', ({ canGoBack }) => {
    // Radix dialogs/sheets fecham com Escape — back físico deve agir igual
    const openOverlay = document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    )
    if (openOverlay) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (canGoBack) {
      window.history.back()
    } else {
      // Raiz do app: minimiza (comportamento padrão Android) em vez de matar
      void App.minimizeApp()
    }
  })
}

/**
 * Abre o login Google. Web: redirect normal. Nativo: Custom Tab (Android) /
 * Safari View (iOS) com ?platform=mobile — o backend devolve pro deep link.
 */
export async function openGoogleLogin(): Promise<void> {
  const base = `${import.meta.env.VITE_API_URL}/api/auth/google`
  if (!isNative) {
    window.location.href = base
    return
  }
  const { Browser } = await import('@capacitor/browser')
  await Browser.open({ url: `${base}?platform=mobile` })
}
