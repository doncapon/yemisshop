// api/src/lib/authCookies.ts
import type { Response } from "express";

type SameSite = "lax" | "strict" | "none";

function inferSecureFromEnv(): boolean {
  const s = String(process.env.COOKIE_SECURE ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;

  // fallback: if APP_URL/API_URL are https, prefer secure cookies
  const app = String(process.env.APP_URL ?? "");
  const api = String(process.env.API_URL ?? "");
  return app.startsWith("https://") || api.startsWith("https://");
}

function inferSameSite(): SameSite {
  const v = String(process.env.COOKIE_SAMESITE ?? "").trim().toLowerCase();
  if (v === "none" || v === "lax" || v === "strict") return v as SameSite;

  // If you host UI+API on same origin: lax is best
  return "lax";
}

const COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || "access_token";

export function setAccessTokenCookie(
  res: Response,
  token: string,
  opts?: { maxAgeDays?: number }
) {
  const secure = inferSecureFromEnv();
  const sameSite = inferSameSite();

  // If SameSite=None, secure must be true (Chrome requirement)
  const finalSecure = sameSite === "none" ? true : secure;

  const maxAgeDays = Number(opts?.maxAgeDays ?? 30);
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: finalSecure,
    sameSite,
    path: "/",
    maxAge: maxAgeMs,
  });
}

export function clearAccessTokenCookie(res: Response) {
  const secure = inferSecureFromEnv();
  const sameSite = inferSameSite();

  const finalSecure = sameSite === "none" ? true : secure;

  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: finalSecure,
    sameSite,
    path: "/",
  });
}

export function getAccessTokenCookieName() {
  return COOKIE_NAME;
}
