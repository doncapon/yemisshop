// src/api/client.ts
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

const V = (import.meta as any)?.env || {};
const API_BASE = V.VITE_API_URL; // '' => same-origin, so call '/api/...'

let accessToken: string | null = null;

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 20000,
});

const looksLikeJwt = (t: string | null) => !!t && t.split(".").length === 3;

function applyTokenToAxios(token: string | null) {
  if (token && looksLikeJwt(token)) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
}

function readTokenFromStorage(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const t = window.localStorage.getItem("access_token");
    return looksLikeJwt(t) ? t : null; // ✅ only trust JWTs
  } catch {
    return null;
  }
}

function writeTokenToStorage(token: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (token && looksLikeJwt(token)) window.localStorage.setItem("access_token", token);
    else window.localStorage.removeItem("access_token");
  } catch {
    /* ignore */
  }
}

// ---- Initial rehydrate at module load ----
accessToken = readTokenFromStorage();
applyTokenToAxios(accessToken);

// ---- Keep in sync across tabs ----
if (typeof window !== "undefined") {
  const g = window as any;
  if (!g.__access_token_storage_listener__) {
    g.__access_token_storage_listener__ = true;

    window.addEventListener("storage", (e) => {
      if (e.key === "access_token") {
        accessToken = looksLikeJwt(e.newValue) ? e.newValue : null;
        applyTokenToAxios(accessToken);
      }
    });
  }
}

export function setAccessToken(token: string | null) {
  accessToken = looksLikeJwt(token) ? token : null;
  writeTokenToStorage(accessToken);
  applyTokenToAxios(accessToken);
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(config.headers);

  // If memory token is missing, fall back to storage (JWT-only)
  if (!accessToken) accessToken = readTokenFromStorage();

  // ✅ only attach bearer for real JWTs
  if (accessToken && looksLikeJwt(accessToken)) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  } else {
    headers.delete("Authorization");
  }

  const method = String(config.method || "get").toLowerCase();
  if (method !== "get" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  config.headers = headers;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (e: AxiosError) => {
    const url = String((e as any)?.config?.url ?? "");
    const status = (e as any)?.response?.status as number | undefined;

    // ✅ 1) Treat /auth/me 401 as "logged out" (NOT an error)
    // This prevents "Uncaught (in promise)" noise on /login.
    const isMe =
      url.includes("/api/auth/me") ||
      url.endsWith("/auth/me") ||
      url.includes("/auth/me?");

    if (status === 401 && isMe && (e as any).response) {
      // Clear any stale bearer token you might have in localStorage
      setAccessToken(null);

      // Return a successful-looking response with data=null
      return Promise.resolve({
        ...(e as any).response,
        data: null,
      });
    }

    // ✅ 2) Keep your CAC verify special-case
    const isCacVerify =
      url.includes("/api/suppliers/cac-verify") || url.includes("/suppliers/cac-verify");
    const expected = status === 400 || status === 404 || status === 429;

    if (isCacVerify && expected && (e as any).response) {
      return Promise.resolve((e as any).response);
    }

    return Promise.reject(e);
  }
);


export default api;
