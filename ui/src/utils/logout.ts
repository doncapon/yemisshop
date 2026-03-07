// src/utils/logout.ts
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import { readCartLines } from "./cartModel";

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

type LocalCartLine = {
  id?: string;
  productId: string;
  variantId?: string | null;
  supplierId?: string | null;
  qty: number;
  kind?: "BASE" | "VARIANT";
  optionsKey?: string | null;
};

function getActiveUserId() {
  return String(useAuthStore.getState().user?.id ?? "");
}

/**
 * Snapshot the currently active browser cart while auth still exists.
 * This is the cart we want to sync to the server before logout.
 */
function readBrowserCartSnapshot(): LocalCartLine[] {
  try {
    const lines = readCartLines() as LocalCartLine[];
    if (!Array.isArray(lines)) return [];
    return lines.filter((l) => l && l.productId && Number(l.qty) > 0);
  } catch {
    return [];
  }
}

/**
 * Best-effort server cart sync before logout.
 * Replace URL list with your real cart endpoint if needed.
 */
async function pushBrowserCartToServer(lines: LocalCartLine[]) {
  if (!Array.isArray(lines) || !lines.length) return;

  const items = lines
    .filter((l) => l && l.productId && Number(l.qty) > 0)
    .map((l) => ({
      productId: String(l.productId),
      variantId: l.variantId ?? null,
      supplierId: l.supplierId ?? null,
      qty: Math.max(1, Number(l.qty) || 1),
      kind: l.kind ?? (l.variantId ? "VARIANT" : "BASE"),
      optionsKey: l.optionsKey ?? null,
    }));

  if (!items.length) return;

  const urls = [
    "/cart/sync",
    "/api/cart/sync",
    "/cart/merge",
    "/api/cart/merge",
  ];

  for (const url of urls) {
    try {
      await api.post(url, { items }, { withCredentials: true });
      return;
    } catch {
      // try next compatible route
    }
  }
}

/** Reset browser cart after logout */
function clearBrowserCart() {
  try {
    const uid = getActiveUserId();
    if (uid) {
      localStorage.removeItem(userCartKey(uid));
    }
  } catch {}

  try {
    localStorage.removeItem(GUEST_CART_KEY);
  } catch {}

  try {
    localStorage.removeItem("cart"); // legacy only
  } catch {}

  try {
    window.dispatchEvent(new Event("cart:updated"));
  } catch {}
}

async function tryServerLogout() {
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
  // mark first so any immediate bootstrap() sees it
  markJustLoggedOut();

  // capture cart before auth is cleared
  const browserCartSnapshot = readBrowserCartSnapshot();

  // best-effort: store browser cart in server cart first
  try {
    await Promise.race([
      pushBrowserCartToServer(browserCartSnapshot),
      sleep(1200),
    ]);
  } catch {
    // ignore
  }

  const st = useAuthStore.getState();

  try {
    // best-effort cookie clear
    await Promise.race([tryServerLogout(), sleep(800)]);
  } finally {
    // clear browser cart completely after sync
    clearBrowserCart();

    // clear auth state
    try {
      st.clear?.();
    } catch {}
    try {
      useAuthStore.setState({ user: null } as any);
    } catch {}

    // clear persisted auth snapshot keys
    try {
      localStorage.removeItem("auth_store_v1");
      sessionStorage.removeItem("auth_store_v1");
    } catch {}

    // redirect
    if (navigate) {
      navigate(redirectTo, { replace: true });
      return;
    }
    window.location.assign(redirectTo);
  }
}