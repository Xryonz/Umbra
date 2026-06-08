/**
 * Per-channel notification preference: 'all' | 'mentions' | 'mute'.
 * Sem row no backend = 'all' (default). Cliente cacheia tudo em uma
 * Map<channelId, mode> via React Query.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type ChannelNotifMode = 'all' | 'mentions' | 'mute'

interface PrefRow { channelId: string; mode: ChannelNotifMode }

export function useChannelNotifPrefs() {
  return useQuery<Map<string, ChannelNotifMode>>({
    queryKey: ['channel-notif-prefs'],
    queryFn: async () => {
      const { data } = await api.get<{ data: PrefRow[] }>('/api/channels/notification-prefs')
      const m = new Map<string, ChannelNotifMode>()
      for (const r of data.data) m.set(r.channelId, r.mode)
      return m
    },
    staleTime: 5 * 60_000,
  })
}

export function useChannelNotifPref(channelId?: string | null): ChannelNotifMode {
  const { data } = useChannelNotifPrefs()
  if (!channelId) return 'all'
  return data?.get(channelId) ?? 'all'
}

export function useSetChannelNotifPref() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ channelId, mode }: { channelId: string; mode: ChannelNotifMode }) => {
      if (mode === 'all') {
        await api.delete(`/api/channels/${channelId}/notification-pref`)
      } else {
        await api.put(`/api/channels/${channelId}/notification-pref`, { mode })
      }
      return { channelId, mode }
    },
    onMutate: async ({ channelId, mode }) => {
      // Optimistic — UI já mostra mudança antes do server confirmar
      const prev = qc.getQueryData<Map<string, ChannelNotifMode>>(['channel-notif-prefs'])
      const next = new Map(prev ?? [])
      if (mode === 'all') next.delete(channelId)
      else next.set(channelId, mode)
      qc.setQueryData(['channel-notif-prefs'], next)
      return { prev }
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['channel-notif-prefs'], ctx.prev)
    },
  })
}
