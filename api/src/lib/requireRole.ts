// src/lib/requireRole.ts
import type { Request, Response, NextFunction } from 'express';

export function requireRole(...roles: Array<'ADMIN' | 'SUPER_ADMIN' | 'SUPER_USER' | 'SHOPPER'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req as any).user?.role as string | undefined;
    if (!role) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(role as any)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
