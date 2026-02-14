// src/api/client.ts
import axios from "axios";

const V = (import.meta as any)?.env || {};
// If VITE_API_URL is "", axios uses same-origin and you can call "/api/..."
const API_BASE = String(V.VITE_API_URL ?? "").trim();

const api = axios.create({
  baseURL: API_BASE || undefined,
  withCredentials: true, // ✅ send HttpOnly cookie to /api
  timeout: 20000,
});

// Cookie-mode: token is NOT stored in browser storage.
// Keep this export so existing imports don't break.
export function setAccessToken(_token: string | null) {
  // no-op in cookie mode
}

export default api;
