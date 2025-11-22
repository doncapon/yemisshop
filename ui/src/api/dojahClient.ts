// api/src/lib/dojahClient.ts
import axios, { AxiosError, AxiosHeaders } from 'axios';

// Use globalThis so TS doesn't complain about "process" without Node types
const env = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;

// Default to live base URL if not set
const DOJAH_BASE_URL = env.DOJAH_BASE_URL ?? 'https://api.dojah.io';

function missingEnv(name: string): never {
  throw new Error(
    `[dojahClient] Missing environment variable: ${name}. ` +
      `Set it on your backend (e.g. Railway vars or .env).`
  );
}

const dojah = axios.create({
  baseURL: DOJAH_BASE_URL,
  timeout: 15000,
});

dojah.interceptors.request.use((config) => {
  const appId = env.DOJAH_APP_ID ?? env.DOJAH_APP_ID_TEST;
  const secret = env.DOJAH_SECRET_KEY ?? env.DOJAH_SECRET_KEY_TEST;

  if (!appId) missingEnv('DOJAH_APP_ID or DOJAH_APP_ID_TEST');
  if (!secret) missingEnv('DOJAH_SECRET_KEY or DOJAH_SECRET_KEY_TEST');

  // --- Make sure headers is an AxiosHeaders instance ---
  let headers: AxiosHeaders;

  if (!config.headers) {
    // no headers yet → create fresh AxiosHeaders
    headers = new AxiosHeaders();
    config.headers = headers;
  } else if (config.headers instanceof AxiosHeaders) {
    // already AxiosHeaders → reuse
    headers = config.headers;
  } else {
    // plain object or something else → wrap it
    headers = new AxiosHeaders(config.headers as any);
    config.headers = headers;
  }

  // Now safely set Dojah headers
  headers.set('AppId', String(appId));
  headers.set('Authorization', `Bearer ${String(secret)}`); // Dojah: Bearer <SECRET_KEY>
  headers.set('Accept', 'application/json');

  if (!headers.get('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return config;
});

// Optional: normalised error passthrough
dojah.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => Promise.reject(error)
);

export default dojah;

// Convenience helper for CAC Advance
export async function fetchCacAdvance(params: {
  rc_number: string;
  company_type: string;
}) {
  const { data } = await dojah.get('/api/v1/kyc/cac/advance', { params });
  return data;
}