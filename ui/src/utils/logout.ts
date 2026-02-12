// src/utils/logout.ts
import api, { setAccessToken } from "../api/client";
import { useAuthStore } from "../store/auth";
import { hardResetApp } from "./resetApp";

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

export async function performLogout(redirectTo = "/", navigate?: NavigateFn) {
  // 1) Start server logout FIRST (so Authorization header can still be attached)
  //    Don't let failures block client-side logout.
  const serverLogoutPromise = api.post("/api/auth/logout", {}).catch(() => null);

  // 2) Clear client token + state immediately
  try {
    localStorage.removeItem("access_token"); // redundant but fine
    localStorage.removeItem("auth");
    localStorage.removeItem("cart");
  } catch {
    /* ignore */
  }

  // Clear axios bearer + localStorage via helper
  setAccessToken(null);

  // Clear zustand auth state
  try {
    useAuthStore.getState().clear(); // or .logout()
  } catch {
    /* ignore */
  }

  // 3) Let the server request finish in the background (best-effort)
  //    (You can await it if you want, but not required)
  await serverLogoutPromise;

  // 4) Redirect
  // Prefer SPA navigation if provided, otherwise do a hard reset.
  if (navigate) {
    navigate(redirectTo, { replace: true });
    return;
  }

  hardResetApp(redirectTo);
}
