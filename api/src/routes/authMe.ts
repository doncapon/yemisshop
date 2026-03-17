// src/routes/authMe.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';

const router = Router();


router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const authMeSelect = {
      id: true,
      email: true,
      role: true,
      status: true,
      phone: true,
      dateOfBirth: true,
      address: true,
      defaultShippingAddressId: true,
      defaultShippingAddress: true,
      shippingAddresses: {
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      },
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    } satisfies Prisma.UserSelect;

    type AuthMeUser = Prisma.UserGetPayload<{
      select: typeof authMeSelect;
    }>;

    const u: AuthMeUser | null = await prisma.user.findUnique({
      where: { id: userId },
      select: authMeSelect,
    });

    if (!u) return res.status(404).json({ error: "User not found" });

    const primaryShippingAddress =
      u.defaultShippingAddress ??
      u.shippingAddresses.find((a) => a.isDefault) ??
      u.shippingAddresses[0] ??
      null;

    res.json({
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status ?? "PENDING",
      phone: u.phone ?? null,
      dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString() : null,
      address: u.address ?? null,

      // legacy + new shape
      shippingAddress: primaryShippingAddress,
      shippingAddresses: u.shippingAddresses ?? [],
      defaultShippingAddressId:
        u.defaultShippingAddressId ?? primaryShippingAddress?.id ?? null,

      emailVerified: Boolean(u.emailVerifiedAt),
      phoneVerified: Boolean(u.phoneVerifiedAt),
    });
  } catch (e) {
    next(e);
  }
});


export default router;
