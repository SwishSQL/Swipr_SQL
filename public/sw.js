// Swipr service worker — shows OS-level notifications pushed from the server,
// even when no tab is open. Registered from App.tsx after login.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = { title: 'Swipr', body: '', type: 'general' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch { /* ignore malformed payload */ }

  const isCall = payload.type === 'call';
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Swipr', {
      body: payload.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      // Tagged by callId (not just "call") so a second push for the same
      // call — e.g. a retry — replaces the first instead of stacking, but a
      // second unrelated call still gets its own notification.
      tag: isCall ? `call-${payload.callId}` : (payload.type || 'general'),
      requireInteraction: isCall,
      // The server re-sends the call push while it rings; renotify makes each
      // one alert again instead of silently replacing the last, which is the
      // closest the web gets to a ringtone. Vibration carries it when the
      // phone is on silent.
      renotify: isCall,
      silent: false,
      vibrate: isCall ? [400, 200, 400, 200, 400] : [200],
      data: { url: isCall ? `/#/call/${payload.callId}` : '/', ...payload },
      // Answer/decline right from the lock screen, no need to open the app first.
      actions: isCall ? [
        { action: 'answer', title: 'Answer' },
        { action: 'decline', title: 'Decline' },
      ] : [],
    })
  );
});

// Brings the app to the front on the call, whether the tap landed on the
// notification body or the Answer button. Both used to share this code, but
// nothing was awaited: tapping the body worked because the browser fronts the
// app itself, while the Answer button relied entirely on a focus() call the
// service worker could be killed before finishing.
async function openCall(url) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of clients) {
    try {
      // Navigate first so the page is already on the call when it appears, and
      // only when it isn't there yet — navigating a client to its current URL
      // reloads it and would throw away a call already in progress.
      if ('navigate' in client && !client.url.includes(url)) {
        await client.navigate(url);
      }
      if ('focus' in client) await client.focus();
      return;
    } catch {
      // navigate() rejects for clients this worker doesn't control; try the
      // next one, and fall through to opening a fresh window.
    }
  }

  if (self.clients.openWindow) await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};

  // Decline needs no page at all — post it directly from here using the
  // single-use token the push carried, so it works even if the phone is
  // locked and the user never actually opens the app.
  // Only an exact 'decline' hangs up. Anything else — the body, the Answer
  // button, or an action id this browser reports differently — opens the call,
  // because wrongly hanging up on someone is the worse failure. The reported
  // action is sent along so the server log shows what actually arrived.
  if (data.type === 'call' && event.action === 'decline') {
    event.notification.close();
    event.waitUntil(
      fetch('/api/calls/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: data.callId, token: data.declineToken, action: String(event.action) }),
      }).catch(() => { /* best-effort — nothing more we can do offline */ })
    );
    return;
  }

  if (data.type === 'call') {
    // Report what this browser called the tap, so a mismatch is visible in the
    // log instead of having to be inferred from behaviour.
    event.waitUntil(
      fetch('/api/calls/answer-tap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: data.callId, token: data.declineToken, action: String(event.action || '') }),
      }).catch(() => {})
    );
  }

  event.notification.close();
  event.waitUntil(openCall(data.url || '/'));
});
