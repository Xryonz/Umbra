/**
 * ProfileCard — rebuild minimalista (overhaul 2026-06-02).
 *
 * Estrutura:
 *  - Banner (imagem ou gradient fallback)
 *  - Hero (avatar overlap, nome, pronouns, emoji, handle, status)
 *  - Custom status quote
 *  - Bio plain text
 *  - Membro desde
 *  - Botão Mensagem (se não-self)
 *
 * Features dropadas: banner borders (7), banner position/zoom, bio markdown,
 * auto-contrast, guestbook, mutual servers, chips/selos.
 *
 * Dados legados preservados no DB — só não renderizamos mais aqui.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Calendar, MessageCircle, Quote } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { motion } from 'motion/react'

import { api }            from '@/lib/api'
import { useAuthStore }   from '@/store/authStore'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button }         from '@/components/ui/button'
import { ProfileBanner }       from '@/components/profile/ProfileBanner'
import { ProfileHero }         from '@/components/profile/ProfileHero'
import { ProfileBio }          from '@/components/profile/ProfileBio'
import { ProfileCardSkeleton } from '@/components/profile/ProfileCardSkeleton'
import { FONT_FAMILY, type DisplayFont } from '@/components/profile/profileFonts'
import { type UserStatus } from '@/components/StatusDot'

interface ProfileCardProps {
  userId:  string
  onClose: () => void
}

interface PublicUser {
  id:                string
  username:          string
  /** Coordenada Astra (AAAA-BB) — só presente no /me próprio. */
  coordinate?:       string
  displayName:       string
  avatarUrl:         string | null
  bio:               string | null
  bannerUrl:         string | null
  bannerColor:       string | null
  profileTheme?:     string | null
  bannerPositionY?:  number
  bannerScale?:      number
  pronouns?:         string | null
  statusEmoji?:      string | null
  displayFont?:      DisplayFont
  customStatus?:     string | null
  isBot?:            boolean
  createdAt?:        string
  effectiveStatus?:  UserStatus
}

// Deterministic color por user.id — mesma família dos fallback gradients.
const PALETTE = ['#c9a96e','#7c6fc4','#6fa8c9','#c97c6e','#6ec98a']
function userColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const FALLBACK_GRADIENTS = [
  'linear-gradient(135deg,#3a1c71,#d76d77,#ffaf7b)',
  'linear-gradient(135deg,#2193b0,#6dd5ed)',
  'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',
  'linear-gradient(135deg,#41295a,#2f0743)',
  'linear-gradient(135deg,#11998e,#38ef7d)',
]
function fallbackGradient(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return FALLBACK_GRADIENTS[h % FALLBACK_GRADIENTS.length]
}

export default function ProfileCard({ userId, onClose }: ProfileCardProps) {
  const currentUser = useAuthStore((s) => s.user)
  const navigate    = useNavigate()
  const isSelf      = userId === currentUser?.id

  const { data: profile, isLoading } = useQuery<PublicUser>({
    queryKey:   ['profile', userId],
    queryFn:    async () => (await api.get(`/api/profile/${userId}`)).data.data.user,
    staleTime:  30_000,
  })

  const accentColor = profile?.id ? userColor(profile.id) : '#c9a96e'
  const gradient    = profile?.id ? fallbackGradient(profile.id) : 'linear-gradient(135deg,#1a1a2e,#16213e)'
  const fontFamily  = FONT_FAMILY[profile?.displayFont ?? 'serif']

  const handleSendDM = async () => {
    if (!profile) return
    try {
      const res = await api.post(`/api/dm/open/${profile.username}`)
      const { conversationId, otherUser } = res.data.data
      navigate('/app/dm', { state: { conversationId, otherUser } })
    } catch {
      // erros tratados no axios interceptor + toast global
    }
    onClose()
  }

  return (
    <Sheet open onOpenChange={(o: boolean) => !o && onClose()}>
      <SheetContent
        side="right"
        className="p-0 overflow-hidden gap-0 flex flex-col w-full sm:max-w-md rounded-l-3xl"
        style={{ background: profile?.profileTheme || 'var(--overlay)' }}
      >
        <div className="flex-1 overflow-y-auto flex flex-col">
          {isLoading ? (
            <>
              <SheetTitle className="sr-only">Carregando perfil</SheetTitle>
              <SheetDescription className="sr-only">Aguarde</SheetDescription>
              <ProfileCardSkeleton />
            </>
          ) : profile ? (
            <>
              <SheetTitle className="sr-only">Perfil de {profile.displayName}</SheetTitle>
              <SheetDescription className="sr-only">@{profile.username}</SheetDescription>

              <ProfileBanner
                bannerUrl={profile.bannerUrl}
                bannerColor={profile.bannerColor}
                fallbackGradient={gradient}
                username={profile.username}
                positionY={profile.bannerPositionY}
                scale={profile.bannerScale}
              />

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="px-6 sm:px-7 pb-8 pt-0"
              >
                <ProfileHero
                  avatarUrl={profile.avatarUrl}
                  displayName={profile.displayName}
                  username={profile.username}
                  coordinate={isSelf ? profile.coordinate : undefined}
                  pronouns={profile.pronouns}
                  statusEmoji={profile.statusEmoji}
                  displayFont={profile.displayFont}
                  effectiveStatus={profile.effectiveStatus}
                  isBot={profile.isBot}
                  accentColor={accentColor}
                />

                {profile.customStatus && (
                  <div
                    className="relative mt-4 mb-5 px-4 py-3 border-l-2 flex items-start gap-2.5 rounded-r-lg"
                    style={{
                      borderLeftColor: accentColor,
                      background:      'color-mix(in srgb, var(--raised) 60%, transparent)',
                    }}
                  >
                    <Quote className="absolute top-2 right-3 size-3 text-(--text-3) opacity-40" />
                    <p className="m-0 text-sm italic leading-relaxed text-(--text-1)" style={{ fontFamily }}>
                      {profile.customStatus}
                    </p>
                  </div>
                )}

                <ProfileBio bio={profile.bio} isSelf={isSelf} fontFamily={fontFamily} />

                {profile.createdAt && (
                  <div className="mb-6">
                    <span className="ed-label block mb-1.5">— Membro desde</span>
                    <p className="text-(--text-2) text-sm m-0 flex items-center gap-2">
                      <Calendar className="size-3.5 text-(--text-3)" />
                      {format(new Date(profile.createdAt), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                    </p>
                  </div>
                )}

                {!isSelf && !profile.isBot && (
                  <Button
                    onClick={handleSendDM}
                    className="w-full gap-2 rounded-full h-10 bg-(--accent) text-(--text-inv) font-medium tracking-wider uppercase text-marg hover:bg-(--accent-h) hover:shadow-accent transition-all duration-300 ease-(--ease-spring)"
                  >
                    <MessageCircle className="size-3.5" />
                    Mensagem
                  </Button>
                )}
              </motion.div>
            </>
          ) : (
            <div className="p-10 text-center flex flex-col items-center justify-center gap-3 min-h-60">
              <span className="ed-roman text-h2">—</span>
              <SheetTitle className="ed-h text-h3 m-0">Página não encontrada.</SheetTitle>
              <SheetDescription className="text-(--text-3) text-caption italic max-w-[28ch]">
                Este perfil já não existe — ou nunca existiu.
              </SheetDescription>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
