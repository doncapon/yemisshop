// src/utils/logout.ts
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cart keys */
const GUEST_CART_KEY = "cart:guest:v2";
const USER_CART_KEY_PREFIX = "cart:user:";
const CART_KEY_SUFFIX = ":v2";

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

function userCartKey(userId: string) {
  return `${USER_CART_KEY_PREFIX}${userId}${CART_KEY_SUFFIX}`;
}

/** Copy current user's cart to guest cart so it persists after logout */
function migrateUserCartToGuest() {
  try {
    const uid = useAuthStore.getState().user?.id;
    if (!uid) return;

    const uKey = userCartKey(String(uid));
    const raw = localStorage.getItem(uKey);

    // If user cart exists, move/copy it to guest
    if (raw) {
      localStorage.setItem(GUEST_CART_KEY, raw);
      return;
    }

    // Fallback: if legacy cart exists, keep it too
    const legacy = localStorage.getItem("cart");
    if (legacy) localStorage.setItem(GUEST_CART_KEY, legacy);
  } catch {
    // ignore
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

  // ✅ Preserve cart BEFORE auth is cleared
  migrateUserCartToGuest();

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

    // ✅ DO NOT delete guest cart here (it is now the active cart after logout)
    // If you still want to remove legacy key, keep this:
    try {
      localStorage.removeItem("cart"); // legacy only
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