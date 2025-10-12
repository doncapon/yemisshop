// src/api/client.ts
import axios from 'axios';
import { useAuthStore } from '../store/auth';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  timeout: 15000,
});

// Attach token automatically
api.interceptors.request.use((config) => {
  const { token } = useAuthStore.getState();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isLoggingOut = false;

function hardLogout(reason: string) {
  if (isLoggingOut) return;
  isLoggingOut = true;

  try {
    useAuthStore.getState().clear?.(); // your Zustand store clear()
  } catch {}
  try {
    localStorage.clear();
    sessionStorage.clear?.();
  } catch {}

  const params = new URLSearchParams();
  if (location.pathname) params.set('from', location.pathname + location.search);
  params.set('reason', reason);

  // Use replace so "Back" won't bring them to a protected page that will just kick again
  window.location.replace(`/login?${params.toString()}`);
}

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const isNetwork = !error?.response; // server down / CORS / DNS / offline

    // Logout conditions:
    if (status === 401 || status === 403) {
      hardLogout(String(status));
    } else if (isNetwork) {
      // If you ONLY want to logout when the server is down, keep this.
      // If you don't want that behavior, remove this block.
      hardLogout('network');
    }

    return Promise.reject(error);
  }
);

export default api;

