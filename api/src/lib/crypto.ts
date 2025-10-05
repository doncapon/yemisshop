// src/lib/crypto.ts
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export function randomToken(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

export function randomOtp(length = 6) {
  const n = Math.pow(10, length - 1);
  return String(Math.floor(n + Math.random() * 9 * n)); // 6-digit
}

export async function hash(value: string) {
  return bcrypt.hash(value, 10);
}

export async function verifyHash(value: string, hashed: string) {
  return bcrypt.compare(value, hashed);
}
