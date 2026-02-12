// src/lib/authCookies.ts
import type { Response } from "express";

const COOKIE_NAME = "access_token";
const isProd = process.env.NODE_ENV === "production";

/**
 * Cross-domain deployment (UI and API on different domains) requires:
 * - SameSite=None
 * - Secure=true
 *
 * Local dev usually wants SameSite=Lax and Secure=false.
 */
function cookieSameSite(): "none" | "lax" {
  return isProd ? "none" : "lax";
}

function cookieSecure(): boolean {
  // SameSite=None requires Secure. On localhost (http) Secure must be false.
  return isProd;
}

export function setAccessTokenCookie(
  res: Response,
  token: string,
  opts?: { maxAgeDays?: number }
) {
  const maxAgeMs = (opts?.maxAgeDays ?? 7) * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: cookieSameSite(),
    secure: cookieSecure(),
    path: "/",
    maxAge: maxAgeMs,
  });
}

export function clearAccessTokenCookie(res: Response) {
  // Must match sameSite/secure/path used when setting, otherwise browser may not remove it.
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: cookieSameSite(),
    secure: cookieSecure(),
    path: "/",
  });
}
