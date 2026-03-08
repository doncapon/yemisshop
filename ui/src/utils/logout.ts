// src/utils/logout.ts
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import { readCartLines, writeCartLines } from "./cartModel";

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GUEST_CART_KEY = "cart:guest:v2";
const USER_CART_KEY_PREFIX = "cart:user:";
const CART_KEY_SUFFIX = ":v2";

const LAST_LOGOUT_AT_KEY = "auth:lastLogoutAt";

export function markJustLoggedOut() {
  try {
    sessionStorage.setItem(LAST_LOGOUT_AT_KEY, String(Date.now()));
  } catch {
    //
  }
}

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
 * If you later want "sync before logout", keep this helper.
 * For now we are clearing cart on logout/idle logout, so no server push is needed.
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

function clearBrowserCart() {
  try {
    writeCartLines([]);
  } catch {
    //
  }

  try {
    const uid = getActiveUserId();
    if (uid) {
      localStorage.removeItem(userCartKey(uid));
    }
  } catch {
    //
  }

  try {
    localStorage.removeItem(GUEST_CART_KEY);
  } catch {
    //
  }

  try {
    localStorage.removeItem("cart");
  } catch {
    //
  }

  try {
    window.dispatchEvent(new Event("cart:updated"));
  } catch {
    //
  }
}

async function tryServerLogout() {
  const urls = ["/auth/logout", "/api/auth/logout"];
  for (const url of urls) {
    try {
      await api.post(url, {}, { withCredentials: true });
      return;
    } catch {
      //
    }
  }
}

function clearAuthSnapshots() {
  try {
    localStorage.removeItem("auth_store_v1");
    sessionStorage.removeItem("auth_store_v1");
  } catch {
    //
  }

  try {
    localStorage.removeItem("auth");
    sessionStorage.removeItem("auth");
  } catch {
    //
  }

  try {
    useAuthStore.getState().clear?.();
  } catch {
    //
  }

  try {
    useAuthStore.setState({ user: null } as any);
  } catch {
    //
  }
}

export async function performLogout(redirectTo = "/", navigate?: NavigateFn) {
  markJustLoggedOut();

  // Read once in case you later want analytics/debugging, but do not preserve it.
  readBrowserCartSnapshot();

  try {
    await Promise.race([tryServerLogout(), sleep(1200)]);
  } finally {
    clearBrowserCart();
    clearAuthSnapshots();

    if (navigate) {
      navigate(redirectTo, { replace: true });
      return;
    }

    window.location.replace(redirectTo);
  }
}