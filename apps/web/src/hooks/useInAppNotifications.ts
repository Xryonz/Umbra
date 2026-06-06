/**
 * Som + Notification API local quando chega notif via socket.
 *
 *  - Som por tipo (mention/dm/reaction/reply) com fallback WebAudio beep
 *  - Respeita prefs.sounds + prefs.desktop + flag silent (DND/quiet)
 *  - Só dispara desktop notification se janela sem foco
 *  - Toca tudo via socket 'notification' (caminho novo); legacy 'mention'/'new_dm' continuam só pro caso de payload sem prefs
 */
import { useEffect, useRef } from 'react'
import { getSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/authStore'
import { useNotificationPrefs, type NotificationType } from '@/hooks/useNotifications'

// ── Sons ────────────────────────────────────────────────────────
const SOUND_BY_TYPE: Record<NotificationType, string> = {
  mention:  '/notification-mention.mp3',
  dm:       '/notification-dm.mp3',
  reaction: '/notification-soft.mp3',
  reply:    '/notification-soft.mp3',
}

const FREQ_BY_TYPE: Record<NotificationType, number> = {
  mention:  880,   // mais alto = mais urgente
  dm:       660,
  reaction: 520,
  reply:    580,
}

function playFallbackBeep(freq: number) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.value = 0.05
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    setTimeout(() => ctx.close().catch(() => {}), 250)
  } catch {}
}

const audioCache: Partial<Record<NotificationType, HTMLAudioElement>> = {}

function playPing(type: NotificationType) {
  try {
    let a = audioCache[type]
    if (!a) {
      a = new Audio(SOUND_BY_TYPE[type])
      a.volume  = 0.35
      a.preload = 'auto'
      audioCache[type] = a
    }
    const p = a.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => playFallbackBeep(FREQ_BY_TYPE[type]))
    }
  } catch {
    playFallbackBeep(FREQ_BY_TYPE[type])
  }
}

function showLocalNotification(title: string, body: string, icon?: string, url?: string) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, icon: icon ?? '/astra-logo.png', tag: url ?? 'astra' })
    n.onclick = () => {
      window.focus()
      if (url) window.location.href = url
      n.close()
    }
  } catch {}
}

// ── Hook ────────────────────────────────────────────────────────
export function useInAppNotifications() {
  const userId = useAuthStore((s) => s.user?.id)
  const { data: prefsData } = useNotificationPrefs()
  const focusedRef = useRef<boolean>(typeof document !== 'undefined' ? document.hasFocus() : true)

  // ref pra prefs frescas dentro do listener sem rebind socket
  const prefsRef = useRef(prefsData?.prefs)
  useEffect(() => { prefsRef.current = prefsData?.prefs }, [prefsData])

  useEffect(() => {
    const onFocus = () => { focusedRef.current = true }
    const onBlur  = () => { focusedRef.current = false }
    const onVis   = () => { focusedRef.current = document.visibilityState === 'visible' && document.hasFocus() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur',  onBlur)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur',  onBlur)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let sock: ReturnType<typeof getSocket>
    try { sock = getSocket() } catch { return }

    const onNotification = (p: {
      id: string
      type: NotificationType
      payload: Record<string, any>
      silent?: boolean
    }) => {
      const prefs = prefsRef.current
      // silent flag (DND/quiet hours) suprime som+banner mas feed ainda recebe
      if (p.silent) return

      // Som — respeita pref + se localStorage flag de "global mute"
      const soundsAllowed = prefs ? prefs.sounds : true
      const localMute = localStorage.getItem('astra-sound') === '0'
      if (soundsAllowed && !localMute) playPing(p.type)

      // Banner — só se janela sem foco
      const desktopAllowed = prefs ? prefs.desktop : true
      if (desktopAllowed && !focusedRef.current) {
        const { authorName, preview, channelName, serverName } = p.payload
        let title = ''
        let body  = preview ?? ''
        switch (p.type) {
          case 'mention':
            title = `${authorName ?? 'Alguém'} mencionou você`
            body  = `#${channelName ?? '?'} · ${serverName ?? '?'}\n${preview ?? ''}`
            break
          case 'dm':
            title = `${authorName ?? 'Nova DM'}`
            body  = preview ?? ''
            break
          case 'reply':
            title = `${authorName ?? 'Alguém'} respondeu você`
            body  = preview ?? ''
            break
          case 'reaction':
            title = `${authorName ?? 'Alguém'} reagiu ${p.payload.emoji ?? ''}`
            body  = preview ?? ''
            break
        }
        const url = p.type === 'dm' ? '/app/dm' : '/app'
        showLocalNotification(title, body, p.payload.authorAvatar ?? undefined, url)
      }
    }

    sock.on('notification', onNotification)
    return () => { sock.off('notification', onNotification) }
  }, [userId])
}
