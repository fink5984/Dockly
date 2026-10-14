/* Sadir service worker — push notifications only. No fetch handler and no
   caching: every page still loads fresh from the server. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(d.title || 'Sadir', {
    body: d.body || '',
    dir: 'auto',
    icon: '/brand/icon-192.png',
    badge: '/brand/badge-96.png',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url: d.url || '/app' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/app', self.location.origin)
  // Only ever open pages of this app.
  if (target.origin !== self.location.origin) return
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((w) => new URL(w.url).origin === target.origin)
    if (open) {
      await open.focus()
      try { await open.navigate(target.href); return } catch { /* not controlled by this worker */ }
    }
    await self.clients.openWindow(target.href)
  })())
})
