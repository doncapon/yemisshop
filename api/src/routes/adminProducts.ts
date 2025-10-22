// routes/admin.products.ts
import express, { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireAdmin } from '../middleware/auth.js';
import {
  approveProduct as approveProductSvc,
  rejectProduct as rejectProductSvc,
} from '../services/admin.service.js';
import { z } from 'zod';

const prisma = new PrismaClient();
const router = Router();

type Tx = Prisma.TransactionClient | PrismaClient;

async function makeUniqueSku(tx: Tx, desired: string | null | undefined, seen: Set<string>) {
  let base = (desired || '').trim();
  if (!base) return null; // allow null; most DBs permit multiple NULLs in a UNIQUE index

  // If we've already used the exact same SKU in this request, bump it.
  let candidate = base;
  let i = 1;

  const existsInDb = async (sku: string) =>
    !!(await tx.productVariant.findUnique({ where: { sku }, select: { id: true } }));

  // Avoid duplicates both within this payload (seen Set) and in DB.
  while (seen.has(candidate) || (await existsInDb(candidate))) {
    i += 1;
    candidate = `${base}-${i}`;
    if (i > 1000) throw new Error('Exceeded SKU uniquifier attempts');
  }

  seen.add(candidate);
  return candidate;
}

async function writeAttributesAndVariants(
  tx: Tx,
  productId: string,
  attributeSelections?: any[],
  variants?: any[],
) {
  if (attributeSelections) {
    await tx.productAttributeValue.deleteMany({ where: { productId } });
    await tx.productAttributeText.deleteMany({ where: { productId } });

    for (const sel of attributeSelections) {
      if (sel?.valueId) {
        await tx.productAttributeValue.create({ data: { productId, attributeId: sel.attributeId, valueId: sel.valueId } });
      } else if (Array.isArray(sel?.valueIds)) {
        await tx.productAttributeValue.createMany({
          data: sel.valueIds.map((vId: string) => ({ productId, attributeId: sel.attributeId, valueId: vId })),
        });
      } else if (typeof sel?.text === 'string') {
        await tx.productAttributeText.create({ data: { productId, attributeId: sel.attributeId, value: sel.text } });
      }
    }
  }

  if (variants) {
    const existing = await tx.productVariant.findMany({ where: { productId }, select: { id: true } });
    if (existing.length) {
      await tx.productVariantOption.deleteMany({ where: { variantId: { in: existing.map(v => v.id) } } });
      await tx.productVariant.deleteMany({ where: { id: { in: existing.map(v => v.id) } } });
    }

    for (const v of variants) {
      const created = await tx.productVariant.create({
        data: {
          productId,
          sku: v.sku,
          price: v.price != null ? new Prisma.Decimal(v.price) : null,
          inStock: v.inStock !== false,
          imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        },
      });

      if (Array.isArray(v.options) && v.options.length) {
        await tx.productVariantOption.createMany({
          data: v.options.map((o: any) => ({ variantId: created.id, attributeId: o.attributeId, valueId: o.valueId })),
          skipDuplicates: true,
        });
      }
    }
  }
}
const listPending: RequestHandler = async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const take = Math.min(100, Math.max(1, Number(req.query.take) || 50));
    const skip = Math.max(0, Number(req.query.skip) || 0);

    const where: Prisma.ProductWhereInput = {
      status: 'PENDING' as any,
      ...(q && {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          title: true,
          price: true,
          status: true,
          sku: true,
          inStock: true,
          imagesJson: true,
          createdAt: true,
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      data: items.map(p => ({
        id: p.id,
        title: p.title,
        price: Number(p.price),
        status: p.status,
        sku: p.sku,
        inStock: p.inStock,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        createdAt: p.createdAt,
      })),
      total,
    });
  } catch (e) {
    next(e);
  }
};

// ---- ROUTE ORDER: specific first, then generic ----

// 1) PENDING list must be BEFORE '/:id'
router.get('/pending', requireAdmin, listPending);

router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const includeParam = String(req.query.include || '').toLowerCase();
    const wantBrand = includeParam.includes('brand');
    const wantVariants = includeParam.includes('variants');
    const wantAttributes = includeParam.includes('attributes');

    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        ...(wantBrand && { brand: { select: { id: true, name: true } } }),
        ...(wantVariants && {
          ProductVariant: {
            include: {
              options: {
                include: {
                  attribute: { select: { id: true, name: true, type: true } },
                  value: { select: { id: true, name: true, code: true } },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        }),
        ...(wantAttributes && {
          ProductAttributeValue: {
            include: {
              attribute: { select: { id: true, name: true, type: true } },
              value: { select: { id: true, name: true, code: true } },
            },
            orderBy: [{ attribute: { name: 'asc' } }],
          },
          ProductAttributeText: {
            include: {
              attribute: { select: { id: true, name: true, type: true } },
            },
            orderBy: [{ attribute: { name: 'asc' } }],
          },
        }),
      },
    });

    if (!p) return res.status(404).json({ error: 'Not found' });

    const data: any = {
      id: p.id,
      title: p.title,
      description: p.description,
      price: Number(p.price),
      status: p.status,
      sku: p.sku,
      inStock: p.inStock,
      vatFlag: p.vatFlag,
      imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
      categoryId: p.categoryId ?? null,
      brandId: p.brandId ?? null,
      supplierId: p.supplierId ?? null,
    };

    if (wantBrand) {
      data.brand = p.brand ? { id: p.brand.id, name: p.brand.name } : null;
      data.brandName = p.brand ? p.brand.name : null;
    }

    if (wantVariants) {
      const variants = (p as any).ProductVariant as any[];
      data.variants = variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        price: v.price != null ? Number(v.price) : null,
        inStock: v.inStock,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        // Provide BOTH shapes so the UI can use either
        options: (v.options || []).map((o: any) => ({
          attributeId: o.attribute.id,           // id-shape
          valueId: o.value.id,
          attributeValueId: o.value.id,          // alt key some code uses
          attribute: {                           // object-shape
            id: o.attribute.id,
            name: o.attribute.name,
            type: o.attribute.type,
          },
          value: {
            id: o.value.id,
            name: o.value.name,
            code: o.value.code ?? null,
          },
        })),
        optionSelections: (v.options || []).map((o: any) => ({
          attributeId: o.attribute.id,
          valueId: o.value.id,
        })),
      }));
    }

    if (wantAttributes) {
      const pavs = (p as any).ProductAttributeValue as any[];
      const pats = (p as any).ProductAttributeText as any[];

      // Display-friendly lists (also include ids to help editors)
      data.attributeValues = pavs.map((av) => ({
        id: av.id,
        attribute: {
          id: av.attribute.id,
          name: av.attribute.name,
          type: av.attribute.type,
        },
        value: {
          id: av.value.id,
          name: av.value.name,
          code: av.value.code ?? null,
        },
        attributeId: av.attribute.id, // extra for editors
        valueId: av.value.id,
      }));

      data.attributeTexts = pats.map((at) => ({
        id: at.id,
        attribute: {
          id: at.attribute.id,
          name: at.attribute.name,
          type: at.attribute.type,
        },
        value: at.value,
        attributeId: at.attribute.id, // for editors
      }));

      // Editor seeding shape: group by attributeId ⇒ valueId OR valueIds[]
      const grouped: Record<string, string[]> = {};
      for (const av of pavs) {
        const aId = av.attribute.id;
        const vId = av.value.id;
        if (!grouped[aId]) grouped[aId] = [];
        grouped[aId].push(vId);
      }
      data.attributeSelections = Object.entries(grouped).map(
        ([attributeId, valueIds]) =>
          valueIds.length > 1
            ? { attributeId, valueIds }
            : { attributeId, valueId: valueIds[0] }
      );
    }

    res.json({ data });
  } catch (e) {
    next(e);
  }
});


/* ---------- CREATE: accept attributes + variants ---------- */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      title, price, status = 'PENDING', description = '', sku, vatFlag, inStock = true,
      categoryId, brandId, supplierId, imagesJson = [],
      attributeSelections = [], // <— NEW supported
      variants = [],            // <— NEW supported
    } = req.body ?? {};

    if (!supplierId) return res.status(400).json({ error: 'supplierId is required' });

    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          title,
          price: new Prisma.Decimal(price ?? 0),
          status,
          description,
          sku: sku || '',
          vatFlag: vatFlag ?? undefined,
          inStock,
          imagesJson: Array.isArray(imagesJson) ? imagesJson : [],
          ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
          ...(brandId ? { brand: { connect: { id: brandId } } } : {}),
          supplier: { connect: { id: supplierId } },
        },
      });

      await writeAttributesAndVariants(tx, product.id, attributeSelections, variants);

      return product;
    });

    res.status(201).json({ data: created });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create product' });
  }
});


// GET /api/admin/products?status=ANY|PENDING|PUBLISHED&q=&take=50&skip=0
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { status = 'ANY', q = '', take = '50', skip = '0' } = req.query as Record<string, string>;

    const where: Prisma.ProductWhereInput = {};
    const s = String(status).toUpperCase();
    if (s !== 'ANY') where.status = s as any;

    const term = q.trim();
    if (term) {
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    const takeNum = Math.max(1, Math.min(100, Number(take) || 50));
    const skipNum = Math.max(0, Number(skip) || 0);

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: takeNum,
        skip: skipNum,
        select: {
          id: true,
          title: true,
          price: true,
          status: true,
          sku: true,
          inStock: true,
          vatFlag: true,
          imagesJson: true,
          createdAt: true,
          categoryId: true,
          brandId: true,
          supplierId: true,
          owner: { select: { id: true, email: true } },
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const data = items.map((p) => ({
      id: p.id,
      title: p.title,
      price: Number(p.price),
      status: p.status,
      sku: p.sku,
      inStock: p.inStock,
      vatFlag: p.vatFlag,
      createdAt: p.createdAt,
      imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
      categoryId: p.categoryId,
      brandId: p.brandId,
      supplierId: p.supplierId,
      categoryName: p.category?.name ?? null,
      brandName: p.brand?.name ?? null,
      supplierName: p.supplier?.name ?? null,
      ownerId: p.owner?.id ?? null,
      ownerEmail: p.owner?.email ?? null,
    }));

    res.json({ data, total });
  } catch (e) {
    next(e);
  }
});


/* ---------------- helpers ---------------- */
const wrap = (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// /routes/admin.products.ts

router.post('/:productId/approve', requireAdmin, async (req, res) => {
  try {
    const { productId } = req.params;
    const data = await prisma.product.update({
      where: { id: productId },
      data: { status: 'PUBLISHED' },
      select: { id: true, title: true, status: true, price: true, imagesJson: true, createdAt: true },
    });
    res.json({ data });
  } catch (e: any) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    return res.status(400).json({ error: e?.message || 'Approve failed' });
  }
});

router.post('/:productId/reject', requireAdmin, async (req, res) => {
  try {
    const { productId } = req.params;
    const data = await prisma.product.update({
      where: { id: productId },
      data: { status: 'REJECTED' },
      select: { id: true, title: true, status: true, price: true, imagesJson: true, createdAt: true },
    });
    res.json({ data });
  } catch (e: any) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    return res.status(400).json({ error: e?.message || 'Reject failed' });
  }
});


// routes/admin.products.ts
import type { RequestHandler } from 'express';

// 1) put the shared update logic in one handler
const updateProduct: RequestHandler = async (req, res, next) => {
  const id = req.params.id;

  // Accept various body shapes
  const incoming = req.body ?? {};
  const base = incoming.data?.product ?? incoming.data ?? incoming;

  const {
    title,
    price,
    status,
    sku,
    inStock,
    vatFlag,
    brandId,
    categoryId,
    supplierId,   // NOTE: probably required in your schema
    imagesJson,
  } = base;

  // variants/attributes are handled below (unchanged)
  const variantsInput =
    base.variants ?? incoming.variants ?? incoming.data?.variants ??
    (Array.isArray(incoming) ? incoming : undefined);

  const attributeSelections =
    base.attributeSelections ?? incoming.attributeSelections ?? undefined;

  try {
    await prisma.$transaction(async (tx) => {
      // ---- build a *checked* update payload (uses nested relations)
      const data: Prisma.ProductUpdateInput = {};

      if (title !== undefined) data.title = title;
      if (price !== undefined) data.price = new Prisma.Decimal(price);
      if (status !== undefined) data.status = status;
      if (sku !== undefined) data.sku = sku;
      if (typeof inStock === 'boolean') data.inStock = inStock;
      if (typeof vatFlag === 'boolean') data.vatFlag = vatFlag;
      if (Array.isArray(imagesJson)) data.imagesJson = imagesJson;

      // brand/category are usually optional relations → connect/disconnect
      if (brandId !== undefined) {
        if (brandId === null) {
          // only valid if Product.brand is optional in your schema
          (data as any).brand = { disconnect: true };
        } else if (typeof brandId === 'string' && brandId) {
          data.brand = { connect: { id: brandId } };
        }
      }

      if (categoryId !== undefined) {
        if (categoryId === null) {
          // only valid if Product.category is optional
          (data as any).category = { disconnect: true };
        } else if (typeof categoryId === 'string' && categoryId) {
          data.category = { connect: { id: categoryId } };
        }
      }

      // supplier is likely required → allow connect, do NOT try to null it
      if (supplierId !== undefined) {
        if (typeof supplierId === 'string' && supplierId) {
          data.supplier = { connect: { id: supplierId } };
        }
        // if supplier is required, do not set disconnect / null here
      }

      // ---- update base product
      await tx.product.update({ where: { id }, data });

      // ---- attributes: only replace if provided (your existing logic)
      if (attributeSelections) {
        await tx.productAttributeValue.deleteMany({ where: { productId: id } });
        await tx.productAttributeText.deleteMany({ where: { productId: id } });

        for (const sel of attributeSelections) {
          if (sel?.valueId) {
            await tx.productAttributeValue.create({
              data: { productId: id, attributeId: sel.attributeId, valueId: sel.valueId },
            });
          } else if (Array.isArray(sel?.valueIds)) {
            await tx.productAttributeValue.createMany({
              data: sel.valueIds.map((vId: string) => ({
                productId: id, attributeId: sel.attributeId, valueId: vId,
              })),
              skipDuplicates: true,
            });
          } else if (typeof sel?.text === 'string') {
            await tx.productAttributeText.create({
              data: { productId: id, attributeId: sel.attributeId, value: sel.text },
            });
          }
        }
      }

      // ---- variants: only replace if provided (use your normalize/replace helpers)
      if (variantsInput) {
        const normalized = normalizeVariantsPayload({ variants: variantsInput });
        await replaceAllVariants(tx, id, normalized);
      }
    });

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // unique constraint violation
      const target = Array.isArray((err as any).meta?.target) ? (err as any).meta.target.join(',') : (err as any).meta?.target;
      if (String(target).includes('sku')) {
        return res.status(409).json({ error: 'Variant SKU must be unique. Please change duplicate SKUs or leave blank to auto-assign.' });
      }
    }
    next(err);
  }
};


// 2) mount both PUT and PATCH on the same path (NOTE the path is just '/:id')
router
  .route('/:id')
  .put(requireAdmin, updateProduct)
  .patch(requireAdmin, updateProduct);
router.post('/:id', requireAdmin, updateProduct);

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


const StatusSchema = z.object({
  status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']),
});

// POST /api/admin/products/:id/status  -> { status: "PENDING" | "PUBLISHED" | "REJECTED" }
router.post('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = StatusSchema.parse(req.body ?? {});

    const updated = await prisma.product.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        title: true,
        status: true,
        price: true,
        sku: true,
        inStock: true,
        imagesJson: true,
      },
    });

    res.json({ data: updated });
  } catch (e: any) {
    // Not found (Prisma P2025) -> 404, otherwise 400
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    return res.status(400).json({ error: e?.message || 'Failed to update status' });
  }
});

// BULK replace: POST /api/admin/products/:productId/variants/bulk
router.post('/:productId/variants/bulk', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const normalized = normalizeVariantsPayload(req.body);
  await prisma.$transaction(async (tx) => {
    await replaceAllVariants(tx, productId, normalized);
  });
  res.json({ ok: true, count: normalized.length });
}));


router.post('/:productId/variants', requireAdmin, async (req, res, next) => {
  try {
    const productId = IdSchema.parse(req.params.productId);
    const payload = CreateVariantSchema.parse(req.body ?? {});
    const options = (payload.options || [])
      .map(o => ({ attributeId: o.attributeId, valueId: o.valueId }))
      .filter(o => o.attributeId && o.valueId);
    const seen = new Set<string>();
    const sku = await makeUniqueSku(prisma, payload.sku, seen);
    const created = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          productId,
          sku: payload.sku,
          price: payload.price != null ? new Prisma.Decimal(payload.price) : null,
          inStock: payload.inStock ?? true,
          imagesJson: payload.imagesJson ?? [],
        },
      });

      if (options.length) {
        await tx.productVariantOption.createMany({
          data: options.map(o => ({ variantId: variant.id, attributeId: o.attributeId!, valueId: o.valueId! })),
          skipDuplicates: true,
        });
      }

      return tx.productVariant.findUnique({
        where: { id: variant.id },
        include: { options: { include: { attribute: true, value: true } } },
      });
    });

    res.status(201).json({ ok: true, data: created });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray((err as any).meta?.target) ? (err as any).meta.target.join(',') : (err as any).meta?.target;
      if (String(target).includes('sku')) {
        return res.status(409).json({ error: 'Variant SKU must be unique. Please change duplicate SKUs or leave blank to auto-assign.' });
      }
    }
    next(err);
  }
});


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

// DELETE /api/admin/products/:id
router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const { id } = req.params;
  const orderItemCount = await prisma.orderItem.count({ where: { productId: id } });
  if (orderItemCount > 0) return res.status(409).json({ error: 'Cannot delete product in use (has order items).' });
  await prisma.product.delete({ where: { id } });
  res.json({ ok: true });
}));


// ---- Flexible option & variant schemas (coerce numbers; allow multiple shapes)
const OptionLooseSchema = z.object({
  attributeId: z.string().optional(),
  valueId: z.string().optional(),
  attribute: z.object({ id: z.string() }).optional(),
  value: z.object({ id: z.string() }).optional(),
  attributeValueId: z.string().optional(),
}).transform(o => ({
  attributeId: o.attributeId ?? o.attribute?.id,
  valueId: o.valueId ?? o.attributeValueId ?? o.value?.id,
}));

const VariantLooseSchema = z.object({
  sku: z.string().min(1),
  price: z.coerce.number().nullable().optional(),
  inStock: z.coerce.boolean().optional(),
  imagesJson: z.array(z.string()).optional(), // allow any string (urls, data:, /path)
  options: z.array(OptionLooseSchema).default([]),
});

function normalizeVariantsPayload(body: any) {
  const raw =
    body?.variants ??
    body?.data?.variants ??
    (Array.isArray(body) ? body : undefined);

  if (!raw) return [];

  const parsed = z.array(VariantLooseSchema).parse(raw);

  return parsed.map(v => ({
    sku: v.sku,
    price: v.price ?? null,
    inStock: v.inStock ?? true,
    imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
    options: (v.options || [])
      .map(o => ({ attributeId: o.attributeId, valueId: o.valueId }))
      .filter(o => o.attributeId && o.valueId),
  }));
}

async function replaceAllVariants(tx: Tx, productId: string, variants: any[]) {
  const existing = await tx.productVariant.findMany({ where: { productId }, select: { id: true } });
  if (existing.length) {
    await tx.productVariantOption.deleteMany({ where: { variantId: { in: existing.map(v => v.id) } } });
    await tx.productVariant.deleteMany({ where: { id: { in: existing.map(v => v.id) } } });
  }

  const seen = new Set<string>(); // track SKUs within this request

  for (const v of variants) {
    const uniqueSku = await makeUniqueSku(tx, v.sku, seen);

    const created = await tx.productVariant.create({
      data: {
        productId,
        sku: uniqueSku || '', // 👈 enforce uniqueness
        price: v.price != null ? new Prisma.Decimal(v.price) : null,
        inStock: v.inStock !== false,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
      },
    });

    if (Array.isArray(v.options) && v.options.length) {
      await tx.productVariantOption.createMany({
        data: v.options.map((o: any) => ({
          variantId: created.id,
          attributeId: o.attributeId,
          valueId: o.valueId,
        })),
        skipDuplicates: true,
      });
    }
  }
}

export default router;

