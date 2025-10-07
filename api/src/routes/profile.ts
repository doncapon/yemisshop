// src/routes/profile.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../lib/authMiddleware.js';

const router = Router();

// Small helper so TypeScript is happy when reading req.user
function requireUserId(req: Request, res: Response): string | undefined {
  const u = (req as any).user as { id: string } | undefined;
  if (!u?.id) {
    res.status(401).json({ error: 'Unauthorized' });
    return undefined;
  }
  return u.id;
}

/**
 * Shape we return to the client (kept close to your Profile page needs)
 */
function toProfileDTO(u: any) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status ?? 'PENDING',
    name: u.name ?? null,
    phone: u.phone ?? null,
    dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString() : null,
    address: u.address ?? null,
    shippingAddress: u.shippingAddress ?? null, // if present in your schema

    // Booleans derived from *_VerifiedAt timestamps (adjust if you use other flags)
    emailVerified: Boolean(u.emailVerifiedAt),
    phoneVerified: Boolean(u.phoneVerifiedAt),

    // If you later add bank fields/table, include here
    bank: null as any, // keep interface stable for now
  };
}

/**
 * GET /api/profile
 * Returns the current user's profile snapshot.
 */
router.get(
  '/',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          name: true,
          phone: true,
          dateOfBirth: true,
          address: true,
          // include only if this column exists in your schema
          // @ts-ignore
          shippingAddress: true,

          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      });

      if (!u) return res.status(404).json({ error: 'User not found' });
      return res.json(toProfileDTO(u));
    } catch (e) {
      next(e);
    }
  }
);

/**
 * PUT /api/profile
 * Update a subset of editable fields.
 * - dateOfBirth is ISO date string (YYYY-MM-DD or full ISO)
 */
const UpdateProfileSchema = z.object({
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  dateOfBirth: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || !Number.isNaN(+new Date(v)),
      'dateOfBirth must be a valid date string'
    ),
  address: z.string().trim().nullable().optional(),
  shippingAddress: z.string().trim().nullable().optional(), // if present
  // If you later add bank fields/table, extend here
  // bank: z.object({ bankName: z.string().nullable().optional(), ... }).optional()
});

router.put(
  '/',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { phone, dateOfBirth, address, shippingAddress } =
        UpdateProfileSchema.parse(req.body);

      const data: Record<string, any> = {
        phone: phone ?? null,
        address: address ?? null,
      };

      // Only include shippingAddress if your schema has it.
      // If your User model does not have this column yet, remove this line.
      (data as any).shippingAddress = shippingAddress ?? null;

      if (dateOfBirth === undefined) {
        // untouched
      } else if (dateOfBirth === null || dateOfBirth === '') {
        data.dateOfBirth = null;
      } else {
        // Accept both 'YYYY-MM-DD' and full ISO
        const d = new Date(dateOfBirth);
        if (Number.isNaN(+d)) {
          return res.status(400).json({ error: 'Invalid dateOfBirth' });
        }
        data.dateOfBirth = d;
      }

      const u = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          name: true,
          phone: true,
          dateOfBirth: true,
          address: true,
          // @ts-ignore
          shippingAddress: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      });

      return res.json(toProfileDTO(u));
    } catch (e) {
      next(e);
    }
  }
);

export default router;
