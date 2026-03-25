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

function normalizeVariantOptions(raw: any): Array<{ attributeId: string; valueId: string }> {
  const arr = Array.isArray(raw) ? raw : [];

  const pickAttributeId = (o: any) =>
    String(o?.attributeId ?? o?.attribute?.id ?? o?.attributeValue?.attributeId ?? o?.value?.attributeId ?? "").trim();

  const pickValueId = (o: any) =>
    String(o?.valueId ?? o?.attributeValueId ?? o?.value?.id ?? o?.attributeValue?.id ?? "").trim();

  const m = new Map<string, string>();
  for (const o of arr) {
    const aid = pickAttributeId(o);
    const vid = pickValueId(o);
    if (!aid || !vid) continue;
    m.set(aid, vid);
  }

  return Array.from(m.entries()).map(([attributeId, valueId]) => ({ attributeId, valueId }));
}

function comboKey(options: Array<{ attributeId: string; valueId: string }>) {
  return (options || [])
    .slice()
    .sort((a, b) => {
      const ak = `${a.attributeId}:${a.valueId}`;
      const bk = `${b.attributeId}:${b.valueId}`;
      return ak.localeCompare(bk);
    })
    .map((o) => `${o.attributeId}=${o.valueId}`)
    .join("|");
}

function mergePatches(offerPatch: any, productPatch: any) {
  const out: Record<string, any> = {};

  if (productPatch && typeof productPatch === "object") {
    Object.assign(out, productPatch);
  }
  if (offerPatch && typeof offerPatch === "object") {
    Object.assign(out, offerPatch);
  }

  return out;
}

async function createOrGetVariantByCombo(
  tx: Prisma.TransactionClient,
  args: {
    productId: string;
    skuBase: string;
    desiredSku?: string | null;
    options: Array<{ attributeId: string; valueId: string }>;
    qty: number;
    inStock: boolean;
  }
) {
  const { productId, skuBase, desiredSku, options, qty, inStock } = args;
  const cleanOptions = normalizeVariantOptions(options);
  if (!cleanOptions.length) return null;

  const key = comboKey(cleanOptions);

  const existingVariants = await tx.productVariant.findMany({
    where: { productId },
    select: {
      id: true,
      options: { select: { attributeId: true, valueId: true } },
    },
  });

  for (const v of existingVariants) {
    const k = comboKey(
      (v.options || []).map((o) => ({
        attributeId: String(o.attributeId),
        valueId: String(o.valueId),
      }))
    );
    if (k === key) return v.id;
  }

  const baseSku =
    String(desiredSku ?? "").trim() ||
    `${String(skuBase || "VAR").trim().toUpperCase()}-VAR-${Date.now()}`;

  const created = await tx.productVariant.create({
    data: {
      productId,
      sku: baseSku,
      retailPrice: null,
      inStock,
      imagesJson: [],
      availableQty: qty,
      isActive: true,
      archivedAt: null,
    } as any,
    select: { id: true },
  });

  await tx.productVariantOption.createMany({
    data: cleanOptions.map((o) => ({
      variantId: created.id,
      attributeId: o.attributeId,
      valueId: o.valueId,
      unitPrice: null,
    })),
    skipDuplicates: true,
  });

  return created.id;
}

async function writeProductAttributes(
  tx: Prisma.TransactionClient,
  productId: string,
  attributeSelections?: Array<{ attributeId: string; valueId?: string; valueIds?: string[]; text?: string }>
) {
  if (!attributeSelections) return;

  await tx.productAttributeOption.deleteMany({ where: { productId } });
  await tx.productAttributeText.deleteMany({ where: { productId } });

  const optionRows: Array<{ productId: string; attributeId: string; valueId: string }> = [];

  for (const sel of attributeSelections) {
    const attributeId = String(sel?.attributeId ?? "").trim();
    if (!attributeId) continue;

    if (typeof sel?.text === "string" && sel.text.trim()) {
      await tx.productAttributeText.create({
        data: {
          productId,
          attributeId,
          value: sel.text.trim(),
        },
      });
      continue;
    }

    if (sel?.valueId) {
      optionRows.push({
        productId,
        attributeId,
        valueId: String(sel.valueId),
      });
      continue;
    }

    if (Array.isArray(sel?.valueIds)) {
      for (const valueId of sel.valueIds) {
        if (!valueId) continue;
        optionRows.push({
          productId,
          attributeId,
          valueId: String(valueId),
        });
      }
    }
  }

  if (optionRows.length) {
    await tx.productAttributeOption.createMany({
      data: optionRows,
      skipDuplicates: true,
    });
  }
}

async function refreshProductPendingStateTx(tx: Prisma.TransactionClient, productId: string) {
  const [offerPendingCount, productPendingCount] = await Promise.all([
    tx.supplierOfferChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
    tx.productChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
  ]);

  const hasPendingChanges = offerPendingCount + productPendingCount > 0;

  await tx.product.update({
    where: { id: productId },
    data: {
      hasPendingChanges,
      status: hasPendingChanges ? ("PENDING" as any) : ("LIVE" as any),
    } as any,
  });

  return { hasPendingChanges };
}

async function refreshProductPendingFlagTx(tx: Prisma.TransactionClient, productId: string) {
  const [offerPendingCount, productPendingCount] = await Promise.all([
    tx.supplierOfferChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
    tx.productChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
  ]);

  await tx.product.update({
    where: { id: productId },
    data: {
      hasPendingChanges: offerPendingCount + productPendingCount > 0,
    } as any,
  });
}

/**
 * Hard-delete safety:
 * Block deletes if product OR any of its variants have ever been used in orders.
 */
async function assertProductOffersDeletable(productId: string) {
  const hitByProduct = await prisma.orderItem.findFirst({
    where: { productId },
    select: { id: true },
  });

  if (hitByProduct) {
    const err: any = new Error(
      "Cannot delete supplier offers: this product has been used in orders."
    );
    err.statusCode = 409;
    throw err;
  }

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true },
  });

  if (!variants.length) return;

  const variantIds = variants.map((v) => v.id);
  const hitByVariant = await prisma.orderItem.findFirst({
    where: { variantId: { in: variantIds } },
    select: { id: true },
  });

  if (hitByVariant) {
    const err: any = new Error(
      "Cannot delete supplier offers: a variant of this product has been used in orders."
    );
    err.statusCode = 409;
    throw err;
  }
}

/**
 * Supplier consistency check
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

async function applyProductChangePatchTx(
  tx: Prisma.TransactionClient,
  row: {
    productId: string;
    supplierId?: string | null;
    proposedPatch?: any;
    product?: {
      supplierId?: string | null;
      freeShipping?: boolean | null;
      weightGrams?: number | null;
      lengthCm?: Prisma.Decimal | number | null;
      widthCm?: Prisma.Decimal | number | null;
      heightCm?: Prisma.Decimal | number | null;
      isFragile?: boolean | null;
      isBulky?: boolean | null;
      shippingClass?: string | null;
    } | null;
  }
) {
  const productId = String(row.productId);
  const patch = (row.proposedPatch ?? {}) as any;

  const productData: any = {};

  if (patch.title !== undefined) {
    productData.title = String(patch.title ?? "").trim();
  }

  if (patch.description !== undefined) {
    productData.description = patch.description ?? "";
  }

  if (patch.categoryId !== undefined) {
    productData.categoryId = patch.categoryId == null ? null : String(patch.categoryId);
  }

  if (patch.brandId !== undefined) {
    productData.brandId = patch.brandId == null ? null : String(patch.brandId);
  }

  if (patch.imagesJson !== undefined) {
    productData.imagesJson = Array.isArray(patch.imagesJson)
      ? patch.imagesJson.map((x: any) => String(x ?? "").trim()).filter(Boolean)
      : [];
  }

  if (patch.communicationCost !== undefined) {
    productData.communicationCost =
      patch.communicationCost == null || patch.communicationCost === ""
        ? null
        : toDecimal(patch.communicationCost);
  }

  /* ============================================================
     SHIPPING FIELDS — APPLY ON APPROVAL
  ============================================================ */
  if (patch.freeShipping !== undefined) {
    productData.freeShipping = !!patch.freeShipping;
  }

  if (patch.weightGrams !== undefined) {
    productData.weightGrams =
      patch.weightGrams == null || patch.weightGrams === ""
        ? null
        : Math.max(0, Math.trunc(Number(patch.weightGrams)));
  }

  if (patch.lengthCm !== undefined) {
    productData.lengthCm =
      patch.lengthCm == null || patch.lengthCm === ""
        ? null
        : Number(patch.lengthCm);
  }

  if (patch.widthCm !== undefined) {
    productData.widthCm =
      patch.widthCm == null || patch.widthCm === ""
        ? null
        : Number(patch.widthCm);
  }

  if (patch.heightCm !== undefined) {
    productData.heightCm =
      patch.heightCm == null || patch.heightCm === ""
        ? null
        : Number(patch.heightCm);
  }

  if (patch.isFragile !== undefined) {
    productData.isFragile = !!patch.isFragile;
  }

  if (patch.isBulky !== undefined) {
    productData.isBulky = !!patch.isBulky;
  }

  if (patch.shippingClass !== undefined) {
    productData.shippingClass =
      patch.shippingClass == null || String(patch.shippingClass).trim() === ""
        ? null
        : String(patch.shippingClass).trim();
  }

  /* ============================================================
     FREE SHIPPING NORMALIZATION
     If freeShipping is approved as true, clear parcel fields.
  ============================================================ */
  if (productData.freeShipping === true) {
    productData.weightGrams = null;
    productData.lengthCm = null;
    productData.widthCm = null;
    productData.heightCm = null;
    productData.isFragile = false;
    productData.isBulky = false;
    productData.shippingClass = null;
  }

  if (Object.keys(productData).length) {
    await tx.product.update({
      where: { id: productId },
      data: productData,
    });
  }

  if (patch.attributeSelections !== undefined) {
    await writeProductAttributes(
      tx,
      productId,
      Array.isArray(patch.attributeSelections) ? patch.attributeSelections : []
    );
  }

  if (Array.isArray(patch.variants) && patch.variants.length) {
    const productRow = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, sku: true },
    });

    const supplierId = String(row.supplierId ?? row.product?.supplierId ?? "");

    let baseOffer: any = null;
    if (supplierId) {
      baseOffer = await tx.supplierProductOffer.findFirst({
        where: { productId, supplierId },
        select: { id: true, basePrice: true, currency: true, leadDays: true, isActive: true },
      });
    }

    for (const item of patch.variants) {
      if (String(item?.action || "") !== "CREATE_VARIANT_COMBO") continue;

      const options = normalizeVariantOptions(item?.options ?? []);
      if (!options.length) continue;

      const qty = Math.max(0, Math.trunc(Number(item?.availableQty ?? 0)));
      const unitPrice = Number(item?.unitPrice ?? baseOffer?.basePrice ?? 0);
      const isActive = item?.isActive !== undefined ? !!item.isActive : true;
      const inStock = item?.inStock !== undefined ? !!item.inStock : qty > 0;

      const variantId = await createOrGetVariantByCombo(tx, {
        productId,
        skuBase: String(productRow?.sku || "PRODUCT"),
        desiredSku: item?.sku ?? null,
        options,
        qty,
        inStock,
      });

      if (!variantId || !supplierId) continue;

      const existingVarOffer = await tx.supplierVariantOffer.findFirst({
        where: {
          productId,
          variantId,
          supplierId,
        },
        select: { id: true },
      });

      if (existingVarOffer) {
        await tx.supplierVariantOffer.update({
          where: { id: existingVarOffer.id },
          data: {
            productId,
            supplierId,
            supplierProductOfferId: baseOffer?.id ?? null,
            unitPrice: toDecimal(unitPrice),
            currency: baseOffer?.currency ?? "NGN",
            availableQty: qty,
            inStock,
            isActive,
            leadDays: baseOffer?.leadDays ?? null,
          },
        });
      } else {
        await tx.supplierVariantOffer.create({
          data: {
            productId,
            variantId,
            supplierId,
            supplierProductOfferId: baseOffer?.id ?? null,
            unitPrice: toDecimal(unitPrice),
            currency: baseOffer?.currency ?? "NGN",
            availableQty: qty,
            inStock,
            isActive,
            leadDays: baseOffer?.leadDays ?? null,
          },
        });
      }
    }
  }
}

async function autoApproveLinkedProductChangesTx(
  tx: Prisma.TransactionClient,
  args: {
    productId: string;
    excludeRequestId?: string | null;
  }
) {
  const productRequests = await tx.productChangeRequest.findMany({
    where: {
      productId: args.productId,
      status: "PENDING",
      ...(args.excludeRequestId ? { id: { not: args.excludeRequestId } } : {}),
    },
    include: {
      product: {
        select: {
          id: true,
          supplierId: true,
        },
      },
    },
    orderBy: { requestedAt: "asc" },
  });

  for (const productReq of productRequests) {
    await applyProductChangePatchTx(tx, productReq);

    await tx.productChangeRequest.update({
      where: { id: productReq.id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewNote: "Auto-approved together with linked offer change request.",
      },
    });
  }

  return { count: productRequests.length };
}

async function autoRejectLinkedProductChangesTx(
  tx: Prisma.TransactionClient,
  args: {
    productId: string;
    excludeRequestId?: string | null;
    reasonText: string;
  }
) {
  const productRequests = await tx.productChangeRequest.findMany({
    where: {
      productId: args.productId,
      status: "PENDING",
      ...(args.excludeRequestId ? { id: { not: args.excludeRequestId } } : {}),
    },
    select: { id: true },
    orderBy: { requestedAt: "asc" },
  });

  for (const productReq of productRequests) {
    await tx.productChangeRequest.update({
      where: { id: productReq.id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewNote: `Auto-rejected together with linked offer change request. ${args.reasonText}`.trim(),
      },
    });
  }

  return { count: productRequests.length };
}

/* ----------------------------------------------------------------------------
 * Schemas
 * --------------------------------------------------------------------------*/

const patchBaseSchema = z
  .object({
    supplierId: z.string().min(1).optional(),
    price: coerceNumber(0).optional(),
    currency: z.string().min(1).optional(),
    availableQty: coerceInt(0).optional(),
    leadDays: coerceInt(0).nullable().optional(),
    isActive: coerceBool.optional(),
    variantId: z
      .preprocess((v) => {
        if (v === "" || v == null) return undefined;
        return String(v);
      }, z.string().min(1))
      .optional(),
  })
  .passthrough();

const patchVariantSchema = z
  .object({
    supplierId: z.string().min(1).optional(),
    variantId: z.string().min(1).nullable().optional(),
    unitPrice: coerceNumber(0).optional(),
    price: coerceNumber(0).optional(),
    currency: z.string().min(1).optional(),
    availableQty: coerceInt(0).optional(),
    leadDays: coerceInt(0).nullable().optional(),
    isActive: coerceBool.optional(),
  })
  .passthrough();

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
    price: coerceNumber(0),
    currency: z.string().min(1).default("NGN"),
    availableQty: coerceInt(0, 0).optional(),
    leadDays: coerceInt(0, 0).nullable().optional(),
    isActive: coerceBool.default(true),
  })
  .superRefine((val, ctx) => {
    const inferredKind: "BASE" | "VARIANT" = val.kind ?? (val.variantId ? "VARIANT" : "BASE");

    if (inferredKind === "BASE" && val.variantId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variantId"],
        message: "variantId must be null/omitted for BASE offer",
      });
    }

    if (inferredKind === "VARIANT" && !val.variantId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variantId"],
        message: "variantId is required for VARIANT offer",
      });
    }
  });

const changeListSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELED", "EXPIRED"]).optional().default("PENDING"),
});

const rejectSchema = z.object({
  reason: z.string().trim().optional(),
});

/* ----------------------------------------------------------------------------
 * Unified DTO
 * --------------------------------------------------------------------------*/
function toDtoBase(
  base: any,
  supplierMeta?: { supplierId: string; supplierName?: string | null },
  flags?: { hasOrders?: boolean }
) {
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
    hasOrders: !!flags?.hasOrders,
  };
}

function toDtoVariant(
  v: any,
  supplierMeta?: { supplierId: string; supplierName?: string | null },
  flags?: { hasOrders?: boolean }
) {
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
    hasOrders: !!flags?.hasOrders,
  };
}

async function markProductRejectedTx(
  tx: Prisma.TransactionClient,
  productId: string
) {
  const [offerPendingCount, productPendingCount] = await Promise.all([
    tx.supplierOfferChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
    tx.productChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
  ]);

  const hasPendingChanges = offerPendingCount + productPendingCount > 0;

  await tx.product.update({
    where: { id: productId },
    data: {
      hasPendingChanges,
      status: hasPendingChanges ? ("PENDING" as any) : ("REJECTED" as any),
    } as any,
  });

  return { hasPendingChanges };
}

async function markProductApprovedOrLiveTx(
  tx: Prisma.TransactionClient,
  productId: string
) {
  const [offerPendingCount, productPendingCount] = await Promise.all([
    tx.supplierOfferChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
    tx.productChangeRequest.count({
      where: { productId, status: "PENDING" },
    }),
  ]);

  const hasPendingChanges = offerPendingCount + productPendingCount > 0;

  await tx.product.update({
    where: { id: productId },
    data: {
      hasPendingChanges,
      status: hasPendingChanges ? ("PENDING" as any) : ("LIVE" as any),
    } as any,
  });

  return { hasPendingChanges };
}

/* ----------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------*/
router.use(requireAuth, requireAdmin);

/* ----------------------------------------------------------------------------
 * Offer CRUD routes
 * --------------------------------------------------------------------------*/

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
      supplierId: String(p.supplierId ?? ""),
      supplierName: p.supplier?.name ?? null,
    });
  }

  const [baseOffers, variantOffers] = await Promise.all([
    prisma.supplierProductOffer.findMany({
      where: {
        productId: { in: ids },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        productId: true,
        supplierId: true,
        basePrice: true,
        currency: true,
        availableQty: true,
        leadDays: true,
        isActive: true,
        inStock: true,
      },
    }),
    prisma.supplierVariantOffer.findMany({
      where: {
        productId: { in: ids },
        variant: {
          productId: { in: ids },
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, productId: true } },
      },
    }),
  ]);

  const safeBaseOffers = (baseOffers || []).filter((b: any) => {
    const productMeta = supplierByProductId.get(String(b.productId));
    if (!productMeta) return false;

    return String(b.supplierId ?? "") === String(productMeta.supplierId);
  });

  const safeVariantOffers = (variantOffers || []).filter((v: any) => {
    const productMeta = supplierByProductId.get(String(v.productId));
    if (!productMeta) return false;

    return (
      String(v.productId) === String(v.variant?.productId ?? "") &&
      String(v.supplierId ?? "") === String(productMeta.supplierId)
    );
  });

  const baseIds = safeBaseOffers.map((b: any) => b.id);
  const variantIds = safeVariantOffers.map((v: any) => v.id);

  const [baseOrderRows, variantOrderRows] = await Promise.all([
    baseIds.length
      ? prisma.orderItem.findMany({
        where: { chosenSupplierProductOfferId: { in: baseIds } },
        select: { chosenSupplierProductOfferId: true },
      })
      : [],
    variantIds.length
      ? prisma.orderItem.findMany({
        where: { chosenSupplierVariantOfferId: { in: variantIds } },
        select: { chosenSupplierVariantOfferId: true },
      })
      : [],
  ]);

  const baseUsedSet = new Set(baseOrderRows.map((o) => o.chosenSupplierProductOfferId));
  const variantUsedSet = new Set(variantOrderRows.map((o) => o.chosenSupplierVariantOfferId));

  const out: any[] = [];
  for (const b of safeBaseOffers as any[]) {
    const supplierMeta = supplierByProductId.get(String(b.productId));
    out.push(toDtoBase(b, supplierMeta, { hasOrders: baseUsedSet.has(b.id) }));
  }
  for (const v of safeVariantOffers as any[]) {
    const supplierMeta = supplierByProductId.get(String(v.productId));
    out.push(toDtoVariant(v, supplierMeta, { hasOrders: variantUsedSet.has(v.id) }));
  }

  return res.json({ data: out });
});

router.get("/supplier-offers", bulkOffersHandler);
router.get("/", bulkOffersHandler);


router.get(
  "/products/:productId/supplier-offers",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        supplierId: true,
        supplier: { select: { name: true } },
      },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const supplierMeta = {
      supplierId: String(product.supplierId ?? ""),
      supplierName: product.supplier?.name ?? null,
    };

    const [baseOffers, variantOffers] = await Promise.all([
      prisma.supplierProductOffer.findMany({
        where: {
          productId,
          supplierId: String(product.supplierId),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          productId: true,
          supplierId: true,
          basePrice: true,
          currency: true,
          availableQty: true,
          leadDays: true,
          isActive: true,
          inStock: true,
        },
      }),
      prisma.supplierVariantOffer.findMany({
        where: {
          productId,
          supplierId: String(product.supplierId),
          variant: {
            productId,
          },
        },
        orderBy: { createdAt: "desc" },
        include: {
          variant: { select: { id: true, sku: true, productId: true } },
        },
      }),
    ]);

    const safeBaseOffers = (baseOffers || []).filter((b: any) => {
      return String(b.supplierId ?? "") === String(product.supplierId ?? "");
    });

    const safeVariantOffers = (variantOffers || []).filter((v: any) => {
      return (
        String(v.supplierId ?? "") === String(product.supplierId ?? "") &&
        String(v.productId) === String(productId) &&
        String(v.variant?.productId ?? "") === String(productId)
      );
    });

    const out: any[] = [];
    for (const b of safeBaseOffers as any[]) out.push(toDtoBase(b, supplierMeta));
    for (const v of safeVariantOffers as any[]) out.push(toDtoVariant(v, supplierMeta));

    return res.json({ data: out });
  })
);

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
      return res.status(409).json({
        error: "This product has no supplierId configured.",
      });
    }

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

    if (kind === "BASE" || !variantId) {
      const data = {
        productId,
        supplierId,
        basePrice: toDecimal(price),
        currency: parsed.currency ?? "NGN",
        availableQty: qty,
        leadDays: parsed.leadDays == null ? null : parsed.leadDays,
        isActive,
        inStock,
      };

      const existing = await prisma.supplierProductOffer.findFirst({
        where: { productId, supplierId },
        select: { id: true },
      });

      const upserted = existing
        ? await prisma.supplierProductOffer.update({
          where: { id: existing.id },
          data,
        })
        : await prisma.supplierProductOffer.create({ data });

      await recomputeProductStockTx(prisma as any, productId);
      return res.status(201).json({ data: toDtoBase(upserted, supplierMeta) });
    }

    const variant = await prisma.productVariant.findUnique({
      where: { id: String(variantId) },
      select: { id: true, productId: true },
    });
    if (!variant || String(variant.productId) !== productId) {
      return res.status(400).json({ error: "variantId does not belong to this product" });
    }

    const base = await prisma.supplierProductOffer.findFirst({
      where: { productId, supplierId },
      select: { id: true, currency: true },
    });

    const existingVariant = await prisma.supplierVariantOffer.findFirst({
      where: {
        productId,
        variantId: String(variantId),
        supplierId,
      },
      select: { id: true },
    });

    const created = existingVariant
      ? await prisma.supplierVariantOffer.update({
        where: { id: existingVariant.id },
        data: {
          productId,
          variantId: String(variantId),
          supplierProductOfferId: base?.id ?? null,
          supplierId,
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
      })
      : await prisma.supplierVariantOffer.create({
        data: {
          productId,
          variantId: String(variantId),
          supplierProductOfferId: base?.id ?? null,
          supplierId,
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
  })
);

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

      async function assertOfferRowNotUsedInOrdersOrThrow(kind: "BASE" | "VARIANT", rawId: string) {
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

        const supplierId = String(product.supplierId ?? existing.supplierId);
        const supplierMeta = {
          supplierId,
          supplierName: product.supplier?.name ?? null,
        };

        const wantsConvertToVariant = !!patch.variantId;
        if (wantsConvertToVariant) {
          await assertOfferRowNotUsedInOrdersOrThrow("BASE", existing.id);

          const targetVariantId = String(patch.variantId).trim();

          const variant = await prisma.productVariant.findUnique({
            where: { id: targetVariantId },
            select: { id: true, productId: true },
          });
          if (!variant || String(variant.productId) !== productId) {
            return res.status(400).json({ error: "variantId does not belong to this product" });
          }

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
            patch.leadDays !== undefined
              ? patch.leadDays == null
                ? null
                : patch.leadDays
              : existing.leadDays ?? null;

          const moved = await prisma.$transaction(async (tx) => {
            const existingVariant = await tx.supplierVariantOffer.findFirst({
              where: {
                productId,
                variantId: targetVariantId,
                supplierId,
              },
              select: { id: true },
            });

            const row = existingVariant
              ? await tx.supplierVariantOffer.update({
                where: { id: existingVariant.id },
                data: {
                  productId,
                  variantId: targetVariantId,
                  supplierProductOfferId: null,
                  supplierId,
                  unitPrice: toDecimal(nextPrice),
                  currency: nextCurrency,
                  availableQty: nextQty,
                  leadDays: nextLeadDays,
                  isActive: nextIsActive,
                  inStock: nextInStock,
                },
                include: { variant: { select: { id: true, sku: true, productId: true } } },
              })
              : await tx.supplierVariantOffer.create({
                data: {
                  productId,
                  variantId: targetVariantId,
                  supplierProductOfferId: null,
                  supplierId,
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
            return row;
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

        const data: any = { supplierId };

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
          data.availableQty !== undefined ? Number(data.availableQty) : Number(existing.availableQty ?? 0);
        const nextActive = data.isActive !== undefined ? !!data.isActive : !!existing.isActive;
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

      const patch = patchVariantSchema.parse(req.body ?? {});
      const existing = await prisma.supplierVariantOffer.findUnique({
        where: { id: parsedId.rawId },
        include: { variant: { select: { id: true, sku: true, productId: true } } },
      });
      if (!existing) return res.status(404).json({ error: "Variant offer not found" });

      if (!existing.variant || String(existing.variant.productId) !== String(existing.productId)) {
        return res.status(409).json({
          error: "Corrupt variant offer: variant.productId does not match offer.productId",
        });
      }

      const productId = String(existing.productId);

      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, supplierId: true, supplier: { select: { name: true } } },
      });
      if (!product) return res.status(404).json({ error: "Product not found" });

      await assertSupplierMatchesProduct(productId, patch.supplierId ?? null);

      const supplierId = String(product.supplierId ?? existing.supplierId);
      const supplierMeta = {
        supplierId,
        supplierName: product.supplier?.name ?? null,
      };

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
          patch.availableQty !== undefined ? Number(patch.availableQty) : Number(existing.availableQty ?? 0);

        const nextIsActive = patch.isActive !== undefined ? !!patch.isActive : !!existing.isActive;
        const nextInStock = !!nextIsActive && nextQty > 0;
        const nextCurrency = patch.currency ?? existing.currency ?? "NGN";
        const nextLeadDays =
          patch.leadDays !== undefined
            ? patch.leadDays == null
              ? null
              : patch.leadDays
            : existing.leadDays ?? null;

        const moved = await prisma.$transaction(async (tx) => {
          const existingBase = await tx.supplierProductOffer.findFirst({
            where: { productId, supplierId },
            select: { id: true },
          });

          const baseData = {
            productId,
            supplierId,
            basePrice: toDecimal(nextPrice),
            currency: nextCurrency,
            availableQty: nextQty,
            leadDays: nextLeadDays,
            isActive: nextIsActive,
            inStock: nextInStock,
          };

          const baseRow = existingBase
            ? await tx.supplierProductOffer.update({
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
            })
            : await tx.supplierProductOffer.create({
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

          await tx.supplierVariantOffer.delete({ where: { id: existing.id } });
          return baseRow;
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

      const data: any = { supplierId };

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

      if (patch.variantId && typeof patch.variantId === "string") {
        const targetVariantId = String(patch.variantId);

        const variant = await prisma.productVariant.findUnique({
          where: { id: targetVariantId },
          select: { id: true, productId: true },
        });
        if (!variant || String(variant.productId) !== productId) {
          return res.status(400).json({ error: "variantId does not belong to this product" });
        }

        const conflicting = await prisma.supplierVariantOffer.findFirst({
          where: {
            productId,
            supplierId,
            variantId: targetVariantId,
            id: { not: existing.id },
          },
          select: { id: true },
        });

        if (conflicting) {
          return res.status(409).json({
            error: "Duplicate variant offer for this supplier + product + variantId.",
          });
        }

        data.variantId = targetVariantId;
      }

      const base = await prisma.supplierProductOffer.findFirst({
        where: { productId, supplierId },
        select: { id: true },
      });

      data.supplierProductOfferId = base?.id ?? null;
      data.productId = productId;

      const nextQty =
        data.availableQty !== undefined ? Number(data.availableQty) : Number(existing.availableQty ?? 0);
      const nextActive = data.isActive !== undefined ? !!data.isActive : !!existing.isActive;
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
          return res.status(409).json({ error: "Duplicate variant offer for this supplier + variantId." });
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
        await recomputeProductStockTx(tx, pid);

        return { ok: true, deleted: `variant:${parsedId.rawId}`, productId: pid };
      }

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

      await tx.supplierVariantOffer.updateMany({
        where: { supplierProductOfferId: base.id },
        data: { supplierProductOfferId: null },
      });

      await tx.supplierProductOffer.delete({ where: { id: base.id } });
      await recomputeProductStockTx(tx, pid);

      return { ok: true, deleted: `base:${base.id}`, productId: pid };
    });

    if (!result.ok) {
      return res.status((result as any).status).json({ error: (result as any).msg });
    }

    return res.json({
      ok: true,
      deleted: (result as any).deleted,
      productId: (result as any).productId,
    });
  })
);

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

router.post(
  "/products/:productId/supplier-offers/repair",
  wrap(async (req, res) => {
    const productId = String(req.params.productId);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, supplierId: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const result = await prisma.$transaction(async (tx) => {
      const variantOffers = await tx.supplierVariantOffer.findMany({
        where: { productId },
        include: {
          variant: {
            select: {
              id: true,
              productId: true,
            },
          },
        },
      });

      let fixedBaseLink = 0;
      let removedCorruptRows = 0;
      let fixedSupplierId = 0;

      for (const vo of variantOffers as any[]) {
        const variantBelongsToProduct =
          !!vo.variant && String(vo.variant.productId) === String(productId);

        if (!variantBelongsToProduct) {
          await tx.supplierVariantOffer.delete({
            where: { id: String(vo.id) },
          });
          removedCorruptRows += 1;
          continue;
        }

        if (String(vo.supplierId ?? "") !== String(product.supplierId ?? "")) {
          await tx.supplierVariantOffer.update({
            where: { id: String(vo.id) },
            data: { supplierId: String(product.supplierId ?? "") },
          });
          fixedSupplierId += 1;
        }

        const base = await tx.supplierProductOffer.findFirst({
          where: {
            productId,
            supplierId: String(product.supplierId ?? ""),
          },
          select: { id: true },
        });

        if (base) {
          if (!vo.supplierProductOfferId || String(vo.supplierProductOfferId) !== String(base.id)) {
            await tx.supplierVariantOffer.update({
              where: { id: String(vo.id) },
              data: { supplierProductOfferId: String(base.id) },
            });
            fixedBaseLink += 1;
          }
        } else if (vo.supplierProductOfferId) {
          await tx.supplierVariantOffer.update({
            where: { id: String(vo.id) },
            data: { supplierProductOfferId: null },
          });
          fixedBaseLink += 1;
        }
      }

      await recomputeProductStockTx(tx, productId);
      return {
        scanned: variantOffers.length,
        fixedBaseLink,
        fixedSupplierId,
        removedCorruptRows,
      };
    });

    return res.json({ ok: true, productId, ...result });
  })
);

/* ----------------------------------------------------------------------------
 * Approval routes - Offer Change Requests
 * --------------------------------------------------------------------------*/

router.get(
  "/offer-change-requests",
  wrap(async (req, res) => {
    const parsed = changeListSchema.parse(req.query ?? {});
    const status = parsed.status;

    const [items, linkedProductRequests] = await Promise.all([
      prisma.supplierOfferChangeRequest.findMany({
        where: { status },
        orderBy: { requestedAt: "desc" },
        include: {
          supplier: { select: { id: true, name: true } },
          product: { select: { id: true, title: true, sku: true } },
          supplierProductOffer: {
            select: {
              id: true,
              basePrice: true,
              currency: true,
              availableQty: true,
              leadDays: true,
              isActive: true,
              inStock: true,
            },
          },
          supplierVariantOffer: {
            select: {
              id: true,
              variantId: true,
              unitPrice: true,
              currency: true,
              availableQty: true,
              leadDays: true,
              isActive: true,
              inStock: true,
            },
          },
        },
      }),
      prisma.productChangeRequest.findMany({
        where: {
          status,
        },
        select: {
          id: true,
          productId: true,
          proposedPatch: true,
        },
      }),
    ]);

    const latestPendingProductPatchByProductId = new Map<string, any>();
    for (const row of linkedProductRequests) {
      latestPendingProductPatchByProductId.set(String(row.productId), {
        id: row.id,
        proposedPatch: row.proposedPatch ?? {},
      });
    }

    return res.json({
      data: {
        items: items.map((x) => {
          const linkedProductPatch = latestPendingProductPatchByProductId.get(String(x.productId));
          return {
            id: x.id,
            status: x.status,
            scope: x.scope,
            supplierId: x.supplierId,
            productId: x.productId,
            variantId: x.supplierVariantOffer?.variantId ?? null,
            proposedPatch: mergePatches(x.patchJson ?? {}, linkedProductPatch?.proposedPatch ?? {}),
            currentSnapshot:
              x.scope === "BASE_OFFER"
                ? x.supplierProductOffer ?? {}
                : x.supplierVariantOffer ?? {},
            requestedAt: x.requestedAt,
            supplier: x.supplier,
            product: x.product,
            linkedProductChangeRequestId: linkedProductPatch?.id ?? null,
          };
        }),
      },
    });
  })
);

router.post(
  "/product-change-requests/:id/approve",
  wrap(async (req: any, res) => {
    const id = requiredString(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.productChangeRequest.findUnique({
        where: { id },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              sku: true,
              supplierId: true,
              description: true,
              categoryId: true,
              brandId: true,
              imagesJson: true,
              communicationCost: true,

              /* shipping fields needed for approval context */
              freeShipping: true,
              weightGrams: true,
              lengthCm: true,
              widthCm: true,
              heightCm: true,
              isFragile: true,
              isBulky: true,
              shippingClass: true,
            },
          },
        },
      });

      if (!row) {
        return { status: 404, body: { error: "Product change request not found" } };
      }

      if (row.status !== "PENDING") {
        return {
          status: 409,
          body: { error: `Only PENDING requests can be approved. Current status: ${row.status}` },
        };
      }

      const productId = String(row.productId);

      await applyProductChangePatchTx(tx, row);

      await tx.productChangeRequest.update({
        where: { id: row.id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
        },
      });

      await markProductApprovedOrLiveTx(tx, productId);
      await recomputeProductStockTx(tx, productId);

      return {
        status: 200,
        body: { ok: true, approved: true, id: row.id, productId },
      };
    });

    return res.status(result.status).json(result.body);
  })
);

router.post(
  "/offer-change-requests/:id/reject",
  wrap(async (req: any, res) => {
    const id = requiredString(req.params.id);
    const parsed = rejectSchema.parse(req.body ?? {});
    const reasonText = parsed.reason?.trim() || "Rejected by admin";

    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.supplierOfferChangeRequest.findUnique({
        where: { id },
        select: {
          id: true,
          productId: true,
          status: true,
          supplierId: true,
        },
      });

      if (!row) {
        return { status: 404, body: { error: "Offer change request not found" } };
      }

      if (row.status !== "PENDING") {
        return {
          status: 409,
          body: {
            error: `Only PENDING requests can be rejected. Current status: ${row.status}`,
          },
        };
      }

      await autoRejectLinkedProductChangesTx(tx, {
        productId: String(row.productId),
        reasonText,
      });

      await tx.supplierOfferChangeRequest.update({
        where: { id: row.id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewNote: reasonText,
        },
      });

      await markProductRejectedTx(tx, String(row.productId));

      return {
        status: 200,
        body: {
          ok: true,
          rejected: true,
          id: row.id,
          productId: row.productId,
          reason: reasonText,
        },
      };
    });

    return res.status(result.status).json(result.body);
  })
);

/* ----------------------------------------------------------------------------
 * Approval routes - Product Change Requests
 * --------------------------------------------------------------------------*/

router.get(
  "/product-change-requests",
  wrap(async (req, res) => {
    const parsed = changeListSchema.parse(req.query ?? {});
    const status = parsed.status;

    const [items, pendingOfferRows] = await Promise.all([
      prisma.productChangeRequest.findMany({
        where: { status },
        orderBy: { requestedAt: "desc" },
        include: {
          supplier: { select: { id: true, name: true } },
          product: { select: { id: true, title: true, sku: true } },
        },
      }),
      status === "PENDING"
        ? prisma.supplierOfferChangeRequest.findMany({
          where: { status: "PENDING" },
          select: { productId: true },
        })
        : Promise.resolve([] as Array<{ productId: string }>),
    ]);

    const hiddenProductIds = new Set(
      (pendingOfferRows || []).map((x) => String(x.productId))
    );

    const visibleItems =
      status === "PENDING"
        ? items.filter((x) => !hiddenProductIds.has(String(x.productId)))
        : items;

    return res.json({
      data: {
        items: visibleItems.map((x) => ({
          id: x.id,
          status: x.status,
          supplierId: x.supplierId,
          productId: x.productId,
          proposedPatch: x.proposedPatch ?? {},
          currentSnapshot: x.currentSnapshot ?? {},
          requestedAt: x.requestedAt,
          supplier: x.supplier,
          product: x.product,
        })),
      },
    });
  })
);

router.post(
  "/product-change-requests/:id/approve",
  wrap(async (req: any, res) => {
    const id = requiredString(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.productChangeRequest.findUnique({
        where: { id },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              sku: true,
              supplierId: true,
              description: true,
              categoryId: true,
              brandId: true,
              imagesJson: true,
              communicationCost: true,
            },
          },
        },
      });

      if (!row) {
        return { status: 404, body: { error: "Product change request not found" } };
      }

      if (row.status !== "PENDING") {
        return {
          status: 409,
          body: { error: `Only PENDING requests can be approved. Current status: ${row.status}` },
        };
      }

      const productId = String(row.productId);

      await applyProductChangePatchTx(tx, row);

      await tx.productChangeRequest.update({
        where: { id: row.id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
        },
      });

      await markProductApprovedOrLiveTx(tx, productId);
      await recomputeProductStockTx(tx, productId);

      return {
        status: 200,
        body: { ok: true, approved: true, id: row.id, productId },
      };
    });

    return res.status(result.status).json(result.body);
  })
);

router.post(
  "/product-change-requests/:id/reject",
  wrap(async (req: any, res) => {
    const id = requiredString(req.params.id);
    const parsed = rejectSchema.parse(req.body ?? {});
    const reasonText = parsed.reason?.trim() || "Rejected by admin";

    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.productChangeRequest.findUnique({
        where: { id },
        select: {
          id: true,
          productId: true,
          status: true,
          supplierId: true,
        },
      });

      if (!row) {
        return { status: 404, body: { error: "Product change request not found" } };
      }

      if (row.status !== "PENDING") {
        return {
          status: 409,
          body: {
            error: `Only PENDING requests can be rejected. Current status: ${row.status}`,
          },
        };
      }

      await tx.productChangeRequest.update({
        where: { id: row.id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewNote: reasonText,
        },
      });

      await markProductRejectedTx(tx, String(row.productId));

      return {
        status: 200,
        body: {
          ok: true,
          rejected: true,
          id: row.id,
          productId: row.productId,
          reason: reasonText,
        },
      };
    });

    return res.status(result.status).json(result.body);
  })
);

export default router;