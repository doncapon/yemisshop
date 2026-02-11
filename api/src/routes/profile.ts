// api/src/routes/profile.ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const addressSchema = z.object({
  houseNumber: z.string().min(1),
  streetName:  z.string().min(1),
  postCode:    z.string().optional().default(''),
  town:        z.string().optional().default(''),
  city:        z.string().min(1),
  state:       z.string().min(1),
  country:     z.string().min(1),
});

/**
 * GET /api/profile/me
 * (You said you already have this; keeping here for completeness)
 */
router.get('/me', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      firstName: true,
      middleName: true,
      lastName: true,
      phone: true,
      status: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      dateOfBirth: true,
      // NOTE: field names below match what your Checkout expects:
      address: {
        select: {
          id: true, houseNumber: true, streetName: true, postCode: true,
          town: true, city: true, state: true, country: true
        }
      },
      shippingAddress: {
        select: {
          id: true, houseNumber: true, streetName: true, postCode: true,
          town: true, city: true, state: true, country: true
        }
      },
      createdAt: true,
    },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Frontend expects { address, shippingAddress }
  res.json({
    address: user.address,
    shippingAddress: user.shippingAddress,
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
  });
});

/**
 * POST /api/profile/address
 * Save (upsert) HOME address and attach to user
 */
router.post('/address', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const data = addressSchema.parse(req.body);

    const saved = await prisma.$transaction(async (tx) => {
      // create a new address
      const addr = await tx.address.create({ data });
      // attach to user
      await tx.user.update({
        where: { id: userId },
        data: { addressId: addr.id },
      });
      return addr;
    });

    res.json(saved);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/profile/shipping
 * Save (upsert) SHIPPING address and attach to user
 */
router.post('/shipping', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const data = addressSchema.parse(req.body);

    const saved = await prisma.$transaction(async (tx) => {
      const addr = await tx.address.create({ data });
      await tx.user.update({
        where: { id: userId },
        data: { shippingAddressId: addr.id },
      });
      return addr;
    });

    res.json(saved);
  } catch (e) {
    next(e);
  }
});

export default router;
