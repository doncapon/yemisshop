import type { Response } from "express";

const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

function cookieDomain() {
  const d = process.env.COOKIE_DOMAIN;
  return d && d.trim() ? d.trim() : undefined;
}

type CookieOpts = {
  maxAgeDays?: number; // 👈 allow your call
};

export function accessCookieOptions(opts?: CookieOpts) {
  const maxAgeDays = opts?.maxAgeDays ?? 7;
  const maxAgeMs = 1000 * 60 * 60 * 24 * maxAgeDays;

  return {
    httpOnly: true,
    secure: isProd, // ✅ only HTTPS in prod
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    domain: cookieDomain(),
    maxAge: maxAgeMs,
  };
}

export function setAccessTokenCookie(res: Response, token: string, opts?: CookieOpts) {
  res.cookie("access_token", token, accessCookieOptions(opts));
}

export function clearAccessTokenCookie(res: Response) {
  // IMPORTANT: must match cookie attributes used in setAccessTokenCookie
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    domain: cookieDomain(),
    expires: new Date(0),
  });

  // Extra safety: if COOKIE_DOMAIN is set later/changed, clear host-only too
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    expires: new Date(0),
  });
}
