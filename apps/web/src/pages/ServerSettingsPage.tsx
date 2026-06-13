import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Users as UsersIcon, Image as ImageIcon, Shield, Crown, Trash2, UserMinus, ChevronDown, Clock, Tag, Plus, Pencil, Check, Ban, Hash, Eye, EyeOff, RefreshCw, UserPlus, Search, Link as LinkIcon, Copy, Smile, X, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { api } from '@/lib/api'
import { shareInvite } from '@/lib/native'
import { useAuthStore } from '@/store/authStore'
import { useMyPerms } from '@/hooks/useMyPerms'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useConfirm, usePrompt } from '@/hooks/useConfirm'
import { toast } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ConstellationBanner } from '@/components/astra/Constellation'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { Checkbox } from '@/components/ui/checkbox'
import type { ServerWithChannels } from '@astra/types'
import { useServerEmojis, useUploadEmoji, useDeleteEmoji } from '@/hooks/useServerEmojis'
import { resolveApiUrl } from '@/lib/api'

interface RoleSummary { id: string; name: string; color: string|null; position: number; hoist: boolean }
interface Member {
  id: string; userId: string; role: 'OWNER'|'ADMIN'|'MEMBER'; nameColor: string|null; joinedAt: string
  user: { id: string; username: string; displayName: string; avatarUrl: string|null; bio: string|null }
  roles?: RoleSummary[]
  topColor?: string | null
}
interface Role {
  id: string; serverId: string; name: string; color: string|null; position: number; permissions: string[]; hoist: boolean
}

const PERM_OPTIONS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'MANAGE_SERVER',   label: 'Gerenciar servidor',   desc: 'Editar nome, ícone, retenção' },
  { key: 'MANAGE_ROLES',    label: 'Gerenciar cargos',     desc: 'Criar/editar cargos (sempre pertence ao dono)' },
  { key: 'MANAGE_CHANNELS', label: 'Gerenciar canais',     desc: 'Criar, editar, deletar canais' },
  { key: 'KICK_MEMBERS',    label: 'Remover membros',      desc: 'Expulsar membros' },
  { key: 'BAN_MEMBERS',     label: 'Banir membros',        desc: 'Bloqueio permanente' },
  { key: 'MANAGE_MESSAGES', label: 'Gerenciar mensagens',  desc: 'Apagar mensagens de outros, fixar' },
  { key: 'MENTION_EVERYONE',label: 'Mencionar @everyone',  desc: 'Notifica todo mundo' },
]

const MAX_ICON_BYTES   = 5 * 1024 * 1024
const MAX_BANNER_BYTES = 8 * 1024 * 1024

export default function ServerSettingsPage() {
  const { serverId } = useParams<{ serverId: string }>()
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const currentUser  = useAuthStore((s) => s.user)

  const [name,         setName]         = useState('')
  const [iconUrl,      setIconUrl]      = useState<string | null>(null)
  const [bannerUrl,    setBannerUrl]    = useState<string | null>(null)
  const [retentionDays, setRetentionDays] = useState<number>(0)
  const [isPublic,     setIsPublic]     = useState(false)
  const [description,  setDescription]  = useState('')
  const [error,        setError]        = useState('')
  const [kickTarget,   setKickTarget]   = useState<Member | null>(null)
  const prompt = usePrompt()

  // Server data
  const { data: servers = [] } = useQuery<ServerWithChannels[]>({
    queryKey: ['servers'],
    queryFn:  async () => (await api.get('/api/servers')).data.data,
  })
  const server = servers.find((s) => s.id === serverId)

  useEffect(() => {
    if (server) {
      setName(server.name)
      setIconUrl(server.iconUrl ?? null)
      setBannerUrl(server.bannerUrl ?? null)
      setRetentionDays(server.messageRetentionDays ?? 0)
      setIsPublic(server.isPublic ?? false)
      setDescription(server.description ?? '')
    }
  }, [server?.id])

  // Members
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/members`)).data.data,
    enabled: !!serverId,
  })

  const perms = useMyPerms(serverId)
  const isOwner = perms.isOwner
  const isAdmin = perms.isAdmin || isOwner

  const updateServer = useMutation({
    mutationFn: async (patch: { name?: string; iconUrl?: string | null; bannerUrl?: string | null; messageRetentionDays?: number | null; isPublic?: boolean; description?: string | null }) =>
      (await api.patch(`/api/servers/${serverId}`, patch)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      setError('')
    },
    onError: (e: any) => setError(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const retentionPresets = [
    { v: 0,   label: 'Pra sempre',  hint: 'Mensagens nunca expiram' },
    { v: 1,   label: '24 horas',    hint: 'Apaga após 1 dia' },
    { v: 7,   label: '7 dias',      hint: 'Apaga após 1 semana' },
    { v: 30,  label: '30 dias',     hint: 'Apaga após 1 mês' },
    { v: 90,  label: '90 dias',     hint: 'Apaga após 3 meses' },
    { v: 365, label: '1 ano',       hint: 'Apaga após 1 ano' },
  ]

  const setMemberRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: 'ADMIN'|'MEMBER' }) =>
      (await api.patch(`/api/servers/${serverId}/members/${memberId}`, { role })).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', serverId] })
      queryClient.invalidateQueries({ queryKey: ['perms', serverId] })
    },
  })

  const kickMember = useMutation({
    mutationFn: async (memberId: string) => api.delete(`/api/servers/${serverId}/members/${memberId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['members', serverId] }); setKickTarget(null) },
    onError:   (e: any) => setError(e.response?.data?.error ?? 'Erro ao remover'),
  })

  const banMember = useMutation({
    mutationFn: async (p: { userId: string; reason?: string|null }) =>
      api.post(`/api/servers/${serverId}/bans`, p),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', serverId] })
      queryClient.invalidateQueries({ queryKey: ['bans', serverId] })
    },
    onError: (e: any) => setError(e.response?.data?.error ?? 'Erro ao banir'),
  })

  const deleteServer = useMutation({
    mutationFn: async () => api.delete(`/api/servers/${serverId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      navigate('/app')
    },
  })

  const [showDelete, setShowDelete] = useState(false)
  const [showInviteFriends, setShowInviteFriends] = useState(false)
  const confirm = useConfirm()

  // Regenera inviteCode: invalida link antigo, atualiza cache de servers
  const regenerateInvite = useMutation({
    mutationFn: async () => (await api.post(`/api/servers/${serverId}/regenerate-invite`)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Link de convite regenerado. Links antigos não funcionam mais.')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao regenerar convite'),
  })

  const handleRegenerateInvite = async () => {
    const ok = await confirm({
      title: 'Regenerar link de convite?',
      description: 'Qualquer pessoa com o link antigo NÃO conseguirá mais entrar. Use isso se o link vazou ou você quer revogá-lo.',
      confirmLabel: 'Sim, regenerar',
      destructive: true,
    })
    if (ok) regenerateInvite.mutate()
  }

  const copyInvite = () => {
    if (!server) return
    // App nativo: share sheet do OS. Web: clipboard como antes.
    shareInvite(server.inviteCode)
      .then((mode) => { if (mode === 'copied') toast.success('Link copiado') })
      .catch(() => toast.error('Falha ao copiar — copie manualmente'))
  }

  const handleBannerFile = (file: File) => {
    if (file.size > MAX_BANNER_BYTES) { setError('Banner maior que 8MB'); return }
    const fr = new FileReader()
    fr.onload = () => { const url = String(fr.result); setBannerUrl(url); updateServer.mutate({ bannerUrl: url }) }
    fr.readAsDataURL(file)
  }

  const handleIconFile = (file: File) => {
    if (file.size > MAX_ICON_BYTES) { setError('Ícone maior que 5MB'); return }
    const fr = new FileReader()
    fr.onload = () => { const url = String(fr.result); setIconUrl(url); updateServer.mutate({ iconUrl: url }) }
    fr.readAsDataURL(file)
  }

  if (!server) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 h-full text-sm text-(--text-3)">
        <Spinner size={14} /> Carregando…
      </div>
    )
  }

  return (
    // h-full (NÃO h-screen-safe): a página vive DENTRO do shell do AppPage,
    // que já desconta tab bar + notch — 100svh aqui estourava por baixo e
    // cortava o conteúdo no app.
    <div className="flex-1 min-w-0 h-full overflow-y-auto">
      {/* Header */}
      <header className="sticky top-0 z-10 h-16 px-4 sm:px-6 flex items-center gap-3 border-b border-(--border) bg-(--base)/95 backdrop-blur">
        <button
          onClick={() => navigate(-1)}
          className="size-9 flex items-center justify-center border border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent) transition-all cursor-pointer"
          aria-label="Voltar"
        >
          <ArrowLeft className="size-4" />
        </button>
        <span className="ed-roman text-lg hidden sm:inline">§§</span>
        <span className="ed-marg hidden sm:inline">{server.isGroup ? 'Grupo' : 'Servidor'}</span>
        <span className="h-4 w-px bg-(--border-mid) hidden sm:inline-block" />
        <h1
          className="text-lg sm:text-xl m-0 font-normal tracking-tight text-foreground truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {server.name}
        </h1>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="mb-6 flex flex-wrap gap-1">
            <TabsTrigger value="overview" className="gap-2"><ImageIcon className="size-3.5" /> Visão geral</TabsTrigger>
            <TabsTrigger value="members"  className="gap-2"><UsersIcon className="size-3.5" /> Membros ({members.length})</TabsTrigger>
            {perms.has('MANAGE_ROLES') && (
              <TabsTrigger value="roles" className="gap-2"><Tag className="size-3.5" /> Cargos</TabsTrigger>
            )}
            {perms.has('MANAGE_CHANNELS') && (
              <TabsTrigger value="channels" className="gap-2"><Hash className="size-3.5" /> Canais</TabsTrigger>
            )}
            {perms.has('MANAGE_CHANNELS') && (
              <TabsTrigger value="emojis" className="gap-2"><Smile className="size-3.5" /> Emojis</TabsTrigger>
            )}
            {perms.has('BAN_MEMBERS') && (
              <TabsTrigger value="bans" className="gap-2"><Ban className="size-3.5" /> Banidos</TabsTrigger>
            )}
          </TabsList>

          {/* ── OVERVIEW ─────────────────────── */}
          <TabsContent value="overview" className="space-y-8">
            <section className="space-y-3">
              <span className="ed-label">— I. Ícone</span>
              <div className="flex items-center gap-5 flex-wrap">
                <div
                  className="size-24 flex items-center justify-center border border-(--border) bg-(--raised) overflow-hidden shrink-0"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {iconUrl
                    ? <img src={iconUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    : <span className="text-2xl text-(--text-2)">{server.name.slice(0,2).toUpperCase()}</span>}
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    id="iconUpload"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleIconFile(f) }}
                    disabled={!isAdmin}
                  />
                  <label
                    htmlFor="iconUpload"
                    className={`inline-flex items-center gap-2 px-4 h-10 border border-(--border) text-sm cursor-pointer transition-colors ${isAdmin ? 'hover:border-(--accent) hover:text-(--accent)' : 'opacity-50 cursor-not-allowed'}`}
                  >
                    <ImageIcon className="size-3.5" /> Carregar imagem
                  </label>
                  {iconUrl && isAdmin && (
                    <button
                      onClick={() => { setIconUrl(null); updateServer.mutate({ iconUrl: null }) }}
                      className="text-xs text-(--text-3) hover:text-(--danger) text-left transition-colors cursor-pointer"
                    >Remover ícone</button>
                  )}
                  <p className="text-[11px] text-(--text-3) m-0">PNG, JPG, GIF ou WebP · max 5MB · GIF anima no hover/ativo</p>
                </div>
              </div>
            </section>

            <Separator className="my-5" />

            <section className="space-y-3">
              <span className="ed-label">— II. Banner</span>
              <p className="text-xs text-(--text-3) m-0 max-w-md">
                Aparece no topo da lista de canais e na página de convite.
                Sem banner, a constelação-assinatura do nome assume.
              </p>
              <div className="flex flex-col gap-3 max-w-md">
                <div className="relative w-full h-28 border border-(--border) overflow-hidden">
                  {bannerUrl
                    ? <img src={bannerUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    : <ConstellationBanner name={server.name} stars={members.length || undefined} className="w-full h-full" />}
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    id="bannerUpload"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBannerFile(f) }}
                    disabled={!isAdmin}
                  />
                  <label
                    htmlFor="bannerUpload"
                    className={`inline-flex items-center gap-2 px-4 h-10 border border-(--border) text-sm cursor-pointer transition-colors self-start ${isAdmin ? 'hover:border-(--accent) hover:text-(--accent)' : 'opacity-50 cursor-not-allowed'}`}
                  >
                    <ImageIcon className="size-3.5" /> Carregar banner
                  </label>
                  {bannerUrl && isAdmin && (
                    <button
                      onClick={() => { setBannerUrl(null); updateServer.mutate({ bannerUrl: null }) }}
                      className="text-xs text-(--text-3) hover:text-(--danger) text-left transition-colors cursor-pointer"
                    >Remover banner (volta pra constelação)</button>
                  )}
                  <p className="text-[11px] text-(--text-3) m-0">PNG, JPG, GIF ou WebP (animado ok) · max 8MB · ideal 600×200+</p>
                </div>
              </div>
            </section>

            {!server.isGroup && (
              <>
                <Separator className="my-5" />
                <section className="space-y-3">
                  <span className="ed-label">— III. Descoberta</span>
                  <p className="text-xs text-(--text-3) m-0 max-w-md">
                    Liste sua constelação no diretório público — qualquer um pode achar e entrar sem convite.
                  </p>
                  <button
                    onClick={() => { if (!isAdmin) return; const next = !isPublic; setIsPublic(next); updateServer.mutate({ isPublic: next }) }}
                    disabled={!isAdmin}
                    className={`self-start inline-flex items-center gap-2.5 px-4 h-10 border text-sm transition-colors ${isAdmin ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'} ${isPublic ? 'border-(--accent) bg-(--accent-dim) text-(--accent)' : 'border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent)'}`}
                  >
                    <span className={`size-3.5 rounded-full border shrink-0 transition-colors ${isPublic ? 'bg-(--accent) border-(--accent)' : 'border-(--border-mid)'}`} />
                    {isPublic ? 'Listada na Descoberta' : 'Listar na Descoberta'}
                  </button>
                  {isPublic && (
                    <div className="flex flex-col gap-2 max-w-md">
                      <Label htmlFor="srvDesc">Descrição no diretório</Label>
                      <textarea
                        id="srvDesc"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        onBlur={() => { if (isAdmin && description !== (server.description ?? '')) updateServer.mutate({ description: description.trim() || null }) }}
                        disabled={!isAdmin}
                        maxLength={200}
                        rows={2}
                        placeholder="Sobre o que é essa constelação?"
                        className="w-full px-3 py-2 border border-(--border) bg-(--raised) text-sm text-foreground resize-none focus:border-(--accent) outline-none"
                      />
                      <p className="text-[11px] text-(--text-3) m-0">{description.length}/200 · salva ao sair do campo.</p>
                    </div>
                  )}
                </section>
              </>
            )}

            <Separator className="my-5" />

            <section className="space-y-3">
              <span className="ed-label">— IV. Nome</span>
              <div className="flex flex-col gap-2 max-w-md">
                <Label htmlFor="srvName">Nome do {server.isGroup ? 'grupo' : 'servidor'}</Label>
                <Input
                  id="srvName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => { if (name.trim() && name !== server.name) updateServer.mutate({ name: name.trim() }) }}
                  disabled={!isAdmin}
                  maxLength={100}
                />
                <p className="text-[11px] text-(--text-3) m-0">Salva ao sair do campo.</p>
              </div>
            </section>

            {!server.isGroup && (
              <>
                <Separator className="my-5" />
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <LinkIcon className="size-3.5 text-(--text-3)" />
                    <span className="ed-label">— V. Convite</span>
                  </div>
                  <p className="text-sm text-(--text-2) m-0 max-w-prose">
                    Qualquer pessoa com este link pode entrar. Pra revogar acesso, regenere o código.
                  </p>
                  <div className="flex items-center gap-2 max-w-xl flex-wrap">
                    <Input
                      readOnly
                      value={`${window.location.origin}/invite/${server.inviteCode}`}
                      className="font-mono text-[12px] flex-1 min-w-64"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="secondary" onClick={copyInvite} className="gap-1.5">
                          <Copy className="size-3.5" /> Copiar
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copia link pra área de transferência</TooltipContent>
                    </Tooltip>
                    {isAdmin && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            onClick={handleRegenerateInvite}
                            disabled={regenerateInvite.isPending}
                            className="gap-1.5"
                          >
                            <RefreshCw className={`size-3.5 ${regenerateInvite.isPending ? 'animate-spin' : ''}`} />
                            {regenerateInvite.isPending ? 'Gerando…' : 'Regenerar'}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Gera novo código — invalida o atual</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  {!isAdmin && (
                    <p className="text-[11px] text-(--text-3) italic m-0">
                      Só admins podem regenerar o código.
                    </p>
                  )}
                </section>
              </>
            )}

            <Separator className="my-5" />

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="size-3.5 text-(--text-3)" />
                <span className="ed-label">— {server.isGroup ? 'IV' : 'IV'}. Retenção de mensagens</span>
              </div>
              <p className="text-sm text-(--text-2) m-0 max-w-prose">
                Defina por quanto tempo as mensagens ficam guardadas. Após o período, são apagadas automaticamente junto com anexos.
              </p>
              {!isAdmin && (
                <p className="text-xs text-(--text-3) italic">Só admins podem mudar.</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-2xl">
                {retentionPresets.map((p) => {
                  const active = retentionDays === p.v
                  return (
                    <button
                      key={p.v}
                      disabled={!isAdmin}
                      onClick={() => { setRetentionDays(p.v); updateServer.mutate({ messageRetentionDays: p.v }) }}
                      className={`text-left p-3 border transition-colors cursor-pointer ${
                        active
                          ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                          : 'border-(--border) hover:border-(--accent) hover:text-(--accent)'
                      } ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <p className="m-0 text-sm font-medium" style={{ fontFamily: 'var(--font-display)' }}>{p.label}</p>
                      <p className="m-0 mt-1 text-[11px] text-(--text-3)">{p.hint}</p>
                    </button>
                  )
                })}
              </div>
              {retentionDays > 0 && (
                <p className="ed-marg">
                  Worker roda 1x/h · próxima exclusão pega tudo mais velho que {retentionDays}d
                </p>
              )}
            </section>

            {error && <p className="text-xs text-(--danger)">{error}</p>}

            {/* ── Zona de perigo (só dono) ─────────────────── */}
            {isOwner && (
              <>
                <Separator className="my-5" />
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Trash2 className="size-3.5 text-(--danger)" />
                    <span className="ed-label text-(--danger)!">— Zona de perigo</span>
                  </div>
                  <div className="border border-(--danger)/40 bg-(--danger)/5 p-5">
                    <h3 className="text-base m-0 mb-1 text-(--danger)" style={{ fontFamily: 'var(--font-display)' }}>
                      Excluir {server.isGroup ? 'grupo' : 'servidor'}
                    </h3>
                    <p className="text-sm text-(--text-2) m-0 mb-3">
                      Ação permanente. Todos os canais, mensagens e membros serão removidos.
                    </p>
                    <Button variant="destructive" onClick={() => setShowDelete(true)}>
                      <Trash2 className="size-3.5 mr-2" /> Excluir definitivamente
                    </Button>
                  </div>
                </section>
              </>
            )}
          </TabsContent>

          {/* ── MEMBERS ─────────────────────── */}
          <TabsContent value="members" className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="ed-label">— Membros</span>
              <div className="flex-1 h-px bg-(--border)" />
              <span className="ed-marg">{members.length}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowInviteFriends(true)}
                className="gap-1.5 h-7"
              >
                <UserPlus className="size-3.5" /> Convidar amigo
              </Button>
            </div>
            <div className="flex flex-col gap-1.5" role="list">
              {members.map((m, i) => (
                <motion.div
                  key={m.id}
                  role="listitem"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.3), ease: [0.16, 1, 0.3, 1] }}
                >
                  <MemberRow
                    member={m}
                    serverId={serverId!}
                    currentUserId={currentUser?.id}
                    isOwnerSelf={isOwner}
                    isAdminSelf={isAdmin}
                    canBan={perms.has('BAN_MEMBERS')}
                    onSetRole={(role) => setMemberRole.mutate({ memberId: m.id, role })}
                    onKick={() => setKickTarget(m)}
                    onBan={async () => {
                      const reason = await prompt({
                        title: `Banir ${m.user.displayName}?`,
                        description: 'Banimento é permanente até desbanido. Motivo aparece no audit log.',
                        label: 'Motivo (opcional)',
                        placeholder: 'ex: spam, comportamento abusivo…',
                        confirmLabel: 'Banir',
                      })
                      if (reason === null) return
                      banMember.mutate({ userId: m.userId, reason: reason || null }, {
                        onSuccess: () => toast.success(`${m.user.displayName} foi banido`),
                      })
                    }}
                  />
                </motion.div>
              ))}
            </div>
          </TabsContent>

          {/* ── ROLES ─────────────────────── */}
          {perms.has('MANAGE_ROLES') && (
            <TabsContent value="roles" className="space-y-2">
              <RolesSection serverId={serverId!} />
            </TabsContent>
          )}

          {/* ── CHANNELS visibility ─────────────────────── */}
          {perms.has('MANAGE_CHANNELS') && (
            <TabsContent value="channels" className="space-y-2">
              <ChannelsVisibilitySection serverId={serverId!} channels={server.channels ?? []} />
            </TabsContent>
          )}

          {/* ── EMOJIS ─────────────────────── */}
          {perms.has('MANAGE_CHANNELS') && (
            <TabsContent value="emojis" className="space-y-2">
              <EmojisSection serverId={serverId!} />
            </TabsContent>
          )}

          {/* ── BANS ─────────────────────── */}
          {perms.has('BAN_MEMBERS') && (
            <TabsContent value="bans" className="space-y-2">
              <BansSection serverId={serverId!} />
            </TabsContent>
          )}

        </Tabs>
      </div>

      {/* Confirm kick */}
      <Dialog open={!!kickTarget} onOpenChange={(o: boolean) => !o && setKickTarget(null)}>
        <DialogContent className="max-w-95!">
          <DialogHeader>
            <DialogTitle>Remover {kickTarget?.user.displayName}?</DialogTitle>
            <DialogDescription>Eles perdem acesso imediatamente.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setKickTarget(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => kickTarget && kickMember.mutate(kickTarget.id)} disabled={kickMember.isPending}>
              {kickMember.isPending ? 'Removendo…' : 'Remover'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convite por amigo — dialog com lista filtrada */}
      <InviteFriendsDialog
        open={showInviteFriends}
        onClose={() => setShowInviteFriends(false)}
        serverId={serverId!}
        serverName={server.name}
        currentMemberUserIds={new Set(members.map((m) => m.userId))}
      />

      {/* Confirm delete server */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-95! text-center">
          <div className="flex justify-center mb-1">
            <div className="size-12 rounded-full bg-(--danger)/10 flex items-center justify-center">
              <Trash2 className="size-6 text-(--danger)" />
            </div>
          </div>
          <DialogHeader className="text-center! items-center!">
            <DialogTitle>Excluir {server.name}?</DialogTitle>
            <DialogDescription>Permanente. Não pode ser desfeito.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button variant="secondary" className="flex-1" onClick={() => setShowDelete(false)}>Cancelar</Button>
            <Button variant="destructive" className="flex-1" onClick={() => deleteServer.mutate()} disabled={deleteServer.isPending}>
              {deleteServer.isPending ? 'Excluindo…' : 'Sim, excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MemberRow({ member, serverId, currentUserId, isOwnerSelf, isAdminSelf, canBan, onSetRole, onKick, onBan }: {
  member: Member
  serverId: string
  currentUserId?: string
  isOwnerSelf: boolean
  isAdminSelf: boolean
  canBan: boolean
  onSetRole: (role: 'ADMIN'|'MEMBER') => void
  onKick: () => void
  onBan: () => void
}) {
  const [rolesOpen, setRolesOpen] = useState(false)
  const isSelf  = member.userId === currentUserId
  const isOwner = member.role === 'OWNER'
  const canChangeRole = isOwnerSelf && !isOwner && !isSelf
  const canKick = isAdminSelf && !isOwner && !isSelf && !(member.role === 'ADMIN' && !isOwnerSelf)

  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-transparent hover:border-(--border) hover:bg-(--raised)/40 transition-colors">
      <Avatar className="size-9 shrink-0">
        {member.user.avatarUrl && <AvatarImage src={member.user.avatarUrl} referrerPolicy="no-referrer" />}
        <AvatarFallback className="text-xs">{member.user.displayName.slice(0,1).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate" style={{ fontFamily: 'var(--font-display)' }}>
            {member.user.displayName}
          </span>
          {isOwner && (
            <Badge variant="default"><Crown className="size-2.5" /> Dono</Badge>
          )}
          {member.role === 'ADMIN' && (
            <Badge variant="secondary"><Shield className="size-2.5" /> Admin</Badge>
          )}
          {member.roles?.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 border"
              style={{
                color:        r.color ?? 'var(--text-2)',
                borderColor:  (r.color ?? 'var(--border)') + '66',
                background:   (r.color ?? 'var(--raised)') + '15',
              }}
            >
              {r.name}
            </span>
          ))}
        </div>
        <p className="text-[11px] font-mono text-(--text-3) m-0 truncate">@{member.user.username}</p>
      </div>

      {/* OWNER row: nunca tem ações disponíveis — esconde o trigger pra não mostrar dropdown vazio */}
      {!isOwner && (canChangeRole || canKick || isOwnerSelf) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="size-8 flex items-center justify-center border border-(--border) text-(--text-3) hover:border-(--accent) hover:text-(--accent) transition-colors cursor-pointer">
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isOwnerSelf && !isOwner && (
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setRolesOpen((v) => !v) }}>
                <Tag className="size-3.5" /> Editar cargos
              </DropdownMenuItem>
            )}
            {canChangeRole && member.role !== 'ADMIN' && (
              <DropdownMenuItem onSelect={() => onSetRole('ADMIN')}>
                <Shield className="size-3.5" /> Promover a Admin
              </DropdownMenuItem>
            )}
            {canChangeRole && member.role === 'ADMIN' && (
              <DropdownMenuItem onSelect={() => onSetRole('MEMBER')}>
                <Shield className="size-3.5" /> Rebaixar a Membro
              </DropdownMenuItem>
            )}
            {canKick && (
              <DropdownMenuItem destructive onSelect={onKick}>
                <UserMinus className="size-3.5" /> Remover do servidor
              </DropdownMenuItem>
            )}
            {canBan && !isOwner && !isSelf && (
              <DropdownMenuItem destructive onSelect={onBan}>
                <Ban className="size-3.5" /> Banir
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {rolesOpen && (
        <MemberRolesPopover
          serverId={serverId}
          memberId={member.id}
          currentRoleIds={(member.roles ?? []).map((r) => r.id)}
          onClose={() => setRolesOpen(false)}
        />
      )}
    </div>
  )
}

function RolesSection({ serverId }: { serverId: string }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/roles`)).data.data,
  })

  const [editing, setEditing] = useState<Role | 'new' | null>(null)

  const create = useMutation({
    mutationFn: async (body: Partial<Role>) => (await api.post(`/api/servers/${serverId}/roles`, body)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles', serverId] })
      queryClient.invalidateQueries({ queryKey: ['perms', serverId] })
      setEditing(null)
    },
  })
  const update = useMutation({
    mutationFn: async ({ id, ...body }: Partial<Role> & { id: string }) =>
      (await api.patch(`/api/servers/${serverId}/roles/${id}`, body)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles', serverId] })
      queryClient.invalidateQueries({ queryKey: ['members', serverId] })
      queryClient.invalidateQueries({ queryKey: ['perms', serverId] })
      setEditing(null)
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/servers/${serverId}/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles', serverId] })
      queryClient.invalidateQueries({ queryKey: ['members', serverId] })
      queryClient.invalidateQueries({ queryKey: ['perms', serverId] })
    },
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="ed-label">— Cargos</span>
        <div className="flex-1 h-px bg-(--border)" />
        <Button size="sm" onClick={() => setEditing('new')} className="gap-2">
          <Plus className="size-3.5" /> Novo cargo
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-(--text-3)"><Spinner size={12} /> Carregando…</div>
      )}

      {!isLoading && roles.length === 0 && (
        <p className="text-sm text-(--text-3) italic">Nenhum cargo ainda. Cria o primeiro.</p>
      )}

      <ul className="flex flex-col gap-1">
        {roles.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 px-3 py-2 border border-(--border) hover:bg-(--raised)/40 transition-colors"
          >
            <span
              className="size-4 rounded-full border shrink-0"
              style={{ background: r.color ?? 'transparent', borderColor: r.color ?? 'var(--border)' }}
            />
            <span className="flex-1 text-sm" style={{ fontFamily: 'var(--font-display)', color: r.color ?? undefined }}>
              {r.name}
            </span>
            <span className="text-[10px] font-mono text-(--text-3)">
              {r.permissions.length > 0 ? `${r.permissions.length} perm` : '—'}
            </span>
            <button
              onClick={() => setEditing(r)}
              className="size-7 flex items-center justify-center border border-(--border) text-(--text-3) hover:border-(--accent) hover:text-(--accent) transition-colors cursor-pointer"
              title="Editar"
            >
              <Pencil className="size-3" />
            </button>
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: `Excluir cargo "${r.name}"?`,
                  description: 'Membros com esse cargo perdem permissões associadas. Não-reversível.',
                  confirmLabel: 'Excluir cargo',
                  destructive: true,
                })
                if (ok) {
                  remove.mutate(r.id, {
                    onSuccess: () => toast.success(`Cargo "${r.name}" excluído`),
                  })
                }
              }}
              className="size-7 flex items-center justify-center border border-(--border) text-(--text-3) hover:border-(--danger) hover:text-(--danger) transition-colors cursor-pointer"
              title="Excluir"
            >
              <Trash2 className="size-3" />
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <RoleEditor
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(body) => {
            if (editing === 'new') create.mutate(body)
            else update.mutate({ ...body, id: editing.id })
          }}
          saving={create.isPending || update.isPending}
        />
      )}
    </div>
  )
}

function RoleEditor({ role, onClose, onSave, saving }: {
  role: Role | null
  onClose: () => void
  onSave: (body: Partial<Role>) => void
  saving: boolean
}) {
  const [name, setName]   = useState(role?.name ?? '')
  const [color, setColor] = useState<string>(role?.color ?? '#c9a96e')
  const [hoist, setHoist] = useState<boolean>(role?.hoist ?? false)
  const [hasColor, setHasColor] = useState<boolean>(role?.color != null)
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? [])

  const togglePerm = (key: string) =>
    setPerms((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key])

  return (
    <Dialog open onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{role ? `Editar "${role.name}"` : 'Novo cargo'}</DialogTitle>
          <DialogDescription>Customize nome, cor e permissões.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="roleName">Nome</Label>
            <Input id="roleName" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoFocus />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={hasColor} onCheckedChange={(v) => setHasColor(!!v)} />
              Cor personalizada
            </Label>
            {hasColor && (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="size-10 cursor-pointer bg-transparent border border-(--border-mid) rounded-lg"
                />
                <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#RRGGBB" className="w-32 font-mono" />
                <span
                  className="px-3 py-1.5 border rounded-lg text-sm flex-1"
                  style={{ color, borderColor: color, background: color + '15', fontFamily: 'var(--font-display)' }}
                >
                  {name || 'Nome do cargo'}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={hoist} onCheckedChange={(v) => setHoist(!!v)} />
              Exibir separadamente na lista de membros (hoist)
            </Label>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Permissões</Label>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {PERM_OPTIONS.map((p) => {
                const active = perms.includes(p.key)
                return (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => togglePerm(p.key)}
                      className={`w-full text-left p-2 border transition-colors cursor-pointer ${
                        active
                          ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                          : 'border-(--border) hover:border-(--accent) hover:text-(--accent)'
                      }`}
                    >
                      <p className="text-xs m-0 font-medium" style={{ fontFamily: 'var(--font-display)' }}>{p.label}</p>
                      <p className="text-[10px] m-0 text-(--text-3) mt-0.5">{p.desc}</p>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => onSave({ name: name.trim(), color: hasColor ? color : null, hoist, permissions: perms })}
            disabled={!name.trim() || saving}
          >
            {saving ? 'Salvando…' : (role ? 'Salvar' : 'Criar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MemberRolesPopover({ serverId, memberId, currentRoleIds, onClose }: {
  serverId: string
  memberId: string
  currentRoleIds: string[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/roles`)).data.data,
  })

  const assign = useMutation({
    mutationFn: async (roleId: string) => api.post(`/api/servers/${serverId}/members/${memberId}/roles/${roleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', serverId] })
      queryClient.invalidateQueries({ queryKey: ['perms', serverId] })
    },
  })
  const unassign = useMutation({
    mutationFn: async (roleId: string) => api.delete(`/api/servers/${serverId}/members/${memberId}/roles/${roleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', serverId] })
      queryClient.invalidateQueries({ queryKey: ['perms', serverId] })
    },
  })

  const toggle = (roleId: string) => {
    if (currentRoleIds.includes(roleId)) unassign.mutate(roleId)
    else assign.mutate(roleId)
  }

  return (
    <Dialog open onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cargos do membro</DialogTitle>
          <DialogDescription>Marque pra atribuir, desmarque pra remover.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1 max-h-80 overflow-y-auto">
          {roles.length === 0 && <p className="text-sm text-(--text-3) italic">Sem cargos criados ainda — vai na aba Cargos.</p>}
          {roles.map((r) => {
            const active = currentRoleIds.includes(r.id)
            return (
              <li key={r.id}>
                <button
                  onClick={() => toggle(r.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 border border-transparent hover:border-(--border) hover:bg-(--raised)/40 transition-colors cursor-pointer"
                >
                  <span
                    className="size-3 rounded-full border shrink-0"
                    style={{ background: r.color ?? 'transparent', borderColor: r.color ?? 'var(--border)' }}
                  />
                  <span className="flex-1 text-left text-sm">{r.name}</span>
                  {active && <Check className="size-3.5 text-(--accent)" />}
                </button>
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── EmojisSection ────────────────────────────────────────────
function EmojisSection({ serverId }: { serverId: string }) {
  const { data: emojis = [], isLoading } = useServerEmojis(serverId)
  const upload  = useUploadEmoji(serverId)
  const remove  = useDeleteEmoji(serverId)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [err,  setErr]  = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    setErr(null)
    if (!file) { setErr('Selecione um arquivo'); return }
    if (!/^[a-z0-9_]{2,32}$/i.test(name)) { setErr('Nome 2-32 chars, alfanum + underscore'); return }
    try {
      await upload.mutateAsync({ file, name })
      setName(''); setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Falha no upload')
    }
  }

  return (
    <section>
      <h3 className="text-sm font-medium text-foreground mb-1" style={{ fontFamily: 'var(--font-display)' }}>
        Emojis customizados
      </h3>
      <p className="text-marg text-(--text-3) m-0 mb-4">
        Até 50 por servidor. PNG/JPG/WebP/GIF até 512KB — recompressados em WebP 128×128. Use no chat como <code>:nome:</code>.
      </p>

      <div className="border border-(--border) bg-(--raised)/30 p-4 mb-4">
        <p className="text-xs text-(--text-2) mb-3">Adicionar emoji</p>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
          <div className="flex-1 flex flex-col gap-1">
            <Label htmlFor="emoji-name" className="text-[10px] uppercase tracking-wider text-(--text-3)">Nome</Label>
            <Input
              id="emoji-name"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())}
              placeholder="party_parrot"
              maxLength={32}
            />
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <Label htmlFor="emoji-file" className="text-[10px] uppercase tracking-wider text-(--text-3)">Arquivo</Label>
            <input
              ref={inputRef}
              id="emoji-file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs text-(--text-2)"
            />
          </div>
          <Button onClick={submit} disabled={upload.isPending || !file || !name} className="gap-2">
            {upload.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Adicionar
          </Button>
        </div>
        {err && <p className="text-xs text-(--danger) mt-2 m-0">{err}</p>}
        <p className="text-[10px] text-(--text-3) mt-2 m-0">{emojis.length}/50 usados</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-(--text-3)">
          <Loader2 className="size-3.5 animate-spin" /> Carregando…
        </div>
      ) : emojis.length === 0 ? (
        <p className="text-sm text-(--text-3) italic m-0">Nenhum emoji ainda.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
          {emojis.map((e) => (
            <li key={e.id} className="border border-(--border) bg-(--raised)/30 p-3 flex flex-col items-center gap-2 group relative">
              <img
                src={resolveApiUrl(e.url)}
                alt={`:${e.name}:`}
                width={48}
                height={48}
                className="size-12 object-contain"
              />
              <p className="text-xs text-(--text-2) m-0 truncate w-full text-center">:{e.name}:</p>
              <button
                onClick={() => {
                  if (confirm(`Excluir :${e.name}:?`)) remove.mutate(e.id)
                }}
                className="absolute top-1 right-1 size-6 grid place-items-center text-(--text-3) hover:text-(--danger) opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                aria-label="Excluir"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── BansSection ──────────────────────────────────────────────
interface BanRow {
  id: string; userId: string; bannedById: string; reason: string|null; createdAt: string
  user: { id: string; username: string; displayName: string; avatarUrl: string|null }
}
function BansSection({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const { data: bans = [], isLoading } = useQuery<BanRow[]>({
    queryKey: ['bans', serverId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/bans`)).data.data,
  })
  const unban = useMutation({
    mutationFn: async (userId: string) => (await api.delete(`/api/servers/${serverId}/bans/${userId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bans', serverId] }),
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="ed-label">— Banidos</span>
        <div className="flex-1 h-px bg-(--border)" />
        <span className="ed-marg">{bans.length}</span>
      </div>
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-(--text-3)"><Spinner size={12} /> Carregando…</div>
      )}
      {!isLoading && bans.length === 0 && (
        <p className="text-sm text-(--text-3) italic">Ninguém banido. Banimentos aparecem aqui.</p>
      )}
      <ul className="flex flex-col gap-1.5">
        {bans.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-3 py-2 border border-(--border) bg-(--raised)/30">
            <Avatar className="size-8">
              <AvatarImage src={b.user.avatarUrl ?? undefined} />
              <AvatarFallback>{b.user.displayName.slice(0,2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="m-0 text-sm" style={{ fontFamily: 'var(--font-display)' }}>{b.user.displayName}</p>
              <p className="m-0 text-[11px] text-(--text-3) truncate">
                @{b.user.username}{b.reason ? ` · ${b.reason}` : ''}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => unban.mutate(b.userId)} disabled={unban.isPending}>
              Desbanir
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── ChannelsVisibilitySection ───────────────────────────────
function ChannelsVisibilitySection({ serverId, channels }: { serverId: string; channels: Array<{ id: string; name: string; type?: string }> }) {
  const [selectedId, setSelectedId]   = useState<string | null>(channels[0]?.id ?? null)
  const [createOpen,  setCreateOpen]  = useState(false)
  const [newName,     setNewName]     = useState('')
  const [newType,     setNewType]     = useState<'TEXT' | 'VOICE'>('TEXT')
  const [createErr,   setCreateErr]   = useState('')
  const qc = useQueryClient()
  const confirm = useConfirm()

  const { data: roles = [] } = useQuery<Array<{ id: string; name: string; color: string | null }>>({
    queryKey: ['roles', serverId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/roles`)).data.data,
  })

  const { data: vis, isLoading } = useQuery<{ isPrivate: boolean; roleIds: string[] }>({
    queryKey: ['channel-vis', selectedId],
    queryFn:  async () => (await api.get(`/api/servers/${serverId}/channels/${selectedId}/visibility`)).data.data,
    enabled:  !!selectedId,
  })

  const mut = useMutation({
    mutationFn: async (patch: { isPrivate: boolean; roleIds: string[] }) => {
      await api.patch(`/api/servers/${serverId}/channels/${selectedId}/visibility`, patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-vis', selectedId] })
      qc.invalidateQueries({ queryKey: ['servers'] })
    },
  })

  const createChannel = useMutation({
    mutationFn: async ({ name, type }: { name: string; type: 'TEXT' | 'VOICE' }) =>
      (await api.post(`/api/servers/${serverId}/channels`, { name, type })).data.data,
    onSuccess: (ch: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      setSelectedId(ch.id)
      setCreateOpen(false); setNewName(''); setNewType('TEXT'); setCreateErr('')
    },
    onError: (e: any) => setCreateErr(e?.response?.data?.error ?? 'Erro ao criar'),
  })

  const deleteChannel = useMutation({
    mutationFn: async (channelId: string) => api.delete(`/api/servers/${serverId}/channels/${channelId}`),
    onSuccess: (_d, channelId) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      if (selectedId === channelId) setSelectedId(null)
    },
  })

  const isPrivate      = vis?.isPrivate ?? false
  const allowedRoleIds = vis?.roleIds ?? []

  const toggleRole = (roleId: string) => {
    const next = allowedRoleIds.includes(roleId)
      ? allowedRoleIds.filter((id) => id !== roleId)
      : [...allowedRoleIds, roleId]
    mut.mutate({ isPrivate: true, roleIds: next })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="ed-label">— Canais</span>
        <div className="flex-1 h-px bg-(--border)" />
        <Button size="sm" onClick={() => { setCreateOpen(true); setCreateErr('') }} className="gap-2">
          <Plus className="size-3.5" /> Novo canal
        </Button>
      </div>

      <div className="grid sm:grid-cols-[200px_1fr] gap-5">
      <ul className="border border-(--border) max-h-100 overflow-y-auto">
        {channels.length === 0 && (<li className="p-4 text-xs text-(--text-3) italic">Sem canais. Cria o primeiro.</li>)}
        {channels.map((c) => {
          const isVoice = c.type === 'VOICE'
          const active  = c.id === selectedId
          return (
            <li key={c.id} className="group flex items-center">
              <button
                onClick={() => setSelectedId(c.id)}
                className={`flex-1 px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                  active ? 'bg-(--accent)/10 text-(--accent)' : 'text-(--text-2) hover:bg-(--raised)/40'
                }`}
              >
                {isVoice
                  ? <span className="text-[10px] font-mono uppercase shrink-0 text-(--text-3)">voz</span>
                  : <Hash className="size-3 shrink-0" />}
                <span className="truncate">{c.name}</span>
              </button>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: `Excluir #${c.name}?`,
                    description: 'Todas as mensagens deste canal serão perdidas. Ação permanente.',
                    confirmLabel: 'Excluir canal',
                    destructive: true,
                  })
                  if (ok) {
                    deleteChannel.mutate(c.id, {
                      onSuccess: () => toast.success(`#${c.name} excluído`),
                    })
                  }
                }}
                className="size-8 grid place-items-center text-(--text-3) hover:text-(--danger) opacity-0 group-hover:opacity-100 transition-opacity"
                title="Excluir canal"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="space-y-4">
        {!selectedId ? (
          <p className="text-sm text-(--text-3)">Selecione um canal pra editar.</p>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-(--text-3)"><Spinner size={12} /> Carregando…</div>
        ) : (
          <>
            <header>
              <h3 className="text-base m-0 mb-1 font-(family-name:--font-display)">Visibilidade</h3>
              <p className="text-xs text-(--text-3) m-0">
                Canal privado fica oculto pra todos exceto cargos selecionados (e o dono).
              </p>
            </header>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => mut.mutate({ isPrivate: false, roleIds: [] })}
                className={`flex items-center gap-2 px-3 h-9 border text-sm transition-colors ${
                  !isPrivate ? 'border-(--accent) bg-(--accent-dim) text-(--accent)' : 'border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent)'
                }`}
              >
                <Eye className="size-3.5" /> Público
              </button>
              <button
                onClick={() => mut.mutate({ isPrivate: true, roleIds: allowedRoleIds })}
                className={`flex items-center gap-2 px-3 h-9 border text-sm transition-colors ${
                  isPrivate ? 'border-(--accent) bg-(--accent-dim) text-(--accent)' : 'border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent)'
                }`}
              >
                <EyeOff className="size-3.5" /> Privado
              </button>
            </div>

            {isPrivate && (
              <section className="space-y-2">
                <p className="text-xs text-(--text-3) m-0">Cargos que conseguem ver este canal:</p>
                {roles.length === 0 && (
                  <p className="text-xs text-(--text-3) italic">Nenhum cargo criado. Vá na aba Cargos.</p>
                )}
                <div className="flex gap-2 flex-wrap">
                  {roles.map((r) => {
                    const on = allowedRoleIds.includes(r.id)
                    return (
                      <button
                        key={r.id}
                        onClick={() => toggleRole(r.id)}
                        className={`px-3 h-8 border text-xs transition-colors flex items-center gap-2 ${
                          on ? 'border-(--accent) bg-(--accent)/10 text-foreground' : 'border-(--border) text-(--text-2) hover:border-(--accent)'
                        }`}
                      >
                        {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
                        {r.name}
                        {on && <Check className="size-3" />}
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      </div>

      {/* Dialog criar canal */}
      <Dialog open={createOpen} onOpenChange={(o: boolean) => { if (!o) { setCreateOpen(false); setNewName(''); setCreateErr('') } }}>
        <DialogContent className="max-w-95!">
          <DialogHeader>
            <DialogTitle>Novo canal</DialogTitle>
            <DialogDescription>Escolha nome e tipo. Texto pra chat, voz pra chamadas.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newChanName">Nome</Label>
              <Input
                id="newChanName"
                autoFocus
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setCreateErr('') }}
                onKeyDown={(e) => e.key === 'Enter' && newName.trim() && createChannel.mutate({ name: newName.trim(), type: newType })}
                placeholder="Ex: geral"
                maxLength={50}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tipo</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewType('TEXT')}
                  className={`p-3 border text-left transition-colors cursor-pointer ${
                    newType === 'TEXT'
                      ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                      : 'border-(--border) hover:border-(--accent)'
                  }`}
                >
                  <p className="m-0 text-sm font-medium" style={{ fontFamily: 'var(--font-display)' }}># Texto</p>
                  <p className="m-0 mt-0.5 text-[11px] text-(--text-3)">Mensagens, anexos, threads</p>
                </button>
                <button
                  type="button"
                  onClick={() => setNewType('VOICE')}
                  className={`p-3 border text-left transition-colors cursor-pointer ${
                    newType === 'VOICE'
                      ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                      : 'border-(--border) hover:border-(--accent)'
                  }`}
                >
                  <p className="m-0 text-sm font-medium" style={{ fontFamily: 'var(--font-display)' }}>Voz</p>
                  <p className="m-0 mt-0.5 text-[11px] text-(--text-3)">Chamada de voz e tela</p>
                </button>
              </div>
            </div>
            {createErr && <p className="text-xs text-(--danger)">{createErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setCreateOpen(false); setNewName(''); setCreateErr('') }}>Cancelar</Button>
            <Button
              onClick={() => newName.trim() && createChannel.mutate({ name: newName.trim(), type: newType })}
              disabled={createChannel.isPending || !newName.trim()}
            >
              {createChannel.isPending ? 'Criando…' : 'Criar canal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// InviteFriendsDialog — picker editorial com search + lista de amigos.
//
// Filtra amigos que JÁ são membros (não dá pra convidar quem já está).
// Mutation otimista: ao clicar adiciona, mostra "✓ Convidado" no item,
// invalida ['members', serverId] pra refletir.
// ──────────────────────────────────────────────────────────────
interface Friend {
  friendshipId: string
  user: { id: string; username: string; displayName: string; avatarUrl: string|null }
  presence: { status: string }
}

function InviteFriendsDialog({
  open, onClose, serverId, serverName, currentMemberUserIds,
}: {
  open: boolean
  onClose: () => void
  serverId: string
  serverName: string
  currentMemberUserIds: Set<string>
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [invitedNow, setInvitedNow] = useState<Set<string>>(new Set())

  const { data: friends = [], isLoading } = useQuery<Friend[]>({
    queryKey: ['friends'],
    queryFn:  async () => (await api.get('/api/friends')).data.data,
    enabled:  open,
    staleTime: 30_000,
  })

  const addFriend = useMutation({
    mutationFn: async (friendUserId: string) =>
      (await api.post(`/api/servers/${serverId}/add-friend`, { friendUserId })).data.data,
    onSuccess: (_data, friendUserId) => {
      setInvitedNow((prev) => new Set(prev).add(friendUserId))
      queryClient.invalidateQueries({ queryKey: ['members', serverId] })
      toast.success('Amigo adicionado ao servidor')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao adicionar amigo'),
  })

  const eligible = friends.filter((f) => {
    if (currentMemberUserIds.has(f.user.id)) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return f.user.displayName.toLowerCase().includes(q) || f.user.username.toLowerCase().includes(q)
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-95! sm:max-w-md! p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3">
          <div className="size-10 bg-(--accent-dim) border border-(--accent)/40 rounded-xl flex items-center justify-center mb-2">
            <UserPlus className="size-5 text-(--accent)" />
          </div>
          <DialogTitle>Convidar amigo</DialogTitle>
          <DialogDescription className="text-(--text-3)">
            Adicione um amigo direto a <span className="text-foreground">{serverName}</span> — sem precisar de link.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-(--text-3) pointer-events-none" />
            <Input
              placeholder="Buscar por nome ou @username…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
        </div>

        <div className="border-t border-(--border) max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-(--text-3)">
              <Spinner size={14} /> Carregando amigos…
            </div>
          ) : eligible.length === 0 ? (
            <div className="py-10 px-6 text-center">
              <p className="text-sm text-(--text-2) m-0">
                {friends.length === 0
                  ? 'Você ainda não tem amigos na Astra.'
                  : currentMemberUserIds.size > 0 && friends.length === currentMemberUserIds.size
                    ? 'Todos os seus amigos já são membros.'
                    : 'Nenhum amigo encontrado pra esse filtro.'}
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {eligible.map((f, i) => {
                const isInvited = invitedNow.has(f.user.id)
                return (
                  <motion.div
                    key={f.user.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{    opacity: 0, x: -8 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.025, 0.2), ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-3 px-6 py-2.5 border-b border-(--border) last:border-b-0 hover:bg-(--raised)/40 transition-colors"
                  >
                    <Avatar className="size-8 shrink-0 border border-(--border-mid)">
                      {f.user.avatarUrl && <AvatarImage src={f.user.avatarUrl} referrerPolicy="no-referrer" />}
                      <AvatarFallback className="text-[10px] font-(family-name:--font-display)">
                        {f.user.displayName.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm m-0 truncate text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                        {f.user.displayName}
                      </p>
                      <p className="text-[10px] font-mono text-(--text-3) m-0 truncate">@{f.user.username}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={isInvited ? 'secondary' : 'default'}
                      disabled={isInvited || addFriend.isPending}
                      onClick={() => addFriend.mutate(f.user.id)}
                      className="gap-1.5 shrink-0"
                    >
                      {isInvited ? <><Check className="size-3.5" /> Convidado</> : <><Plus className="size-3.5" /> Adicionar</>}
                    </Button>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-(--border)">
          <Button variant="secondary" onClick={onClose} className="ml-auto">Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
