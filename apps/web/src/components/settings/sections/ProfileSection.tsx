/**
 * ProfileSection — Identidade do perfil (Discord-style split).
 *
 * Só campos de IDENTIDADE: avatar, displayName, username, pronouns,
 * status (emoji + texto), bio (com markdown).
 *
 * Personalização visual (banner, tema, fonte, cor) mora em
 * CustomizationSection.tsx — outra entrada do nav.
 *
 * Auto-save 800ms debounced.
 */
import { useRef, useState, useMemo, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { UpdateProfileSchema } from '@astra/types'
import { SectionHeader, Row, SaveStatus } from './_shared'

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export default function ProfileSection() {
  const user        = useAuthStore((s) => s.user)
  const updateUser  = useAuthStore((s) => s.updateUser)
  const queryClient = useQueryClient()

  const [displayName,  setDisplayName]  = useState(user?.displayName ?? '')
  const [username,     setUsername]     = useState(user?.username ?? '')
  const [bio,          setBio]          = useState(user?.bio ?? '')
  const [avatarUrl,    setAvatarUrl]    = useState(user?.avatarUrl ?? '')
  const [pronouns,     setPronouns]     = useState<string>((user as any)?.pronouns ?? '')
  const [statusEmoji,  setStatusEmoji]  = useState<string>((user as any)?.statusEmoji ?? '')

  const [fileError,    setFileError]    = useState('')
  const [avatarImgErr, setAvatarImgErr] = useState(false)
  const [saveStatus,   setSaveStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError,    setSaveError]    = useState('')

  const avatarFileRef = useRef<HTMLInputElement>(null)

  const readImageAsDataUri = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ALLOWED_MIMES.includes(file.type)) {
      setFileError('Formato não suportado. Use JPEG, PNG, WebP ou GIF.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError('Arquivo muito grande. Máximo 5MB.')
      return
    }
    setFileError('')
    const reader = new FileReader()
    reader.onload = (ev) => { setAvatarUrl(ev.target?.result as string); setAvatarImgErr(false) }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const errors = useMemo(() => {
    const candidate = {
      displayName: displayName || undefined,
      username:    username    || undefined,
      bio:         bio !== '' ? bio : null,
      avatarUrl:   avatarUrl || null,
      pronouns:    pronouns || null,
      statusEmoji: statusEmoji || null,
    }
    const result = UpdateProfileSchema.safeParse(candidate)
    if (result.success) return {} as Record<string, string>
    const map: Record<string, string> = {}
    for (const issue of result.error.issues) map[issue.path.join('.')] = issue.message
    return map
  }, [displayName, username, bio, avatarUrl, pronouns, statusEmoji])

  const updateProfile = useMutation({
    mutationFn: async () => {
      const initial = {
        displayName: user?.displayName ?? '',
        username:    user?.username    ?? '',
        bio:         user?.bio         ?? '',
        avatarUrl:   user?.avatarUrl   ?? '',
        pronouns:    (user as any)?.pronouns ?? '',
        statusEmoji: (user as any)?.statusEmoji ?? '',
      }
      const payload: Record<string, unknown> = {}
      if (displayName !== initial.displayName) payload.displayName = displayName || undefined
      if (username    !== initial.username)    payload.username    = username    || undefined
      if (bio         !== initial.bio)         payload.bio         = bio !== '' ? bio : null
      if (avatarUrl   !== initial.avatarUrl)   payload.avatarUrl   = avatarUrl   || null
      if (pronouns    !== initial.pronouns)    payload.pronouns    = pronouns    || null
      if (statusEmoji !== initial.statusEmoji) payload.statusEmoji = statusEmoji || null
      if (Object.keys(payload).length === 0) return null

      const res = await api.patch('/api/profile', payload)
      return res.data.data.user
    },
    onSuccess: (u) => {
      if (!u) { setSaveStatus('idle'); return }
      updateUser(u)
      queryClient.invalidateQueries({ queryKey: ['profile', u.id] })
      queryClient.setQueryData(['profile', u.id], u)
      setSaveStatus('saved')
      setSaveError('')
      setTimeout(() => setSaveStatus('idle'), 2200)
    },
    onError: (e: any) => {
      setSaveError(e.response?.data?.error ?? e.message ?? 'Erro ao salvar')
      setSaveStatus('error')
    },
  })

  useEffect(() => {
    if (Object.keys(errors).length > 0) return
    const t = setTimeout(() => {
      setSaveStatus('saving')
      updateProfile.mutate()
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName, username, bio, avatarUrl, pronouns, statusEmoji])

  return (
    <div>
      <SectionHeader
        title="Perfil"
        description="Identidade que aparece pros outros membros. Aparência visual é em Personalização."
      />

      <Row label="Avatar" hint="Recomendado 256×256 ou maior. Quadrado.">
        <div className="flex items-center gap-5 flex-wrap">
          <Avatar className="size-24 rounded-full border-2 border-(--border-mid)">
            {avatarUrl && !avatarImgErr && <AvatarImage src={avatarUrl} onError={() => setAvatarImgErr(true)} />}
            <AvatarFallback className="text-2xl font-(family-name:--font-display)">
              {(displayName || username || '?').slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" onClick={() => avatarFileRef.current?.click()} className="gap-2">
              <Upload className="size-4" /> Enviar foto
            </Button>
            {avatarUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAvatarUrl('')}>
                Remover
              </Button>
            )}
          </div>
          <input
            ref={avatarFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={readImageAsDataUri}
          />
        </div>
        {fileError && <p className="text-xs text-(--danger) mt-2 m-0">{fileError}</p>}
        {errors.avatarUrl && <p className="text-xs text-(--danger) mt-2 m-0">{errors.avatarUrl}</p>}
      </Row>

      <Row label="Nome de exibição">
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} placeholder="Como quer ser chamado" />
        {errors.displayName && <p className="text-xs text-(--danger) mt-1 m-0">{errors.displayName}</p>}
      </Row>

      <Row label="Username" hint="Único. @mention usa isso.">
        <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={30} placeholder="seu_username" />
        {errors.username && <p className="text-xs text-(--danger) mt-1 m-0">{errors.username}</p>}
      </Row>

      <Row label="Pronomes" hint="Ex: ela/dela, ele/dele, elu/delu, they/them. Aparece como chip no card.">
        <Input
          value={pronouns}
          onChange={(e) => setPronouns(e.target.value.slice(0, 32))}
          maxLength={32}
          placeholder="ela/dela"
        />
        {errors.pronouns && <p className="text-xs text-(--danger) mt-1 m-0">{errors.pronouns}</p>}
      </Row>

      <Row label="Status atual" hint="Emoji + frase curta que aparece pros amigos. Some quando você troca ou apaga.">
        <div className="flex items-stretch gap-2">
          <Input
            value={statusEmoji}
            onChange={(e) => setStatusEmoji(e.target.value.slice(0, 8))}
            maxLength={8}
            placeholder="🎮"
            className="w-16 text-center text-lg shrink-0"
            aria-label="Emoji do status"
          />
          <div className="flex-1">
            <CustomStatusEditor />
          </div>
        </div>
        {errors.statusEmoji && <p className="text-xs text-(--danger) mt-1 m-0">{errors.statusEmoji}</p>}
      </Row>

      <Row label="Bio" hint="Até 300 caracteres. Markdown: **negrito** · *itálico* · `código` · [texto](url) · quebra de linha.">
        <Textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={300}
          rows={4}
          placeholder="Algo sobre você… use **negrito**, *itálico*, ou [link](https://...)"
        />
        <p className="text-marg text-(--text-3) mt-1 m-0 text-right">{bio.length}/300</p>
        {errors.bio && <p className="text-xs text-(--danger) m-0">{errors.bio}</p>}
      </Row>

      <div className="pt-4">
        <SaveStatus status={saveStatus} error={saveError} />
      </div>
    </div>
  )
}

// ─── CustomStatusEditor (server-synced) ─────────────────────
function CustomStatusEditor() {
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const [text, setText]    = useState((user as any)?.customStatus ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce 600ms — autoSave em onChange
  useEffect(() => {
    if (text === ((user as any)?.customStatus ?? '')) return
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    timerRef.current = setTimeout(async () => {
      try {
        await api.patch('/api/friends/custom-status', { customStatus: text.trim() || null })
        updateUser({ ...(user ?? {}), customStatus: text.trim() || null } as any)
        setStatus('saved')
        setTimeout(() => setStatus('idle'), 1200)
      } catch {
        setStatus('error')
      }
    }, 600)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [text])

  return (
    <div>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 100))}
        maxLength={100}
        placeholder="Ex: Lendo um livro · Compilando · BRB"
      />
      <p className="text-marg text-(--text-3) mt-1 m-0 text-right">{text.length}/100</p>
      <SaveStatus status={status} />
    </div>
  )
}
