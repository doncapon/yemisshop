// api/src/lib/authCookies.ts
import type { Response } from "express";

const COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || "ds_access";

function isLocalUrl(u?: string) {
  if (!u) return true;
  const s = String(u).toLowerCase();
  return s.includes("localhost") || s.includes("localhost") || s.includes("0.0.0.0");
}

function isProdRuntime() {
  // If you accidentally run NODE_ENV=production locally, you will break cookies on http.
  // So we treat "prod" as: NODE_ENV=production AND not local URLs.
  const nodeProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || "";
  const apiUrl = process.env.API_URL || "";
  const local = isLocalUrl(appUrl) || isLocalUrl(apiUrl);
  return nodeProd && !local;
}

const isProd = isProdRuntime();

function cookieDomain(): string | undefined {
  // Only set this in real production if you truly need cross-subdomain cookies.
  // NEVER set cookie domain for localhost/127.*
  const raw = (process.env.COOKIE_DOMAIN || "").trim();
  if (!raw) return undefined;
  return isProd ? raw : undefined;
}

export function setAccessTokenCookie(
  res: Response,
  token: string,
  opts?: { maxAgeDays?: number }
) {
  const maxAgeDays = opts?.maxAgeDays ?? 30;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,                 // ✅ false locally, true on HTTPS prod
    sameSite: isProd ? "none" : "lax", // ✅ lax locally, none in prod cross-site
    path: "/",
    maxAge: maxAgeMs,
    domain: cookieDomain(),
  });
}

export function clearAccessTokenCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    domain: cookieDomain(),
  });
}

/** ✅ what your middleware expects */
export function getAccessTokenCookieName() {
  return COOKIE_NAME;
}
