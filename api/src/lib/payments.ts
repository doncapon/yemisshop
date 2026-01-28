


import { randomBytes } from 'crypto';

export function isFresh(createdAt: Date, ttlMin = 60) {
  return createdAt.getTime() + ttlMin * 60_000 > Date.now();
}

export const toNumber = (d: any) =>
  typeof d?.toNumber === 'function' ? d.toNumber() : Number(d);

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateRef8(): string {
  const b = randomBytes(5);

  const v =
    (BigInt(b[0]) << 32n) |
    (BigInt(b[1]) << 24n) |
    (BigInt(b[2]) << 16n) |
    (BigInt(b[3]) << 8n)  |
     BigInt(b[4]);

  let out = "";
  for (let i = 0; i < 8; i++) {
    const shift = BigInt((7 - i) * 5);
    const idx = Number((v >> shift) & 31n);
    out += ALPHABET[idx];
  }

  return out === "00000000" ? generateRef8() : out;
}
