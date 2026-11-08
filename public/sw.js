/* RaveLampa Service Worker for Real-Time Web Push & Mobile PWA Notifications */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'RaveLampa', body: event.data ? event.data.text() : 'Новое сообщение' };
  }

  const title = payload.title || 'oulo';
  const options = {
    body: payload.body || 'Новое сообщение',
    tag: payload.tag || ('oulo-push-' + Date.now()),
    data: payload.data || {},
    renotify: false
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      let anyVisible = false;
      for (const client of clientList) {
        if (client.visibilityState === 'visible' || client.focused) {
          anyVisible = true;
        }
        client.postMessage({ type: 'RAVELAMPA_PUSH_EVENT', payload });
      }
      // Do not show OS/iPhone system push banner if user is currently inside the app
      if (anyVisible) {
        return Promise.resolve();
      }
      return self.registration.showNotification(title, options);
    })
  );
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
