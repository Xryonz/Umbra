/**
 * MobileBottomNav — barra fixa no bottom (md:hidden) com 5 tabs.
 *
 *  🌌 Constelações  → abre o Sidebar drawer (servers + canais)
 *  ✦ Estrelas       → /app/dm
 *  👥 Amigos        → /app/friends
 *  🔔 Notif         → mantém NotificationBell trigger
 *  ⋯ Mais           → Sheet com perfil/settings/logout
 *
 * Posição: fixed bottom + safe-area-inset. Conteúdo das pages tem pb-16.
 * z-index 30 — abaixo de modais/sheets (40+) mas acima de conteúdo normal.
 */
import { useLocation } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/hooks/useViewTransitionNavigate'
import { Sparkles, Users, MoreHorizontal, Bell } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useNotificationCount } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils'

/** Glyph custom: 3 pontos conectados — "constelação". Lucide não tem. */
function ConstellationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20" height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="6" y1="7" x2="13" y2="11" />
      <line x1="13" y1="11" x2="18" y2="6" />
      <line x1="13" y1="11" x2="10" y2="18" />
      <circle cx="6"  cy="7"  r="1.6" fill="currentColor" />
      <circle cx="13" cy="11" r="1.8" fill="currentColor" />
      <circle cx="18" cy="6"  r="1.4" fill="currentColor" />
      <circle cx="10" cy="18" r="1.4" fill="currentColor" />
    </svg>
  )
}

interface Tab {
  id:      string
  label:   string
  icon:    React.ReactNode
  onClick: () => void
  active:  boolean
  badge?:  number
}

export default function MobileBottomNav() {
  const navigate         = useViewTransitionNavigate()
  const location         = useLocation()
  const sidebarOpen      = useUIStore((s) => s.mobileSidebarOpen)
  const toggleSidebar    = useUIStore((s) => s.toggleMobileSidebar)
  const closeSidebar     = useUIStore((s) => s.closeMobileSidebar)
  const setMoreOpen      = useUIStore((s) => s.setMobileMoreOpen)

  // Unread no sino — o header mobile não tem mais o NotificationBell,
  // então o contador vive aqui (React Query: mesma subscription cacheada).
  const { data: count } = useNotificationCount()
  const unread = count?.count ?? 0

  const path = location.pathname

  // Norma Discord: a tab bar convive com o drawer (que para acima dela).
  // Toda ação de tab fecha o drawer antes — sem isso ele ficava aberto
  // por cima da página nova.
  const tabs: Tab[] = [
    {
      id: 'constellations',
      label: 'Constelações',
      icon: <ConstellationIcon className="size-5" />,
      onClick: () => toggleSidebar(),
      active: sidebarOpen,
    },
    {
      id: 'stars',
      label: 'Estrelas',
      icon: <Sparkles className="size-5" />,
      onClick: () => { closeSidebar(); navigate('/app/dm') },
      active: !sidebarOpen && path.startsWith('/app/dm'),
    },
    {
      id: 'friends',
      label: 'Amigos',
      icon: <Users className="size-5" />,
      onClick: () => { closeSidebar(); navigate('/app/friends') },
      active: !sidebarOpen && path.startsWith('/app/friends'),
    },
    {
      id: 'notif',
      label: 'Avisos',
      icon: <Bell className="size-5" />,
      onClick: () => {
        // Abre o MobileNotificationsSheet (montado no AppPage) via custom event
        closeSidebar()
        window.dispatchEvent(new Event('astra:open-notifications'))
      },
      active: false,
      badge: unread,
    },
    {
      id: 'more',
      label: 'Mais',
      icon: <MoreHorizontal className="size-5" />,
      onClick: () => { closeSidebar(); setMoreOpen(true) },
      active: false,
    },
  ]

  return (
    <nav
      aria-label="Navegação mobile"
      className={cn(
        // astra-bottom-nav: escondida via CSS quando o teclado abre (.astra-kb-open)
        'astra-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-30',
        // Fundo SÓLIDO: sem backdrop-blur (elemento permanente repintava o
        // blur a cada frame de scroll) e sem /98 (texto passando por baixo
        // ficava visível através das tabs).
        'border-t border-(--border) bg-(--base)',
        'pb-safe',
      )}
    >
      <ul className="flex items-stretch justify-around h-14">
        {tabs.map((t) => (
          <li key={t.id} className="flex-1">
            <button
              type="button"
              onClick={t.onClick}
              aria-label={t.label}
              className={cn(
                'group w-full h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors',
                t.active
                  ? 'text-(--accent)'
                  : 'text-(--text-3) hover:text-(--text-1)',
              )}
            >
              <span
                className={cn(
                  'relative transition-transform group-active:scale-90',
                  t.active && 'drop-shadow-[0_0_6px_var(--accent-glow)]',
                )}
              >
                {t.icon}
                {(t.badge ?? 0) > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-(--accent) text-[9px] font-semibold text-(--accent-foreground) flex items-center justify-center"
                    aria-hidden
                  >
                    {t.badge! > 99 ? '99+' : t.badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-(family-name:--font-display) leading-none">
                {t.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
