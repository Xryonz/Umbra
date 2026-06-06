// Service worker do Astra — push notifications + click-to-focus.
// Versão simples: sem cache de assets, só recebe push e abre janela.

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { title: 'Astra', body: event.data ? event.data.text() : '' } }

  const title   = payload.title || 'Astra'
  const options = {
    body:        payload.body  || '',
    icon:        payload.icon  || '/astra-logo.png',
    badge:       '/astra-logo.png',
    tag:         payload.tag   || 'astra',
    renotify:    !!payload.renotify,
    data:        { url: payload.url || '/' },
    timestamp:   Date.now(),
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Reusa janela existente se houver
    for (const client of all) {
      try {
        const u = new URL(client.url)
        if (u.origin === self.location.origin && 'focus' in client) {
          await client.focus()
          // Pede pro front navegar pra rota desejada
          client.postMessage({ type: 'push-navigate', url: targetUrl })
          return
        }
      } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl)
  })())
})
