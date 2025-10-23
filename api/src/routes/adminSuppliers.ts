// server/routes/adminSuppliers.ts
import { Router } from 'express';
import { PrismaClient, SupplierType } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// If you already have these middlewares, reuse them:
const requireAuth = (req: any, res: any, next: any) => (req.user ? next() : res.status(401).json({ error: 'Unauthorized' }));
const requireAdmin = (req: any, res: any, next: any) =>
  req.user && (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') ? next() : res.status(403).json({ error: 'Forbidden' });
const requireSuper = (req: any, res: any, next: any) => (req.user?.role === 'SUPER_ADMIN' ? next() : res.status(403).json({ error: 'Forbidden' }));

// GET /api/admin/suppliers
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({ data: suppliers });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to fetch suppliers' });
  }
});

// POST /api/admin/suppliers
router.post('/', requireSuper, async (req, res) => {
  try {
    const { name, type = 'PHYSICAL', status = 'ACTIVE', contactEmail, whatsappPhone } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const created = await prisma.supplier.create({
      data: {
        name: String(name),
        type: type in SupplierType ? type : SupplierType.PHYSICAL,
        status: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        contactEmail: contactEmail || null,
        whatsappPhone: whatsappPhone || null,
      },
    });
    res.status(201).json({ data: created });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create supplier' });
  }
});

// PUT /api/admin/suppliers/:id
router.put('/:id', requireSuper, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, status, contactEmail, whatsappPhone } = req.body || {};

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name != null ? { name: String(name) } : {}),
        ...(type != null ? { type: type in SupplierType ? type : SupplierType.PHYSICAL } : {}),
        ...(status != null ? { status: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' } : {}),
        ...(contactEmail !== undefined ? { contactEmail: contactEmail || null } : {}),
        ...(whatsappPhone !== undefined ? { whatsappPhone: whatsappPhone || null } : {}),
      },
    });
    res.json({ data: updated });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to update supplier' });
  }
});

// DELETE /api/admin/suppliers/:id
router.delete('/:id', requireSuper, async (req, res) => {
  try {
    const { id } = req.params;

    // Optional: prevent delete if supplier is referenced by products
    const count = await prisma.product.count({ where: { supplierId: id } });
    if (count > 0) return res.status(400).json({ error: 'Cannot delete supplier: it is in use by products' });

    await prisma.supplier.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to delete supplier' });
  }
});

export default router;
