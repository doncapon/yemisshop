// src/api/client.ts
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

const V = (import.meta as any)?.env || {};

// ✅ IMPORTANT: default "" so axios uses same-origin if not set
const API_BASE: string = (V.VITE_API_URL ?? "").trim();

let accessToken: string | null = null;

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false, // ✅ Bearer token auth
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

function readTokenFromStorage(): string | null {
  try {
    const st = getStorage();
    if (!st) return null;
    const t = st.getItem("access_token");
    return looksLikeJwt(t) ? t : null;
  } catch {
    return null;
  }
}

function writeTokenToStorage(token: string | null) {
  try {
    const st = getStorage();
    if (!st) return;
    if (token && looksLikeJwt(token)) st.setItem("access_token", token);
    else st.removeItem("access_token");
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

// ---- Initial rehydrate at module load ----
accessToken = readTokenFromStorage();
applyTokenToAxios(accessToken);

// ✅ Useful for other modules (store/bootstrap)
export function getAccessToken(): string | null {
  if (!accessToken) accessToken = readTokenFromStorage();
  return looksLikeJwt(accessToken) ? accessToken : null;
}

export function setAccessToken(token: string | null) {
  accessToken = looksLikeJwt(token) ? token : null;
  writeTokenToStorage(accessToken);
  applyTokenToAxios(accessToken);
}

export function clearAccessToken() {
  setAccessToken(null);
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(config.headers);

  if (!accessToken) accessToken = readTokenFromStorage();

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

    // ✅ treat /auth/me 401 as logged out without throwing
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
