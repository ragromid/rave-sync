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
          client.postMessage({ type: 'RAVELAMPA_PUSH_EVENT', payload });
        } else {
          // Only pass message IDs so backgrounded page marks them as already notified by OS Push
          client.postMessage({
            type: 'RAVELAMPA_PUSH_SILENT_ACK',
            tag: options.tag,
            msgId: payload.msg?.id || null
          });
        }
      }
      // Do not show OS/iPhone system push banner if user is currently inside the app
      if (anyVisible) {
        return Promise.resolve();
      }
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_NOTIFICATIONS') {
    if (self.registration && typeof self.registration.getNotifications === 'function') {
      self.registration.getNotifications().then((list) => {
        for (const n of list) {
          try { n.close(); } catch {}
        }
      }).catch(() => {});
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Also close any other notifications from the same sender/room
  if (self.registration && typeof self.registration.getNotifications === 'function') {
    self.registration.getNotifications().then((list) => {
      for (const n of list) {
        try { n.close(); } catch {}
      }
    }).catch(() => {});
  }

  const data = event.notification.data || {};
  let targetUrl = '/';
  if (data.friendId) {
    targetUrl = `/?dm=${encodeURIComponent(data.friendId)}`;
  } else if (data.roomCode) {
    targetUrl = `/?room=${encodeURIComponent(data.roomCode)}${data.openChat ? '&tab=chat' : ''}`;
  } else if (data.view) {
    targetUrl = `/?view=${encodeURIComponent(data.view)}`;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          client.postMessage({ type: 'RAVELAMPA_NOTIFICATION_CLICK', data });
        } catch {}
        if ('focus' in client) {
          return client.focus().catch(() => {
            if ('navigate' in client) return client.navigate(targetUrl);
          });
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
