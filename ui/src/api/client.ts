import axios from "axios";

const normalizeBase = (s: string) => s.trim().replace(/\/+$/, "");

const isDev = import.meta.env.DEV;

// Only use VITE_API_URL in production builds
const PROD_BASE = normalizeBase(String(import.meta.env.VITE_API_URL ?? ""))||  "/api";

// ✅ DEV: same-origin so Vite proxy + cookies work
// ✅ PROD: absolute URL from env
const baseURL = isDev ? "" : PROD_BASE;

const api = axios.create({
  baseURL: baseURL || undefined,
  withCredentials: true,
  timeout: 20000,
});

export default api;
