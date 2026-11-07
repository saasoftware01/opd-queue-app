self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = event.data.json();
  const options = {
    body: payload.body || 'Your token has been called.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: `opd-token-${payload.tokenNumber || 'called'}`,
    silent: true,
    data: { url: payload.url || '/book' },
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'It’s your turn', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/book', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existingClient) {
        existingClient.navigate(destination);
        return existingClient.focus();
      }
      return self.clients.openWindow(destination);
    })
  );
});
