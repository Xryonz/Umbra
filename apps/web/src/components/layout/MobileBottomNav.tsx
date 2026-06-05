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
import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, Users, MoreHorizontal, Bell } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
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
}

export default function MobileBottomNav() {
  const navigate         = useNavigate()
  const location         = useLocation()
  const openSidebar      = useUIStore((s) => s.openMobileSidebar)
  const setMoreOpen      = useUIStore((s) => s.setMobileMoreOpen)

  const path = location.pathname

  const tabs: Tab[] = [
    {
      id: 'constellations',
      label: 'Constelações',
      icon: <ConstellationIcon className="size-5" />,
      onClick: () => openSidebar(),
      active: false, // gerenciado pelo state do sidebar separadamente
    },
    {
      id: 'stars',
      label: 'Estrelas',
      icon: <Sparkles className="size-5" />,
      onClick: () => navigate('/app/dm'),
      active: path.startsWith('/app/dm'),
    },
    {
      id: 'friends',
      label: 'Amigos',
      icon: <Users className="size-5" />,
      onClick: () => navigate('/app/friends'),
      active: path.startsWith('/app/friends'),
    },
    {
      id: 'notif',
      label: 'Avisos',
      icon: <Bell className="size-5" />,
      onClick: () => {
        // Reaproveita NotificationBell — disparar via custom event que o Bell escuta
        window.dispatchEvent(new Event('astra:open-notifications'))
      },
      active: false,
    },
    {
      id: 'more',
      label: 'Mais',
      icon: <MoreHorizontal className="size-5" />,
      onClick: () => setMoreOpen(true),
      active: false,
    },
  ]

  return (
    <nav
      aria-label="Navegação mobile"
      className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-30',
        'border-t border-(--border) bg-(--base)/95 backdrop-blur-md',
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
                  'transition-transform group-active:scale-90',
                  t.active && 'drop-shadow-[0_0_6px_var(--accent-glow)]',
                )}
              >
                {t.icon}
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
