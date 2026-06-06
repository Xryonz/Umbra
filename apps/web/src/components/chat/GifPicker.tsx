import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Attachment } from '@astra/types'

interface GifResult {
  id:      string
  title:   string
  preview: string
  full:    string
  width?:  number
  height?: number
  size:    number
}

interface GifPickerProps {
  open:     boolean
  onClose:  () => void
  onPick:   (att: Attachment) => void
}

function useDebounce<T>(v: T, ms = 350) {
  const [out, setOut] = useState(v)
  useEffect(() => { const t = setTimeout(() => setOut(v), ms); return () => clearTimeout(t) }, [v, ms])
  return out
}

/**
 * Tenor GIF picker — popover acima do MessageInput.
 * Trending por default, busca conforme digita.
 */
export default function GifPicker({ open, onClose, onPick }: GifPickerProps) {
  const [q, setQ] = useState('')
  const debounced = useDebounce(q, 350)
  const inputRef  = useRef<HTMLInputElement>(null)
  const rootRef   = useRef<HTMLDivElement>(null)

  // Foco no input quando abre
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  // Esc fecha
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Click fora fecha
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', onClick), 50)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, onClose])

  // Tenor enabled check
  const { data: enabled } = useQuery<boolean>({
    queryKey: ['gif-enabled'],
    queryFn:  async () => (await api.get('/api/gif/enabled')).data?.data?.enabled ?? false,
    staleTime: 5 * 60_000,
    enabled:   open,
  })

  // Featured ou search
  const isSearch = debounced.trim().length >= 2
  const { data: results = [], isFetching, isError } = useQuery<GifResult[]>({
    queryKey: ['gifs', isSearch ? debounced : '__featured'],
    queryFn:  async () => {
      const path = isSearch
        ? `/api/gif/search?q=${encodeURIComponent(debounced)}&limit=24`
        : `/api/gif/featured?limit=24`
      const r = await api.get(path)
      return r.data?.data?.results ?? []
    },
    enabled: open && enabled === true,
    staleTime: 60_000,
  })

  if (!open) return null

  return (
    <div
      ref={rootRef}
      className="absolute bottom-full left-6 right-6 mb-2 z-50 bg-(--overlay) border border-(--border-mid) shadow-2xl flex flex-col max-h-96 overflow-hidden anim-fade-up"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-(--border)">
        <Search className="size-4 text-(--text-3) shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Procurar GIFs no Giphy…"
          className="flex-1 bg-transparent outline-none border-none text-(--text-1) placeholder:text-(--text-3) text-sm"
          style={{ fontFamily: 'var(--font-body)' }}
        />
        {isFetching && <Loader2 className="size-4 text-(--text-3) animate-spin" />}
        <button
          onClick={onClose}
          className="size-7 flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>

      {enabled === false && (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-(--text-2) m-0 mb-2">GIF picker desabilitado.</p>
          <p className="text-xs text-(--text-3) m-0">
            O backend precisa da variável <code className="px-1 bg-(--raised) border border-(--border)">GIPHY_API_KEY</code>.
          </p>
        </div>
      )}

      {isError && (
        <div className="px-5 py-8 text-center text-sm text-(--danger)">
          Erro ao carregar GIFs. Tenta de novo.
        </div>
      )}

      {enabled && !isError && (
        <div className="flex-1 overflow-y-auto p-2">
          {results.length === 0 && !isFetching && (
            <p className="text-center text-sm text-(--text-3) italic py-6">
              {isSearch ? `Nada pra "${debounced}"` : 'Sem GIFs em destaque agora.'}
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {results.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  onPick({
                    url:    g.full,
                    type:   'image/gif',
                    name:   `${g.title || 'tenor'}.gif`,
                    size:   g.size || 0,
                    width:  g.width,
                    height: g.height,
                  })
                  onClose()
                }}
                className="relative aspect-square border border-(--border) overflow-hidden bg-(--raised) cursor-pointer group hover:border-(--accent) transition-colors"
                title={g.title}
              >
                <img
                  src={g.preview}
                  alt={g.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-1.5 text-[10px] font-mono text-(--text-3) border-t border-(--border) flex items-center justify-between">
        <span>via Giphy</span>
        <span>Esc fechar</span>
      </div>
    </div>
  )
}
