/**
 * Sino com badge + popover do centro de notificações.
 *
 * Layout editorial: ícone sutil, badge no canto, popover ancorado
 * com lista scrollable + filtros + mark-all-read.
 */
import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale/pt-BR'
import { Sparkles } from 'lucide-react'
import {
  useNotificationFeed, useNotificationCount, useMarkRead, useMarkAllRead,
  type NotificationItem, type NotificationType,
} from '@/hooks/useNotifications'
import { Empty, EmptyIcon, EmptyLabel, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { resolveApiUrl } from '@/lib/api'

const TYPE_LABEL: Record<NotificationType, string> = {
  mention:  'Menção',
  dm:       'DM',
  reaction: 'Reação',
  reply:    'Resposta',
}

const TYPE_ICON: Record<NotificationType, string> = {
  mention:  '@',
  dm:       '✉',
  reaction: '☆',
  reply:    '↩',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Mobile bottom nav abre via custom event (sino fica só no desktop header)
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('astra:open-notifications', onOpen)
    return () => window.removeEventListener('astra:open-notifications', onOpen)
  }, [])

  const { data: count } = useNotificationCount()
  const unread = count?.count ?? 0

  // Shake + badge pop quando unread sobe.
  // shakeKey re-trigger animation reset via key change.
  const [shakeKey, setShakeKey] = useState(0)
  const prevUnreadRef = useRef(unread)
  useEffect(() => {
    if (unread > prevUnreadRef.current) setShakeKey((k) => k + 1)
    prevUnreadRef.current = unread
  }, [unread])

  // Click-outside fecha
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown',   onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-(--accent)/5 transition-colors"
        aria-label={`Notificações${unread > 0 ? ` (${unread} não lidas)` : ''}`}
      >
        <span
          key={shakeKey}
          style={{
            display: 'inline-flex',
            transformOrigin: '50% 10%',
            animation: shakeKey > 0 ? 'bellShake 0.6s cubic-bezier(0.36, 0.07, 0.19, 0.97) both' : undefined,
            willChange: 'transform',
          }}
        >
          <BellIcon />
        </span>
        {unread > 0 && (
          <span
            key={'badge-' + shakeKey}
            className="absolute -top-1 -right-1 min-w-4.5 h-4.5 px-1 rounded-full bg-(--accent) text-[10px] font-semibold text-(--accent-foreground) flex items-center justify-center"
            style={{
              animation: shakeKey > 0 ? 'badgePop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' : undefined,
              willChange: 'transform',
            }}
            aria-hidden
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && <NotificationCenter onClose={() => setOpen(false)} />}
    </div>
  )
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function NotificationCenter({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | NotificationType>('all')
  const feed = useNotificationFeed()
  const markRead    = useMarkRead()
  const markAllRead = useMarkAllRead()

  const all   = feed.data?.pages.flatMap((p) => p.items) ?? []
  const items = filter === 'all' ? all : all.filter((n) => n.type === filter)

  return (
    <div className="absolute right-0 mt-2 w-95 max-h-130 rounded-xl border border-border bg-background shadow-2xl flex flex-col z-50 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h3 className="text-sm font-medium text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            Notificações
          </h3>
          <p className="text-xs text-muted-foreground m-0">{all.length === 0 ? 'Nada por aqui ainda' : `${all.filter((n) => !n.readAt).length} não lidas`}</p>
        </div>
        <button
          onClick={() => markAllRead.mutate()}
          disabled={all.every((n) => n.readAt)}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          Marcar todas
        </button>
      </header>

      {/* Tabs filtro */}
      <div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto">
        {(['all', 'mention', 'dm', 'reply', 'reaction'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-xs rounded-lg whitespace-nowrap transition-colors ${
              filter === f
                ? 'bg-(--accent)/10 text-(--accent)'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f === 'all' ? 'Todas' : TYPE_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {feed.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Spinner size={12} /> Carregando…
          </div>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyIcon><Sparkles className="size-6 text-(--accent)" /></EmptyIcon>
            <EmptyLabel>— Caixa silenciosa</EmptyLabel>
            <EmptyTitle>
              {filter === 'all' ? 'Tudo em dia' : `Nenhuma ${TYPE_LABEL[filter as NotificationType].toLowerCase()} ainda`}
            </EmptyTitle>
            <EmptyDescription>Notificações chegarão aqui em tempo real.</EmptyDescription>
          </Empty>
        ) : (
          <div className="divide-y divide-border" role="list">
            {items.map((n, i) => (
              <div
                key={n.id}
                role="listitem"
                style={{
                  animation: `fadeLeft 0.28s cubic-bezier(0.16,1,0.3,1) ${Math.min(i * 0.022, 0.3)}s both`,
                }}
              >
                <NotificationRow
                  n={n}
                  onActivate={(item) => {
                    if (!item.readAt) markRead.mutate(item.id)
                    navigateTo(item)
                    onClose()
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {feed.hasNextPage && (
          <div className="p-3 text-center">
            <button
              onClick={() => feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {feed.isFetchingNextPage ? 'Carregando…' : 'Ver mais'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function NotificationRow({
  n, onActivate,
}: {
  n: NotificationItem
  onActivate: (n: NotificationItem) => void
}) {
  const avatar = n.payload?.authorAvatar ? resolveApiUrl(n.payload.authorAvatar) : null
  const author = n.payload?.authorName ?? 'Alguém'
  const preview = n.payload?.preview ?? ''
  const ts = formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ptBR })

  let summary = ''
  switch (n.type) {
    case 'mention':  summary = `mencionou você em #${n.payload.channelName ?? '?'}`; break
    case 'dm':       summary = 'enviou uma DM'; break
    case 'reply':    summary = `respondeu você em #${n.payload.channelName ?? '?'}`; break
    case 'reaction': summary = `reagiu ${n.payload.emoji ?? '☆'} à sua mensagem`; break
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onActivate(n)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(n) } }}
      className={`flex gap-3 px-4 py-3 cursor-pointer hover:bg-card transition-colors ${
        n.readAt ? '' : 'bg-(--accent)/3'
      }`}
    >
      <div className="shrink-0">
        {avatar ? (
          <img src={avatar} alt={author} loading="lazy" decoding="async" className="size-9 rounded-full object-cover" />
        ) : (
          <div className="size-9 rounded-full bg-card border border-border flex items-center justify-center text-sm text-muted-foreground">
            {TYPE_ICON[n.type]}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground m-0 leading-tight">
          <span className="font-medium">{author}</span>
          <span className="text-muted-foreground"> {summary}</span>
        </p>
        {preview && (
          <p className="text-xs text-muted-foreground mt-1 m-0 truncate">{preview}</p>
        )}
        <p className="text-[11px] text-muted-foreground mt-1 m-0">{ts}</p>
      </div>

      {!n.readAt && (
        <span className="shrink-0 mt-1.5 size-1.5 rounded-full bg-(--accent)" aria-label="Não lida" />
      )}
    </div>
  )
}

function navigateTo(n: NotificationItem) {
  const url = n.type === 'dm' ? '/app/dm' : '/app'
  if (window.location.pathname !== url) window.location.href = url
}
