import axios from 'axios';

const V = (import.meta as any)?.env || {};
// Prefer relative calls with the Vite proxy so your origin stays http://localhost:5173
const API_BASE = V.VITE_API_URL || ''; // '' => same-origin, so call '/api/...'

let accessToken: string | null = null;

// Rehydrate once at module load
try {
  const t = window.localStorage.getItem('access_token');
  if (t) accessToken = t;
} catch { /* ignore */ }

// Keep memory in sync across tabs/HMR
window.addEventListener('storage', (e) => {
  if (e.key === 'access_token') accessToken = e.newValue;
});

// Exported setter so login/logout and the store can keep axios in sync
export function setAccessToken(token: string | null) {
  accessToken = token;
  try {
    if (token) window.localStorage.setItem('access_token', token);
    else window.localStorage.removeItem('access_token');
  } catch { /* ignore */ }
}

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // fine even if you use Bearer
  timeout: 20000,
});

// Attach Bearer when present
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${accessToken}`;
  }
  if (!config.headers?.['Content-Type'] && config.method && config.method !== 'get') {
    (config.headers as any)['Content-Type'] = 'application/json';
  }
  return config;
});

// Don’t clear token on generic 401 here; let your guard/UI decide
api.interceptors.response.use(
  (r) => r,
  (e) => Promise.reject(e)
);

export default api;
