import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { z } from 'zod';

const router = Router();

// Admin: list all POs
router.get('/', auth(), requireRole('ADMIN'), async (_req, res) => {
  const pos = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    include: { supplier: true, items: { include: { orderItem: { include: { product: true } } } } }
  });
  res.json(pos);
});

// Supplier: my POs
router.get('/mine', auth(), requireRole('SUPPLIER'), async (req: any, res) => {
  const supplier = await prisma.supplier.findFirst({ where: { userId: req.user!.id } });
  if (!supplier) return res.status(404).json({ error: 'Supplier profile not found' });
  const pos = await prisma.purchaseOrder.findMany({
    where: { supplierId: supplier.id },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { orderItem: { include: { product: true } } } } }
  });
  res.json(pos);
});

// Supplier/Admin: update status
const statusSchema = z.object({ status: z.enum(['PENDING','DISPATCHED','DELIVERED','CANCELLED']) });
router.patch('/:id/status', auth(), requireRole('SUPPLIER','ADMIN'), async (req: any, res) => {
  // If supplier, enforce ownership
  if (req.user.role === 'SUPPLIER') {
    const supplier = await prisma.supplier.findFirst({ where: { userId: req.user.id } });
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!supplier || !po || po.supplierId !== supplier.id) return res.status(403).json({ error: 'Forbidden' });
  }
  const { status } = statusSchema.parse(req.body);
  const updated = await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: { status } });
  res.json(updated);
});

export default router;
