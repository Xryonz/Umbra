import { useState, useRef, useEffect, memo, lazy, Suspense } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Smile, Pencil, Trash2, Pin, PinOff, Reply, CornerDownRight, MessageSquarePlus, Bookmark, BookmarkCheck, Languages, Copy } from 'lucide-react'
import { EditorialContextMenu, type EditorialMenuItem } from '@/components/EditorialContextMenu'
import { ProfileHoverCard } from '@/components/ProfileHoverCard'
import { toast } from '@/components/ui/sonner'
import { api, resolveApiUrl } from '@/lib/api'
import { useEmojiMap, type ServerEmoji } from '@/hooks/useServerEmojis'
import { useAuthStore } from '@/store/authStore'
import { useLongPress } from '@/hooks/useLongPress'
import { useSwipeReply } from '@/hooks/useSwipeReply'
import ProfileCard from '@/components/ProfileCard'
import MessageMobileActions from '@/components/chat/MessageMobileActions'
import CodeBlock from '@/components/chat/CodeBlock'
import Lightbox from '@/components/Lightbox'
const FullEmojiPicker = lazy(() => import('@/components/chat/FullEmojiPicker'))
import PollCard from '@/components/chat/PollCard'
import EditHistoryPopover from '@/components/chat/EditHistoryPopover'
import { useIsBookmarked, useToggleBookmark } from '@/hooks/useBookmarks'
import { TRANSLATE_LANGS, useTranslateMessage, type TranslateLang } from '@/hooks/useTranslate'
import { cn } from '@/lib/utils'
import { FONT_FAMILY, type DisplayFont } from '@/components/profile/profileFonts'
import type { MessageWithAuthor } from '@astra/types'

import { MessageReactions, type Reaction } from './Message/MessageReactions'
import { MessageAttachments } from './Message/MessageAttachments'
import { MessageToolbar } from './Message/MessageToolbar'
import {
  CreateThreadDialog, DeleteConfirm, EditModal,
} from './Message/MessageDialogs'
type ParsedColor =
  | { type: 'solid';    value: string }
  | { type: 'gradient'; angle: number; from: string; to: string }

export interface FullMessage extends MessageWithAuthor {
  reactions?:   Reaction[]
  mentions?:    string[]
  authorColor?: string | null
}

interface MessageItemProps {
  message:    FullMessage
  grouped:    boolean
  delay?:     number
  isPending?: boolean
  roleColor?: string | null
  onEdit?:    (messageId: string, content: string) => void
  onDelete?:  (messageId: string) => void
  onReact?:   (messageId: string, emoji: string) => void
  onReply?:   (message: FullMessage) => void
}

const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🔥','🎉','👀']

const PALETTE = ['#c9a96e','#8b7fc4','#6aabca','#ca7a7a','#7ac4a0','#c49b6a','#9b7ac4']
function defaultColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function parseColor(raw: string | null | undefined, fallback: string): ParsedColor {
  if (!raw) return { type: 'solid', value: fallback }
  if (raw.startsWith('gradient:')) {
    const parts = raw.split(':')
    if (parts.length === 4)
      return { type: 'gradient', angle: Number(parts[1]) || 135, from: parts[2], to: parts[3] }
  }
  return { type: 'solid', value: raw }
}

function formatTime(d: string) {
  const date = new Date(d)
  if (isToday(date))     return `hoje às ${format(date, 'HH:mm')}`
  if (isYesterday(date)) return `ontem às ${format(date, 'HH:mm')}`
  return format(date, "d 'de' MMM 'às' HH:mm", { locale: ptBR })
}

// ─── Clickable Avatar ─────────────────────────────────────────
// CSS-only tactile feedback: hover:scale-105 + active:scale-95.
// Antes era motion.div com spring → caro pra renderizar em listas longas
// (cada msg paga overhead de motion). CSS transition é GPU compositor direto.
function Avatar({ src, name, color, size = 36, isBot, onClick }: {
  src?: string | null; name: string; color: string
  size?: number; isBot?: boolean
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
}) {
  const [imgError, setImgError] = useState(false)
  const ringColor = isBot ? 'var(--accent)' : color
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-full shrink-0 overflow-hidden flex items-center justify-center border-2',
        'transition-[transform,border-color,background-color] duration-150 ease-(--ease-spring)',
        clickable && 'cursor-pointer hover:scale-105 active:scale-95',
      )}
      style={{
        width: size, height: size,
        background: isBot ? 'var(--accent-dim)' : color + '22',
        borderColor: ringColor + '44',
      }}
      onMouseEnter={(e) => { if (clickable) e.currentTarget.style.borderColor = ringColor }}
      onMouseLeave={(e) => { if (clickable) e.currentTarget.style.borderColor = ringColor + '44' }}
    >
      {src && !imgError
        ? <img src={src} alt={name} referrerPolicy="no-referrer"
            loading="lazy" decoding="async"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)} />
        : <span className="font-bold" style={{ fontSize: size * 0.36, color: ringColor }}>
            {isBot ? '🤖' : name.slice(0, 1).toUpperCase()}
          </span>
      }
    </div>
  )
}

function Spinner() {
  return (
    <div
      className="size-3 shrink-0 rounded-full border-[1.5px] border-border animate-spin"
      style={{ borderTopColor: 'var(--accent)' }}
    />
  )
}

function AuthorName({ name, color, msgId, isBot, font }: {
  name: string; color: ParsedColor; msgId: string; isBot?: boolean; font?: DisplayFont
}) {
  const fontFamily = FONT_FAMILY[font ?? 'serif']
  if (color.type === 'gradient') {
    const rad    = (color.angle * Math.PI) / 180
    const gradId = `g-${msgId}`
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width={Math.max(name.length * 10 + 24, 80)} height={22}
          style={{ overflow: 'visible', flexShrink: 0 }} aria-label={name}>
          <defs>
            <linearGradient id={gradId}
              x1={`${50 - Math.cos(rad) * 50}%`} y1={`${50 - Math.sin(rad) * 50}%`}
              x2={`${50 + Math.cos(rad) * 50}%`} y2={`${50 + Math.sin(rad) * 50}%`}>
              <stop offset="0%" stopColor={color.from} />
              <stop offset="100%" stopColor={color.to} />
            </linearGradient>
          </defs>
          <text y="17" fill={`url(#${gradId})`} fontSize="16" fontWeight="400"
            fontFamily={fontFamily} letterSpacing="-0.005em">{name}</text>
        </svg>
        {isBot && <BotBadge />}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          color: color.value,
          fontSize: 16,
          fontWeight: 400,
          fontFamily,
          letterSpacing: '-0.005em',
          lineHeight: 1.1,
        }}
      >
        {name}
      </span>
      {isBot && <BotBadge />}
    </span>
  )
}

function BotBadge() {
  return (
    <span className="text-[9px] font-bold tracking-wider bg-primary text-primary-foreground px-1.5 py-px rounded uppercase leading-relaxed">
      BOT
    </span>
  )
}

/** Aplica custom emojis :nome: num node de texto (substitui por <img>).
 *  Se o map é vazio, retorna o texto original num único span. */
function applyCustomEmojis(text: string, emojiMap: Map<string, ServerEmoji>, keyPrefix: string): React.ReactNode {
  if (emojiMap.size === 0) return text
  const re = /:([a-z0-9_]{2,32}):/gi
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    const [whole, name] = m
    const e = emojiMap.get(name.toLowerCase())
    if (!e) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <img
        key={`${keyPrefix}-ce${k++}`}
        src={resolveApiUrl(e.url)}
        alt={`:${e.name}:`}
        title={`:${e.name}:`}
        width={22}
        height={22}
        style={{ display: 'inline-block', verticalAlign: '-0.25em', margin: '0 1px' }}
        loading="lazy"
        decoding="async"
      />,
    )
    last = m.index + whole.length
  }
  if (last === 0) return text
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

/** Inline-level markdown: bold, italic, strike, spoiler, code, link, mention. */
function renderInline(text: string, keyPrefix: string, emojiMap: Map<string, ServerEmoji>): React.ReactNode[] {
  // Ordem importa — regex de delimitadores não-conflitantes
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|\|\|[^|\n]+\|\||`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|@[a-z0-9_]+)/gi
  return text.split(re).map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (!part) return null

    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__')))
      return <strong key={key} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>

    if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) ||
        (part.startsWith('_') && part.endsWith('_') && part.length > 2))
      return <em key={key} className="italic">{part.slice(1, -1)}</em>

    if (part.startsWith('~~') && part.endsWith('~~'))
      return <span key={key} className="line-through text-(--text-3)">{part.slice(2, -2)}</span>

    if (part.startsWith('||') && part.endsWith('||'))
      return <SpoilerSpan key={key}>{part.slice(2, -2)}</SpoilerSpan>

    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code
          key={key}
          className="px-1.5 py-0.5 text-[12px] border border-(--border) bg-(--raised)"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {part.slice(1, -1)}
        </code>
      )

    // [texto](url) link
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (linkMatch) {
      const [, label, url] = linkMatch
      const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`
      return (
        <a
          key={key}
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className="text-(--accent) underline decoration-(--accent)/40 underline-offset-2 hover:decoration-(--accent) transition-colors"
        >
          {label}
        </a>
      )
    }

    if (part.startsWith('@')) {
      const username = part.slice(1)
      return (
        <ProfileHoverCard key={key} username={username} side="top" align="start">
          <span
            className="text-(--accent) font-medium border-b border-dotted border-(--accent)/60 px-0.5 cursor-pointer"
            tabIndex={0}
          >
            {part}
          </span>
        </ProfileHoverCard>
      )
    }

    return <span key={key}>{applyCustomEmojis(part, emojiMap, key)}</span>
  }).filter(Boolean)
}

/** Spoiler: blur até clicar */
function SpoilerSpan({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      onClick={() => setRevealed(true)}
      className={
        revealed
          ? 'bg-(--raised) px-1 rounded-sm cursor-default'
          : 'bg-(--text-3) text-(--text-3) px-1 rounded-sm cursor-pointer hover:bg-(--text-2) transition-colors select-none'
      }
      title={revealed ? '' : 'Clique pra revelar'}
    >
      {children}
    </span>
  )
}

/** Extrai blocos triple-backtick (```lang\ncode\n```) e renderiza com CodeBlock.
 *  Resto vai pra block-level renderer. */
function renderContent(text: string, emojiMap: Map<string, ServerEmoji>): React.ReactNode {
  // Split por code fence preservando os blocos
  const parts = text.split(/(```[a-z0-9]*\n[\s\S]*?\n?```)/gi)
  return parts.map((part, i) => {
    const fence = part.match(/^```([a-z0-9]*)\n([\s\S]*?)\n?```$/i)
    if (fence) {
      const [, lang, code] = fence
      return <CodeBlock key={`cb-${i}`} code={code} lang={lang || 'text'} />
    }
    return <span key={`b-${i}`}>{renderBlocks(part, emojiMap)}</span>
  })
}

/** Block-level: headings, quotes, lists. Recursivo via renderInline. */
function renderBlocks(text: string, emojiMap: Map<string, ServerEmoji>): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, idx) => {
    const key = `l-${idx}`

    // # heading (até ###)
    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      const level = h[1].length as 1 | 2 | 3
      const size = level === 1 ? 'text-xl' : level === 2 ? 'text-lg' : 'text-base'
      return (
        <div
          key={key}
          className={`${size} font-normal text-foreground mt-2 mb-1`}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {renderInline(h[2], key, emojiMap)}
        </div>
      )
    }

    // > quote
    if (line.startsWith('> ')) {
      return (
        <div
          key={key}
          className="border-l-2 border-(--accent) pl-3 py-0.5 my-1 text-(--text-2) italic"
        >
          {renderInline(line.slice(2), key, emojiMap)}
        </div>
      )
    }

    // - list / * list
    const li = line.match(/^[-*]\s+(.+)$/)
    if (li) {
      return (
        <div key={key} className="flex gap-2 my-0.5">
          <span className="text-(--accent) shrink-0 select-none">·</span>
          <span>{renderInline(li[1], key, emojiMap)}</span>
        </div>
      )
    }

    // numbered list
    const oli = line.match(/^(\d+)\.\s+(.+)$/)
    if (oli) {
      return (
        <div key={key} className="flex gap-2 my-0.5">
          <span className="text-(--text-3) shrink-0 select-none font-mono text-[12px]">{oli[1]}.</span>
          <span>{renderInline(oli[2], key, emojiMap)}</span>
        </div>
      )
    }

    // Linha vazia = quebra visual
    if (line.trim() === '') return <br key={key} />

    return <div key={key}>{renderInline(line, key, emojiMap)}</div>
  })
}


function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [showFull, setShowFull] = useState(false)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler) }
  }, [onClose])

  if (showFull) {
    return (
      <div ref={ref} className="absolute -top-[26rem] right-3 z-30">
        <Suspense fallback={null}>
          <FullEmojiPicker onPick={(e) => { onPick(e); onClose() }} onClose={onClose} />
        </Suspense>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="absolute -top-13 right-3 z-20 flex gap-1 px-2 py-2 bg-(--overlay) border border-(--border-mid) shadow-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-150"
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onPick(emoji); onClose() }}
          className="bg-transparent border-none cursor-pointer text-xl p-1 leading-none transition-transform duration-200 ease-(--ease-spring) hover:scale-125"
        >{emoji}</button>
      ))}
      <button
        onClick={() => setShowFull(true)}
        className="ml-1 px-1.5 text-xs font-mono tracking-wider text-(--text-3) hover:text-(--accent) border-l border-(--border) cursor-pointer"
        title="Mais emojis"
      >+</button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────
function MessageItemImpl({
  message, grouped, delay = 0, isPending = false, roleColor = null,
  onEdit, onDelete, onReact, onReply,
}: MessageItemProps) {
  const currentUser = useAuthStore((s) => s.user)
  const qc           = useQueryClient()
  const isBookmarked  = useIsBookmarked(message.id, 'message')
  const toggleBookmark = useToggleBookmark()
  const emojiMap       = useEmojiMap()
  const translate      = useTranslateMessage()
  const [translatePicker, setTranslatePicker] = useState(false)
  const [translation,     setTranslation]     = useState<{ lang: TranslateLang; text: string } | null>(null)

  // Auto-hide quando msg efêmera expira (server limpa via worker; aqui só visual)
  const expiresAt = (message as any).expiresAt as string | null | undefined
  const [expired, setExpired] = useState(() => {
    if (!expiresAt) return false
    return new Date(expiresAt).getTime() <= Date.now()
  })
  useEffect(() => {
    if (!expiresAt) return
    const diff = new Date(expiresAt).getTime() - Date.now()
    if (diff <= 0) { setExpired(true); return }
    const t = setTimeout(() => setExpired(true), diff)
    return () => clearTimeout(t)
  }, [expiresAt])

  if (expired) return null

  const [hovered,           setHovered]           = useState(false)
  const [showEmoji,         setShowEmoji]          = useState(false)
  const [showEdit,          setShowEdit]           = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm]  = useState(false)
  const [showMobileActions, setShowMobileActions]  = useState(false)
  const [showCreateThread,  setShowCreateThread]   = useState(false)
  const [showEditHistory,   setShowEditHistory]    = useState(false)
  const [lightboxIdx,       setLightboxIdx]        = useState<number | null>(null)
  // ProfileCard state
  const [profileUserId,     setProfileUserId]      = useState<string | null>(null)

  const longPress = useLongPress(() => {
    if (!isPending && !isBot) setShowMobileActions(true)
  }, { ms: 480 })

  // Swipe pra direita = responder (norma WhatsApp; esquerda é do drawer)
  const swipe = useSwipeReply(
    onReply && !isPending ? () => onReply(message) : undefined,
  )

  const { author, content, createdAt } = message
  const isBot       = (author as any).isBot ?? (author.username === 'astra_bot' || author.username === 'umbra_bot')
  const isMine      = author.id === currentUser?.id
  const fallback    = isBot ? 'var(--accent)' : defaultColor(author.id)
  const parsedColor = parseColor(roleColor ?? (message as any).authorColor, fallback)
  const reactions   = (message as any).reactions as Reaction[] ?? []

  // Opens the profile card
  const handleAvatarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setProfileUserId(author.id)
  }

  // Optimistic: aplica o toggle no cache ANTES do POST.
  // Socket 'reaction_update' chega depois e substitui (idempotente).
  // Rollback via invalidate se POST falhar.
  const handleReact = async (emoji: string) => {
    const userId = currentUser?.id
    if (!userId) return
    const chId = (message as any).channelId
    qc.setQueryData(['messages', chId], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          items: page.items.map((m: any) => {
            if (m.id !== message.id) return m
            const list = [...(m.reactions ?? [])]
            const idx  = list.findIndex((r: any) => r.emoji === emoji)
            if (idx >= 0) {
              const r = list[idx]
              const hadUser = r.users.includes(userId)
              if (hadUser) {
                const users = r.users.filter((u: string) => u !== userId)
                if (users.length === 0) return { ...m, reactions: list.filter((_, i) => i !== idx) }
                list[idx] = { ...r, users, count: users.length }
              } else {
                const users = [...r.users, userId]
                list[idx] = { ...r, users, count: users.length }
              }
              return { ...m, reactions: list }
            }
            return { ...m, reactions: [...list, { emoji, count: 1, users: [userId] }] }
          }),
        })),
      }
    })
    try {
      await api.post(`/api/channels/${chId}/messages/${message.id}/react`, { emoji })
    } catch {
      // Server rejeitou — refetch pra reconciliar
      qc.invalidateQueries({ queryKey: ['messages', chId] })
    }
    onReact?.(message.id, emoji)
  }

  const handleEdit = async (newContent: string) => {
    const chId = (message as any).channelId
    // Optimistic edit
    qc.setQueryData(['messages', chId], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          items: page.items.map((m: any) =>
            m.id === message.id ? { ...m, content: newContent, edited: true } : m
          ),
        })),
      }
    })
    setShowEdit(false)
    try {
      await api.patch(`/api/channels/${chId}/messages/${message.id}`, { content: newContent })
    } catch {
      qc.invalidateQueries({ queryKey: ['messages', chId] })
    }
    onEdit?.(message.id, newContent)
  }

  const handleDeleteConfirmed = async () => {
    setShowDeleteConfirm(false)
    const chId = (message as any).channelId
    // Optimistic: remove do cache imediato
    qc.setQueryData(['messages', chId], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          items: page.items.filter((m: any) => m.id !== message.id),
        })),
      }
    })
    try {
      await api.delete(`/api/channels/${chId}/messages/${message.id}`)
      toast.success('Mensagem excluída')
    } catch {
      qc.invalidateQueries({ queryKey: ['messages', chId] })
      toast.error('Erro ao excluir mensagem')
    }
    onDelete?.(message.id)
  }

  const handleTogglePin = async (newPinned: boolean) => {
    const chId = (message as any).channelId
    const url  = `/api/channels/${chId}/messages/${message.id}/pin`
    // Optimistic flip
    qc.setQueryData(['messages', chId], (old: any) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          items: page.items.map((m: any) =>
            m.id === message.id ? { ...m, pinned: newPinned } : m
          ),
        })),
      }
    })
    try {
      if (newPinned) await api.post(url)
      else           await api.delete(url)
      qc.invalidateQueries({ queryKey: ['pinned', chId] })
    } catch {
      qc.invalidateQueries({ queryKey: ['messages', chId] })
    }
  }

  const handleCreateThread = async (name: string) => {
    const url = `/api/channels/${(message as any).channelId}/threads`
    try { await api.post(url, { parentMessageId: message.id, name }) } catch {}
  }

  // Itens do right-click — coerentes com o toolbar mas mais completos
  const ctxItems: EditorialMenuItem[] = []
  if (!isPending && !isBot) {
    ctxItems.push({ kind: 'item', icon: <Smile className="size-3.5" />, label: 'Reagir',     onSelect: () => setShowEmoji(true) })
    ctxItems.push({ kind: 'item', icon: <Reply className="size-3.5" />, label: 'Responder', onSelect: () => onReply?.(message) })
    ctxItems.push({ kind: 'item', icon: <MessageSquarePlus className="size-3.5" />, label: 'Criar thread', onSelect: () => setShowCreateThread(true) })
    ctxItems.push({ kind: 'separator' })
    if (content) ctxItems.push({
      kind: 'item', icon: <Copy className="size-3.5" />, label: 'Copiar texto',
      onSelect: () => {
        void navigator.clipboard.writeText(content)
        toast.success('Texto copiado')
      },
    })
    ctxItems.push({
      kind: 'item', icon: <Copy className="size-3.5" />, label: 'Copiar ID',
      shortcut: '⌘C',
      onSelect: () => {
        void navigator.clipboard.writeText(message.id)
        toast.success('ID copiado')
      },
    })
    ctxItems.push({
      kind: 'item', icon: <Languages className="size-3.5" />, label: 'Traduzir',
      onSelect: () => setTranslatePicker(true),
    })
    ctxItems.push({ kind: 'separator' })
    ctxItems.push({
      kind: 'item',
      icon: (message as any).pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />,
      label: (message as any).pinned ? 'Desfixar' : 'Fixar mensagem',
      onSelect: () => handleTogglePin(!(message as any).pinned),
    })
    ctxItems.push({
      kind: 'item',
      icon: isBookmarked ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />,
      label: isBookmarked ? 'Remover bookmark' : 'Salvar bookmark',
      onSelect: () => toggleBookmark.mutate({ targetId: message.id, kind: 'message', action: isBookmarked ? 'delete' : 'create' }),
    })
    if (isMine) {
      ctxItems.push({ kind: 'separator' })
      ctxItems.push({ kind: 'item', icon: <Pencil className="size-3.5" />, label: 'Editar', onSelect: () => setShowEdit(true) })
      ctxItems.push({
        kind: 'item', icon: <Trash2 className="size-3.5" />, label: 'Excluir',
        destructive: true,
        onSelect: () => setShowDeleteConfirm(true),
      })
    }
  }

  return (
    <>
      <EditorialContextMenu items={ctxItems} mobileBridge={false}>
      <div
        className={cn(
          'flex gap-4 relative transition-[border-color,background-color,opacity] duration-150 border-l-2 select-none md:select-auto',
          // py-(--msg-density-py) respeita data-density do <html>
          // (compact 0.2rem / comfortable 0.5rem / spacious 0.85rem).
          grouped ? 'pl-4 pr-3' : 'pl-4 pr-3 pt-3 pb-1 mt-2',
          hovered ? 'border-(--accent) bg-(--raised)/40' : 'border-transparent bg-transparent',
          isPending ? 'opacity-60' : 'opacity-100'
        )}
        style={{
          animation: `msgIn 0.22s var(--ease-spring) ${delay}s both`,
          paddingTop:    grouped ? 'var(--msg-density-py)' : undefined,
          paddingBottom: grouped ? 'var(--msg-density-py)' : undefined,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setShowEmoji(false) }}
        onTouchStart={(e) => { longPress.onTouchStart(e); swipe.onTouchStart(e) }}
        onTouchMove={(e) => { longPress.onTouchMove(e); swipe.onTouchMove(e) }}
        onTouchEnd={() => { longPress.onTouchEnd(); swipe.onTouchEnd() }}
        onTouchCancel={() => { longPress.onTouchCancel(); swipe.onTouchCancel() }}
        onContextMenu={(e) => { if (longPress.didFire()) e.preventDefault() }}
      >
        {hovered && !isPending && !isBot && (
          <MessageToolbar
            isMine={isMine}
            isPinned={!!(message as any).pinned}
            isBookmarked={isBookmarked}
            onPickEmoji={() => setShowEmoji((v) => !v)}
            onReply={onReply ? () => onReply(message) : undefined}
            onCreateThread={() => setShowCreateThread(true)}
            onEdit={isMine ? () => setShowEdit(true) : undefined}
            onDelete={isMine ? () => setShowDeleteConfirm(true) : undefined}
            onTogglePin={() => handleTogglePin(!(message as any).pinned)}
            onToggleBookmark={() => toggleBookmark.mutate({ targetId: message.id, kind: 'message', action: isBookmarked ? 'delete' : 'create' })}
            onTranslate={() => setTranslatePicker((v) => !v)}
          />
        )}

        {showEmoji && <EmojiPicker onPick={handleReact} onClose={() => setShowEmoji(false)} />}

        {!grouped ? (
          isBot ? (
            <Avatar
              src={author.avatarUrl}
              name={author.displayName}
              color="var(--accent)"
              size={36}
              isBot
              onClick={handleAvatarClick}
            />
          ) : (
            <ProfileHoverCard userId={author.id} side="right" align="start">
              <span className="inline-block">
                <Avatar
                  src={author.avatarUrl}
                  name={author.displayName}
                  color={defaultColor(author.id)}
                  size={36}
                  onClick={handleAvatarClick}
                />
              </span>
            </ProfileHoverCard>
          )
        ) : (
          <div className="w-9 shrink-0 flex items-center justify-end">
            {hovered && !isPending && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap" style={{ fontFamily: 'var(--font-mono)' }}>
                {format(new Date(createdAt), 'HH:mm')}
              </span>
            )}
            {isPending && <Spinner />}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {!grouped && (
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span
                onClick={() => setProfileUserId(author.id)}
                className="cursor-pointer"
              >
                <AuthorName name={author.displayName} color={parsedColor} msgId={message.id} isBot={isBot} font={author.displayFont} />
              </span>
              {!isPending && (
                <span className="text-marg text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatTime(createdAt)}
                </span>
              )}
              {isPending && (
                <span className="inline-flex items-center gap-1">
                  <Spinner />
                  <span className="text-marg text-muted-foreground">enviando…</span>
                </span>
              )}
            </div>
          )}

          <div className="text-body leading-[1.65] text-foreground wrap-break-word m-0">
            {(message as any).pinned && (
              <span className="ed-marg inline-flex items-center gap-1 mb-1 text-(--accent)!">
                <Pin className="size-2.5" /> Mensagem fixada
              </span>
            )}
            {expiresAt && !(message as any).pinned && (
              <span className="ed-marg inline-flex items-center gap-1 mb-1 text-(--accent)" title={`Some em ${new Date(expiresAt).toLocaleString('pt-BR')}`}>
                ⏱ some {formatDistanceToNow(new Date(expiresAt), { locale: ptBR, addSuffix: true })}
              </span>
            )}

            {/* Reply quote (parent message preview) */}
            {(message as any).replyTo && (
              <div className="flex items-center gap-2 mb-1.5 text-[12px] text-(--text-3) border-l-2 border-(--accent)/50 pl-2 max-w-full">
                <CornerDownRight className="size-3 shrink-0 text-(--accent)/70" />
                <span
                  className="font-(family-name:--font-display) text-(--text-2) shrink-0"
                  style={{ color: 'var(--accent)' }}
                >
                  {(message as any).replyTo.authorName}
                </span>
                <span className="truncate italic">
                  {(message as any).replyTo.content}
                </span>
              </div>
            )}

            {content && renderContent(content, emojiMap)}

            {/* Picker de idioma (toggle abaixo do toolbar) */}
            {translatePicker && (
              <div className="mt-1.5 flex flex-wrap gap-1 p-1.5 border border-(--border) bg-(--overlay) w-fit max-w-full">
                {TRANSLATE_LANGS.map((l) => (
                  <button
                    key={l.code}
                    onClick={async () => {
                      try {
                        const out = await translate.mutateAsync({ messageId: message.id, text: content, targetLang: l.code })
                        setTranslation({ lang: l.code, text: out })
                        setTranslatePicker(false)
                      } catch (e: any) {
                        console.error('[translate]', e?.response?.data ?? e?.message)
                        toast.error(e?.response?.data?.error ?? 'Tradução falhou')
                      }
                    }}
                    className="px-2 py-1 text-xs text-(--text-2) hover:text-(--accent) hover:bg-(--raised)/40 transition-colors"
                  >{l.name}</button>
                ))}
              </div>
            )}

            {/* Inline translation */}
            {translation && (
              <div className="mt-1.5 border-l-2 border-(--accent)/50 pl-2.5 py-0.5">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Languages className="size-3 text-(--accent)" />
                  <span className="ed-marg text-(--accent)">
                    Traduzido · {TRANSLATE_LANGS.find((l) => l.code === translation.lang)?.name}
                  </span>
                  <button
                    onClick={() => setTranslation(null)}
                    className="ml-auto text-[10px] text-(--text-3) hover:text-foreground transition-colors"
                  >ocultar</button>
                </div>
                <p className="text-[14px] text-foreground m-0 leading-relaxed">{translation.text}</p>
              </div>
            )}

            {message.edited && !isPending && (
              <span className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setShowEditHistory(true)}
                  className="ed-marg ml-2 cursor-pointer hover:text-(--accent) transition-colors"
                  title="Ver histórico de edições"
                >
                  (editada)
                </button>
                {showEditHistory && (
                  <EditHistoryPopover
                    channelId={(message as any).channelId}
                    messageId={message.id}
                    currentContent={content}
                    onClose={() => setShowEditHistory(false)}
                  />
                )}
              </span>
            )}
          </div>

          {/* Poll card (se mensagem é uma enquete) */}
          {(message as any).poll && (
            <PollCard
              channelId={(message as any).channelId}
              messageId={message.id}
              poll={(message as any).poll}
              canClose={isMine}
            />
          )}

          <MessageAttachments
            attachments={(message as any).attachments ?? []}
            onOpenImage={(idx) => setLightboxIdx(idx)}
          />

          <MessageReactions reactions={reactions} onReact={handleReact} />
        </div>
      </div>
      </EditorialContextMenu>

      <MessageMobileActions
        open={showMobileActions}
        onClose={() => setShowMobileActions(false)}
        isMine={isMine}
        isPinned={!!(message as any).pinned}
        isBookmarked={isBookmarked}
        authorName={author.displayName}
        contentPreview={content}
        onPickEmoji={() => setShowEmoji(true)}
        onReply={() => onReply?.(message)}
        onCreateThread={() => setShowCreateThread(true)}
        onEdit={isMine ? () => setShowEdit(true) : undefined}
        onTogglePin={() => handleTogglePin(!(message as any).pinned)}
        onToggleBookmark={() => toggleBookmark.mutate({ targetId: message.id, kind: 'message', action: isBookmarked ? 'delete' : 'create' })}
        onDelete={isMine ? () => setShowDeleteConfirm(true) : undefined}
        onCopy={() => navigator.clipboard.writeText(content).catch(() => {})}
      />

      {/* Dialogs renderizam só quando abertos — antes ficavam montados em
          TODAS as N msgs visíveis (3 dialogs × 20 msgs = 60 árvores Radix
          ociosas). Agora paga só na hora do click. */}
      {showCreateThread && (
        <CreateThreadDialog
          open={showCreateThread}
          onClose={() => setShowCreateThread(false)}
          onCreate={handleCreateThread}
        />
      )}

      {showEdit && (
        <EditModal
          open={showEdit}
          content={content}
          onSave={handleEdit}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showDeleteConfirm && (
        <DeleteConfirm
          open={showDeleteConfirm}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Profile card — shown when avatar or name is clicked */}
      {profileUserId && (
        <ProfileCard
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
        />
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && (() => {
        const all = ((message as any).attachments ?? []) as Array<{ url: string; type: string; name: string; size: number }>
        const images = all.filter((a) => a.type.startsWith('image/'))
        return (
          <Lightbox
            images={images}
            index={lightboxIdx}
            onClose={() => setLightboxIdx(null)}
            onNavigate={(i) => setLightboxIdx(i)}
          />
        )
      })()}

      <style>{`@keyframes msgSpin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}

// Memo: MessageList renderiza N mensagens; sem memo qualquer re-render
// (typing, scroll, query refetch) re-renderiza todo MessageItem.
// Default shallow compare — message ref é estável pela cache do React Query.
const MessageItem = memo(MessageItemImpl)
export default MessageItem
