// src/api/client.ts
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

const V = (import.meta as any)?.env || {};

// You can set VITE_API_URL to "https://daysping-api-production.up.railway.app"
// If empty, axios will use same-origin.
const API_BASE: string = String(V.VITE_API_URL ?? "").trim();

export const ACCESS_TOKEN_KEY = "access_token";

let accessToken: string | null = null;

const api = axios.create({
  baseURL: API_BASE,
  // ✅ safe even if you rely on Bearer token only. If you later use cookies, this is required.
  withCredentials: true,
  timeout: 20000,
});

const looksLikeJwt = (t: string | null) => !!t && t.split(".").length === 3;

function safeSession(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function safeLocal(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readToken(): string | null {
  // ✅ prefer sessionStorage (tab/session), fallback to localStorage (persist)
  const ss = safeSession();
  const ls = safeLocal();

  const t1 = ss?.getItem(ACCESS_TOKEN_KEY) ?? null;
  if (looksLikeJwt(t1)) return t1;

  const t2 = ls?.getItem(ACCESS_TOKEN_KEY) ?? null;
  if (looksLikeJwt(t2)) return t2;

  return null;
}

function writeToken(token: string | null) {
  const ss = safeSession();
  const ls = safeLocal();

  // ✅ write to both so you can SEE it and it survives reloads
  try {
    if (token && looksLikeJwt(token)) ss?.setItem(ACCESS_TOKEN_KEY, token);
    else ss?.removeItem(ACCESS_TOKEN_KEY);
  } catch {}

  try {
    if (token && looksLikeJwt(token)) ls?.setItem(ACCESS_TOKEN_KEY, token);
    else ls?.removeItem(ACCESS_TOKEN_KEY);
  } catch {}
}

function applyTokenToAxios(token: string | null) {
  if (token && looksLikeJwt(token)) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
}

export function getAccessToken(): string | null {
  if (!accessToken) accessToken = readToken();
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = looksLikeJwt(token) ? token : null;
  writeToken(accessToken);
  applyTokenToAxios(accessToken);
}

export function clearAccessToken() {
  setAccessToken(null);
}

// ---- Initial rehydrate at module load ----
accessToken = readToken();
applyTokenToAxios(accessToken);

/* -------------------- interceptors -------------------- */

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(config.headers);

  // refresh from storage if needed
  if (!accessToken) accessToken = readToken();

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

    // ✅ treat /auth/me 401 as logged-out without throwing
    const isMe = url.includes("/api/auth/me") || url.includes("/auth/me");
    if (status === 401 && isMe && (e as any).response) {
      clearAccessToken();
      return Promise.resolve({
        ...(e as any).response,
        data: null,
      });
    }

    // ✅ your CAC verify special-case
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
