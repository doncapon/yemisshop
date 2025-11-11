// src/middleware/roles.ts
import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../types/role.js';

export function requireRole(required: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Forbidden: not authenticated' });
    }

    // adjust this logic to your role scheme
    if (req.user.role !== required && req.user.role !== 'SUPER_ADMIN') {
      return res
        .status(403)
        .json({ error: 'Forbidden: insufficient permissions' });
    }

    return next();
  };
}

export const requireAdmin = requireRole('ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');
