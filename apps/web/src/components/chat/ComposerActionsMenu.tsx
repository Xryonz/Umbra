/**
 * Menu de "extras" do composer: GIF, Emoji, Enquete, Mensagem efêmera.
 *
 * Trigger: Sparkle (editorial, 1 ponta). Click → painel desliza de baixo pra cima
 * com lista vertical de ações. Click fora ou Esc fecha.
 *
 * Pra TTL (mensagem efêmera), o painel troca pra um sub-menu inline com as
 * durações — escolher um valor fecha o painel e seta ttlSeconds.
 */
import { useEffect, useRef, useState } from 'react'
import { Sparkle, Smile, BarChart3, Timer, ChevronLeft, X, Check, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComposerActionsMenuProps {
  disabled?:    boolean
  ttlSeconds:   number
  onGif:        () => void
  onEmoji:      () => void
  onPoll:       () => void
  onTtlChange:  (secs: number) => void
  /** Esconde item "Enquete" — usado no DMInput (DM 1:1 não tem polls) */
  hidePoll?:    boolean
  /** Anexar arquivo — só aparece no mobile (desktop tem o clipe exposto) */
  onAttach?:    () => void
  attachDisabled?: boolean
}

const TTL_OPTIONS = [
  { label: 'Permanente', secs: 0 },
  { label: '1 hora',     secs: 3600 },
  { label: '6 horas',    secs: 6 * 3600 },
  { label: '24 horas',   secs: 24 * 3600 },
  { label: '7 dias',     secs: 7 * 86400 },
]

function formatTtl(secs: number) {
  if (secs >= 86400) return `${Math.round(secs / 86400)}d`
  if (secs >= 3600)  return `${Math.round(secs / 3600)}h`
  if (secs >= 60)    return `${Math.round(secs / 60)}min`
  return `${secs}s`
}

export function ComposerActionsMenu({
  disabled, ttlSeconds, onGif, onEmoji, onPoll, onTtlChange, hidePoll,
  onAttach, attachDisabled,
}: ComposerActionsMenuProps) {
  const [open,     setOpen]     = useState(false)
  const [subMenu,  setSubMenu]  = useState<'ttl' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Click fora + Esc fecham
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSubMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (subMenu) setSubMenu(null)
        else { setOpen(false) }
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, subMenu])

  const close = () => { setOpen(false); setSubMenu(null) }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Mais opções"
        title="Mais opções"
        className={cn(
          'size-10 sm:size-7 flex items-center justify-center cursor-pointer transition-[color,transform] duration-150',
          disabled
            ? 'opacity-40 cursor-default text-(--text-3)'
            : open
              ? 'text-(--accent) rotate-90'
              : 'text-(--text-3) hover:text-(--accent)',
        )}
      >
        {open ? <X className="size-4" /> : <Sparkle className="size-4" />}
      </button>

      {open && (
        <div
          className={cn(
            'absolute bottom-9 left-0 z-30 min-w-[210px]',
            'bg-(--overlay) border border-(--border-mid) shadow-2xl',
            'rounded-xl overflow-hidden origin-bottom-left',
          )}
          style={{ animation: 'composerMenuSlideUp 180ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
        >
          {subMenu === 'ttl' ? (
            <>
              <header className="flex items-center gap-2 px-2.5 py-2 border-b border-(--border)">
                <button
                  onClick={() => setSubMenu(null)}
                  className="size-6 grid place-items-center text-(--text-3) hover:text-(--accent) transition-colors"
                  aria-label="Voltar"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="ed-marg">— Mensagem efêmera</span>
              </header>
              <div className="flex flex-col">
                {TTL_OPTIONS.map((o) => {
                  const active = ttlSeconds === o.secs
                  return (
                    <button
                      key={o.secs}
                      onClick={() => { onTtlChange(o.secs); close() }}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 text-left transition-colors border-l-2 text-sm',
                        active
                          ? 'border-(--accent) bg-(--accent)/5 text-(--accent)'
                          : 'border-transparent text-(--text-2) hover:bg-(--raised)/40 hover:text-foreground',
                      )}
                    >
                      <span className="flex-1">{o.label}</span>
                      {active && <Check className="size-3.5" />}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <header className="px-3 py-1.5 border-b border-(--border)">
                <span className="ed-marg">— Extras</span>
              </header>
              <div className="flex flex-col">
                {/* Mobile-only (sm:hidden): no desktop o clipe fica exposto
                    na row; aqui ele vive dentro do "+" — composer Discord-style
                    libera largura pro campo de texto. */}
                {onAttach && !attachDisabled && (
                  <MenuItem
                    className="sm:hidden"
                    icon={<Paperclip className="size-4" />}
                    label="Anexar arquivo"
                    onClick={() => { onAttach(); close() }}
                  />
                )}
                <MenuItem
                  icon={<span className="font-mono text-[10px] font-bold tracking-wider">GIF</span>}
                  label="Procurar GIF"
                  onClick={() => { onGif(); close() }}
                />
                <MenuItem
                  icon={<Smile className="size-4" />}
                  label="Emoji"
                  onClick={() => { onEmoji(); close() }}
                />
                {!hidePoll && (
                  <MenuItem
                    icon={<BarChart3 className="size-4" />}
                    label="Enquete"
                    onClick={() => { onPoll(); close() }}
                  />
                )}
                <MenuItem
                  icon={<Timer className="size-4" />}
                  label="Mensagem efêmera"
                  hint={ttlSeconds > 0 ? formatTtl(ttlSeconds) : 'off'}
                  active={ttlSeconds > 0}
                  onClick={() => setSubMenu('ttl')}
                  hasChevron
                />
              </div>
            </>
          )}
          <style>{`
            @keyframes composerMenuSlideUp {
              from { transform: translateY(10px); opacity: 0 }
              to   { transform: translateY(0);    opacity: 1 }
            }
          `}</style>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon, label, hint, active, hasChevron, onClick, className,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  active?: boolean
  hasChevron?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-l-2 text-sm',
        active
          ? 'border-(--accent) bg-(--accent)/5 text-(--accent)'
          : 'border-transparent text-(--text-2) hover:bg-(--raised)/40 hover:text-foreground',
        className,
      )}
    >
      <span className="size-5 grid place-items-center shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-(--text-3) font-mono">{hint}</span>}
      {hasChevron && <ChevronLeft className="size-3 -rotate-180 text-(--text-3)" />}
    </button>
  )
}
