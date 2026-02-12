// src/lib/authCookies.ts
import type { Response, CookieOptions } from "express";

const COOKIE_NAME = "access_token";
const isProd = process.env.NODE_ENV === "production";

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    // ✅ In production, cookies must be Secure when SameSite=None
    secure: isProd,
    // ✅ Works for cross-origin XHR when UI/API are on different hosts
    sameSite: isProd ? "none" : "lax",
  };
}

export function setAccessTokenCookie(
  res: Response,
  token: string,
  opts?: { maxAgeDays?: number }
) {
  const days = opts?.maxAgeDays ?? 7;
  const maxAgeMs = days * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: maxAgeMs,
  });
}

export function clearAccessTokenCookie(res: Response) {
  // ✅ Must match cookie attributes (path/samesite/secure) to reliably clear
  res.clearCookie(COOKIE_NAME, baseCookieOptions());
}
