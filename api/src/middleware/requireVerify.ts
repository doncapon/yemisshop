// api/src/middleware/requireVerify.ts
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';

/**
 * What we want to enforce for this request.
 * - email: requires email to be verified
 * - phone: requires phone to be verified
 * - payment: requires both email & phone verified (derived)
 */
export type VerifyRequirements = {
  email?: boolean;
  phone?: boolean;
  payment?: boolean;
};

/**
 * This extends Request at runtime; if you have a global.d.ts you can formalize it.
 * We use a type cast here to avoid compile errors without changing your global types.
 */
type VerifBag = {
  email?: boolean;
  phone?: boolean;
  payment?: boolean;
};

export function requireVerified(
  want: VerifyRequirements = { email: true, phone: true } // default: both email & phone required
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Ensure we have a bag to cache computed flags on the request
      const bag = ((req as any).verifications ??= {}) as VerifBag;

      // If any flag we need is unknown, we’ll look the user up
      const needLookup =
        (want.email && bag.email === undefined) ||
        (want.phone && bag.phone === undefined) ||
        (want.payment && bag.payment === undefined);

      if (needLookup) {
        const userId = (req as any).user?.id as string | undefined;
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        // Only select columns that are known to exist in your User model
        const u = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
          },
        });

        if (!u) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Compute booleans and cache them on the request
        const emailOk = !!u.emailVerifiedAt;
        const phoneOk = !!u.phoneVerifiedAt;

        bag.email = emailOk;
        bag.phone = phoneOk;
        // Derive "payment" as both verified (adjust if you later add a real payment-verified flag)
        bag.payment = emailOk && phoneOk;
      }

      // Now enforce what this route wants
      const missing = {
        email: !!want.email && !bag.email,
        phone: !!want.phone && !bag.phone,
        payment: !!want.payment && !bag.payment,
      };

      if (missing.email || missing.phone || missing.payment) {
        return res.status(403).json({
          error: 'Account not fully verified. Please verify your email and phone to continue.',
          requires: {
            email: missing.email,
            phone: missing.phone,
            payment: missing.payment,
          },
        });
      }

      return next();
    } catch (err) {
      console.error('requireVerified error:', err);
      return res.status(500).json({ error: 'Verification check failed' });
    }
  };
}
