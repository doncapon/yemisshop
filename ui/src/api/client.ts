// src/api/client.ts
import axios from 'axios';

const api = axios.create({
  baseURL:
    // Prefer Vite env if set (e.g. VITE_API_URL="http://localhost:4000")
    (import.meta as any)?.env?.VITE_API_URL ||
    // Fallback for local dev
    'http://localhost:4000',
  // You're using Bearer tokens in headers, so cookies aren't needed
  withCredentials: false,
  timeout: 20000,
});

// Minimal, safe interceptors: do NOT redirect or transform errors globally.
api.interceptors.response.use(
  (resp) => resp,
  (error) => Promise.reject(error)
);

export default api;
