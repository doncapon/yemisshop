// src/lib/authMiddleware.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export type Role = 'SHOPPER' | 'ADMIN' | 'SUPER_ADMIN' | 'SUPPLIER';

export type TokenKind = "access" | "verify";

export type AuthedUser = {
  id: string;
  email: string;
  role: Role;

  // ✅ change #2: preserve token kind for requireAuth/requireVerifySession
  k?: TokenKind | string;

  // ✅ change #3: session id for access tokens
  sid?: string | null;
};


declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const AUTH_DEBUG = String(process.env.AUTH_DEBUG || '').toLowerCase() === 'true';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const IDLE_MINUTES_DEFAULT = 60;  // shopper default
const IDLE_MINUTES_ADMIN = 20;    // admin/supplier default

function idleMinutesForRole(role: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN" || role === "SUPPLIER"
    ? IDLE_MINUTES_ADMIN
    : IDLE_MINUTES_DEFAULT;
}


/* ---------- helpers ---------- */

function normalizeRole(r?: string | null): Role | null {
  if (!r) return null;
  const v = r.replace(/[\s-]/g, '').toUpperCase();
  if (v === 'SUPERADMIN' || v === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  if (v === 'ADMIN') return 'ADMIN';
  if (v === 'SUPPLIER') return 'SUPPLIER'; // ✅ FIX: recognize supplier
  if (v === 'SHOPPER' || v === 'USER') return 'SHOPPER';
  return null;
}

function getToken(req: Request): string | null {
  // 1) Authorization: Bearer
  const h = req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();

  // 2) cookies (requires app.use(cookieParser()))
  const c1 = (req as any).cookies?.access_token;
  const c2 = (req as any).cookies?.token;
  return c1 || c2 || null;
}

/**
 * Verify JWT and (optionally) reload user from DB to get current role/email.
 * Ensures we always return an AuthedUser with non-nullable email & role.
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

    const emailFromToken = payload.email ?? payload.upn ?? payload.preferred_username;
    const email = (db?.email ?? emailFromToken ?? "").toString();

    const roleFromDb = normalizeRole(db?.role);
    const roleFromToken = normalizeRole(payload.role);
    const role: Role = (roleFromDb ?? roleFromToken ?? "SHOPPER") as Role;

    // ✅ change #3: if this is an access token and it has sid, validate the session
    if (String(k || "") === "access" && sid) {
      const sess = await (prisma as any).userSession.findFirst({
        where: {
          id: String(sid),
          userId: String(id),
          revokedAt: null,
        },
        select: { id: true, lastSeenAt: true },
      });

      if (!sess) return null;

      if (String(k || "") === "access" && sid) {
        const sess = await prisma.userSession.findFirst({
          where: { id: String(sid), userId: String(id), revokedAt: null },
          select: { id: true, lastSeenAt: true, createdAt: true, expiresAt: true },
        });

        if (!sess) return null;

        const now = new Date();

        // ✅ absolute expiry
        if (sess.expiresAt && +sess.expiresAt <= +now) return null;

        // ✅ idle expiry
        const idleMs = idleMinutesForRole(role) * 60_000;
        const last = sess.lastSeenAt ? +new Date(sess.lastSeenAt) : 0;
        if (last && (+now - last) > idleMs) return null;

        // best-effort update lastSeenAt (throttle)
        if (!last || (+now - last) > 60_000) {
          await prisma.userSession.update({
            where: { id: String(sid) },
            data: { lastSeenAt: now },
          });
        }
      }


      // best-effort: update lastSeenAt at most once per minute
      const now = new Date();
      const last = sess.lastSeenAt ? +new Date(sess.lastSeenAt) : 0;
      if (!last || (+now - last) > 60_000) {
        await (prisma as any).userSession.update({
          where: { id: String(sid) },
          data: { lastSeenAt: now },
        });
      }
    }

    return { id, email, role, k, sid };
  } catch (e) {
    if (AUTH_DEBUG) console.warn("[auth] jwt verify failed:", (e as any)?.message);
    return null;
  }
}


/* ---------- middlewares ---------- */

/**
 * Non-blocking: attach req.user if token present & valid; otherwise continue anonymous.
 * Use this first, then add `requireAuth` or `requireAdmin` on routes that need it.
 */
export const attachUser: RequestHandler = async (req, _res, next) => {
  const token = getToken(req);
  if (!token) return next();

  const user = await verifyAndHydrate(token);
  if (user) {
    req.user = user;
    if (AUTH_DEBUG) console.log('[auth] user attached:', user);
  } else if (AUTH_DEBUG) {
    console.log('[auth] token present but invalid');
  }
  next();
};

/** Hard requirement: must be authenticated. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const u = req.user as any;
  if (!u?.id) return res.status(401).json({ error: 'Unauthorized' });
  if (u.k && u.k !== 'access') return res.status(403).json({ error: 'Forbidden' });
  next();
}

export function requireVerifySession(req: Request, res: Response, next: NextFunction) {
  const u = req.user as any;
  if (!u?.id) return res.status(401).json({ error: 'Unauthorized' });

  // allow verify token OR full access token (handy if already logged in)
  if (u.k && u.k !== 'verify' && u.k !== 'access') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

/** Admin or Super Admin only. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const role = normalizeRole(req.user.role);
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

/** Super Admin only. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const role = normalizeRole(req.user.role);
  if (role === 'SUPER_ADMIN') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

/** Supplier only. */
export function requireSupplier(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const role = normalizeRole(req.user.role);
  if (role === 'SUPPLIER') return next();
  return res.status(403).json({ error: 'Forbidden' });
}
