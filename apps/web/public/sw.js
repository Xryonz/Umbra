// Service worker do Astra — push notifications + click-to-focus + cache.
//
// Cache strategies:
//  - Assets hash-stamped (JS/CSS/img do /assets/): cache-first, immutable.
//  - HTML / shell: network-first com fallback offline.
//  - API: NUNCA cachear (sempre live).
//
// Versão bump → invalida cache antigo automaticamente.

const VERSION    = 'astra-v1'
const ASSET_RE   = /\/assets\/.+\.(js|css|woff2?|png|jpg|jpeg|svg|webp|avif|ico)$/i
const SHELL_URLS = ['/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL_URLS).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpa caches de versões antigas
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // Só GETs cross-origin? Não — apenas mesmo origin pra evitar interferir
  // com API/3rd-party/CORS.
  const url = new URL(req.url)
  if (req.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  // API: skip cache, deixa o browser e o app cuidarem.
  if (url.pathname.startsWith('/api/')) return
  // /uploads/: deixa o browser fazer (são grandes, cache abuso de quota).
  if (url.pathname.startsWith('/uploads/')) return

  // Asset hash-stamped: cache-first (imutável)
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) => hit ?? fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => {})
          }
          return res
        }).catch(() => caches.match('/'))
      )
    )
    return
  }

  // HTML / restante: network-first, fallback cache
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
        const clone = res.clone()
        caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => {})
      }
      return res
    }).catch(() => caches.match(req).then((hit) => hit ?? caches.match('/')))
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { title: 'Astra', body: event.data ? event.data.text() : '' } }

  const title   = payload.title || 'Astra'
  // Actions só funcionam em payload.actionable=true (msg/DM) — evita poluir
  // notif de friend request, system, etc. Browser support: Chrome/Edge full,
  // Firefox limitado, Safari ignora.
  const actions = payload.actionable
    ? [
        { action: 'open',  title: 'Abrir' },
        { action: 'reply', title: 'Responder', type: 'text', placeholder: 'Digite…' },
      ]
    : undefined

  const options = {
    body:        payload.body  || '',
    icon:        payload.icon  || '/astra-logo.png',
    badge:       '/astra-logo.png',
    tag:         payload.tag   || 'astra',
    renotify:    !!payload.renotify,
    data:        {
      url:       payload.url || '/',
      channelId: payload.channelId ?? null,
      dmConvId:  payload.dmConvId  ?? null,
    },
    actions,
    timestamp:   Date.now(),
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const targetUrl = data.url || '/'

  // Reply inline: action.text vem em event.reply (Chrome/Edge). Posta pro
  // backend via fetch — SW pode chamar API direto (mesmo origin).
  if (event.action === 'reply' && event.reply && (data.channelId || data.dmConvId)) {
    event.waitUntil((async () => {
      try {
        // SW não tem acesso ao token JWT (vive na memória do client). Posta
        // num endpoint que valida via cookie de sessão OU dispara um message
        // pro client pra ele enviar.
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const c of clients) {
          c.postMessage({
            type:      'push-reply',
            channelId: data.channelId,
            dmConvId:  data.dmConvId,
            content:   event.reply,
          })
        }
        // Sem clients: abre janela (não consegue enviar imediato — guarda intent?)
        if (clients.length === 0 && self.clients.openWindow) {
          await self.clients.openWindow(targetUrl)
        }
      } catch {}
    })())
    return
  }

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      try {
        const u = new URL(client.url)
        if (u.origin === self.location.origin && 'focus' in client) {
          await client.focus()
          client.postMessage({ type: 'push-navigate', url: targetUrl })
          return
        }
      } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl)
  })())
})
