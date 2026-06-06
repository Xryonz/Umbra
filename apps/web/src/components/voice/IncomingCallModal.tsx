/**
 * IncomingCallModal — PiP de chamada recebida (bottom-right, draggable).
 *
 * Diferente do modal antigo que tomava tela cheia: agora é um card flutuante
 * com mesma vibe do VoiceCallPanel — você pode continuar usando o app.
 *
 *  - Escuta socket 'dm_call_invite' (chega no user-room)
 *  - Avatar do caller + nome + countdown visual + Aceitar/Recusar
 *  - Ring tone leve (3 beeps loop) via WebAudio
 *  - Auto-dismiss em 30s sem resposta
 *  - Draggable (motion drag + localStorage persistence)
 *  - z-60 → sobre Sidebar (z-50) e PiP (que não coexiste com incoming)
 *
 * Aceitar → join('dm', convId) + emit 'dm_call_accept'
 * Recusar → emit 'dm_call_reject'
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence, useMotionValue } from 'motion/react'
import { PhoneCall, PhoneOff, GripHorizontal } from 'lucide-react'
import { getSocket } from '@/lib/socket'
import { useVoiceCall, useVoiceConfig } from '@/hooks/useVoiceCall'
import { useAuthStore } from '@/store/authStore'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { api, resolveApiUrl } from '@/lib/api'

interface IncomingCall {
  conversationId: string
  fromUserId:     string
  fromUsername:   string
  fromDisplayName: string
  expiresAt:      number
}

interface CallerLookup {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

const RING_DURATION_MS = 30_000
const POS_KEY = 'astra-incoming-pos'

function loadPos(): { x: number; y: number } {
  try {
    const v = localStorage.getItem(POS_KEY)
    if (!v) return { x: 0, y: 0 }
    const p = JSON.parse(v)
    return { x: Number(p.x) || 0, y: Number(p.y) || 0 }
  } catch { return { x: 0, y: 0 } }
}
function savePos(x: number, y: number) {
  try { localStorage.setItem(POS_KEY, JSON.stringify({ x, y })) } catch {}
}

function playRing() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const playBeep = (delay: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 740
      gain.gain.value = 0.08
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(ctx.currentTime + delay)
      osc.stop(ctx.currentTime + delay + 0.18)
    }
    playBeep(0); playBeep(0.45); playBeep(0.9)
    setTimeout(() => ctx.close().catch(() => {}), 1500)
  } catch {}
}

export function IncomingCallModal() {
  const me = useAuthStore((s) => s.user)
  const cfg = useVoiceConfig()
  const voice = useVoiceCall()
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [remaining, setRemaining] = useState(RING_DURATION_MS)
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ringRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  // Motion drag values
  const initialPos = useMemo(loadPos, [])
  const x = useMotionValue(initialPos.x)
  const y = useMotionValue(initialPos.y)

  // Avatar lookup do caller (não vem no socket, busca via API)
  const { data: caller } = useQuery<CallerLookup | null>({
    queryKey: ['voice', 'incoming-caller', incoming?.fromUserId],
    queryFn: async () => {
      if (!incoming) return null
      try {
        const res = await api.get(`/api/profile/lookup?ids=${encodeURIComponent(incoming.fromUserId)}`)
        return (res.data.data as CallerLookup[])[0] ?? null
      } catch {
        return null
      }
    },
    enabled: !!incoming,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!me) return
    let sock: ReturnType<typeof getSocket>
    try { sock = getSocket() } catch { return }

    const onInvite = (p: { conversationId: string; fromUserId: string; fromUsername: string; fromDisplayName: string }) => {
      // Já tô em call → ignora
      if (voice.state !== 'idle') return
      const expiresAt = Date.now() + RING_DURATION_MS
      setIncoming({ ...p, expiresAt })
      setRemaining(RING_DURATION_MS)
      playRing()
      ringRef.current = setInterval(() => playRing(), 3000)
      tickRef.current = setInterval(() => {
        const left = expiresAt - Date.now()
        setRemaining(Math.max(0, left))
      }, 250)
      dismissRef.current = setTimeout(() => clear(), RING_DURATION_MS)
    }

    const onCancel = () => clear()

    sock.on('dm_call_invite', onInvite)
    sock.on('dm_call_reject', onCancel)
    return () => {
      sock.off('dm_call_invite', onInvite)
      sock.off('dm_call_reject', onCancel)
    }
  }, [me, voice.state])

  const clear = () => {
    setIncoming(null)
    setRemaining(0)
    if (dismissRef.current) clearTimeout(dismissRef.current)
    if (ringRef.current)    clearInterval(ringRef.current)
    if (tickRef.current)    clearInterval(tickRef.current)
    dismissRef.current = null
    ringRef.current    = null
    tickRef.current    = null
  }

  const accept = async () => {
    if (!incoming) return
    if (!cfg.data?.enabled) return
    try {
      getSocket().emit('dm_call_accept', { conversationId: incoming.conversationId, toUserId: incoming.fromUserId })
    } catch {}
    await voice.join('dm', incoming.conversationId)
    clear()
  }

  const reject = () => {
    if (!incoming) return
    try {
      getSocket().emit('dm_call_reject', { conversationId: incoming.conversationId, toUserId: incoming.fromUserId })
    } catch {}
    clear()
  }

  const progress = incoming ? remaining / RING_DURATION_MS : 0

  return (
    <AnimatePresence>
      {incoming && (
        <motion.div
          drag
          dragMomentum={false}
          dragElastic={0.1}
          dragConstraints={{
            left:   -(window.innerWidth  - 320),
            top:    -(window.innerHeight - 280),
            right:  0,
            bottom: 0,
          }}
          style={{ x, y }}
          onDragEnd={() => savePos(x.get(), y.get())}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1,   y: 0  }}
          exit={{    opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          className="fixed bottom-safe right-safe z-60 w-60 sm:w-72 rounded-2xl bg-(--overlay) border-2 border-(--accent)/60 shadow-[0_18px_56px_-12px_var(--accent-glow)] backdrop-blur-md overflow-hidden select-none touch-none"
        >
          {/* Drag handle visual */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 text-(--text-3)/40 pointer-events-none">
            <GripHorizontal className="size-3" />
          </div>

          {/* Header com indicador pulsante */}
          <header className="px-3.5 pt-3 pb-2 border-b border-(--border) flex items-center gap-2.5 cursor-grab active:cursor-grabbing">
            <motion.span
              aria-hidden
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              className="size-2 rounded-full bg-(--accent) shrink-0"
            />
            <p className="text-[10px] font-mono text-(--accent) m-0 uppercase tracking-wider flex-1">
              Chamada recebida
            </p>
            <span className="text-[10px] font-mono text-(--text-3) tabular-nums">
              {Math.ceil(remaining / 1000)}s
            </span>
          </header>

          {/* Body: avatar grande + nome em destaque */}
          <div className="px-4 py-4 flex items-center gap-3">
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="relative shrink-0"
            >
              <Avatar className="size-14 rounded-full border-2 border-(--accent)/40 shadow-[0_0_24px_-4px_var(--accent-glow)]">
                {caller?.avatarUrl
                  ? <AvatarImage src={resolveApiUrl(caller.avatarUrl)} alt={incoming.fromDisplayName} />
                  : <AvatarFallback className="text-base font-(family-name:--font-display) bg-(--raised)">
                      {incoming.fromDisplayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>}
              </Avatar>
              <PhoneCall className="absolute -bottom-1 -right-1 size-5 p-1 rounded-full bg-(--accent) text-(--text-inv) shadow-md" />
            </motion.div>
            <div className="flex-1 min-w-0 leading-tight">
              <p
                className="text-base m-0 truncate text-foreground"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
              >
                {incoming.fromDisplayName}
              </p>
              <p className="text-[11px] font-mono text-(--text-3) m-0 truncate tracking-wide">
                @{incoming.fromUsername}
              </p>
              <p className="text-[10px] text-(--text-3) m-0 mt-0.5 italic">
                te está ligando…
              </p>
            </div>
          </div>

          {/* Progress bar (countdown visual) */}
          <div className="px-3.5 pb-2">
            <div className="h-1 rounded-full bg-(--raised) overflow-hidden">
              <motion.div
                className="h-full bg-(--accent) origin-left"
                animate={{ scaleX: progress }}
                transition={{ duration: 0.25, ease: 'linear' }}
              />
            </div>
          </div>

          {/* Buttons */}
          <footer
            className="px-3 pb-3 pt-1 flex items-center gap-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <motion.button
              type="button"
              onClick={(e) => { e.stopPropagation(); reject() }}
              onPointerDown={(e) => e.stopPropagation()}
              whileTap={{ scale: 0.93 }}
              whileHover={{ scale: 1.03 }}
              transition={{ type: 'spring', stiffness: 600, damping: 22 }}
              className="flex-1 h-10 rounded-full flex items-center justify-center gap-1.5 border-2 border-(--danger)/40 bg-(--danger)/5 text-(--danger) hover:bg-(--danger)/15 hover:border-(--danger) transition-colors cursor-pointer text-xs font-medium uppercase tracking-wider"
            >
              <PhoneOff className="size-3.5" /> Recusar
            </motion.button>
            <motion.button
              type="button"
              onClick={(e) => { e.stopPropagation(); accept() }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!cfg.data?.enabled}
              whileTap={cfg.data?.enabled ? { scale: 0.93 } : undefined}
              whileHover={cfg.data?.enabled ? { scale: 1.03 } : undefined}
              transition={{ type: 'spring', stiffness: 600, damping: 22 }}
              className="flex-1 h-10 rounded-full flex items-center justify-center gap-1.5 bg-(--accent) text-(--text-inv) hover:shadow-[0_4px_16px_-2px_var(--accent-glow)] transition-shadow cursor-pointer text-xs font-medium uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PhoneCall className="size-3.5" /> Aceitar
            </motion.button>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
