/**
 * useHoldToRecord — norma WhatsApp pro mic do composer mobile:
 * SEGURAR grava · SOLTAR envia · DESLIZAR PRA ESQUERDA cancela.
 * Tap rápido (<250ms) só mostra a dica — evita gravação acidental.
 *
 * Desktop não passa por aqui (lá o mic é clique/toggle, como sempre foi);
 * consumeTouch() deixa o caller suprimir o click sintético pós-touch.
 */
import { useRef, useState, useCallback } from 'react'
import { toast } from '@/components/ui/sonner'
import { hapticLight, hapticMedium } from '@/lib/haptics'

const HOLD_MS   = 250
const CANCEL_PX = 70

interface RecorderControls {
  start:    () => void
  cancel:   () => void
  finalize: () => void
}

export function useHoldToRecord(recorder: RecorderControls) {
  const [isHolding, setIsHolding] = useState(false)
  const timer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startX    = useRef(0)
  const recording = useRef(false)
  const canceled  = useRef(false)
  const touched   = useRef(false)

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touched.current  = true
    canceled.current = false
    startX.current   = e.touches[0].clientX
    timer.current = setTimeout(() => {
      recording.current = true
      setIsHolding(true)
      hapticMedium()
      recorder.start()
    }, HOLD_MS)
  }, [recorder])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!recording.current || canceled.current) return
    const dx = e.touches[0].clientX - startX.current
    if (dx < -CANCEL_PX) {
      canceled.current  = true
      recording.current = false
      setIsHolding(false)
      hapticLight()
      recorder.cancel()
    }
  }, [recorder])

  const onTouchEnd = useCallback(() => {
    clearTimer()
    if (recording.current && !canceled.current) {
      recorder.finalize() // soltou = envia
    } else if (!recording.current && !canceled.current) {
      toast('Segure para gravar o áudio')
    }
    recording.current = false
    setIsHolding(false)
  }, [recorder])

  const onTouchCancel = useCallback(() => {
    clearTimer()
    if (recording.current) recorder.cancel()
    recording.current = false
    canceled.current  = false
    setIsHolding(false)
  }, [recorder])

  /** true se o último gesto foi touch — caller ignora o onClick sintético */
  const consumeTouch = useCallback(() => {
    const t = touched.current
    touched.current = false
    return t
  }, [])

  return { isHolding, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, consumeTouch }
}
