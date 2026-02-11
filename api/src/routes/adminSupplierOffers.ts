import express from "express";
import { Prisma } from "@prisma/client";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";

import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";
import { requiredString } from "../lib/http.js";

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


const patchBaseSchema = z.object({
  // ✅ allow moving BASE offer to another supplier (replace semantics)
  supplierId: z.string().min(1).optional(),

  // BASE price fields
  price: coerceNumber(0).optional(), // maps to basePrice
  currency: z.string().min(1).optional(),
  availableQty: coerceInt(0).optional(),
  leadDays: coerceInt(0).nullable().optional(),
  isActive: coerceBool.optional(),
});

const patchVariantSchema = z.object({
  // ✅ allow moving VARIANT offer to another supplier and/or another variant (replace semantics)
  supplierId: z.string().min(1).optional(),

  // ✅ variantId can be changed on PATCH => triggers delete+create
  variantId: z
    .preprocess((v) => {
      if (v === "" || v == null) return undefined;
      return String(v);
    }, z.string().min(1))
    .optional(),

  // VARIANT price fields
  unitPrice: coerceNumber(0).optional(), // maps to unitPrice
  currency: z.string().min(1).optional(),
  availableQty: coerceInt(0).optional(),
  leadDays: coerceInt(0).nullable().optional(),
  isActive: coerceBool.optional(),
});


/* ----------------------------------------------------------------------------
 * Schemas (✅ one price field only: `price`)
 * --------------------------------------------------------------------------*/

/**
 * ✅ MERGE FIX:
 * - `kind` is now OPTIONAL because your frontend no longer sends it.
 * - We infer kind from variantId:
 *    - variantId null => BASE
 *    - variantId string => VARIANT
 */
const createSchema = z
  .object({
    kind: z.enum(["BASE", "VARIANT"]).optional(),

    supplierId: z.string().min(1),

    // ✅ variantId only allowed for VARIANT; and "" becomes null safely
    variantId: z
      .preprocess((v) => {
        if (v === "" || v == null) return null;
        return String(v);
      }, z.string().min(1).nullable())
      .optional(),

    unitPrice: coerceNumber(0),

    currency: z.string().min(1).default("NGN"),
    availableQty: coerceInt(0, 0).optional(),
    leadDays: coerceInt(0, 0).nullable().optional(),
    isActive: coerceBool.default(true),
  })
  .superRefine((val, ctx) => {
    // infer kind if not provided
    const inferredKind: "BASE" | "VARIANT" =
      val.kind ?? (val.variantId ? "VARIANT" : "BASE");

    // enforce consistency
    if (inferredKind === "BASE") {
      if (val.variantId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variantId"],
          message: "variantId must be null/omitted for BASE offer",
        });
      }
    }

    if (inferredKind === "VARIANT") {
      if (!val.variantId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variantId"],
          message: "variantId is required for VARIANT offer",
        });
      }
    }
  });

/* ----------------------------------------------------------------------------
 * Unified DTO (✅ no bump fields)
 * --------------------------------------------------------------------------*/
function toDtoBase(base: any) {
  const basePriceNum = base.basePrice != null ? Number(base.basePrice) : 0;

  return {
    id: `base:${base.id}`,
    kind: "BASE" as const,

    productId: String(base.productId),

    supplierId: String(base.supplierId),
    supplierName: base.supplier?.name,

    variantId: null as null,
    variantSku: undefined as undefined,

    basePrice: basePriceNum,
    unitPrice: undefined as undefined,

    currency: base.currency ?? "NGN",
    availableQty: base.availableQty ?? 0,
    leadDays: base.leadDays ?? undefined,
    isActive: !!base.isActive,
    inStock: !!base.inStock,
  };
}

function toDtoVariant(v: any, overrideProductId?: string) {
  const trueProductId =
    overrideProductId ?? (v?.variant?.productId ? String(v.variant.productId) : String(v.productId));

  const unitPriceNum = v.unitPrice != null ? Number(v.unitPrice) : 0;

  return {
    id: `variant:${v.id}`,
    kind: "VARIANT" as const,

    productId: trueProductId,

    supplierId: String(v.supplierId),
    supplierName: v.supplier?.name,

    variantId: String(v.variantId),
    variantSku: v.variant?.sku ?? undefined,

    basePrice: undefined as undefined, // not needed for VARIANT row
    unitPrice: unitPriceNum,

    currency: v.currency ?? "NGN",
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
 */
const bulkOffersHandler = wrap(async (req, res) => {
  const productIdsRaw = String(req.query.productIds ?? "").trim();
  const productIdSingle = String(req.query.productId ?? "").trim();

  const ids = productIdsRaw
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
      // ✅ filter by variant.productId, not supplierVariantOffer.productId
      where: { variant: { productId: { in: ids } } } as any,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true, productId: true } },
      },
    }),
  ]);

  const out: any[] = [];
  for (const b of baseOffers as any[]) out.push(toDtoBase(b));
  for (const v of variantOffers as any[]) {
    const pid = v?.variant?.productId ? String(v.variant.productId) : String(v.productId);
    out.push(toDtoVariant(v, pid));
  }

  return res.json({ data: out });
});

/**
 * GET /api/admin/supplier-offers?productIds=a,b,c
 */
router.get("/supplier-offers", bulkOffersHandler);

/**
 * Compatibility if mounted at /api/admin/supplier-offers
 * GET /api/admin/supplier-offers?productIds=a,b,c
 */
router.get("/", bulkOffersHandler);

/**
 * GET /api/admin/products/:productId/supplier-offers
 */
router.get(
  "/products/:productId/supplier-offers",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const [baseOffers, variantOffers] = await Promise.all([
      prisma.supplierProductOffer.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        include: { supplier: { select: { id: true, name: true } } },
      }),

      prisma.supplierVariantOffer.findMany({
        where: { variant: { productId } } as any,
        orderBy: { createdAt: "desc" },
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, productId: true } },
        },
      }),
    ]);

    const out: any[] = [];
    for (const b of baseOffers as any[]) out.push(toDtoBase(b));
    for (const v of variantOffers as any[]) out.push(toDtoVariant(v, productId));

    return res.json({ data: out });
  })
);

/**
 * POST /api/admin/products/:productId/supplier-offers
 *
 * ✅ BASE:   { supplierId, variantId:null, price, ... } => basePrice
 * ✅ VARIANT:{ supplierId, variantId, price, ... }      => unitPrice
 *
 * ❗ IMPORTANT POLICY:
 * - Base offers are ONLY created when variantId is null.
 * - Variant offers NEVER create base offers automatically.
 *
 * ✅ MERGE FIXES:
 * - No next() call (prevents ERR_HTTP_HEADERS_SENT)
 * - kind inferred from variantId (frontend no longer sends kind)
 */
router.post(
  "/products/:productId/supplier-offers",
  wrap(async (req, res, _next) => {
    const productId = String(req.params.productId);

    const parsed = createSchema.parse(req.body ?? {});

    const supplierId = parsed.supplierId;
    const variantId = parsed.variantId ?? null;

    // infer kind if not provided
    const kind: "BASE" | "VARIANT" = parsed.kind ?? (variantId ? "VARIANT" : "BASE");

    const [product, supplier] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
      prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }),
    ]);
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });

    const qty = Math.max(0, parsed.availableQty ?? 0);
    const isActive = parsed.isActive ?? true;
    const inStock = !!isActive && qty > 0;

    const price = Number(parsed.unitPrice ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "price must be greater than 0" });
    }

    // ---------------- BASE ----------------
    if (kind === "BASE" || !variantId) {
      // BASE upsert logic (yours, unchanged in behavior)
      const upserted = await prisma.supplierProductOffer.upsert({
        where: { supplierId_productId: { supplierId, productId } },
        create: {
          supplierId,
          productId,
          basePrice: toDecimal(price),
          currency: parsed.currency ?? "NGN",
          availableQty: qty,
          leadDays: parsed.leadDays == null ? null : parsed.leadDays,
          isActive,
          inStock,
        },
        update: {
          basePrice: toDecimal(price),
          currency: parsed.currency ?? "NGN",
          availableQty: qty,
          leadDays: parsed.leadDays == null ? null : parsed.leadDays,
          isActive,
          inStock,
        },
        include: { supplier: { select: { id: true, name: true } } },
      });

      await recomputeProductStockTx(prisma as any, productId);
      return res.status(201).json({ data: toDtoBase(upserted) });
    }

    // ---------------- VARIANT ----------------
    // VARIANT must belong to this product
    const variant = await prisma.productVariant.findUnique({
      where: { id: String(variantId) },
      select: { id: true, productId: true },
    });
    if (!variant || String(variant.productId) !== productId) {
      return res.status(400).json({ error: "variantId does not belong to this product" });
    }

    // ✅ Link to base if it exists; DO NOT create one
    const base = await prisma.supplierProductOffer.findUnique({
      where: { supplierId_productId: { supplierId, productId } },
      select: { id: true, currency: true },
    });

    const created = await prisma.supplierVariantOffer.upsert({
      where: { supplierId_variantId: { supplierId, variantId: String(variantId) } },
      create: {
        supplierId,
        productId,
        variantId: String(variantId),

        // ✅ link if exists, else null (no auto base row)
        supplierProductOfferId: base?.id ?? null,

        unitPrice: toDecimal(price),
        currency: parsed.currency ?? base?.currency ?? "NGN",
        availableQty: qty,
        leadDays: parsed.leadDays == null ? null : parsed.leadDays,
        isActive,
        inStock,
      },
      update: {
        // ✅ keep link if exists, else null (and never create base)
        supplierProductOfferId: base?.id ?? null,

        unitPrice: toDecimal(price),
        currency: parsed.currency ?? base?.currency ?? "NGN",
        availableQty: qty,
        leadDays: parsed.leadDays == null ? null : parsed.leadDays,
        isActive,
        inStock,
        productId,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true, productId: true } },
      },
    });

    await recomputeProductStockTx(prisma as any, productId);
    return res.status(201).json({ data: toDtoVariant(created, productId) });
  })
);
/**
 * PATCH /api/admin/supplier-offers/:id
 * id: base:<id> | variant:<id>
 *
 * ✅ TRUE PATCH: updates existing record (NO delete, NO upsert)
 * ✅ Allows changing supplierId + variantId via UPDATE (still no delete)
 * ✅ Conversion BASE <-> VARIANT is ONLY allowed if NOT referenced by any order items.
 *    If referenced -> 409 (history protection).
 */
router.patch(
  "/supplier-offers/:id",
  wrap(async (req, res, next) => {
    try {
      const parsedId = parsePrefixedId(requiredString(req.params.id || "").trim());

      if (parsedId.kind === "LEGACY") {
        return res.status(400).json({
          error: "Legacy offer id received. Use base:<id> or variant:<id> with the new 2-table system.",
        });
      }

      // ✅ Hard guard: never allow this field
      if ("supplierProductOfferId" in (req.body ?? {})) {
        return res.status(400).json({
          error: "supplierProductOfferId cannot be updated via this endpoint",
        });
      }

      // helper: is this specific offer row referenced in any order item?
      async function assertOfferRowNotUsedInOrdersOrThrow(kind: "BASE" | "VARIANT", rawId: string) {
        // NOTE: adapt these field names if yours differ
        const hit = await prisma.orderItem.findFirst({
          where:
            kind === "BASE"
              ? ({ chosenSupplierProductOfferId: rawId } as any)
              : ({ chosenSupplierVariantOfferId: rawId } as any),
          select: { id: true },
        });

        if (hit) {
          const err: any = new Error(
            "Cannot convert/delete this offer because it has been used in orders. You can still PATCH price/qty/isActive on the same row."
          );
          err.statusCode = 409;
          throw err;
        }
      }

      // ------------------------------ BASE PATCH ------------------------------
      if (parsedId.kind === "BASE") {
        const patch = patchBaseSchema.parse(req.body ?? {});

        const existing = await prisma.supplierProductOffer.findUnique({
          where: { id: parsedId.rawId },
          include: { supplier: { select: { id: true, name: true } } },
        });
        if (!existing) return res.status(404).json({ error: "Base offer not found" });

        const productId = String(existing.productId);

        // ✅ optional conversion request (BASE -> VARIANT) if caller sends variantId
        // If you don't want conversion at all, remove this block entirely.
        const variantIdMaybe = (req.body as any)?.variantId;
        const wantsConvertToVariant =
          typeof variantIdMaybe === "string" && String(variantIdMaybe).trim().length > 0;

        if (wantsConvertToVariant) {
          // conversion requires delete/create → only allowed if NOT referenced by orders
          await assertOfferRowNotUsedInOrdersOrThrow("BASE", existing.id);

          const targetVariantId = String(variantIdMaybe).trim();

          // validate variant belongs to this product
          const variant = await prisma.productVariant.findUnique({
            where: { id: targetVariantId },
            select: { id: true, productId: true },
          });
          if (!variant || String(variant.productId) !== productId) {
            return res.status(400).json({ error: "variantId does not belong to this product" });
          }

          // prevent duplicate variant offer (supplierId+variantId)
          const targetSupplierId = patch.supplierId ?? String(existing.supplierId);
          const dup = await prisma.supplierVariantOffer.findFirst({
            where: { supplierId: targetSupplierId, variantId: targetVariantId },
            select: { id: true },
          });
          if (dup) return res.status(409).json({ error: "A variant offer already exists for this supplier + variant." });

          const nextPrice =
            patch.price !== undefined ? Number(patch.price) : existing.basePrice != null ? Number(existing.basePrice) : 0;

          if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
            return res.status(400).json({ error: "price must be greater than 0" });
          }

          const nextQty =
            patch.availableQty !== undefined ? Number(patch.availableQty) : Number(existing.availableQty ?? 0);

          const nextIsActive = patch.isActive !== undefined ? !!patch.isActive : !!existing.isActive;
          const nextInStock = !!nextIsActive && nextQty > 0;

          const nextCurrency = patch.currency ?? existing.currency ?? "NGN";
          const nextLeadDays =
            patch.leadDays !== undefined ? (patch.leadDays == null ? null : patch.leadDays) : existing.leadDays ?? null;

          const moved = await prisma.$transaction(async (tx) => {
            // create new VARIANT row (new id) OR keep same id if your schema allows it
            // safer default: new id. If you insist on same id, set id: existing.id but ensure no FK/hard constraints.
            const created = await tx.supplierVariantOffer.create({
              data: {
                supplierId: targetSupplierId,
                productId,
                variantId: targetVariantId,
                supplierProductOfferId: null,
                unitPrice: toDecimal(nextPrice),
                currency: nextCurrency,
                availableQty: nextQty,
                leadDays: nextLeadDays,
                isActive: nextIsActive,
                inStock: nextInStock,
              },
              include: {
                supplier: { select: { id: true, name: true } },
                variant: { select: { id: true, sku: true, productId: true } },
              },
            });

            // delete base row (allowed because we confirmed not used in orders)
            await tx.supplierProductOffer.delete({ where: { id: existing.id } });
            return created;
          });

          await recomputeProductStockTx(prisma as any, productId);

          return res.json({
            ok: true,
            converted: true,
            from: `base:${existing.id}`,
            to: `variant:${moved.id}`,
            data: toDtoVariant(moved, productId),
          });
        }

        // ✅ TRUE PATCH (update only)
        const data: any = {};

        if (patch.supplierId) data.supplierId = patch.supplierId;
        if (patch.currency) data.currency = patch.currency;

        if (patch.price !== undefined) {
          const p = Number(patch.price);
          if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: "price must be greater than 0" });
          data.basePrice = toDecimal(p);
        }

        if (patch.availableQty !== undefined) data.availableQty = Math.max(0, Math.trunc(Number(patch.availableQty)));
        if (patch.leadDays !== undefined) data.leadDays = patch.leadDays == null ? null : patch.leadDays;
        if (patch.isActive !== undefined) data.isActive = !!patch.isActive;

        // recompute inStock from final state (avoid weird combos)
        const nextQty =
          data.availableQty !== undefined ? Number(data.availableQty) : Number(existing.availableQty ?? 0);
        const nextActive = data.isActive !== undefined ? !!data.isActive : !!existing.isActive;
        data.inStock = !!nextActive && nextQty > 0;

        let updated: any;
        try {
          updated = await prisma.supplierProductOffer.update({
            where: { id: existing.id },
            data,
            include: { supplier: { select: { id: true, name: true } } },
          });
        } catch (e: any) {
          if (e?.code === "P2002") return res.status(409).json({ error: "Duplicate base offer for this supplier + product." });
          throw e;
        }

        await recomputeProductStockTx(prisma as any, productId);

        return res.json({
          ok: true,
          patched: true,
          id: `base:${updated.id}`,
          data: toDtoBase(updated),
        });
      }

      // ---------------------------- VARIANT PATCH -----------------------------
      const patch = patchVariantSchema.parse(req.body ?? {});

      const existing = await prisma.supplierVariantOffer.findUnique({
        where: { id: parsedId.rawId },
        include: {
          supplier: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, productId: true } },
        },
      });
      if (!existing) return res.status(404).json({ error: "Variant offer not found" });

      const productId = existing.variant?.productId ? String(existing.variant.productId) : String(existing.productId);

      // ✅ optional conversion request (VARIANT -> BASE) if caller sends variantId:null
      const rawVariantId = (req.body as any)?.variantId;
      const wantsConvertToBase = rawVariantId === null;

      if (wantsConvertToBase) {
        // conversion requires delete/create → only allowed if NOT referenced by orders
        await assertOfferRowNotUsedInOrdersOrThrow("VARIANT", existing.id);

        const targetSupplierId = patch.supplierId ?? String(existing.supplierId);

        // prevent duplicate base offer (supplierId+productId)
        const dup = await prisma.supplierProductOffer.findFirst({
          where: { supplierId: targetSupplierId, productId },
          select: { id: true },
        });
        if (dup) return res.status(409).json({ error: "A base offer already exists for this supplier + product." });

        const nextPrice =
          patch.unitPrice !== undefined ? Number(patch.unitPrice) : existing.unitPrice != null ? Number(existing.unitPrice) : 0;

        if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
          return res.status(400).json({ error: "price must be greater than 0" });
        }

        const nextQty =
          patch.availableQty !== undefined ? Number(patch.availableQty) : Number(existing.availableQty ?? 0);

        const nextIsActive = patch.isActive !== undefined ? !!patch.isActive : !!existing.isActive;
        const nextInStock = !!nextIsActive && nextQty > 0;

        const nextCurrency = patch.currency ?? existing.currency ?? "NGN";
        const nextLeadDays =
          patch.leadDays !== undefined ? (patch.leadDays == null ? null : patch.leadDays) : existing.leadDays ?? null;

        const moved = await prisma.$transaction(async (tx) => {
          const created = await tx.supplierProductOffer.create({
            data: {
              supplierId: targetSupplierId,
              productId,
              basePrice: toDecimal(nextPrice),
              currency: nextCurrency,
              availableQty: nextQty,
              leadDays: nextLeadDays,
              isActive: nextIsActive,
              inStock: nextInStock,
            },
            include: { supplier: { select: { id: true, name: true } } },
          });

          await tx.supplierVariantOffer.delete({ where: { id: existing.id } });
          return created;
        });

        await recomputeProductStockTx(prisma as any, productId);

        return res.json({
          ok: true,
          converted: true,
          from: `variant:${existing.id}`,
          to: `base:${moved.id}`,
          data: toDtoBase(moved),
        });
      }

      // ✅ TRUE PATCH (update only)
      const data: any = {};

      if (patch.supplierId) data.supplierId = patch.supplierId;
      if (patch.currency) data.currency = patch.currency;

      if (patch.unitPrice !== undefined) {
        const p = Number(patch.unitPrice);
        if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: "price must be greater than 0" });
        data.unitPrice = toDecimal(p);
      }

      if (patch.availableQty !== undefined) data.availableQty = Math.max(0, Math.trunc(Number(patch.availableQty)));
      if (patch.leadDays !== undefined) data.leadDays = patch.leadDays == null ? null : patch.leadDays;
      if (patch.isActive !== undefined) data.isActive = !!patch.isActive;

      // ✅ allow changing variantId via UPDATE (no delete)
      if (patch.variantId) {
        const variant = await prisma.productVariant.findUnique({
          where: { id: String(patch.variantId) },
          select: { id: true, productId: true },
        });
        if (!variant || String(variant.productId) !== productId) {
          return res.status(400).json({ error: "variantId does not belong to this product" });
        }
        data.variantId = String(patch.variantId);
      }

      // always independent
      data.supplierProductOfferId = null;
      data.productId = productId;

      // recompute inStock
      const nextQty =
        data.availableQty !== undefined ? Number(data.availableQty) : Number(existing.availableQty ?? 0);
      const nextActive = data.isActive !== undefined ? !!data.isActive : !!existing.isActive;
      data.inStock = !!nextActive && nextQty > 0;

      let updated: any;
      try {
        updated = await prisma.supplierVariantOffer.update({
          where: { id: existing.id },
          data,
          include: {
            supplier: { select: { id: true, name: true } },
            variant: { select: { id: true, sku: true, productId: true } },
          },
        });
      } catch (e: any) {
        if (e?.code === "P2002") return res.status(409).json({ error: "Duplicate variant offer for this supplier + variant." });
        throw e;
      }

      await recomputeProductStockTx(prisma as any, productId);

      return res.json({
        ok: true,
        patched: true,
        id: `variant:${updated.id}`,
        data: toDtoVariant(updated, productId),
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid payload", details: err.issues });
      }
      if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  })
);




router.delete(
  "/supplier-offers/:id",
  wrap(async (req, res) => {
    const parsedId = parsePrefixedId(requiredString(req.params.id || "").trim());

    if (parsedId.kind === "LEGACY") {
      return res.status(400).json({
        error: "Legacy offer id received. Use base:<id> or variant:<id> with the new 2-table system.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // ---------------- VARIANT ----------------
      if (parsedId.kind === "VARIANT") {
        const row = await tx.supplierVariantOffer.findUnique({
          where: { id: parsedId.rawId },
          select: {
            id: true,
            productId: true,
            variant: { select: { productId: true } },
          },
        });
        if (!row) {
          // ✅ idempotent delete
          return {
            ok: true,
            deleted: `variant:${parsedId.rawId}`,
            productId: String(req.query?.productId || ""), // optional if caller passes it
            alreadyMissing: true,
          };
        }

        const pid = String(row.variant?.productId ?? row.productId);

        // ✅ enforce policy here too
        await assertProductOffersDeletable(pid);

        await tx.supplierVariantOffer.delete({ where: { id: parsedId.rawId } });

        // ✅ verify hard-delete really happened (detects soft-delete middleware)
        const stillThere = await tx.supplierVariantOffer.findUnique({
          where: { id: parsedId.rawId },
          select: { id: true },
        });
        if (stillThere) {
          return {
            ok: false,
            status: 500,
            msg:
              "Delete did not remove the record. You likely have a Prisma soft-delete middleware or DB trigger. " +
              "Check prisma.$use() and deletedAt/isDeleted logic for supplierVariantOffer.",
          };
        }

        await recomputeProductStockTx(tx, pid);
        return { ok: true, deleted: `variant:${parsedId.rawId}`, productId: pid };
      }

      // ---------------- BASE ----------------
      const base = await tx.supplierProductOffer.findUnique({
        where: { id: parsedId.rawId },
        select: { id: true, productId: true },
      });
      if (!base) {
        // ✅ idempotent delete
        const pid = String(req.query?.productId || "");
        if (pid) {
          // still safe to recompute if caller provides productId
          await recomputeProductStockTx(tx, pid);
        }
        return {
          ok: true,
          deleted: `base:${parsedId.rawId}`,
          productId: pid || null,
          alreadyMissing: true,
        };
      }

      const pid = String(base.productId);

      // ✅ enforce policy here too
      await assertProductOffersDeletable(pid);

      // Detach any variant offers linked to this base so variants can exist without a base.
      try {
        await tx.supplierVariantOffer.updateMany({
          where: { supplierProductOfferId: base.id },
          data: { supplierProductOfferId: null },
        });
      } catch (e: any) {
        return {
          ok: false,
          status: 409,
          msg:
            "Cannot delete base offer because supplierProductOfferId on SupplierVariantOffer is not nullable. " +
            "Make it nullable (String?) and run a migration, then retry.",
        };
      }

      await tx.supplierProductOffer.delete({ where: { id: base.id } });

      // ✅ verify hard-delete really happened (detects soft-delete middleware)
      const stillThere = await tx.supplierProductOffer.findUnique({
        where: { id: base.id },
        select: { id: true },
      });
      if (stillThere) {
        return {
          ok: false,
          status: 500,
          msg:
            "Delete did not remove the record. You likely have a Prisma soft-delete middleware or DB trigger. " +
            "Check prisma.$use() and deletedAt/isDeleted logic for supplierProductOffer.",
        };
      }

      await recomputeProductStockTx(tx, pid);
      return { ok: true, deleted: `base:${base.id}`, productId: pid };
    });

    if (!result.ok) {
      return res.status((result as any).status).json({ error: (result as any).msg });
    }

    return res.json({ ok: true, deleted: (result as any).deleted, productId: (result as any).productId });
  })
);


/**
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

    const deleted = await prisma.$transaction(async (tx) => {
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
 * POST /api/admin/products/:productId/supplier-offers/repair
 *
 * ✅ Repair only:
 *  - missing supplierProductOfferId links
 * ✅ IMPORTANT: NEVER creates a base row
 */
router.post(
  "/products/:productId/supplier-offers/repair",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const result = await prisma.$transaction(async (tx) => {
      const variantOffers = await tx.supplierVariantOffer.findMany({
        where: { variant: { productId } } as any,
        select: {
          id: true,
          supplierId: true,
          supplierProductOfferId: true,
        },
      });

      let fixedBaseLink = 0;

      for (const vo of variantOffers as any[]) {
        const base = await tx.supplierProductOffer.findUnique({
          where: { supplierId_productId: { supplierId: String(vo.supplierId), productId } },
          select: { id: true },
        });

        // If base exists, ensure link matches. If base doesn't exist, detach link.
        if (base) {
          if (!vo.supplierProductOfferId || String(vo.supplierProductOfferId) !== String(base.id)) {
            await tx.supplierVariantOffer.update({
              where: { id: String(vo.id) },
              data: { supplierProductOfferId: String(base.id) },
            });
            fixedBaseLink += 1;
          }
        } else {
          if (vo.supplierProductOfferId) {
            await tx.supplierVariantOffer.update({
              where: { id: String(vo.id) },
              data: { supplierProductOfferId: null },
            });
            fixedBaseLink += 1;
          }
        }
      }

      await recomputeProductStockTx(tx, productId);
      return { scanned: variantOffers.length, fixedBaseLink };
    });

    return res.json({ ok: true, productId, ...result });
  })
);

export default router;
