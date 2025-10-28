let timer: number | undefined;

/**
 * Schedules a logout callback shortly before a JWT expires.
 * Returns a cancel function.
 */
export function scheduleTokenExpiryLogout(
  token: string | null | undefined,
  onExpire: () => void
) {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (!token) return () => {};

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return () => {}; // not a JWT? ignore
    const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as { exp?: number };

    const expMs = (payload.exp ?? 0) * 1000;
    const delay = Math.max(0, expMs - Date.now() - 5000); // 5s early

    if (delay > 0) {
      // @ts-ignore — Node vs DOM typings
      timer = setTimeout(() => {
        timer = undefined;
        onExpire();
      }, delay);
    } else {
      onExpire(); // already expired
    }
  } catch {
    // If decode fails, do nothing — don’t kill the session
  }

  return () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
}
