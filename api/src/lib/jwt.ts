// src/lib/jwt.ts
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

type Role = 'SHOPPER' | 'ADMIN' | 'SUPER_ADMIN';

type BaseClaims = {
  id: string;
  email?: string;
  role?: Role;
};

// Access tokens for the frontend (Bearer <token>)
export function signAccessJwt(claims: BaseClaims, expiresIn: string | number = '7d') {
  // Avoid typing Algorithm explicitly to stay compatible with various typings
  return jwt.sign(claims, JWT_SECRET, { algorithm: 'HS256', expiresIn });
}

// Generic signer (if you need it elsewhere)
export function signJwt(payload: object, expiresIn: string | number = '1h') {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn });
}
