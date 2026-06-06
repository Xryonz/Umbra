/**
 * VoiceCallPanel — PiP minimalista quando estamos numa chamada mas vendo outra coisa.
 *
 *  - Floating bottom-right, draggable (motion drag + localStorage persistence)
 *  - z-60 → sempre por cima do Sidebar (z-50) e modais regulares
 *  - Quick controls: mute, deafen, sair, expandir
 *  - Expandir → renderiza VoiceCallStage (fullscreen tile grid)
 *
 * Vibe Astra: hairline border, --accent subtle pulse no speaking,
 * mono pra status, serif display pro room name.
 */
import { useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue } from 'motion/react'
import {
  Mic, MicOff, Volume2, VolumeX, PhoneOff, Maximize2, ScreenShare, GripHorizontal,
} from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { resolveApiUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useVoiceCall, parseRoomName } from '@/hooks/useVoiceCall'
import { useUIStore } from '@/store/uiStore'
import { useUsersMini } from '@/hooks/useUsersMini'
import { VoiceCallStage } from './VoiceCallStage'

const PIP_POS_KEY = 'astra-voice-pip-pos'
function loadPos(): { x: number; y: number } {
  try {
    const v = localStorage.getItem(PIP_POS_KEY)
    if (!v) return { x: 0, y: 0 }
    const p = JSON.parse(v)
    return { x: Number(p.x) || 0, y: Number(p.y) || 0 }
  } catch { return { x: 0, y: 0 } }
}
function savePos(x: number, y: number) {
  try { localStorage.setItem(PIP_POS_KEY, JSON.stringify({ x, y })) } catch {}
}

export function VoiceCallPanel() {
  const { state, roomName, participants, error, deafened, volume, leave, toggleMic, toggleDeafen } = useVoiceCall()
  const expanded    = useUIStore((s) => s.voiceStageOpen)
  const setExpanded = useUIStore((s) => s.setVoiceStageOpen)

  // Motion values pra position persistente
  const initialPos = useMemo(loadPos, [])
  const x = useMotionValue(initialPos.x)
  const y = useMotionValue(initialPos.y)

  const identities = participants.map((p) => p.identity)
  const { data: users = [] } = useUsersMini(identities)

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const parsed  = parseRoomName(roomName)
  const localMic = participants.find((p) => p.isLocal)?.isMicEnabled ?? true
  const hasShare = participants.some((p) => p.isScreenSharing)

  if (state === 'idle') return null

  return (
    <>
      {/* ─── PiP draggable ─── */}
      <AnimatePresence>
        {!expanded && (
          <motion.div
            drag
            dragMomentum={false}
            dragElastic={0.1}
            // Constraints calculadas via window: pode arrastar até as bordas
            dragConstraints={{
              left:   -(window.innerWidth  - 320),
              top:    -(window.innerHeight - 280),
              right:  0,
              bottom: 0,
            }}
            style={{ x, y }}
            onDragEnd={() => savePos(x.get(), y.get())}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1   }}
            exit={{    opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            // bottom-right anchor + z-60 (acima do Sidebar z-50)
            // Mobile: mais estreito (w-60), safe-area-aware. Desktop: w-72.
            className="fixed bottom-safe right-safe z-60 w-60 sm:w-72 rounded-2xl bg-(--overlay) border border-(--border-mid) shadow-[0_18px_56px_-12px_rgba(0,0,0,0.85)] backdrop-blur-md overflow-hidden select-none touch-none"
          >
            {/* Drag handle bar (visualmente óbvio onde grabar) */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 text-(--text-3)/40 pointer-events-none">
              <GripHorizontal className="size-3" />
            </div>

            {/* Header */}
            <header className="px-3.5 pt-3 pb-2.5 border-b border-(--border) flex items-center gap-2.5 cursor-grab active:cursor-grabbing">
              <motion.span
                aria-hidden
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                className="size-2 rounded-full bg-(--success) shrink-0"
              />
              <div className="flex-1 min-w-0 leading-tight">
                <p className="text-xs font-(family-name:--font-display) text-foreground m-0 truncate">
                  {state === 'connecting' ? 'Conectando…'
                    : state === 'connected' ? (parsed?.kind === 'channel' ? 'Em canal de voz' : 'Em chamada DM')
                    : state === 'disconnecting' ? 'Desconectando…'
                    : 'Erro'}
                </p>
                <p className="text-[10px] font-mono text-(--text-3) m-0 truncate uppercase tracking-wider">
                  {participants.length} · ao vivo
                  {hasShare && ' · tela'}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpanded(true)
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label="Expandir"
                    className="size-7 rounded-lg border border-(--border-mid) text-(--text-2) hover:border-(--accent) hover:text-(--accent) transition-colors cursor-pointer grid place-items-center"
                  >
                    <Maximize2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Expandir chamada</TooltipContent>
              </Tooltip>
            </header>

            {error && (
              <p className="px-3.5 py-1.5 text-[11px] text-(--danger) m-0 border-b border-(--danger)/30 bg-(--danger)/5">
                {error}
              </p>
            )}

            {/* Stacked avatars */}
            <div className="px-3.5 py-3 flex items-center gap-2">
              <div className="flex -space-x-2">
                {participants.slice(0, 6).map((p) => {
                  const u = userMap.get(p.identity)
                  return (
                    <Tooltip key={p.identity}>
                      <TooltipTrigger asChild>
                        <div className="relative">
                          <Avatar
                            className={cn(
                              'size-9 rounded-full border-2 border-(--overlay) transition-transform',
                              p.isSpeaking && 'scale-110',
                            )}
                          >
                            {u?.avatarUrl
                              ? <AvatarImage src={resolveApiUrl(u.avatarUrl)} alt={u.displayName} />
                              : <AvatarFallback className="text-[10px]">
                                  {(u?.displayName ?? p.identity).slice(0, 2).toUpperCase()}
                                </AvatarFallback>}
                          </Avatar>
                          {p.isSpeaking && (
                            <motion.span
                              aria-hidden
                              animate={{ opacity: [0.2, 0.6, 0.2] }}
                              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                              className="absolute inset-0 rounded-full ring-2 ring-(--accent) pointer-events-none"
                            />
                          )}
                          {!p.isMicEnabled && (
                            <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-(--popover) border border-(--danger)/40 grid place-items-center">
                              <MicOff className="size-2 text-(--danger)" />
                            </span>
                          )}
                          {p.isScreenSharing && (
                            <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-(--popover) border border-(--accent)/40 grid place-items-center">
                              <ScreenShare className="size-2 text-(--accent)" />
                            </span>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {u?.displayName ?? p.identity.slice(0, 8)}
                        {p.isLocal && ' (você)'}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
                {participants.length > 6 && (
                  <span className="size-9 rounded-full border-2 border-(--overlay) bg-(--raised) grid place-items-center text-[10px] font-mono text-(--text-2)">
                    +{participants.length - 6}
                  </span>
                )}
              </div>
            </div>

            {/* Volume bar mini */}
            <div className="px-3.5 pb-2 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-(--raised) overflow-hidden">
                <motion.div
                  className="h-full bg-(--accent) origin-left"
                  initial={false}
                  animate={{ scaleX: deafened ? 0 : volume }}
                  transition={{ duration: 0.18 }}
                />
              </div>
              <span className="text-[10px] font-mono text-(--text-3) tabular-nums shrink-0">
                {deafened ? 'mute' : `${Math.round(volume * 100)}%`}
              </span>
            </div>

            {/* Quick controls */}
            <footer
              className="px-2.5 py-2 border-t border-(--border) flex items-center justify-center gap-1.5"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <QuickBtn
                label={localMic ? 'Mutar microfone' : 'Desmutar microfone'}
                onClick={toggleMic}
                active={!localMic}
                danger={!localMic}
              >
                {localMic ? <Mic className="size-4" /> : <MicOff className="size-4" />}
              </QuickBtn>
              <QuickBtn
                label={deafened ? 'Reabilitar áudio' : 'Mutar todos'}
                onClick={toggleDeafen}
                active={deafened}
                danger={deafened}
              >
                {deafened ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </QuickBtn>
              <QuickBtn label="Sair da chamada" onClick={leave} primary danger>
                <PhoneOff className="size-4" />
              </QuickBtn>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Stage (fullscreen) ─── */}
      <AnimatePresence>
        {expanded && (
          <VoiceCallStage onMinimize={() => setExpanded(false)} />
        )}
      </AnimatePresence>

      {/* Áudio remoto auto-attached */}
      <RemoteAudioElements />
    </>
  )
}

function QuickBtn({ label, onClick, children, danger, active, primary }: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  active?: boolean
  primary?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          whileTap={{ scale: 0.88 }}
          whileHover={{ scale: 1.06 }}
          transition={{ type: 'spring', stiffness: 600, damping: 22 }}
          className={cn(
            'size-9 rounded-full grid place-items-center border-2 transition-[background-color,border-color,color] duration-200 cursor-pointer',
            primary && danger
              ? 'border-(--danger) bg-(--danger) text-white hover:shadow-[0_4px_16px_-2px_rgba(239,68,68,0.45)]'
              : danger && active
                ? 'border-(--danger)/60 bg-(--danger)/15 text-(--danger)'
                : active
                  ? 'border-(--accent) bg-(--accent)/15 text-(--accent)'
                  : 'border-(--border-mid) bg-(--raised)/50 text-(--text-1) hover:border-(--accent) hover:text-(--accent)',
          )}
        >
          {children}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

// ─── Remote audio element manager ────────────────────────────

function RemoteAudioElements() {
  const { participants, volume, deafened } = useVoiceCall()
  const refs = useRef<Map<string, HTMLAudioElement>>(new Map())

  useEffect(() => {
    for (const p of participants) {
      if (p.isLocal) continue
      const pubs = p.participant.audioTrackPublications
      for (const pub of pubs.values()) {
        const track = pub.track
        if (!track) continue
        const key = `${p.identity}:${pub.trackSid}`
        let el = refs.current.get(key)
        if (!el) {
          el = document.createElement('audio')
          el.autoplay = true
          ;(el as any).playsInline = true
          el.setAttribute('data-astra-voice', '1')
          document.body.appendChild(el)
          refs.current.set(key, el)
        }
        // Re-aplica volume + deafened TODA hora — track.attach pode disparar reset
        // do muted/volume internamente; sincronizamos sempre. Antes só atribuíamos
        // no primeiro append, e o deafen revertia em ~1s no próximo ActiveSpeakersChanged.
        el.volume = volume
        el.muted  = deafened
        try { track.attach(el) } catch {}
      }
    }
  }, [participants, volume, deafened])

  useEffect(() => {
    for (const el of refs.current.values()) {
      el.volume = volume
      el.muted  = deafened
    }
  }, [volume, deafened])

  useEffect(() => {
    const active = new Set<string>()
    for (const p of participants) {
      if (p.isLocal) continue
      for (const pub of p.participant.audioTrackPublications.values()) {
        active.add(`${p.identity}:${pub.trackSid}`)
      }
    }
    for (const [k, el] of refs.current.entries()) {
      if (!active.has(k)) {
        el.remove()
        refs.current.delete(k)
      }
    }
  }, [participants])

  return null
}
