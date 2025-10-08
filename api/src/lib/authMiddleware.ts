// src/lib/authMiddleware.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyJwt } from './jwt.js';

// ---- Roles & claims ---------------------------------------------------------

export type Role = 'ADMIN' | 'SUPPLIER' | 'SHOPPER';

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
export function requireRole(roles: Role[]): RequestHandler {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

export {};
