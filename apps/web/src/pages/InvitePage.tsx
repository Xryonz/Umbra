import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Users, Link2Off } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Reveal } from '@/components/anim/Reveal'
import { ConstellationBanner } from '@/components/astra/Constellation'
import { toast } from '@/components/ui/sonner'

interface ServerPreview {
  id: string
  name: string
  iconUrl: string | null
  bannerUrl: string | null
  isGroup: boolean
  inviteCode: string
  _count: { members: number }
}

export default function InvitePage() {
  const { code }     = useParams<{ code: string }>()
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const isAuth       = useAuthStore((s) => s.isAuthenticated)

  const [server,  setServer]   = useState<ServerPreview | null>(null)
  const [loading, setLoading]  = useState(true)
  const [joining, setJoining]  = useState(false)
  const [error,   setError]    = useState('')
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!code) return
    api.get(`/api/invites/${code}`)
      .then((r) => setServer(r.data.data))
      .catch((e) => {
        if (e.response?.status === 404) setNotFound(true)
        else setError('Erro ao carregar convite')
      })
      .finally(() => setLoading(false))
  }, [code])

  const handleJoin = async () => {
    if (!isAuth) { navigate(`/login?redirect=/invite/${code}`); return }
    setJoining(true)
    setError('')
    try {
      await api.post(`/api/invites/${code}/join`)
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Bem-vindo a ${server?.name}!`)
      navigate('/app')
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Erro ao entrar no servidor')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 font-(family-name:--font-body) relative overflow-hidden">
      <div className="ed-grain" aria-hidden />

      {/* Ambient glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-dim) 0%, transparent 65%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Vertical label */}
        <div className="absolute -left-12 top-4 hidden sm:block">
          <Reveal delay={0.1}>
            <span className="ed-marg-vertical">Cap. III · Convite</span>
          </Reveal>
        </div>

        <div className="border border-(--border-mid) bg-(--overlay) shadow-2xl overflow-hidden text-center">
          {/* Banner do servidor — custom ou constelação-assinatura do nome */}
          {server && !loading && (
            <Reveal delay={0.02}>
              {server.bannerUrl
                ? <img src={server.bannerUrl} alt="" referrerPolicy="no-referrer" className="w-full h-28 object-cover" />
                : <ConstellationBanner name={server.name} stars={server._count.members} className="w-full h-28" />}
            </Reveal>
          )}

          <div className="px-8 py-10">
          {loading && (
            <div className="flex justify-center py-8">
              <Spinner size={28} />
            </div>
          )}

          {notFound && !loading && (
            <Reveal delay={0.05}>
              <div className="flex flex-col items-center gap-3">
                <Link2Off className="size-12 text-(--text-3) mb-2" />
                <span className="ed-marg">— Convite inválido</span>
                <h2 className="ed-h text-2xl m-0">Link expirado</h2>
                <p className="text-sm text-(--text-2) max-w-[28ch] m-0 mb-4">
                  Este link de convite não existe ou foi revogado.
                </p>
                <Button onClick={() => navigate('/app')} className="w-full">Voltar ao início</Button>
              </div>
            </Reveal>
          )}

          {server && !loading && (
            <>
              <Reveal delay={0.05}>
                <Avatar className="size-20 mx-auto mb-5 border border-(--border-mid) rounded-none">
                  {server.iconUrl && <AvatarImage src={server.iconUrl} alt={server.name} className="rounded-none" />}
                  <AvatarFallback className="rounded-none bg-(--raised) text-xl font-(family-name:--font-display) text-(--text-2)">
                    {server.isGroup ? <Users className="size-7" /> : server.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Reveal>

              <Reveal delay={0.12}>
                <Badge variant={server.isGroup ? 'secondary' : 'default'} className="mx-auto">
                  {server.isGroup ? 'Grupo privado' : 'Servidor'}
                </Badge>
              </Reveal>

              <Reveal delay={0.20}>
                <h2 className="ed-h text-3xl m-0 mt-3">{server.name}</h2>
              </Reveal>

              <Reveal delay={0.28}>
                <p className="text-sm text-(--text-3) m-0 mt-1 mb-5 font-mono uppercase tracking-wider">
                  {server._count.members} membro{server._count.members !== 1 ? 's' : ''}
                </p>
              </Reveal>

              <Reveal delay={0.35}>
                <Separator className="my-4" />
              </Reveal>

              {server.isGroup ? (
                <Reveal delay={0.42}>
                  <div className="u-error mb-3">
                    Este grupo é privado. Apenas o administrador pode adicionar membros.
                  </div>
                </Reveal>
              ) : (
                <>
                  {error && (
                    <Reveal delay={0.42}>
                      <div className="u-error mb-3">{error}</div>
                    </Reveal>
                  )}
                  <Reveal delay={0.45}>
                    <Button onClick={handleJoin} disabled={joining} className="w-full">
                      {joining ? 'Entrando…' : isAuth ? `Entrar em ${server.name}` : 'Entrar / Login'}
                    </Button>
                  </Reveal>
                </>
              )}

              <Reveal delay={0.55}>
                <button
                  onClick={() => navigate('/app')}
                  className="block w-full mt-3 bg-transparent border-none cursor-pointer text-(--text-3) text-sm font-(family-name:--font-body) py-2 hover:text-(--accent) transition-colors"
                >
                  Talvez mais tarde
                </button>
              </Reveal>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
