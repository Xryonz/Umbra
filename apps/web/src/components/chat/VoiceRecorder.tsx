/**
 * VoiceRecorder — botão mic. Click = start, click again = stop+upload.
 *
 *  - Usa MediaRecorder API (webm opus default; fallback mp4)
 *  - Limite client-side 60s de gravação (cap server-side é o multer 50MB)
 *  - Mostra timer + bolinha pulsante enquanto grava
 *  - Onda fake: barras animadas refletindo amplitude via AnalyserNode
 *
 * onRecorded recebe Attachment já uploaded (url, type, name, size, duration).
 */
import { useEffect, useRef, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { api, resolveApiUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Attachment } from '@umbra/types'

const MAX_DURATION_MS = 60_000  // 60s
const BAR_COUNT       = 16

export function VoiceRecorder({ disabled, onRecorded }: {
  disabled?: boolean
  onRecorded: (att: Attachment) => void
}) {
  const [state,     setState]     = useState<'idle' | 'recording' | 'uploading'>('idle')
  const [elapsed,   setElapsed]   = useState(0)
  const [bars,      setBars]      = useState<number[]>(Array(BAR_COUNT).fill(0.1))
  const [error,     setError]     = useState<string | null>(null)

  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const streamRef    = useRef<MediaStream | null>(null)
  const startTsRef   = useRef<number>(0)
  const rafRef       = useRef<number | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const analyserRef  = useRef<AnalyserNode | null>(null)
  const cancelledRef = useRef(false)

  const cleanup = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    analyserRef.current = null
  }

  useEffect(() => () => cleanup(), [])

  const start = async () => {
    if (disabled) return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // WebAudio pra capturar amplitude → barras
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      const src = ctx.createMediaStreamSource(stream)
      src.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        if (cancelledRef.current) { cancelledRef.current = false; chunksRef.current = []; cleanup(); setState('idle'); return }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const duration = Math.round((Date.now() - startTsRef.current) / 1000)
        cleanup()
        await upload(blob, duration)
      }
      rec.start(100)
      recorderRef.current = rec
      startTsRef.current  = Date.now()
      setState('recording')
      setElapsed(0)

      const tick = () => {
        const ms = Date.now() - startTsRef.current
        setElapsed(ms)
        if (ms >= MAX_DURATION_MS) { rec.stop(); return }
        // Sample amplitude
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        const sample = Array.from({ length: BAR_COUNT }, (_, i) => {
          const idx = Math.floor(i * data.length / BAR_COUNT)
          return Math.max(0.1, data[idx] / 255)
        })
        setBars(sample)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e: any) {
      setError(e?.message ?? 'mic indisponível')
      setState('idle')
      cleanup()
    }
  }

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }

  const cancel = () => {
    cancelledRef.current = true
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    } else {
      cleanup()
      setState('idle')
    }
  }

  const upload = async (blob: Blob, durationSec: number) => {
    setState('uploading')
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
      const fd = new FormData()
      // Server espera field 'files' (multer.array). Multipart precisa filename na 3ª arg
      // pra o multer mapear extension corretamente.
      fd.append('files', blob, `voice-${Date.now()}.${ext}`)
      const res = await api.post('/api/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      // Server retorna { data: { attachments: [{ url, type, name, size }] } }
      const att = res.data?.data?.attachments?.[0]
      if (!att) throw new Error('upload sem resposta')
      onRecorded({ ...att, duration: durationSec } as any)
      setState('idle')
    } catch (e: any) {
      const errMsg = e?.response?.data?.error ?? e?.message ?? 'upload falhou'
      console.error('[VoiceRecorder upload]', errMsg, e?.response?.data)
      setError(errMsg)
      setState('idle')
    }
  }

  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        title="Gravar áudio"
        aria-label="Gravar áudio"
        className={cn(
          'shrink-0 size-7 grid place-items-center transition-colors',
          disabled ? 'text-(--text-3) opacity-50' : 'text-(--text-3) hover:text-(--accent)',
        )}
      >
        <Mic className="size-4" />
      </button>
    )
  }

  if (state === 'uploading') {
    return (
      <div className="shrink-0 flex items-center gap-1.5 px-2 h-7 text-xs text-(--text-3)">
        <span className="size-3 border-2 border-(--border-mid) border-t-(--accent) rounded-full animate-spin" />
        enviando
      </div>
    )
  }

  // Recording
  const secs = Math.floor(elapsed / 1000)
  return (
    <div className="shrink-0 flex items-center gap-2 px-2 h-7 border border-(--accent)/40 bg-(--accent)/5">
      <span className="size-2 rounded-full bg-(--danger) animate-pulse" aria-hidden />
      <div className="flex items-center gap-px h-4">
        {bars.map((v, i) => (
          <div
            key={i}
            className="w-0.5 bg-(--accent) transition-all"
            style={{ height: `${Math.max(15, v * 100)}%` }}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums text-(--accent)">
        {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}
      </span>
      <button type="button" onClick={stop} title="Enviar" className="text-(--accent) hover:opacity-80">
        <Square className="size-3.5" />
      </button>
      <button type="button" onClick={cancel} title="Cancelar" className="text-(--text-3) hover:text-(--danger)">
        <X className="size-3.5" />
      </button>
      {error && <span className="text-[10px] text-(--danger) ml-1">{error}</span>}
    </div>
  )
}

/**
 * Player de mensagem de voz. Renderiza barras decorativas estáticas + nativo.
 * Usado em MessageItem quando attachment.type começa com 'audio/'.
 */
export function VoiceMessage({ url, duration }: { url: string; duration?: number }) {
  const [playing, setPlaying] = useState(false)
  const [pos,     setPos]     = useState(0)
  const [total,   setTotal]   = useState(duration ?? 0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Barras decorativas pseudo-aleatórias (determinístico pela URL pra parecer estável)
  const bars = (() => {
    let seed = 0
    for (const c of url) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
    return Array.from({ length: 32 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return 0.3 + (seed % 70) / 100
    })
  })()

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) audioRef.current.pause()
    else         audioRef.current.play().catch(() => {})
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const r = Math.floor(s % 60)
    return `${m}:${String(r).padStart(2, '0')}`
  }

  const progressIdx = total > 0 ? Math.floor((pos / total) * bars.length) : 0

  return (
    <div className="my-1 inline-flex items-center gap-3 px-3 py-2 rounded-xl border border-(--border) bg-(--raised)/40 max-w-90">
      <button
        onClick={toggle}
        className="shrink-0 size-9 grid place-items-center rounded-full border border-(--accent) text-(--accent) hover:bg-(--accent) hover:text-(--accent-foreground) transition-colors"
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        )}
      </button>

      <div className="flex items-end gap-px h-6 flex-1">
        {bars.map((v, i) => (
          <div
            key={i}
            className={cn('w-0.5 transition-colors', i < progressIdx ? 'bg-(--accent)' : 'bg-(--text-3)/40')}
            style={{ height: `${v * 100}%` }}
          />
        ))}
      </div>

      <span className="text-[11px] tabular-nums text-(--text-3) shrink-0">
        {fmt(playing || pos > 0 ? pos : total)}
      </span>

      <audio
        ref={audioRef}
        src={resolveApiUrl(url)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0) }}
        onLoadedMetadata={(e) => { if (!duration) setTotal((e.target as HTMLAudioElement).duration) }}
        onTimeUpdate={(e) => setPos((e.target as HTMLAudioElement).currentTime)}
      />
    </div>
  )
}
