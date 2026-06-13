import axios from "axios";
import { Capacitor } from "@capacitor/core";

const normalizeBase = (s: string) => s.trim().replace(/\/+$/, "");
const normalizePath = (s: string) => s.trim().replace(/\/+$/, "");

const isDev = import.meta.env.DEV;
const isNative = Capacitor.isNativePlatform();

// Web production base URL (deployed server)
const PROD_BASE = normalizeBase(String(import.meta.env.VITE_API_URL ?? "")) || "/api";

// Native production base — set VITE_NATIVE_API_URL to your backend's LAN IP for device
// testing (e.g. http://192.168.1.202:8080). Falls back to PROD_BASE so deployed builds work.
const NATIVE_PROD_BASE =
  normalizeBase(String(import.meta.env.VITE_NATIVE_API_URL ?? "")) || PROD_BASE;

// In native dev (live reload): window.location.origin is the Vite dev server URL.
// All /api/* calls hit the Vite proxy which forwards to the local backend.
// Works for emulators (ADB reverse) and physical devices over LAN.
const NATIVE_DEV_BASE =
  typeof window !== "undefined"
    ? normalizeBase(window.location.origin)
    : "http://localhost:5173";

const baseURL =
  isDev && isNative ? NATIVE_DEV_BASE
  : isDev ? ""
  : isNative ? NATIVE_PROD_BASE
  : PROD_BASE;

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
