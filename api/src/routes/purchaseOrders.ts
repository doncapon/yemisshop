// src/routes/purchaseOrders.ts
import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

const PurchaseOrderStatus = z.enum([
  'CREATED',
  'PLACED',
  'PAID',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
]);

router.get(
  '/',
  authMiddleware,
  requireRole(['ADMIN']),
  async (_req, res, next) => {
    try {
      const pos = await prisma.purchaseOrder.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: true,
          items: { include: { orderItem: { include: { product: true } } } },
        },
      });
      res.json(pos);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
