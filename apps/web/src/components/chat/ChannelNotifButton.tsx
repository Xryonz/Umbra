/**
 * Bell icon no channel header → dropdown 3-state pra mode de notif.
 * Lê/grava via useChannelNotifPref (React Query). Optimistic update.
 */
import { Bell, BellOff, AtSign, Check } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  useChannelNotifPref, useSetChannelNotifPref,
  type ChannelNotifMode,
} from '@/hooks/useChannelNotifPref'

interface Props { channelId: string }

const OPTIONS: { id: ChannelNotifMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'all',      label: 'Todas as mensagens', hint: 'Notifica qualquer envio',                icon: <Bell    className="size-3.5" /> },
  { id: 'mentions', label: 'Só @menções',         hint: 'Notifica quando te mencionarem',         icon: <AtSign  className="size-3.5" /> },
  { id: 'mute',     label: 'Silenciar canal',     hint: 'Não notifica nada (sidebar dim)',        icon: <BellOff className="size-3.5" /> },
]

export default function ChannelNotifButton({ channelId }: Props) {
  const current = useChannelNotifPref(channelId)
  const set     = useSetChannelNotifPref()

  // Ícone reflete o modo atual
  const Icon = current === 'mute' ? BellOff : current === 'mentions' ? AtSign : Bell
  const title =
    current === 'mute'     ? 'Notificações: silenciado'
    : current === 'mentions' ? 'Notificações: só menções'
    :                          'Notificações: todas'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="size-10 sm:size-8 flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
          aria-label={title}
          title={title}
        >
          <Icon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => { set.mutate({ channelId, mode: o.id }) }}
            className="flex items-start gap-3 py-2"
          >
            <span className="text-(--text-3) mt-0.5">{o.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm">{o.label}</span>
              <span className="block text-[11px] text-(--text-3)">{o.hint}</span>
            </span>
            {current === o.id && <Check className="size-3.5 text-(--accent) mt-1" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
