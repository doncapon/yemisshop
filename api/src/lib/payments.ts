


import { randomBytes } from 'crypto';

export function isFresh(createdAt: Date, ttlMin = 60) {
  return createdAt.getTime() + ttlMin * 60_000 > Date.now();
}

export const toNumber = (d: any) =>
  typeof d?.toNumber === 'function' ? d.toNumber() : Number(d);

// Strong, order/user-scoped reference generator (hard to collide/predict)
// Crockford’s Base32 (no I, L, O, U)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // length 32

// Encode exactly 5 random bytes (40 bits) -> 8 chars (8 × 5 bits = 40 bits)
export function generateRef8(): string {
  const b = randomBytes(5); // 40 bits
  const v =
    (b[0] << 32) |
    (b[1] << 24) |
    (b[2] << 16) |
    (b[3] << 8) |
    b[4];

  // Extract eight 5-bit chunks (from MSB to LSB)
  const chars = Array.from({ length: 8 }, (_, i) => {
    const shift = (7 - i) * 5;
    const idx = (v >>> shift) & 0b11111; // 0..31
    return ALPHABET[idx];
  });

  // Optional tiny safeguard to avoid silly sequences like all zeros:
  const out = chars.join('');
  return out === '00000000' ? generateRef8() : out;
}