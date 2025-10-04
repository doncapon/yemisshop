import { Request, Response, NextFunction } from 'express';
import { verifyJwt, Role } from '../lib/jwt.js';

export type AuthedRequest = Request & { user?: { id: string; role: string } };

export function auth(required = true) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header) {
      if (!required) return next();
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const token = header.replace(/^Bearer\s+/i, '');
    console.log(token)
    try {
      const payload = verifyJwt(token);
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}
