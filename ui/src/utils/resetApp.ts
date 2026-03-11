// src/utils/resetApp.ts
import { useAuthStore } from "../store/auth.js";
import api from "../api/client";
import { writeCartLines } from "./cartModel";
import { markJustLoggedOut } from "./logout";

type ResetMode = "hard" | "soft";

const PRESERVE_LOCALSTORAGE_KEYS = ["consent"];

const WIPE_LOCALSTORAGE_KEYS = [
  "auth",
  "auth_store_v1",
  "cart",
  "cart:guest:v2",
  "verifyEmail",
  "verifyToken",
  "verify_token",
];

const USER_CART_KEY_PREFIX = "cart:user:";
const CART_KEY_SUFFIX = ":v2";

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    //
  }
}

function safeRemove(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    //
  }
}

function preserveSelectedKeys(): Record<string, string> {
  const preserved: Record<string, string> = {};
  for (const k of PRESERVE_LOCALSTORAGE_KEYS) {
    const v = safeGet(k);
    if (v != null) preserved[k] = v;
  }
  return preserved;
}

function restoreSelectedKeys(preserved: Record<string, string>) {
  for (const [k, v] of Object.entries(preserved)) {
    safeSet(k, v);
  }
}

function wipeUserCartKeys() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(USER_CART_KEY_PREFIX) && key.endsWith(CART_KEY_SUFFIX)) {
        keys.push(key);
      }
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    //
  }
}

function clearBrowserCartEverywhere() {
  try {
    writeCartLines([]);
  } catch {
    //
  }

  for (const k of WIPE_LOCALSTORAGE_KEYS) safeRemove(k);
  wipeUserCartKeys();

  try {
    window.dispatchEvent(new Event("cart:updated"));
  } catch {
    //
  }
}

export function hardResetApp(redirectTo: string = "/", opts?: { mode?: ResetMode }) {
  const mode: ResetMode = opts?.mode ?? "hard";

  const preserved = preserveSelectedKeys();

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

  clearBrowserCartEverywhere();

  try {
    sessionStorage.clear();
  } catch {
    //
  }

  restoreSelectedKeys(preserved);

  if (mode === "soft") {
    if (window.location.pathname !== redirectTo) {
      window.history.replaceState(null, "", redirectTo);
    }
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      //
    }
    return;
  }

  window.location.replace(redirectTo);
}

export async function logoutAndReset(
  redirectTo: string = "/login",
  opts?: { mode?: ResetMode }
) {
  markJustLoggedOut();

  try {
    await api.post("/api/auth/logout", {}, { withCredentials: true });
  } catch {
    //
  }

  hardResetApp(redirectTo, opts);
}