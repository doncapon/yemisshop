// src/api/client.ts
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

const V = (import.meta as any)?.env || {};

// If empty -> same-origin "/api/..." works (good for local proxy setups)
const API_BASE: string = String(V.VITE_API_URL ?? "").trim();

const TOKEN_KEY = "access_token";

let accessToken: string | null = null;

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false, // Bearer auth (not cookies)
  timeout: 20000,
});

const looksLikeJwt = (t: string | null) => !!t && t.split(".").length === 3;

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  try {
    const st = getStorage();
    if (!st) return null;
    const t = st.getItem(TOKEN_KEY);
    return looksLikeJwt(t) ? t : null;
  } catch {
    return null;
  }
}

function writeTokenToStorage(token: string | null) {
  try {
    const st = getStorage();
    if (!st) return;
    if (token && looksLikeJwt(token)) st.setItem(TOKEN_KEY, token);
    else st.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function applyTokenToAxios(token: string | null) {
  if (token && looksLikeJwt(token)) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
}

export function setAccessToken(token: string | null) {
  accessToken = looksLikeJwt(token) ? token : null;
  writeTokenToStorage(accessToken);
  applyTokenToAxios(accessToken);
}

export function clearAccessToken() {
  setAccessToken(null);
}

// ---- Initial rehydrate at module load ----
accessToken = getAccessToken();
applyTokenToAxios(accessToken);

// ---- Request interceptor ----
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(config.headers);

  // If memory token is missing, fall back to sessionStorage (JWT-only)
  if (!accessToken) accessToken = getAccessToken();

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

// ---- Response interceptor ----
api.interceptors.response.use(
  (r) => r,
  (e: AxiosError) => {
    const url = String((e as any)?.config?.url ?? "");
    const status = (e as any)?.response?.status as number | undefined;

    // Treat /auth/me 401 as logged out without throwing
    const isMe =
      url.includes("/api/auth/me") ||
      url.endsWith("/auth/me") ||
      url.includes("/auth/me?");

    if (status === 401 && isMe && (e as any).response) {
      clearAccessToken();
      return Promise.resolve({
        ...(e as any).response,
        data: null,
      });
    }

    // CAC verify special-case
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
