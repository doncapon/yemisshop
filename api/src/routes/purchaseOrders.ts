// src/routes/purchaseOrders.ts
import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../lib/authMiddleware.js';

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

router.get(
  '/mine',
  authMiddleware,
  requireRole(['SUPPLIER']),
  async (req: Request, res, next) => {
    try {
      const supplier = await prisma.supplier.findFirst({
        where: { userId: req.user!.id },
      });
      if (!supplier) return res.status(404).json({ error: 'Supplier profile not found' });

      const pos = await prisma.purchaseOrder.findMany({
        where: { supplierId: supplier.id },
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { orderItem: { include: { product: true } } } },
        },
      });
      res.json(pos);
    } catch (e) {
      next(e);
    }
  }
);

const statusSchema = z.object({ status: PurchaseOrderStatus });

router.patch(
  '/:id/status',
  authMiddleware,
  requireRole(['SUPPLIER', 'ADMIN']),
  async (req: Request, res, next) => {
    try {
      const { status } = statusSchema.parse(req.body);

      if (req.user?.role === 'SUPPLIER') {
        const supplier = await prisma.supplier.findFirst({ where: { userId: req.user.id } });
        const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
        if (!supplier || !po || po.supplierId !== supplier.id) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: { status },
      });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
