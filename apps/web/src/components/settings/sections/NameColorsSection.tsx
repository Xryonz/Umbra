import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ServerWithChannels } from '@astra/types'
import { SectionHeader } from './_shared'

const NAME_COLOR_PRESETS = [
  '#c9a96e','#9b7ac4','#6aaeca','#ca7a9b','#6ec99b',
  '#e07a7a','#7ac4c4','#c4c47a','#c47aaa','#7ac4a0',
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Cor do seu nome em cada servidor. Cargo do servidor sobrescreve (ver Cargos).
 * Esta cor é só o "fallback pessoal" quando você não tem cargo colorido.
 */
export default function NameColorsSection() {
  const queryClient = useQueryClient()
  const [serverColors,  setServerColors]  = useState<Record<string, string>>({})
  const [colorServerId, setColorServerId] = useState<string | null>(null)
  const [customHex,     setCustomHex]     = useState('')
  const [colorError,    setColorError]    = useState('')

  const { data: servers = [] } = useQuery<ServerWithChannels[]>({
    queryKey: ['servers'],
    queryFn:  async () => (await api.get('/api/servers')).data.data,
  })

  const updateColor = useMutation({
    mutationFn: async ({ serverId, nameColor }: { serverId: string; nameColor: string | null }) =>
      api.patch(`/api/servers/${serverId}/my-color`, { nameColor }),
    onSuccess: (_, { serverId, nameColor }) => {
      setServerColors((p) => ({ ...p, [serverId]: nameColor ?? '' }))
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (e: any) => setColorError(e.response?.data?.error ?? 'Erro'),
  })

  return (
    <div>
      <SectionHeader
        title="Cores nos servidores"
        description="Personalize a cor do seu nome em cada servidor. Cargos do servidor sobrescrevem esta escolha."
      />

      {servers.length === 0 && (
        <p className="text-sm text-(--text-3) italic">Você não é membro de nenhum servidor.</p>
      )}

      <div className="flex flex-col gap-2">
        {servers.map((server) => {
          const isSelected   = colorServerId === server.id
          const currentColor = serverColors[server.id] ?? ''
          return (
            <div
              key={server.id}
              className={cn(
                'border transition-colors',
                isSelected ? 'border-(--accent)' : 'border-(--border)',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setColorServerId(isSelected ? null : server.id)
                  setCustomHex(''); setColorError('')
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-transparent cursor-pointer text-left"
              >
                <div className="size-8 bg-(--raised)/60 flex items-center justify-center text-xs font-bold text-(--text-3) shrink-0">
                  {server.isGroup ? '👥' : server.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground text-sm font-medium m-0 truncate">{server.name}</p>
                  <p className="text-(--text-3) text-marg m-0">{server.isGroup ? 'Grupo' : 'Servidor'}</p>
                </div>
                {currentColor && (
                  <div className="size-4 rounded-full border-2 border-(--border-mid)" style={{ background: currentColor }} />
                )}
                {isSelected ? <ChevronUp className="size-4 text-(--text-3)" /> : <ChevronDown className="size-4 text-(--text-3)" />}
              </button>

              {isSelected && (
                <div className="px-3 pb-3 pt-2 border-t border-(--border)">
                  <p className="text-[10px] uppercase tracking-wider text-(--text-3) mb-2 font-medium">Predefinidas</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {NAME_COLOR_PRESETS.map((c) => {
                      const isActive = serverColors[server.id] === c && !customHex
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => { setServerColors((p) => ({ ...p, [server.id]: c })); setCustomHex('') }}
                          className={cn(
                            'size-7 cursor-pointer transition-all border-2',
                            isActive ? 'border-foreground scale-110' : 'border-transparent hover:scale-105',
                          )}
                          style={{ background: c }}
                        />
                      )
                    })}
                  </div>
                  <div className="flex gap-2 items-center mb-2">
                    <div
                      className="size-7 shrink-0 border border-(--border)"
                      style={{ background: customHex || serverColors[server.id] || 'var(--border-mid)' }}
                    />
                    <Input
                      value={customHex}
                      onChange={(e) => { setCustomHex(e.target.value); setColorError('') }}
                      placeholder="#c9a96e"
                      maxLength={7}
                      className="flex-1"
                    />
                  </div>
                  {colorError && <p className="text-xs text-(--danger) mb-2 m-0">{colorError}</p>}
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" className="flex-1"
                      onClick={() => updateColor.mutate({ serverId: server.id, nameColor: null })}>
                      Resetar
                    </Button>
                    <Button size="sm" className="flex-1"
                      disabled={updateColor.isPending}
                      onClick={() => {
                        const c = customHex || serverColors[server.id]
                        if (c && !HEX_RE.test(c)) { setColorError('Formato inválido (use #RRGGBB)'); return }
                        updateColor.mutate({ serverId: server.id, nameColor: c || null })
                      }}>
                      {updateColor.isPending ? 'Salvando…' : 'Aplicar'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
