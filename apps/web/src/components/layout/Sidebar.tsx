import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Users, UserPlus, Pencil, Trash2, PanelLeftClose, PanelLeftOpen, Mic, Copy, Eye } from 'lucide-react'
import { EditorialContextMenu, type EditorialMenuItem } from '@/components/EditorialContextMenu'
import { useLongPress } from '@/hooks/useLongPress'
import { useConfirm, usePrompt } from '@/hooks/useConfirm'
import { toast } from '@/components/ui/sonner'
import { useVoiceCall, useVoiceConfig, parseRoomName } from '@/hooks/useVoiceCall'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { useUnread } from '@/hooks/useUnread'
import { useMyPerms } from '@/hooks/useMyPerms'
import ProfileCard from '@/components/ProfileCard'
import UmbraLogo from '@/components/UmbraLogo'
import { UserFooter } from './UserFooter'
import { CreateServerDialog } from './dialogs/CreateServerDialog'
import { EditServerDialog } from './dialogs/EditServerDialog'
import { DeleteServerDialog } from './dialogs/DeleteServerDialog'
import { CreateChannelDialog } from './dialogs/CreateChannelDialog'
import { AddMemberDialog } from './dialogs/AddMemberDialog'
import ServerContextMenu, { type ContextMenuItem } from '@/components/ServerContextMenu'
import { SidebarSkeleton } from '@/components/skeletons/SidebarSkeleton'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Empty, EmptyIcon, EmptyLabel, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import type { ServerWithChannels, ChannelInfo } from '@umbra/types'

interface SidebarProps {
  activeChannelId: string | null
  onSelectChannel: (channelId: string, channelName: string, serverId: string) => void
}

interface CtxMenu { x: number; y: number; server: ServerWithChannels; isOwner: boolean }

export default function Sidebar({ activeChannelId, onSelectChannel }: SidebarProps) {
  const user        = useAuthStore((s) => s.user)
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const unread      = useUnread()

  const [activeServerId,  setActiveServerId]  = useState<string | null>(null)
  const [collapsed,       setCollapsed]       = useState<boolean>(() => {
    const stored = localStorage.getItem('umbra-sidebar-collapsed')
    if (stored !== null) return stored === '1'
    // Default colapsado em mobile (< 768px)
    return typeof window !== 'undefined' && window.innerWidth < 768
  })
  const mobileOpen    = useUIStore((s) => s.mobileSidebarOpen)
  const closeMobile   = useUIStore((s) => s.closeMobileSidebar)
  // Dialogs: parent controla apenas open + target. Cada dialog componente
  // gerencia próprio form state + mutation.
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createMode,      setCreateMode]      = useState<'server' | 'group'>('server')
  /** Posição do clique no botão "Criar…" — modal usa pra animar saindo dele. */
  const [popOrigin, setPopOrigin] = useState<{ x: number; y: number } | null>(null)
  const [ctxMenu,         setCtxMenu]         = useState<CtxMenu | null>(null)
  const [showAddMember,   setShowAddMember]   = useState(false)
  const [showEditModal,   setShowEditModal]   = useState(false)
  const [editServerId,    setEditServerId]    = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteServerId,  setDeleteServerId]  = useState<string | null>(null)
  const [showOwnProfile,    setShowOwnProfile]    = useState(false)
  const [channelAreaCtx,    setChannelAreaCtx]    = useState<{ x: number; y: number } | null>(null)
  const [showCreateChannel, setShowCreateChannel] = useState(false)

  const { data: servers = [], isLoading: serversLoading } = useQuery<ServerWithChannels[]>({
    queryKey: ['servers'],
    queryFn: async () => (await api.get('/api/servers')).data.data,
    // Servidores mudam só por ação explícita (criar/sair/renomear) → invalidação
    // manual cobre. 5min de staleTime corta refetch automático em background.
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (servers.length && !activeServerId) setActiveServerId(servers[0].id)
  }, [servers, activeServerId])

  // Mutations: create/edit/delete server + invite + create channel
  // foram movidos pros respectivos dialog components. Sobram aqui só as
  // ações que NÃO têm dialog próprio (leave, rename/delete channel inline).
  const leaveServer = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/servers/${id}/leave`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      if (ctxMenu?.server.id === activeServerId) setActiveServerId(null)
    },
  })

  const renameChannel = useMutation({
    mutationFn: async (p: { channelId: string; name: string }) =>
      (await api.patch(`/api/servers/${activeServerId}/channels/${p.channelId}`, { name: p.name })).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servers'] }),
  })

  const deleteChannel = useMutation({
    mutationFn: async (channelId: string) =>
      api.delete(`/api/servers/${activeServerId}/channels/${channelId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servers'] }),
  })

  const activeServerPerms = useMyPerms(activeServerId ?? undefined)
  const canManageChannels = activeServerPerms.isOwner || activeServerPerms.has('MANAGE_CHANNELS')

  const handleChannelAreaContextMenu = useCallback((e: React.MouseEvent) => {
    if (!activeServerId || !canManageChannels) return
    // Só abre menu se clicou no fundo (não num botão de canal)
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    e.preventDefault(); e.stopPropagation()
    setChannelAreaCtx({ x: e.clientX, y: e.clientY })
  }, [activeServerId, canManageChannels])

  const handleContextMenu = useCallback((e: React.MouseEvent, server: ServerWithChannels) => {
    e.preventDefault(); e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, server, isOwner: server.ownerId === user?.id })
  }, [user?.id])

  /**
   * Tap em server icon (mobile + desktop): troca o server ativo.
   * No mobile, se já tem channel selecionada nesse server, navega pra ela e
   * fecha o drawer; senão (server sem canais OU recém-trocado) auto-pick
   * do primeiro canal disponível pra não deixar o user "no escuro".
   */
  const handleServerIconTap = useCallback((s: ServerWithChannels) => {
    setActiveServerId(s.id)
    // Mobile only: auto-navigate + close drawer
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      const firstCh = s.channels?.find((c) => c.type === 'TEXT') ?? s.channels?.[0]
      if (firstCh) onSelectChannel(firstCh.id, firstCh.name, s.id)
      closeMobile()
    }
  }, [onSelectChannel, closeMobile])

  const buildMenuItems = (menu: CtxMenu): ContextMenuItem[] => {
    const items: ContextMenuItem[] = []
    if (!menu.server.isGroup) {
      items.push({
        icon: '🔗', label: 'Copiar link de convite',
        onClick: () => navigator.clipboard.writeText(`${window.location.origin}/invite/${menu.server.inviteCode}`),
      })
    }
    items.push({
      icon: '⚙️', label: 'Configurações',
      onClick: () => navigate(`/app/servers/${menu.server.id}/settings`),
    })
    if (menu.isOwner) {
      items.push({
        icon: '✏️', label: `Renomear ${menu.server.isGroup ? 'grupo' : 'servidor'}`,
        onClick: () => { setEditServerId(menu.server.id); setShowEditModal(true) },
      })
      if (menu.server.isGroup) {
        items.push({ icon: '👥', label: 'Adicionar membro', onClick: () => { setActiveServerId(menu.server.id); setShowAddMember(true) } })
      }
      items.push({ icon: '🗑️', label: `Excluir ${menu.server.isGroup ? 'grupo' : 'servidor'}`, danger: true, onClick: () => { setDeleteServerId(menu.server.id); setShowDeleteModal(true) } })
    } else {
      items.push({ icon: '🚪', label: `Sair do ${menu.server.isGroup ? 'grupo' : 'servidor'}`, danger: true, onClick: () => leaveServer.mutate(menu.server.id) })
    }
    return items
  }

  const activeServer   = servers.find((s) => s.id === activeServerId)
  // Mostra TEXT + VOICE (ChannelButton já trata ícone por tipo)
  const channels       = activeServer?.channels ?? []
  const isGroup        = activeServer?.isGroup ?? false
  const regularServers = servers.filter((s) => !s.isGroup)
  const groups         = servers.filter((s) => s.isGroup)
  const editTarget     = servers.find((s) => s.id === editServerId)
  const deleteTarget   = servers.find((s) => s.id === deleteServerId)

  if (serversLoading) return <SidebarSkeleton />

  return (
    <>
      {/* Backdrop mobile — atrás do drawer.
          Stagger: backdrop 80ms atrás do drawer pra criar "drawer leads" feel. */}
      {mobileOpen && (
        <div
          onClick={closeMobile}
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          style={{ animation: 'fadeIn 0.36s ease-out 0.08s both' }}
        />
      )}

      <div
        className={cn(
          'flex h-full shrink-0 z-50',
          // Desktop: estático na grid normal
          'md:relative md:translate-x-0 md:transition-none',
          // Mobile: fixed off-screen, slide-in com overshoot elastic
          'fixed top-0 left-0 bottom-0 transition-transform',
          mobileOpen
            ? 'translate-x-0 duration-[460ms] [transition-timing-function:cubic-bezier(0.34,1.32,0.55,1)]'
            : '-translate-x-full md:translate-x-0 duration-[280ms] [transition-timing-function:cubic-bezier(0.4,0,0.2,1)]',
        )}
      >

        {/* ── Server strip ─────────────────────────────────── */}
        <div className="w-16 h-full bg-background border-r border-border flex flex-col items-center py-3 gap-1.5 overflow-y-auto shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { navigate('/app/dm'); closeMobile() }}
                aria-label="Mensagens diretas"
                className="size-11 mb-1 shrink-0 p-0 bg-transparent border-none rounded-xl flex items-center justify-center hover:scale-110 hover:brightness-110 transition-all cursor-pointer"
              >
                <UmbraLogo size={44} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Mensagens diretas</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { navigate('/app/friends'); closeMobile() }}
                className="size-9 shrink-0 grid place-items-center text-(--text-3) hover:text-(--accent) transition-colors cursor-pointer"
                aria-label="Amigos"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Amigos</TooltipContent>
          </Tooltip>

          <div className="w-7 h-px bg-border my-0.5" />

          {regularServers.map((s, i) => (
            <ServerIcon
              key={s.id}
              server={s}
              isActive={s.id === activeServerId}
              index={i}
              onClick={() => handleServerIconTap(s)}
              onContextMenu={(e) => handleContextMenu(e, s)}
            />
          ))}

          {groups.length > 0 && (
            <>
              <div className="w-7 h-px bg-border my-0.5" />
              {groups.map((s, i) => (
                <ServerIcon
                  key={s.id}
                  server={s}
                  isActive={s.id === activeServerId}
                  index={regularServers.length + i}
                  isGroup
                  onClick={() => handleServerIconTap(s)}
                  onContextMenu={(e) => handleContextMenu(e, s)}
                />
              ))}
            </>
          )}

          <div className="w-7 h-px bg-border my-0.5" />
          <StripButton
            title="Criar servidor"
            icon={<Plus className="size-5" />}
            onClick={(origin) => { setCreateMode('server'); setPopOrigin(origin); setShowCreateModal(true) }}
          />
          <StripButton
            title="Criar grupo"
            icon={<Users className="size-4" />}
            onClick={(origin) => { setCreateMode('group'); setPopOrigin(origin); setShowCreateModal(true) }}
          />

          {/* spacer empurra toggle pro fundo */}
          <div className="flex-1" />

          <StripButton
            title={collapsed ? 'Expandir painel' : 'Esconder painel'}
            icon={collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            onClick={() => {
              setCollapsed((c) => {
                const next = !c
                localStorage.setItem('umbra-sidebar-collapsed', next ? '1' : '0')
                return next
              })
            }}
          />
        </div>

        {/* ── Channel panel ─────────────────────────────────── */}
        <div
          className={cn(
            'h-full bg-muted border-r border-border flex flex-col overflow-hidden transition-[width] duration-300 ease-(--ease-spring)',
            collapsed ? 'w-0' : 'w-55'
          )}
        >
          {activeServer && (
            <div className="h-16 px-4 flex items-center gap-2.5 border-b border-(--border) shrink-0">
              {isGroup && <Users className="size-3.5 text-(--text-3)" />}
              <h2
                className="text-lg m-0 flex-1 truncate text-foreground font-normal tracking-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {activeServer.name}
              </h2>
              {isGroup && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowAddMember(true)}
                      className="bg-transparent border-none cursor-pointer text-muted-foreground hover:text-primary p-1 rounded-lg flex items-center transition-colors"
                    >
                      <UserPlus className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Adicionar membro</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          <div
            className="flex-1 overflow-y-auto px-2 py-2.5"
            onContextMenu={handleChannelAreaContextMenu}
          >
            {channels.length > 0 ? (
              <>
                <div className="px-3 mb-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-(--text-3) font-medium">
                    {isGroup ? 'Canais do grupo' : 'Canais'}
                  </span>
                </div>
                {channels.map((ch, i) => (
                  <ChannelButton
                    key={ch.id}
                    channel={ch}
                    isActive={activeChannelId === ch.id}
                    hasUnread={activeChannelId !== ch.id && unread.hasUnread(ch.id, (ch as any).lastMessageAt)}
                    onClick={() => { onSelectChannel(ch.id, ch.name, activeServer!.id); closeMobile() }}
                    index={i}
                    canManage={canManageChannels}
                    onRename={(newName) => renameChannel.mutate({ channelId: ch.id, name: newName })}
                    onDelete={() => deleteChannel.mutate(ch.id)}
                    onMarkRead={() => unread.markRead(ch.id)}
                  />
                ))}
              </>
            ) : !activeServer ? (
              <Empty className="h-full py-8">
                <EmptyIcon><Plus className="size-5 text-(--accent)" /></EmptyIcon>
                <EmptyLabel>— {servers.length === 0 ? 'Cap. ∅' : '— · —'}</EmptyLabel>
                <EmptyTitle className="text-base">
                  {servers.length === 0 ? 'Nenhum servidor' : 'Selecione um'}
                </EmptyTitle>
                <EmptyDescription>
                  {servers.length === 0
                    ? 'Use o + na barra esquerda pra criar seu primeiro espaço.'
                    : 'Clique num ícone à esquerda pra abrir os canais.'}
                </EmptyDescription>
              </Empty>
            ) : null}
          </div>

          <UserFooter onProfileClick={() => setShowOwnProfile(true)} />
        </div>
      </div>

      {ctxMenu && (
        <ServerContextMenu x={ctxMenu.x} y={ctxMenu.y} items={buildMenuItems(ctxMenu)} onClose={() => setCtxMenu(null)} />
      )}

      {channelAreaCtx && (
        <ServerContextMenu
          x={channelAreaCtx.x}
          y={channelAreaCtx.y}
          onClose={() => setChannelAreaCtx(null)}
          items={[
            {
              icon: '＋', label: 'Criar canal',
              onClick: () => setShowCreateChannel(true),
            },
            {
              icon: '⚙', label: 'Configurações do servidor',
              onClick: () => activeServerId && navigate(`/app/servers/${activeServerId}/settings`),
            },
          ]}
        />
      )}

      {showOwnProfile && user && (
        <ProfileCard userId={user.id} onClose={() => setShowOwnProfile(false)} />
      )}

      {/* ── Dialogs ────────────────────────────────────── */}
      <CreateServerDialog
        open={showCreateModal}
        onClose={() => { setShowCreateModal(false); setPopOrigin(null) }}
        mode={createMode}
        popOrigin={popOrigin}
        onCreated={(s) => setActiveServerId(s.id)}
      />
      <AddMemberDialog
        open={showAddMember}
        onClose={() => setShowAddMember(false)}
        serverId={activeServerId}
      />
      <EditServerDialog
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        target={editTarget ?? null}
      />
      <CreateChannelDialog
        open={showCreateChannel}
        onClose={() => setShowCreateChannel(false)}
        serverId={activeServerId}
      />
      <DeleteServerDialog
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        target={deleteTarget ?? null}
        onDeleted={(id) => { if (id === activeServerId) setActiveServerId(null) }}
      />
    </>
  )
}

// ─── Small reusable components ────────────────────────────────

function ServerIcon({ server, isActive, index, isGroup = false, onClick, onContextMenu }: {
  server: ServerWithChannels
  isActive: boolean
  index: number
  isGroup?: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  // Long-press abre o menu (mobile). Sintetiza coords da posição do toque
  // pra ServerContextMenu (posicionada manualmente em x,y) cair certo.
  const longPress = useLongPress((e) => {
    const point = 'touches' in e
      ? { x: e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX ?? 0,
          y: e.changedTouches?.[0]?.clientY ?? e.touches?.[0]?.clientY ?? 0 }
      : { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY }
    onContextMenu({ ...(e as any), clientX: point.x, clientY: point.y, preventDefault: () => {}, stopPropagation: () => {} })
  })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative shrink-0 group/server">
          {/* Rail indicator à esquerda — cresce no active, encolhe no hover */}
          <span
            aria-hidden
            className={cn(
              'absolute -left-3 top-1/2 -translate-y-1/2 w-0.5 bg-(--accent) transition-all duration-300 ease-(--ease-spring)',
              isActive
                ? 'h-7 opacity-100'
                : 'h-1 opacity-0 group-hover/server:opacity-100 group-hover/server:h-4',
            )}
          />
          <button
            onClick={(e) => { if (longPress.didFire()) { e.preventDefault(); return } onClick() }}
            onContextMenu={onContextMenu}
            onTouchStart={longPress.onTouchStart}
            onTouchMove={longPress.onTouchMove}
            onTouchEnd={longPress.onTouchEnd}
            onTouchCancel={longPress.onTouchCancel}
            aria-label={`${isGroup ? 'Grupo' : 'Servidor'} ${server.name}`}
            className={cn(
              'relative size-10 shrink-0 p-0 cursor-pointer overflow-hidden flex items-center justify-center font-(family-name:--font-display) transition-all duration-300 ease-(--ease-spring)',
              'border outline-none rounded-2xl',
              isActive
                ? 'bg-(--accent) text-(--text-inv) border-(--accent) shadow-accent scale-105'
                : 'bg-(--raised) text-(--text-2) border-(--border) hover:border-(--accent) hover:text-(--accent) hover:scale-105 hover:-translate-y-0.5',
              isGroup ? 'text-base' : 'text-sm'
            )}
            style={{ animation: `fadeUp 0.35s var(--ease-spring) ${index * 0.055}s both` }}
          >
            {server.iconUrl
              ? <img src={server.iconUrl} alt={server.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              : isGroup
                ? <Users className="size-4" />
                : server.name.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{server.name}</TooltipContent>
    </Tooltip>
  )
}

function StripButton({ title, icon, onClick }: {
  title:   string
  icon:    React.ReactNode
  /** Recebe coords do clique em viewport pra animação anchored (modal sai do botão). */
  onClick: (origin: { x: number; y: number }) => void
}) {
  const [bursts, setBursts] = useState<number[]>([])

  const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cx   = rect.left + rect.width  / 2
    const cy   = rect.top  + rect.height / 2
    const id   = Date.now() + Math.random()
    setBursts((b) => [...b, id])
    setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 650)
    onClick({ x: cx, y: cy })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handle}
          aria-label={title}
          className="size-10 shrink-0 rounded-2xl border border-dashed border-(--border) bg-transparent text-(--text-3) cursor-pointer flex items-center justify-center transition-all duration-300 ease-(--ease-spring) hover:bg-(--accent-dim) hover:border-(--accent) hover:text-(--accent) hover:scale-105 active:scale-90 relative overflow-visible"
        >
          {icon}
          {/* Burst ring(s) — múltiplos cliques rápidos sobrepoem ondas */}
          {bursts.map((id) => (
            <span
              key={id}
              aria-hidden
              className="anim-pop-burst absolute inset-0 rounded-2xl border-2 border-(--accent) pointer-events-none"
            />
          ))}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  )
}

function ChannelButton({
  channel, isActive, hasUnread, onClick, index,
  canManage, onRename, onDelete, onMarkRead,
}: {
  channel:    ChannelInfo
  isActive:   boolean
  hasUnread:  boolean
  onClick:    () => void
  index:      number
  canManage?: boolean
  onRename?:  (newName: string) => void
  onDelete?:  () => void
  onMarkRead?: () => void
}) {
  const isVoice  = channel.type === 'VOICE'
  const voice    = useVoiceCall()
  const cfg      = useVoiceConfig()
  const inThis   = parseRoomName(voice.roomName)?.id === channel.id
  const confirm  = useConfirm()
  const prompt   = usePrompt()

  const handleClick = () => {
    if (isVoice) {
      // Click em canal de voz: entrar na call. Não navega.
      if (!cfg.data?.enabled) return
      if (inThis) return // já está conectado
      voice.join('channel', channel.id)
    } else {
      onClick()
    }
  }

  // Itens do context menu (right-click) — varia por perm + tipo
  const menuItems: EditorialMenuItem[] = [
    { kind: 'label', label: `${isVoice ? 'Voz' : '#'} ${channel.name}` },
  ]
  if (!isVoice && onMarkRead) {
    menuItems.push({
      kind: 'item',
      icon: <Eye className="size-3.5" />,
      label: 'Marcar como lido',
      onSelect: onMarkRead,
    })
  }
  menuItems.push({
    kind: 'item',
    icon: <Copy className="size-3.5" />,
    label: 'Copiar ID',
    shortcut: '⌘C',
    onSelect: () => { void navigator.clipboard.writeText(channel.id) },
  })
  if (canManage && onRename) {
    menuItems.push({ kind: 'separator' })
    menuItems.push({
      kind: 'item',
      icon: <Pencil className="size-3.5" />,
      label: 'Renomear',
      onSelect: async () => {
        const newName = await prompt({
          title: `Renomear canal`,
          description: `Nome atual: #${channel.name}`,
          label: 'Novo nome',
          placeholder: 'ex: geral',
          defaultValue: channel.name,
          confirmLabel: 'Renomear',
          maxLength: 50,
        })
        if (newName && newName !== channel.name) {
          onRename(newName)
          toast.success(`Canal renomeado para #${newName}`)
        }
      },
    })
  }
  if (canManage && onDelete) {
    menuItems.push({
      kind: 'item',
      icon: <Trash2 className="size-3.5" />,
      label: 'Excluir canal',
      destructive: true,
      onSelect: async () => {
        const ok = await confirm({
          title: `Excluir #${channel.name}?`,
          description: 'Todas as mensagens deste canal serão perdidas. Ação permanente.',
          confirmLabel: 'Excluir',
          destructive: true,
        })
        if (ok) {
          onDelete()
          toast.success(`Canal #${channel.name} excluído`)
        }
      },
    })
  }

  return (
    <EditorialContextMenu items={menuItems}>
    <button
      onClick={handleClick}
      disabled={isVoice && !cfg.data?.enabled}
      title={isVoice && !cfg.data?.enabled ? 'Chamadas não configuradas no servidor' : undefined}
      className={cn(
        'group w-full flex items-center gap-2.5 px-3 py-1.5 border-l-2 rounded-r-lg cursor-pointer text-left relative transition-all duration-300 ease-(--ease-spring) disabled:opacity-50 disabled:cursor-not-allowed',
        isActive || inThis
          ? 'border-(--accent) bg-(--accent-dim)'
          : 'border-transparent bg-transparent hover:border-(--border-bright) hover:bg-(--raised)/40'
      )}
      style={{ animation: `fadeLeft 0.25s var(--ease-spring) ${index * 0.04}s both` }}
    >
      {isVoice ? (
        <Mic className={cn(
          'size-3 shrink-0 transition-colors',
          inThis ? 'text-(--accent)'
            : 'text-(--text-3) group-hover:text-(--text-2)',
        )} />
      ) : (
        <span
          className={cn(
            'font-mono text-marg shrink-0 transition-colors',
            isActive ? 'text-(--accent)'
              : hasUnread ? 'text-foreground'
              : 'text-(--text-3) group-hover:text-(--text-2)',
          )}
        >
          #
        </span>
      )}
      <span className={cn(
        'truncate transition-colors flex-1',
        isActive || inThis ? 'text-(--accent) text-[14px]'
          : hasUnread ? 'text-foreground text-[14px] font-medium'
          : 'text-(--text-2) text-[14px] group-hover:text-foreground',
      )}
      style={{ fontFamily: (isActive || hasUnread || inThis) ? 'var(--font-display)' : 'var(--font-body)' }}>
        {channel.name}
      </span>
      {inThis && (
        <span className="text-[10px] text-(--accent) shrink-0">conectado</span>
      )}
      {!isVoice && hasUnread && !isActive && (
        <span className="size-1.5 rounded-full bg-(--accent) shrink-0" aria-label="Não lido" />
      )}
    </button>
    </EditorialContextMenu>
  )
}

