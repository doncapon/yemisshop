// api/src/routes/adminSupplierOffers.ts
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

/**
 * ✅ IMPORTANT (your current schema):
 * - SupplierProductOffer has NO supplierId and NO supplier relation
 * - SupplierVariantOffer has NO supplierId and NO supplier relation
 * - Supplier is on Product (product.supplierId + product.supplier)
 *
 * So we ACCEPT supplierId in requests for compatibility, but we NEVER store it on offers.
 * We validate it matches product.supplierId if provided.
 */
async function assertSupplierMatchesProduct(productId: string, supplierIdMaybe?: string | null) {
  if (!supplierIdMaybe) return;

  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, supplierId: true },
  });
  if (!p) {
    const err: any = new Error("Product not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(p.supplierId) !== String(supplierIdMaybe)) {
    const err: any = new Error("supplierId does not match this product's supplierId");
    err.statusCode = 409;
    throw err;
  }
}

/* ----------------------------------------------------------------------------
 * Schemas
 * --------------------------------------------------------------------------*/

/**
 * PATCH BASE
 * (supplierId exists in payload for legacy compatibility, but not stored)
 */
const patchBaseSchema = z.object({
  supplierId: z.string().min(1).optional(), // validated against Product.supplierId (not stored)

  price: coerceNumber(0).optional(), // maps to basePrice
  currency: z.string().min(1).optional(),
  availableQty: coerceInt(0).optional(),
  leadDays: coerceInt(0).nullable().optional(),
  isActive: coerceBool.optional(),

  // optional conversion request (BASE -> VARIANT) if caller sends variantId
  variantId: z
    .preprocess((v) => {
      if (v === "" || v == null) return undefined;
      return String(v);
    }, z.string().min(1))
    .optional(),
});

/**
 * PATCH VARIANT
 * (supplierId exists in payload for legacy compatibility, but not stored)
 */
const patchVariantSchema = z.object({
  supplierId: z.string().min(1).optional(), // validated (not stored)

  variantId: z
    .preprocess((v) => {
      if (v === "" || v == null) return undefined;
      return String(v);
    }, z.string().min(1))
    .optional(),

  // allow explicit convert to BASE if caller sends variantId:null
  // (handled by reading raw body in handler)
  unitPrice: coerceNumber(0).optional(), // maps to unitPrice (legacy name)
  price: coerceNumber(0).optional(), // preferred name
  currency: z.string().min(1).optional(),
  availableQty: coerceInt(0).optional(),
  leadDays: coerceInt(0).nullable().optional(),
  isActive: coerceBool.optional(),
});

/**
 * CREATE (✅ one price field only: `price`)
 * - kind optional
 * - supplierId accepted but not stored; must match product.supplierId
 */
const createSchema = z
  .object({
    kind: z.enum(["BASE", "VARIANT"]).optional(),

    supplierId: z.string().min(1).optional(),

    variantId: z
      .preprocess((v) => {
        if (v === "" || v == null) return null;
        return String(v);
      }, z.string().min(1).nullable())
      .optional(),

    price: coerceNumber(0), // ✅ single price field
    currency: z.string().min(1).default("NGN"),
    availableQty: coerceInt(0, 0).optional(),
    leadDays: coerceInt(0, 0).nullable().optional(),
    isActive: coerceBool.default(true),
  })
  .superRefine((val, ctx) => {
    const inferredKind: "BASE" | "VARIANT" = val.kind ?? (val.variantId ? "VARIANT" : "BASE");

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
 * Unified DTO (derived supplier from Product)
 * --------------------------------------------------------------------------*/
function toDtoBase(base: any, supplierMeta?: { supplierId: string; supplierName?: string | null }) {
  const basePriceNum = base.basePrice != null ? Number(base.basePrice) : 0;

  return {
    id: `base:${base.id}`,
    kind: "BASE" as const,

    productId: String(base.productId),

    supplierId: supplierMeta?.supplierId ? String(supplierMeta.supplierId) : "",
    supplierName: supplierMeta?.supplierName ?? undefined,

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

function toDtoVariant(v: any, supplierMeta?: { supplierId: string; supplierName?: string | null }) {
  const unitPriceNum = v.unitPrice != null ? Number(v.unitPrice) : 0;

  return {
    id: `variant:${v.id}`,
    kind: "VARIANT" as const,

    productId: String(v.productId),

    supplierId: supplierMeta?.supplierId ? String(supplierMeta.supplierId) : "",
    supplierName: supplierMeta?.supplierName ?? undefined,

    variantId: String(v.variantId),
    variantSku: v.variant?.sku ?? undefined,

    basePrice: undefined as undefined,
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
 *
 * ✅ Since offers have no supplier relation, we load supplier via Product.
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

  const products = await prisma.product.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: {
      id: true,
      supplierId: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  const supplierByProductId = new Map<string, { supplierId: string; supplierName?: string | null }>();
  for (const p of products) {
    supplierByProductId.set(String(p.id), {
      supplierId: String(p.supplierId),
      supplierName: p.supplier?.name ?? null,
    });
  }

  const [baseOffers, variantOffers] = await Promise.all([
    prisma.supplierProductOffer.findMany({
      where: { productId: { in: ids } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        productId: true,
        basePrice: true,
        currency: true,
        availableQty: true,
        leadDays: true,
        isActive: true,
        inStock: true,
      },
    }),

    prisma.supplierVariantOffer.findMany({
      where: { productId: { in: ids } },
      orderBy: { createdAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, productId: true } },
      },
    }),
  ]);

  const out: any[] = [];
  for (const b of baseOffers as any[]) out.push(toDtoBase(b, supplierByProductId.get(String(b.productId))));
  for (const v of variantOffers as any[]) out.push(toDtoVariant(v, supplierByProductId.get(String(v.productId))));

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
      select: { id: true, supplierId: true, supplier: { select: { name: true } } },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const supplierMeta = { supplierId: String(product.supplierId), supplierName: product.supplier?.name ?? null };

    const [baseOffers, variantOffers] = await Promise.all([
      prisma.supplierProductOffer.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          productId: true,
          basePrice: true,
          currency: true,
          availableQty: true,
          leadDays: true,
          isActive: true,
          inStock: true,
        },
      }),

      prisma.supplierVariantOffer.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        include: {
          variant: { select: { id: true, sku: true, productId: true } },
        },
      }),
    ]);

    const out: any[] = [];
    for (const b of baseOffers as any[]) out.push(toDtoBase(b, supplierMeta));
    for (const v of variantOffers as any[]) out.push(toDtoVariant(v, supplierMeta));

    return res.json({ data: out });
  })
);

/**
 * POST /api/admin/products/:productId/supplier-offers
 *
 * ✅ BASE:   { supplierId?(must match product), variantId:null, price, ... } => SupplierProductOffer.basePrice
 * ✅ VARIANT:{ supplierId?(must match product), variantId, price, ... }      => SupplierVariantOffer.unitPrice
 *
 * ❗ IMPORTANT POLICY:
 * - Variant offers NEVER create base offers automatically.
 */
router.post(
  "/products/:productId/supplier-offers",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);
    const parsed = createSchema.parse(req.body ?? {});

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, supplierId: true, supplier: { select: { name: true } } },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const supplierId = String(product.supplierId ?? "");
    if (!supplierId) {
      return res
        .status(409)
        .json({ error: "This product has no supplierId configured." });
    }

    // accept supplierId but validate it matches product
    await assertSupplierMatchesProduct(productId, parsed.supplierId ?? null);

    const variantId = parsed.variantId ?? null;
    const kind: "BASE" | "VARIANT" = parsed.kind ?? (variantId ? "VARIANT" : "BASE");

    const qty = Math.max(0, parsed.availableQty ?? 0);
    const isActive = parsed.isActive ?? true;
    const inStock = !!isActive && qty > 0;

    const price = Number(parsed.price ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "price must be greater than 0" });
    }

    const supplierMeta = {
      supplierId,
      supplierName: product.supplier?.name ?? null,
    };

    // ---------------- BASE ----------------
    if (kind === "BASE" || !variantId) {
      const data = {
        productId,
        supplierId, // ✅ REQUIRED now
        basePrice: toDecimal(price),
        currency: parsed.currency ?? "NGN",
        availableQty: qty,
        leadDays: parsed.leadDays == null ? null : parsed.leadDays,
        isActive,
        inStock,
      };

      // 🔧 productId is NOT unique anymore → but there should be at most one per product+supplier
      const existing = await prisma.supplierProductOffer.findFirst({
        where: { productId, supplierId },
        select: { id: true },
      });

      let upserted;
      if (existing) {
        upserted = await prisma.supplierProductOffer.update({
          where: { id: existing.id },
          data,
        });
      } else {
        upserted = await prisma.supplierProductOffer.create({
          data,
        });
      }

      await recomputeProductStockTx(prisma as any, productId);
      return res.status(201).json({ data: toDtoBase(upserted, supplierMeta) });
    }

    // ---------------- VARIANT ----------------
    // VARIANT must belong to this product
    const variant = await prisma.productVariant.findUnique({
      where: { id: String(variantId) },
      select: { id: true, productId: true },
    });
    if (!variant || String(variant.productId) !== productId) {
      return res
        .status(400)
        .json({ error: "variantId does not belong to this product" });
    }

    // Link to base if exists; DO NOT create base automatically
    const base = await prisma.supplierProductOffer.findFirst({
      where: { productId, supplierId },
      select: { id: true, currency: true },
    });

    const created = await prisma.supplierVariantOffer.upsert({
      where: { variantId: String(variantId) }, // ✅ unique in your schema
      create: {
        productId,
        variantId: String(variantId),
        supplierProductOfferId: base?.id ?? null,
        supplierId, // ✅ keep variant offer tied to same supplier
        unitPrice: toDecimal(price),
        currency: parsed.currency ?? base?.currency ?? "NGN",
        availableQty: qty,
        leadDays: parsed.leadDays == null ? null : parsed.leadDays,
        isActive,
        inStock,
      },
      update: {
        productId,
        supplierProductOfferId: base?.id ?? null,
        supplierId, // ✅ keep in sync on update too
        unitPrice: toDecimal(price),
        currency: parsed.currency ?? base?.currency ?? "NGN",
        availableQty: qty,
        leadDays: parsed.leadDays == null ? null : parsed.leadDays,
        isActive,
        inStock,
      },
      include: {
        variant: { select: { id: true, sku: true, productId: true } },
      },
    });

    await recomputeProductStockTx(prisma as any, productId);
    return res.status(201).json({ data: toDtoVariant(created, supplierMeta) });
  }),
);
/**
 * PATCH /api/admin/supplier-offers/:id
 * id: base:<id> | variant:<id>
 *
 * ✅ TRUE PATCH: updates existing record (NO delete) unless doing explicit convert.
 * ✅ supplierId is accepted for compatibility but validated against Product.supplierId (never stored on offers).
 *
 * Conversion support (optional, matches your pasted file behavior):
 * - BASE + variantId => convert BASE -> VARIANT (delete base, create variant) (only if not used in orders)
 * - VARIANT + variantId:null => convert VARIANT -> BASE (delete variant, upsert base) (only if not used in orders)
 */
router.patch(
  "/supplier-offers/:id",
  wrap(async (req, res, next) => {
    try {
      const parsedId = parsePrefixedId(requiredString(req.params.id || "").trim());

      if (parsedId.kind === "LEGACY") {
        return res.status(400).json({
          error:
            "Legacy offer id received. Use base:<id> or variant:<id> with the new 2-table system.",
        });
      }

      // helper: is this specific offer row referenced in any order item?
      async function assertOfferRowNotUsedInOrdersOrThrow(
        kind: "BASE" | "VARIANT",
        rawId: string,
      ) {
        const hit = await prisma.orderItem.findFirst({
          where:
            kind === "BASE"
              ? ({ chosenSupplierProductOfferId: rawId } as any)
              : ({ chosenSupplierVariantOfferId: rawId } as any),
          select: { id: true },
        });

        if (hit) {
          const err: any = new Error(
            "Cannot convert/delete this offer because it has been used in orders. You can still PATCH price/qty/isActive on the same row.",
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
          select: {
            id: true,
            productId: true,
            basePrice: true,
            currency: true,
            availableQty: true,
            leadDays: true,
            isActive: true,
            inStock: true,
            supplierId: true,
          },
        });
        if (!existing) return res.status(404).json({ error: "Base offer not found" });

        const productId = String(existing.productId);

        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: { id: true, supplierId: true, supplier: { select: { name: true } } },
        });
        if (!product) return res.status(404).json({ error: "Product not found" });

        await assertSupplierMatchesProduct(productId, patch.supplierId ?? null);

        const supplierMeta = {
          supplierId: String(product.supplierId),
          supplierName: product.supplier?.name ?? null,
        };

        // OPTIONAL convert BASE -> VARIANT if variantId provided
        const wantsConvertToVariant = !!patch.variantId;
        if (wantsConvertToVariant) {
          await assertOfferRowNotUsedInOrdersOrThrow("BASE", existing.id);

          const targetVariantId = String(patch.variantId).trim();

          const variant = await prisma.productVariant.findUnique({
            where: { id: targetVariantId },
            select: { id: true, productId: true },
          });
          if (!variant || String(variant.productId) !== productId) {
            return res
              .status(400)
              .json({ error: "variantId does not belong to this product" });
          }

          const supplierId = String(product.supplierId);

          // create/replace VARIANT by unique variantId
          const nextPrice =
            patch.price !== undefined
              ? Number(patch.price)
              : existing.basePrice != null
                ? Number(existing.basePrice)
                : 0;

          if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
            return res.status(400).json({ error: "price must be greater than 0" });
          }

          const nextQty =
            patch.availableQty !== undefined
              ? Number(patch.availableQty)
              : Number(existing.availableQty ?? 0);

          const nextIsActive =
            patch.isActive !== undefined ? !!patch.isActive : !!existing.isActive;
          const nextInStock = !!nextIsActive && nextQty > 0;

          const nextCurrency = patch.currency ?? existing.currency ?? "NGN";
          const nextLeadDays =
            patch.leadDays !== undefined
              ? patch.leadDays == null
                ? null
                : patch.leadDays
              : existing.leadDays ?? null;

          const moved = await prisma.$transaction(async (tx) => {
            const created = await tx.supplierVariantOffer.upsert({
              where: { variantId: targetVariantId },
              create: {
                productId,
                variantId: targetVariantId,
                supplierProductOfferId: null,
                supplierId, // ✅ set supplier on variant offer
                unitPrice: toDecimal(nextPrice),
                currency: nextCurrency,
                availableQty: nextQty,
                leadDays: nextLeadDays,
                isActive: nextIsActive,
                inStock: nextInStock,
              },
              update: {
                productId,
                supplierProductOfferId: null,
                supplierId, // ✅ keep supplier in sync
                unitPrice: toDecimal(nextPrice),
                currency: nextCurrency,
                availableQty: nextQty,
                leadDays: nextLeadDays,
                isActive: nextIsActive,
                inStock: nextInStock,
              },
              include: { variant: { select: { id: true, sku: true, productId: true } } },
            });

            await tx.supplierProductOffer.delete({ where: { id: existing.id } });
            return created;
          });

          await recomputeProductStockTx(prisma as any, productId);

          return res.json({
            ok: true,
            converted: true,
            from: `base:${existing.id}`,
            to: `variant:${moved.id}`,
            data: toDtoVariant(moved, supplierMeta),
          });
        }

        // TRUE PATCH update only
        const data: any = {};
        if (patch.currency) data.currency = patch.currency;

        if (patch.price !== undefined) {
          const p = Number(patch.price);
          if (!Number.isFinite(p) || p <= 0) {
            return res.status(400).json({ error: "price must be greater than 0" });
          }
          data.basePrice = toDecimal(p);
        }

        if (patch.availableQty !== undefined) {
          data.availableQty = Math.max(0, Math.trunc(Number(patch.availableQty)));
        }
        if (patch.leadDays !== undefined) {
          data.leadDays = patch.leadDays == null ? null : patch.leadDays;
        }
        if (patch.isActive !== undefined) data.isActive = !!patch.isActive;

        const nextQty =
          data.availableQty !== undefined
            ? Number(data.availableQty)
            : Number(existing.availableQty ?? 0);
        const nextActive =
          data.isActive !== undefined ? !!data.isActive : !!existing.isActive;
        data.inStock = !!nextActive && nextQty > 0;

        const updated = await prisma.supplierProductOffer.update({
          where: { id: existing.id },
          data,
          select: {
            id: true,
            productId: true,
            basePrice: true,
            currency: true,
            availableQty: true,
            leadDays: true,
            isActive: true,
            inStock: true,
          },
        });

        await recomputeProductStockTx(prisma as any, productId);

        return res.json({
          ok: true,
          patched: true,
          id: `base:${updated.id}`,
          data: toDtoBase(updated, supplierMeta),
        });
      }

      // ---------------------------- VARIANT PATCH -----------------------------
      const patch = patchVariantSchema.parse(req.body ?? {});
      const existing = await prisma.supplierVariantOffer.findUnique({
        where: { id: parsedId.rawId },
        include: { variant: { select: { id: true, sku: true, productId: true } } },
      });
      if (!existing) return res.status(404).json({ error: "Variant offer not found" });

      const productId = String(existing.productId);

      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, supplierId: true, supplier: { select: { name: true } } },
      });
      if (!product) return res.status(404).json({ error: "Product not found" });

      await assertSupplierMatchesProduct(productId, patch.supplierId ?? null);

      const supplierMeta = {
        supplierId: String(product.supplierId),
        supplierName: product.supplier?.name ?? null,
      };
      const supplierId = String(product.supplierId);

      // convert VARIANT -> BASE if caller explicitly sends variantId: null
      const rawVariantId = (req.body as any)?.variantId;
      const wantsConvertToBase = rawVariantId === null;

      if (wantsConvertToBase) {
        await assertOfferRowNotUsedInOrdersOrThrow("VARIANT", existing.id);

        const nextPriceRaw =
          patch.price !== undefined
            ? patch.price
            : patch.unitPrice !== undefined
              ? patch.unitPrice
              : existing.unitPrice != null
                ? Number(existing.unitPrice)
                : 0;

        const nextPrice = Number(nextPriceRaw);
        if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
          return res.status(400).json({ error: "price must be greater than 0" });
        }

        const nextQty =
          patch.availableQty !== undefined
            ? Number(patch.availableQty)
            : Number(existing.availableQty ?? 0);

        const nextIsActive =
          patch.isActive !== undefined ? !!patch.isActive : !!existing.isActive;
        const nextInStock = !!nextIsActive && nextQty > 0;

        const nextCurrency = patch.currency ?? existing.currency ?? "NGN";
        const nextLeadDays =
          patch.leadDays !== undefined
            ? patch.leadDays == null
              ? null
              : patch.leadDays
            : existing.leadDays ?? null;

        const moved = await prisma.$transaction(async (tx) => {
          // 🔧 productId is NOT unique anymore → manual upsert, but supplierId is required
          const existingBase = await tx.supplierProductOffer.findFirst({
            where: { productId, supplierId },
            select: { id: true },
          });

          const baseData = {
            productId,
            supplierId, // ✅ REQUIRED on SupplierProductOffer
            basePrice: toDecimal(nextPrice),
            currency: nextCurrency,
            availableQty: nextQty,
            leadDays: nextLeadDays,
            isActive: nextIsActive,
            inStock: nextInStock,
          };

          let createdBase;
          if (existingBase) {
            createdBase = await tx.supplierProductOffer.update({
              where: { id: existingBase.id },
              data: baseData,
              select: {
                id: true,
                productId: true,
                basePrice: true,
                currency: true,
                availableQty: true,
                leadDays: true,
                isActive: true,
                inStock: true,
              },
            });
          } else {
            createdBase = await tx.supplierProductOffer.create({
              data: baseData,
              select: {
                id: true,
                productId: true,
                basePrice: true,
                currency: true,
                availableQty: true,
                leadDays: true,
                isActive: true,
                inStock: true,
              },
            });
          }

          await tx.supplierVariantOffer.delete({ where: { id: existing.id } });
          return createdBase;
        });

        await recomputeProductStockTx(prisma as any, productId);

        return res.json({
          ok: true,
          converted: true,
          from: `variant:${existing.id}`,
          to: `base:${moved.id}`,
          data: toDtoBase(moved, supplierMeta),
        });
      }

      // TRUE PATCH update only
      const data: any = {};

      if (patch.currency) data.currency = patch.currency;

      const incomingPrice =
        patch.price !== undefined
          ? patch.price
          : patch.unitPrice !== undefined
            ? patch.unitPrice
            : undefined;

      if (incomingPrice !== undefined) {
        const p = Number(incomingPrice);
        if (!Number.isFinite(p) || p <= 0) {
          return res.status(400).json({ error: "price must be greater than 0" });
        }
        data.unitPrice = toDecimal(p);
      }

      if (patch.availableQty !== undefined) {
        data.availableQty = Math.max(0, Math.trunc(Number(patch.availableQty)));
      }
      if (patch.leadDays !== undefined) {
        data.leadDays = patch.leadDays == null ? null : patch.leadDays;
      }
      if (patch.isActive !== undefined) data.isActive = !!patch.isActive;

      // allow changing variantId (must belong to same product)
      if (patch.variantId) {
        const variant = await prisma.productVariant.findUnique({
          where: { id: String(patch.variantId) },
          select: { id: true, productId: true },
        });
        if (!variant || String(variant.productId) !== productId) {
          return res
            .status(400)
            .json({ error: "variantId does not belong to this product" });
        }
        data.variantId = String(patch.variantId);
      }

      // keep link independent unless base exists (use same supplierId)
      const base = await prisma.supplierProductOffer.findFirst({
        where: { productId, supplierId },
        select: { id: true },
      });
      data.supplierProductOfferId = base?.id ?? null;
      data.productId = productId;
      data.supplierId = supplierId; // ✅ keep variant's supplier in sync

      const nextQty =
        data.availableQty !== undefined
          ? Number(data.availableQty)
          : Number(existing.availableQty ?? 0);
      const nextActive =
        data.isActive !== undefined ? !!data.isActive : !!existing.isActive;
      data.inStock = !!nextActive && nextQty > 0;

      let updated: any;
      try {
        updated = await prisma.supplierVariantOffer.update({
          where: { id: existing.id },
          data,
          include: { variant: { select: { id: true, sku: true, productId: true } } },
        });
      } catch (e: any) {
        if (e?.code === "P2002") {
          return res
            .status(409)
            .json({ error: "Duplicate variant offer for this variantId." });
        }
        throw e;
      }

      await recomputeProductStockTx(prisma as any, productId);

      return res.json({
        ok: true,
        patched: true,
        id: `variant:${updated.id}`,
        data: toDtoVariant(updated, supplierMeta),
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid payload", details: err.issues });
      }
      if (err?.statusCode)
        return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  }),
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
          return {
            ok: true,
            deleted: `variant:${parsedId.rawId}`,
            productId: String(req.query?.productId || ""),
            alreadyMissing: true,
          };
        }

        const pid = String(row.variant?.productId ?? row.productId);

        await assertProductOffersDeletable(pid);

        await tx.supplierVariantOffer.delete({ where: { id: parsedId.rawId } });

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
        const pid = String(req.query?.productId || "");
        if (pid) await recomputeProductStockTx(tx, pid);
        return {
          ok: true,
          deleted: `base:${parsedId.rawId}`,
          productId: pid || null,
          alreadyMissing: true,
        };
      }

      const pid = String(base.productId);

      await assertProductOffersDeletable(pid);

      // detach any linked variant offers (nullable in your schema)
      await tx.supplierVariantOffer.updateMany({
        where: { supplierProductOfferId: base.id },
        data: { supplierProductOfferId: null },
      });

      await tx.supplierProductOffer.delete({ where: { id: base.id } });

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
        where: { productId },
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
 *  - ensures supplierProductOfferId links are consistent
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
        where: { productId },
        select: {
          id: true,
          supplierProductOfferId: true,
        },
      });

      const base = await tx.supplierProductOffer.findFirst({
        where: { productId },
        select: { id: true },
      });

      let fixedBaseLink = 0;

      for (const vo of variantOffers as any[]) {
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