// src/utils/tokenWatcher.ts
let timer: number | undefined;

/**
 * Safely base64url-decodes a JWT part (adds padding if needed).
 */
function decodeJwtPart(part: string): string {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

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
    const parts = token.split(".");
    if (parts.length !== 3) return () => {}; // not a JWT? ignore

    const payloadJson = decodeJwtPart(parts[1]);
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
