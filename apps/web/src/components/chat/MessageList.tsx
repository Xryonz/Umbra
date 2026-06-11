import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Hash, Feather } from 'lucide-react'
import { api } from '@/lib/api'
import { fetchMessagesPage } from '@/lib/prefetch'
import { hydrateChannelFromCache } from '@/lib/messageCache'
import { useChannel } from '@/hooks/useSocket'
import { useUnread } from '@/hooks/useUnread'
import MessageItem from './MessageItem'
import { MessageListSkeleton } from '@/components/skeletons/MessageListSkeleton'
import { Empty, EmptyIcon, EmptyLabel, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import type { MessageWithAuthor } from '@astra/types'

// Optimistic messages have this extra field
type OptimisticMessage = MessageWithAuthor & { optimisticId?: string; isPending?: boolean }

interface MessageListProps {
  channelId:   string
  channelName: string
  serverId?:   string
  // Exposed so AppPage can wire up MessageInput callbacks
  onRegisterOptimistic: (
    add:     (msg: OptimisticMessage) => void,
    remove:  (id: string) => void,
    confirm: (optimisticId: string, msg: MessageWithAuthor) => void,
  ) => void
  onReply?: (msg: MessageWithAuthor) => void
}

export default function MessageList({
  channelId, channelName, serverId, onRegisterOptimistic, onReply,
}: MessageListProps) {
  const queryClient = useQueryClient()
  const scrollRef   = useRef<HTMLDivElement>(null)
  const topRef      = useRef<HTMLDivElement>(null)
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true)
  const [optimisticMsgs, setOptimisticMsgs] = useState<OptimisticMessage[]>([])

  // Register callbacks so AppPage can pass them to MessageInput
  const addOptimistic = useCallback((msg: OptimisticMessage) => {
    setOptimisticMsgs((prev) => [...prev, { ...msg, isPending: true }])
    setShouldScrollToBottom(true)
  }, [])

  const removeOptimistic = useCallback((optimisticId: string) => {
    setOptimisticMsgs((prev) => prev.filter((m) => m.optimisticId !== optimisticId))
  }, [])

  // Registro movido pra depois do handleNewMessage (precisa dele pro confirm)

  // Reset optimistic messages when switching channels.
  // Virtualizer cuida do scroll-to-bottom via useLayoutEffect abaixo.
  useEffect(() => {
    setOptimisticMsgs([])
    setShouldScrollToBottom(true)
  }, [channelId])

  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading,
  } = useInfiniteQuery({
    queryKey: ['messages', channelId],
    // Fetcher compartilhado com prefetchChannelMessages (Sidebar touchstart)
    queryFn: ({ pageParam }) => fetchMessagesPage(channelId, pageParam as string | undefined),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  })

  // Offline: sem nada em memória, hidrata a 1ª página do IndexedDB
  // (entra stale → revalida por trás se houver rede).
  useEffect(() => {
    void hydrateChannelFromCache(queryClient, channelId)
  }, [queryClient, channelId])

  // Members + topColor pra colorir nome do autor pelo role mais alto
  const { data: membersData = [] } = useQuery<Array<{ userId: string; topColor: string|null }>>({
    queryKey: ['members', serverId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/members`)).data.data,
    enabled:  !!serverId,
    staleTime: 30_000,
  })
  // Map é referencialmente estável enquanto membersData não muda → evita
  // recriação a cada render do MessageList (que dispararia mismatch em filhos).
  const colorByUser = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of membersData) if (x.topColor) m.set(x.userId, x.topColor)
    return m
  }, [membersData])

  // Achata as pages só quando elas mudam — não a cada socket tick que mexe em outro state.
  const confirmedMessages = useMemo(
    () => data?.pages.slice().reverse().flatMap((p) => p.items) ?? [],
    [data?.pages],
  )

  // When a real message arrives via socket, remove its matching optimistic version.
  // Dedup exato via clientNonce; fallback heurístico só pra payloads legados sem nonce.
  const handleNewMessage = useCallback((msg: MessageWithAuthor & { clientNonce?: string|null }) => {
    setOptimisticMsgs((prev) => {
      if (msg.clientNonce) return prev.filter((o) => o.optimisticId !== msg.clientNonce)
      return prev.filter(
        (o) =>
          !(
            o.author.id === msg.author.id &&
            o.content   === msg.content   &&
            Math.abs(new Date(msg.createdAt).getTime() - new Date(o.createdAt).getTime()) < 5000
          )
      )
    })

    queryClient.setQueryData(['messages', channelId], (old: any) => {
      if (!old) return old
      const [first, ...rest] = old.pages
      // Deduplicate — don't add if already in cache (e.g. from previous render)
      if (first.items.some((m: MessageWithAuthor) => m.id === msg.id)) return old
      return { ...old, pages: [{ ...first, items: [...first.items, msg] }, ...rest] }
    })
    setShouldScrollToBottom(true)
  }, [channelId, queryClient])

  // Registra callbacks pro MessageInput (via AppPage). confirm injeta o
  // clientNonce e reusa handleNewMessage — remoção exata da otimista +
  // dedup por id (o eco de broadcast que chegar depois vira no-op).
  useEffect(() => {
    onRegisterOptimistic(
      addOptimistic,
      removeOptimistic,
      (optimisticId, msg) => handleNewMessage({ ...msg, clientNonce: optimisticId }),
    )
  }, [onRegisterOptimistic, addOptimistic, removeOptimistic, handleNewMessage])

  // Edit: update matching item in cache, keep position
  const handleMessageEdited = useCallback(
    (p: { messageId: string; content: string; edited: boolean }) => {
      queryClient.setQueryData(['messages', channelId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((m: MessageWithAuthor) =>
              m.id === p.messageId ? { ...m, content: p.content, edited: p.edited } : m
            ),
          })),
        }
      })
    },
    [channelId, queryClient],
  )

  // Delete: filter out item from all pages
  const handleMessageDeleted = useCallback(
    (p: { messageId: string }) => {
      queryClient.setQueryData(['messages', channelId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.filter((m: MessageWithAuthor) => m.id !== p.messageId),
          })),
        }
      })
    },
    [channelId, queryClient],
  )

  // Pin: toggle pinned flag in cache + invalidate pinned list
  const handleMessagePinned = useCallback(
    (p: { messageId: string; pinned: boolean }) => {
      queryClient.setQueryData(['messages', channelId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((m: any) =>
              m.id === p.messageId ? { ...m, pinned: p.pinned } : m
            ),
          })),
        }
      })
      queryClient.invalidateQueries({ queryKey: ['pinned', channelId] })
    },
    [channelId, queryClient],
  )

  // Reactions: substitui o array de reactions da mensagem alvo
  const handleReactionUpdate = useCallback(
    (p: { messageId: string; reactions: Array<{ emoji: string; count: number; users: string[] }> }) => {
      queryClient.setQueryData(['messages', channelId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((m: any) =>
              m.id === p.messageId ? { ...m, reactions: p.reactions } : m
            ),
          })),
        }
      })
    },
    [channelId, queryClient],
  )

  // Poll vote/close: atualiza poll inline na mensagem-poll alvo
  const handlePollUpdated = useCallback(
    (p: { messageId: string; poll: unknown }) => {
      queryClient.setQueryData(['messages', channelId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((m: any) =>
              m.id === p.messageId ? { ...m, poll: p.poll } : m
            ),
          })),
        }
      })
    },
    [channelId, queryClient],
  )

  useChannel(channelId, {
    onNewMessage:     handleNewMessage,
    onMessageEdited:  handleMessageEdited,
    onMessageDeleted: handleMessageDeleted,
    onMessagePinned:  handleMessagePinned,
    onReactionUpdate: handleReactionUpdate,
    onPollUpdated:    handlePollUpdated,
  })

  // Mark-as-read: ao montar/trocar canal (1.5s debounce pra evitar spam em
  // navegação rápida) + a cada nova msg recebida enquanto canal tá ativo.
  const { markRead } = useUnread()
  useEffect(() => {
    const t = setTimeout(() => { void markRead(channelId) }, 1500)
    return () => clearTimeout(t)
  }, [channelId, confirmedMessages.length, markRead])

  // Merge confirmed + optimistic — sem map de authorColor (movido pro
  // MessageItem, recebe colorByUser como prop). Evita iterar N msgs a cada
  // mudança. Ref de cada msg fica idêntica à do cache → memo do MessageItem
  // bate até em renders por socket events de outras msgs.
  const allMessages = useMemo<MessageWithAuthor[]>(
    () => [...confirmedMessages, ...optimisticMsgs],
    [confirmedMessages, optimisticMsgs],
  )

  // ── Virtualização ─────────────────────────────────────────
  // Renderiza só ~20 mensagens visíveis em vez das ~500 que podem estar carregadas.
  // estimateSize: 84px é a média grosseira; useVirtualizer mede o real depois com
  // ResizeObserver via measureElement, então a estimativa só importa pro tamanho
  // inicial do scrollbar — não atrapalha se errar.
  const virtualizer = useVirtualizer({
    count: allMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 100,  // média mais realista (84 era otimista demais)
    overscan: 5,              // 5 acima/baixo é suficiente; 8 inflava DOM em scroll rápido
    getItemKey: (i) => (allMessages[i] as OptimisticMessage).optimisticId ?? allMessages[i].id,
  })

  // Auto-scroll pro fim quando user manda msg ou abre canal.
  // useLayoutEffect = scroll imediato ANTES do paint (evita "salta" visual).
  useLayoutEffect(() => {
    if (!shouldScrollToBottom || allMessages.length === 0) return
    virtualizer.scrollToIndex(allMessages.length - 1, { align: 'end' })
  }, [allMessages.length, shouldScrollToBottom, virtualizer])

  // Teclado nativo abriu: se estava perto do fim, gruda no fim de novo —
  // o resize do WebView deixava a última mensagem atrás do composer.
  useEffect(() => {
    const onKb = () => {
      const el = scrollRef.current
      if (!el || allMessages.length === 0) return
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      if (dist < 200) virtualizer.scrollToIndex(allMessages.length - 1, { align: 'end' })
    }
    window.addEventListener('astra:kb-shown', onKb)
    return () => window.removeEventListener('astra:kb-shown', onKb)
  }, [virtualizer, allMessages.length])

  // Infinite scroll — IntersectionObserver no sentinel topo
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
          setShouldScrollToBottom(false)
        }
      },
      { threshold: 0.1 },
    )
    if (topRef.current) observer.observe(topRef.current)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) return <MessageListSkeleton />


  // Empty state — fora do virtualizer (não tem linhas pra virtualizar)
  if (allMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Empty className="max-w-md">
          <EmptyIcon className="size-16 border border-(--border) bg-(--raised)/40 grid place-items-center">
            <Hash className="size-7 text-(--accent)" />
          </EmptyIcon>
          <EmptyLabel>— Página em branco</EmptyLabel>
          <EmptyTitle className="text-2xl">
            Bem-vindo a <span className="italic text-(--accent)">#{channelName}</span>
          </EmptyTitle>
          <EmptyDescription>
            Este é o começo desta conversa. Ninguém escreveu aqui ainda.
          </EmptyDescription>
          <div className="mt-4 flex items-center gap-2 text-xs text-(--text-3) font-mono">
            <Feather className="size-3" /> Seja o primeiro a deixar uma linha.
          </div>
        </Empty>
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()

  // astra-smooth-scroll: behavior smooth + overscroll contain.
  // astra-feed-scroll: declara scroll-timeline --astra-feed pro
  // parallax do StarField consumir (em SPA, body não scrolla).
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto astra-smooth-scroll astra-feed-scroll">
      {/* Sentinel topo: dispara fetchNextPage qd visível */}
      <div ref={topRef} className="h-1" />

      {isFetchingNextPage && (
        <div className="flex justify-center py-2.5">
          <div
            className="size-5 rounded-full border-2 border-border animate-spin"
            style={{ borderTopColor: 'var(--accent)' }}
          />
        </div>
      )}

      {!hasNextPage && (
        <div className="px-5 pt-8 pb-6 border-b border-border mb-2">
          <div className="size-13 bg-card border border-border rounded-xl flex items-center justify-center mb-3">
            <span className="text-xl font-bold text-primary">#</span>
          </div>
          <h3 className="text-xl font-normal text-foreground mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Início de <em className="text-primary">#{channelName}</em>
          </h3>
          <p className="text-sm text-muted-foreground m-0">Este é o começo desta conversa.</p>
        </div>
      )}

      {/* Inner container do virtualizer — height total simulado por absolute children */}
      <div
        className="relative px-3 pb-2"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {items.map((row) => {
          const msg     = allMessages[row.index]
          const prev    = allMessages[row.index - 1]
          const grouped =
            prev?.author.id === msg.author.id &&
            new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000

          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              style={{
                position: 'absolute',
                top:      0,
                left:     0,
                right:    0,
                transform: `translateY(${row.start}px)`,
                // Isola o layout de cada row: emoji/imagem carregando numa
                // mensagem não força re-layout das vizinhas. Sem `paint`
                // (cliparia hover cards que escapam do row).
                contain:  'layout',
              }}
            >
              <MessageItem
                message={msg}
                grouped={grouped}
                delay={0}
                isPending={(msg as OptimisticMessage).isPending}
                roleColor={colorByUser.get(msg.author.id) ?? null}
                onReply={onReply}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}