/**
 * Cria server ou grupo. Modal com pop-from-origin animation
 * (popOrigin = posição do botão clicado).
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Users } from 'lucide-react'
import { api } from '@/lib/api'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  open:       boolean
  onClose:    () => void
  mode:       'server' | 'group'
  popOrigin:  { x: number; y: number } | null
  onCreated:  (server: { id: string }) => void
}

export function CreateServerDialog({ open, onClose, mode, popOrigin, onCreated }: Props) {
  const [name, setName]   = useState('')
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  // Reset ao fechar (UX: abrir de novo começa limpo)
  useEffect(() => { if (!open) { setName(''); setError('') } }, [open])

  const createServer = useMutation({
    mutationFn: async ({ n, isGroup }: { n: string; isGroup: boolean }) =>
      (await api.post('/api/servers', { name: n, isGroup })).data.data,
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      onCreated(s)
      onClose()
    },
    onError: (e: any) => setError(e.response?.data?.error ?? 'Erro ao criar'),
  })

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    createServer.mutate({ n: trimmed, isGroup: mode === 'group' })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-95! data-[state=open]:animate-none! anim-pop-open"
        style={popOrigin ? {
          ['--pop-tx' as any]: `${popOrigin.x - window.innerWidth  / 2}px`,
          ['--pop-ty' as any]: `${popOrigin.y - window.innerHeight / 2}px`,
        } : undefined}
      >
        <DialogHeader className="gap-1.5">
          <div className="size-10 bg-(--accent-dim) border border-(--accent)/40 rounded-xl flex items-center justify-center mb-2">
            {mode === 'group' ? <Users className="size-5 text-(--accent)" /> : <Plus className="size-5 text-(--accent)" />}
          </div>
          <DialogTitle>
            {mode === 'group' ? 'Crie um aglomerado' : 'Crie uma constelação'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'group'
              ? 'Aglomerados são privados — adicione estrelas manualmente.'
              : 'Constelações podem ser acessadas por link de convite.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="serverName">Nome</Label>
          <Input
            id="serverName"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={mode === 'group' ? 'Ex: Amigos da faculdade' : 'Ex: Órion'}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={createServer.isPending || !name.trim()}>
            {createServer.isPending
              ? (mode === 'group' ? 'Formando…' : 'Acendendo…')
              : (mode === 'group' ? 'Criar aglomerado' : 'Criar constelação')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
