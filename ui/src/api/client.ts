// src/api/client.ts
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

const V = (import.meta as any)?.env || {};
const API_BASE = V.VITE_API_URL; // '' => same-origin, so call '/api/...'
let accessToken: string | null = null;

// Rehydrate once at module load
try {
  const t = window.localStorage.getItem("access_token");
  if (t) accessToken = t;
} catch {
  /* ignore */
}

// Keep memory in sync across tabs/HMR
window.addEventListener("storage", (e) => {
  if (e.key === "access_token") accessToken = e.newValue;
});

// Exported setter so login/logout and the store can keep axios in sync
export function setAccessToken(token: string | null) {
  accessToken = token;
  try {
    if (token) window.localStorage.setItem("access_token", token);
    else window.localStorage.removeItem("access_token");
  } catch {
    /* ignore */
  }
}

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 20000,
});

// Attach Bearer when present + set JSON content-type for non-GET by default
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(config.headers);

  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const method = String(config.method || "get").toLowerCase();
  if (method !== "get" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  config.headers = headers;
  return config;
});

// ✅ For CAC verify calls, treat expected outcomes as "handled" (don’t reject)
api.interceptors.response.use(
  (r) => r,
  (e: AxiosError) => {
    const url = String((e as any)?.config?.url ?? "");
    const status = (e as any)?.response?.status as number | undefined;

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
