// src/lib/jwt.ts
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js'; // must expose env.jwtSecret

const SECRET = env.jwtSecret; // e.g. process.env.JWT_SECRET
export type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SUPER_USER' | 'SHOPPER';

export function signJwt(
  user: { id: string; role: Role; email?: string },
  expiresIn: string | number = '7d'
) {
  // standard claim: sub = user id
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.jwtSecret, { expiresIn });
}

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

type BaseClaims = { id: string; email: string; role: string };
export type AccessClaims = BaseClaims & { scope: 'access' };
export type VerifyClaims = BaseClaims & { scope: 'verify' };

export function signAccessJwt(c: BaseClaims, ttl = '7d') {
  return jwt.sign({ ...c, scope: 'access' } as AccessClaims, JWT_SECRET, { expiresIn: ttl });
}
export function signVerifyJwt(c: BaseClaims, ttl = '30m') {
  return jwt.sign({ ...c, scope: 'verify' } as VerifyClaims, JWT_SECRET, { expiresIn: ttl });
}

export function verifyJwt<T = any>(token: string): T {
  return jwt.verify(token, JWT_SECRET) as T;
}
