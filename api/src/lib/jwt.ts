// src/lib/jwt.ts
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js'; // must expose env.jwtSecret

const SECRET = env.jwtSecret; // e.g. process.env.JWT_SECRET
export type Role = 'ADMIN' | 'SUPPLIER' | 'SHOPPER';

export function signJwt(
  user: { id: string; role: Role; email?: string },
  expiresIn: string | number = '7d'
) {
  // standard claim: sub = user id
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.jwtSecret, { expiresIn });
}


export function verifyJwt(token: string): { id: string; role: Role; email: string} {
  const decoded = jwt.verify(token, SECRET);
  if (typeof decoded !== 'object' || !decoded) throw new Error('bad jwt');

  // accept both legacy `id` and preferred `sub`
  const id = (decoded as any).sub ?? (decoded as any).id;
  const email = (decoded as any).email  as string | "";
  const role = (decoded as any).role as Role | undefined;

  if (typeof id !== 'string' || !role) throw new Error('claims missing');
  return { id, role, email };
}
