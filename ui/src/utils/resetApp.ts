// src/utils/resetApp.ts
import { useAuthStore } from "../store/auth.js";

type ResetMode = "hard" | "soft";

const PRESERVE_LOCALSTORAGE_KEYS = ["consent"]; // keep cookie consent across logout/reset

// Keys we intentionally wipe on reset
const WIPE_LOCALSTORAGE_KEYS = [
  "auth",         // zustand persist
  "access_token", // legacy (your api/client also uses this)
  "cart",         // if you want cart cleared on logout/reset
  "verifyEmail",
  "verifyToken",
  "verify_token",
];

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
    /* ignore */
  }
}

function safeRemove(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
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

/**
 * Reset app state after logout or auth failure.
 *
 * - default is "hard" to preserve your current behavior
 * - use mode:"soft" for normal logout to avoid "network gets wiped" confusion
 */
export function hardResetApp(redirectTo: string = "/", opts?: { mode?: ResetMode }) {
  const mode: ResetMode = opts?.mode ?? "hard";
    console.trace("hardResetApp CALLED"); // ✅ tells you EXACTLY who triggered it

  // 1) preserve consent (and anything else you add)
  const preserved = preserveSelectedKeys();

  // 2) clear zustand auth store (in-memory)
  try {
    useAuthStore.getState().clear?.();
  } catch {
    /* ignore */
  }

  // 3) wipe only the keys we care about (NOT localStorage.clear())
  for (const k of WIPE_LOCALSTORAGE_KEYS) safeRemove(k);

  // 4) sessionStorage can still be wiped (usually safe)
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }

  // 5) restore preserved keys
  restoreSelectedKeys(preserved);

  // 6) redirect
  if (mode === "soft") {
    // SPA-friendly: no full reload
    if (window.location.pathname !== redirectTo) {
      window.history.replaceState(null, "", redirectTo);
    }
    // fire a popstate so routers listening can react (best-effort)
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      /* ignore */
    }
    return;
  }

  // Hard reload (your existing behavior)
  window.location.replace(redirectTo);
}
