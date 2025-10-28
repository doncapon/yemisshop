// // web/src/api/client.ts
// const BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

// export type HttpError = Error & {
//   status?: number;
//   data?: any;
// };

// function makeError(status: number, data: any): HttpError {
//   const err = new Error(
//     typeof data === 'string'
//       ? data
//       : data?.error || data?.message || `HTTP ${status}`
//   ) as HttpError;
//   err.status = status;
//   err.data = data;
//   return err;
// }

// async function request(path: string, init: RequestInit = {}) {
//   const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
//   const res = await fetch(url, {
//     // include cookies only if you use cookie-based auth from your API
//     credentials: 'include',
//     ...init,
//     headers: {
//       'Accept': 'application/json',
//       ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
//       ...(init.headers || {}),
//     },
//   });

//   // auto parse either JSON or text
//   const ct = res.headers.get('content-type') || '';
//   const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();

//   if (!res.ok) throw makeError(res.status, body);
//   return body;
// }

// export const api = {
//   get: <T = any>(path: string, init?: RequestInit) =>
//     request(path, { method: 'GET', ...(init || {}) }) as Promise<T>,

//   post: <T = any>(path: string, data?: any, init?: RequestInit) =>
//     request(path, {
//       method: 'POST',
//       body: data == null ? undefined : JSON.stringify(data),
//       ...(init || {}),
//     }) as Promise<T>,

//   patch: <T = any>(path: string, data?: any, init?: RequestInit) =>
//     request(path, {
//       method: 'PATCH',
//       body: data == null ? undefined : JSON.stringify(data),
//       ...(init || {}),
//     }) as Promise<T>,

//   del: <T = any>(path: string, init?: RequestInit) =>
//     request(path, { method: 'DELETE', ...(init || {}) }) as Promise<T>,

//   // raw file downloads (PDF etc.)
//   download: async (path: string, init?: RequestInit) => {
//     const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
//     const res = await fetch(url, { ...(init || {}) });
//     if (!res.ok) throw makeError(res.status, await res.text());
//     return await res.blob();
//   },
// };
