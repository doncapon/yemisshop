// src/lib/jwt.ts
import jwt from 'jsonwebtoken'; // CJS default import
import { env } from '../config/env.js';

const SECRET = String(env.jwtSecret || 'change-me');

export function signJwt(payload: any, expiresIn: string | number = '7d'): string {
  // cast to any to avoid overload typing issues due to the shim
  return (jwt as any).sign(payload, SECRET, { expiresIn });
}

export function verifyJwt<T = any>(token: string): T {
  return (jwt as any).verify(token, SECRET) as T;
}
