import api, { setAccessToken } from "../api/client";
import { useAuthStore } from "../store/auth";
import { hardResetApp } from "./resetApp";

export async function performLogout(redirectTo = "/") {
  // Always try to clear cookie on server (httpOnly cookie cannot be removed by JS)
  try {
    await api.post("/api/auth/logout", {}); // withCredentials:true is already set in axios instance
  } catch {
    // ignore – client should still clear local state
  }

  // Clear client token + state
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("auth");
    localStorage.removeItem("cart");
  } catch {}

  setAccessToken(null); // clears axios default + localStorage token (your helper)
  useAuthStore.getState().clear(); // or logout()

  // Hard reset to prevent bootstrap flicker
  hardResetApp(redirectTo);
}
