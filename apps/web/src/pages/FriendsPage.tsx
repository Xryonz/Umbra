/**
 * FriendsPage — editorial polish.
 *
 * Header serif renaissance com Reveal stagger; lista hairline shadcn-style;
 * context menu (right-click) por amigo com ações DM/mencionar/remover.
 * Acesso via /app/friends.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserPlus, Check, X, Inbox, Send, UserMinus, MessageCircle, AtSign, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/sonner'
import { Reveal } from '@/components/anim/Reveal'
import { useConfirm } from '@/hooks/useConfirm'
import { EditorialContextMenu, type EditorialMenuItem } from '@/components/EditorialContextMenu'
import ConstellationEmpty from '@/components/astra/ConstellationEmpty'
import {
  useFriends, useFriendRequests, useFriendOutgoing,
  useSendFriendRequest, useAcceptFriend, useRemoveFriend,
  type FriendEntry, type PendingEntry,
} from '@/hooks/useFriends'
import { resolveApiUrl, api } from '@/lib/api'
import { cn } from '@/lib/utils'

const PRESENCE_LABEL: Record<string, string> = {
  ONLINE: 'Online', IDLE: 'Ausente', DND: 'Ocupado', OFFLINE: 'Offline', INVISIBLE: 'Offline',
}
const PRESENCE_DOT: Record<string, string> = {
  ONLINE: 'bg-(--success)', IDLE: 'bg-yellow-500', DND: 'bg-(--danger)', OFFLINE: 'bg-(--text-3)', INVISIBLE: 'bg-(--text-3)',
}

export default function FriendsPage() {
  const [tab, setTab] = useState<'friends' | 'pending' | 'add'>('friends')
  const friends      = useFriends()
  const requests     = useFriendRequests()
  const outgoing     = useFriendOutgoing()

  const onlineCount  = (friends.data ?? []).filter((f) => f.presence === 'ONLINE').length
  const pendingCount = (requests.data ?? []).length

  return (
    <div className="flex-1 min-w-0 h-full overflow-y-auto relative">
      <div className="ed-vignette" />

      {/* Coluna central — sem rótulos verticais nem capítulo (modo minimalista) */}
      <div className="grid grid-cols-12 gap-6 px-6 sm:px-10 lg:px-16 py-12 max-w-6xl mx-auto relative">
        <div className="col-span-12 md:col-start-2 md:col-span-10">
          <header className="mb-10">
            <Reveal delay={0.18}>
              <h1 className="ed-h text-4xl sm:text-5xl m-0 leading-[1.05]">
                Estrelas
              </h1>
            </Reveal>
            <Reveal delay={0.28}>
              <h1 className="ed-h text-4xl sm:text-5xl m-0 italic text-(--accent) leading-[1.05]">
                no seu céu.
              </h1>
            </Reveal>
            <Reveal delay={0.42}>
              <div className="ed-hr-accent w-20 my-6" />
            </Reveal>
            <Reveal delay={0.50}>
              <p className="ed-lede max-w-[44ch] text-(--text-2) m-0">
                Cada amizade aqui é uma estrela alinhada. Aceite pedidos, envie outros, ou alinhe novas pela coordenada.
              </p>
            </Reveal>
          </header>

          {/* Tabs editoriais */}
          <Reveal delay={0.65}>
            <nav className="flex gap-1 mb-8 border-b border-(--border)">
              {[
                { id: 'friends', label: `Alinhadas`, count: friends.data?.length ?? 0 },
                { id: 'pending', label: `Pendentes`, count: pendingCount },
                { id: 'add',     label: 'Alinhar nova', count: null as number | null },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id as any)}
                  className={cn(
                    'group relative px-3.5 py-2.5 text-sm -mb-px border-b-2 transition-colors font-(family-name:--font-display)',
                    tab === t.id
                      ? 'border-(--accent) text-foreground'
                      : 'border-transparent text-(--text-3) hover:text-foreground',
                  )}
                >
                  <span>{t.label}</span>
                  {t.count !== null && t.count > 0 && (
                    <span className="ml-1.5 text-[10px] font-mono text-(--text-3)">· {t.count}</span>
                  )}
                </button>
              ))}
            </nav>
          </Reveal>

          {tab === 'friends' && <FriendsList items={friends.data ?? []} onlineCount={onlineCount} loading={friends.isLoading} />}
          {tab === 'pending' && <PendingList incoming={requests.data ?? []} outgoing={outgoing.data ?? []} />}
          {tab === 'add'     && <AddFriendForm />}
        </div>

        {/* Margem direita — aside */}
        <div className="hidden lg:flex col-span-1 col-start-12 items-end pb-12">
          <Reveal delay={1.0}>
            <p className="ed-aside max-w-[16ch]">
              "Toda constelação começa com duas estrelas."
            </p>
          </Reveal>
        </div>
      </div>
    </div>
  )
}

function FriendsList({ items, onlineCount, loading }: { items: FriendEntry[]; onlineCount: number; loading: boolean }) {
  const navigate = useNavigate()
  const remove   = useRemoveFriend()
  const confirm  = useConfirm()

  const startDM = async (user: FriendEntry['user']) => {
    try {
      const res = await api.post('/api/dm/open', { userId: user.id })
      const conversationId = res.data.data.conversationId as string
      navigate('/app/dm', {
        state: {
          conversationId,
          otherUser: {
            id:          user.id,
            username:    user.username,
            displayName: user.displayName,
            avatarUrl:   user.avatarUrl ?? null,
          },
        },
      })
    } catch (e: any) {
      console.error('[dm]', e?.response?.data ?? e?.message)
      toast.error(e?.response?.data?.error ?? 'Não consegui abrir DM')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-(--text-3)">
        <Spinner size={14} /> Carregando…
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <Reveal delay={0.05}>
        <ConstellationEmpty
          title="Sozinho no céu"
          description="Adicione estrelas por username ou coordenada."
          className="border border-dashed border-(--border)"
        />
      </Reveal>
    )
  }

  return (
    <>
      {onlineCount > 0 && (
        <Reveal delay={0.05}>
          <p className="ed-marg mb-3">— {onlineCount} {onlineCount === 1 ? 'estrela acesa' : 'estrelas acesas'}</p>
        </Reveal>
      )}
      <ScrollArea className="max-h-[60vh]">
        <ul className="border border-(--border) divide-y divide-(--border)">
          {items.map((f, i) => (
            <FriendRow
              key={f.friendshipId}
              friend={f}
              delay={0.08 + i * 0.04}
              onDM={() => startDM(f.user)}
              onRemove={async () => {
                const ok = await confirm({
                  title: `Remover ${f.user.displayName}?`,
                  description: 'Vocês deixarão de ser amigos. Pode adicionar de novo depois.',
                  confirmLabel: 'Remover',
                  destructive: true,
                })
                if (ok) {
                  remove.mutate(f.friendshipId, {
                    onSuccess: () => toast.success(`${f.user.displayName} removido`),
                  })
                }
              }}
            />
          ))}
        </ul>
      </ScrollArea>
    </>
  )
}

function FriendRow({
  friend, delay, onDM, onRemove,
}: {
  friend: FriendEntry; delay: number; onDM: () => void; onRemove: () => void
}) {
  const items: EditorialMenuItem[] = useMemo(() => [
    { kind: 'label', label: friend.user.displayName },
    { kind: 'item', icon: <MessageCircle className="size-3.5" />, label: 'Enviar sussurro', onSelect: onDM },
    { kind: 'item', icon: <AtSign        className="size-3.5" />, label: 'Copiar @username',
      onSelect: () => { void navigator.clipboard.writeText(`@${friend.user.username}`) },
    },
    { kind: 'item', icon: <Copy          className="size-3.5" />, label: 'Copiar ID',
      onSelect: () => { void navigator.clipboard.writeText(friend.user.id) },
    },
    { kind: 'separator' },
    { kind: 'item', icon: <UserMinus className="size-3.5" />, label: 'Remover amizade', destructive: true, onSelect: onRemove },
  ], [friend, onDM, onRemove])

  return (
    <EditorialContextMenu items={items}>
      <li
        className="group flex items-center gap-3 px-4 py-3 hover:bg-(--raised)/40 transition-colors"
        style={{ animation: `fadeLeft 0.3s var(--ease-spring) ${delay}s both` }}
      >
        <div className="relative shrink-0">
          <Avatar className="size-10 border border-(--border-mid)">
            {friend.user.avatarUrl
              ? <AvatarImage src={resolveApiUrl(friend.user.avatarUrl)} alt={friend.user.displayName} />
              : <AvatarFallback className="bg-(--raised) text-(--text-2) font-(family-name:--font-display)">
                  {friend.user.displayName.slice(0, 1).toUpperCase()}
                </AvatarFallback>}
          </Avatar>
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-(--base)',
              PRESENCE_DOT[friend.presence] ?? 'bg-(--text-3)',
            )}
            aria-hidden
          />
        </div>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground truncate" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>
              {friend.user.displayName}
            </span>
            <span className="text-[11px] font-mono text-(--text-3) truncate">@{friend.user.username}</span>
          </div>
          <p className="text-xs text-(--text-3) m-0 truncate">
            <span className="text-(--text-2)">{PRESENCE_LABEL[friend.presence]}</span>
            {friend.user.customStatus && <> · <span className="italic">{friend.user.customStatus}</span></>}
          </p>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onDM}
            className="size-8 grid place-items-center text-(--text-3) hover:text-(--accent) transition-colors"
            title="Enviar DM"
          >
            <MessageCircle className="size-3.5" />
          </button>
          <button
            onClick={onRemove}
            className="size-8 grid place-items-center text-(--text-3) hover:text-(--danger) transition-colors"
            title="Remover amizade"
          >
            <UserMinus className="size-3.5" />
          </button>
        </div>
      </li>
    </EditorialContextMenu>
  )
}

function PendingList({ incoming, outgoing }: { incoming: PendingEntry[]; outgoing: PendingEntry[] }) {
  const accept = useAcceptFriend()
  const remove = useRemoveFriend()

  return (
    <div className="space-y-8">
      <section>
        <Reveal delay={0.05}>
          <header className="mb-3 flex items-center gap-2">
            <Inbox className="size-3.5 text-(--accent)" />
            <h3 className="text-sm m-0 font-medium font-(family-name:--font-display)">Recebidos</h3>
            <span className="ed-marg">· {incoming.length}</span>
          </header>
        </Reveal>
        {incoming.length === 0 ? (
          <Reveal delay={0.12}>
            <p className="text-xs text-(--text-3) italic">Sem pedidos pendentes.</p>
          </Reveal>
        ) : (
          <ul className="border border-(--border) divide-y divide-(--border)">
            {incoming.map((p, i) => (
              <li
                key={p.friendshipId}
                className="px-4 py-3 flex items-center gap-3 hover:bg-(--raised)/40 transition-colors"
                style={{ animation: `fadeLeft 0.3s var(--ease-spring) ${Math.min(0.1 + i * 0.04, 0.35)}s both` }}
              >
                <Avatar className="size-9 border border-(--border-mid) shrink-0">
                  {p.user.avatarUrl
                    ? <AvatarImage src={resolveApiUrl(p.user.avatarUrl)} alt={p.user.displayName} />
                    : <AvatarFallback className="bg-(--raised) text-(--text-2) font-(family-name:--font-display)">
                        {p.user.displayName.slice(0, 1).toUpperCase()}
                      </AvatarFallback>}
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground m-0" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>
                    {p.user.displayName}
                  </p>
                  <p className="text-xs text-(--text-3) m-0 truncate">@{p.user.username}</p>
                </div>
                <button
                  onClick={() => accept.mutate(p.friendshipId)}
                  className="size-9 grid place-items-center border border-(--accent)/30 text-(--accent) hover:bg-(--accent)/10 transition-colors"
                  title="Aceitar"
                >
                  <Check className="size-4" />
                </button>
                <button
                  onClick={() => remove.mutate(p.friendshipId)}
                  className="size-9 grid place-items-center border border-(--border) text-(--text-3) hover:text-(--danger) transition-colors"
                  title="Recusar"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <Reveal delay={0.2}>
          <header className="mb-3 flex items-center gap-2">
            <Send className="size-3.5 text-(--text-3)" />
            <h3 className="text-sm m-0 font-medium font-(family-name:--font-display)">Enviados</h3>
            <span className="ed-marg">· {outgoing.length}</span>
          </header>
        </Reveal>
        {outgoing.length === 0 ? (
          <Reveal delay={0.25}>
            <p className="text-xs text-(--text-3) italic">Nenhum pedido enviado.</p>
          </Reveal>
        ) : (
          <ul className="border border-(--border) divide-y divide-(--border)">
            {outgoing.map((p, i) => (
              <li
                key={p.friendshipId}
                className="px-4 py-3 flex items-center gap-3"
                style={{ animation: `fadeLeft 0.3s var(--ease-spring) ${Math.min(0.3 + i * 0.04, 0.5)}s both` }}
              >
                <Avatar className="size-9 border border-(--border-mid) shrink-0">
                  {p.user.avatarUrl
                    ? <AvatarImage src={resolveApiUrl(p.user.avatarUrl)} alt={p.user.displayName} />
                    : <AvatarFallback className="bg-(--raised) text-(--text-2) font-(family-name:--font-display)">
                        {p.user.displayName.slice(0, 1).toUpperCase()}
                      </AvatarFallback>}
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground m-0" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>
                    {p.user.displayName}
                  </p>
                  <p className="text-xs text-(--text-3) m-0 truncate">@{p.user.username} · aguardando resposta</p>
                </div>
                <button
                  onClick={() => remove.mutate(p.friendshipId)}
                  className="text-xs text-(--text-3) hover:text-(--danger) transition-colors px-2"
                >
                  cancelar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AddFriendForm() {
  const [mode, setMode]         = useState<'username' | 'coordinate'>('username')
  const [value, setValue]       = useState('')
  const [msg,   setMsg]         = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const send = useSendFriendRequest()

  // Normaliza coordenada pra UPPERCASE em tempo real (formato AAAA-BB)
  const onChange = (raw: string) => {
    setMsg(null)
    if (mode === 'coordinate') {
      setValue(raw.toUpperCase().replace(/[^A-F0-9-]/g, '').slice(0, 7))
    } else {
      setValue(raw)
    }
  }

  const switchMode = (next: 'username' | 'coordinate') => {
    if (next === mode) return
    setMode(next); setValue(''); setMsg(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    if (mode === 'coordinate' && !/^[A-F0-9]{4}-[A-F0-9]{2}$/.test(trimmed)) {
      setMsg({ kind: 'err', text: 'Formato inválido. Use AAAA-BB (ex: A7F2-9B).' })
      return
    }
    setMsg(null)
    try {
      const payload = mode === 'username' ? { username: trimmed } : { coordinate: trimmed }
      const r = await send.mutateAsync(payload)
      if (r.status === 'accepted') setMsg({ kind: 'ok', text: 'Estrela alinhada — já eram amigos.' })
      else                         setMsg({ kind: 'ok', text: 'Pedido enviado. Aguardando aceitação.' })
      setValue('')
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? 'Erro ao enviar pedido.' })
    }
  }

  return (
    <Reveal delay={0.05}>
      <form onSubmit={submit} className="space-y-3 max-w-[44ch]">
        {/* Tabs username/coord */}
        <div className="flex gap-1 border-b border-(--border) -mb-px">
          <button
            type="button"
            onClick={() => switchMode('username')}
            className={cn(
              'px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors',
              mode === 'username'
                ? 'text-(--accent) border-b border-(--accent) -mb-px'
                : 'text-(--text-3) hover:text-(--text-1)',
            )}
          >
            Username
          </button>
          <button
            type="button"
            onClick={() => switchMode('coordinate')}
            className={cn(
              'px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors',
              mode === 'coordinate'
                ? 'text-(--accent) border-b border-(--accent) -mb-px'
                : 'text-(--text-3) hover:text-(--text-1)',
            )}
          >
            Coordenada
          </button>
        </div>

        <label className="block">
          <span className="ed-label block mb-2">
            {mode === 'username' ? '— @username' : '— Coordenada Astra'}
          </span>
          <div className="flex gap-2">
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={mode === 'username' ? 'Ex: maria' : 'Ex: A7F2-9B'}
              className={cn('flex-1', mode === 'coordinate' && 'font-mono tracking-wider')}
              maxLength={mode === 'coordinate' ? 7 : 64}
            />
            <Button type="submit" disabled={!value.trim() || send.isPending} className="gap-2">
              <UserPlus className="size-3.5" /> Enviar
            </Button>
          </div>
        </label>
        {msg && (
          <p className={cn('text-xs m-0 italic', msg.kind === 'ok' ? 'text-(--success)' : 'text-(--danger)')}>
            {msg.text}
          </p>
        )}
        <p className="ed-aside max-w-[40ch]">
          {mode === 'username'
            ? 'Peça o @username da pessoa.'
            : 'Peça a coordenada Astra (aparece no perfil — 6 chars hex com hífen).'}
        </p>
      </form>
    </Reveal>
  )
}
