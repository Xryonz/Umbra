/**
 * ProfileCard — Nitro-style premium.
 *
 * Estrutura:
 *  - Banner 240px com rounded-bl/br-2xl (suavização)
 *  - Body sobe -mt-6 pra criar overlap com banner, rounded-tl/tr-2xl
 *  - Avatar grande flutuando -mt-20 sobre banner, ring accent
 *  - Hero: displayName XL serif + status pill compacto
 *  - Custom status: quote italic destacado
 *  - Selos: chip row flutuante (sem header "Selos")
 *  - Bio: editorial quote serif
 *  - Mutual servers: grid compacto com hover scale
 *
 * Animação: banner settle (scale 1.05→1), avatar pop-in spring,
 * cascata stagger das seções, hover micro nos mutuais.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, Calendar, Users as UsersIcon, Crown, Shield, Sparkles, Quote } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { motion, type Variants } from 'motion/react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BioMarkdown } from '@/lib/bioMarkdown'
import { getContrast } from '@/lib/colorContrast'
import { GuestbookSection } from '@/components/profile/GuestbookSection'
import { useAuthStore } from '@/store/authStore'
import {
  Sheet, SheetContent, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import StatusDot, { STATUS_META, type UserStatus } from '@/components/StatusDot'

// Cascata interna — chega depois do slide do Sheet.
// Tuned p/ "leve e clean": menos delay, menos amplitude, duração curta.
const bodyVariants: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.12 } },
}
const sectionVariants: Variants = {
  hidden:  { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
}

type BannerBorder = 'none' | 'aurora' | 'pulse' | 'ink' | 'marquee' | 'glow' | 'noise' | 'shimmer'
type DisplayFontLocal       = 'serif' | 'sans' | 'mono' | 'rounded' | 'condensed' | 'handwriting' | 'gothic' | 'modern'

const FONT_FAMILY: Record<DisplayFontLocal, string> = {
  serif:       'var(--font-display)',
  sans:        '-apple-system, ui-sans-serif, system-ui',
  mono:        'var(--font-mono)',
  rounded:     'ui-rounded, "SF Pro Rounded", system-ui',
  condensed:   '"Helvetica Neue Condensed", Impact, Arial Narrow, sans-serif',
  handwriting: '"Brush Script MT", cursive',
  gothic:      'UnifrakturCook, "Times New Roman", serif',
  modern:      'Futura, "Avenir Next", "Trebuchet MS", sans-serif',
}

interface PublicUser {
  id:          string
  username:    string
  displayName: string
  avatarUrl:   string | null
  bio:         string | null
  bannerUrl:   string | null
  bannerColor: string | null
  profileTheme?: string | null
  bannerPositionY?: number
  bannerScale?:     number
  bannerBorder?:    BannerBorder
  bannerTextColor?: string | null
  pronouns?:        string | null
  statusEmoji?:     string | null
  displayFont?:     DisplayFontLocal
  customStatus?: string | null
  isBot?:      boolean
  createdAt?:  string
  status?:     UserStatus
  effectiveStatus?: UserStatus
}
interface MutualServer { id: string; name: string; iconUrl: string|null; isGroup: boolean; role: string }

interface ProfileCardProps {
  userId:    string
  anchorEl?: HTMLElement | null
  onClose:   () => void
}

const PALETTE = ['#c9a96e','#7c6fc4','#6fa8c9','#c97c6e','#6ec98a']
function userColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function isGif(url: string) {
  return url.toLowerCase().endsWith('.gif') || url.includes('giphy') || url.includes('tenor')
}

/**
 * Fallback gradient (cada user deterministico via hash do id).
 * Usado se profileTheme não tiver sido configurado.
 * Mesma família dos presets Nitro disponíveis em ProfileSection.
 */
function nitroGradient(id: string) {
  const presets = [
    'linear-gradient(135deg,#ff6b9d,#ff9874,#ffd6a5)',  // Amanhecer
    'linear-gradient(135deg,#6e57e0,#4fc3f7,#00d4ff)',  // Cyber
    'linear-gradient(135deg,#3a1c71,#d76d77,#ffaf7b)',  // Aurora
    'linear-gradient(135deg,#8e2de2,#4a00e0,#f12711)',  // Plasma
    'linear-gradient(135deg,#2193b0,#6dd5ed)',          // Oceano
    'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',  // Galáxia
    'linear-gradient(135deg,#41295a,#2f0743)',          // Veludo
    'linear-gradient(135deg,#11998e,#38ef7d)',          // Menta
  ]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return presets[h % presets.length]
}

export default function ProfileCard({ userId, onClose }: ProfileCardProps) {
  const currentUser = useAuthStore((s) => s.user)
  const navigate    = useNavigate()
  const [bannerError, setBannerError] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  /** Cor dominante extraída do banner. Usada pra glow ambient no banner + avatar. */
  const [extractedColor, setExtractedColor] = useState<string | null>(null)

  const isSelf = userId === currentUser?.id

  const { data, isLoading } = useQuery<{ user: PublicUser; mutualServers: MutualServer[] }>({
    queryKey: ['profile', userId],
    queryFn:  async () => (await api.get(`/api/profile/${userId}`)).data.data,
    staleTime: 10_000,
    refetchOnMount: 'always',
  })
  const profile  = data?.user
  const mutuals  = data?.mutualServers ?? []

  useEffect(() => {
    setBannerError(false)
    setAvatarError(false)
  }, [profile?.bannerUrl, profile?.avatarUrl])

  const handleSendDM = async () => {
    if (!profile) return
    try {
      const res = await api.post(`/api/dm/open/${profile.username}`)
      const { conversationId, otherUser } = res.data.data
      navigate('/app/dm', { state: { conversationId, otherUser } })
    } catch {}
    onClose()
  }

  const accentColor   = profile?.id ? userColor(profile.id) : '#c9a96e'
  const fallbackTheme = profile?.id ? nitroGradient(profile.id) : 'linear-gradient(135deg,#1a1a2e,#16213e)'
  const themeBg       = profile?.profileTheme || fallbackTheme
  const bannerBg      = profile?.bannerUrl && !bannerError
    ? undefined
    : (profile?.bannerColor ?? fallbackTheme)

  // Cor de texto no banner: manual override > auto-contrast da bg do banner.
  // Source pra contraste: bannerColor (gradient/hex) ou cor extraída (do banner image).
  const bannerContrastBg = profile?.bannerColor ?? extractedColor ?? fallbackTheme
  const bannerTextColor  = profile?.bannerTextColor ?? getContrast(bannerContrastBg).text

  // Cor de texto do BODY: auto-contrast baseado em themeBg.
  // (Body tem backdrop-blur overlay --popover/88, então a luminância efetiva é
  // popover mixada com themeBg. Aproximamos amostrando themeBg direto.)
  const bodyContrast      = getContrast(themeBg)
  const bodyTextInverted  = bodyContrast.isLightBg
  // Vars CSS overrides + text-shadow sutil — preto/branco puro pra
  // máximo destaque, shadow inverso pra criar separação do backdrop.
  const bodyTextOverrides: React.CSSProperties = bodyTextInverted ? {
    ['--text-1' as string]: '#000000',
    ['--text-2' as string]: '#1c1d21',
    ['--text-3' as string]: '#4a4b52',
    textShadow: '0 1px 2px rgba(255,255,255,0.4)',
  } : {
    ['--text-1' as string]: '#ffffff',
    ['--text-2' as string]: '#dddee2',
    ['--text-3' as string]: '#9a9ba2',
    textShadow: '0 1px 2px rgba(0,0,0,0.45)',
  }

  /**
   * Color extraction → ambient glow.
   *
   * Tenta na ordem:
   *   1) Canvas pixel sampling do bannerUrl (mais preciso, mas falha em CORS)
   *   2) Parse do primeiro hex do bannerColor gradient string (sempre funciona)
   *   3) accentColor (último recurso)
   *
   * Roda quando bannerUrl/bannerColor mudam OU quando bannerError vira true
   * (img falhou → cai pra parse do gradient).
   */
  useEffect(() => {
    const fallbackFromGradient = () => {
      const hex = profile?.bannerColor?.match(/#[0-9a-fA-F]{6}/)?.[0]
      setExtractedColor(hex ?? accentColor)
    }

    if (!profile?.bannerUrl || bannerError) {
      fallbackFromGradient()
      return
    }

    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      if (cancelled) return
      try {
        const canvas = document.createElement('canvas')
        const SIZE = 16
        canvas.width = SIZE; canvas.height = SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no ctx')
        ctx.drawImage(img, 0, 0, SIZE, SIZE)
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
        let r = 0, g = 0, b = 0
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]
        }
        const px = data.length / 4
        // Boost saturação um pouco — médias tendem a ficar cinza-pardo
        const avg = (r + g + b) / 3 / px
        const boost = (v: number) => Math.min(255, Math.round((v / px - avg) * 1.4 + avg + 30))
        setExtractedColor(`rgb(${boost(r)},${boost(g)},${boost(b)})`)
      } catch {
        // CORS taint → canvas readback bloqueado. Fallback gradient.
        fallbackFromGradient()
      }
    }
    img.onerror = fallbackFromGradient
    img.src = profile.bannerUrl

    return () => { cancelled = true }
  }, [profile?.bannerUrl, profile?.bannerColor, bannerError, accentColor])

  // Card border animation: aplicada no SheetContent (perímetro completo).
  // O SheetContent precisa overflow:hidden pra que o pseudo-element ::after
  // não scrolle com o conteúdo. Scroll vai pra um wrapper interno.
  const cardBorderClass = profile?.bannerBorder && profile.bannerBorder !== 'none'
    ? `card-border-${profile.bannerBorder}`
    : ''

  return (
    <Sheet open onOpenChange={(o: boolean) => !o && onClose()}>
      <SheetContent
        side="right"
        className={cn(
          'p-0 overflow-hidden gap-0 flex flex-col w-full sm:max-w-md bg-(--popover)',
          'data-[state=open]:[animation-duration:480ms] data-[state=closed]:[animation-duration:260ms]',
          'data-[state=open]:[animation-timing-function:cubic-bezier(0.16,1,0.3,1)]',
          'data-[state=closed]:[animation-timing-function:cubic-bezier(0.4,0,0.2,1)]',
          cardBorderClass,
        )}
      >
       <div className="flex-1 overflow-y-auto flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-sm text-(--text-3)">
            <Spinner size={16} /> Carregando perfil…
            <SheetTitle className="sr-only">Carregando perfil</SheetTitle>
            <SheetDescription className="sr-only">Aguarde</SheetDescription>
          </div>
        ) : profile ? (
          <>
            <SheetTitle className="sr-only">Perfil de {profile.displayName}</SheetTitle>
            <SheetDescription className="sr-only">@{profile.username}</SheetDescription>

            {/* ── Banner ─────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="relative h-60 overflow-hidden shrink-0 rounded-bl-2xl rounded-br-2xl"
              style={{
                background: bannerBg,
                // Glow ambient leve com cor extraída (intensidades reduzidas
                // p/ vibe clean — antes era forte demais).
                boxShadow: extractedColor
                  ? `inset 0 -50px 70px -24px ${extractedColor}33, 0 8px 24px -12px ${extractedColor}44`
                  : undefined,
              }}
            >
              {profile.bannerUrl && !bannerError && (
                <img
                  src={profile.bannerUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setBannerError(true)}
                  className="absolute inset-0 w-full h-full object-cover block"
                  style={{
                    objectPosition: `center ${profile.bannerPositionY ?? 50}%`,
                    transform: profile.bannerScale && profile.bannerScale !== 100
                      ? `scale(${profile.bannerScale / 100})`
                      : undefined,
                    transformOrigin: 'center center',
                    willChange: isGif(profile.bannerUrl) ? 'contents' : 'auto',
                  }}
                />
              )}
              {/* Gradient overlay pra contraste do texto sobre imagem */}
              <div className="absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-black/55 to-transparent pointer-events-none" />
              <span
                className="ed-marg absolute top-4 left-6 z-10 drop-shadow-sm"
                style={{ color: bannerTextColor }}
              >
                Profil · No. {(profile.id ?? '').slice(-3).toUpperCase()}
              </span>
            </motion.div>

            {/* ── Body (sobe sobre banner, com gradient + overlay) ── */}
            <div
              className="flex-1 px-6 sm:px-7 pb-8 pt-0 relative -mt-6 rounded-tl-2xl rounded-tr-2xl"
              style={{ background: themeBg, ...bodyTextOverrides }}
            >
              {/* Partículas atmosféricas SOBRE o gradient mas ABAIXO do overlay
                  → backdrop-blur-md do overlay borra elas → vira "poeira flutuante"
                  difusa em vez de pontinhos rígidos. */}
              <ParticleField />

              {/* Overlay pra legibilidade — mantém vibe do gradient mas legível */}
              <div className="absolute inset-0 bg-(--popover)/88 backdrop-blur-md rounded-tl-2xl rounded-tr-2xl pointer-events-none" />

              <motion.div className="relative" variants={bodyVariants} initial="hidden" animate="visible">
                {/* ── Avatar row ───────────────────────────── */}
                <div className="flex items-end justify-between -mt-14 mb-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="relative shrink-0"
                  >
                    <Avatar
                      className="size-28 rounded-full border-[5px] transition-shadow duration-700 ease-(--ease-spring)"
                      style={{
                        borderColor: 'var(--popover)',
                        background:  profile.isBot ? 'var(--accent-dim)' : accentColor + '22',
                        // Avatar absorve a mesma cor do banner → halo coeso.
                        // Intensidade reduzida p/ vibe clean.
                        boxShadow: extractedColor
                          ? `0 10px 28px -12px ${extractedColor}88, 0 0 0 1px ${extractedColor}22`
                          : '0 8px 24px -10px rgba(0,0,0,0.5)',
                      }}
                    >
                      {profile.avatarUrl && !avatarError && (
                        <AvatarImage
                          src={profile.avatarUrl}
                          onError={() => setAvatarError(true)}
                          referrerPolicy="no-referrer"
                          style={{ willChange: isGif(profile.avatarUrl) ? 'contents' : 'auto' }}
                        />
                      )}
                      <AvatarFallback
                        style={{ color: profile.isBot ? 'var(--accent)' : accentColor, background: 'transparent' }}
                        className="text-3xl font-(family-name:--font-display) rounded-full"
                      >
                        {profile.isBot ? '🤖' : profile.displayName.slice(0,1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {!profile.isBot && profile.effectiveStatus && (
                      <span className="absolute bottom-1.5 right-1.5">
                        <StatusDot status={profile.effectiveStatus} size={22} bordered borderColor="var(--popover)" />
                      </span>
                    )}
                  </motion.div>

                  <motion.div variants={sectionVariants} className="mb-2">
                    {!isSelf && !profile.isBot && (
                      // Outer motion.div: whileTap pra feedback tátil (spring 500/25).
                      // Button (shadcn) interno carrega sheen overlay via group-hover.
                      <motion.div
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 600, damping: 28 }}
                        className="inline-block"
                      >
                        <Button
                          onClick={handleSendDM}
                          className="group relative overflow-hidden rounded-full h-10 px-5 gap-2 bg-(--accent) text-(--text-inv) font-medium tracking-wider uppercase text-[11px] hover:scale-105 hover:shadow-[0_8px_24px_var(--accent-glow)] transition-all duration-300 ease-(--ease-spring)"
                        >
                          {/* Sheen: faixa diagonal branca translúcida que atravessa o
                              botão no hover. translate-x sai de -150% (off-screen left)
                              até 250% (off-screen right) em 700ms. */}
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 w-1/2 translate-x-[-150%] group-hover:translate-x-[250%] transition-transform duration-900 ease-out pointer-events-none bg-linear-to-r from-transparent via-white/22 to-transparent skew-x-12"
                          />
                          <MessageCircle className="size-3.5 relative" />
                          <span className="relative">Mensagem</span>
                        </Button>
                      </motion.div>
                    )}
                  </motion.div>
                </div>

                {/* ── Hero block: name + handle + status ──── */}
                <motion.header variants={sectionVariants} className="mb-5">
                  <div className="flex items-baseline flex-wrap gap-2 mb-1">
                    <h2
                      className="text-[2rem] font-normal tracking-tight m-0 leading-tight wrap-break-word"
                      style={{
                        fontFamily: FONT_FAMILY[profile.displayFont ?? 'serif'],
                        color: accentColor,
                      }}
                    >
                      {profile.displayName}
                    </h2>
                    {profile.isBot && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full self-center"
                        style={{ background: 'var(--accent)', color: 'var(--text-inv)' }}
                      >
                        BOT
                      </span>
                    )}
                    {profile.pronouns && (
                      <span
                        className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border self-center"
                        style={{
                          borderColor: 'color-mix(in srgb, ' + accentColor + ' 40%, transparent)',
                          color: accentColor,
                          background: 'color-mix(in srgb, ' + accentColor + ' 10%, transparent)',
                        }}
                      >
                        {profile.pronouns}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-xs text-(--text-3) m-0 tracking-wide">@{profile.username}</p>
                    {!profile.isBot && profile.effectiveStatus && (
                      <>
                        <span className="text-(--text-3) text-[10px]">·</span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-(--text-2)">
                          <StatusDot status={profile.effectiveStatus} size={8} />
                          {STATUS_META[profile.effectiveStatus].label}
                        </span>
                      </>
                    )}
                  </div>
                </motion.header>

                {/* ── Custom status quote (se tiver) ──────── */}
                {profile.customStatus && (
                  <motion.div variants={sectionVariants} className="mb-5">
                    <div
                      className="relative rounded-xl px-4 py-3 border-l-2 flex items-start gap-2.5"
                      style={{
                        borderLeftColor: accentColor,
                        background: 'color-mix(in srgb, var(--raised) 60%, transparent)',
                      }}
                    >
                      {profile.statusEmoji && (
                        <span className="text-xl leading-none shrink-0 mt-0.5">{profile.statusEmoji}</span>
                      )}
                      <Quote className="absolute top-2 right-3 size-3 text-(--text-3) opacity-40" />
                      <p
                        className="m-0 text-sm italic leading-relaxed text-(--text-1)"
                        style={{ fontFamily: FONT_FAMILY[profile.displayFont ?? 'serif'] }}
                      >
                        {profile.customStatus}
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ── Selos (chip row flutuante, sem header) ── */}
                {!profile.isBot && (
                  <motion.div variants={sectionVariants} className="flex flex-wrap gap-1.5 mb-5">
                    <Chip icon={<Sparkles className="size-3" />} label="Early Reader" tone="accent" />
                    {profile.createdAt && new Date(profile.createdAt) < new Date(Date.now() - 30*24*60*60*1000) && (
                      <Chip icon={<Calendar className="size-3" />} label="30+ dias" />
                    )}
                  </motion.div>
                )}

                {/* ── Bio ─────────────────────────────────── */}
                <motion.section variants={sectionVariants} className="mb-5">
                  <span className="ed-label block mb-2">— Sobre</span>
                  {profile.bio ? (
                    <p
                      className="text-(--text-2) text-[14px] leading-[1.7] m-0 wrap-break-word"
                      style={{ fontFamily: FONT_FAMILY[profile.displayFont ?? 'serif'] }}
                    >
                      <BioMarkdown text={profile.bio} />
                    </p>
                  ) : (
                    <p className="text-(--text-3) text-sm italic m-0">
                      {isSelf ? 'Você ainda não escreveu uma bio.' : 'Sem bio ainda.'}
                    </p>
                  )}
                </motion.section>

                {/* ── Membro desde ─────────────────────────── */}
                {profile.createdAt && (
                  <motion.div variants={sectionVariants} className="mb-5">
                    <span className="ed-label block mb-1.5">— Membro desde</span>
                    <p className="text-(--text-2) text-sm m-0 flex items-center gap-2">
                      <Calendar className="size-3.5 text-(--text-3)" />
                      {format(new Date(profile.createdAt), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                    </p>
                  </motion.div>
                )}

                {/* ── Servidores em comum (grid compacto) ─── */}
                {!isSelf && mutuals.length > 0 && (
                  <motion.div variants={sectionVariants} className="mb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="ed-label">— Em comum</span>
                      <span className="text-[10px] font-mono text-(--text-3)">{mutuals.length}</span>
                    </div>
                    {/* Slide cascade leve: cada tile entra deslizando 8px da direita,
                        stagger curto e delay base reduzido p/ não esperar tanto. */}
                    {/* CSS animation no <li> em vez de motion.li → 12 instâncias
                        motion economizadas em cada abertura de ProfileCard. */}
                    <ul className="flex flex-wrap gap-2">
                      {mutuals.slice(0, 12).map((s, i) => (
                        <li
                          key={s.id}
                          style={{
                            animation: `reveal-rise 0.28s cubic-bezier(0.16,1,0.3,1) ${0.28 + i * 0.025}s both`,
                            ['--reveal-distance' as string]: '6px',
                          }}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="relative size-10 rounded-xl border border-(--border) bg-(--raised) overflow-hidden flex items-center justify-center text-[10px] font-bold transition-all duration-300 ease-(--ease-spring) hover:scale-110 hover:-translate-y-0.5 hover:border-(--accent) hover:shadow-[0_4px_16px_rgba(0,0,0,0.4)] cursor-pointer"
                              >
                                {s.iconUrl
                                  ? <img src={s.iconUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                                  : <span style={{ fontFamily: 'var(--font-display)' }}>{s.name.slice(0,2).toUpperCase()}</span>}
                                {(s.role === 'OWNER' || s.role === 'ADMIN' || s.isGroup) && (
                                  <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-(--popover) border border-(--border) grid place-items-center">
                                    {s.role === 'OWNER' && <Crown className="size-2.5 text-(--accent)" />}
                                    {s.role === 'ADMIN' && <Shield className="size-2.5 text-(--text-2)" />}
                                    {s.isGroup && s.role !== 'OWNER' && s.role !== 'ADMIN' && <UsersIcon className="size-2.5 text-(--text-3)" />}
                                  </span>
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">{s.name}</TooltipContent>
                          </Tooltip>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}

                {/* ── Guestbook ─────────────────────────────── */}
                <motion.section variants={sectionVariants} className="mb-5">
                  <GuestbookSection
                    userId={profile.id}
                    accentColor={accentColor}
                    isSelf={isSelf}
                  />
                </motion.section>

              </motion.div>
            </div>
          </>
        ) : (
          <div className="p-10 text-center">
            <SheetTitle className="sr-only">Perfil não encontrado</SheetTitle>
            <SheetDescription>Esse usuário pode ter sido removido.</SheetDescription>
          </div>
        )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Chip flutuante pra selos/badges no hero. */
function Chip({ icon, label, tone }: { icon: React.ReactNode; label: string; tone?: 'accent' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full border ${
        tone === 'accent'
          ? 'border-(--accent)/40 text-(--accent) bg-(--accent)/10'
          : 'border-(--border) text-(--text-2) bg-(--raised)/60'
      }`}
    >
      {icon} {label}
    </span>
  )
}

/**
 * ParticleField — campo atmosférico de pontos brancos flutuantes sobre theme bg.
 *
 * Vibe "dust motes in sunlight" — cada partícula tem fase própria (delay
 * aleatório). Renderizado ABAIXO do overlay backdrop-blur-md → partículas
 * viram halos difusos em vez de pontinhos cravados.
 *
 * Tuned p/ "leve e clean": 12 partículas, opacidade baixa, órbitas curtas,
 * duração longa (movimento quase imperceptível, só dá vida ao bg).
 */
function ParticleField({ count = 12 }: { count?: number }) {
  const particles = useMemo(
    () => Array.from({ length: count }).map((_, i) => ({
      id:        i,
      left:      Math.random() * 100,
      top:       Math.random() * 100,
      size:      0.7 + Math.random() * 1.1,
      orbitX:    -3 + Math.random() * 6,
      orbitY:    -4 + Math.random() * 8,
      duration:  22 + Math.random() * 18,
      delay:     Math.random() * 8,
      opacityHi: 0.18 + Math.random() * 0.22,
    })),
    [count],
  )

  const reduceMotion = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-tl-2xl rounded-tr-2xl">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          aria-hidden
          className="absolute rounded-full bg-white"
          style={{
            left:   `${p.left}%`,
            top:    `${p.top}%`,
            width:  `${p.size}px`,
            height: `${p.size}px`,
          }}
          initial={{ opacity: 0 }}
          animate={reduceMotion
            ? { opacity: p.opacityHi * 0.4 }
            : {
                opacity: [0.05, p.opacityHi, 0.05],
                x:       [0, p.orbitX, 0],
                y:       [0, p.orbitY, 0],
              }
          }
          transition={{
            duration: p.duration,
            delay:    p.delay,
            repeat:   Infinity,
            ease:     'easeInOut',
          }}
        />
      ))}
    </div>
  )
}
