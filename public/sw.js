/* RaveLampa Service Worker for Web & Mobile PWA Notifications */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'RAVELAMPA_NOTIFICATION_CLICK', data });
          return;
        }
      }
      if (self.clients.openWindow) {
        const targetUrl = data.roomCode ? `/?room=${encodeURIComponent(data.roomCode)}` : '/';
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
