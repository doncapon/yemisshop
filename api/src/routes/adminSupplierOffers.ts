// api/src/routes/adminSupplierOffers.ts
import express from "express";
import { Prisma } from "@prisma/client";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";

import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";

const router = express.Router();

/* ----------------------------------------------------------------------------
 * Async wrapper
 * --------------------------------------------------------------------------*/
const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler =>
    (req, res, next) =>
      Promise.resolve(fn(req, res, next)).catch(next);

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/
const toDecimal = (v: any) => new Prisma.Decimal(String(v));

const coerceNumber = (min = 0) =>
  z.preprocess((v) => {
    if (v === "" || v == null) return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : v;
  }, z.number().min(min));

const coerceInt = (min = 0, def?: number) =>
  z.preprocess((v) => {
    if (v === "" || v == null) return def ?? undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : v;
  }, z.number().int().min(min));

const coerceBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "on", "y"].includes(s)) return true;
    if (["false", "0", "no", "off", "n"].includes(s)) return false;
  }
  return v;
}, z.boolean());

function parsePrefixedId(id: string): { kind: "BASE" | "VARIANT" | "LEGACY"; rawId: string } {
  const s = String(id || "");
  if (s.startsWith("base:")) return { kind: "BASE", rawId: s.slice("base:".length) };
  if (s.startsWith("variant:")) return { kind: "VARIANT", rawId: s.slice("variant:".length) };
  return { kind: "LEGACY", rawId: s };
}

/**
 * Hard-delete safety:
 * Block deletes if product OR any of its variants have ever been used in orders.
 */
async function assertProductOffersDeletable(productId: string) {
  const hit = await prisma.orderItem.findFirst({
    where: {
      OR: [{ productId }, { variant: { productId } }],
    } as any,
    select: { id: true },
  });

  if (hit) {
    const err: any = new Error(
      "Cannot delete supplier offers: this product (or its variants) has been used in orders."
    );
    err.statusCode = 409;
    throw err;
  }
}

/* ----------------------------------------------------------------------------
 * Schemas
 * --------------------------------------------------------------------------*/
const createSchema = z.object({
  supplierId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(), // null => BASE offer

  basePrice: coerceNumber(0).optional(), // BASE only
  priceBump: coerceNumber(0).optional(), // VARIANT only

  currency: z.string().min(1).default("NGN"),
  availableQty: coerceInt(0, 0).optional(),
  leadDays: coerceInt(0, 0).nullable().optional(),
  isActive: coerceBool.default(true),
});

const patchBaseSchema = z.object({
  basePrice: coerceNumber(0).optional(),
  currency: z.string().min(1).optional(),
  availableQty: coerceInt(0).optional(),
  leadDays: coerceInt(0).nullable().optional(),
  isActive: coerceBool.optional(),
});

const patchVariantSchema = z.object({
  priceBump: coerceNumber(0).optional(),
  currency: z.string().min(1).optional(),
  availableQty: coerceInt(0).optional(),
  leadDays: coerceInt(0).nullable().optional(),
  isActive: coerceBool.optional(),
});

/* ----------------------------------------------------------------------------
 * Unified DTO (what SuppliersOfferManager expects)
 * --------------------------------------------------------------------------*/
function toUnifiedDtoBase(base: any) {
  const basePriceNum = base.basePrice != null ? Number(base.basePrice) : 0;

  return {
    id: `base:${base.id}`,
    kind: "BASE" as const,

    supplierId: base.supplierId,
    supplierName: base.supplier?.name,

    productId: base.productId,

    variantId: null,
    variantSku: undefined,

    basePrice: basePriceNum,
    priceBump: 0,
    offerPrice: basePriceNum,

    currency: base.currency ?? "NGN",
    availableQty: base.availableQty ?? 0,
    leadDays: base.leadDays ?? undefined,
    isActive: !!base.isActive,
    inStock: !!base.inStock,
  };
}

function toUnifiedDtoVariant(
  v: any,
  basePriceBySupplier: Map<string, number>,
  overrideProductId?: string
) {
  // ✅ source of truth is Variant.productId (not supplierVariantOffer.productId)
  const trueProductId =
    overrideProductId ?? (v?.variant?.productId ? String(v.variant.productId) : v.productId);

  const basePriceNum =
    basePriceBySupplier.get(String(v.supplierId)) ??
    (v.supplierProductOffer?.basePrice != null ? Number(v.supplierProductOffer.basePrice) : 0);

  const bumpNum = v.priceBump != null ? Number(v.priceBump) : 0;

  return {
    id: `variant:${v.id}`,
    kind: "VARIANT" as const,

    supplierId: v.supplierId,
    supplierName: v.supplier?.name,

    // ✅ force correct product id
    productId: trueProductId,

    variantId: v.variantId,
    variantSku: v.variant?.sku ?? undefined,

    basePrice: basePriceNum,
    priceBump: bumpNum,
    offerPrice: basePriceNum + bumpNum,

    currency: v.currency ?? v.supplierProductOffer?.currency ?? "NGN",
    availableQty: v.availableQty ?? 0,
    leadDays: v.leadDays ?? undefined,
    isActive: !!v.isActive,
    inStock: !!v.inStock,
  };
}

/* ----------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------*/
router.use(requireAuth, requireAdmin);

/* ----------------------------------------------------------------------------
 * ROUTES
 * --------------------------------------------------------------------------*/

/**
 * Shared handler: GET bulk offers for many products
 * Used by:
 * - GET /supplier-offers?productIds=...
 * - GET /?productIds=...   (if router mounted at /api/admin/supplier-offers)
 */
const bulkOffersHandler = wrap(async (req, res) => {
  const productIdsRaw = String(req.query.productIds ?? "").trim();
  const productIdSingle = String(req.query.productId ?? "").trim(); // optional legacy support

  const ids =
    productIdsRaw
      ? Array.from(
          new Set(
            productIdsRaw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        )
      : productIdSingle
        ? [productIdSingle]
        : [];

  if (!ids.length) {
    return res.status(400).json({ error: "productIds (or productId) is required" });
  }

  const [baseOffers, variantOffers] = await Promise.all([
    prisma.supplierProductOffer.findMany({
      where: { productId: { in: ids } },
      orderBy: { createdAt: "desc" },
      include: { supplier: { select: { id: true, name: true } } },
    }),

    prisma.supplierVariantOffer.findMany({
      // ✅ CRITICAL: filter by variant.productId, NOT supplierVariantOffer.productId
      where: { variant: { productId: { in: ids } } } as any,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true, productId: true } },
        supplierProductOffer: { select: { id: true, supplierId: true, basePrice: true, currency: true } },
      },
    }),
  ]);

  // Base price map per (productId, supplierId)
  const key = (pid: string, sid: string) => `${pid}::${sid}`;
  const basePriceByProductSupplier = new Map<string, number>();

  for (const b of baseOffers as any[]) {
    basePriceByProductSupplier.set(
      key(String(b.productId), String(b.supplierId)),
      b.basePrice != null ? Number(b.basePrice) : 0
    );
  }

  const out: any[] = [];

  for (const b of baseOffers as any[]) out.push(toUnifiedDtoBase(b));

  for (const v of variantOffers as any[]) {
    const pid = v?.variant?.productId ? String(v.variant.productId) : String(v.productId);
    const sid = String(v.supplierId);

    const basePrice = basePriceByProductSupplier.get(key(pid, sid)) ?? 0;
    const basePriceBySupplier = new Map<string, number>([[sid, basePrice]]);

    out.push(toUnifiedDtoVariant(v, basePriceBySupplier, pid));
  }

  return res.json({ data: out });
});

/**
 * ✅ What ManageProducts.tsx calls (common mounting: app.use("/api/admin", router))
 * GET /api/admin/supplier-offers?productIds=a,b,c
 */
router.get("/supplier-offers", bulkOffersHandler);

/**
 * ✅ Compatibility if you mounted this router at: app.use("/api/admin/supplier-offers", router)
 * GET /api/admin/supplier-offers?productIds=a,b,c
 */
router.get("/", bulkOffersHandler);

/**
 * GET /api/admin/products/:productId/supplier-offers
 * Return a FLAT array: { data: OfferApi[] }
 */
router.get(
  "/products/:productId/supplier-offers",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const [baseOffers, variantOffers] = await Promise.all([
      prisma.supplierProductOffer.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        include: { supplier: { select: { id: true, name: true } } },
      }),

      // ✅ CRITICAL: filter by variant.productId, not supplierVariantOffer.productId
      prisma.supplierVariantOffer.findMany({
        where: { variant: { productId } } as any,
        orderBy: { createdAt: "desc" },
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, productId: true } },
          supplierProductOffer: { select: { id: true, supplierId: true, basePrice: true, currency: true } },
        },
      }),
    ]);

    const basePriceBySupplier = new Map<string, number>();
    for (const b of baseOffers as any[]) {
      basePriceBySupplier.set(String(b.supplierId), b.basePrice != null ? Number(b.basePrice) : 0);
    }

    const out: any[] = [];
    for (const b of baseOffers as any[]) out.push(toUnifiedDtoBase(b));
    for (const v of variantOffers as any[]) out.push(toUnifiedDtoVariant(v, basePriceBySupplier, productId));

    res.json({ data: out });
  })
);

/**
 * POST /api/admin/products/:productId/supplier-offers
 * BASE:   { supplierId, variantId:null, basePrice, ... }
 * VARIANT:{ supplierId, variantId, priceBump, ... }  (ensures base exists)
 */
router.post(
  "/products/:productId/supplier-offers",
  wrap(async (req, res, next) => {
    try {
      const productId = String(req.params.productId);
      const parsed = createSchema.parse(req.body ?? {});
      const supplierId = parsed.supplierId;
      const variantId = parsed.variantId ?? null;

      const [product, supplier] = await Promise.all([
        prisma.product.findUnique({ where: { id: productId }, select: { id: true, retailPrice: true } }),
        prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }),
      ]);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!supplier) return res.status(404).json({ error: "Supplier not found" });

      const qty = Math.max(0, parsed.availableQty ?? 0);
      const isActive = parsed.isActive ?? true;
      const inStock = !!isActive && qty > 0;

      // BASE
      if (!variantId) {
        const basePrice =
          parsed.basePrice != null
            ? parsed.basePrice
            : product.retailPrice != null
              ? Number(product.retailPrice)
              : 0;

        const upserted = await prisma.supplierProductOffer.upsert({
          where: { supplierId_productId: { supplierId, productId } },
          create: {
            supplierId,
            productId,
            basePrice: toDecimal(basePrice),
            currency: parsed.currency ?? "NGN",
            availableQty: qty,
            leadDays: parsed.leadDays == null ? null : parsed.leadDays,
            isActive,
            inStock,
          },
          update: {
            basePrice: toDecimal(basePrice),
            currency: parsed.currency ?? "NGN",
            availableQty: qty,
            leadDays: parsed.leadDays == null ? null : parsed.leadDays,
            isActive,
            inStock,
          },
          include: { supplier: { select: { id: true, name: true } } },
        });
        await recomputeProductStockTx(prisma as any, productId);

        return res.status(201).json({ data: toUnifiedDtoBase(upserted) });
      }

      // VARIANT must belong to this product
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, productId: true },
      });
      if (!variant || String(variant.productId) !== productId) {
        return res.status(400).json({ error: "variantId does not belong to this product" });
      }

      // ensure base exists
      const base = await prisma.supplierProductOffer.upsert({
        where: { supplierId_productId: { supplierId, productId } },
        create: {
          supplierId,
          productId,
          basePrice: toDecimal(product.retailPrice != null ? Number(product.retailPrice) : 0),
          currency: parsed.currency ?? "NGN",
          availableQty: 0,
          leadDays: null,
          isActive: true,
          inStock: true,
        },
        update: {},
        select: { id: true, supplierId: true, basePrice: true, currency: true },
      });

      const bump = parsed.priceBump ?? 0;

      const created = await prisma.supplierVariantOffer.upsert({
        where: { supplierId_variantId: { supplierId, variantId } },
        create: {
          supplierId,
          productId, // ✅ force from URL
          variantId,
          supplierProductOfferId: base.id,
          priceBump: toDecimal(bump),
          currency: parsed.currency ?? base.currency ?? "NGN",
          availableQty: qty,
          leadDays: parsed.leadDays == null ? null : parsed.leadDays,
          isActive,
          inStock,
        },
        update: {
          supplierProductOfferId: base.id,
          priceBump: toDecimal(bump),
          currency: parsed.currency ?? base.currency ?? "NGN",
          availableQty: qty,
          leadDays: parsed.leadDays == null ? null : parsed.leadDays,
          isActive,
          inStock,
          productId, // ✅ fix corrupted rows too
        },
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, productId: true } },
          supplierProductOffer: { select: { id: true, supplierId: true, basePrice: true, currency: true } },
        },
      });

      const basePriceBySupplier = new Map<string, number>([
        [supplierId, base.basePrice != null ? Number(base.basePrice) : 0],
      ]);

      return res.status(201).json({ data: toUnifiedDtoVariant(created, basePriceBySupplier, productId) });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid payload", details: err.issues });
      }
      next(err);
    }
  })
);

/**
 * PATCH /api/admin/supplier-offers/:id
 * id is prefixed: base:<id> | variant:<id>
 */
router.patch(
  "/supplier-offers/:id",
  wrap(async (req, res, next) => {
    try {
      const parsedId = parsePrefixedId(String(req.params.id || ""));

      if (parsedId.kind === "LEGACY") {
        return res.status(400).json({
          error: "Legacy offer id received. Use base:<id> or variant:<id> with the new 2-table system.",
        });
      }

      if (parsedId.kind === "BASE") {
        const patch = patchBaseSchema.parse(req.body ?? {});

        const existing = await prisma.supplierProductOffer.findUnique({
          where: { id: parsedId.rawId },
          select: { id: true, productId: true, supplierId: true, isActive: true, availableQty: true },
        });
        if (!existing) return res.status(404).json({ error: "Base offer not found" });

        const nextQty = patch.availableQty != null ? patch.availableQty : existing.availableQty ?? 0;
        const nextIsActive = patch.isActive != null ? patch.isActive : existing.isActive;
        const nextInStock = !!nextIsActive && nextQty > 0;

        const updated = await prisma.supplierProductOffer.update({
          where: { id: parsedId.rawId },
          data: {
            ...(patch.basePrice != null ? { basePrice: toDecimal(patch.basePrice) } : {}),
            ...(patch.currency != null ? { currency: patch.currency } : {}),
            ...(patch.availableQty != null ? { availableQty: patch.availableQty } : {}),
            ...(patch.leadDays !== undefined ? { leadDays: patch.leadDays == null ? null : patch.leadDays } : {}),
            ...(patch.isActive != null ? { isActive: patch.isActive } : {}),
            inStock: nextInStock,
          },
          include: { supplier: { select: { id: true, name: true } } },
        });

        // ✅ FIX #1: pass productId (string), not the updated object
        await recomputeProductStockTx(prisma as any, String(updated.productId));

        // ✅ FIX #2: return the updated base offer row (dto expects base row)
        return res.json({ data: toUnifiedDtoBase(updated) });
      }

      // VARIANT
      const patch = patchVariantSchema.parse(req.body ?? {});

      const existing = await prisma.supplierVariantOffer.findUnique({
        where: { id: parsedId.rawId },
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, productId: true } },
          supplierProductOffer: { select: { id: true, supplierId: true, basePrice: true, currency: true } },
        },
      });
      if (!existing) return res.status(404).json({ error: "Variant offer not found" });

      const forcedProductId = existing.variant?.productId
        ? String(existing.variant.productId)
        : String(existing.productId);

      const nextQty = patch.availableQty != null ? patch.availableQty : existing.availableQty ?? 0;
      const nextIsActive = patch.isActive != null ? patch.isActive : existing.isActive;
      const nextInStock = !!nextIsActive && nextQty > 0;

      const updated = await prisma.supplierVariantOffer.update({
        where: { id: parsedId.rawId },
        data: {
          ...(patch.priceBump != null ? { priceBump: toDecimal(patch.priceBump) } : {}),
          ...(patch.currency != null ? { currency: patch.currency } : {}),
          ...(patch.availableQty != null ? { availableQty: patch.availableQty } : {}),
          ...(patch.leadDays !== undefined ? { leadDays: patch.leadDays == null ? null : patch.leadDays } : {}),
          ...(patch.isActive != null ? { isActive: patch.isActive } : {}),
          inStock: nextInStock,
          productId: forcedProductId, // ✅ keep consistent with variant.productId
        },
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, productId: true } },
          supplierProductOffer: { select: { id: true, supplierId: true, basePrice: true, currency: true } },
        },
      });

      const basePriceBySupplier = new Map<string, number>([
        [
          String(updated.supplierId),
          updated.supplierProductOffer?.basePrice != null ? Number(updated.supplierProductOffer.basePrice) : 0,
        ],
      ]);
      await recomputeProductStockTx(prisma as any, forcedProductId);

      return res.json({ data: toUnifiedDtoVariant(updated, basePriceBySupplier, forcedProductId) });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid payload", details: err.issues });
      }
      if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  })
);

/**
 * DELETE /api/admin/supplier-offers/:id
 * id is prefixed: base:<id> | variant:<id>
 */
router.delete(
  "/supplier-offers/:id",
  wrap(async (req, res) => {
    const parsedId = parsePrefixedId(String(req.params.id || "").trim());

    if (parsedId.kind === "LEGACY") {
      return res.status(400).json({
        error: "Legacy offer id received. Use base:<id> or variant:<id> with the new 2-table system.",
      });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      if (parsedId.kind === "VARIANT") {
        // fetch to know productId for recompute
        const row = await tx.supplierVariantOffer.findUnique({
          where: { id: parsedId.rawId },
          select: { id: true, productId: true, variant: { select: { productId: true } } },
        });
        if (!row) return { ok: false, status: 404, msg: "Variant offer not found" };

        const pid = String(row.variant?.productId ?? row.productId);

        await tx.supplierVariantOffer.delete({ where: { id: parsedId.rawId } });
        await recomputeProductStockTx(tx, pid);

        return { ok: true, deleted: `variant:${parsedId.rawId}`, productId: pid };
      }

      // BASE
      const base = await tx.supplierProductOffer.findUnique({
        where: { id: parsedId.rawId },
        select: { id: true, productId: true },
      });
      if (!base) return { ok: false, status: 404, msg: "Base offer not found" };

      const variantsCount = await tx.supplierVariantOffer.count({
        where: { supplierProductOfferId: base.id },
      });

      if (variantsCount > 0) {
        return {
          ok: false,
          status: 409,
          msg: "Cannot delete base offer while variant offers exist. Delete the variant rows first.",
          variantsCount,
        };
      }

      await tx.supplierProductOffer.delete({ where: { id: base.id } });
      await recomputeProductStockTx(tx, String(base.productId));

      return { ok: true, deleted: `base:${base.id}`, productId: String(base.productId) };
    });

    if (!result.ok) {
      return res.status((result as any).status).json({
        error: (result as any).msg,
        ...(typeof (result as any).variantsCount === "number" ? { variantsCount: (result as any).variantsCount } : {}),
      });
    }

    return res.json({ ok: true, deleted: (result as any).deleted, productId: (result as any).productId });
  })
);

/**
 * ✅ Bulk delete all offers for a product (with safety)
 * DELETE /api/admin/products/:productId/supplier-offers
 */
router.delete(
  "/products/:productId/supplier-offers",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    await assertProductOffersDeletable(productId);

    const deleted = await prisma.$transaction(async (tx: any) => {
      const delVar = await tx.supplierVariantOffer.deleteMany({
        where: { variant: { productId } } as any,
      });

      const delBase = await tx.supplierProductOffer.deleteMany({
        where: { productId },
      });

      await recomputeProductStockTx(tx, productId);
      return { variantDeleted: delVar.count, baseDeleted: delBase.count };
    });

    return res.json({ ok: true, productId, ...deleted });
  })
);

/**
 * ✅ Repair corrupted supplierVariantOffer rows for a product
 * POST /api/admin/products/:productId/supplier-offers/repair
 */
router.post(
  "/products/:productId/supplier-offers/repair",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, retailPrice: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const result = await prisma.$transaction(async (tx: any) => {
      const variantOffers = await tx.supplierVariantOffer.findMany({
        where: { variant: { productId } } as any,
        select: {
          id: true,
          supplierId: true,
          productId: true,
          variantId: true,
          supplierProductOfferId: true,
        },
      });

      let fixedProductId = 0;
      let fixedBaseLink = 0;

      for (const vo of variantOffers as any[]) {
        // 1) Fix productId
        if (String(vo.productId) !== productId) {
          await tx.supplierVariantOffer.update({
            where: { id: String(vo.id) },
            data: { productId },
          });
          fixedProductId += 1;
        }

        // 2) Fix supplierProductOfferId to base offer for (supplierId, productId)
        const base = await tx.supplierProductOffer.upsert({
          where: { supplierId_productId: { supplierId: String(vo.supplierId), productId } },
          create: {
            supplierId: String(vo.supplierId),
            productId,
            basePrice: toDecimal(product.retailPrice != null ? Number(product.retailPrice) : 0),
            currency: "NGN",
            availableQty: 0,
            leadDays: null,
            isActive: true,
            inStock: true,
          },
          update: {},
          select: { id: true },
        });

        if (String(vo.supplierProductOfferId) !== String(base.id)) {
          await tx.supplierVariantOffer.update({
            where: { id: String(vo.id) },
            data: { supplierProductOfferId: String(base.id) },
          });
          fixedBaseLink += 1;
        }
      }
      await recomputeProductStockTx(tx, productId);

      return { scanned: variantOffers.length, fixedProductId, fixedBaseLink };
    });

    return res.json({ ok: true, productId, ...result });
  })
);

export default router;
