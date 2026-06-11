import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/hooks/useViewTransitionNavigate'
import Sidebar from '@/components/layout/Sidebar'
import MobileBottomNav from '@/components/layout/MobileBottomNav'
import MobileMoreSheet from '@/components/layout/MobileMoreSheet'
import MobileNotificationsSheet from '@/components/notifications/MobileNotificationsSheet'
import MobileAvatarTrigger from '@/components/layout/MobileAvatarTrigger'
import AstraLogo from '@/components/AstraLogo'
import { Reveal } from '@/components/anim/Reveal'
import { PageTransition } from '@/components/anim/PageTransition'
import { AnimatePresence } from 'motion/react'
import { Pin, Search, Users as UsersIcon, Bookmark, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { useUIStore } from '@/store/uiStore'
import { hapticLight } from '@/lib/haptics'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useUnread } from '@/hooks/useUnread'
import type { ServerWithChannels } from '@astra/types'
import { usePresenceListener } from '@/hooks/usePresence'
import { useInAppNotifications } from '@/hooks/useInAppNotifications'
import MessageList from '@/components/chat/MessageList'
import MessageInput from '@/components/chat/MessageInput'
import TypingIndicator from '@/components/chat/TypingIndicator'
import ChannelNotifButton, { ChannelNotifMenuItems } from '@/components/chat/ChannelNotifButton'
import { ServerEmojiProvider } from '@/hooks/useServerEmojis'
import MentionBanner from '@/components/chat/MentionBanner'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import type { MessageWithAuthor } from '@astra/types'

// Lazy: páginas pesadas + componentes raros (settings, command palette, painéis com sheets)
// Carregam só quando o user de fato navega/abre.
// VoiceCallPanel/IncomingCallModal: carregam só quando voice tá configurado
// — economia de ~30KB no bundle inicial.
const VoiceCallPanel    = lazy(() => import('@/components/voice/VoiceCallPanel').then((m) => ({ default: m.VoiceCallPanel })))
const IncomingCallModal = lazy(() => import('@/components/voice/IncomingCallModal').then((m) => ({ default: m.IncomingCallModal })))
const DMPage              = lazy(() => import('@/pages/DMPage'))
const ProfilePage         = lazy(() => import('@/pages/ProfilePage'))
const SettingsPage        = lazy(() => import('@/pages/SettingsPage'))
const ServerSettingsPage  = lazy(() => import('@/pages/ServerSettingsPage'))
const CommandPalette      = lazy(() => import('@/components/CommandPalette'))
const PinnedMessagesSheet = lazy(() => import('@/components/chat/PinnedMessagesSheet'))
const RightPanel          = lazy(() => import('@/components/chat/RightPanel'))
const BookmarksSheet      = lazy(() => import('@/components/bookmarks/BookmarksSheet'))
const FriendsPage         = lazy(() => import('@/pages/FriendsPage'))
const CosmicOnboarding    = lazy(() => import('@/components/astra/CosmicOnboarding').then((m) => ({ default: m.CosmicOnboarding })))
const LatencyOverlay      = lazy(() => import('@/components/dev/LatencyOverlay').then((m) => ({ default: m.LatencyOverlay })))

type OptimisticMessage = MessageWithAuthor & { optimisticId?: string; isPending?: boolean }
interface ActiveChannel { id: string; name: string; serverId: string }

function ChannelView() {
  const location     = useLocation()
  const locationState = location.state as ActiveChannel | null
  const [activeChannel, setActiveChannel] = useState<ActiveChannel | null>(locationState ?? null)
  const openCommandPalette = useUIStore((s) => s.openCommandPalette)
  const openRightPanel     = useUIStore((s) => s.openRightPanel)
  const [pinnedOpen, setPinnedOpen]     = useState(false)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [replyingTo, setReplyingTo]     = useState<MessageWithAuthor | null>(null)

  // Reset reply target ao trocar de canal
  useEffect(() => { setReplyingTo(null) }, [activeChannel?.id])

  // Sync state quando location.state muda (Sidebar hoisted navega via state)
  useEffect(() => {
    if (locationState && locationState.id !== activeChannel?.id) {
      setActiveChannel(locationState)
    }
  }, [locationState, activeChannel?.id])

  const addOptimisticRef    = useRef<((msg: OptimisticMessage) => void) | null>(null)
  const removeOptimisticRef = useRef<((id: string) => void) | null>(null)

  const handleRegisterOptimistic = useCallback(
    (add: (m: OptimisticMessage) => void, remove: (id: string) => void) => {
      addOptimisticRef.current    = add
      removeOptimisticRef.current = remove
    }, []
  )
  const handleOptimisticMessage = useCallback((m: OptimisticMessage) => addOptimisticRef.current?.(m), [])
  const handleOptimisticFailed  = useCallback((id: string) => removeOptimisticRef.current?.(id), [])

  // When a mention notification is clicked, navigate to the mentioned channel
  const handleMentionNavigate = useCallback((channelId: string, channelName: string, serverId: string) => {
    setActiveChannel({ id: channelId, name: channelName, serverId })
  }, [])

  // Atalhos desktop (norma Discord): Alt+↑/↓ navega entre canais de texto
  // do servidor atual; Esc marca o canal como lido. Mesma query/cache do
  // Sidebar — custo zero de rede.
  const navigate = useViewTransitionNavigate()
  const unread   = useUnread()
  const { data: kbServers } = useQuery<ServerWithChannels[]>({
    queryKey: ['servers'],
    queryFn: async () => (await api.get('/api/servers')).data.data,
    staleTime: 5 * 60_000,
  })
  useEffect(() => {
    if (!activeChannel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const chans = kbServers
          ?.find((s) => s.id === activeChannel.serverId)
          ?.channels?.filter((c) => c.type === 'TEXT') ?? []
        const idx = chans.findIndex((c) => c.id === activeChannel.id)
        if (idx === -1 || chans.length < 2) return
        e.preventDefault()
        const dir  = e.key === 'ArrowDown' ? 1 : -1
        const next = chans[(idx + dir + chans.length) % chans.length]
        navigate('/app', { state: { id: next.id, name: next.name, serverId: activeChannel.serverId } })
      }
      // Esc marca lido — só quando não há overlay (Radix fecha com Esc antes)
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) {
        unread.markRead(activeChannel.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeChannel, kbServers, navigate, unread])

  return (
    <div className="flex-1 flex min-w-0 h-full min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {activeChannel ? (
          <>
            {/* Chat header — minimal, hairline bottom border */}
            <header
              key={activeChannel.id + '-hdr'}
              className="shrink-0 h-14 px-3 sm:px-5 flex items-center gap-2 border-b border-(--border) bg-(--base)"
            >
              {/* Mobile trigger: avatar abre sidebar */}
              <MobileAvatarTrigger className="-ml-1" />

              <span className="text-(--text-3) text-sm font-mono">#</span>
              <h2
                className="text-sm sm:text-base m-0 font-medium tracking-tight text-foreground truncate"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {activeChannel.name}
              </h2>

              {/* Right cluster: search · members · pinned */}
              <div className="ml-auto flex items-center gap-0.5 shrink-0">
                <button
                  onClick={openCommandPalette}
                  className="size-11 sm:size-8 flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
                  aria-label="Buscar (Ctrl+K)"
                  title="Buscar (Ctrl+K)"
                >
                  <Search className="size-4" />
                </button>
                {/* Desktop: 3 botões expostos */}
                <button
                  onClick={() => openRightPanel('members')}
                  className="size-8 hidden md:flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
                  aria-label="Membros e threads"
                  title="Membros e threads"
                >
                  <UsersIcon className="size-4" />
                </button>
                <button
                  onClick={() => setPinnedOpen(true)}
                  className="size-8 hidden md:flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
                  aria-label="Mensagens fixadas"
                  title="Mensagens fixadas"
                >
                  <Pin className="size-4" />
                </button>
                <button
                  onClick={() => setBookmarksOpen(true)}
                  className="size-8 hidden md:flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
                  aria-label="Mensagens salvas"
                  title="Mensagens salvas"
                >
                  <Bookmark className="size-4" />
                </button>
                <ChannelNotifButton channelId={activeChannel.id} />

                {/* Mobile: dropdown com Pin / Bookmark / Members */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="size-11 md:hidden flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
                      aria-label="Mais ações"
                    >
                      <MoreHorizontal className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => openRightPanel('members')}>
                      <UsersIcon className="size-3.5" /> Membros e threads
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPinnedOpen(true)}>
                      <Pin className="size-3.5" /> Mensagens fixadas
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setBookmarksOpen(true)}>
                      <Bookmark className="size-3.5" /> Mensagens salvas
                    </DropdownMenuItem>
                    {/* Notificações do canal — no desktop é o sino próprio */}
                    <ChannelNotifMenuItems channelId={activeChannel.id} />
                  </DropdownMenuContent>
                </DropdownMenu>

                <NotificationBell />
              </div>
            </header>

            {pinnedOpen && (
              <Suspense fallback={null}>
                <PinnedMessagesSheet
                  channelId={activeChannel.id}
                  channelName={activeChannel.name}
                  open={pinnedOpen}
                  onClose={() => setPinnedOpen(false)}
                />
              </Suspense>
            )}

            {bookmarksOpen && (
              <Suspense fallback={null}>
                <BookmarksSheet open={bookmarksOpen} onClose={() => setBookmarksOpen(false)} />
              </Suspense>
            )}

            <ServerEmojiProvider serverId={activeChannel.serverId}>
              <MessageList
                key={activeChannel.id}
                channelId={activeChannel.id}
                channelName={activeChannel.name}
                serverId={activeChannel.serverId}
                onRegisterOptimistic={handleRegisterOptimistic}
                onReply={setReplyingTo}
              />
              <TypingIndicator channelId={activeChannel.id} />
              <MessageInput
                channelId={activeChannel.id}
                channelName={activeChannel.name}
                serverId={activeChannel.serverId}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                onOptimisticMessage={handleOptimisticMessage}
                onOptimisticFailed={handleOptimisticFailed}
              />
            </ServerEmojiProvider>
          </>
        ) : (
          /* Asymmetric editorial layout: pavlivka — left margin reservado pra
             rótulo vertical / numeração; conteúdo ocupa coluna direita. */
          <div className="flex-1 relative overflow-hidden">
            <MobileAvatarTrigger className="absolute top-3 left-3 z-10" />

            {/* Vignette sutil */}
            <div className="ed-vignette" />

            <div className="absolute inset-0 grid grid-cols-12 gap-6 px-6 sm:px-12 py-16">
              <div className="col-span-12 md:col-span-7 md:col-start-4 flex flex-col justify-center max-w-[44ch]">
                <Reveal delay={0.05}>
                  <div className="anim-float mb-7">
                    <AstraLogo size={88} />
                  </div>
                </Reveal>

                <Reveal delay={0.18}>
                  <span className="ed-marg block mb-3">— Edição vazia</span>
                </Reveal>

                <Reveal delay={0.30}>
                  <h2 className="ed-h text-4xl sm:text-5xl m-0 mb-2 leading-[1.05]">
                    O silêncio
                  </h2>
                </Reveal>

                <Reveal delay={0.40}>
                  <h2 className="ed-h text-4xl sm:text-5xl m-0 italic text-(--accent) leading-[1.05]">
                    antes da conversa.
                  </h2>
                </Reveal>

                <Reveal delay={0.55}>
                  <div className="ed-hr-accent w-20 my-7" />
                </Reveal>

                <Reveal delay={0.65}>
                  <p className="ed-lede max-w-[34ch] m-0 text-(--text-2)">
                    Selecione uma órbita na lateral para entrar numa conversa, ou clique na lua para abrir seus sussurros.
                  </p>
                </Reveal>

                <Reveal delay={0.85}>
                  <p className="ed-marg mt-8">Atalho ⌘K · busca global</p>
                </Reveal>
              </div>

              {/* Margem direita — aside / margin note (negative space + serif renaissance) */}
              <div className="hidden lg:flex col-span-2 col-start-11 items-end pb-12">
                <Reveal delay={1.0}>
                  <p className="ed-aside max-w-[20ch]">
                    "Toda conversa começa com uma pausa — esta é a sua."
                  </p>
                </Reveal>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Global mention notification banner */}
      <MentionBanner onNavigate={handleMentionNavigate} />

      {/* Right panel (members + threads) — só faz sentido com canal ativo */}
      {activeChannel && (
        <Suspense fallback={null}>
          <RightPanel serverId={activeChannel.serverId} channelId={activeChannel.id} />
        </Suspense>
      )}
    </div>
  )
}

export default function AppPage() {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const activeId = (location.state as ActiveChannel | null)?.id ?? null
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)

  // Global presence socket listener + in-app sound/desktop notif
  usePresenceListener()
  useInAppNotifications()

  // Cmd+K / Ctrl+K abre command palette globalmente
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggleCommandPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCommandPalette])

  // Mobile: swipe pra ESQUERDA abre o drawer de constelações.
  // Direita ficou pro swipe-to-reply das mensagens — sem briga de gesto.
  // Listeners passivos + leitura via getState(): zero re-render por toque.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    let start: { x: number; y: number } | null = null
    const onStart = (e: TouchEvent) => {
      start = null
      if (window.innerWidth >= 768) return
      if (useUIStore.getState().mobileSidebarOpen) return
      // Áreas com gesto/scroll próprio não disputam
      if ((e.target as Element).closest('pre, input, textarea, [role="dialog"]')) return
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
    }
    const onMove = (e: TouchEvent) => {
      if (!start) return
      const t  = e.touches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      if (dx > 0 || Math.abs(dy) > 48) { start = null; return } // scroll/reply
      if (dx < -64 && -dx > Math.abs(dy) * 1.8) {
        start = null
        useUIStore.getState().openMobileSidebar()
        hapticLight()
      }
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove',  onMove,  { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove',  onMove)
    }
  }, [])

  return (
    <div className="astra-shell flex h-screen-safe overflow-hidden font-(family-name:--font-body) pb-14 md:pb-0">
      {/* A11y skip-link: invisível até receber foco (Tab). Pula sidebar/header
          pra usuários de teclado/screen reader irem direto pro conteúdo. */}
      <a
        href="#astra-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-9999 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-(--accent) focus:text-(--text-inv) focus:text-sm focus:font-medium focus:shadow-3"
      >
        Pular para o conteúdo
      </a>

      {/* Sidebar mounted once — sobrevive entre rotas, sem re-mount/animation bug */}
      <Sidebar
        activeChannelId={activeId}
        onSelectChannel={(id, name, serverId) =>
          navigate('/app', { state: { id, name, serverId } })
        }
      />

      {/* `display: contents` deixa o flex parent enxergar o PageTransition direto
          (não cria flex item adicional). Suportado em todos browsers modernos. */}
      <main id="astra-main" tabIndex={-1} className="contents">
        <Suspense fallback={<div className="flex-1 min-w-0 h-full" />}>
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={location} key={location.pathname.split('/').slice(0, 3).join('/')}>
              <Route path="dm/*"    element={<PageTransition className="flex-1 min-w-0 h-full"><DMPage /></PageTransition>} />
              <Route path="friends" element={<PageTransition><FriendsPage /></PageTransition>} />
              <Route path="profile" element={<PageTransition><ProfilePage /></PageTransition>} />
              <Route path="settings" element={<PageTransition><SettingsPage /></PageTransition>} />
              <Route path="servers/:serverId/settings" element={<PageTransition><ServerSettingsPage /></PageTransition>} />
              <Route path="*"       element={<PageTransition><ChannelView /></PageTransition>} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </main>

      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>

      {/* Voice call panel + incoming modal — lazy (-30kb no bundle inicial) */}
      <Suspense fallback={null}>
        <VoiceCallPanel />
        <IncomingCallModal />
      </Suspense>

      {/* Mobile-only: tab bar permanente no bottom + sheets "Mais"/notificações */}
      <MobileBottomNav />
      <MobileMoreSheet />
      <MobileNotificationsSheet />

      {/* Tour 1x: léxico cósmico de Astra (skip permanente após dispensar) */}
      <Suspense fallback={null}>
        <CosmicOnboarding />
      </Suspense>

      {/* Dev overlay: p50/p95 de round-trip de envio. Toggle Ctrl+Shift+L. */}
      <Suspense fallback={null}>
        <LatencyOverlay />
      </Suspense>
    </div>
  )
}