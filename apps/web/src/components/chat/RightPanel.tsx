import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Crown, Shield, Hash, X, Users as UsersIcon, MessagesSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { useUIStore } from '@/store/uiStore'
import { usePresenceStore } from '@/store/presenceStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Empty, EmptyIcon, EmptyLabel, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import ProfileCard from '@/components/ProfileCard'
import { ProfileHoverCard } from '@/components/ProfileHoverCard'
import StatusDot, { type UserStatus } from '@/components/StatusDot'
import { cn } from '@/lib/utils'

interface Member {
  id: string; userId: string; role: 'OWNER'|'ADMIN'|'MEMBER'
  user: { id: string; username: string; displayName: string; avatarUrl: string|null }
  roles?: Array<{ id: string; name: string; color: string|null; position: number; hoist: boolean }>
  topColor?: string | null
}
interface Thread {
  id: string; name: string; channelId: string; parentMessageId: string; createdAt: string
  createdBy: { id: string; displayName: string; avatarUrl: string|null }
}

interface RightPanelProps {
  serverId: string
  channelId: string
}

export default function RightPanel({ serverId, channelId }: RightPanelProps) {
  const open    = useUIStore((s) => s.rightPanelOpen)
  const close   = useUIStore((s) => s.closeRightPanel)
  const tab     = useUIStore((s) => s.rightPanelTab)
  const setTab  = useUIStore((s) => s.setRightPanelTab)

  const [profileId, setProfileId] = useState<string | null>(null)

  if (!open) return null

  return (
    <>
      {/* Backdrop mobile só */}
      <div
        onClick={close}
        className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm anim-fade-in"
      />

      {/* Aside fixo à direita — coluna inline em desktop, drawer em mobile */}
      <aside
        className={cn(
          // md:h-full (não h-screen-safe): no desktop é flex child do shell;
          // no mobile a altura vem do fixed top-0/bottom-0.
          'shrink-0 md:h-full border-l border-(--border) bg-(--base) flex flex-col z-50',
          'w-72 sm:w-80',
          // Mobile: drawer fixed à direita; Desktop: estático na flex-row do AppPage
          'fixed top-0 right-0 bottom-0 md:static md:top-auto md:right-auto md:bottom-auto',
        )}
      >
        {/* Header */}
        <div className="h-12 px-3 flex items-center gap-2 border-b border-(--border) shrink-0">
          <h3
            className="text-sm m-0 font-medium tracking-tight text-foreground truncate flex-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {tab === 'members' ? 'Membros' : 'Cometas'}
          </h3>
          <button
            onClick={close}
            className="size-7 flex items-center justify-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
            aria-label="Fechar painel"
            title="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'members'|'threads')} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-3 w-auto self-start">
            <TabsTrigger value="members">Membros</TabsTrigger>
            <TabsTrigger value="threads" title="Threads — conversas derivadas de uma mensagem">Cometas</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="flex-1 overflow-y-auto px-2 mt-3">
            <MembersList serverId={serverId} onPickUser={(id) => setProfileId(id)} />
          </TabsContent>

          <TabsContent value="threads" className="flex-1 overflow-y-auto px-2 mt-3">
            <ThreadsList channelId={channelId} />
          </TabsContent>
        </Tabs>
      </aside>

      {profileId && <ProfileCard userId={profileId} onClose={() => setProfileId(null)} />}
    </>
  )
}

const STATUS_ORDER: Record<UserStatus, number> = { ONLINE: 0, IDLE: 1, DND: 2, INVISIBLE: 3, OFFLINE: 4 }

function MembersList({ serverId, onPickUser }: { serverId: string; onPickUser: (id: string) => void }) {
  const presence = usePresenceStore((s) => s.others)
  const bulkSet  = usePresenceStore((s) => s.bulkSet)

  const { data: members = [], isLoading, isError, error, refetch } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/members`)).data.data,
    enabled:  !!serverId,
  })

  // Bulk fetch presence pra todos os members
  useEffect(() => {
    if (members.length === 0) return
    const ids = members.map((m) => m.userId).join(',')
    api.get(`/api/profile/presence?ids=${ids}`).then((r) => {
      bulkSet(r.data?.data ?? {})
    }).catch(() => {})
  }, [members, bulkSet])

  if (isLoading) return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-(--text-3)">
      <Spinner size={14} /> Carregando membros…
    </div>
  )
  if (isError) return (
    <Empty>
      <EmptyLabel className="text-(--danger)">— Erro</EmptyLabel>
      <EmptyTitle>Não foi possível carregar</EmptyTitle>
      <EmptyDescription>
        {(error as any)?.response?.data?.error ?? (error as any)?.message ?? 'Falha desconhecida.'}
      </EmptyDescription>
      <button onClick={() => refetch()} className="mt-3 text-sm text-(--accent) underline cursor-pointer">
        Tentar de novo
      </button>
    </Empty>
  )
  if (members.length === 0) return (
    <Empty>
      <EmptyIcon><UsersIcon className="size-6" /></EmptyIcon>
      <EmptyLabel>— Sem habitantes</EmptyLabel>
      <EmptyTitle>Servidor vazio</EmptyTitle>
      <EmptyDescription>Nenhum membro nesse servidor ainda.</EmptyDescription>
    </Empty>
  )

  const getStatus = (id: string): UserStatus => presence[id] ?? 'OFFLINE'

  const sorted = [...members].sort((a, b) => {
    const da = STATUS_ORDER[getStatus(a.userId)]
    const db = STATUS_ORDER[getStatus(b.userId)]
    if (da !== db) return da - db
    return a.user.displayName.localeCompare(b.user.displayName)
  })

  const online  = sorted.filter((m) => getStatus(m.userId) !== 'OFFLINE')
  const offline = sorted.filter((m) => getStatus(m.userId) === 'OFFLINE')

  const grouped = {
    OWNER:  online.filter((m) => m.role === 'OWNER'),
    ADMIN:  online.filter((m) => m.role === 'ADMIN'),
    MEMBER: online.filter((m) => m.role === 'MEMBER'),
  }

  const sections: Array<[string, Member[], React.ReactNode]> = [
    ['Donos',   grouped.OWNER,  <Crown className="size-3" />],
    ['Admins',  grouped.ADMIN,  <Shield className="size-3" />],
    ['Online',  grouped.MEMBER, null],
    ['Offline', offline,        null],
  ]

  return (
    <div className="flex flex-col gap-3 pb-4">
      {sections.map(([title, arr, icon]) => arr.length > 0 && (
        <section key={title}>
          <div className="px-3 py-1.5 flex items-center gap-2">
            {icon}
            <span className="text-[10px] uppercase tracking-wider text-(--text-3) font-medium">{title}</span>
            <span className="text-[10px] font-mono text-(--text-3) ml-auto">{arr.length}</span>
          </div>
          <ul className="flex flex-col">
            {arr.map((m) => {
              const status = getStatus(m.userId)
              const dim = status === 'OFFLINE'
              return (
                <li key={m.id}>
                  <ProfileHoverCard userId={m.userId} side="left" align="start">
                    <button
                      onClick={() => onPickUser(m.userId)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left border-l-2 border-transparent hover:border-(--accent) hover:bg-(--raised)/40 transition-colors cursor-pointer ${dim ? 'opacity-55' : ''}`}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="size-7">
                          {m.user.avatarUrl && <AvatarImage src={m.user.avatarUrl} referrerPolicy="no-referrer" />}
                          <AvatarFallback className="text-[10px]">{m.user.displayName.slice(0,1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5">
                          <StatusDot status={status} size={9} bordered borderColor="var(--overlay)" />
                        </span>
                      </div>
                      <span
                        className="text-sm truncate flex-1"
                        style={{
                          fontFamily: 'var(--font-display)',
                          color: m.topColor ?? 'var(--text-2)',
                        }}
                      >
                        {m.user.displayName}
                      </span>
                    </button>
                  </ProfileHoverCard>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ThreadsList({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient()
  const [activeThread, setActiveThread] = useState<Thread | null>(null)

  const { data: threads = [], isLoading } = useQuery<Thread[]>({
    queryKey: ['threads', channelId],
    queryFn:  async () => (await api.get(`/api/channels/${channelId}/threads`)).data.data,
    enabled:  !!channelId,
  })

  // Socket: refresh quando alguém cria thread no canal
  useEffect(() => {
    let sock: ReturnType<typeof getSocket>
    try { sock = getSocket() } catch { return }
    const onCreated = (p: { channelId: string }) => {
      if (p.channelId === channelId) queryClient.invalidateQueries({ queryKey: ['threads', channelId] })
    }
    sock.on('thread_created', onCreated)
    return () => { sock.off('thread_created', onCreated) }
  }, [channelId, queryClient])

  if (activeThread) {
    return <ThreadView thread={activeThread} onBack={() => setActiveThread(null)} />
  }

  return (
    <div className="flex flex-col gap-2 pb-4">
      <div className="px-3 pt-1 pb-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-(--text-3) font-medium" title="Threads ativas">Cometas ativos</span>
        <span className="text-[10px] font-mono text-(--text-3) ml-auto">{threads.length}</span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-(--text-3)">
          <Spinner size={14} /> Carregando…
        </div>
      )}

      {!isLoading && threads.length === 0 && (
        <Empty className="py-8">
          <EmptyIcon><MessagesSquare className="size-6" /></EmptyIcon>
          <EmptyLabel>— Margem em branco</EmptyLabel>
          <EmptyTitle>Sem cometas por aqui</EmptyTitle>
          <EmptyDescription>
            Passe o mouse em uma mensagem e clique no <Hash className="size-3 inline align-middle" /> pra soltar um (thread).
          </EmptyDescription>
        </Empty>
      )}

      <ul className="flex flex-col">
        {threads.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => setActiveThread(t)}
              className="w-full flex items-start gap-2.5 px-3 py-2 text-left border-l-2 border-transparent hover:border-(--accent) hover:bg-(--raised)/40 transition-colors cursor-pointer"
            >
              <Hash className="size-3.5 text-(--text-3) mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-(--text-1) m-0 truncate" style={{ fontFamily: 'var(--font-display)' }}>{t.name}</p>
                <p className="text-[11px] text-(--text-3) m-0 truncate font-mono">por {t.createdBy.displayName}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ThreadView({ thread, onBack }: { thread: Thread; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')

  const { data, isLoading } = useQuery<{ items: any[]; hasMore: boolean; nextCursor: string|null }>({
    queryKey: ['thread-messages', thread.id],
    queryFn:  async () => (await api.get(`/api/threads/${thread.id}/messages`)).data.data,
  })

  const send = useMutation({
    mutationFn: async () => (await api.post(`/api/threads/${thread.id}/messages`, { content: draft })).data.data,
    onSuccess: () => { setDraft(''); queryClient.invalidateQueries({ queryKey: ['thread-messages', thread.id] }) },
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-(--border) flex items-center gap-2">
        <button onClick={onBack} className="text-xs text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer">← voltar</button>
        <span className="text-sm flex-1 truncate" style={{ fontFamily: 'var(--font-display)' }}>{thread.name}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {isLoading && (
          <div className="flex items-center gap-2 py-2 text-sm text-(--text-3)">
            <Spinner size={12} /> Carregando…
          </div>
        )}
        {data?.items.length === 0 && (
          <p className="text-sm text-(--text-3) italic">Inicie a conversa na thread.</p>
        )}
        {data?.items.map((m: any) => (
          <div key={m.id} className="border-l-2 border-(--border) pl-2.5 py-0.5">
            <div className="text-[11px] font-mono text-(--text-3)">{m.author.displayName}</div>
            <div className="text-sm text-(--text-1) wrap-break-word">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="border-t border-(--border) p-2 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && draft.trim()) { e.preventDefault(); send.mutate() } }}
          placeholder="Mensagem na thread…"
        />
        <Button onClick={() => draft.trim() && send.mutate()} disabled={!draft.trim() || send.isPending} size="sm">
          {send.isPending ? '…' : 'Enviar'}
        </Button>
      </div>
    </div>
  )
}
