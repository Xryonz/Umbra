/**
 * CustomizationSection — Personalização do perfil (Discord-style split).
 *
 * Separado de ProfileSection: ProfileSection cuida da identidade
 * (nome, username, bio, avatar, pronomes, status); aqui é estético
 * (banner, tema, fonte, cores, borda).
 *
 * Auto-save 800ms só pros campos próprios.
 */
import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Check, Sparkles, Zap, Droplet, Minus, RotateCcw,
  MoreHorizontal, GlassWater, Sparkle, Snowflake,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { GradientBuilder } from '@/components/settings/GradientBuilder'
import { cn } from '@/lib/utils'
import {
  UpdateProfileSchema, type BannerBorderStyle, type DisplayFont,
} from '@umbra/types'
import { SectionHeader, Row, SaveStatus } from './_shared'

// ─── DATA ────────────────────────────────────────────────────
type GradientPreset = { id: string; label: string; value: string }

const BANNER_GRADIENTS: GradientPreset[] = [
  { id: 'sunrise',  label: 'Amanhecer',  value: 'linear-gradient(135deg,#ff6b9d,#ff9874,#ffd6a5)' },
  { id: 'coral',    label: 'Coral',      value: 'linear-gradient(135deg,#ff7e5f,#feb47b)' },
  { id: 'petal',    label: 'Pétala',     value: 'linear-gradient(135deg,#ffafbd,#ffc3a0)' },
  { id: 'sunset',   label: 'Pôr-do-sol', value: 'linear-gradient(135deg,#fc4a1a,#f7b733)' },
  { id: 'ember',    label: 'Brasa',      value: 'linear-gradient(135deg,#ff5722,#ff9800,#ffc107)' },
  { id: 'magma',    label: 'Magma',      value: 'linear-gradient(135deg,#f12711,#f5af19)' },
  { id: 'amber',    label: 'Âmbar',      value: 'linear-gradient(135deg,#d97706,#facc15)' },
  { id: 'saffron',  label: 'Açafrão',    value: 'linear-gradient(135deg,#ee9b00,#ca6702)' },
  { id: 'mint',     label: 'Menta',      value: 'linear-gradient(135deg,#11998e,#38ef7d)' },
  { id: 'willow',   label: 'Salgueiro',  value: 'linear-gradient(135deg,#7a9e7e,#c8d5b9)' },
  { id: 'moss',     label: 'Musgo',      value: 'linear-gradient(135deg,#5a7140,#a1aa6d)' },
  { id: 'forest',   label: 'Floresta',   value: 'linear-gradient(135deg,#134e5e,#71b280)' },
  { id: 'lagoon',   label: 'Lagoa',      value: 'linear-gradient(135deg,#43cea2,#185a9d)' },
  { id: 'ocean',    label: 'Oceano',     value: 'linear-gradient(135deg,#2193b0,#6dd5ed)' },
  { id: 'arctic',   label: 'Ártico',     value: 'linear-gradient(135deg,#a1c4fd,#c2e9fb)' },
  { id: 'mist',     label: 'Bruma',      value: 'linear-gradient(135deg,#bdc3c7,#2c3e50)' },
  { id: 'cyber',    label: 'Cyber',      value: 'linear-gradient(135deg,#6e57e0,#4fc3f7,#00d4ff)' },
  { id: 'twilight', label: 'Crepúsculo', value: 'linear-gradient(135deg,#3a1c71,#4a00e0)' },
  { id: 'plasma',   label: 'Plasma',     value: 'linear-gradient(135deg,#8e2de2,#4a00e0,#f12711)' },
  { id: 'aurora',   label: 'Aurora',     value: 'linear-gradient(135deg,#3a1c71,#d76d77,#ffaf7b)' },
  { id: 'lavender', label: 'Lavanda',    value: 'linear-gradient(135deg,#8e44ad,#c39bd3)' },
  { id: 'velvet',   label: 'Veludo',     value: 'linear-gradient(135deg,#41295a,#2f0743)' },
  { id: 'neon',     label: 'Néon',       value: 'linear-gradient(135deg,#ff00cc,#333399)' },
  { id: 'wine',     label: 'Vinho',      value: 'linear-gradient(135deg,#6e0d25,#bd5734)' },
  { id: 'burgundy', label: 'Borgonha',   value: 'linear-gradient(135deg,#600000,#9c1f1f)' },
  { id: 'galaxy',   label: 'Galáxia',    value: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' },
  { id: 'obsidian', label: 'Obsidiana',  value: 'linear-gradient(135deg,#000000,#1a4d2e)' },
  { id: 'ink',      label: 'Tinta',      value: 'linear-gradient(135deg,#000000,#0f3460)' },
  { id: 'charcoal', label: 'Carvão',     value: 'linear-gradient(135deg,#232526,#414345)' },
  { id: 'onyx',     label: 'Ônix',       value: 'linear-gradient(135deg,#0c0c0c,#3c3c3c)' },
]

const BANNER_BORDER_OPTIONS: { id: BannerBorderStyle; label: string; description: string; icon: React.ReactNode }[] = [
  { id: 'none',    label: 'Sem borda', description: 'Limpo, sem efeitos.',                icon: <Minus          className="size-3.5" /> },
  { id: 'aurora',  label: 'Aurora',    description: 'Anel rotativo policromo.',           icon: <Sparkles       className="size-3.5" /> },
  { id: 'pulse',   label: 'Pulso',     description: 'Borda pulsando accent.',             icon: <Zap            className="size-3.5" /> },
  { id: 'ink',     label: 'Tinta',     description: 'Vinheta que respira.',               icon: <Droplet        className="size-3.5" /> },
  { id: 'marquee', label: 'Marquee',   description: 'Tracejado deslizando, vibe ticker.', icon: <MoreHorizontal className="size-3.5" /> },
  { id: 'glow',    label: 'Glow',      description: 'Halo accent pulsante difuso.',       icon: <Sparkle        className="size-3.5" /> },
  { id: 'noise',   label: 'Ruído',     description: 'Grão analógico vibrando.',           icon: <Snowflake      className="size-3.5" /> },
  { id: 'shimmer', label: 'Brilho',    description: 'Faixa de luz atravessa lenta.',      icon: <GlassWater     className="size-3.5" /> },
]

const DISPLAY_FONT_OPTIONS: { id: DisplayFont; label: string; family: string; preview: string }[] = [
  { id: 'serif',       label: 'Serif Display',    family: 'var(--font-display)',                                              preview: 'Editorial clássico' },
  { id: 'sans',        label: 'Sans Limpa',       family: '-apple-system, ui-sans-serif, system-ui',                          preview: 'Limpo & moderno' },
  { id: 'mono',        label: 'Mono Técnica',     family: 'var(--font-mono)',                                                 preview: 'Identidade hacker' },
  { id: 'rounded',     label: 'Sans Arredondada', family: 'ui-rounded, "SF Pro Rounded", system-ui',                          preview: 'Amigável & soft' },
  { id: 'condensed',   label: 'Condensada',       family: '"Helvetica Neue Condensed", Impact, Arial Narrow, sans-serif',     preview: 'Apertada & forte' },
  { id: 'handwriting', label: 'Manuscrita',       family: '"Brush Script MT", cursive',                                       preview: 'Pessoal & solto' },
  { id: 'gothic',      label: 'Gótica',           family: 'UnifrakturCook, "Times New Roman", serif',                         preview: 'Antiga & ritual' },
  { id: 'modern',      label: 'Geométrica',       family: 'Futura, "Avenir Next", "Trebuchet MS", sans-serif',                preview: 'Geométrica & limpa' },
]

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// ─── COMPONENT ───────────────────────────────────────────────
export default function CustomizationSection() {
  const user        = useAuthStore((s) => s.user)
  const updateUser  = useAuthStore((s) => s.updateUser)
  const queryClient = useQueryClient()

  const [bannerUrl,   setBannerUrl]   = useState((user as any)?.bannerUrl ?? '')
  const [bannerColor, setBannerColor] = useState((user as any)?.bannerColor ?? BANNER_GRADIENTS[0].value)
  const [profileTheme, setProfileTheme] = useState((user as any)?.profileTheme ?? BANNER_GRADIENTS[0].value)
  const [bannerPositionY, setBannerPositionY] = useState<number>((user as any)?.bannerPositionY ?? 50)
  const [bannerScale,     setBannerScale]     = useState<number>((user as any)?.bannerScale     ?? 100)
  const [bannerBorder,    setBannerBorder]    = useState<BannerBorderStyle>(((user as any)?.bannerBorder ?? 'none') as BannerBorderStyle)
  const [bannerTextColor, setBannerTextColor] = useState<string>((user as any)?.bannerTextColor ?? '')
  const [displayFont,     setDisplayFont]     = useState<DisplayFont>(((user as any)?.displayFont ?? 'serif') as DisplayFont)

  const [fileError,    setFileError]    = useState('')
  const [bannerImgErr, setBannerImgErr] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError,  setSaveError]  = useState('')

  const [showBannerBuilder, setShowBannerBuilder] = useState(false)
  const [showThemeBuilder,  setShowThemeBuilder]  = useState(false)

  const bannerFileRef = useRef<HTMLInputElement>(null)

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
    reader.onload = (ev) => { setBannerUrl(ev.target?.result as string); setBannerImgErr(false) }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // Validação live via zod (subset desta seção)
  const errors = useMemo(() => {
    const candidate = {
      bannerUrl:       bannerUrl    || null,
      bannerColor:     bannerColor  || null,
      profileTheme:    profileTheme || null,
      bannerPositionY, bannerScale, bannerBorder,
      bannerTextColor: bannerTextColor || null,
      displayFont,
    }
    const result = UpdateProfileSchema.safeParse(candidate)
    if (result.success) return {} as Record<string, string>
    const map: Record<string, string> = {}
    for (const issue of result.error.issues) map[issue.path.join('.')] = issue.message
    return map
  }, [bannerUrl, bannerColor, profileTheme, bannerPositionY, bannerScale, bannerBorder, bannerTextColor, displayFont])

  const updateProfile = useMutation({
    mutationFn: async () => {
      const initial = {
        bannerUrl:       (user as any)?.bannerUrl    ?? '',
        bannerColor:     (user as any)?.bannerColor  ?? '',
        profileTheme:    (user as any)?.profileTheme ?? '',
        bannerPositionY: (user as any)?.bannerPositionY ?? 50,
        bannerScale:     (user as any)?.bannerScale     ?? 100,
        bannerBorder:    (user as any)?.bannerBorder    ?? 'none',
        bannerTextColor: (user as any)?.bannerTextColor ?? '',
        displayFont:     (user as any)?.displayFont ?? 'serif',
      }
      const payload: Record<string, unknown> = {}
      if (bannerUrl       !== initial.bannerUrl)       payload.bannerUrl       = bannerUrl    || null
      if (bannerColor     !== initial.bannerColor)     payload.bannerColor     = bannerColor  || null
      if (profileTheme    !== initial.profileTheme)    payload.profileTheme    = profileTheme || null
      if (bannerPositionY !== initial.bannerPositionY) payload.bannerPositionY = bannerPositionY
      if (bannerScale     !== initial.bannerScale)     payload.bannerScale     = bannerScale
      if (bannerBorder    !== initial.bannerBorder)    payload.bannerBorder    = bannerBorder
      if (bannerTextColor !== initial.bannerTextColor) payload.bannerTextColor = bannerTextColor || null
      if (displayFont     !== initial.displayFont)     payload.displayFont     = displayFont
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
  }, [bannerUrl, bannerColor, profileTheme, bannerPositionY, bannerScale, bannerBorder, bannerTextColor, displayFont])

  return (
    <div>
      <SectionHeader
        title="Personalização"
        description="Aparência visual do seu perfil — banner, tema, fonte, cor de texto. Tudo com auto-save."
      />

      {/* ═══ Banner ═══ */}
      <Row label="Banner" hint="Imagem grande no topo do perfil. Customize fundo, posição e borda em abas separadas.">
        <div className="flex flex-col gap-5">
          <BannerPreview
            bannerUrl={bannerUrl && !bannerImgErr ? bannerUrl : undefined}
            fallbackBg={bannerColor}
            positionY={bannerPositionY}
            scale={bannerScale}
            border={bannerBorder}
            onImgError={() => setBannerImgErr(true)}
          />

          <Tabs defaultValue="fundo" className="w-full">
            <TabsList className="grid grid-cols-3 w-full sm:w-auto sm:inline-flex">
              <TabsTrigger value="fundo">Fundo</TabsTrigger>
              <TabsTrigger value="ajuste" disabled={!bannerUrl || bannerImgErr}>Ajuste</TabsTrigger>
              <TabsTrigger value="borda">Borda</TabsTrigger>
            </TabsList>

            {/* FUNDO */}
            <TabsContent value="fundo" className="mt-6 flex flex-col gap-6">
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="button" variant="outline" onClick={() => bannerFileRef.current?.click()} className="gap-2">
                  <Upload className="size-4" /> Enviar imagem
                </Button>
                {bannerUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setBannerUrl('')}>
                    Remover imagem
                  </Button>
                )}
                <input
                  ref={bannerFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={readImageAsDataUri}
                />
              </div>
              {fileError && <p className="text-xs text-(--danger) m-0">{fileError}</p>}

              <div>
                <span className="ed-label block mb-3">— Gradient de fundo</span>
                <div className="grid grid-cols-6 sm:grid-cols-10 gap-1">
                  {BANNER_GRADIENTS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => { setBannerColor(g.value); setShowBannerBuilder(false) }}
                      className={cn(
                        'aspect-square rounded-sm border cursor-pointer transition-all hover:scale-110 relative grid place-items-center',
                        bannerColor === g.value
                          ? 'border-(--accent) ring-1 ring-(--accent)/50 z-10'
                          : 'border-(--border-mid)/70 hover:border-(--accent)',
                      )}
                      style={{ background: g.value }}
                      title={g.label}
                    >
                      {bannerColor === g.value && <Check className="size-2.5 text-white drop-shadow-md" />}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowBannerBuilder((v) => !v)}
                  className={cn(
                    'mt-3 w-full h-9 rounded-lg border text-[11px] font-mono uppercase tracking-wider cursor-pointer transition-all hover:scale-[1.005]',
                    showBannerBuilder
                      ? 'border-(--accent) text-(--accent) bg-(--accent)/10'
                      : 'border-dashed border-(--border-mid) text-(--text-3) hover:border-(--accent) hover:text-(--accent)',
                  )}
                >
                  {showBannerBuilder ? 'Fechar custom' : 'Custom gradient'}
                </button>
                {showBannerBuilder && (
                  <div className="mt-3 p-5 rounded-2xl border border-(--border-mid) bg-(--raised)/30">
                    <GradientBuilder value={bannerColor} onChange={setBannerColor} previewH={72} />
                  </div>
                )}
              </div>

              <div>
                <span className="ed-label block mb-2">— Cor de texto no banner</span>
                <p className="text-[11px] text-(--text-3) m-0 mb-3 leading-relaxed">
                  Vazio = automático (claro/escuro pelo brilho do fundo). Defina manualmente se quiser.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={bannerTextColor || '#ffffff'}
                    onChange={(e) => setBannerTextColor(e.target.value)}
                    className="size-10 rounded-md border border-(--border-mid) cursor-pointer bg-transparent"
                    aria-label="Cor do texto no banner"
                  />
                  <Input
                    value={bannerTextColor}
                    onChange={(e) => setBannerTextColor(e.target.value)}
                    placeholder="#ffffff"
                    maxLength={7}
                    className="font-mono text-xs flex-1"
                  />
                  {bannerTextColor && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setBannerTextColor('')}>
                      Auto
                    </Button>
                  )}
                </div>
                {errors.bannerTextColor && <p className="text-xs text-(--danger) mt-1 m-0">{errors.bannerTextColor}</p>}
              </div>
            </TabsContent>

            {/* AJUSTE */}
            <TabsContent value="ajuste" className="mt-6">
              {bannerUrl && !bannerImgErr ? (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-(--text-3) m-0 leading-relaxed max-w-prose">
                    Arraste a imagem verticalmente pra escolher qual parte aparece. Use o slider de zoom pra dar close.
                  </p>
                  <BannerPositioner
                    bannerUrl={bannerUrl}
                    positionY={bannerPositionY}
                    scale={bannerScale}
                    onChange={(y, s) => { setBannerPositionY(y); setBannerScale(s) }}
                    onReset={() => { setBannerPositionY(50); setBannerScale(100) }}
                  />
                </div>
              ) : (
                <p className="text-sm text-(--text-3) italic m-0 py-8 text-center border border-dashed border-(--border-mid) rounded-xl">
                  Envie uma imagem na aba Fundo pra desbloquear ajuste de posição e zoom.
                </p>
              )}
            </TabsContent>

            {/* BORDA */}
            <TabsContent value="borda" className="mt-6">
              <p className="text-xs text-(--text-3) m-0 mb-4 leading-relaxed max-w-prose">
                Animação ao redor do CARD inteiro (não só do banner). 8 estilos GPU-leves. Respeitam reduced-motion.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {BANNER_BORDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBannerBorder(opt.id)}
                    className={cn(
                      'group relative flex flex-col items-start gap-1.5 p-4 rounded-xl border text-left transition-all hover:scale-[1.02] cursor-pointer min-h-20',
                      bannerBorder === opt.id
                        ? 'border-(--accent) bg-(--accent)/8 ring-1 ring-(--accent)/40'
                        : 'border-(--border-mid) hover:border-(--accent)/60',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-(--text-2)">
                      {opt.icon} {opt.label}
                    </span>
                    <span className="text-[10px] text-(--text-3) leading-tight">{opt.description}</span>
                    {bannerBorder === opt.id && (
                      <Check className="absolute top-2.5 right-2.5 size-3.5 text-(--accent)" />
                    )}
                  </button>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </Row>

      {/* ═══ Profile theme ═══ */}
      <Row label="Tema do card de perfil" hint="Gradient de fundo do card que aparece quando alguém abre seu perfil.">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-6 sm:grid-cols-10 gap-1">
            {BANNER_GRADIENTS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setProfileTheme(t.value); setShowThemeBuilder(false) }}
                className={cn(
                  'aspect-square rounded-sm border cursor-pointer transition-all hover:scale-110 relative grid place-items-center',
                  profileTheme === t.value
                    ? 'border-(--accent) ring-1 ring-(--accent)/50 z-10'
                    : 'border-(--border-mid)/70 hover:border-(--accent)',
                )}
                style={{ background: t.value }}
                title={t.label}
              >
                {profileTheme === t.value && <Check className="size-2.5 text-white drop-shadow-md" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowThemeBuilder((v) => !v)}
            className={cn(
              'w-full h-9 rounded-lg border text-[11px] font-mono uppercase tracking-wider cursor-pointer transition-all hover:scale-[1.005]',
              showThemeBuilder
                ? 'border-(--accent) text-(--accent) bg-(--accent)/10'
                : 'border-dashed border-(--border-mid) text-(--text-3) hover:border-(--accent) hover:text-(--accent)',
            )}
          >
            {showThemeBuilder ? 'Fechar custom' : 'Custom gradient'}
          </button>
        </div>
        {showThemeBuilder && (
          <div className="mt-3 p-5 rounded-2xl border border-(--border-mid) bg-(--raised)/30">
            <GradientBuilder value={profileTheme} onChange={setProfileTheme} previewH={88} />
          </div>
        )}
      </Row>

      {/* ═══ Display font ═══ */}
      <Row label="Fonte do nome" hint="Tipografia do displayName e bio no card. 8 famílias curadas.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DISPLAY_FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setDisplayFont(f.id)}
              className={cn(
                'group relative flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all hover:scale-[1.02] cursor-pointer',
                displayFont === f.id
                  ? 'border-(--accent) bg-(--accent)/8 ring-1 ring-(--accent)/40'
                  : 'border-(--border-mid) hover:border-(--accent)/60',
              )}
            >
              <span className="text-[10px] uppercase tracking-wider text-(--text-3) font-mono">{f.label}</span>
              <span className="text-base leading-tight text-(--text-1)" style={{ fontFamily: f.family }}>
                {f.preview}
              </span>
              {displayFont === f.id && <Check className="absolute top-2 right-2 size-3.5 text-(--accent)" />}
            </button>
          ))}
        </div>
      </Row>

      <div className="pt-4">
        <SaveStatus status={saveStatus} error={saveError} />
      </div>
    </div>
  )
}

// ─── BannerPreview ──────────────────────────────────────────
function BannerPreview({
  bannerUrl, fallbackBg, positionY, scale, border, onImgError,
}: {
  bannerUrl?:  string
  fallbackBg:  string
  positionY:   number
  scale:       number
  border:      BannerBorderStyle
  onImgError:  () => void
}) {
  return (
    <div
      className={cn(
        'w-full h-44 sm:h-48 rounded-xl border border-(--border-mid) overflow-hidden relative',
        border !== 'none' && `card-border-${border}`,
      )}
      style={!bannerUrl ? { background: fallbackBg } : undefined}
    >
      {bannerUrl && (
        <img
          src={bannerUrl}
          alt=""
          onError={onImgError}
          className="w-full h-full object-cover block"
          style={{
            objectPosition: `center ${positionY}%`,
            transform: `scale(${scale / 100})`,
            transformOrigin: 'center center',
          }}
        />
      )}
    </div>
  )
}

// ─── BannerPositioner ───────────────────────────────────────
function BannerPositioner({
  bannerUrl, positionY, scale, onChange, onReset,
}: {
  bannerUrl: string
  positionY: number
  scale:     number
  onChange:  (positionY: number, scale: number) => void
  onReset:   () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startPosY: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startPosY: positionY }
  }, [positionY])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const wrap = wrapRef.current
    if (!wrap) return
    const dy = e.clientY - dragRef.current.startY
    const deltaPct = -dy / wrap.clientHeight * 100
    const newY = Math.max(0, Math.min(100, dragRef.current.startPosY + deltaPct))
    onChange(Math.round(newY), scale)
  }, [onChange, scale])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="w-full h-44 rounded-xl border border-(--border-mid) overflow-hidden relative cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <img
          src={bannerUrl}
          alt=""
          draggable={false}
          className="w-full h-full object-cover pointer-events-none"
          style={{
            objectPosition: `center ${positionY}%`,
            transform: `scale(${scale / 100})`,
            transformOrigin: 'center center',
          }}
        />
        <span className="ed-marg absolute top-2 left-2 text-white bg-black/45 px-2 py-1 rounded backdrop-blur-sm pointer-events-none">
          Arraste verticalmente
        </span>
        <span className="ed-marg absolute top-2 right-2 text-white bg-black/45 px-2 py-1 rounded backdrop-blur-sm pointer-events-none font-mono">
          Y {positionY}%
        </span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-50">
          <span className="ed-marg shrink-0">Zoom</span>
          <input
            type="range"
            min={100}
            max={200}
            step={5}
            value={scale}
            onChange={(e) => onChange(positionY, Number(e.target.value))}
            className="flex-1 accent-(--accent)"
          />
          <span className="text-[11px] font-mono text-(--text-3) w-10 text-right">{scale}%</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
          <RotateCcw className="size-3.5" /> Resetar
        </Button>
      </div>
    </div>
  )
}
