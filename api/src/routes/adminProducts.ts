// routes/admin.products.ts
import express, { Router, type RequestHandler } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { z } from 'zod';
import { prismaSoft } from '../lib/prismaSoft.js';

const prisma = new PrismaClient();
const router = Router();

/* -------------------------------- Types --------------------------------- */

type Tx = Prisma.TransactionClient | PrismaClient;

type OfferInput = {
  supplierId: string;
  price: number | string;    // NGN price
  variantId?: string | null; // if set, price is for that variant
  inStock?: boolean;
  isActive?: boolean;
};

type CreateProductPayload = {
  title: string;
  description?: string;
  price: number | string;
  sku?: string;
  // optional relations/flags
  status?: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  inStock?: boolean;
  categoryId?: string;
  brandId?: string;
  supplierId: string;
  imagesJson?: string[];
  // NEW per product defaults
  communicationCost?: number | string;
  offers?: OfferInput[];
};

/* ------------------------------ Utilities ------------------------------- */

const toDec = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const toDecimal = (v: any) => new Prisma.Decimal(String(v));

const wrap = (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function makeUniqueSku(tx: Tx, desired: string | null | undefined, seen: Set<string>) {
  let base = (desired || '').trim();
  if (!base) return null; // allow null; DB usually permits multiple NULLs in unique index

  let candidate = base;
  let i = 1;

  const existsInDb = async (sku: string) =>
    !!(await tx.productVariant.findUnique({ where: { sku }, select: { id: true } }));

  while (seen.has(candidate) || (await existsInDb(candidate))) {
    i += 1;
    candidate = `${base}-${i}`;
    if (i > 1000) throw new Error('Exceeded SKU uniquifier attempts');
  }

  seen.add(candidate);
  return candidate;
}

// --------------------------------------------------------

// If you already have your own alias `Tx`, you can keep it.
// Otherwise prefer Prisma.TransactionClient for proper typing.
async function writeAttributesAndVariants(
  tx: Prisma.TransactionClient,            // or your alias `Tx`
  productId: string,
  attributeSelections?: Array<{
    attributeId: string;
    valueId?: string;
    valueIds?: string[];
    text?: string;
  }>,
  variants?: Array<{
    sku?: string | null;
    price?: number | null;
    inStock?: boolean;
    imagesJson?: string[];
    options?: Array<{ attributeId: string; valueId: string }>;
  }>
) {
  /* ----------------------- Product attributes ----------------------- */
  if (attributeSelections && attributeSelections.length) {
    // reset current attributes for this product
    await tx.productAttributeOption.deleteMany({ where: { productId } });
    await tx.productAttributeText.deleteMany({ where: { productId } });

    // collect SELECT/MULTISELECT rows to insert in one go
    const optionRows: { productId: string; attributeId: string; valueId: string }[] = [];

    for (const sel of attributeSelections) {
      if (!sel?.attributeId) continue;

      // single value
      if (sel.valueId) {
        optionRows.push({ productId, attributeId: sel.attributeId, valueId: sel.valueId });
        continue;
      }

      // multiple values
      if (Array.isArray(sel.valueIds) && sel.valueIds.length) {
        for (const vId of sel.valueIds) {
          optionRows.push({ productId, attributeId: sel.attributeId, valueId: vId });
        }
        continue;
      }

      // free text
      if (typeof sel.text === 'string' && sel.text.trim()) {
        await tx.productAttributeText.create({
          data: { productId, attributeId: sel.attributeId, value: sel.text.trim() },
        });
      }
    }

    if (optionRows.length) {
      await tx.productAttributeOption.createMany({
        data: optionRows,
        skipDuplicates: true, // respects @@unique([productId,attributeId,valueId])
      });
    }
  }

  /* ------------------------- Variants & options ------------------------- */
  if (variants) {
    const existing = await tx.productVariant.findMany({
      where: { productId },
      select: { id: true },
    });

    if (existing.length) {
      await tx.productVariantOption.deleteMany({
        where: { variantId: { in: existing.map((v) => v.id) } },
      });
      await tx.productVariant.deleteMany({ where: { id: { in: existing.map((v) => v.id) } } });
    }

    const seen = new Set<string>(); // ensure SKUs unique in this batch

    for (const v of variants) {
      const uniqueSku = await makeUniqueSku(tx, v?.sku ?? '', seen); // keep your existing helper

      const created = await tx.productVariant.create({
        data: {
          productId,
          sku: uniqueSku || undefined, // let DB allow null/undefined if schema permits
          price: v.price != null ? new Prisma.Decimal(v.price) : undefined, // optional price
          inStock: v.inStock !== false,
          imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        },
      });

      if (Array.isArray(v.options) && v.options.length) {
        await tx.productVariantOption.createMany({
          data: v.options.map((o) => ({
            variantId: created.id,
            attributeId: o.attributeId,
            valueId: o.valueId,
          })),
          skipDuplicates: true,
        });
      }
    }
  }
}

export async function autoDemoteIfUnavailable(productId: string) {
  const [p, avail] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { id: true, status: true } }),
    isProductAvailable(prisma, productId), // this version can accept PrismaClient
  ]);
  if (!p) return;
  if (p.status === 'PUBLISHED' && !avail) {
    await prisma.product.update({ where: { id: productId }, data: { status: 'PENDING' } });
  }
}



/* ------------------------------- Zod ------------------------------------ */

const IdSchema = z.string().min(1, 'id is required');

const AddAttrValueSchema = z.object({
  attributeId: z.string().min(1),
  valueId: z.string().min(1),
});

const UpsertTextAttrSchema = z.object({
  attributeId: z.string().min(1),
  value: z.string().min(1),
});

const StatusSchema = z.object({
  status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']),
});

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
  imagesJson: z.array(z.string()).optional(),
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

// helper
async function isProductAvailable(prismaTx: typeof prisma, productId: string) {
  const product = await prismaTx.product.findUnique({
    where: { id: productId },
    select: { inStock: true },
  });
  if (!product) return false;

  // any in-stock variant?
  const variantInStock = await prismaTx.productVariant.count({
    where: { productId, inStock: true },
  });

  // any active, in-stock offer with qty > 0 (or unknown qty)?
  const offerInStock = await prismaTx.supplierOffer.count({
    where: {
      productId,
      isActive: true,
      inStock: true,
      OR: [{ availableQty: { gt: 0 } }],
    },
  });

  return !!product.inStock || variantInStock > 0 || offerInStock > 0;
}

router.post('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = StatusSchema.parse(req.body ?? {});

    if (status === 'PUBLISHED') {
      const ok = await isProductAvailable(prisma, id);
      if (!ok) {
        return res
          .status(409)
          .json({ error: 'Cannot publish a product that is not in stock.' });
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { status },
      select: {
        id: true, title: true, status: true, price: true, sku: true, inStock: true, imagesJson: true,
      },
    });

    res.json({ data: updated });
  } catch (e: any) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    return res.status(400).json({ error: e?.message || 'Failed to update status' });
  }
});

router.post('/:productId/approve', requireAdmin, async (req, res) => {
  try {
    const { productId } = req.params;
    const data = await prisma.product.update({
      where: { id: productId },
      data: { status: 'LIVE' },
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


// DELETE /api/admin/products/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = IdSchema.parse(req.params.id);

  try {
    await prisma.$transaction(async (tx) => {
      // 1) Block delete if product has ever been used in an order
      const orderItemsCount = await tx.orderItem
        .count({ where: { productId: id } })
        .catch(() => 0);

      if (orderItemsCount > 0) {
        // Prefer returning a helpful 409 explaining why we won't hard-delete
        throw Object.assign(new Error('PRODUCT_IN_ORDERS'), {
          code: 'PRODUCT_IN_ORDERS',
          meta: { orderItemsCount },
        });
      }

      // 2) Collect variant IDs up-front
      const variants = await tx.productVariant.findMany({
        where: { productId: id },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);

      // 3) Delete dependents (tolerate optional tables)
      if (variantIds.length) {
        await tx.productVariantOption.deleteMany({
          where: { variantId: { in: variantIds } },
        });
      }

      await tx.productVariant.deleteMany({ where: { productId: id } });

      // Product-level attributes
      await tx.productAttributeOption.deleteMany({ where: { productId: id } }).catch(() => { });
      await tx.productAttributeText.deleteMany({ where: { productId: id } }).catch(() => { });

      // Supplier offers for this product
      await tx.supplierOffer.deleteMany({ where: { productId: id } }).catch(() => { });

      // Optional social/UX tables — ignore if they don't exist in your schema
      await tx.favorite?.deleteMany({ where: { productId: id } }).catch(() => { });
      await tx.wishlist?.deleteMany({ where: { productId: id } }).catch(() => { });

      // 4) Finally, delete the product
      await tx.product.delete({ where: { id } });
    });

    return res.json({ ok: true });
  } catch (err: any) {
    // Friendly message if the product has order items
    if (err?.code === 'PRODUCT_IN_ORDERS') {
      return res.status(409).json({
        error:
          'This product cannot be deleted because it exists in one or more orders. ' +
          'Consider setting status to REJECTED or PENDING instead.',
        details: err.meta,
      });
    }
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: 'Product not found' });
    }
    console.error('DELETE /admin/products/:id failed:', err);
    return res.status(500).json({ error: 'Could not delete product' });
  }
});

// DELETE /api/admin/products/:id  → becomes soft delete

router.delete('/:id/soft-delete', async (req, res) => {
  const { id } = req.params;
  const updated = await prismaSoft.product.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  res.json({ ok: true, data: updated });
});


router.get('/:id/has-orders', async (req, res) => {
  const { id } = req.params;
  const count = await prisma.orderItem.count({ where: { productId: id } });
  res.json({ has: count > 0, count });
});



/* ------------------------------- Routes ---------------------------------- */

// GET /api/admin/products/pending
const listPublished: RequestHandler = async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const take = Math.min(100, Math.max(1, Number(req.query.take) || 50));
    const skip = Math.max(0, Number(req.query.skip) || 0);

    const where: Prisma.ProductWhereInput = {
      status: 'PUBLISHED' as any,
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
          supplierOffers: true,
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
        supplierOffer: p.supplierOffers,
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

router.get('/published', requireAdmin, listPublished);


// GET /api/admin/products/search?q=wireless headphones
router.get('/search', requireAdmin, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json([]);

  const words = q.split(/\s+/).filter(Boolean);
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        // title must contain ALL words (order-independent)
        { AND: words.map(w => ({ title: { contains: w, mode: 'insensitive' } })) },
        // also allow SKU substring search
        { sku: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, title: true, sku: true },
    orderBy: { title: 'asc' },
    take: 20,
  });

  res.json(rows);
});



// GET /api/admin/products/:id  (supports include=variants,attributes,brand)
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
          // ✅ use attributeOptions instead of ProductAttributeValue
          attributeOptions: {
            include: {
              attribute: { select: { id: true, name: true, type: true } },
              value: { select: { id: true, name: true, code: true } },
            },
            orderBy: [{ attribute: { name: 'asc' } }],
          },
          // keep text attributes if you have them
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

    // ----- map result -----
    const data: any = {
      id: p.id,
      title: p.title,
      description: p.description,
      price: Number(p.price),
      status: p.status,
      sku: p.sku,
      inStock: p.inStock,
      imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
      categoryId: p.categoryId ?? null,
      brandId: p.brandId ?? null,
      supplierId: p.supplierId ?? null,
      communicationCost: p.communicationCost != null ? Number(p.communicationCost) : null,
    };

    if (wantBrand) {
      data.brand = (p as any).brand ? { id: (p as any).brand.id, name: (p as any).brand.name } : null;
      data.brandName = (p as any).brand ? (p as any).brand.name : null;
    }

    if (wantVariants) {
      const variants = (p as any).ProductVariant ?? [];
      data.variants = variants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        price: v.price != null ? Number(v.price) : null,
        inStock: v.inStock,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        options: (v.options || []).map((o: any) => ({
          attributeId: o.attribute.id,
          valueId: o.value.id,
          attributeValueId: o.value.id,
          attribute: { id: o.attribute.id, name: o.attribute.name, type: o.attribute.type },
          value: { id: o.value.id, name: o.value.name, code: o.value.code ?? null },
        })),
        optionSelections: (v.options || []).map((o: any) => ({ attributeId: o.attribute.id, valueId: o.value.id })),
      }));
    }

    if (wantAttributes) {
      const paos = (p as any).attributeOptions ?? [];        // ✅ from attributeOptions
      const pats = (p as any).ProductAttributeText ?? [];

      data.attributeValues = paos.map((o: any) => ({
        id: o.id,
        attribute: { id: o.attribute.id, name: o.attribute.name, type: o.attribute.type },
        value: { id: o.value.id, name: o.value.name, code: o.value.code ?? null },
        attributeId: o.attribute.id,
        valueId: o.value.id,
      }));

      data.attributeTexts = pats.map((at: any) => ({
        id: at.id,
        attribute: { id: at.attribute.id, name: at.attribute.name, type: at.attribute.type },
        value: at.value,
        attributeId: at.attribute.id,
      }));

      // Build attributeSelections from the join rows
      const grouped: Record<string, string[]> = {};
      for (const o of paos) {
        const aId = o.attribute.id;
        const vId = o.value.id;
        (grouped[aId] ??= []).push(vId);
      }
      data.attributeSelections = Object.entries(grouped).map(([attributeId, valueIds]) =>
        valueIds.length > 1 ? { attributeId, valueIds } : { attributeId, valueId: valueIds[0] },
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
    const body = (req.body ?? {}) as CreateProductPayload;

    const {
      title, description = '', price, sku,
      status = 'PENDING', inStock = true,
      categoryId, brandId, supplierId, imagesJson = [],
      communicationCost,
      offers = [],
    } = body;

    const attributeSelections = Array.isArray((req.body as any).attributeSelections)
      ? (req.body as any).attributeSelections
      : [];

    const variants = Array.isArray((req.body as any).variants)
      ? (req.body as any).variants
      : [];

    if (!supplierId) return res.status(400).json({ error: 'supplierId is required' });
    if (!title || price == null) return res.status(400).json({ error: 'title and price are required' });

    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          title,
          description,
          price: toDecimal(price),
          sku: sku || '',
          status,
          inStock,
          imagesJson: Array.isArray(imagesJson) ? imagesJson : [],
          ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
          ...(brandId ? { brand: { connect: { id: brandId } } } : {}),
          supplier: { connect: { id: supplierId } },
          ...(toDec(communicationCost) != null ? { communicationCost: toDec(communicationCost) } : {}),
        },
      });

      // offers (use tx, not prisma)
      for (const o of offers) {
        await tx.supplierOffer.upsert({
          where: {
            supplierId_productId_variantId: {
              supplierId: o.supplierId,
              productId: product.id,
              variantId: o.variantId ?? '',
            },
          },
          update: {
            price: toDecimal(o.price),
            inStock: o.inStock ?? true,
            isActive: o.isActive ?? true,
          },
          create: {
            supplierId: o.supplierId,
            productId: product.id,
            variantId: o.variantId ?? null,
            price: toDecimal(o.price),
            inStock: o.inStock ?? true,
            isActive: o.isActive ?? true,
          },
        });
      }

      await writeAttributesAndVariants(tx, product.id, attributeSelections, variants);

      return product;
    });

    res.status(201).json({ data: created });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create product' });
  }
});

/* ---------- UPDATE (PUT/PATCH) unified: includes ---------- */
const updateProduct: RequestHandler = async (req, res, next) => {
  const id = req.params.id;

  // tolerate several shapes
  const incoming = req.body ?? {};
  const base = incoming.data?.product ?? incoming.data ?? incoming;

  const {
    title,
    price,
    status,
    sku,
    inStock,
    brandId,
    categoryId,
    supplierId, // required by your schema; don't disconnect to null
    imagesJson,
    communicationCost,
  } = base || {};

  // tolerates multiple locations for these payloads
  const variantsInput =
    base?.variants ??
    incoming.variants ??
    incoming.data?.variants ??
    (Array.isArray(incoming) ? incoming : undefined);

  const attributeSelections =
    base?.attributeSelections ?? incoming.attributeSelections ?? undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const data: Prisma.ProductUpdateInput = {};

      if (title !== undefined) data.title = title;

      if (price !== undefined) {
        const n = Number(price);
        if (Number.isFinite(n)) data.price = new Prisma.Decimal(n);
      }

      if (status !== undefined) data.status = status;
      if (sku !== undefined) data.sku = sku;
      if (typeof inStock === 'boolean') data.inStock = inStock;
      if (Array.isArray(imagesJson)) (data as any).imagesJson = imagesJson;

      // communicationCost (optional decimal)
      if (communicationCost !== undefined) {
        const n = Number(communicationCost);
        if (Number.isFinite(n)) (data as any).communicationCost = new Prisma.Decimal(n);
      }

      // brand connect/disconnect (optional)
      if (brandId !== undefined) {
        if (brandId === null) {
          (data as any).brand = { disconnect: true };
        } else if (typeof brandId === 'string' && brandId) {
          (data as any).brand = { connect: { id: brandId } };
        }
      }

      // category connect/disconnect (optional)
      if (categoryId !== undefined) {
        if (categoryId === null) {
          (data as any).category = { disconnect: true };
        } else if (typeof categoryId === 'string' && categoryId) {
          (data as any).category = { connect: { id: categoryId } };
        }
      }

      // supplier connect only (required field in your schema)
      if (supplierId !== undefined && typeof supplierId === 'string' && supplierId) {
        (data as any).supplier = { connect: { id: supplierId } };
      }

      // 1) Update base product fields
      await tx.product.update({ where: { id }, data });

      // 2) Attributes: use ProductAttributeOption (SELECT/MULTISELECT) and ProductAttributeText (TEXT)
      if (attributeSelections) {
        // wipe existing attributes for this product (idempotent replace)
        await tx.productAttributeOption.deleteMany({ where: { productId: id } });
        await tx.productAttributeText.deleteMany({ where: { productId: id } });

        const optionRows: { productId: string; attributeId: string; valueId: string }[] = [];

        for (const sel of attributeSelections as Array<any>) {
          if (!sel?.attributeId) continue;

          // single value
          if (sel.valueId) {
            optionRows.push({
              productId: id,
              attributeId: sel.attributeId,
              valueId: sel.valueId,
            });
            continue;
          }

          // multiple values
          if (Array.isArray(sel.valueIds) && sel.valueIds.length) {
            for (const vId of sel.valueIds) {
              optionRows.push({
                productId: id,
                attributeId: sel.attributeId,
                valueId: vId,
              });
            }
            continue;
          }

          // free text
          if (typeof sel.text === 'string' && sel.text.trim()) {
            await tx.productAttributeText.create({
              data: { productId: id, attributeId: sel.attributeId, value: sel.text.trim() },
            });
          }
        }

        if (optionRows.length) {
          await tx.productAttributeOption.createMany({
            data: optionRows,
            skipDuplicates: true, // respects @@unique([productId,attributeId,valueId])
          });
        }
      }

      // 3) Variants: normalize and replace (if you’re using helpers)
      if (variantsInput) {
        const normalized =
          typeof normalizeVariantsPayload === 'function'
            ? normalizeVariantsPayload({ variants: variantsInput })
            : variantsInput;

        // If you have a dedicated helper:
        if (typeof replaceAllVariants === 'function') {
          await replaceAllVariants(tx, id, normalized);
        } else {
          // inline fallback: wipe & recreate
          const existing = await tx.productVariant.findMany({
            where: { productId: id },
            select: { id: true },
          });

          if (existing.length) {
            await tx.productVariantOption.deleteMany({
              where: { variantId: { in: existing.map((v) => v.id) } },
            });
            await tx.productVariant.deleteMany({
              where: { id: { in: existing.map((v) => v.id) } },
            });
          }

          const seen = new Set<string>(); // ensure unique SKUs within this batch

          for (const v of normalized as Array<any>) {
            const rawSku = (v?.sku ?? '').trim();
            const skuUnique = await makeUniqueSku(tx as any, rawSku, seen); // keep your existing helper

            const created = await tx.productVariant.create({
              data: {
                productId: id,
                sku: skuUnique || undefined,
                price:
                  v?.price != null && Number.isFinite(Number(v.price))
                    ? new Prisma.Decimal(Number(v.price))
                    : undefined,
                inStock: v?.inStock !== false,
                imagesJson: Array.isArray(v?.imagesJson) ? v.imagesJson : [],
              },
            });

            if (Array.isArray(v?.options) && v.options.length) {
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
      }
    });

    res.json({ ok: true });
  } catch (err: any) {
    // SKU unique violation on product or variants
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray((err as any).meta?.target)
        ? (err as any).meta.target.join(',')
        : (err as any).meta?.target;
      if (String(target || '').toLowerCase().includes('sku')) {
        return res
          .status(409)
          .json({ error: 'Variant SKU must be unique. Please change duplicate SKUs or leave blank to auto-assign.' });
      }
    }
    next(err);
  }
};

router.route('/:id')
  .put(requireAdmin, updateProduct)
  .patch(requireAdmin, updateProduct);

/* ---------- Variants (bulk replace) ---------- */
router.post('/:productId/variants/bulk', requireAdmin, wrap(async (req, res) => {
  const productId = IdSchema.parse(req.params.productId);
  const normalized = normalizeVariantsPayload(req.body);
  await prisma.$transaction(async (tx) => {
    await replaceAllVariants(tx, productId, normalized);
  });
  await autoDemoteIfUnavailable(productId);
  res.json({ ok: true, count: normalized.length });
}));

/* ---------- Variants (get) ---------- */
router.get('/:productId/variants', requireAuth, requireAdmin, async (req, res) => {
  const { productId } = req.params;
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: {
      id: true, sku: true, inStock: true,
      options: { include: { attribute: true, value: true } }
    },
    orderBy: { createdAt: 'asc' },
  });
  await autoDemoteIfUnavailable(productId);

  return res.json({ data: variants });
});

/* ---------- Variants (create one) ---------- */
const CreateVariantSchema = z.object({
  sku: z.string().min(1),
  price: z.number().optional(),
  inStock: z.boolean().optional(),
  imagesJson: z.array(z.string()).optional(),
  options: z.array(z.object({
    attributeId: z.string().min(1),
    valueId: z.string().min(1),
  })).default([]),
});

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
    const seen = new Set<string>();
    const sku = await makeUniqueSku(tx, payload.sku, seen);

    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku: sku || '',
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

/* ---------- Offers ---------- */
router.get('/:productId/offers', requireAuth, requireAdmin, async (req, res) => {
  const { productId } = req.params;
  const offers = await prisma.supplierOffer.findMany({
    where: { productId },
    include: {
      supplier: { select: { id: true, name: true, whatsappPhone: true, contactEmail: true, status: true } },
      variant: { select: { id: true, sku: true, inStock: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ data: offers });
});

router.post('/:productId/offers', requireAuth, requireAdmin, async (req, res) => {
  const { productId } = req.params;
  const {
    supplierId,
    variantId,
    price,
    currency = 'NGN',
    inStock = true,
    leadDays,
    isActive = true,
  } = req.body ?? {};

  if (!supplierId || price == null) {
    return res.status(400).json({ error: 'supplierId and price are required' });
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, productId: true },
    });
    if (!variant || variant.productId !== productId) {
      return res.status(400).json({ error: 'variantId does not belong to this product' });
    }
  }

  try {
    const created = await prisma.supplierOffer.create({
      data: {
        supplierId,
        productId,
        variantId: variantId || null,
        price: toDecimal(price),
        currency,
        inStock: !!inStock,
        leadDays: leadDays == null || leadDays === '' ? null : Number(leadDays),
        isActive: !!isActive,
      },
    });
    return res.status(201).json({ data: created });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'An offer for this (supplier, product, variant) already exists' });
    }
    console.error('Create offer failed:', e);
    return res.status(500).json({ error: 'Could not create offer' });
  }
});

router.put('/:productId/offers/:offerId', requireAuth, requireAdmin, async (req, res) => {
  const { productId, offerId } = req.params;
  const payload = req.body ?? {};

  // Ensure offer belongs to this product
  const existing = await prisma.supplierOffer.findUnique({
    where: { id: offerId },
    select: { id: true, productId: true },
  });
  if (!existing || existing.productId !== productId) {
    return res.status(404).json({ error: 'Offer not found for this product' });
  }

  // If variantId is provided, validate it belongs to the product
  if (payload.variantId) {
    const v = await prisma.productVariant.findUnique({
      where: { id: payload.variantId },
      select: { id: true, productId: true },
    });
    if (!v || v.productId !== productId) {
      return res.status(400).json({ error: 'variantId does not belong to this product' });
    }
  }
});


router.delete('/:productId/offers/:offerId', requireAuth, requireAdmin, async (req, res) => {
  const { productId, offerId } = req.params;

  const existing = await prisma.supplierOffer.findUnique({
    where: { id: offerId },
    select: { id: true, productId: true },
  });
  if (!existing || existing.productId !== productId) {
    return res.status(404).json({ error: 'Offer not found for this product' });
  }

  await prisma.supplierOffer.delete({ where: { id: offerId } });
  return res.json({ ok: true });
});

/* ------------------------ helpers (bottom) ------------------------ */

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
        sku: uniqueSku || '',
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

/* ---------- List products  ---------- */
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
          imagesJson: true,
          createdAt: true,
          categoryId: true,
          brandId: true,
          supplierId: true,
          isDeleted: true,
          communicationCost: true,
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
      isDeleted: p.isDeleted,
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
      // NEW
      communicationCost: p.communicationCost != null ? Number(p.communicationCost) : null,
    }));

    res.json({ data, total });
  } catch (e) {
    next(e);
  }
});

// ---------- validation ----------
// ---------- validation (lenient & coercive) ----------
const coerceNumber = (min = 0) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : v;
  }, z.number().min(min));

const coerceInt = (min = 0, def?: number) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return def ?? undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : v;
  }, z.number().int().min(min));

const coerceBool = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  }
  return v;
}, z.boolean());

const offerCreateSchema = z.object({
  variantId: z.string().min(1).optional().nullable(),
  supplierId: z.string().min(1),
  price: coerceNumber(0),                 // accepts "1200" -> 1200
  currency: z.string().min(1).default('NGN'),
  availableQty: coerceInt(0, 0).default(0), // accepts "" -> 0
  leadDays: coerceInt(0, 0).default(0),     // accepts "" -> 0
  isActive: coerceBool.default(true),       // accepts "true"/"false"
});

const offerUpdateSchema = offerCreateSchema.partial();

// ---------- GET: list offers for a product ----------
router.get('/:productId/supplier-offers', requireAdmin, async (req, res, next) => {
  try {
    const { productId } = req.params;

    // Optional: filter by variantId or active status
    const { variantId, active } = req.query as { variantId?: string; active?: string };

    const offers = await prisma.supplierOffer.findMany({
      where: {
        productId,
        ...(variantId ? { variantId } : {}),
        ...(active != null ? { isActive: active === 'true' } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        supplier: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true } },
      },
    });

    // shape to your frontend’s expected keys (supplierName, etc.)
    const data = offers.map((o) => ({
      id: o.id,
      productId: o.productId,
      variantId: o.variantId,
      supplierId: o.supplierId,
      supplierName: o.supplier?.name,
      price: Number(o.price),
      currency: o.currency,
      availableQty: o.availableQty,
      leadDays: o.leadDays,
      isActive: o.isActive,
      variantSku: o.variant?.sku,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------- POST: create offer for a product ----------
router.post('/:productId/supplier-offers', requireAdmin, async (req, res, next) => {
  try {
    const { productId } = req.params;

    // Support both raw body and { data: ... }
    const raw = (req.body?.data ?? req.body) as unknown;
    const parsed = offerCreateSchema.parse(raw);

    // tolerate "PRODUCT" sentinel => null variantId
    const variantId =
      parsed.variantId && parsed.variantId !== 'PRODUCT' ? parsed.variantId : null;

    // (Optional) verify product and supplier exist
    const [product, supplier] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
      prisma.supplier.findUnique({ where: { id: parsed.supplierId }, select: { id: true } }),
    ]);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!supplier) return res.status(400).json({ error: 'Invalid supplierId' });

    // inside POST /:productId/supplier-offers
    const created = await prisma.supplierOffer.create({
      data: {
        productId,
        variantId,
        supplierId: parsed.supplierId,
        price: new Prisma.Decimal(parsed.price), // or your toDecimal(parsed.price)
        currency: parsed.currency ?? 'NGN',
        availableQty: parsed.availableQty ?? 0,
        leadDays: parsed.leadDays ?? 0,
        isActive: parsed.isActive ?? true,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true } },
      },
    });

    await autoDemoteIfUnavailable(productId);

    res.status(201).json({
      data: {
        id: created.id,
        productId: created.productId,
        variantId: created.variantId,
        supplierId: created.supplierId,
        supplierName: created.supplier?.name,
        price: Number(created.price),
        currency: created.currency,
        availableQty: created.availableQty,
        leadDays: created.leadDays,
        isActive: created.isActive,
        variantSku: created.variant?.sku,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid payload', details: err.issues });
    }
    next(err);
  }
});

// ---------- PATCH: update offer ----------
router.patch('/:productId/supplier-offers/:id', requireAdmin, async (req, res, next) => {
  try {
    const { productId, id } = req.params;
    const raw = (req.body?.data ?? req.body) as unknown;
    const patch = offerUpdateSchema.parse(raw);

    // normalize variantId
    const normalized: Record<string, any> = { ...patch };
    if ('variantId' in patch) {
      normalized.variantId =
        patch.variantId && patch.variantId !== 'PRODUCT' ? patch.variantId : null;
    }

    // ensure offer belongs to product
    const existing = await prisma.supplierOffer.findFirst({ where: { id, productId } });
    if (!existing) return res.status(404).json({ error: 'Offer not found for this product' });

    const updated = await prisma.supplierOffer.update({
      where: { id },
      data: normalized,
      include: {
        supplier: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true } },
      },
    });
    await autoDemoteIfUnavailable(productId);
    res.json({
      data: {
        id: updated.id,
        productId: updated.productId,
        variantId: updated.variantId,
        supplierId: updated.supplierId,
        supplierName: updated.supplier?.name,
        price: Number(updated.price),
        currency: updated.currency,
        availableQty: updated.availableQty,
        leadDays: updated.leadDays,
        isActive: updated.isActive,
        variantSku: updated.variant?.sku,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid payload', details: err.issues });
    }
    next(err);
  }
});

// ---------- DELETE: remove offer ----------
router.delete('/:productId/supplier-offers/:id', requireAdmin, async (req, res, next) => {
  try {
    const { productId, id } = req.params;
    const existing = await prisma.supplierOffer.findFirst({ where: { id, productId } });
    if (!existing) return res.status(404).json({ error: 'Offer not found for this product' });

    await prisma.supplierOffer.delete({ where: { id } });
    await autoDemoteIfUnavailable(productId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});


// // src/routes/admin.products.ts
// import { Router, Request, Response } from 'express';
// import { prisma } from '../lib/prisma.js';
// import { strictAuth, requireRole } from '../lib/authz.js'; // adjust to your auth middleware

// const router = Router();

router.post(
  '/:id/restore',
  requireAdmin, requireAuth,
  async (req, res) => {
    const { id } = req.params;
    try {
      const product = await prisma.product.findUnique({
        where: { id },
        select: { id: true, isDeleted: true, status: true },
      });

      if (!product) {
        return res.status(404).json({ ok: false, error: 'Product not found' });
      }

      if (!product.isDeleted) {
        // Already restored / not archived — no-op
        return res.json({ ok: true, data: product, note: 'Product was not archived' });
      }

      // Optional: allow caller to pick status on restore (?status=PENDING|PUBLISHED)
      const qsStatusRaw = String(req.query.status || '').toUpperCase();
      const allowedStatuses = new Set(['PENDING', 'PUBLISHED']);
      const nextStatus = allowedStatuses.has(qsStatusRaw) ? qsStatusRaw : undefined;

      const updated = await prisma.product.update({
        where: { id },
        data: {
          isDeleted: false,
          ...(nextStatus ? { status: nextStatus as 'PENDING' | 'PUBLISHED' } : {}),
        },
      });

      return res.json({ ok: true, data: updated });
    } catch (err: any) {
      console.error('restore product failed:', err?.message || err);
      return res.status(500).json({ ok: false, error: 'Restore failed' });
    }
  }
);

export default router;
