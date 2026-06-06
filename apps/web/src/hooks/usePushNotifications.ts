import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'

type PushState = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'loading'

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const existing = await navigator.serviceWorker.getRegistration('/sw.js')
    if (existing) return existing
    return await navigator.serviceWorker.register('/sw.js')
  } catch (err) {
    console.error('[SW] erro ao registrar:', err)
    return null
  }
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('loading')
  const navigate = useNavigate()

  // Verifica suporte + state inicial
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported'); return
    }
    if (Notification.permission === 'denied') { setState('denied'); return }
    (async () => {
      const reg = await getRegistration()
      if (!reg) { setState('unsupported'); return }
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'subscribed' : 'unsubscribed')
    })()
  }, [])

  // Recebe navigate + reply vindos do SW (push click + actionable)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = async (e: MessageEvent) => {
      const d = e.data
      if (!d) return
      if (d.type === 'push-navigate' && typeof d.url === 'string') {
        try { navigate(d.url) } catch {}
      }
      if (d.type === 'push-reply' && typeof d.content === 'string' && d.content.trim()) {
        try {
          if (d.channelId) {
            await api.post(`/api/channels/${d.channelId}/messages`, { content: d.content })
          } else if (d.dmConvId) {
            await api.post(`/api/dm/${d.dmConvId}/messages`, { content: d.content })
          }
        } catch (err) {
          console.error('[Push reply] falhou:', err)
        }
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [navigate])

  const subscribe = useCallback(async () => {
    setState('loading')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'unsubscribed'); return false }

      const reg = await getRegistration()
      if (!reg) { setState('unsupported'); return false }

      // Pega a public key do backend
      const r = await api.get('/api/push/vapid-public-key')
      const pub = r.data?.data?.publicKey as string | null
      if (!pub) { console.warn('[Push] backend sem VAPID key'); setState('unsupported'); return false }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pub),
      })

      const json = sub.toJSON()
      await api.post('/api/push/subscribe', {
        endpoint: sub.endpoint,
        keys:     json.keys,
      })

      setState('subscribed')
      return true
    } catch (err) {
      console.error('[Push] subscribe falhou:', err)
      setState('unsubscribed')
      return false
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setState('loading')
    try {
      const reg = await getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        const endpoint = sub.endpoint
        await sub.unsubscribe().catch(() => {})
        await api.delete(`/api/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`).catch(() => {})
      }
      setState('unsubscribed')
    } catch (err) {
      console.error('[Push] unsubscribe falhou:', err)
      setState('subscribed')
    }
  }, [])

  const sendTest = useCallback(async () => {
    try { await api.post('/api/push/test') } catch {}
  }, [])

  return { state, subscribe, unsubscribe, sendTest }
}
