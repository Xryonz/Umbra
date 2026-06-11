/**
 * DMList — lista de conversas DM em estilo editorial.
 *
 * Antes: CSS inline com magic numbers, avatares circulares tintados,
 * preview cinza padrão.
 *
 * Agora: hairline list shadcn-style, tipografia mista (serif display +
 * mono timestamp + body preview), presence dot minimal, "Diga olá!" em
 * italic accent quando vazia, context menu (right-click) por item.
 */
import { useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, MailOpen, BellOff, MessageCircle } from 'lucide-react'
import { api, resolveApiUrl } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { setDmShortcuts } from '@/lib/native'
import { usePresenceStore } from '@/store/presenceStore'
import { memo } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import ConstellationEmpty from '@/components/astra/ConstellationEmpty'
import { EditorialContextMenu, type EditorialMenuItem } from '@/components/EditorialContextMenu'
import { DMListSkeleton } from '@/components/skeletons/DMListSkeleton'
import { cn } from '@/lib/utils'

interface OtherUser {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

interface DMConversation {
  id: string
  otherUser: OtherUser
  lastMessage: { content: string; createdAt: string } | null
  updatedAt: string
}

interface DMListProps {
  activeDMId: string | null
  onSelectDM: (dm: { conversationId: string; otherUser: OtherUser }) => void
}

function formatPreviewTime(d: string) {
  const date = new Date(d)
  if (isToday(date))     return format(date, 'HH:mm')
  if (isYesterday(date)) return 'ontem'
  return format(date, "d MMM", { locale: ptBR })
}

const PRESENCE_DOT: Record<string, string> = {
  ONLINE:    'bg-(--success)',
  IDLE:      'bg-yellow-500',
  DND:       'bg-(--danger)',
  OFFLINE:   'bg-(--text-3)',
  INVISIBLE: 'bg-(--text-3)',
}

export default function DMList({ activeDMId, onSelectDM }: DMListProps) {
  const queryClient = useQueryClient()

  const { data: conversations = [], isLoading } = useQuery<DMConversation[]>({
    queryKey: ['dm-list'],
    queryFn:  async () => (await api.get('/api/dm')).data.data,
    staleTime: 20_000,
  })

  // App nativo: long-press no ícone mostra as 3 DMs mais recentes
  useEffect(() => {
    setDmShortcuts(conversations.slice(0, 3).map((c) => ({
      id: c.id, title: c.otherUser.displayName,
    })))
  }, [conversations])

  // Real-time: invalida lista quando chega DM nova
  useEffect(() => {
    let socket: ReturnType<typeof getSocket>
    try { socket = getSocket() } catch { return }
    const onNewDM = () => queryClient.invalidateQueries({ queryKey: ['dm-list'] })
    socket.on('new_dm', onNewDM)
    return () => { socket.off('new_dm', onNewDM) }
  }, [queryClient])

  const markRead = useMutation({
    mutationFn: async (convId: string) =>
      api.post(`/api/dm/${convId}/read`).catch(() => {/* endpoint pode não existir, ignora */}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dm-list'] }),
  })

  if (isLoading) return <DMListSkeleton />

  if (conversations.length === 0) {
    return (
      <ConstellationEmpty
        title="Nenhuma estrela à vista"
        description="Abra o perfil de alguém ou aceite um pedido pra começar."
        className="flex-1"
      />
    )
  }

  return (
    <ScrollArea className="flex-1">
      <ul className="flex flex-col">
        {conversations.map((conv, i) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isActive={conv.id === activeDMId}
            delay={Math.min(i * 0.025, 0.25)}
            onSelect={() => onSelectDM({ conversationId: conv.id, otherUser: conv.otherUser })}
            onMarkRead={() => markRead.mutate(conv.id)}
          />
        ))}
      </ul>
    </ScrollArea>
  )
}

/**
 * Memoizado + subscreve presence apenas do otherUserId.
 * Antes: presenceMap inteira no parent → cada tick de presence (qualquer user)
 * re-renderizava todos os itens. Agora cada item ouve só sua chave.
 */
const ConversationItem = memo(function ConversationItem({
  conv, isActive, delay, onSelect, onMarkRead,
}: {
  conv:       DMConversation
  isActive:   boolean
  delay:      number
  onSelect:   () => void
  onMarkRead: () => void
}) {
  // Selector fino — Zustand só notifica este item quando a presence DESTE user mudar
  const presence = usePresenceStore((s) => s.others[conv.otherUser.id] ?? 'OFFLINE')
  // Context menu por item — Editorial
  const items: EditorialMenuItem[] = useMemo(() => [
    { kind: 'label', label: conv.otherUser.displayName },
    { kind: 'item', icon: <MessageCircle className="size-3.5" />, label: 'Abrir conversa', onSelect },
    { kind: 'item', icon: <MailOpen     className="size-3.5" />, label: 'Marcar como lida', onSelect: onMarkRead },
    { kind: 'separator' },
    { kind: 'item', icon: <BellOff      className="size-3.5" />, label: 'Silenciar (em breve)', disabled: true, onSelect: () => {} },
    { kind: 'item', icon: <Trash2       className="size-3.5" />, label: 'Ocultar (em breve)',   disabled: true, destructive: true, onSelect: () => {} },
  ], [conv.otherUser.displayName, onSelect, onMarkRead])

  return (
    <EditorialContextMenu items={items}>
      <li>
        <button
          onClick={onSelect}
          style={{ animation: `fadeLeft 0.28s var(--ease-spring) ${delay}s both` }}
          className={cn(
            'group relative w-full flex items-start gap-3 px-3 py-2.5 text-left',
            'border-l-2 border-transparent transition-colors',
            isActive
              ? 'bg-(--accent-dim) border-(--accent)'
              : 'hover:bg-(--raised)/40 hover:border-(--border-bright)',
          )}
        >
          {/* Avatar híbrido: foto se tem, senão fallback editorial (sem tinta colorida) */}
          <div className="relative shrink-0">
            <Avatar className="size-9 border border-(--border-mid)">
              {conv.otherUser.avatarUrl && (
                <AvatarImage src={resolveApiUrl(conv.otherUser.avatarUrl)} alt={conv.otherUser.displayName} />
              )}
              <AvatarFallback className="bg-(--raised) text-(--text-2) text-xs font-(family-name:--font-display)">
                {conv.otherUser.displayName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-(--base)',
                PRESENCE_DOT[presence] ?? 'bg-(--text-3)',
              )}
              aria-hidden
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 leading-tight">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'text-sm font-medium truncate',
                  isActive ? 'text-(--accent-h)' : 'text-foreground',
                )}
                style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '14px' }}
              >
                {conv.otherUser.displayName}
              </span>
              {conv.lastMessage && (
                <span className="text-[10px] font-mono text-(--text-3) shrink-0">
                  {formatPreviewTime(conv.lastMessage.createdAt)}
                </span>
              )}
            </div>
            <p
              className={cn(
                'text-xs m-0 truncate mt-0.5',
                conv.lastMessage ? 'text-(--text-3)' : 'text-(--accent) italic',
              )}
            >
              {conv.lastMessage?.content ?? '— Diga olá!'}
            </p>
          </div>
        </button>
      </li>
    </EditorialContextMenu>
  )
})
