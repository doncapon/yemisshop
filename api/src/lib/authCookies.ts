// api/src/lib/authCookies.ts
import type { Response } from "express";

const COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || "ds_access";

function isLocalUrl(u?: string) {
  if (!u) return true;
  const s = String(u).toLowerCase();
  return s.includes("localhost") || s.includes("127.0.0.1") || s.includes("0.0.0.0");
}

function isProdRuntime() {
  const nodeProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || "";
  const apiUrl = process.env.API_URL || "";
  const local = isLocalUrl(appUrl) || isLocalUrl(apiUrl);
  return nodeProd && !local;
}

const isProd = isProdRuntime();

function cookieDomain(): string | undefined {
  const raw = (process.env.COOKIE_DOMAIN || "").trim();
  if (!raw) return undefined;
  // Never set cookie domain for localhost/127.*
  return isProd ? raw : undefined;
}

export function setAccessTokenCookie(res: Response, token: string, opts?: { maxAgeDays?: number }) {
  const maxAgeDays = opts?.maxAgeDays ?? 30;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd, // false locally, true on HTTPS prod
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: maxAgeMs,
    domain: cookieDomain(),
  });
}

export function clearAccessTokenCookie(res: Response) {
  // Keep for backward compatibility (but clearAuthCookies is the real fix)
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    domain: cookieDomain(),
  });
}

/**
 * ✅ Robust cookie clearing:
 * Browsers sometimes require the delete Set-Cookie to match the original cookie’s
 * path/domain/samesite/secure combo. So we clear many combos safely.
 */
export function clearAuthCookies(res: Response) {
  const domains = [cookieDomain(), undefined].filter((x, i, a) => a.indexOf(x) === i);
  const paths = ["/", "/api"];
  const sameSites: Array<"lax" | "none"> = ["lax", "none"];
  const secures = [false, true];

  for (const domain of domains) {
    for (const path of paths) {
      for (const sameSite of sameSites) {
        for (const secure of secures) {
          // overwrite cookie with immediate expiry
          res.cookie(COOKIE_NAME, "", {
            httpOnly: true,
            secure,
            sameSite,
            path,
            domain,
            expires: new Date(0),
            maxAge: 0,
          });
        }
      }
    }
  }

  // If you ever had legacy names, clear them too (harmless if absent)
  const legacyNames = ["access_token", "accessToken", "dsAccess", "token"];
  for (const name of legacyNames) {
    for (const domain of domains) {
      for (const path of paths) {
        for (const sameSite of sameSites) {
          for (const secure of secures) {
            res.cookie(name, "", {
              httpOnly: true,
              secure,
              sameSite,
              path,
              domain,
              expires: new Date(0),
              maxAge: 0,
            });
          }
        }
      }
    }
  }
}

export function getAccessTokenCookieName() {
  return COOKIE_NAME;
}