// src/middleware/auth.ts (or src/lib/authMiddleware.ts, depending on your setup)
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

  // ✅ token kind
  k?: TokenKind | string;

  // ✅ session id for access tokens
  sid?: string | null;

  // ✅ optional: supplier context if you later attach it
  supplierId?: string | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const AUTH_DEBUG =
  String(process.env.AUTH_DEBUG || "").toLowerCase() === "true";
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
  const v = r.replace(/[\s-]/g, "").toUpperCase();

  if (v === "SUPERADMIN" || v === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (v === "ADMIN") return "ADMIN";
  if (v === "SUPPLIER") return "SUPPLIER";
  if (v === "SUPPLIERRIDER" || v === "SUPPLIER_RIDER") return "SUPPLIER_RIDER";
  if (v === "SHOPPER" || v === "USER") return "SHOPPER";
  return null;
}

function getToken(req: Request): string | null {
  // 1) Authorization: Bearer
  const h = req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim();

  // 2) cookies (requires app.use(cookieParser()))
  const c1 = (req as any).cookies?.access_token;
  const c2 = (req as any).cookies?.token;
  return c1 || c2 || null;
}

/**
 * Verify JWT and (optionally) use userSession for analytics/idle tracking.
 * IMPORTANT: Session lookup is **non-fatal**.
 * If anything about sessions is wrong, we still accept the JWT.
 */
async function verifyAndHydrate(token: string): Promise<AuthedUser | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;

    const id = payload.id ?? payload.userId ?? payload.sub;
    if (!id) return null;

    const k = payload.k; // "access" | "verify" (or undefined)
    const sid = payload.sid ?? null;

    // Refresh from DB to avoid stale role/email
    const db = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });

    const emailFromToken =
      payload.email ?? payload.upn ?? payload.preferred_username;
    const email = (db?.email ?? emailFromToken ?? "").toString();

    const roleFromDb = normalizeRole(db?.role);
    const roleFromToken = normalizeRole(payload.role);
    const role: Role = (roleFromDb ?? roleFromToken ?? "SHOPPER") as Role;

    // 🔍 Optional session checks – but **never** reject token because of them
    if (String(k || "") === "access" && sid) {
      const sessionDelegate = (prisma as any).userSession;

      if (!sessionDelegate?.findFirst) {
        if (AUTH_DEBUG) {
          console.warn(
            "[auth] userSession model not found – skipping session checks"
          );
        }
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
            // ⚠️ Just log for now; DO NOT return null
            if (AUTH_DEBUG) {
              console.warn(
                "[auth] no session row for token – allowing token anyway",
                {
                  userId: String(id),
                  sid: String(sid),
                  role,
                }
              );
            }
          } else {
            const now = new Date();

            // Absolute expiry: log if expired, but still allow for now
            if (sess.expiresAt && +sess.expiresAt <= +now) {
              if (AUTH_DEBUG) {
                console.warn(
                  "[auth] session expired – allowing token anyway (no hard block)",
                  {
                    userId: String(id),
                    sid: String(sid),
                    role,
                    expiresAt: sess.expiresAt,
                  }
                );
              }
            } else {
              // Idle tracking (best-effort)
              const idleMs = idleMinutesForRole(role) * 60_000;
              const last = sess.lastSeenAt ? +new Date(sess.lastSeenAt) : 0;

              if (last && +now - last > idleMs) {
                if (AUTH_DEBUG) {
                  console.warn(
                    "[auth] session idle timeout would have applied – but not blocking token",
                    {
                      userId: String(id),
                      sid: String(sid),
                      role,
                      lastSeenAt: sess.lastSeenAt,
                    }
                  );
                }
              }

              // Update lastSeenAt at most once per minute
              if (!last || +now - last > 60_000) {
                try {
                  await sessionDelegate.update({
                    where: { id: String(sid) },
                    data: { lastSeenAt: now },
                  });
                } catch (e) {
                  if (AUTH_DEBUG) {
                    console.warn(
                      "[auth] failed to bump lastSeenAt (non-fatal):",
                      (e as any)?.message
                    );
                  }
                }
              }
            }
          }
        } catch (e) {
          if (AUTH_DEBUG) {
            console.warn(
              "[auth] session lookup threw – allowing token anyway:",
              (e as any)?.message
            );
          }
        }
      }
    }

    // ✅ Final decision: JWT ok → user ok
    return { id: String(id), email, role, k, sid };
  } catch (e) {
    if (AUTH_DEBUG)
      console.warn("[auth] jwt verify failed:", (e as any)?.message);
    return null;
  }
}

/* ---------- middlewares ---------- */

/**
 * Non-blocking: attach req.user if token present & valid; otherwise continue anonymous.
 * Use this first, then add `requireAuth` or `requireAdmin` on routes that need it.
 */
export const attachUser: RequestHandler = async (req, _res, next) => {
  const token =
    req.cookies?.access_token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : null);


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

/** Hard requirement: must be authenticated. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const u = req.user as any;
  if (!u?.id) return res.status(401).json({ error: "Unauthorized" });
  if (u.k && u.k !== "access")
    return res.status(403).json({ error: "Forbidden" });
  next();
}

export function requireVerifySession(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const u = req.user as any;
  if (!u?.id) return res.status(401).json({ error: "Unauthorized" });

  // allow verify token OR full access token (handy if already logged in)
  if (u.k && u.k !== "verify" && u.k !== "access") {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}

/** Admin or Super Admin only. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  const role = normalizeRole(req.user.role);
  if (role === "ADMIN" || role === "SUPER_ADMIN") return next();
  return res.status(403).json({ error: "Forbidden" });
}

/** Super Admin only. */
export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  const role = normalizeRole(req.user.role);
  if (role === "SUPER_ADMIN") return next();
  return res.status(403).json({ error: "Forbidden" });
}

/** Supplier only. */
export function requireSupplier(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  const role = normalizeRole(req.user.role);
  if (role === "SUPPLIER") return next();
  return res.status(403).json({ error: "Forbidden" });
}
