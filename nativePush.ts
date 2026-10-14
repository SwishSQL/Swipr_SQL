import { store } from './store';
import { requestJoinCall } from './calling';

// Web Push (push.ts) only works inside an actual mobile browser tab — a
// Capacitor-wrapped WebView cannot register a service worker push
// subscription the way a browser can. Reaching a closed native app needs
// Firebase Cloud Messaging instead, which is a different delivery channel
// end to end: a different registration API here, a different token shape,
// and the server sends to it separately (see registerFcmToken in store.ts).
//
// Everything in this module is a no-op outside the native Android app —
// Capacitor.isNativePlatform() is false on the website, so none of this runs
// there and the web push path (push.ts) is untouched.
export async function enableNativePush(): Promise<void> {
  let Capacitor: typeof import('@capacitor/core').Capacitor;
  let PushNotifications: typeof import('@capacitor/push-notifications').PushNotifications;
  try {
    ({ Capacitor } = await import('@capacitor/core'));
    if (!Capacitor.isNativePlatform()) return;
    ({ PushNotifications } = await import('@capacitor/push-notifications'));
  } catch {
    // The plugin isn't bundled in the website build, so this import fails
    // there — that's expected, not an error worth surfacing.
    return;
  }

  try {
    const status = await PushNotifications.checkPermissions();
    if (status.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') return;
    }

    await PushNotifications.removeAllListeners();

    PushNotifications.addListener('registration', (token) => {
      store.registerFcmToken(token.value).catch(() => { /* best-effort */ });
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[native-push] registration failed:', err);
    });

    // Tapping a call notification while the app was backgrounded or closed.
    // The system tray already handled showing it — this only has to route the
    // now-foregrounded app to the right call, the native-side equivalent of
    // sw.js's notificationclick handler.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification.data as Record<string, string> | undefined;
      if (data?.type === 'call' && data.callId) requestJoinCall(data.callId);
    });

    // A push that arrives while the app is already open and connected is
    // redundant — the WebSocket in calling.tsx already delivered call:incoming
    // in real time, and showing a second system notification on top of the
    // in-app ring would just be noise.

    await PushNotifications.register();
  } catch (e) {
    console.error('[native-push] setup failed:', e);
  }
}
