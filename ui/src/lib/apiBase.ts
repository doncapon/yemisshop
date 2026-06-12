import { Capacitor } from "@capacitor/core";

const normalizeBase = (s: string) => s.trim().replace(/\/+$/, "");

const isDev = import.meta.env.DEV;
const isNative = Capacitor.isNativePlatform();

const PROD_BASE =
  normalizeBase(String(import.meta.env.VITE_API_URL ?? "")) || "";

// In native dev: use the Vite dev server origin as the API base so requests go
// through Vite's proxy. Works for emulators (localhost) and LAN physical devices.
const NATIVE_DEV_BASE =
  normalizeBase(String(import.meta.env.VITE_NATIVE_API_URL ?? "")) ||
  (typeof window !== "undefined" ? normalizeBase(window.location.origin) : "http://localhost:5173");

/**
 * Returns the correct API base URL for the current environment.
 * Use this anywhere you need to construct a raw URL (e.g. OAuth href links).
 * Axios client.ts already uses the same logic via baseURL.
 */
export function getApiBase(): string {
  if (isDev && isNative) return NATIVE_DEV_BASE;
  if (isDev) return "";
  return PROD_BASE;
}
