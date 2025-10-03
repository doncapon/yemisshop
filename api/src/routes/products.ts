import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { toMinor } from '../lib/money.js';

const router = Router();

/** Helper: map DB model -> API shape */
function mapProduct(p: any) {
  return {
    ...p,
    price: Number((p.priceMinor / 100).toFixed(2)),
    images: (p.imagesJson ?? []) as string[],
  };
}

/** Public: list products */
router.get('/', async (req, res) => {
  const { q } = req.query;
  const where: any = {
    status: 'PUBLISHED',
    supplier: { status: { not: 'DISABLED' } },
  };
  if (q) where.title = { contains: String(q), mode: 'insensitive' };

  const rows = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { supplier: true, category: true },
  });

  res.json(rows.map(mapProduct));
});

/** Public: single product detail */
router.get('/:id', async (req, res) => {
  const p = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { supplier: true, category: true },
  });

  if (!p || p.status !== 'PUBLISHED' || p.supplier.status === 'DISABLED') {
    return res.status(404).json({ error: 'Not found' });
  }

  res.json(mapProduct(p));
});

/** Admin/Supplier: create product */
const productSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(1),
  price: z.coerce.number().nonnegative(), // major units from UI
  sku: z.string(),
  stock: z.coerce.number().int().nonnegative(),
  images: z.array(z.string().url()).default([]),
  categoryId: z.string(),
  supplierId: z.string().optional(), // Admin can specify
  status: z.enum(['DRAFT', 'SUBMITTED', 'PUBLISHED']).optional(),
  commissionPctInt: z.coerce.number().min(0).max(100).optional(),
  supplierTypeOverride: z.enum(['PHYSICAL', 'ONLINE']).optional(),
});

router.post('/', auth(), requireRole('SUPPLIER', 'ADMIN'), async (req: any, res) => {
  const body = productSchema.parse(req.body);
  const isAdmin = req.user?.role === 'ADMIN';

  let supplierId = body.supplierId;
  if (!isAdmin) {
    const supplier = await prisma.supplier.findFirst({ where: { userId: req.user!.id } });
    if (!supplier) return res.status(400).json({ error: 'No supplier profile' });
    supplierId = supplier.id;
  }

  const created = await prisma.product.create({
    data: {
      title: body.title,
      description: body.description,
      priceMinor: toMinor(body.price),
      sku: body.sku,
      stock: body.stock,
      vatFlag: true,
      status: body.status ?? 'PUBLISHED',
      imagesJson: body.images,
      categoryId: body.categoryId,
      supplierId: supplierId!,
      commissionPctInt: body.commissionPctInt ?? null,
      supplierTypeOverride: body.supplierTypeOverride ?? null,
    },
  });

  res.status(201).json(created);
});

/** Admin/Supplier: update product */
router.put('/:id', auth(), requireRole('SUPPLIER', 'ADMIN'), async (req: any, res) => {
  const partial = productSchema.partial().parse(req.body);

  const data: any = { ...partial };
  if (partial.price != null) data.priceMinor = toMinor(partial.price);
  if (partial.images != null) data.imagesJson = partial.images;

  delete data.price;
  delete data.images;

  const updated = await prisma.product.update({
    where: { id: req.params.id },
    data,
  });

  res.json(updated);
});

export default router;
