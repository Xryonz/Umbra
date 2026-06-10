import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MessageWithAuthor, PaginatedResponse } from '@astra/types'

/**
 * Fetcher da primeira página de mensagens — compartilhado entre o
 * useInfiniteQuery do MessageList e o prefetch da Sidebar (mesma queryKey
 * + mesmo fetcher = cache hit garantido).
 */
export async function fetchMessagesPage(
  channelId: string, cursor?: string,
): Promise<PaginatedResponse<MessageWithAuthor>> {
  const params = new URLSearchParams({ limit: '30' })
  if (cursor) params.set('cursor', cursor)
  const res = await api.get(`/api/channels/${channelId}/messages?${params}`)
  return res.data.data as PaginatedResponse<MessageWithAuthor>
}

/**
 * Prefetch no touchstart/mouseenter do item de canal: o dedo encosta
 * ~100ms antes do click disparar — a request sai nesse vão e o canal
 * abre com as mensagens já chegando (ou já em cache).
 * No-op se a query já está fresh (React Query dedupa).
 */
export function prefetchChannelMessages(qc: QueryClient, channelId: string): void {
  void qc.prefetchInfiniteQuery({
    queryKey: ['messages', channelId],
    queryFn: ({ pageParam }) => fetchMessagesPage(channelId, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    staleTime: 15_000,
  })
}
