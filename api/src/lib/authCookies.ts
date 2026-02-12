// api/src/lib/authCookies.ts
import type { Response, CookieOptions } from "express";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "access_token";
const LEGACY_COOKIE_NAMES = ["token"]; // clear old cookies if you ever used them

const isProd = process.env.NODE_ENV === "production";

function baseCookieOptions(): CookieOptions {
  const sameSiteEnv = String(process.env.COOKIE_SAMESITE || "").toLowerCase(); // lax|strict|none
  const sameSite: CookieOptions["sameSite"] =
    sameSiteEnv === "none" ? "none" : sameSiteEnv === "strict" ? "strict" : "lax";

  // If SameSite=None, Secure MUST be true
  const secureEnv = String(process.env.COOKIE_SECURE || "").toLowerCase();
  const secure = secureEnv ? secureEnv === "true" : isProd || sameSite === "none";

  const domain = process.env.COOKIE_DOMAIN ? String(process.env.COOKIE_DOMAIN) : undefined;

  return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function setAccessTokenCookie(res: Response, token: string, opts?: { maxAgeDays?: number }) {
  const days = opts?.maxAgeDays ?? 7;
  const maxAgeMs = days * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: maxAgeMs,
  });
}

export function clearAccessTokenCookie(res: Response) {
  // ✅ Must match options used to set cookie (path/domain/samesite/secure)
  const opts = baseCookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
  for (const n of LEGACY_COOKIE_NAMES) res.clearCookie(n, opts);
}
