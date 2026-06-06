/**
 * useAudioRecorder — controla MediaRecorder + analyser, stateless UI.
 *
 * API:
 *  - state: 'idle' | 'recording' | 'paused' | 'uploading'
 *  - elapsed: ms desde start (somando pauses, exclui pauses internos)
 *  - bars: array com amplitude visual (16 bins)
 *  - start(): pede mic + começa
 *  - pause()/resume(): pausa/retoma sem perder buffer
 *  - finalize(): para gravação + upload + entrega Attachment
 *  - cancel(): para gravação, descarta tudo
 *  - error: mensagem se falhou
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { Attachment } from '@astra/types'

const MAX_DURATION_MS = 60_000
const BAR_COUNT       = 16

type State = 'idle' | 'recording' | 'paused' | 'uploading'

export function useAudioRecorder(onRecorded: (att: Attachment) => void) {
  const [state,   setState]   = useState<State>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [bars,    setBars]    = useState<number[]>(Array(BAR_COUNT).fill(0.1))
  const [error,   setError]   = useState<string | null>(null)

  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const streamRef    = useRef<MediaStream | null>(null)
  const startTsRef   = useRef<number>(0)
  /** Total ms acumulados antes do pause atual. Usado pra elapsed correto. */
  const accumMsRef   = useRef<number>(0)
  const rafRef       = useRef<number | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const analyserRef  = useRef<AnalyserNode | null>(null)
  const cancelledRef = useRef(false)

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    analyserRef.current = null
    chunksRef.current   = []
    accumMsRef.current  = 0
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  const tick = useCallback(() => {
    if (!analyserRef.current) return
    const now = Date.now()
    const totalMs = accumMsRef.current + (startTsRef.current ? now - startTsRef.current : 0)
    setElapsed(totalMs)
    if (totalMs >= MAX_DURATION_MS) {
      // hard-stop ao bater o cap
      recorderRef.current?.stop()
      return
    }
    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(data)
    const sample = Array.from({ length: BAR_COUNT }, (_, i) => {
      const idx = Math.floor(i * data.length / BAR_COUNT)
      return Math.max(0.1, data[idx] / 255)
    })
    setBars(sample)
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const upload = useCallback(async (blob: Blob, durationSec: number) => {
    setState('uploading')
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
      const fd  = new FormData()
      fd.append('files', blob, `voice-${Date.now()}.${ext}`)
      const res = await api.post('/api/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const att = res.data?.data?.attachments?.[0]
      if (!att) throw new Error('upload sem resposta')
      onRecorded({ ...att, duration: durationSec } as any)
      setState('idle')
      setElapsed(0)
    } catch (e: any) {
      const errMsg = e?.response?.data?.error ?? e?.message ?? 'Falha ao enviar áudio'
      console.error('[useAudioRecorder upload]', errMsg, e?.response?.data)
      setError(errMsg)
      setState('idle')
    }
  }, [onRecorded])

  const start = useCallback(async () => {
    if (state !== 'idle') return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

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
        // Soma o que faltava do segmento atual (caso não estava pausado)
        if (startTsRef.current) {
          accumMsRef.current += Date.now() - startTsRef.current
          startTsRef.current = 0
        }
        if (cancelledRef.current) {
          cancelledRef.current = false
          cleanup()
          setState('idle')
          setElapsed(0)
          return
        }
        const blob       = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const durationS  = Math.round(accumMsRef.current / 1000)
        const finalChunks = chunksRef.current.slice()
        cleanup()
        // upload usa a blob; chunks já zeradas em cleanup, então criamos antes
        const finalBlob = new Blob(finalChunks, { type: rec.mimeType || 'audio/webm' })
        await upload(finalBlob, durationS)
        // referência simbólica pra agradar TS sobre `blob`
        void blob
      }
      rec.start(100)
      recorderRef.current = rec
      startTsRef.current  = Date.now()
      accumMsRef.current  = 0
      setState('recording')
      setElapsed(0)
      rafRef.current = requestAnimationFrame(tick)
    } catch (e: any) {
      setError(e?.message ?? 'Microfone indisponível')
      setState('idle')
      cleanup()
    }
  }, [state, tick, upload, cleanup])

  const pause = useCallback(() => {
    if (state !== 'recording' || !recorderRef.current) return
    if (recorderRef.current.state !== 'recording') return
    recorderRef.current.pause()
    // Soma elapsed do segmento atual no acumulador
    if (startTsRef.current) {
      accumMsRef.current += Date.now() - startTsRef.current
      startTsRef.current = 0
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setState('paused')
  }, [state])

  const resume = useCallback(() => {
    if (state !== 'paused' || !recorderRef.current) return
    if (recorderRef.current.state !== 'paused') return
    recorderRef.current.resume()
    startTsRef.current = Date.now()
    setState('recording')
    rafRef.current = requestAnimationFrame(tick)
  }, [state, tick])

  const finalize = useCallback(() => {
    if (!recorderRef.current) return
    if (recorderRef.current.state === 'inactive') return
    cancelledRef.current = false
    recorderRef.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    } else {
      cleanup()
      setState('idle')
      setElapsed(0)
    }
  }, [cleanup])

  return {
    state, elapsed, bars, error,
    start, pause, resume, finalize, cancel,
    isActive: state === 'recording' || state === 'paused' || state === 'uploading',
  }
}
