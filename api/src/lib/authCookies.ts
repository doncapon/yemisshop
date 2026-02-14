// api/src/lib/authCookies.ts
import type { Response } from "express";

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME?.trim() || "ds_access";

/** ✅ what your middleware expects */
export function getAccessTokenCookieName() {
  return COOKIE_NAME;
}

type SameSite = "lax" | "strict" | "none";

function isProd() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function inferSameSite(): SameSite {
  const v = String(process.env.COOKIE_SAMESITE || "").trim().toLowerCase();
  if (v === "lax" || v === "strict" || v === "none") return v;
  return "lax"; // default
}

function inferSecureFromEnv() {
  const v = String(process.env.COOKIE_SECURE || "").trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return isProd(); // default secure in prod
}

function inferCookieDomain(): string | undefined {
  // ✅ If you are on Railway *.up.railway.app, do NOT set Domain (host-only cookie)
  // ✅ If you are on your custom domain, set COOKIE_DOMAIN=.dayspringhouse.com
  const env = String(process.env.COOKIE_DOMAIN || "").trim();
  if (env) return env;

  // Optional default for prod only (safe if your prod is always on dayspringhouse.com):
  if (isProd()) return ".dayspringhouse.com";

  return undefined; // localhost/dev
}

export function setAccessTokenCookie(
  res: Response,
  token: string,
  opts?: { maxAgeDays?: number }
) {
  const sameSite = inferSameSite();
  const secure = inferSecureFromEnv();
  const domain = inferCookieDomain();

  // If SameSite=None, Secure must be true (Chrome)
  const finalSecure = sameSite === "none" ? true : secure;

  const maxAgeDays = Number(opts?.maxAgeDays ?? 30);
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: finalSecure,
    sameSite,
    path: "/",
    maxAge: maxAgeMs,
    ...(domain ? { domain } : {}),
  });
}

export function clearAccessTokenCookie(res: Response) {
  const sameSite = inferSameSite();
  const secure = inferSecureFromEnv();
  const domain = inferCookieDomain();

  const finalSecure = sameSite === "none" ? true : secure;

  // IMPORTANT: must match set-cookie options (domain/path/samesite/secure)
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: finalSecure,
    sameSite,
    path: "/",
    ...(domain ? { domain } : {}),
  });
}
