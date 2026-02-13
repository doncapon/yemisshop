// api/src/lib/authCookies.ts
import type { Response, CookieOptions } from "express";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "access_token";
const LEGACY_COOKIE_NAMES = ["token"];

const isProd = process.env.NODE_ENV === "production";

function computeCookieOptions(): CookieOptions {
  const sameSiteEnv = String(process.env.COOKIE_SAMESITE || "").toLowerCase(); // lax|strict|none
  const sameSite: CookieOptions["sameSite"] =
    sameSiteEnv === "none" ? "none" : sameSiteEnv === "strict" ? "strict" : "lax";

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
  const days = Math.max(1, Number(opts?.maxAgeDays ?? 7));
  const base = computeCookieOptions();

  res.cookie(COOKIE_NAME, token, {
    ...base,
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}

export function clearAccessTokenCookie(res: Response) {
  const base = computeCookieOptions();
  res.clearCookie(COOKIE_NAME, base);
  for (const n of LEGACY_COOKIE_NAMES) res.clearCookie(n, base);
}
