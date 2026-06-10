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

  // Status bar na cor do void (era branca/default). Style.Dark = fundo
  // escuro com ícones claros. overlay:false reserva o espaço da status bar
  // — sem isso o WebView desenha POR BAIXO dela e os botões do topo do app
  // ficam cortados (Android edge-to-edge). Falha silenciosa se plugin faltar.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setBackgroundColor({ color: '#06060e' })
    await StatusBar.setStyle({ style: Style.Dark })
  } catch { /* plugin ausente — segue sem status bar custom */ }

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

/**
 * URL pública do site — pra links que saem do app (convites). No app
 * nativo, window.location.origin é https://localhost (WebView local),
 * que não serve pra ninguém. VITE_SITE_URL definida em .env.production.
 */
const SITE_URL: string =
  (import.meta.env.VITE_SITE_URL as string | undefined) ?? window.location.origin

/**
 * Compartilha um convite de constelação. Nativo: share sheet do OS
 * (WhatsApp, Telegram, etc.). Web: copia pro clipboard (comportamento
 * de sempre). Retorna o modo usado pro caller ajustar o feedback.
 */
export async function shareInvite(code: string): Promise<'shared' | 'copied'> {
  const url = `${SITE_URL}/invite/${code}`
  if (isNative) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: 'Convite pra constelação no Astra', url })
      return 'shared'
    } catch { /* user cancelou o sheet ou plugin ausente — cai pro clipboard */ }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}
