/**
 * OnboardingPage — primeira tela após criar a conta. Personaliza o perfil
 * (avatar, nome, pronomes) antes de entrar no app. Marca onboardedAt ao
 * concluir/pular, então só aparece uma vez. Acesso: redirect de /app quando
 * onboardedAt é null (ver RequireOnboarded em App.tsx).
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Upload, Sparkles, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Constellation } from '@/components/astra/Constellation'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export default function OnboardingPage() {
  const user       = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const navigate   = useNavigate()

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl,   setAvatarUrl]   = useState(user?.avatarUrl ?? '')
  const [pronouns,    setPronouns]    = useState('')
  const [fileError,   setFileError]   = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const readImg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ALLOWED.includes(file.type)) { setFileError('Use JPEG, PNG, WebP ou GIF.'); return }
    if (file.size > 5 * 1024 * 1024) { setFileError('Máximo 5MB.'); return }
    setFileError('')
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarUrl(ev.target?.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const markDone = async () => {
    const { onboardedAt } = (await api.post('/api/auth/onboarded')).data.data
    updateUser({ onboardedAt })
  }

  const finish = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {}
      if (displayName && displayName !== user?.displayName) payload.displayName = displayName
      if (avatarUrl && avatarUrl !== user?.avatarUrl)       payload.avatarUrl   = avatarUrl
      if (pronouns)                                          payload.pronouns    = pronouns
      if (Object.keys(payload).length) {
        const u = (await api.patch('/api/profile', payload)).data.data.user
        updateUser(u)
      }
      await markDone()
    },
    onSuccess: () => navigate('/app', { replace: true }),
  })

  const skip = useMutation({
    mutationFn: markDone,
    onSuccess: () => navigate('/app', { replace: true }),
  })

  const busy = finish.isPending || skip.isPending

  return (
    <div className="min-h-screen-safe relative flex items-center justify-center px-5 py-10 bg-(--void) overflow-hidden">
      <Constellation
        name={user?.username ?? 'astra'}
        className="absolute inset-0 w-full h-full text-white/5 pointer-events-none"
      />
      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-2 mb-1 text-(--accent)">
          <Sparkles className="size-5" />
          <span className="text-xs uppercase tracking-[0.2em] font-mono">Bem-vindo à Astra</span>
        </div>
        <h1 className="ed-h text-3xl m-0 mb-2">Acenda sua estrela</h1>
        <p className="text-sm text-(--text-2) m-0 mb-8">
          Um toque rápido no seu perfil antes de entrar. Dá pra mudar tudo depois nas configurações.
        </p>

        <div className="flex items-center gap-5 mb-2">
          <Avatar className="size-20 rounded-full border-2 border-(--border-mid)">
            {avatarUrl && <AvatarImage src={avatarUrl} />}
            <AvatarFallback className="text-2xl font-(family-name:--font-display)">
              {(displayName || user?.username || '?').slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
              <Upload className="size-4" /> Enviar foto
            </Button>
            {avatarUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAvatarUrl('')}>Remover</Button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={readImg} />
        </div>
        {fileError && <p className="text-xs text-(--danger) mb-4 m-0">{fileError}</p>}

        <label className="block mb-4 mt-4">
          <span className="text-xs uppercase tracking-wider text-(--text-3) font-medium">Nome de exibição</span>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} placeholder="Como quer ser chamado" className="mt-1.5" />
        </label>

        <label className="block mb-8">
          <span className="text-xs uppercase tracking-wider text-(--text-3) font-medium">
            Pronomes <span className="text-(--text-3) normal-case">(opcional)</span>
          </span>
          <Input value={pronouns} onChange={(e) => setPronouns(e.target.value.slice(0, 32))} maxLength={32} placeholder="ela/dela · ele/dele · they/them" className="mt-1.5" />
        </label>

        <div className="flex items-center gap-3">
          <Button onClick={() => finish.mutate()} disabled={busy} className="gap-2 flex-1">
            {finish.isPending ? 'Entrando…' : <>Entrar na Astra <ArrowRight className="size-4" /></>}
          </Button>
          <Button variant="ghost" onClick={() => skip.mutate()} disabled={busy}>
            Pular
          </Button>
        </div>
      </div>
    </div>
  )
}
