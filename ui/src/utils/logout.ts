// src/utils/logout.ts
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function performLogout(redirectTo = "/", navigate?: NavigateFn) {
  // ✅ Cookie-auth logout: ensure cookies are sent so server can clear them
  const serverLogoutPromise = api
    .post("/api/auth/logout", {}, { withCredentials: true })
    .catch(() => null);

  // ✅ Clear client auth store (you likely still keep a user snapshot/flags)
  try {
    useAuthStore.getState().clear?.();
  } catch {}

  // ✅ If you still cache any auth-related bits, clear them (optional)
  try {
    localStorage.removeItem("auth_store_v1");
    sessionStorage.removeItem("auth_store_v1");
  } catch {}

  // ✅ Short wait (don’t block UX)
  await Promise.race([serverLogoutPromise, sleep(800)]);

  // ✅ Redirect
  if (navigate) {
    navigate(redirectTo, { replace: true });
    return;
  }
  window.location.replace(redirectTo);
}
