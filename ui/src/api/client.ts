import axios from "axios";
import { Capacitor } from "@capacitor/core";

const normalizeBase = (s: string) => s.trim().replace(/\/+$/, "");
const normalizePath = (s: string) => s.trim().replace(/\/+$/, "");

const isDev = import.meta.env.DEV;
const isNative = Capacitor.isNativePlatform();

// Prefer explicit env; fallback to "/api"
const PROD_BASE = normalizeBase(String(import.meta.env.VITE_API_URL ?? "")) || "/api";

// In native dev: derive the API base from the WebView's current origin (the Vite
// dev server URL). This routes all API calls through Vite's proxy to the backend,
// which works for both emulators (via ADB reverse) and physical devices over LAN
// without needing a separate port-forwarding rule for port 8080.
// CapacitorHttp (OkHttp) is enabled, so the chunked-encoding WebView bug doesn't apply.
const NATIVE_DEV_BASE =
  normalizeBase(String(import.meta.env.VITE_NATIVE_API_URL ?? "")) ||
  (typeof window !== "undefined" ? normalizeBase(window.location.origin) : "http://localhost:5173");

const baseURL = isDev && isNative ? NATIVE_DEV_BASE : isDev ? "" : PROD_BASE;

const api = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 20000,
});

/**
 * ✅ Fix: prevent "/api/api/..." when:
 * - baseURL is "/api"
 * - caller passes "/api/..." (common legacy style)
 *
 * We strip the leading "/api" from the request url ONLY when baseURL already ends with "/api".
 */
api.interceptors.request.use((config) => {
  const base = normalizePath(String(config.baseURL ?? ""));
  const url = String(config.url ?? "");

  // Only rewrite relative URLs (leave absolute URLs alone)
  // const isAbsolute = /^https?:\/\//i.test(url);

  // if (!isAbsolute && base.endsWith("/api") && url.startsWith("/api/")) {
  //   config.url = url.replace(/^\/api/, "");
  // }

  // // Also handle weird "api/..." (without leading slash)
  // if (!isAbsolute && base.endsWith("/api") && url.startsWith("api/")) {
  //   config.url = url.replace(/^api/, "");
  // }

  return config;
});

// Fire a DOM event on 401 so the SessionExpiredModal can react without
// creating a circular import (auth store imports this client).
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      window.dispatchEvent(new CustomEvent("auth:session-expired"));
    }
    return Promise.reject(err);
  }
);

export default api;
