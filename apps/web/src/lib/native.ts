import { Capacitor } from '@capacitor/core'
import { completeOAuthLogin } from '@/lib/oauth'

/** true quando rodando dentro do app Capacitor (Android/iOS). */
export const isNative = Capacitor.isNativePlatform()

const STATIC_SHORTCUTS = [
  { id: 'dms',     title: 'Sussurros', description: 'Mensagens diretas' },
  { id: 'friends', title: 'Amigos',    description: 'Sua constelação de amigos' },
]

/**
 * App Shortcuts dinâmicos: long-press no ícone mostra as DMs recentes
 * acima dos atalhos fixos. Chamado quando a lista de conversas carrega
 * (DMList). No-op no web / se o plugin faltar.
 */
export function setDmShortcuts(dms: { id: string; title: string }[]): void {
  if (!isNative || dms.length === 0) return
  void import('@capawesome/capacitor-app-shortcuts')
    .then(({ AppShortcuts }) => AppShortcuts.set({
      shortcuts: [
        ...dms.slice(0, 3).map((d) => ({
          id: `dm-${d.id}`,
          title: d.title,
          description: 'Conversa recente',
        })),
        ...STATIC_SHORTCUTS,
      ],
    }))
    .catch(() => {})
}

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

  // Marca o <html> pra CSS nativo-only (ex: respiro extra no topo do shell)
  document.documentElement.classList.add('astra-native')

  // Capgo: confirma que o bundle abriu são — sem isso, um live update
  // aplicado sofre rollback automático no boot seguinte. Inofensivo
  // enquanto autoUpdate está off (capacitor.config.ts).
  void import('@capgo/capacitor-updater')
    .then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady())
    .catch(() => {})

  // Fallback do splash nativo (launchAutoHide: false): se o SplashScreen
  // web não montar em 4s (erro de JS, ErrorBoundary), esconde mesmo assim
  // — splash preso é pior que flash de transição. hide() é idempotente.
  setTimeout(() => {
    void import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 200 }))
      .catch(() => {})
  }, 4000)

  // Teclado: resize 'native' re-layouta o WebView a cada frame da animação
  // do teclado — com transições CSS ativas, cada frame vira tween conflitando
  // com layout (jank pesado). Congela animações durante o resize: o layout
  // assenta seco e o teclado desliza liso. Classe consumida no index.css.
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    const root = document.documentElement
    const freeze   = () => root.classList.add('astra-kb-resizing')
    const unfreeze = () => root.classList.remove('astra-kb-resizing')
    // astra-kb-open: tab bar some + respiro zera enquanto digita (CSS) —
    // sem isso sobrava uma faixa morta entre o composer e o teclado.
    void Keyboard.addListener('keyboardWillShow', () => { freeze(); root.classList.add('astra-kb-open') })
    void Keyboard.addListener('keyboardDidShow', () => {
      unfreeze()
      // MessageList escuta: se estava perto do fim, gruda no fim de novo
      // (sem isso a última mensagem some atrás do composer).
      window.dispatchEvent(new Event('astra:kb-shown'))
    })
    void Keyboard.addListener('keyboardWillHide', () => { freeze(); root.classList.remove('astra-kb-open') })
    void Keyboard.addListener('keyboardDidHide', unfreeze)
  } catch { /* plugin ausente */ }

  // App Shortcuts: long-press no ícone do Astra → atalhos diretos.
  // Estáticos no boot; setDmShortcuts() injeta DMs recentes quando a
  // lista carrega (ids dm-<convId> → rota deep /app/dm/:id).
  try {
    const { AppShortcuts } = await import('@capawesome/capacitor-app-shortcuts')
    await AppShortcuts.set({ shortcuts: STATIC_SHORTCUTS })
    await AppShortcuts.addListener('click', ({ shortcutId }) => {
      if (shortcutId === 'dms')     window.location.href = '/app/dm'
      if (shortcutId === 'friends') window.location.href = '/app/friends'
      if (shortcutId.startsWith('dm-')) window.location.href = `/app/dm/${shortcutId.slice(3)}`
    })
  } catch { /* plugin ausente */ }

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
 * PiP (Picture-in-Picture): liga/desliga a flag que o MainActivity lê em
 * onUserLeaveHint — quando o user sai do app com vídeo rolando na call,
 * o app encolhe pra um quadro flutuante em vez de sumir. Plugin inline
 * (PipPlugin.java); falha silenciosa em builds sem ele.
 */
let lastPip = false
export function setPipEnabled(enabled: boolean): void {
  if (!isNative || enabled === lastPip) return
  lastPip = enabled
  void import('@capacitor/core')
    .then(({ registerPlugin }) => {
      const AstraPip = registerPlugin<{ setEnabled(o: { enabled: boolean }): Promise<void> }>('AstraPip')
      return AstraPip.setEnabled({ enabled })
    })
    .catch(() => { lastPip = false })
}

/**
 * Call em background: liga/desliga o CallService (foreground service +
 * notificação "Em chamada"). Sem ele o Android congela o WebView ao sair
 * do app e a call de áudio cai. voiceStore chama ao entrar/sair de call.
 */
let lastCallActive = false
export function setCallActive(active: boolean): void {
  if (!isNative || active === lastCallActive) return
  lastCallActive = active
  void import('@capacitor/core')
    .then(({ registerPlugin }) => {
      const Svc = registerPlugin<{ setActive(o: { active: boolean }): Promise<void> }>('AstraCallService')
      return Svc.setActive({ active })
    })
    .catch(() => { lastCallActive = false })
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
 *
 * O link é o /i/:code da API (não o /invite do site): só ele serve as
 * OG tags por convite — o card bonito no WhatsApp. Ele redireciona
 * humanos pro site na hora.
 */
export async function shareInvite(code: string): Promise<'shared' | 'copied'> {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  const url = apiUrl ? `${apiUrl}/i/${code}` : `${SITE_URL}/invite/${code}`
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
