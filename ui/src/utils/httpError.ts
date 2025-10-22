// utils/httpError.ts (helper)
import { isAxiosError } from 'axios';
export function getHttpErrorMessage(e: unknown, fallback = 'Something went wrong') {
  if (isAxiosError(e)) {
    const d = e.response?.data as any;
    return d?.error || d?.message || e.message || fallback;
  }
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}
