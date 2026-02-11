// src/routes/authMe.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        phone: true,
        dateOfBirth: true,
        address: true,
        // @ts-ignore
        shippingAddress: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });
    if (!u) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status ?? 'PENDING',
      phone: u.phone ?? null,
      dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString() : null,
      address: u.address ?? null,
      shippingAddress: (u as any).shippingAddress ?? null,
      emailVerified: Boolean(u.emailVerifiedAt),
      phoneVerified: Boolean(u.phoneVerifiedAt),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
