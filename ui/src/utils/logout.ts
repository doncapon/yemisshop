// src/utils/logout.ts
import api, { setAccessToken } from "../api/client";
import { useAuthStore } from "../store/auth";

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function performLogout(redirectTo = "/", navigate?: NavigateFn) {
  // 1) Fire server logout (best-effort). Do NOT let it block logout UX.
  //    Route clears HttpOnly cookie server-side.
  const serverLogoutPromise = api.post("/api/auth/logout", {}).catch(() => null);

  // 2) Clear client auth + state immediately
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("auth");
    localStorage.removeItem("cart");
  } catch {
    /* ignore */
  }

  // Clear axios bearer + storage via helper
  setAccessToken(null);

  // Clear zustand auth state
  try {
    useAuthStore.getState().clear?.(); // or .logout()
  } catch {
    /* ignore */
  }

  // 3) Give the server request a short chance to finish (prevents cookie lingering),
  //    but don't hang if Railway/network is slow.
  await Promise.race([serverLogoutPromise, sleep(1000)]);

  // 4) Redirect (prefer SPA)
  if (navigate) {
    navigate(redirectTo, { replace: true });
    return;
  }

  // Last-resort fallback if called outside React Router context
  window.location.replace(redirectTo);
}
