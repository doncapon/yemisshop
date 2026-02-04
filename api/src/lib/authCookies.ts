// src/lib/authCookies.ts
import type { Response } from "express";

const COOKIE_NAME = "access_token";
const isProd = process.env.NODE_ENV === "production";

export function setAccessTokenCookie(
  res: Response,
  token: string,
  opts?: { maxAgeDays?: number }
) {
  const maxAgeMs = (opts?.maxAgeDays ?? 7) * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: maxAgeMs,
  });
}

export function clearAccessTokenCookie(res: Response) {
  // ❌ no expires / maxAge here – Express 5 handles expiry automatically
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  });
}
