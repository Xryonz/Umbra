/**
 * CommandPalette — migrado para shadcn Command (cmdk).
 *
 * Ganhos vs versão anterior:
 *  - Arrow keys nav nativa (↑/↓ entre seções, ↵ executa)
 *  - Filtering local trivial (mas mantemos backend search via API)
 *  - Animação de seleção fluida
 *  - Acessibilidade ARIA out-of-the-box
 *
 * Mantém: debounce 220ms, busca no backend (mensagens/canais/users/servers),
 * navegação via state + close.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Hash, Users as UsersIcon, MessageSquare } from 'lucide-react'
import { api } from '@/lib/api'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command'
import { Spinner } from '@/components/ui/spinner'
import { useUIStore } from '@/store/uiStore'

interface SearchResults {
  messages: Array<{ id: string; content: string; channelId: string; channelName: string; serverId: string; serverName: string; author: { displayName: string; avatarUrl: string|null } }>
  channels: Array<{ id: string; name: string; serverId: string; serverName: string }>
  users:    Array<{ id: string; username: string; displayName: string; avatarUrl: string|null }>
  servers:  Array<{ id: string; name: string; iconUrl: string|null; isGroup: boolean }>
}

function useDebounce<T>(v: T, ms = 200) {
  const [out, setOut] = useState(v)
  useEffect(() => { const t = setTimeout(() => setOut(v), ms); return () => clearTimeout(t) }, [v, ms])
  return out
}

export default function CommandPalette() {
  const open      = useUIStore((s) => s.commandPaletteOpen)
  const close     = useUIStore((s) => s.closeCommandPalette)
  const navigate  = useNavigate()
  const [q, setQ] = useState('')
  const debounced = useDebounce(q, 220)

  useEffect(() => { if (!open) setQ('') }, [open])

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ['search', debounced],
    queryFn:  async () => (await api.get(`/api/search?q=${encodeURIComponent(debounced)}`)).data.data,
    enabled:  debounced.length >= 2,
    staleTime: 30_000,
  })

  const go = (path: string, state?: any) => {
    navigate(path, state ? { state } : undefined)
    close()
  }

  const isEmpty = !!data
    && data.messages.length === 0
    && data.channels.length === 0
    && data.users.length === 0
    && data.servers.length === 0

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Buscar"
      description="Procure mensagens, canais, pessoas e servidores"
    >
      {/* cmdk filtering off (delegado ao backend). Arrow-keys nav segue funcionando */}
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder="Procurar mensagens, canais, pessoas, servidores…"
      />
      <CommandList>
        {/* Hints quando ainda não digitou o suficiente */}
        {q.length < 2 && (
          <div className="px-5 py-10 text-center text-(--text-3) text-sm">
            <p className="m-0 mb-1">Digite ao menos <strong className="text-(--text-2)">2 caracteres</strong></p>
            <p className="m-0 text-xs">Busca mensagens, canais e pessoas dos seus servidores</p>
          </div>
        )}

        {q.length >= 2 && isFetching && (
          <div className="px-5 py-10 flex items-center justify-center gap-2 text-sm text-(--text-3)">
            <Spinner size={14} /> Buscando…
          </div>
        )}

        {q.length >= 2 && !isFetching && isEmpty && (
          <CommandEmpty>
            Nada encontrado pra <em className="text-(--text-2) not-italic">"{q}"</em>
          </CommandEmpty>
        )}

        {data && data.servers.length > 0 && (
          <CommandGroup heading="Servidores">
            {data.servers.map((s) => (
              <CommandItem key={s.id} value={`server-${s.id}-${s.name}`} onSelect={() => go('/app')}>
                <div className="size-6 border border-(--border) bg-(--raised) flex items-center justify-center overflow-hidden text-[10px] font-bold shrink-0">
                  {s.iconUrl
                    ? <img src={s.iconUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    : <span style={{ fontFamily: 'var(--font-display)' }}>{s.name.slice(0, 2).toUpperCase()}</span>}
                </div>
                <span className="flex-1 truncate">{s.name}</span>
                {s.isGroup && <UsersIcon className="text-(--text-3)" />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {data && data.channels.length > 0 && (
          <CommandGroup heading="Canais">
            {data.channels.map((c) => (
              <CommandItem
                key={c.id}
                value={`channel-${c.id}-${c.name}`}
                onSelect={() => go('/app', { id: c.id, name: c.name, serverId: c.serverId })}
              >
                <Hash className="text-(--text-3)" />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-marg text-(--text-3) font-mono truncate max-w-32">{c.serverName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {data && data.users.length > 0 && (
          <CommandGroup heading="Pessoas">
            {data.users.map((u) => (
              <CommandItem
                key={u.id}
                value={`user-${u.id}-${u.username}`}
                onSelect={async () => {
                  try {
                    const res = await api.post(`/api/dm/open/${u.username}`)
                    const { conversationId, otherUser } = res.data.data
                    go('/app/dm', { conversationId, otherUser })
                  } catch {
                    close()
                  }
                }}
              >
                <div className="size-6 rounded-full overflow-hidden border border-(--border) shrink-0 bg-(--raised) flex items-center justify-center text-[10px] font-bold">
                  {u.avatarUrl
                    ? <img src={u.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    : u.displayName.slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate">{u.displayName}</span>
                <span className="text-marg text-(--text-3) font-mono truncate">@{u.username}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {data && data.messages.length > 0 && (
          <CommandGroup heading="Mensagens">
            {data.messages.map((m) => (
              <CommandItem
                key={m.id}
                value={`msg-${m.id}-${m.content.slice(0, 30)}`}
                onSelect={() => go('/app', { id: m.channelId, name: m.channelName, serverId: m.serverId })}
              >
                <MessageSquare className="text-(--text-3) mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-marg font-mono text-(--text-3) truncate">
                      {m.serverName} · #{m.channelName} · {m.author.displayName}
                    </span>
                  </div>
                  <p className="text-sm text-(--text-2) m-0 line-clamp-2 wrap-break-word">{m.content}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>

      {/* Footer com atalhos */}
      <div className="border-t border-(--border) px-4 py-2 flex items-center gap-3 text-marg text-(--text-3) font-mono">
        <span><CommandShortcut className="ml-0">↑↓</CommandShortcut> navegar</span>
        <span><CommandShortcut className="ml-0">↵</CommandShortcut> abrir</span>
        <span><CommandShortcut className="ml-0">esc</CommandShortcut> fechar</span>
        <span className="ml-auto opacity-60">Umbra · Busca global</span>
      </div>
    </CommandDialog>
  )
}
