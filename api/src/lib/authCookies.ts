import type { Response } from "express";

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME?.trim() || "ds_access";

type SameSite = "lax" | "strict" | "none";

function isProd() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function inferSameSite(): SameSite {
  // Default to Lax (your request)
  const v = String(process.env.COOKIE_SAMESITE || "")
    .trim()
    .toLowerCase();

  if (v === "lax" || v === "strict" || v === "none") return v;
  return "lax";
}

function inferSecureFromEnv() {
  // In production, always Secure unless explicitly forced off (not recommended).
  // If you want to force secure in staging too, set COOKIE_SECURE=true.
  const v = String(process.env.COOKIE_SECURE || "").trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return isProd();
}

function inferCookieDomain(): string | undefined {
  // ✅ Best practice:
  // - On Railway default *.up.railway.app domain: DO NOT set Domain at all (host-only cookie)
  // - On your custom domain: set COOKIE_DOMAIN=.dayspringhouse.com (or rely on prod default below)
  const env = String(process.env.COOKIE_DOMAIN || "").trim();
  if (env) return env;

  // Your requested production default:
  if (isProd()) return ".dayspringhouse.com";

  // Dev (localhost): no domain attribute
  return undefined;
}

export function setAccessTokenCookie(
  res: Response,
  token: string,
  opts?: { maxAgeDays?: number }
) {
  const sameSite = inferSameSite(); // ✅ default "lax"
  const secure = inferSecureFromEnv(); // ✅ true in prod
  const domain = inferCookieDomain(); // ✅ ".dayspringhouse.com" in prod (or env)

  // If SameSite=None, Secure must be true (Chrome requirement)
  const finalSecure = sameSite === "none" ? true : secure;

  const maxAgeDays = Number(opts?.maxAgeDays ?? 30);
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: finalSecure,
    sameSite,
    path: "/",
    maxAge: maxAgeMs,
    ...(domain ? { domain } : {}), // ✅ only set when applicable
  });
}

export function clearAccessTokenCookie(res: Response) {
  const sameSite = inferSameSite();
  const secure = inferSecureFromEnv();
  const domain = inferCookieDomain();

  const finalSecure = sameSite === "none" ? true : secure;

  // IMPORTANT: options must match the ones used to set the cookie (esp domain/path/samesite/secure)
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: finalSecure,
    sameSite,
    path: "/",
    ...(domain ? { domain } : {}),
  });
}
