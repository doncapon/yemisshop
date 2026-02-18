import axios from "axios";

const normalizeBase = (s: string) => s.trim().replace(/\/+$/, "");
const normalizePath = (s: string) => s.trim().replace(/\/+$/, "");

// NOTE:
// - In DEV: baseURL "" so Vite proxy handles /api/*
// - In PROD: baseURL usually "/api" (same-origin)
const isDev = import.meta.env.DEV;

// Prefer explicit env; fallback to "/api"
const PROD_BASE = normalizeBase(String(import.meta.env.VITE_API_URL ?? "")) || "/api";

const api = axios.create({
  baseURL: isDev ? "" : PROD_BASE,
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
  const isAbsolute = /^https?:\/\//i.test(url);

  if (!isAbsolute && base.endsWith("/api") && url.startsWith("/api/")) {
    config.url = url.replace(/^\/api/, "");
  }

  // Also handle weird "api/..." (without leading slash)
  if (!isAbsolute && base.endsWith("/api") && url.startsWith("api/")) {
    config.url = url.replace(/^api/, "");
  }

  return config;
});

export default api;
