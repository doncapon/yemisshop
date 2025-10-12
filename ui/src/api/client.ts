// src/api/client.ts
import axios from 'axios';
import { useAuthStore } from '../store/auth';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  timeout: 15000,
});

/* ------------------------------------------------------------------ */
/* Paystack back-button guard: mark the session if we just came back.  */
/* ------------------------------------------------------------------ */
const PAYSTACK_MARK = 'paystack.back.ts';
function markIfFromPaystack() {
  try {
    const ref = document.referrer || '';
    if (/paystack\.com/i.test(ref)) {
      sessionStorage.setItem(PAYSTACK_MARK, String(Date.now()));
    }
  } catch {}
}
// run once on module import
markIfFromPaystack();
// also re-check when the page is shown from bfcache or back/forward
try {
  window.addEventListener('pageshow', markIfFromPaystack);
} catch {}

// helper: did we return from paystack recently?
function cameFromPaystackRecently(windowMs = 60_000): boolean {
  try {
    const ts = Number(sessionStorage.getItem(PAYSTACK_MARK) || '0');
    if (!ts) return false;
    const age = Date.now() - ts;
    if (age <= windowMs) return true;
    // stale -> cleanup
    sessionStorage.removeItem(PAYSTACK_MARK);
    return false;
  } catch {
    return false;
  }
}

/* --------------------------------------------- */
/* Attach token automatically to every request.   */
/* --------------------------------------------- */
api.interceptors.request.use((config) => {
  const { token } = useAuthStore.getState();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isLoggingOut = false;

function hardLogout(_reason: string) {
  if (isLoggingOut) return;
  isLoggingOut = true;

  try {
    useAuthStore.getState().clear?.();
  } catch {}
  try {
    localStorage.clear();
    sessionStorage.clear?.();
  } catch {}

  // ✅ Always go to a clean /login (no query params)
  window.location.replace('/login');
}

/* ------------------------------------------------------------------ */
/* Response error handling — be conservative about logging out.        */
/* ------------------------------------------------------------------ */
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const isNetwork = !error?.response; // server down / CORS / DNS / offline, etc.
    const suppress = cameFromPaystackRecently(); // just returned from Paystack?

    // Only auto-logout on definite 401s from our API — and not immediately after Paystack return
    if (status === 401 && !suppress) {
      hardLogout('401');
      return Promise.reject(error);
    }

    // Do NOT auto-logout on 403 here (let the app route guard handle it).
    // Do NOT auto-logout on generic network errors — they can be transient,
    // and Paystack back-button often triggers these in the first paint.
    if (isNetwork) {
      // Optionally: you could surface a toast or set a global offline flag here.
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export default api;
