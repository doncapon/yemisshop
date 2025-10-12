// src/utils/tokenWatcher.ts
let expiryTimer: number | null = null;

export function scheduleTokenExpiryLogout(token: string | null, onExpire: () => void) {
  if (expiryTimer) {
    window.clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  if (!token) return;

  try {
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    const expMs = (payload?.exp ?? 0) * 1000;
    if (!expMs) return;

    const msUntil = Math.max(0, expMs - Date.now() - 10_000); // 10s grace
    expiryTimer = window.setTimeout(() => {
      onExpire();
    }, msUntil);
  } catch {
    // ignore malformed token
  }
}
