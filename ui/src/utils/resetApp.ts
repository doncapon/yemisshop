// src/utils/resetApp.ts
import { useAuthStore } from '../store/auth.js';

// Can be imported and called from anywhere in the browser runtime.
export function hardResetApp(redirectTo: string = '/') {
  try {
    // Clear Zustand auth store if available
    try {
      useAuthStore.getState().clear?.();
    } catch {}

    // Clear storages
    localStorage.clear();
    sessionStorage.clear();

    // Best-effort cookie clearing (can’t touch HttpOnly cookies)
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const [name] = c.split('=');
      // expire cookie on common paths
      document.cookie = `${name.trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  } catch {}

  // Hard navigation so any in-memory state is gone
  window.location.replace(redirectTo);
}
