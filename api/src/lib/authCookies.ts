import type { Response } from "express";

const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

function cookieDomain() {
  // Optional: set COOKIE_DOMAIN=".yourdomain.com" when you have it
  const d = process.env.COOKIE_DOMAIN;
  return d && d.trim() ? d.trim() : undefined;
}

export function accessCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,                 // ✅ only HTTPS in prod
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    domain: cookieDomain(),
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days (match your session/jwt policy)
  };
}

export function setAccessTokenCookie(res: Response, token: string, opts?: { maxAgeDays?: number }) {
  const days = opts?.maxAgeDays ?? 7;
  const maxAgeMs = days * 24 * 60 * 60 * 1000;

  res.cookie("access_token", token, {
    httpOnly: true,
    secure: String(process.env.NODE_ENV) === "production",
    sameSite: "lax",
    maxAge: maxAgeMs,
    path: "/",
  });
}

export function clearAccessTokenCookie(res: Response) {
  res.clearCookie("access_token", { path: "/" });
}
