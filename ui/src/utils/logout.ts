// src/utils/logout.ts
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cart keys */
const GUEST_CART_KEY = "cart:guest:v2";
// NOTE: we intentionally do NOT delete user carts on logout.
// const USER_CART_KEY_PREFIX = "cart:user:";
// const CART_KEY_SUFFIX = ":v2";

const LAST_LOGOUT_AT_KEY = "auth:lastLogoutAt";

/** Mark a logout so bootstrap/me checks don't instantly "re-log you in" for a second */
export function markJustLoggedOut() {
  try {
    sessionStorage.setItem(LAST_LOGOUT_AT_KEY, String(Date.now()));
  } catch {}
}

/** True if user logged out within the last `ms` */
export function wasJustLoggedOut(ms = 3000) {
  try {
    const raw = sessionStorage.getItem(LAST_LOGOUT_AT_KEY);
    const t = raw ? Number(raw) : 0;
    if (!Number.isFinite(t) || t <= 0) return false;
    return Date.now() - t < ms;
  } catch {
    return false;
  }
}

async function tryServerLogout() {
  // survive any baseURL config
  const urls = ["/auth/logout", "/api/auth/logout"];
  for (const url of urls) {
    try {
      await api.post(url, {}, { withCredentials: true });
      return;
    } catch {
      // try next
    }
  }
}

export async function performLogout(redirectTo = "/", navigate?: NavigateFn) {
  // ✅ IMPORTANT: mark first so any immediate bootstrap() sees it
  markJustLoggedOut();

  const st = useAuthStore.getState();

  try {
    // best-effort cookie clear (don’t block UX)
    await Promise.race([tryServerLogout(), sleep(800)]);
  } finally {
    // ✅ Clear auth state
    try {
      st.clear?.();
    } catch {}
    try {
      useAuthStore.setState({ user: null } as any);
    } catch {}

    // ✅ Clear ONLY guest cart + legacy cart.
    // Keep user cart in localStorage so logging back in restores items.
    try {
      localStorage.removeItem(GUEST_CART_KEY);
      localStorage.removeItem("cart"); // legacy
      window.dispatchEvent(new Event("cart:updated"));
    } catch {}

    // ✅ Clear persisted auth snapshot keys (safe)
    try {
      localStorage.removeItem("auth_store_v1");
      sessionStorage.removeItem("auth_store_v1");
    } catch {}

    // ✅ Redirect
    if (navigate) {
      navigate(redirectTo, { replace: true });
      return;
    }
    window.location.assign(redirectTo);
  }
}