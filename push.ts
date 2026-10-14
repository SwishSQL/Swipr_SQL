import { store } from './store';

// Converts the server's base64url VAPID key into the Uint8Array format
// PushManager.subscribe expects.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Registers the service worker and subscribes this browser to push
// notifications, so alerts (evaluations, swaps, leave, schedule changes...)
// arrive even when the app isn't open. No-ops if the browser lacks support,
// permission is denied, or the server has no VAPID key configured.
export async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const key = await store.getVapidPublicKey();
    if (!key) return;

    const registration = await navigator.serviceWorker.register('/sw.js');
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
    });

    await store.subscribePush(subscription.toJSON() as PushSubscriptionJSON);
  } catch (e) {
    console.error('[push] setup failed:', e);
  }
}
