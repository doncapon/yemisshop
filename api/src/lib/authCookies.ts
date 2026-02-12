// src/lib/authCookies.ts
import type { Response, CookieOptions } from "express";

const COOKIE_NAME = "access_token";
const isProd = process.env.NODE_ENV === "production";

function baseCookieOptions(): CookieOptions {
  return {
    // sameSite must be "none" if you are NOT proxying and UI/API are different domains
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    path: "/",

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
