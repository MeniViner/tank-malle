/* Web Push for טנק מלא. Imported into the generated service worker (vite.config.ts → workbox.importScripts).
 * The sender (scripts/push/sendPushNotifications.ts) posts JSON: { title, body, url, tag }. */
self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = { body: event.data ? event.data.text() : '' }; }
  const title = typeof message.title === 'string' && message.title ? message.title : 'טנק מלא';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof message.body === 'string' ? message.body : '',
    tag: typeof message.tag === 'string' ? message.tag : undefined,
    data: { url: typeof message.url === 'string' && message.url.startsWith('/') ? message.url : '/notifications' },
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'he',
    dir: 'rtl',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || '/notifications', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      // navigate() works only on a window this worker controls (not one opened before it took
      // over); when it is refused, open the page instead of leaving the user where they were.
      await client.focus().catch(() => {});
      try {
        if (!('navigate' in client)) throw new Error('no navigate');
        await client.navigate(url);
      } catch {
        await self.clients.openWindow(url);
      }
      return;
    }
    await self.clients.openWindow(url);
  })());
});
