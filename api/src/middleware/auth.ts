// src/lib/authMiddleware.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { verifyJwt, AccessClaims, VerifyClaims } from '../lib/jwt.js';
import type { Role } from '../types/role.js'; // ← no ".ts" extension

// ---- Roles & claims --------------------------------------------------------

export type JwtClaims = {
  id: string;          // we put user id in JWT as `id`
  email?: string;
  role?: Role;
  sub?: string;        // optional (if you also set sub)
};

// What we attach to req.user
export type AuthedUser = {
  id: string;
  email?: string;
  role?: Role;
  scope?: string;
};


export type AuthedRequest = Request & {
  user?: { id: string; email?: string; role?: Role };
};

// ---- Global Express augmentation (so req.user is known everywhere) ----------

declare global {
  namespace Express {
    // This merges with express-serve-static-core's Request
    interface Request {
      user?: AuthedUser;
    }
  }
}

// ---- Middleware -------------------------------------------------------------

/**
 * Strict auth: requires a valid Bearer token.
 * Attaches req.user = { id, email?, role? } from JWT claims.
 */
export const authMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Missing Authorization header' });

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ error: 'Invalid Authorization header' });
  }

  try {
    const claims = verifyJwt(token);
    const userId = claims?.id || claims?.id;
    if (!userId) return res.status(401).json({ error: 'Invalid token payload' });

    req.user = { id: userId, email: claims.email, role: claims.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Optional auth: attaches req.user if Bearer token is present & valid,
 * otherwise continues unauthenticated.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header) return next();

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return next();

  try {
    const claims = verifyJwt(token);
    const userId = claims?.id || claims?.id;
    if (userId) {
      req.user = { id: userId, email: claims.email, role: claims.role };
    }
  } catch {
    // ignore invalid token in optional mode
  }
  next();
};

/**
 * Role guard: require one of the given roles (after authMiddleware).
 *
 * Example:
 *   router.get('/admin', authMiddleware, requireRole(['ADMIN']), handler)
 */
export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/* ---------- Config ---------- */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

/* ---------- Helpers ---------- */
function getBearerToken(req: Request): string | null {
  const hdr = req.headers.authorization || '';
  if (!hdr) return null;
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/* ---------- Middleware ---------- */
// authMiddleware.ts

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;

    const id =
      payload.id ??
      payload.userId ??
      payload.sub; // support common shapes

    const email =
      payload.email ??
      payload.upn ??
      payload.preferred_username ??
      '';

    const role = payload.role;

    if (!id || !role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = { id, email, role };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}


export function requireAccess(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const claims = verifyJwt<AccessClaims>(token);
    if (claims.scope !== 'access') return res.status(401).json({ error: 'Unauthorized' });

    // ✅ role is Role here (from AccessClaims). If your build still sees string, cast once:
    req.user = { id: claims.id, email: claims.email, role: claims.role as Role, scope: 'access' };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireVerifyScope(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const claims = verifyJwt<VerifyClaims>(token);
    if (claims.scope !== 'verify') return res.status(401).json({ error: 'Unauthorized' });

    req.user = { id: claims.id, email: claims.email, role: claims.role as Role, scope: 'verify' };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

//----------------------------

// declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role?: string; scope?: 'access' | 'verify' };
    }
  }

export const requireAdmin = requireRole(['ADMIN', 'SUPER_ADMIN']);
export const requireSuperAdmin = requireRole(['SUPER_ADMIN']);


export {};
