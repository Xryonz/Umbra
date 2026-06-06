import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { api, getStoredRefreshToken } from '@/lib/api'
import { LogOut, Shield, Smartphone, Monitor, Loader2, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from '@/components/ui/sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { SectionHeader, Row } from './_shared'

interface Session {
  id:         string
  createdAt:  string
  lastUsedAt: string | null
  expiresAt:  string
  userAgent:  string | null
  ip:         string | null
}

/**
 * Parser leve de User-Agent — não precisamos da biblioteca completa.
 * Identifica família OS + browser pra ícone + label legível.
 */
function parseUA(ua: string | null): { label: string; isMobile: boolean } {
  if (!ua) return { label: 'Dispositivo desconhecido', isMobile: false }
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua)
  let os = 'Outro'
  if (/Windows/i.test(ua))      os = 'Windows'
  else if (/Mac OS|Macintosh/i.test(ua)) os = 'macOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS'
  else if (/Linux/i.test(ua))   os = 'Linux'

  let browser = 'Navegador'
  if (/Edg\//i.test(ua))       browser = 'Edge'
  else if (/Chrome/i.test(ua) && !/OPR|Opera/i.test(ua)) browser = 'Chrome'
  else if (/Firefox/i.test(ua)) browser = 'Firefox'
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua))    browser = 'Safari'
  else if (/OPR|Opera/i.test(ua)) browser = 'Opera'

  return { label: `${browser} · ${os}`, isMobile }
}

export default function SessionsSection() {
  const { logout } = useAuth()
  const confirm    = useConfirm()
  const qc         = useQueryClient()
  const currentRefresh = getStoredRefreshToken()

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn:  async () => (await api.get('/api/sessions')).data.data.sessions as Session[],
    staleTime: 30_000,
  })

  const revokeOne = useMutation({
    mutationFn: (id: string) => api.delete(`/api/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      toast.success('Sessão revogada')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Falha ao revogar'),
  })

  const revokeOthers = useMutation({
    mutationFn: () => api.post('/api/sessions/revoke-others', { refreshToken: currentRefresh }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      toast.success(`${r.data.data.revokedCount} sessão(ões) encerradas`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Falha ao revogar'),
  })

  const others = sessions.length > 1
    ? sessions.filter((s) => {
        // Sem ID do current refresh do server, heurística: a mais recente
        // (maior lastUsedAt) provavelmente é a atual.
        const newest = [...sessions].sort((a, b) =>
          new Date(b.lastUsedAt ?? b.createdAt).getTime() -
          new Date(a.lastUsedAt ?? a.createdAt).getTime(),
        )[0]
        return s.id !== newest.id
      })
    : []

  return (
    <div>
      <SectionHeader
        title="Sessões"
        description="Dispositivos onde você está logada na Astra. Revogue qualquer um se suspeitar de acesso indevido."
      />

      <Row label="Sessões ativas" hint="Renovação automática a cada uso. Inativa por 30 dias → expira.">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-(--text-3)">
            <Loader2 className="size-3.5 animate-spin" /> Carregando…
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-(--text-3) italic m-0">Nenhuma sessão encontrada.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s, i) => {
              const parsed = parseUA(s.userAgent)
              const lastUsed = s.lastUsedAt ?? s.createdAt
              const isCurrent = i === 0  // assumindo ordenado por lastUsedAt desc
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-(--border) bg-(--raised)/30"
                >
                  <div className="size-10 rounded-lg bg-(--raised) border border-(--border) grid place-items-center shrink-0">
                    {parsed.isMobile
                      ? <Smartphone className="size-4 text-(--text-2)" />
                      : <Monitor    className="size-4 text-(--text-2)" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm m-0 font-medium text-foreground flex items-center gap-2">
                      {parsed.label}
                      {isCurrent && (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-(--accent) px-1.5 py-0.5 rounded bg-(--accent-dim) border border-(--accent)/30">
                          Atual
                        </span>
                      )}
                    </p>
                    <p className="text-marg text-(--text-3) m-0 mt-0.5 leading-relaxed">
                      {s.ip ?? 'IP desconhecido'} · ativa {formatDistanceToNow(new Date(lastUsed), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                  {!isCurrent && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Revogar sessão?',
                          description: `${parsed.label} será desconectado imediatamente.`,
                          confirmLabel: 'Revogar',
                          destructive: true,
                        })
                        if (ok) revokeOne.mutate(s.id)
                      }}
                      className="text-(--danger) hover:text-(--danger)"
                    >
                      <X className="size-3.5" /> Revogar
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Row>

      {others.length > 0 && (
        <Row
          label="Encerrar outros dispositivos"
          hint="Revoga todas as sessões exceto a atual. Use se mudou de senha ou suspeita de acesso indevido."
        >
          <Button
            variant="outline"
            onClick={async () => {
              const ok = await confirm({
                title: 'Encerrar todas as outras sessões?',
                description: `${others.length} dispositivo(s) serão desconectados.`,
                confirmLabel: 'Encerrar todas',
                destructive: true,
              })
              if (ok) revokeOthers.mutate()
            }}
            disabled={revokeOthers.isPending}
            className="gap-2 self-start text-(--danger)"
          >
            <Shield className="size-3.5" /> Encerrar {others.length} outra{others.length > 1 ? 's' : ''}
          </Button>
        </Row>
      )}

      <Row label="Sair desta sessão" hint="Só este token. As outras continuam.">
        <Button variant="outline" onClick={() => logout()} className="gap-2 self-start">
          <LogOut className="size-3.5" /> Sair
        </Button>
      </Row>
    </div>
  )
}
