// api/src/routes/adminSupplierOffers.ts
import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const router = express.Router();

/* ----------------------------------------------------------------------------
 * Helpers: coercion & normalization
 * --------------------------------------------------------------------------*/

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
    if (['true', '1', 'yes', 'on', 'y'].includes(s)) return true;
    if (['false', '0', 'no', 'off', 'n'].includes(s)) return false;
  }
  return v;
}, z.boolean());

/**
 * Normalize incoming body:
 * - unwrap { data: ... } or { offer: ... }
 * - map leadTimeDays -> leadDays
 * - map available/qty/stock -> availableQty
 * - support legacy "variant" as variantId
 * - normalize variantId:
 *     "" / "PRODUCT" / undefined => not provided
 *     null => explicit generic (null)
 */
function normalizeBody(raw: any) {
  const src = raw?.data ?? raw?.offer ?? raw ?? {};
  const out: any = { ...src };

  // alias: variant -> variantId
  if (out.variantId == null && out.variant != null) {
    out.variantId = out.variant;
  }

  // treat "" / "PRODUCT" / undefined as "not provided" here
  if (
    out.variantId === '' ||
    out.variantId === 'PRODUCT' ||
    out.variantId === undefined
  ) {
    delete out.variantId;
  }

  // leadTimeDays -> leadDays
  if (out.leadDays == null && out.leadTimeDays != null) {
    out.leadDays = out.leadTimeDays;
  }

  // available / qty / stock -> availableQty
  if (
    out.availableQty == null &&
    (out.available != null || out.qty != null || out.stock != null)
  ) {
    out.availableQty = out.available ?? out.qty ?? out.stock;
  }

  return out;
}

/* ----------------------------------------------------------------------------
 * Schemas
 * --------------------------------------------------------------------------*/

const offerBaseSchema = z.object({
  productId: z.string().min(1).optional(),
  variantId: z.string().min(1).nullable().optional(),
  supplierId: z.string().min(1),
  price: coerceNumber(0),
  currency: z.string().min(1).default('NGN'),
  availableQty: coerceInt(0, 0).default(0),
  leadDays: coerceInt(0, 0).optional(),
  isActive: coerceBool.default(true),
});

const offerCreateSchema = offerBaseSchema.extend({
  productId: z.string().min(1),
});

const offerUpdateSchema = offerBaseSchema.partial();

/* ----------------------------------------------------------------------------
 * Mapper
 * --------------------------------------------------------------------------*/

function toOfferDto(o: any) {
  return {
    id: o.id,
    productId: o.productId,
    supplierId: o.supplierId,
    supplierName: o.supplier?.name,
    variantId: o.variantId,
    variantSku: o.variant?.sku ?? undefined,
    price: Number(o.price),
    currency: o.currency,
    availableQty: o.availableQty ?? 0,
    leadDays: o.leadDays ?? undefined,
    isActive: !!o.isActive,
    inStock: !!o.inStock,
  };
}

/* ----------------------------------------------------------------------------
 * LEGACY: POST /api/admin/suppliers/:supplierId/offers
 * --------------------------------------------------------------------------*/

router.post('/suppliers/:supplierId/offers', requireAuth, async (req, res) => {
  const me = req.user!;
  if (!['ADMIN', 'SUPER_ADMIN'].includes(me.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { supplierId } = req.params;
  const { productId, variantId = null, price } = req.body || {};
  if (!productId || price == null) {
    return res.status(400).json({ error: 'productId and price required' });
  }

  const data = await prisma.supplierOffer.upsert({
    where: {
      supplierId_productId_variantId: {
        supplierId,
        productId,
        variantId: variantId || null,
      },
    },
    create: {
      supplierId,
      productId,
      variantId: variantId || null,
      price,
      inStock: true,
      isActive: true,
    },
    update: {
      price,
    },
  });

  res.json({ ok: true, data: toOfferDto(data) });
});

/* ----------------------------------------------------------------------------
 * SUMMARY: GET /api/admin/supplier-offers?productIds=...
 * --------------------------------------------------------------------------*/

router.get(
  '/supplier-offers',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { productIds, productId } = req.query as {
        productIds?: string;
        productId?: string;
      };

      const where: any = {};
      if (productIds) {
        const ids = String(productIds)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (ids.length) where.productId = { in: ids };
      } else if (productId) {
        where.productId = String(productId);
      }

      const offers = await prisma.supplierOffer.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        data: offers.map((o: { id: any; productId: any; supplierId: any; supplier: { name: any; }; variantId: any; variant: { sku: any; }; isActive: any; inStock: any; availableQty: any; }) => ({
          id: o.id,
          productId: o.productId,
          supplierId: o.supplierId,
          supplierName: o.supplier?.name,
          variantId: o.variantId,
          variantSku: o.variant?.sku ?? undefined,
          isActive: o.isActive,
          inStock: o.inStock,
          availableQty: o.availableQty ?? 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ----------------------------------------------------------------------------
 * CORE: /api/admin/products/:productId/supplier-offers
 * --------------------------------------------------------------------------*/

// GET list for SuppliersOfferManager
router.get(
  '/products/:productId/supplier-offers',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { productId } = req.params;
      const { variantId, active } = req.query as {
        variantId?: string;
        active?: string;
      };

      const where: any = { productId };
      if (variantId) where.variantId = variantId;
      if (active != null) where.isActive = active === 'true';

      const offers = await prisma.supplierOffer.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }],
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true } },
        },
      });

      res.json({ data: offers.map(toOfferDto) });
    } catch (err) {
      next(err);
    }
  }
);

// CREATE
router.post(
  '/products/:productId/supplier-offers',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { productId } = req.params;
      const raw = normalizeBody(req.body);
      if (!raw.productId) raw.productId = productId;

      const parsed = offerCreateSchema.parse(raw);

      const [product, supplier] = await Promise.all([
        prisma.product.findUnique({
          where: { id: parsed.productId },
          select: { id: true },
        }),
        prisma.supplier.findUnique({
          where: { id: parsed.supplierId },
          select: { id: true },
        }),
      ]);

      if (!product) return res.status(404).json({ error: 'Product not found' });
      if (!supplier)
        return res.status(400).json({ error: 'Invalid supplierId' });

      // normalize + validate variantId
      let variantId: string | null = null;
      if (parsed.variantId != null) {
        const vid = String(parsed.variantId);
        if (vid && vid !== 'PRODUCT') {
          const variant = await prisma.productVariant.findUnique({
            where: { id: vid },
            select: { id: true, productId: true },
          });
          if (!variant || variant.productId !== parsed.productId) {
            return res
              .status(400)
              .json({ error: 'variantId does not belong to this product' });
          }
          variantId = vid;
        }
      }

      const created = await prisma.supplierOffer.create({
        data: {
          productId: parsed.productId,
          supplierId: parsed.supplierId,
          variantId,
          price: parsed.price,
          currency: parsed.currency ?? 'NGN',
          availableQty: parsed.availableQty ?? 0,
          leadDays:
            parsed.leadDays == null || Number.isNaN(parsed.leadDays)
              ? null
              : parsed.leadDays,
          isActive: parsed.isActive ?? true,
          inStock: (parsed.isActive ?? true) && (parsed.availableQty ?? 0) > 0,
        },
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true } },
        },
      });

      res.status(201).json({ data: toOfferDto(created) });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: err.issues });
      }
      next(err);
    }
  }
);

/* ----------------------------------------------------------------------------
 * LEGACY: /api/admin/products/:productId/offers
 * (kept here to avoid mixing into adminProducts.ts)
 * --------------------------------------------------------------------------*/

router.get(
  '/products/:productId/offers',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { productId } = req.params;
    const offers = await prisma.supplierOffer.findMany({
      where: { productId },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            whatsappPhone: true,
            contactEmail: true,
            status: true,
          },
        },
        variant: { select: { id: true, sku: true, inStock: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ data: offers });
  }
);

router.post(
  '/products/:productId/offers',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { productId } = req.params;
    const {
      supplierId,
      variantId,
      price,
      currency = 'NGN',
      inStock = true,
      leadDays,
      isActive = true,
    } = (req.body ?? {}) as any;

    if (!supplierId || price == null) {
      return res
        .status(400)
        .json({ error: 'supplierId and price are required' });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    let nextVariantId: string | null = null;
    if (variantId) {
      const v = await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, productId: true },
      });
      if (!v || v.productId !== productId) {
        return res
          .status(400)
          .json({ error: 'variantId does not belong to this product' });
      }
      nextVariantId = v.id;
    }

    try {
      const created = await prisma.supplierOffer.create({
        data: {
          supplierId,
          productId,
          variantId: nextVariantId,
          price,
          currency,
          inStock: !!inStock,
          leadDays:
            leadDays == null || leadDays === '' ? null : Number(leadDays),
          isActive: !!isActive,
        },
      });
      return res.status(201).json({ data: created });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return res.status(409).json({
          error:
            'An offer for this (supplier, product, variant) already exists',
        });
      }
      console.error('Create offer failed:', e);
      return res.status(500).json({ error: 'Could not create offer' });
    }
  }
);

router.put(
  '/products/:productId/offers/:offerId',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { productId, offerId } = req.params;
    const raw = (req.body?.data ?? req.body ?? {}) as any;

    const existing = await prisma.supplierOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        productId: true,
        supplierId: true,
        variantId: true,
        price: true,
        currency: true,
        availableQty: true,
        leadDays: true,
        isActive: true,
      },
    });

    if (!existing || existing.productId !== productId) {
      return res
        .status(404)
        .json({ error: 'Offer not found for this product' });
    }

    const data: any = {};

    if (raw.supplierId) {
      const s = await prisma.supplier.findUnique({
        where: { id: raw.supplierId },
        select: { id: true },
      });
      if (!s) {
        return res.status(400).json({ error: 'Invalid supplierId' });
      }
      data.supplierId = raw.supplierId;
    }

    if (Object.prototype.hasOwnProperty.call(raw, 'variantId')) {
      if (!raw.variantId) {
        data.variantId = null;
      } else {
        const v = await prisma.productVariant.findUnique({
          where: { id: raw.variantId },
          select: { id: true, productId: true },
        });
        if (!v || v.productId !== productId) {
          return res
            .status(400)
            .json({ error: 'variantId does not belong to this product' });
        }
        data.variantId = v.id;
      }
    }

    if (raw.price !== undefined) {
      const n = Number(raw.price);
      if (!Number.isFinite(n)) {
        return res.status(400).json({ error: 'Invalid price' });
      }
      data.price = n;
    }

    if (raw.currency !== undefined) {
      data.currency = String(raw.currency || 'NGN');
    }

    if (raw.availableQty !== undefined) {
      const n = Number(raw.availableQty);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'Invalid availableQty' });
      }
      data.availableQty = Math.trunc(n);
    }

    if (raw.leadDays !== undefined) {
      if (raw.leadDays === null || raw.leadDays === '') {
        data.leadDays = null;
      } else {
        const n = Number(raw.leadDays);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ error: 'Invalid leadDays' });
        }
        data.leadDays = Math.trunc(n);
      }
    }

    if (raw.isActive !== undefined) {
      data.isActive = !!raw.isActive;
    }

    const nextAvailable =
      data.availableQty != null
        ? data.availableQty
        : existing.availableQty ?? 0;
    const nextIsActive =
      data.isActive != null ? data.isActive : existing.isActive;

    data.inStock = !!nextIsActive && nextAvailable > 0;

    try {
      const updated = await prisma.supplierOffer.update({
        where: { id: offerId },
        data,
      });
      return res.json({ data: updated });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return res.status(409).json({
          error:
            'An offer for this (supplier, product, variant) already exists',
        });
      }
      console.error('Update offer failed:', e);
      return res.status(500).json({ error: 'Could not update offer' });
    }
  }
);

router.delete(
  '/products/:productId/offers/:offerId',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { productId, offerId } = req.params;

    const existing = await prisma.supplierOffer.findUnique({
      where: { id: offerId },
      select: { id: true, productId: true },
    });
    if (!existing || existing.productId !== productId) {
      return res
        .status(404)
        .json({ error: 'Offer not found for this product' });
    }

    await prisma.supplierOffer.delete({ where: { id: offerId } });
    return res.json({ ok: true });
  }
);

/* ----------------------------------------------------------------------------
 * GENERIC UPDATE/DELETE by id
 * --------------------------------------------------------------------------*/

async function updateOfferCore(
  productId: string | null,
  id: string,
  rawBody: any
) {
  const raw = normalizeBody(rawBody);

  const existing = await prisma.supplierOffer.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true } },
    },
  });

  if (!existing) {
    throw Object.assign(new Error('Offer not found'), { statusCode: 404 });
  }

  if (productId && existing.productId !== productId) {
    throw Object.assign(new Error('Offer not found for this product'), {
      statusCode: 404,
    });
  }

  const patch = offerUpdateSchema.parse({
    ...raw,
    productId: existing.productId,
  });

  const data: any = {};

  // supplierId
  if (patch.supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: patch.supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw Object.assign(new Error('Invalid supplierId'), {
        statusCode: 400,
      });
    }
    data.supplierId = patch.supplierId;
  }

  // variantId when explicitly present
  if (Object.prototype.hasOwnProperty.call(patch, 'variantId')) {
    if (patch.variantId == null) {
      data.variantId = null;
    } else {
      const vid = String(patch.variantId);
      if (vid && vid !== 'PRODUCT') {
        const variant = await prisma.productVariant.findUnique({
          where: { id: vid },
          select: { id: true, productId: true },
        });
        if (!variant || variant.productId !== existing.productId) {
          throw Object.assign(
            new Error('variantId does not belong to this product'),
            { statusCode: 400 }
          );
        }
        data.variantId = vid;
      } else {
        data.variantId = null;
      }
    }
  }

  if (patch.price !== undefined) data.price = patch.price;
  if (patch.currency !== undefined) data.currency = patch.currency;
  if (patch.availableQty !== undefined)
    data.availableQty = patch.availableQty;
  if (patch.leadDays !== undefined) {
    data.leadDays =
      patch.leadDays == null || Number.isNaN(patch.leadDays)
        ? null
        : patch.leadDays;
  }
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const nextAvailable =
    data.availableQty != null
      ? data.availableQty
      : existing.availableQty ?? 0;
  const nextIsActive =
    data.isActive != null ? data.isActive : existing.isActive;

  data.inStock = !!nextIsActive && nextAvailable > 0;

  const updated = await prisma.supplierOffer.update({
    where: { id },
    data,
    include: {
      supplier: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true } },
    },
  });

  return updated;
}

// PATCH /api/admin/products/:productId/supplier-offers/:id
router.patch(
  '/products/:productId/supplier-offers/:id',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { productId, id } = req.params;
      const updated = await updateOfferCore(productId, id, req.body);
      res.json({ data: toOfferDto(updated) });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: err.issues });
      }
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  }
);

// PUT /api/admin/products/:productId/supplier-offers/:id
router.put(
  '/products/:productId/supplier-offers/:id',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { productId, id } = req.params;
      const updated = await updateOfferCore(productId, id, req.body);
      res.json({ data: toOfferDto(updated) });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: err.issues });
      }
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  }
);

// PATCH /api/admin/supplier-offers/:id
router.patch(
  '/supplier-offers/:id',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const updated = await updateOfferCore(null, id, req.body);
      res.json({ data: toOfferDto(updated) });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: err.issues });
      }
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  }
);

// PUT /api/admin/supplier-offers/:id
router.put(
  '/supplier-offers/:id',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const updated = await updateOfferCore(null, id, req.body);
      res.json({ data: toOfferDto(updated) });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: err.issues });
      }
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  }
);

// DELETE /api/admin/products/:productId/supplier-offers/:id
router.delete(
  '/products/:productId/supplier-offers/:id',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { productId, id } = req.params;
      const existing = await prisma.supplierOffer.findUnique({
        where: { id },
        select: { id: true, productId: true },
      });
      if (!existing || existing.productId !== productId) {
        return res
          .status(404)
          .json({ error: 'Offer not found for this product' });
      }
      await prisma.supplierOffer.delete({ where: { id } });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/admin/supplier-offers/:id
router.delete(
  '/supplier-offers/:id',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await prisma.supplierOffer.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) {
        return res.status(404).json({ error: 'Offer not found' });
      }
      await prisma.supplierOffer.delete({ where: { id } });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
