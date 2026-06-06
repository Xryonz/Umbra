import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pin, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import type { MessageWithAuthor } from '@astra/types'

/**
 * Popover de mensagens fixadas. Antes era um Sheet (off-canvas direita),
 * trocamos por popover ancorado tipo dropdown — mais leve, menos disruptivo
 * que um drawer. Mesmo API (open/onClose) pra não quebrar callers.
 *
 * Posicionamento: fixed no canto superior direito da viewport, sob o header
 * (top-16). Funciona bem em desktop e mobile. Em mobile o popover ocupa
 * quase a largura toda; em desktop, max-w-md.
 */
interface Props {
  channelId:   string
  channelName: string
  open:        boolean
  onClose:     () => void
}

export default function PinnedMessagesSheet({ channelId, channelName, open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler)
      document.addEventListener('keydown', onEsc)
    }, 50)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open, onClose])

  const { data: pinned = [], isLoading } = useQuery<MessageWithAuthor[]>({
    queryKey: ['pinned', channelId],
    queryFn:  async () => (await api.get(`/api/channels/${channelId}/messages/pinned`)).data.data,
    enabled:  open,
    staleTime: 30_000,
  })

  if (!open) return null

  return (
    <div
      ref={ref}
      className="fixed right-2 sm:right-6 top-16 mt-2 z-40 w-[calc(100vw-1rem)] sm:w-96 max-h-[70vh] flex flex-col bg-(--overlay) border border-(--border-mid) shadow-2xl animate-in fade-in-0 slide-in-from-top-2 duration-200"
      role="dialog"
      aria-label="Mensagens fixadas"
    >
      <header className="shrink-0 px-4 py-3 border-b border-(--border) bg-(--base)/95 backdrop-blur flex items-center gap-2">
        <Pin className="size-4 text-(--accent)" />
        <div className="flex-1 min-w-0">
          <p className="m-0 text-sm font-medium truncate" style={{ fontFamily: 'var(--font-display)' }}>
            #{channelName}
          </p>
          <p className="m-0 text-[11px] text-(--text-3)">{pinned.length} fixada{pinned.length === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="size-7 flex items-center justify-center border border-(--border) text-(--text-3) hover:border-(--accent) hover:text-(--accent) transition-colors cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="size-5 border-2 border-(--border-mid) border-t-(--accent) rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && pinned.length === 0 && (
          <div className="text-center py-10">
            <Pin className="size-7 text-(--text-3) mx-auto mb-3" />
            <p className="ed-marg m-0">Nenhuma mensagem fixada</p>
            <p className="text-(--text-3) text-xs mt-2 leading-relaxed">
              Hover numa mensagem → <Pin className="size-3 inline align-middle" /> pra fixar.
            </p>
          </div>
        )}

        {pinned.map((msg) => (
          <article
            key={msg.id}
            className="border-l-2 border-(--accent) pl-3 py-1.5 hover:bg-(--raised)/40 transition-colors cursor-default"
          >
            <header className="flex items-center gap-2 mb-1">
              <Avatar className="size-5">
                {msg.author.avatarUrl && <AvatarImage src={msg.author.avatarUrl} />}
                <AvatarFallback className="text-[9px]">
                  {msg.author.displayName.slice(0,1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                {msg.author.displayName}
              </span>
              <span className="font-mono text-[10px] text-(--text-3) ml-auto">
                {new Date(msg.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </header>
            <p className="text-[13px] text-(--text-2) leading-relaxed m-0 wrap-break-word">
              {msg.content}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}
