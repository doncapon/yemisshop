// api/src/lib/authCookies.ts
import type { Response, CookieOptions } from "express";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "access_token";
const LEGACY_COOKIE_NAMES = ["token"]; // clear old cookies if you ever used them

const isProd = process.env.NODE_ENV === "production";

function baseCookieOptions(): CookieOptions {
  const sameSiteEnv = String(process.env.COOKIE_SAMESITE || "").toLowerCase(); // lax|strict|none
  const sameSite: CookieOptions["sameSite"] =
    sameSiteEnv === "none" ? "none" : sameSiteEnv === "strict" ? "strict" : undefined;

  // If SameSite=None, Secure MUST be true
  const secureEnv = String(process.env.COOKIE_SECURE || "").toLowerCase();
  const secure =
    secureEnv ? secureEnv === "true" : isProd || sameSite === "none";

  const domain = process.env.COOKIE_DOMAIN ? String(process.env.COOKIE_DOMAIN) : undefined;

  // ✅ Default behavior:
  // - In production, if not explicitly overridden, prefer SameSite=None for cross-site UI/API deployments
  // - In dev, use Lax unless explicitly overridden
  const finalSameSite =
    sameSite ?? (isProd ? "none" : "lax");

  return {
    httpOnly: true,
    sameSite: finalSameSite,
    secure: finalSameSite === "none" ? true : secure,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function setAccessTokenCookie(res: Response, token: string, opts?: { maxAgeDays?: number }) {
  const days = Math.max(1, Number(opts?.maxAgeDays ?? 7));
  const base = baseCookieOptions();

  res.cookie(COOKIE_NAME, token, {
    ...base,
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}

export function clearAccessTokenCookie(res: Response) {
  // ✅ Must match options used to set cookie (path/domain/samesite/secure)
  const opts = baseCookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
  for (const n of LEGACY_COOKIE_NAMES) res.clearCookie(n, opts);
}
