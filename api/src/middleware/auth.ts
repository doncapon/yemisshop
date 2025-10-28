// src/lib/authMiddleware.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export type Role = 'SHOPPER' | 'ADMIN' | 'SUPER_ADMIN';

export type AuthedUser = {
  id: string;
  email: string; // non-nullable per Option A
  role: Role;    // non-nullable per Option A
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

/* ---------- helpers ---------- */

function normalizeRole(r?: string | null): Role | null {
  if (!r) return null;
  const v = r.replace(/[\s-]/g, '').toUpperCase();
  if (v === 'SUPERADMIN' || v === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  if (v === 'ADMIN') return 'ADMIN';
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

    // Refresh from DB to avoid stale role/email
    const db = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });

    const emailFromToken =
      payload.email ?? payload.upn ?? payload.preferred_username;

    const email = (db?.email ?? emailFromToken ?? '').toString();

    const roleFromDb = normalizeRole(db?.role);
    const roleFromToken = normalizeRole(payload.role);
    const role: Role = (roleFromDb ?? roleFromToken ?? 'SHOPPER') as Role;

    return { id, email, role };
  } catch (e) {
    if (AUTH_DEBUG) console.warn('[auth] jwt verify failed:', (e as any)?.message);
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
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
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
