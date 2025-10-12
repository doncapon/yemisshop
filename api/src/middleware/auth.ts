import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export type AuthedRequest = Request & { user?: { id: string; role: string; email: string } };

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || '';                 // <-- lower-case
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing token' });

  const token = m[1];
  try {
    const secret = process.env.JWT_SECRET || 'devsecret';      // must match the one used in signJwt()
    const payload = jwt.verify(token, secret) as any;
    req.user = { id: payload.id, role: payload.role, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}