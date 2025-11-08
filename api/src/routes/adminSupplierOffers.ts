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

function normalizeBody(raw: any) {
  const src = raw?.data ?? raw?.offer ?? raw ?? {};
  const out: any = { ...src };

  // Did the client explicitly touch variant?
  const hadVariantKey =
    Object.prototype.hasOwnProperty.call(src, 'variantId') ||
    Object.prototype.hasOwnProperty.call(src, 'variant');

  // alias: variant -> variantId
  if (out.variantId == null && out.variant != null) {
    out.variantId = out.variant;
  }

  // If client explicitly sent something for variant:
  if (hadVariantKey) {
    // UI uses "" or "PRODUCT" to mean "generic product-level offer"
    if (
      out.variantId === '' ||
      out.variantId === 'PRODUCT' ||
      out.variantId === undefined
    ) {
      // explicit "no variant"
      out.variantId = null;
    } else if (out.variantId != null) {
      // normalize to string id
      out.variantId = String(out.variantId);
    }
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
 * SUMMARY: GET /api/admin/supplier-offers?productIds=...|productId=...
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
 * CORE LIST: GET /api/admin/products/:productId/supplier-offers
 * Used by SuppliersOfferManager
 * --------------------------------------------------------------------------*/

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

/* ----------------------------------------------------------------------------
 * SINGLE CREATE: POST /api/admin/products/:productId/supplier-offers
 * (includes proper variantId storage)
 * --------------------------------------------------------------------------*/

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

      // validate + normalize variantId (ensure it belongs to product)
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
          variantId, // ✅ link to ProductVariant or null for generic offer
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
 * CORE UPDATE IMPLEMENTATION
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

  // variantId (explicit only)
  if (Object.prototype.hasOwnProperty.call(patch, 'variantId')) {
    if (patch.variantId == null) {
      // explicit generic product-level offer
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
        data.variantId = vid; // ✅ store valid variant linkage
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

/* ----------------------------------------------------------------------------
 * SINGLE UPDATE: PATCH /api/admin/supplier-offers/:id
 * (canonical update endpoint; includes variant handling)
 * --------------------------------------------------------------------------*/

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

/* ----------------------------------------------------------------------------
 * DELETE (kept as-is, no duplicates for create/update)
 * --------------------------------------------------------------------------*/

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
