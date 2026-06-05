/**
 * Cria canal (TEXT ou VOICE) dentro de um server.
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface Props {
  open:     boolean
  onClose:  () => void
  serverId: string | null
}

export function CreateChannelDialog({ open, onClose, serverId }: Props) {
  const [name, setName]   = useState('')
  const [type, setType]   = useState<'TEXT' | 'VOICE'>('TEXT')
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  useEffect(() => { if (!open) { setName(''); setType('TEXT'); setError('') } }, [open])

  // Backend exige /^[a-z0-9-]+$/. Convertemos input do user pro slug válido
  // em tempo real (lowercase, acentos removidos, espaços → hífen, demais → '').
  const toSlug = (s: string) =>
    s
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

  const createChannel = useMutation({
    mutationFn: async ({ n, t }: { n: string; t: 'TEXT' | 'VOICE' }) =>
      (await api.post(`/api/servers/${serverId}/channels`, { name: n, type: t })).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      onClose()
    },
    onError: (e: any) => setError(e?.response?.data?.error ?? 'Erro ao criar'),
  })

  const submit = () => {
    const slug = toSlug(name)
    if (!slug) { setError('Nome precisa de ao menos 1 letra ou número'); return }
    createChannel.mutate({ n: slug, t: type })
  }

  return (
    <Dialog open={open && !!serverId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-95!">
        <DialogHeader>
          <DialogTitle>Novo canal</DialogTitle>
          <DialogDescription>Escolha nome e tipo. Texto pra chat, voz pra chamadas.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sbNewChanName">Nome</Label>
            <Input
              id="sbNewChanName"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Ex: geral"
              maxLength={50}
            />
            {name && toSlug(name) !== name.trim().toLowerCase() && (
              <p className="text-marg text-(--text-3) m-0">
                Salvo como <code className="px-1 bg-(--raised) border border-(--border)">{toSlug(name) || '—'}</code>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              <ChannelTypeButton
                label="# Texto"
                description="Chat, anexos, threads"
                active={type === 'TEXT'}
                onClick={() => setType('TEXT')}
              />
              <ChannelTypeButton
                label="Voz"
                description="Chamada e tela"
                active={type === 'VOICE'}
                onClick={() => setType('VOICE')}
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={createChannel.isPending || !name.trim()}>
            {createChannel.isPending ? 'Criando…' : 'Criar canal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChannelTypeButton({ label, description, active, onClick }: {
  label: string; description: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'p-3 border text-left transition-colors cursor-pointer',
        active
          ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
          : 'border-(--border) hover:border-(--accent)',
      )}
    >
      <p className="m-0 text-sm font-medium" style={{ fontFamily: 'var(--font-display)' }}>{label}</p>
      <p className="m-0 mt-0.5 text-[11px] text-(--text-3)">{description}</p>
    </button>
  )
}
