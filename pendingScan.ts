// A scanned attendance code held across a login round-trip.
//
// The code itself is only valid for 30 seconds server-side, so a stored one is
// worth keeping just long enough to sign in with. Without an expiry, a code
// abandoned mid-login would sit in storage forever and silently redirect every
// later login to the scan screen.
const KEY = 'swipr_pending_scan';
const MAX_AGE_MS = 5 * 60 * 1000;

export function setPendingScan(code: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch { /* ignore */ }
}

export function getPendingScan(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw);
    if (!code || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) {
      clearPendingScan();
      return null;
    }
    return code;
  } catch {
    clearPendingScan();
    return null;
  }
}

export function clearPendingScan() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
