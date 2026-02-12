// src/middleware/auth.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

export type Role =
  | "SHOPPER"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "SUPPLIER"
  | "SUPPLIER_RIDER";

export type TokenKind = "access" | "verify";

export type AuthedUser = {
  id: string;
  email: string;
  role: Role;

  // token kind
  k?: TokenKind | string;

  // session id (optional)
  sid?: string | null;

  // optional supplier context
  supplierId?: string | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const AUTH_DEBUG = String(process.env.AUTH_DEBUG || "").toLowerCase() === "true";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const IDLE_MINUTES_DEFAULT = 60; // shopper default
const IDLE_MINUTES_ADMIN = 20; // admin/supplier/rider default

function idleMinutesForRole(role: string) {
  return role === "ADMIN" ||
    role === "SUPER_ADMIN" ||
    role === "SUPPLIER" ||
    role === "SUPPLIER_RIDER"
    ? IDLE_MINUTES_ADMIN
    : IDLE_MINUTES_DEFAULT;
}

/* ---------- helpers ---------- */

function normalizeRole(r?: string | null): Role | null {
  if (!r) return null;
  const v = String(r).replace(/[\s-]/g, "").toUpperCase();

  if (v === "SUPERADMIN" || v === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (v === "ADMIN") return "ADMIN";
  if (v === "SUPPLIER") return "SUPPLIER";
  if (v === "SUPPLIERRIDER" || v === "SUPPLIER_RIDER") return "SUPPLIER_RIDER";
  if (v === "SHOPPER" || v === "USER") return "SHOPPER";
  return null;
}

function getToken(req: Request): string | null {
  // 1) Authorization: Bearer <token>  (preferred)
  const h = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, "").trim();

  // 2) cookies (optional fallback — not relied upon for Option A)
  const c1 = (req as any).cookies?.access_token;
  const c2 = (req as any).cookies?.token;
  return c1 || c2 || null;
}

/**
 * Verify JWT and optionally do userSession analytics/idle bump.
 * Session lookup is best-effort and NON-FATAL.
 */
async function verifyAndHydrate(token: string): Promise<AuthedUser | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;

    const id = payload.id ?? payload.userId ?? payload.sub;
    if (!id) return null;

    const k = payload.k; // "access" | "verify" (or undefined)
    const sid = payload.sid ?? null;

    // refresh from DB (role/email)
    const db = await prisma.user.findUnique({
      where: { id: String(id) },
      select: { id: true, email: true, role: true },
    });

    const emailFromToken = payload.email ?? payload.upn ?? payload.preferred_username;
    const email = String(db?.email ?? emailFromToken ?? "");

    const roleFromDb = normalizeRole(db?.role);
    const roleFromToken = normalizeRole(payload.role);
    const role: Role = (roleFromDb ?? roleFromToken ?? "SHOPPER") as Role;

    // optional session checks (non-fatal)
    if (String(k || "") === "access" && sid) {
      const sessionDelegate = (prisma as any).userSession;

      if (!sessionDelegate?.findFirst) {
        if (AUTH_DEBUG) console.warn("[auth] userSession model not found – skipping session checks");
      } else {
        try {
          const sess = await sessionDelegate.findFirst({
            where: {
              id: String(sid),
              userId: String(id),
              revokedAt: null,
            },
            select: {
              id: true,
              lastSeenAt: true,
              createdAt: true,
              expiresAt: true,
            },
          });

          if (!sess) {
            if (AUTH_DEBUG) {
              console.warn("[auth] no session row for token – allowing token anyway", {
                userId: String(id),
                sid: String(sid),
                role,
              });
            }
          } else {
            const now = new Date();

            // absolute expiry (log only)
            if (sess.expiresAt && +sess.expiresAt <= +now) {
              if (AUTH_DEBUG) {
                console.warn("[auth] session expired – allowing token anyway", {
                  userId: String(id),
                  sid: String(sid),
                  role,
                  expiresAt: sess.expiresAt,
                });
              }
            } else {
              // idle tracking (log only)
              const idleMs = idleMinutesForRole(role) * 60_000;
              const last = sess.lastSeenAt ? +new Date(sess.lastSeenAt) : 0;

              if (last && +now - last > idleMs) {
                if (AUTH_DEBUG) {
                  console.warn("[auth] session idle timeout would apply (not blocking)", {
                    userId: String(id),
                    sid: String(sid),
                    role,
                    lastSeenAt: sess.lastSeenAt,
                  });
                }
              }

              // bump lastSeenAt at most once per minute
              if (!last || +now - last > 60_000) {
                try {
                  await sessionDelegate.update({
                    where: { id: String(sid) },
                    data: { lastSeenAt: now },
                  });
                } catch (e) {
                  if (AUTH_DEBUG) {
                    console.warn("[auth] failed to bump lastSeenAt (non-fatal):", (e as any)?.message);
                  }
                }
              }
            }
          }
        } catch (e) {
          if (AUTH_DEBUG) {
            console.warn("[auth] session lookup threw – allowing token anyway:", (e as any)?.message);
          }
        }
      }
    }

    return { id: String(id), email, role, k, sid };
  } catch (e) {
    if (AUTH_DEBUG) console.warn("[auth] jwt verify failed:", (e as any)?.message);
    return null;
  }
}

/* ---------- middlewares ---------- */

/**
 * Non-blocking: attaches req.user if token is present & valid.
 */
export const attachUser: RequestHandler = async (req, _res, next) => {
  const token = getToken(req);
  if (!token) return next();

  const user = await verifyAndHydrate(token);
  if (user) {
    req.user = user;
    if (AUTH_DEBUG) console.log("[auth] user attached:", user);
  } else if (AUTH_DEBUG) {
    console.log("[auth] token present but invalid");
  }

  next();
};

/** Must be authenticated with an access token (or token without k). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const u = req.user as any;
  if (!u?.id) return res.status(401).json({ error: "Unauthorized" });

  // If token has a kind, enforce it
  if (u.k && u.k !== "access") return res.status(403).json({ error: "Forbidden" });

  next();
}

/** Used for OTP verify routes — allow verify OR access. */
export function requireVerifySession(req: Request, res: Response, next: NextFunction) {
  const u = req.user as any;
  if (!u?.id) return res.status(401).json({ error: "Unauthorized" });

  if (u.k && u.k !== "verify" && u.k !== "access") {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  const role = normalizeRole(req.user.role);
  if (role === "ADMIN" || role === "SUPER_ADMIN") return next();
  return res.status(403).json({ error: "Forbidden" });
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  const role = normalizeRole(req.user.role);
  if (role === "SUPER_ADMIN") return next();
  return res.status(403).json({ error: "Forbidden" });
}

export function requireSupplier(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  const role = normalizeRole(req.user.role);
  if (role === "SUPPLIER") return next();
  return res.status(403).json({ error: "Forbidden" });
}
