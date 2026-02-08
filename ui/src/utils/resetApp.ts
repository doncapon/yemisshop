// src/utils/resetApp.ts
import { useAuthStore } from "../store/auth.js";

const PRESERVE_LOCALSTORAGE_KEYS = ["consent"]; // 👈 keep cookie consent across logout/reset

export function hardResetApp(redirectTo: string = "/") {
  try {
    // ✅ snapshot keys we want to keep
    const preserved: Record<string, string> = {};
    try {
      for (const k of PRESERVE_LOCALSTORAGE_KEYS) {
        const v = localStorage.getItem(k);
        if (v != null) preserved[k] = v;
      }
    } catch {}

    // Clear Zustand auth store if available
    try {
      useAuthStore.getState().clear?.();
    } catch {}

    // Clear storages
    try {
      localStorage.clear();
    } catch {}
    try {
      sessionStorage.clear();
    } catch {}

    // ✅ restore preserved keys
    try {
      for (const [k, v] of Object.entries(preserved)) {
        localStorage.setItem(k, v);
      }
    } catch {}

    // Best-effort cookie clearing (can’t touch HttpOnly cookies)
    // NOTE: If you later store consent in cookies, you may also want to SKIP clearing that cookie here.
    try {
      const cookies = document.cookie.split(";");
      for (const c of cookies) {
        const [name] = c.split("=");
        document.cookie = `${name.trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    } catch {}
  } catch {}

  window.location.replace(redirectTo);
}
