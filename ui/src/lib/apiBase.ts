import { Capacitor } from "@capacitor/core";

const normalizeBase = (s: string) => s.trim().replace(/\/+$/, "");

const isDev = import.meta.env.DEV;
const isNative = Capacitor.isNativePlatform();

const PROD_BASE =
  normalizeBase(String(import.meta.env.VITE_API_URL ?? "")) || "";

const NATIVE_PROD_BASE =
  normalizeBase(String(import.meta.env.VITE_NATIVE_API_URL ?? "")) || PROD_BASE;

const NATIVE_DEV_BASE =
  typeof window !== "undefined"
    ? normalizeBase(window.location.origin)
    : "http://localhost:5173";

/**
 * Returns the correct API base URL for the current environment.
 * Use this anywhere you need to construct a raw URL (e.g. OAuth href links).
 * Axios client.ts already uses the same logic via baseURL.
 */
export function getApiBase(): string {
  if (isDev && isNative) return NATIVE_DEV_BASE;
  if (isDev) return "";
  if (isNative) return NATIVE_PROD_BASE;
  return PROD_BASE;
}
