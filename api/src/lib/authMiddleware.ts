// src/lib/authMiddleware.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from './jwt.js';

export type Role = 'ADMIN' | 'SUPPLIER' | 'SHOPPER';

export type JwtClaims = {
  id: string;
  sub: string;
  role?: Role;
};

export type AuthedUser = {
  id: string;
  email?: string;
  role?: Role;
};

export type AuthedRequest = Request & {
  user?: AuthedUser;
};

/**
 * Strict auth: requires a valid Bearer token.
 * Attaches req.user = { id, email?, role? } from JWT claims.
 */
export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Missing Authorization header' });

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Invalid Authorization header' });
  }

  try {
    const claims = verifyJwt(token);
    if (!claims?.id) return res.status(401).json({ error: 'Invalid token payload' });

    req.user = { id: claims.id, email: claims.email, role: claims.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional auth: attaches req.user if Bearer token is present & valid,
 * otherwise continues unauthenticated.
 */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return next();

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const claims = verifyJwt(token);
    if (claims?.id) {
      req.user = { id: claims.id, email: claims.email, role: claims.role };
    }
  } catch {
    // ignore invalid token in optional mode
  }
  next();
}

/**
 * Role guard: require one of the given roles (after authMiddleware).
 * Example:
 *   router.get('/admin', authMiddleware, requireRole(['ADMIN']), handler)
 */
export function requireRole(roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
