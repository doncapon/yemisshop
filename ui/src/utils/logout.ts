// src/utils/logout.ts
import api, { clearAccessToken } from "../api/client.js";
import { useAuthStore } from "../store/auth";

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function performLogout(redirectTo = "/", navigate?: NavigateFn) {
  // 1) best-effort server logout
  const serverLogoutPromise = api.post("/api/auth/logout", {}).catch(() => null);

  // 2) clear client storage
  try {
    localStorage.removeItem("access_token");
    sessionStorage.removeItem("access_token");
    localStorage.removeItem("auth_store_v1");
    sessionStorage.removeItem("auth_store_v1");
  } catch {}

  // 3) clear axios bearer + store
  clearAccessToken();
  try {
    useAuthStore.getState().clear();
  } catch {}

  // 4) short wait (don’t block UX)
  await Promise.race([serverLogoutPromise, sleep(800)]);

  // 5) redirect
  if (navigate) {
    navigate(redirectTo, { replace: true });
    return;
  }
  window.location.replace(redirectTo);
}
