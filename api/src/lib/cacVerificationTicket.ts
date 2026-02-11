// api/src/lib/cacVerificationTicket.ts
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';

export type CompanyType =
  | 'BUSINESS_NAME'
  | 'COMPANY'
  | 'INCORPORATED_TRUSTEES'
  | 'LIMITED_PARTNERSHIP'
  | 'LIMITED_LIABILITY_PARTNERSHIP';

function sha256Hex(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function normalizeName(s: string) {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Mint a single-use ticket (stored hashed in DB).
 * Token is returned to client, only hash is stored.
 */
export async function mintCacVerificationTicket(args: {
  rcNumber: string;
  companyType: CompanyType;
  companyNameNorm: string;
  regDateYMD: string; // YYYY-MM-DD
  ttlMinutes?: number; // default 10
}) {
  const ttl = args.ttlMinutes ?? 10;
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 60_000);

  await prisma.cacVerificationTicket.create({
    data: {
      tokenHash,
      rcNumber: args.rcNumber,
      companyType: args.companyType as any,
      companyNameNorm: args.companyNameNorm,
      regDateYMD: args.regDateYMD,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

/**
 * Consume (single-use) ticket. Call this inside your register-supplier route.
 * It validates: exists, not expired, not used, and matches the asserted rc/type/name/date.
 */
export async function consumeCacVerificationTicket(args: {
  token: string;
  rcNumber: string;
  companyType: CompanyType;
  companyNameNorm: string;
  regDateYMD: string;
}) {
  const tokenHash = sha256Hex(args.token);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const rec = await tx.cacVerificationTicket.findUnique({
      where: { tokenHash },
    });

    if (!rec) return { ok: false as const, reason: 'NOT_FOUND' as const };
    if (rec.usedAt) return { ok: false as const, reason: 'ALREADY_USED' as const };
    if (rec.expiresAt.getTime() <= now.getTime())
      return { ok: false as const, reason: 'EXPIRED' as const };

    // Must match the same identity constraints
    if (
      rec.rcNumber !== args.rcNumber ||
      rec.companyType !== (args.companyType as any) ||
      rec.companyNameNorm !== args.companyNameNorm ||
      rec.regDateYMD !== args.regDateYMD
    ) {
      return { ok: false as const, reason: 'MISMATCH' as const };
    }

    await tx.cacVerificationTicket.update({
      where: { tokenHash },
      data: { usedAt: now },
    });

    return { ok: true as const };
  });
}
