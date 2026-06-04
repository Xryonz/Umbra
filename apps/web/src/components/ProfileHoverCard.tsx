/**
 * ProfileHoverCard — mini-card em hover de @mentions/avatares.
 *
 * Compartilha ProfileHero + ProfileBanner com ProfileCard pra consistência
 * visual. Fetch lazy: query só dispara quando hover abre (delay 350ms Radix).
 *
 * Uso:
 *   <ProfileHoverCard username="maria"><span>@maria</span></ProfileHoverCard>
 *   <ProfileHoverCard userId="abc"><Avatar/></ProfileHoverCard>
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { motion } from 'motion/react'

import { api } from '@/lib/api'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { ProfileBanner } from '@/components/profile/ProfileBanner'
import { ProfileHero } from '@/components/profile/ProfileHero'
import { type DisplayFont } from '@/components/profile/profileFonts'
import { type UserStatus } from '@/components/StatusDot'

interface ProfileMini {
  id:               string
  username:         string
  displayName:      string
  avatarUrl:        string | null
  bio:              string | null
  bannerUrl:        string | null
  bannerColor:      string | null
  profileTheme?:    string | null
  bannerPositionY?: number
  bannerScale?:     number
  pronouns?:        string | null
  statusEmoji?:     string | null
  displayFont?:     DisplayFont
  customStatus?:    string | null
  isBot:            boolean
  effectiveStatus?: UserStatus
}

const PALETTE = ['#c9a96e','#7c6fc4','#6fa8c9','#c97c6e','#6ec98a']
function userColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const FALLBACK = 'linear-gradient(135deg,#1a1a2e,#16213e)'

interface Props {
  /** Use username OU userId — não os dois. */
  username?: string
  userId?:   string
  children:  React.ReactNode
  side?:     'top' | 'right' | 'bottom' | 'left'
  align?:    'start' | 'center' | 'end'
}

export function ProfileHoverCard({ username, userId, children, side = 'top', align = 'start' }: Props) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const key = username ?? userId
  const { data, isLoading } = useQuery<ProfileMini>({
    queryKey: ['profile-mini', key],
    queryFn:  async () => {
      if (username) return (await api.get(`/api/profile/by-username/${username}`)).data.data
      return (await api.get(`/api/profile/${userId}`)).data.data.user
    },
    enabled:   open && !!key,
    staleTime: 5 * 60_000,
  })

  const startDM = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!data) return
    try {
      const res = await api.post('/api/dm/open', { userId: data.id })
      navigate('/app/dm', {
        state: {
          conversationId: res.data.data.conversationId as string,
          otherUser: {
            id:          data.id,
            username:    data.username,
            displayName: data.displayName,
            avatarUrl:   data.avatarUrl,
          },
        },
      })
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Erro ao abrir DM')
    }
  }

  const accentColor = data?.id ? userColor(data.id) : '#c9a96e'

  return (
    <HoverCard openDelay={350} closeDelay={120} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>

      <HoverCardContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-96 p-0 overflow-hidden rounded-2xl backdrop-blur-md z-9999 shadow-3 border-(--border-bright)"
        style={{ background: data?.profileTheme || 'var(--overlay)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Banner — h-28 (vs h-48 do card cheio). Mais alto que h-16 antigo
              pra avatar -mt-12 não cortar contra topo do HoverCardContent. */}
          <div className="relative h-28 overflow-hidden">
            <ProfileBanner
              bannerUrl={data?.bannerUrl}
              bannerColor={data?.bannerColor}
              fallbackGradient={FALLBACK}
              positionY={data?.bannerPositionY}
              scale={data?.bannerScale}
            />
          </div>

          <div className="px-5 pb-5 -mt-6">
            {isLoading || !data ? (
              <HoverCardSkeleton />
            ) : (
              <>
                <ProfileHero
                  avatarUrl={data.avatarUrl}
                  displayName={data.displayName}
                  username={data.username}
                  pronouns={data.pronouns}
                  statusEmoji={data.statusEmoji}
                  displayFont={data.displayFont}
                  effectiveStatus={data.effectiveStatus}
                  isBot={data.isBot}
                  accentColor={accentColor}
                />

                {data.bio && (
                  <p className="text-sm text-(--text-2) mt-3 mb-3 line-clamp-3 leading-relaxed">
                    {data.bio}
                  </p>
                )}

                {!data.isBot && (
                  <Button
                    onClick={startDM}
                    variant="secondary"
                    className="w-full gap-2 h-9 text-sm rounded-lg mt-2"
                  >
                    <MessageCircle className="size-3.5" /> Enviar DM
                  </Button>
                )}
              </>
            )}
          </div>
        </motion.div>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * Skeleton inline do hover — reproduz silhueta do ProfileHero (avatar
 * overlap + nome + handle + bio + botão) pra evitar layout shift e
 * spinner desbalanceado no canto.
 */
function HoverCardSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Avatar circle — sobrepõe banner mantendo proporção do ProfileHero real */}
      <div
        className="size-24 rounded-full -mt-12 mb-3 border-4 bg-(--raised)"
        style={{ borderColor: 'var(--overlay)' }}
      />
      {/* Nome */}
      <div className="h-6 w-40 rounded bg-(--raised) mb-2" />
      {/* Handle + status */}
      <div className="h-3 w-28 rounded bg-(--raised) mb-3" />
      {/* Bio 2 linhas */}
      <div className="h-3 w-full rounded bg-(--raised) mb-1.5" />
      <div className="h-3 w-2/3 rounded bg-(--raised) mb-3" />
      {/* Botão DM */}
      <div className="h-9 w-full rounded-lg bg-(--raised) mt-2" />
    </div>
  )
}
