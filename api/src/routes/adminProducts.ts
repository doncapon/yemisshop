// routes/admin.products.ts
import express, { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  approveProduct as approveProductSvc,
  rejectProduct as rejectProductSvc,
} from '../services/admin.service.js';

const prisma = new PrismaClient();
const router = Router();

/* ---------------- Zod Schemas ---------------- */
const IdSchema = z.string().min(1, 'id is required');

const AddAttrValueSchema = z.object({
  attributeId: z.string().min(1),
  valueId: z.string().min(1),
});

const UpsertTextAttrSchema = z.object({
  attributeId: z.string().min(1),
  value: z.string().min(1),
});

const CreateVariantSchema = z.object({
  sku: z.string().min(1),
  price: z.number().optional(),
  inStock: z.boolean().optional(),
  imagesJson: z.array(z.string().url()).optional(),
  options: z.array(z.object({
    attributeId: z.string().min(1),
    valueId: z.string().min(1),
  })).default([]),
});
const CreateProductSchema = z.object({
  title: z.string().min(1),
  price: z.union([z.number(), z.string()]).optional(),
status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']).optional().default('PENDING'),
  description: z.string().optional(),
  sku: z.string().optional(),
  vatFlag: z.boolean().optional(),
  inStock: z.boolean().optional().default(true),

  categoryId: z.string().optional(),
  brandId: z.string().optional(),

  // 👇 required because relation is required
  supplierId: z.string().min(1),

  imagesJson: z.array(z.string()).optional().default([]),
  attributeValues: z.array(z.object({
    attributeId: z.string(),
    valueId: z.string().optional(),
    valueText: z.string().optional(),
  })).optional().default([]),
});

// supplierId is NOT nullable if relation is required
const UpdateProductSchema = z.object({
  title: z.string().optional(),
  price: z.number().optional(),
  description: z.string().optional(),
  sku: z.string().optional(),
  status: z.string().optional(),
  inStock: z.boolean().optional(),
  vatFlag: z.boolean().optional(),
  imagesJson: z.array(z.string()).optional(),

  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  supplierId: z.string().optional(), // <-- not nullable
});

/* ---------------- helpers ---------------- */
const wrap = (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------------- moderation ---------------- */

// GET /api/admin/products/pending
router.get('/pending', requireAdmin, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const where: Prisma.ProductWhereInput = { status: 'PENDING' as any };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { sku: { contains: q, mode: 'insensitive' } },
    ];
  }
  const items = await prisma.product.findMany({
    where, orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, price: true, status: true, createdAt: true, imagesJson: true }
  });
  res.json({ data: items.map(p => ({ ...p, imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [] })) });
}));

router.post('/:productId/approve', requireAdmin, wrap(async (req, res) => {
  res.json(await approveProductSvc(req.params.productId));
}));

router.post('/:productId/reject', requireAdmin, wrap(async (req, res) => {
  res.json(await rejectProductSvc(req.params.productId));
}));

/* ---------------- attributes on product ---------------- */

// GET /api/admin/products/:productId/attributes
router.get('/:productId/attributes', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);

  const [values, texts] = await Promise.all([
    prisma.productAttributeValue.findMany({
      where: { productId },
      include: { attribute: true, value: true },
      orderBy: [{ attribute: { name: 'asc' } }, { value: { position: 'asc' } }],
    }),
    prisma.productAttributeText.findMany({
      where: { productId },
      include: { attribute: true },
      orderBy: [{ attribute: { name: 'asc' } }],
    }),
  ]);

  res.json({ data: { values, texts } });
}));

// POST /api/admin/products/:productId/attributes  (SELECT value)
router.post('/:productId/attributes', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const { attributeId, valueId } = AddAttrValueSchema.parse(req.body ?? {});
  const value = await prisma.attributeValue.findUnique({ where: { id: valueId }, select: { id: true, attributeId: true } });
  if (!value) return res.status(404).json({ error: 'Attribute value not found' });
  if (value.attributeId !== attributeId) return res.status(400).json({ error: 'valueId does not belong to attributeId' });

  const existing = await prisma.productAttributeValue.findFirst({ where: { productId, attributeId, valueId } });
  if (existing) return res.json({ ok: true, data: existing, exists: true });

  const created = await prisma.productAttributeValue.create({ data: { productId, attributeId, valueId } });
  res.status(201).json({ ok: true, data: created });
}));

// DELETE /api/admin/products/:productId/attributes/:pavId
router.delete('/:productId/attributes/:pavId', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const pavId = IdSchema.parse(req.params.pavId);
  const pav = await prisma.productAttributeValue.findUnique({ where: { id: pavId }, select: { id: true, productId: true } });
  if (!pav || pav.productId !== productId) return res.status(404).json({ error: 'Product attribute value not found' });
  await prisma.productAttributeValue.delete({ where: { id: pavId } });
  res.json({ ok: true });
}));

// POST /api/admin/products/:productId/attributes/text  (TEXT value upsert)
router.post('/:productId/attributes/text', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const { attributeId, value } = UpsertTextAttrSchema.parse(req.body ?? {});
  const existing = await prisma.productAttributeText.findFirst({ where: { productId, attributeId } });
  const row = existing
    ? await prisma.productAttributeText.update({ where: { id: existing.id }, data: { value } })
    : await prisma.productAttributeText.create({ data: { productId, attributeId, value } });
  res.json({ ok: true, data: row });
}));

router.delete('/:productId/attributes/text/:id', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const id = IdSchema.parse(req.params.id);
  const row = await prisma.productAttributeText.findUnique({ where: { id }, select: { id: true, productId: true } });
  if (!row || row.productId !== productId) return res.status(404).json({ error: 'Text attribute not found' });
  await prisma.productAttributeText.delete({ where: { id } });
  res.json({ ok: true });
}));

/* ---------------- variants ---------------- */

router.get('/:productId/variants', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    include: { options: { include: { attribute: true, value: true } } },
    orderBy: [{ createdAt: 'asc' }],
  });
  res.json({ data: variants });
}));

router.post('/:productId/variants', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const payload = CreateVariantSchema.parse(req.body ?? {});

  // Validate options
  for (const opt of payload.options) {
    const val = await prisma.attributeValue.findUnique({ where: { id: opt.valueId }, select: { id: true, attributeId: true } });
    if (!val) return res.status(404).json({ error: `Attribute value not found: ${opt.valueId}` });
    if (val.attributeId !== opt.attributeId) return res.status(400).json({ error: `valueId ${opt.valueId} does not belong to attributeId ${opt.attributeId}` });
  }

  const created = await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku: payload.sku,
        price: payload.price != null ? new Prisma.Decimal(payload.price) : undefined,
        inStock: payload.inStock ?? true,
        imagesJson: payload.imagesJson ?? [],
      },
    });

    if (payload.options.length) {
      await tx.productVariantOption.createMany({
        data: payload.options.map(o => ({ variantId: variant.id, attributeId: o.attributeId, valueId: o.valueId })),
        skipDuplicates: true,
      });
    }

    return tx.productVariant.findUnique({
      where: { id: variant.id },
      include: { options: { include: { attribute: true, value: true } } },
    });
  });

  res.status(201).json({ ok: true, data: created });
}));

/* ---------------- list/manage ---------------- */

// GET /api/admin/products?status=ANY|PENDING||PUBLISHED&q=&take=&skip=
router.get('/', requireAdmin, wrap(async (req, res) => {
  const { status = 'ANY', q = '', take = '50', skip = '0' } = req.query as Record<string, string>;
  const where: Prisma.ProductWhereInput = {};
  if (status && status !== 'ANY') where.status = status as any;
  if (q.trim()) {
    where.OR = [
      { title: { contains: q.trim(), mode: 'insensitive' } },
      { sku: { contains: q.trim(), mode: 'insensitive' } },
      { description: { contains: q.trim(), mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        brand: true,
        supplier: true,
        owner: { select: { id: true, email: true } },
      },
      take: Number(take) || 50,
      skip: Number(skip) || 0,
    }),
    prisma.product.count({ where }),
  ]);
  res.json({ data: items, total });
}));

// POST /api/admin/products
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = CreateProductSchema.parse(req.body ?? {});
    const data: Prisma.ProductCreateInput = {
      title: body.title,
      price: new Prisma.Decimal(body.price ?? 0),
      status: body.status as any,
      description: body.description ?? '',
      sku: body.sku || '',
      inStock: body.inStock ?? true,
      vatFlag: body.vatFlag ?? undefined,
      imagesJson: body.imagesJson ?? [],

      ...(body.categoryId ? { category: { connect: { id: body.categoryId } } } : {}),
      ...(body.brandId ? { brand: { connect: { id: body.brandId } } } : {}),

      // 👇 THIS is what fixes your “supplier required” error
      supplier: { connect: { id: body.supplierId } },

      // optionally set owner from the authenticated user
      ...((req as any).user?.id ? { owner: { connect: { id: (req as any).user.id } } } : {}),
    };

    const created = await prisma.product.create({ data });
    // (persist attributeValues if you have those tables…)
    res.status(201).json({ data: created });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create product' });
  }
});

// PUT /api/admin/products/:id
// routes/admin.products.ts
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, price, description, sku, status,
      inStock, vatFlag, imagesJson,
      categoryId, brandId, supplierId,
    } = UpdateProductSchema.parse(req.body ?? {});

    const data: Prisma.ProductUpdateInput = {
      ...(title !== undefined ? { title } : {}),
      ...(price !== undefined ? { price: new Prisma.Decimal(price) } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(sku !== undefined ? { sku } : {}),
      ...(status !== undefined ? { status: status as any } : {}),
      ...(inStock !== undefined ? { inStock } : {}),
      ...(vatFlag !== undefined ? { vatFlag } : {}),
      ...(imagesJson !== undefined ? { imagesJson } : {}),

      // OPTIONAL relations (only if optional in your schema)
      ...(categoryId !== undefined
        ? (categoryId
            ? { category: { connect: { id: categoryId } } }
            : { category: { disconnect: true } })   // <-- works only if category is optional
        : {}),
      ...(brandId !== undefined
        ? (brandId
            ? { brand: { connect: { id: brandId } } }
            : { brand: { disconnect: true } })      // <-- works only if brand is optional
        : {}),

      // REQUIRED relation: NO disconnect allowed
      ...(supplierId !== undefined
        ? { supplier: { connect: { id: supplierId } } }
        : {}),
    };

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    const updated = await prisma.product.update({ where: { id }, data });
    res.json({ data: updated });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to update product' });
  }
});


const StatusSchema = z.object({
  status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']),
});

router.post('/:id/status', requireAdmin, wrap(async (req, res) => {
  const { id } = req.params;
  const { status } = StatusSchema.parse(req.body ?? {});
  const updated = await prisma.product.update({ where: { id }, data: { status } });
  res.json({ data: updated });
}));

// DELETE /api/admin/products/:id
router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const { id } = req.params;
  const orderItemCount = await prisma.orderItem.count({ where: { productId: id } });
  if (orderItemCount > 0) return res.status(409).json({ error: 'Cannot delete product in use (has order items).' });
  await prisma.product.delete({ where: { id } });
  res.json({ ok: true });
}));

export default router;
