// api/src/routes/supplierProducts.ts
import { Router } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireSupplier } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

/* ------------------------------ Utilities ------------------------------- */

type Tx = Prisma.TransactionClient | PrismaClient;

// ✅ accepts Decimal, number, string, null/undefined safely
type Decimalish = Prisma.Decimal | number | string | null | undefined;

const toDecimal = (v: Decimalish) => {
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(String(v ?? 0));
};

const asNumber = (v: any) => {
  if (v === "" || v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * ✅ FIX: UI sometimes sends qty/quantity instead of availableQty.
 * We accept aliases at API boundary ONLY (DB/schema field names stay unchanged).
 */
const pickQty = (...vals: any[]) => {
  for (const v of vals) {
    if (v === "" || v == null) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return undefined;
};

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findUnique({
    where: { userId },
    select: { id: true, name: true, status: true, userId: true },
  });
}

function slugSkuBase(title: string) {
  return String(title ?? "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function randomSkuSuffix(len = 4) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

async function makeUniqueVariantSku(
  tx: Tx,
  desired: string | null | undefined,
  seen: Set<string>,
  fallbackBase: string
) {
  let base = (desired || "").trim();
  if (!base) base = fallbackBase;

  let candidate = base;
  let i = 1;

  const existsInDb = async (sku: string) =>
    !!(await (tx as any).productVariant.findUnique({ where: { sku }, select: { id: true } }));

  while (seen.has(candidate) || (await existsInDb(candidate))) {
    i += 1;
    candidate = `${base}-${i}`;
    if (i > 1000) throw new Error("Exceeded SKU uniquifier attempts");
  }

  seen.add(candidate);
  return candidate;
}

function normalizeOptions(raw: any): Array<{ attributeId: string; valueId: string }> {
  const arr = Array.isArray(raw) ? raw : [];

  const pickAttributeId = (o: any) =>
    String(
      o?.attributeId ??
      o?.attribute?.id ??
      o?.attributeValue?.attributeId ??
      o?.value?.attributeId ??
      ""
    ).trim();

  const pickValueId = (o: any) =>
    String(o?.valueId ?? o?.attributeValueId ?? o?.value?.id ?? o?.attributeValue?.id ?? "").trim();

  // de-dupe by attributeId (last one wins)
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

/**
 * ✅ KEY FIX + UPDATED RULE:
 * - Blank row (no variantId, no options) counts as BASE QTY ONLY IF priceBump is 0
 * - If priceBump != 0 => treat as DEFAULT no-options variant (do not count into base qty)
 */
function placeholderVariantsQtyTotal(variants: any[] | undefined | null) {
  const arr = Array.isArray(variants) ? variants : [];
  let total = 0;
  let sawAny = false;

  for (const v of arr) {
    const direct = String(v?.variantId ?? v?.id ?? "").trim();
    const opts = normalizeOptions(
      v?.options ??
      v?.optionSelections ??
      v?.attributes ??
      v?.attributeSelections ??
      v?.variantOptions ??
      v?.VariantOptions ??
      []
    );
    const bump = asNumber(v?.priceBump) ?? 0;
    if (!opts.length && bump === 0) {
      throw new Error("Variant row has no options and no priceBump; refusing to create default variant.");
    }

    if (direct) continue;
    if (opts.length > 0) continue;

    if (bump !== 0) continue;


    const q = pickQty(v?.availableQty, v?.qty, v?.quantity);
    if (typeof q === "number") {
      total += q;
      sawAny = true;
    }
  }

  return sawAny ? total : undefined;
}

/* ------------------------- AUTO pricing helpers ------------------------- */

async function refreshProductAutoPriceIfAutoMode(tx: Prisma.TransactionClient, productId: string) {
  const p = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, priceMode: true },
  });
  if (!p) return;

  if (String((p as any).priceMode ?? "AUTO").toUpperCase() !== "AUTO") return;

  const agg = await tx.supplierProductOffer.aggregate({
    where: {
      productId,
      isActive: true,
      inStock: true,
      availableQty: { gt: 0 },
      basePrice: { gt: new Prisma.Decimal("0") },

      // ✅ only payout-ready suppliers contribute to autoPrice
      supplier: payoutReadySupplierWhere() as any,
    },
    _min: { basePrice: true },
  });

  await tx.product.update({
    where: { id: productId },
    data: { autoPrice: agg._min.basePrice ?? null },
  });
}


/* ------------------------- Offers helpers (2-table) ---------------------- */

async function upsertSupplierProductOffer(
  tx: Prisma.TransactionClient,
  supplierId: string,
  productId: string,
  input: {
    basePrice: number | string | Prisma.Decimal;
    currency?: string;
    inStock?: boolean;
    isActive?: boolean;
    leadDays?: number | null;
    availableQty?: number;
  }
) {
  const {
    basePrice,
    currency = "NGN",
    inStock = true,
    isActive = true,
    leadDays = null,
    availableQty = 0,
  } = input;

  // ✅ If this update would make the offer purchasable, require payout-ready supplier
  const basePriceNum =
    basePrice instanceof Prisma.Decimal ? Number(basePrice) : Number(basePrice ?? 0);

  if (
    offerBecomesPurchasable({
      isActive,
      inStock,
      availableQty: Math.max(0, Math.trunc(availableQty ?? 0)),
      price: basePriceNum,
    })
  ) {
    await assertSupplierPayoutReadyForPurchasableOfferTx(
      tx as any,
      supplierId,
      "Cannot activate base offer."
    );
  }

  const offer = await tx.supplierProductOffer.upsert({
    where: { supplierId_productId: { supplierId, productId } },
    update: {
      basePrice: toDecimal(basePrice),
      currency,
      inStock,
      isActive,
      leadDays,
      availableQty: Math.max(0, Math.trunc(availableQty ?? 0)),
    },
    create: {
      supplierId,
      productId,
      basePrice: toDecimal(basePrice),
      currency,
      inStock,
      isActive,
      leadDays,
      availableQty: Math.max(0, Math.trunc(availableQty ?? 0)),
    },
  });

  await refreshProductAutoPriceIfAutoMode(tx, productId);
  return offer;
}


/* -------------------------- Attributes writer --------------------------- */

async function writeProductAttributes(
  tx: Prisma.TransactionClient,
  productId: string,
  attributeSelections?: Array<{
    attributeId: string;
    valueId?: string;
    valueIds?: string[];
    text?: string;
  }>
) {
  if (!attributeSelections || !attributeSelections.length) return;

  await tx.productAttributeOption.deleteMany({ where: { productId } });
  await tx.productAttributeText.deleteMany({ where: { productId } });

  const optionRows: { productId: string; attributeId: string; valueId: string }[] = [];

  for (const sel of attributeSelections) {
    if (!sel?.attributeId) continue;

    if (sel.valueId) {
      optionRows.push({ productId, attributeId: sel.attributeId, valueId: sel.valueId });
      continue;
    }

    if (Array.isArray(sel.valueIds) && sel.valueIds.length) {
      for (const vId of sel.valueIds) {
        optionRows.push({ productId, attributeId: sel.attributeId, valueId: vId });
      }
      continue;
    }

    if (typeof sel.text === "string" && sel.text.trim()) {
      await tx.productAttributeText.create({
        data: { productId, attributeId: sel.attributeId, value: sel.text.trim() },
      });
    }
  }

  if (optionRows.length) {
    await tx.productAttributeOption.createMany({
      data: optionRows,
      skipDuplicates: true,
    });
  }
}

/* -------------------------- Variant creation ---------------------------- */

async function createOrGetVariantByCombo(
  tx: Prisma.TransactionClient,
  args: {
    productId: string;
    productSkuBase: string;
    desiredSku?: string | null;
    options: Array<{ attributeId: string; valueId: string }>;
    qty: number;
    inStock: boolean;
  }
) {
  const { productId, productSkuBase, desiredSku, options, qty, inStock } = args;

  const cleanOptions = normalizeOptions(options);
  if (!cleanOptions.length) return null;

  const key = comboKey(cleanOptions);

  const existing = await tx.productVariant.findMany({
    where: { productId },
    select: {
      id: true,
      options: { select: { attributeId: true, valueId: true } },
    } as any,
  });

  const existingMap = new Map<string, string>();
  for (const v of existing as any[]) {
    const k = comboKey(
      (v.options || []).map((o: any) => ({
        attributeId: o.attributeId,
        valueId: o.valueId,
      }))
    );
    if (k) existingMap.set(k, v.id);
  }

  const already = existingMap.get(key);
  if (already) return already;

  const seen = new Set<string>();
  const fallbackBase = `${String(productSkuBase || "VAR").trim()}-VAR`;
  const sku = await makeUniqueVariantSku(tx as any, desiredSku ?? null, seen, fallbackBase);

  const created = await tx.productVariant.create({
    data: {
      productId,
      sku,
      retailPrice: null,
      inStock,
      imagesJson: [],
      availableQty: qty,
    } as any,
    select: { id: true },
  });

  await tx.productVariantOption.createMany({
    data: cleanOptions.map((o) => ({
      variantId: created.id,
      attributeId: o.attributeId,
      valueId: o.valueId,
      priceBump: null,
    })),
    skipDuplicates: true,
  });

  return created.id;
}

/**
 * ✅ DEFAULT (no-options) variant creator/getter
 * Used when a row has priceBump != 0 but no options selected.
 */
async function createOrGetDefaultVariant(
  tx: Prisma.TransactionClient,
  args: {
    productId: string;
    productSkuBase: string;
    desiredSku?: string | null;
    qty: number;
    inStock: boolean;
  }
) {
  const { productId, productSkuBase, desiredSku, qty, inStock } = args;

  const existing = await tx.productVariant.findFirst({
    where: {
      productId,
      options: { none: {} },
    } as any,
    select: { id: true, sku: true },
    orderBy: { createdAt: "asc" } as any,
  });

  if (existing) return existing.id;

  const seen = new Set<string>();
  const fallbackBase = `${String(productSkuBase || "VAR").trim()}-DEFAULT`;
  const sku = await makeUniqueVariantSku(tx as any, desiredSku ?? null, seen, fallbackBase);

  const created = await tx.productVariant.create({
    data: {
      productId,
      sku,
      retailPrice: null,
      inStock,
      imagesJson: [],
      availableQty: qty,
    } as any,
    select: { id: true },
  });

  return created.id;
}


// ------- sku helpers ------ 
function prefixVariantSkuWithProductName(productTitle: string, rawSku?: string | null) {
  const prefix = slugSkuBase(productTitle).toUpperCase().slice(0, 30) || "PRODUCT";
  const s = String(rawSku ?? "").trim();
  if (!s) return null;

  // sanitize + uppercase
  const clean = s
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .toUpperCase();

  if (!clean) return null;

  // avoid double-prefixing
  if (clean.startsWith(prefix + "-")) return clean;

  return `${prefix}-${clean}`;
}


function payoutReadySupplierWhere() {
  const nonEmpty = { not: "" } as any;

  return {
    isPayoutEnabled: true,

    // Prefer AND so you can enforce both non-null and non-empty
    AND: [
      { accountNumber: { not: null } },
      { accountNumber: nonEmpty },

      { accountName: { not: null } },
      { accountName: nonEmpty },

      { bankCode: { not: null } },
      { bankCode: nonEmpty },

      { bankCountry: { not: null } },
      { bankCountry: nonEmpty },

      // ✅ add this (your new strict rule)
      { bankVerificationStatus: "VERIFIED" },
    ],
  } as const;
}


async function isSupplierPayoutReadyTx(tx: Tx, supplierId: string): Promise<boolean> {
  const s = await (tx as any).supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      isPayoutEnabled: true,
      accountNumber: true,
      accountName: true,
      bankCode: true,
      bankCountry: true,

      // ✅ add
      bankVerificationStatus: true,
    },
  });

  if (!s) return false;

  const nonEmpty = (v: any) => typeof v === "string" ? v.trim().length > 0 : !!v;

  return !!(
    s.isPayoutEnabled &&
    nonEmpty(s.accountNumber) &&
    nonEmpty(s.accountName) &&
    nonEmpty(s.bankCode) &&
    nonEmpty(s.bankCountry) &&
    String(s.bankVerificationStatus ?? "").toUpperCase() === "VERIFIED"
  );
}


/**
 * "Eligible" offer = something that could make a product purchasable
 * (active + in stock + qty>0 + price>0).
 */
function offerBecomesPurchasable(input: {
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number;
  price?: number; // basePrice for base offers, total or bump rules for variant offers depending on your design
}) {
  const isActive = input.isActive !== false;
  const inStock = input.inStock !== false;
  const qty = Math.max(0, Math.trunc(input.availableQty ?? 0));
  const price = Number(input.price ?? 0);

  return isActive && inStock && qty > 0 && price > 0;
}

async function assertSupplierPayoutReadyForPurchasableOfferTx(
  tx: Tx,
  supplierId: string,
  contextMsg: string
) {
  const ok = await isSupplierPayoutReadyTx(tx, supplierId);
  if (!ok) {
    const err: any = new Error(
      `${contextMsg} Supplier must complete bank details and have payouts enabled before an offer can be active/in-stock with quantity.`
    );
    err.statusCode = 400;
    throw err;
  }
}


/* ------------------------------- Schemas -------------------------------- */

const zCoerceIntNonNegOpt = () =>
  z
    .preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z.number().finite().transform((n) => Math.max(0, Math.trunc(n)))
    )
    .optional();

const zCoerceIntNullableOpt = () =>
  z
    .preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int())
    .nullable()
    .optional();

const OfferSchema = z
  .object({
    currency: z.string().optional(),
    inStock: z.boolean().optional(),
    isActive: z.boolean().optional(),
    leadDays: zCoerceIntNullableOpt(),
    availableQty: zCoerceIntNonNegOpt(),
    qty: zCoerceIntNonNegOpt(),
    quantity: zCoerceIntNonNegOpt(),
    basePrice: z.union([z.number(), z.string()]).optional(),
  })
  .optional();

const VariantOfferUpdateSchema = z
  .object({
    variantId: z.string().min(1),
    priceBump: z.union([z.number(), z.string()]).optional().nullable(),
    availableQty: z.union([z.number(), z.string()]).optional().nullable(),
    qty: z.union([z.number(), z.string()]).optional().nullable(),
    quantity: z.union([z.number(), z.string()]).optional().nullable(),
    inStock: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

const VariantOptionInputSchema = z
  .object({
    attributeId: z.string().optional(),
    valueId: z.string().optional(),

    // common aliases
    attributeValueId: z.string().optional(),
    attribute: z.object({ id: z.string().optional() }).optional(),
    value: z.object({ id: z.string().optional(), attributeId: z.string().optional() }).optional(),
    attributeValue: z
      .object({ id: z.string().optional(), attributeId: z.string().optional() })
      .optional(),
  })
  .passthrough();


const VariantCreateSchema = z
  .object({
    variantId: z.string().optional(),
    sku: z.string().optional().nullable(),
    options: z.array(VariantOptionInputSchema).optional(),
    priceBump: z.union([z.number(), z.string()]).optional().nullable(),
    availableQty: z.union([z.number(), z.string()]).optional().nullable(),
    qty: z.union([z.number(), z.string()]).optional().nullable(),
    quantity: z.union([z.number(), z.string()]).optional().nullable(),
    inStock: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

const CreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  price: z.union([z.number(), z.string()]),
  sku: z.string().trim().min(1).nullable().optional(),
  inStock: z.boolean().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  imagesJson: z.array(z.string()).optional(),
  communicationCost: z.union([z.number(), z.string()]).optional(),
  availableQty: zCoerceIntNonNegOpt(),
  qty: zCoerceIntNonNegOpt(),
  quantity: zCoerceIntNonNegOpt(),
  offer: OfferSchema,
  attributeSelections: z.array(z.any()).optional(),
  variants: z
    .array(
      z.object({
        variantId: z.string().optional(),
        sku: z.string().optional().nullable(),
        options: z.array(VariantOptionInputSchema).optional(),
        priceBump: z.union([z.number(), z.string()]).optional().nullable(),
        availableQty: z.union([z.number(), z.string()]).optional().nullable(),
        qty: z.union([z.number(), z.string()]).optional().nullable(),
        quantity: z.union([z.number(), z.string()]).optional().nullable(),
        inStock: z.boolean().optional(),
        isActive: z.boolean().optional(),
        imagesJson: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.union([z.number(), z.string()]).optional(),
  sku: z.string().min(1).optional(),
  inStock: z.boolean().optional(),
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  imagesJson: z.array(z.string()).optional(),
  communicationCost: z.union([z.number(), z.string()]).nullable().optional(),
  availableQty: zCoerceIntNonNegOpt(),
  qty: zCoerceIntNonNegOpt(),
  quantity: zCoerceIntNonNegOpt(),
  offer: OfferSchema,
  attributeSelections: z.array(z.any()).optional(),
  variants: z.array(z.union([VariantOfferUpdateSchema, VariantCreateSchema])).optional(),
}).extend(
  {
  stockOnly: z.boolean().optional(),
  meta: z
    .object({
      stockOnly: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
}
);

/* -------------------------------- Products ------------------------------ */

// LIST
router.get("/", requireAuth, requireSupplier, async (req, res) => {
  const s = await getSupplierForUser(req.user!.id);
  if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "ANY").toUpperCase();
  const take = Math.min(100, Math.max(1, Number(req.query.take) || 50));
  const skip = Math.max(0, Number(req.query.skip) || 0);

  const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 3);

  const MAX_QTY_PER_SKU = Math.max(0, Number(process.env.SUPPLIER_MAX_AVAILABLE_QTY ?? 10_000));
  const MAX_DELTA_LIVE = Math.max(0, Number(process.env.SUPPLIER_MAX_STOCK_DELTA_LIVE ?? 500));

  function clampQty(n: number) {
    const v = Math.max(0, Math.trunc(Number(n) || 0));
    return Math.min(v, MAX_QTY_PER_SKU);
  }

  function err400(msg: string) {
    const e: any = new Error(msg);
    e.statusCode = 400;
    return e;
  }

  function assertStockUpdateAllowed(args: {
    productStatus: string | null | undefined;
    prevQty: number;
    nextQty: number;
    label: string; // "base" or "variant:<id>"
  }) {
    const statusUpper = String(args.productStatus ?? "").toUpperCase();
    const isLive = statusUpper === "LIVE" || statusUpper === "PUBLISHED" || statusUpper === "APPROVED";

    if (args.nextQty > MAX_QTY_PER_SKU) {
      throw err400(
        `Qty too high for ${args.label}. Max allowed is ${MAX_QTY_PER_SKU}.`
      );
    }

    // Only apply delta guard when product is already live in marketplace
    if (isLive) {
      const delta = args.nextQty - Math.max(0, Math.trunc(args.prevQty || 0));
      if (delta > MAX_DELTA_LIVE) {
        throw err400(
          `Stock increase too large for ${args.label} (+${delta}). Max per update for LIVE products is +${MAX_DELTA_LIVE}.`
        );
      }
    }
  }

  const where: Prisma.ProductWhereInput = {
    isDeleted: false,
    OR: [{ ownerId: req.user!.id }, { userId: req.user!.id }],
    ...(status !== "ANY" ? { status: status as any } : {}),
    ...(q
      ? {
        AND: [
          {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        title: true,
        sku: true,
        status: true,
        inStock: true,
        imagesJson: true,
        createdAt: true,
        categoryId: true,
        brandId: true,

        // keep product.availableQty as fallback only
        availableQty: true,

        // ✅ Get base offer for price/currency display (1 row is fine)
        supplierProductOffers: {
          where: { supplierId: s.id, isActive: true },
          select: { basePrice: true, currency: true, inStock: true, availableQty: true, isActive: true },
          take: 1,
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  // ✅ Compute accurate availableQty per product from offers (base + variant)
  const productIds = items.map((p: any) => String(p.id));

  const [baseAgg, variantAgg] = await Promise.all([
    prisma.supplierProductOffer.groupBy({
      by: ["productId"],
      where: {
        supplierId: s.id,
        productId: { in: productIds },
        isActive: true,
        inStock: true,
      },
      _sum: { availableQty: true },
    }),
    prisma.supplierVariantOffer.groupBy({
      by: ["productId"],
      where: {
        supplierId: s.id,
        productId: { in: productIds },
        isActive: true,
        inStock: true,
      },
      _sum: { availableQty: true },
    }),
  ]);

  const totalsByProduct: Record<string, number> = {};
  for (const r of baseAgg) {
    const pid = String(r.productId);
    totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + Number(r._sum.availableQty ?? 0);
  }
  for (const r of variantAgg) {
    const pid = String(r.productId);
    totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + Number(r._sum.availableQty ?? 0);
  }

  res.json({
    data: items.map((p: any) => {
      const offer = p.supplierProductOffers?.[0] ?? null;

      const pid = String(p.id);
      const offerQtyTotal = totalsByProduct[pid] ?? 0;

      // choose displayed qty:
      // - prefer offer totals (more accurate for supplier)
      // - fallback to product.availableQty if no offers exist
      const availableQty =
        offerQtyTotal > 0 ? offerQtyTotal : Number(offer?.availableQty ?? p.availableQty ?? 0);

      // choose displayed stock flag:
      // - if we have offers, "in stock" means qty > 0 (or offer says inStock)
      // - otherwise fall back to product.inStock
      const inStock =
        offer != null ? (availableQty > 0 || offer.inStock === true) : Boolean(p.inStock);

      return {
        id: p.id,
        title: p.title,
        sku: p.sku,
        status: p.status,
        inStock,
        availableQty,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        createdAt: p.createdAt,
        categoryId: p.categoryId ?? null,
        brandId: p.brandId ?? null,
        price: offer?.basePrice != null ? Number(offer.basePrice) : 0,
        currency: offer?.currency ?? "NGN",

        // ✅ handy for UI badge (optional)
        isLowStock: availableQty <= LOW_STOCK_THRESHOLD,
      };
    }),
    total,

    // ✅ UI can display/compare using the same threshold as backend
    meta: { lowStockThreshold: LOW_STOCK_THRESHOLD },
  });
});


// DETAIL
router.get("/:id", requireAuth, requireSupplier, async (req, res) => {
  const s = await getSupplierForUser(req.user!.id);
  if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

  const { id } = req.params;

  const p = await prisma.product.findFirst({
    where: {
      id,
      isDeleted: false,
      OR: [{ ownerId: req.user!.id }, { userId: req.user!.id }],
    },
    include: {
      ProductVariant: {
        where: { supplierVariantOffers: { some: { supplierId: s.id } } },
        include: {
          options: true,
          supplierVariantOffers: {
            where: { supplierId: s.id },
            select: { id: true, priceBump: true, availableQty: true, inStock: true, isActive: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      supplierProductOffers: {
        where: { supplierId: s.id },
        select: {
          id: true,
          basePrice: true,
          currency: true,
          inStock: true,
          isActive: true,
          leadDays: true,
          availableQty: true,
        },
        take: 1,
      },
    },
  });

  if (!p) return res.status(404).json({ error: "Not found" });

  const myOffer = (p as any).supplierProductOffers?.[0] ?? null;

  const basePrice = myOffer?.basePrice != null ? Number(myOffer.basePrice) : 0;
  const baseQty = myOffer?.availableQty ?? (p as any).availableQty ?? 0;
  const currency = myOffer?.currency ?? "NGN";

  // ✅ attributes: prefer productAttributeOption/text
  let [attributeValues, attributeTexts] = await Promise.all([
    prisma.productAttributeOption.findMany({
      where: { productId: id },
      select: { attributeId: true, valueId: true },
    }),
    prisma.productAttributeText.findMany({
      where: { productId: id },
      select: { attributeId: true, value: true },
    }),
  ]);

  // ✅ FALLBACK: if admin never seeded productAttributeOption, derive from variant options
  if (!attributeValues.length) {
    attributeValues = await prisma.productVariantOption.findMany({
      where: { variant: { productId: id } } as any,
      select: { attributeId: true, valueId: true },
      distinct: ["attributeId", "valueId"] as any,
    });
  }

  res.json({
    data: {
      attributeValues,
      attributeTexts,
      id: p.id,
      title: p.title,
      description: p.description,
      sku: p.sku,
      status: p.status,
      imagesJson: Array.isArray((p as any).imagesJson) ? (p as any).imagesJson : [],
      categoryId: p.categoryId ?? null,
      brandId: p.brandId ?? null,
      price: basePrice,
      currency,
      availableQty: baseQty,
      offer: myOffer
        ? {
          id: myOffer.id,
          basePrice,
          currency: myOffer.currency,
          inStock: myOffer.inStock,
          isActive: myOffer.isActive,
          leadDays: myOffer.leadDays ?? null,
          availableQty: myOffer.availableQty ?? 0,
        }
        : null,
      variants:
        (p as any).ProductVariant?.map((v: any) => {
          const vo = v.supplierVariantOffers?.[0] ?? null;
          return {
            id: v.id,
            sku: v.sku,
            priceBump: vo?.priceBump != null ? Number(vo.priceBump) : 0,
            availableQty: vo?.availableQty ?? v.availableQty ?? 0,
            inStock: vo?.inStock ?? v.inStock,
            isActive: vo?.isActive ?? true,
            supplierVariantOffer: vo
              ? {
                id: vo.id,
                priceBump: Number(vo.priceBump ?? 0),
                availableQty: vo.availableQty ?? 0,
                inStock: vo.inStock ?? true,
                isActive: vo.isActive ?? true,
              }
              : null,
            options: Array.isArray(v.options)
              ? v.options.map((o: any) => ({ attributeId: o.attributeId, valueId: o.valueId }))
              : [],
          };
        }) ?? [],
    },
  });
});

// CREATE
router.post("/", requireAuth, requireSupplier, async (req, res) => {
  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

    const payload = CreateSchema.parse(req.body ?? {});

    let sku = (payload.sku ?? "").trim();
    if (!sku) {
      const base = slugSkuBase(payload.title);
      // During creation of product, the supplierId is currently not being set or is null, set it to the id of the creating supplier
      sku = `${base}-${randomSkuSuffix(4)}`.toUpperCase();
    }

    const attributeSelections = Array.isArray(payload.attributeSelections) ? payload.attributeSelections : [];
    const variants = Array.isArray(payload.variants) ? payload.variants : [];

    const baseQtyFromInputs =
      pickQty(
        payload.offer?.availableQty,
        (payload.offer as any)?.qty,
        (payload.offer as any)?.quantity,
        payload.availableQty,
        (payload as any)?.qty,
        (payload as any)?.quantity
      ) ?? undefined;

    const placeholderQty = placeholderVariantsQtyTotal(variants);
    const qty = (typeof baseQtyFromInputs === "number" ? baseQtyFromInputs : placeholderQty) ?? 0;

    const inStock = payload.offer?.inStock ?? payload.inStock ?? qty > 0;

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const offerBasePrice = payload.offer?.basePrice ?? payload.price;

      const product = await tx.product.create({
        data: {
          title: payload.title,
          description: payload.description ?? "",
          retailPrice: null,
          sku,
          status: "PENDING",
          inStock,
          imagesJson: Array.isArray(payload.imagesJson) ? payload.imagesJson : [],

          ownerId: req.user!.id,
          userId: req.user!.id,

          // ✅ FIX: persist the creating supplier on the product
          supplierId: s.id,

          categoryId: payload.categoryId ?? null,
          brandId: payload.brandId ?? null,
          availableQty: Math.max(0, Math.trunc(qty)),
          autoPrice: toDecimal(offerBasePrice),
        } as any,
        select: { id: true, sku: true, title: true },
      });

      const baseOffer = await upsertSupplierProductOffer(tx, s.id, product.id, {
        basePrice: offerBasePrice,
        currency: payload.offer?.currency ?? "NGN",
        inStock,
        isActive: payload.offer?.isActive ?? true,
        leadDays: (payload.offer?.leadDays ?? null) as any,
        availableQty: Math.max(0, Math.trunc(qty)),
      });

      await writeProductAttributes(tx, product.id, attributeSelections as any);

      if (Array.isArray(variants) && variants.length) {
        const productSkuBase = String(product.sku || slugSkuBase(product.title)).toUpperCase();

        for (const v of variants as any[]) {
          const opts = normalizeOptions(
            v?.options ??
            v?.optionSelections ??
            v?.attributes ??
            v?.attributeSelections ??
            v?.variantOptions ??
            v?.VariantOptions ??
            []
          );
          const vQty = pickQty(v?.availableQty, v?.qty, v?.quantity) ?? 0;
          const vInStock = v?.inStock ?? vQty > 0;
          const bump = asNumber(v?.priceBump) ?? 0;

          if (!opts.length && bump === 0) continue;

          let variantId: string | null = null;

          if (opts.length) {
            variantId = await createOrGetVariantByCombo(tx, {
              productId: product.id,
              productSkuBase,
              desiredSku: prefixVariantSkuWithProductName(product.title, v?.sku ?? null),
              options: opts,
              qty: vQty,
              inStock: !!vInStock,
            });
          } else {
            variantId = await createOrGetDefaultVariant(tx, {
              productId: product.id,
              productSkuBase,
              desiredSku: prefixVariantSkuWithProductName(product.title, v?.sku ?? null),
              qty: vQty,
              inStock: !!vInStock,
            });
          }

          if (!variantId) continue;

          // ✅ If this variant offer would be purchasable, require payout-ready supplier
          const vIsActive = v?.isActive ?? true;
          const vQtyNonNeg = Math.max(0, Math.trunc(vQty));
          const vInStockFinal = !!vInStock;

          // IMPORTANT: your variant offer only stores priceBump.
          // If you want "variant is purchasable" to require baseOffer price too,
          // you can treat price as basePrice+priceBump. Here we gate using bump>0 OR baseOffer>0 implicitly via baseOffer existence.
          const bumpNum = Number(bump ?? 0);
          const effectiveTotalPrice = Number(baseOffer.basePrice ?? offerBasePrice ?? 0) + bumpNum;

          if (
            offerBecomesPurchasable({
              isActive: vIsActive,
              inStock: vInStockFinal,
              availableQty: vQtyNonNeg,
              price: effectiveTotalPrice,
            })
          ) {
            await assertSupplierPayoutReadyForPurchasableOfferTx(
              tx as any,
              s.id,
              "Cannot activate variant offer."
            );
          }

          await tx.supplierVariantOffer.upsert({
            where: { supplierId_variantId: { supplierId: s.id, variantId } },
            update: {
              productId: product.id,
              supplierProductOfferId: baseOffer.id,
              priceBump: toDecimal(bumpNum),
              currency: baseOffer.currency ?? "NGN",
              availableQty: vQtyNonNeg,
              inStock: vInStockFinal,
              isActive: vIsActive,
              leadDays: baseOffer.leadDays ?? null,
            },
            create: {
              supplierId: s.id,
              productId: product.id,
              variantId,
              supplierProductOfferId: baseOffer.id,
              priceBump: toDecimal(bumpNum),
              currency: baseOffer.currency ?? "NGN",
              availableQty: vQtyNonNeg,
              inStock: vInStockFinal,
              isActive: vIsActive,
              leadDays: baseOffer.leadDays ?? null,
            },
          });

        }
      }

      const variantAgg = await tx.supplierVariantOffer.aggregate({
        where: { supplierId: s.id, productId: product.id, isActive: true },
        _sum: { availableQty: true },
      });

      const variantQty = Number(variantAgg._sum?.availableQty ?? 0);
      const effectiveQty = Math.max(0, Math.trunc(qty)) + variantQty;

      await tx.product.update({
        where: { id: product.id },
        data: {
          availableQty: effectiveQty as any,
          inStock: effectiveQty > 0,
        } as any,
      });

      await refreshProductAutoPriceIfAutoMode(tx, product.id);

      return tx.product.findUnique({ where: { id: product.id } });
    });

    res.status(201).json({ data: created });
  } catch (e: any) {

    const status = Number(e?.statusCode) || 500;
    console.error("[supplier.products PATCH] error:", e);
    res.status(status).json({ error: e?.message || "Internal Server Error" });
  }

});


const MAX_QTY_PER_SKU = Math.max(0, Number(process.env.SUPPLIER_MAX_AVAILABLE_QTY ?? 10_000));
const MAX_DELTA_LIVE = Math.max(0, Number(process.env.SUPPLIER_MAX_STOCK_DELTA_LIVE ?? 500));

function clampQty(n: number) {
  const v = Math.max(0, Math.trunc(Number(n) || 0));
  return Math.min(v, MAX_QTY_PER_SKU);
}

function err400(msg: string) {
  const e: any = new Error(msg);
  e.statusCode = 400;
  return e;
}

function assertStockUpdateAllowed(args: {
  productStatus: string | null | undefined;
  prevQty: number;
  nextQty: number;
  label: string; // "base" or "variant:<id>"
}) {
  const statusUpper = String(args.productStatus ?? "").toUpperCase();
  const isLive = statusUpper === "LIVE" || statusUpper === "PUBLISHED" || statusUpper === "APPROVED";

  if (args.nextQty > MAX_QTY_PER_SKU) {
    throw err400(
      `Qty too high for ${args.label}. Max allowed is ${MAX_QTY_PER_SKU}.`
    );
  }

  // Only apply delta guard when product is already live in marketplace
  if (isLive) {
    const delta = args.nextQty - Math.max(0, Math.trunc(args.prevQty || 0));
    if (delta > MAX_DELTA_LIVE) {
      throw err400(
        `Stock increase too large for ${args.label} (+${delta}). Max per update for LIVE products is +${MAX_DELTA_LIVE}.`
      );
    }
  }
}

function modelHasField(modelName: string, fieldName: string) {
  const m = (Prisma as any).dmmf?.datamodel?.models?.find((x: any) => x.name === modelName);
  return !!m?.fields?.some((f: any) => f.name === fieldName);
}

function orderItemWhereProductId(productId: string) {
  // prefer canonical
  if (modelHasField("OrderItem", "productId")) return { productId };

  // legacy fallback (only if it really exists)
  if (modelHasField("OrderItem", "ProductId")) return { ProductId: productId };

  // if neither exists, fail loudly (your schema doesn't match assumptions)
  throw new Error("OrderItem has no productId/ProductId field in Prisma schema.");
}

function orderItemWhereVariantId(variantId: string) {
  if (modelHasField("OrderItem", "variantId")) return { variantId };
  if (modelHasField("OrderItem", "VariantId")) return { VariantId: variantId };
  throw new Error("OrderItem has no variantId/VariantId field in Prisma schema.");
}

function isStockOnlySupplierUpdate(body: any) {
  if (!body || typeof body !== "object") return false;

  // optional explicit hint from frontend
  if (body.stockOnly === true) return true;

  const allowedTop = new Set(["availableQty", "inStock", "offer", "variants", "stockOnly"]);
  for (const k of Object.keys(body)) {
    if (!allowedTop.has(k)) return false;
  }

  if (body.offer != null) {
    if (typeof body.offer !== "object") return false;
    const allowedOffer = new Set(["availableQty", "inStock", "isActive"]);
    for (const k of Object.keys(body.offer)) {
      if (!allowedOffer.has(k)) return false;
    }
  }

  if (body.variants != null) {
    if (!Array.isArray(body.variants)) return false;
    const allowedVar = new Set(["variantId", "availableQty", "inStock", "isActive"]);
    for (const v of body.variants) {
      if (!v || typeof v !== "object") return false;
      for (const k of Object.keys(v)) {
        if (!allowedVar.has(k)) return false;
      }
    }
  }

  return true;
}

// UPDATE (Supplier edit)
router.patch("/:id", requireAuth, requireSupplier, async (req, res) => {
  // ---------- helper: safe number compare ----------
  const n = (v: any) => (v == null ? undefined : Number(v));

  // ---------- helper: try order line models dynamically (so this compiles even if names differ) ----------
  const orderLineModelCandidates = [
    "orderItem",
    "OrderItem",
    "orderItems",
    "OrderItems",
    "orderLineItem",
    "OrderLineItem",
    "orderLine",
    "OrderLine",
    "orderProduct",
    "OrderProduct",
  ] as const;

  function getOrderLineModel(client: any) {
    for (const name of orderLineModelCandidates) {
      if (client?.[name]?.findFirst) return client[name];
    }
    return null;
  }

  async function hasAnyOrdersForProduct(tx: any, productId: string) {
    const m = getOrderLineModel(tx) || (tx as any).orderItem;
    if (!m?.findFirst) return false;

    const hit = await m.findFirst({
      where: orderItemWhereProductId(productId),
      select: { id: true },
    });
    return !!hit;
  }

  async function hasAnyOrdersForVariant(tx: any, variantId: string) {
    const m = getOrderLineModel(tx) || (tx as any).orderItem;
    if (!m?.findFirst) return false;

    const hit = await m.findFirst({
      where: orderItemWhereVariantId(variantId),
      select: { id: true },
    });
    return !!hit;
  }

  // ---------- helper: load current product attributes in a generic way ----------
  async function getCurrentAttributeState(tx: any, productId: string) {
    // These are common join table names used in your codebase:
    const optModel =
      tx.productAttributeOption ||
      tx.ProductAttributeOption ||
      tx.productAttributeOptions ||
      tx.ProductAttributeOptions;

    const textModel =
      tx.productAttributeText ||
      tx.ProductAttributeText ||
      tx.productAttributeTexts ||
      tx.ProductAttributeTexts;

    const current = {
      // attributeId -> set(valueId)
      multi: new Map<string, Set<string>>(),
      // attributeId -> single valueId (SELECT)
      single: new Map<string, string>(),
      // attributeId -> text
      text: new Map<string, string>(),
    };

    if (optModel?.findMany) {
      const opts = await optModel.findMany({
        where: { productId },
        select: { attributeId: true, valueId: true },
      });

      for (const o of opts || []) {
        const aid = String(o.attributeId);
        const vid = String(o.valueId);
        if (!current.multi.has(aid)) current.multi.set(aid, new Set());
        current.multi.get(aid)!.add(vid);
      }
    }

    if (textModel?.findMany) {
      const texts = await textModel.findMany({
        where: { productId },
        select: { attributeId: true, value: true },
      });

      for (const t of texts || []) {
        const aid = String(t.attributeId);
        const val = String(t.value ?? "").trim();
        if (val) current.text.set(aid, val);
      }
    }

    return current;
  }

  // ---------- helper: parse incoming attributeSelections into maps ----------
  function parseIncomingAttributeSelections(attributeSelections: any[] | undefined | null) {
    const incoming = {
      multi: new Map<string, Set<string>>(),
      single: new Map<string, string>(),
      text: new Map<string, string>(),
    };

    if (!Array.isArray(attributeSelections)) return incoming;

    for (const s of attributeSelections) {
      const aid = String(s?.attributeId ?? s?.attribute?.id ?? "").trim();
      if (!aid) continue;

      // TEXT
      if (s?.text != null && String(s.text).trim() !== "") {
        incoming.text.set(aid, String(s.text).trim());
        continue;
      }

      // SELECT
      if (s?.valueId != null && String(s.valueId).trim() !== "") {
        incoming.single.set(aid, String(s.valueId).trim());
        // also store in multi map for "superset" checks
        if (!incoming.multi.has(aid)) incoming.multi.set(aid, new Set());
        incoming.multi.get(aid)!.add(String(s.valueId).trim());
        continue;
      }

      // MULTISELECT
      if (Array.isArray(s?.valueIds) && s.valueIds.length) {
        if (!incoming.multi.has(aid)) incoming.multi.set(aid, new Set());
        for (const vid of s.valueIds) {
          const v = String(vid ?? "").trim();
          if (v) incoming.multi.get(aid)!.add(v);
        }
      }
    }

    return incoming;
  }

  // ✅ NEW: compare helpers for “only-qty update” detection
  function normString(v: any) {
    return String(v ?? "").trim();
  }

  function normId(v: any) {
    const s = String(v ?? "").trim();
    return s ? s : null;
  }

  function normImages(v: any): string[] {
    // accept array, json string, csv/newline string
    if (!v) return [];
    let arr: any[] = [];
    if (Array.isArray(v)) arr = v;
    else if (typeof v === "string") {
      const s = v.trim();
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) arr = parsed;
        else arr = s.split(/[\n,]/g);
      } catch {
        arr = s.split(/[\n,]/g);
      }
    } else if (typeof v === "object") {
      // if stored as json object accidentally
      const maybe = (v as any)?.urls || (v as any)?.items || (v as any)?.data;
      if (Array.isArray(maybe)) arr = maybe;
    }

    const clean = arr
      .map((x) => (typeof x === "string" ? x : x?.url || x?.path || x?.src))
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);

    // stable unique sort
    return Array.from(new Set(clean)).sort();
  }

  function mapsEqualString(a: Map<string, string>, b: Map<string, string>) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a.entries()) {
      if ((b.get(k) ?? "") !== v) return false;
    }
    return true;
  }

  function mapsEqualSet(a: Map<string, Set<string>>, b: Map<string, Set<string>>) {
    if (a.size !== b.size) return false;
    for (const [k, setA] of a.entries()) {
      const setB = b.get(k);
      if (!setB) return false;
      if (setA.size !== setB.size) return false;
      for (const v of setA) if (!setB.has(v)) return false;
    }
    return true;
  }

  function throw409(msg: string) {
    const e: any = new Error(msg);
    e.statusCode = 409;
    throw e;
  }

  // ✅ NEW helpers
  const clamp0 = (v: any) => Math.max(0, Math.trunc(Number(v ?? 0) || 0));
  const sameQty = (a: any, b: any) => clamp0(a) === clamp0(b);

  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

    const { id } = req.params;

    const incoming: any = req.body ?? {};
    const base: any = incoming?.data ?? incoming?.product ?? incoming;
    const payload = UpdateSchema.parse(base ?? {});

    // ✅ read client hint (but we validate it later before trusting)
    const stockOnlyFlag = payload.stockOnly === true || payload?.meta?.stockOnly === true;

    const product = await prisma.product.findFirst({
      where: { id, isDeleted: false, OR: [{ ownerId: req.user!.id }, { userId: req.user!.id }] },
      // ✅ include more fields so we can detect “actual changes”, not just “field present in payload”
      select: {
        id: true,
        status: true,
        sku: true,
        title: true,
        description: true,
        categoryId: true,
        brandId: true,
        imagesJson: true,
        communicationCost: true,
      } as any,
    });
    if (!product) return res.status(404).json({ error: "Not found" });

    const statusUpper = String(product.status || "").toUpperCase();
    const isLive = !["PENDING", "REJECTED"].includes(statusUpper);

    // ----------------------------
    // Core edits detection
    // ----------------------------

    // “Has core fields in payload” (used for whether we run update/write attrs)
    const hasCoreFieldsInPayload =
      payload.title !== undefined ||
      payload.description !== undefined ||
      payload.sku !== undefined ||
      payload.categoryId !== undefined ||
      payload.brandId !== undefined ||
      payload.imagesJson !== undefined ||
      payload.communicationCost !== undefined ||
      payload.attributeSelections !== undefined;

    // ✅ “Actual change” detection (used for review/pending logic)
    const titleChanged =
      payload.title !== undefined && normString(payload.title) !== normString((product as any).title);
    const skuChanged =
      payload.sku !== undefined && normString(payload.sku) !== normString((product as any).sku);
    const descChanged =
      payload.description !== undefined &&
      normString(payload.description) !== normString((product as any).description);

    const categoryChanged =
      payload.categoryId !== undefined && normId(payload.categoryId) !== normId((product as any).categoryId);

    const brandChanged =
      payload.brandId !== undefined && normId(payload.brandId) !== normId((product as any).brandId);

    const imagesChanged =
      payload.imagesJson !== undefined &&
      JSON.stringify(normImages(payload.imagesJson)) !== JSON.stringify(normImages((product as any).imagesJson));

    const communicationCostChanged =
      payload.communicationCost !== undefined &&
      Number(payload.communicationCost ?? 0) !== Number((product as any).communicationCost ?? 0);

    // attribute change detection (only if attributeSelections provided)
    let attributeSelectionsChanged = false;
    if (payload.attributeSelections !== undefined) {
      const current = await getCurrentAttributeState(prisma as any, id);
      const incomingParsed = parseIncomingAttributeSelections(payload.attributeSelections as any[]);

      attributeSelectionsChanged =
        !mapsEqualString(current.text, incomingParsed.text) || !mapsEqualSet(current.multi, incomingParsed.multi);
    }

    // ✅ this replaces your old “isTryingToEditCore” for review decisions
    const isTryingToEditCore =
      titleChanged ||
      descChanged ||
      skuChanged ||
      categoryChanged ||
      brandChanged ||
      imagesChanged ||
      communicationCostChanged ||
      attributeSelectionsChanged;

    // ----------------------------
    // Variants parsing
    // ----------------------------
    const rawVariantsProvided = Array.isArray(payload.variants);
    const rawSubmittedVariants = (payload.variants ?? []) as any[];

    const baseQtyFromOffer = pickQty(
      payload.offer?.availableQty,
      (payload.offer as any)?.qty,
      (payload.offer as any)?.quantity
    );
    const baseQtyFromTop = pickQty(payload.availableQty, (payload as any)?.qty, (payload as any)?.quantity);

    // ✅ never crash PATCH because of “empty/default” rows
    // ✅ and keep type strictly number (no number|undefined)
    let placeholderQty: number = 0;

    if (typeof baseQtyFromOffer !== "number" && typeof baseQtyFromTop !== "number" && rawVariantsProvided) {
      try {
        placeholderQty = (placeholderVariantsQtyTotal(rawSubmittedVariants) ?? 0) as number;
      } catch {
        placeholderQty = 0;
      }
    }

    const baseQtyCandidate =
      typeof baseQtyFromOffer === "number"
        ? baseQtyFromOffer
        : typeof baseQtyFromTop === "number"
        ? baseQtyFromTop
        : placeholderQty;

    const validSubmittedVariants = rawVariantsProvided
      ? rawSubmittedVariants.filter((v: any) => {
          const direct = String(v?.variantId ?? v?.id ?? "").trim();
          const opts = normalizeOptions(
            v?.options ??
              v?.optionSelections ??
              v?.attributes ??
              v?.attributeSelections ??
              v?.variantOptions ??
              v?.VariantOptions ??
              []
          );
          const bump = asNumber(v?.priceBump) ?? 0;
          return !!direct || opts.length > 0 || bump !== 0;
        })
      : [];

    const isExplicitClearVariants = rawVariantsProvided && rawSubmittedVariants.length === 0;
    const hasValidVariants = rawVariantsProvided && validSubmittedVariants.length > 0;

    // detect new variant combo creation request (important for LIVE review)
    const isCreatingNewVariantCombo =
      rawVariantsProvided &&
      validSubmittedVariants.some((v: any) => {
        const direct = String(v?.variantId ?? v?.id ?? "").trim();
        if (direct) return false;
        const opts = normalizeOptions(
          v?.options ??
            v?.optionSelections ??
            v?.attributes ??
            v?.attributeSelections ??
            v?.variantOptions ??
            v?.VariantOptions ??
            []
        );
        return opts.length > 0;
      });

    const nextInStock =
      payload.offer?.inStock ??
      payload.inStock ??
      (typeof baseQtyCandidate === "number" ? baseQtyCandidate > 0 : undefined);

    const currentBaseOffer = await prisma.supplierProductOffer.findUnique({
      where: { supplierId_productId: { supplierId: s.id, productId: id } },
      select: { basePrice: true, availableQty: true },
    });

    const currentVariantOffers = await prisma.supplierVariantOffer.findMany({
      where: { supplierId: s.id, productId: id },
      select: { variantId: true, priceBump: true, availableQty: true },
    });

    const bumpByVariantId = new Map(
      currentVariantOffers.map((x: { variantId: any; priceBump: any }) => [
        String(x.variantId),
        Number(x.priceBump ?? 0),
      ])
    );

    const qtyByVariantId = new Map(
      currentVariantOffers.map((x: { variantId: any; availableQty: any }) => [
        String(x.variantId),
        clamp0(x.availableQty),
      ])
    );

    const incomingBasePriceRaw = payload.offer?.basePrice ?? payload.price;
    const incomingBasePrice = incomingBasePriceRaw == null ? undefined : Number(incomingBasePriceRaw);

    const basePriceChanged =
      incomingBasePrice !== undefined && incomingBasePrice !== Number(currentBaseOffer?.basePrice ?? 0);

    const bumpChanged =
      Array.isArray(payload.variants) &&
      payload.variants.some((v: any) => {
        const vid = String(v?.variantId ?? v?.id ?? "").trim();
        if (!vid) return false;
        const next = Number(v?.priceBump ?? 0);
        const cur = bumpByVariantId.get(vid) ?? 0;
        return next !== cur;
      });

    const priceChangeRequiresReview = basePriceChanged || bumpChanged;

    // ✅ detect “removal intent” (not a pure qty update)
    const currentOfferVariantIds = new Set<string>(
      (currentVariantOffers as Array<{ variantId: unknown }>).map((x) => String(x.variantId))
    );

    const submittedDirectVariantIds = new Set<string>(
      (validSubmittedVariants as any[])
        .map((v) => String(v?.variantId ?? v?.id ?? "").trim())
        .filter(Boolean)
    );

    // ✅ NEW: detect if variants payload is *only* qty/inStock for existing variants
    const variantsPayloadIsQtyOnly =
      rawVariantsProvided &&
      validSubmittedVariants.every((v: any) => {
        const vid = String(v?.variantId ?? v?.id ?? "").trim();
        if (!vid) return false; // new combo / missing id => not qty-only
        // allow qty/inStock/isActive, but NOT priceBump or options
        const hasOpts = normalizeOptions(
          v?.options ??
            v?.optionSelections ??
            v?.attributes ??
            v?.attributeSelections ??
            v?.variantOptions ??
            v?.VariantOptions ??
            []
        ).length > 0;

        const bump = asNumber(v?.priceBump);
        const bumpTouched = bump != null && Number(bump) !== (bumpByVariantId.get(vid) ?? 0);

        // if options present OR bump changed => not qty-only
        if (hasOpts) return false;
        if (bumpTouched) return false;

        // qty/inStock/isActive ok
        return true;
      });

    // ✅ Only trust stockOnly if the request is truly stock-only.
    const stockOnlyOverride =
      stockOnlyFlag && !isTryingToEditCore && !priceChangeRequiresReview && !isCreatingNewVariantCombo;

    // ✅ CHANGED: removalRequested should NOT trigger when the variants payload is qty-only
    const removalRequested =
      !stockOnlyOverride &&
      rawVariantsProvided &&
      !variantsPayloadIsQtyOnly &&
      (isExplicitClearVariants ||
        (hasValidVariants &&
          Array.from(currentOfferVariantIds).some((vid) => !submittedDirectVariantIds.has(vid))));

    // ✅ STOCK-ONLY intent (structure/price/core unchanged)
    const stockOnlyIntent =
      !isTryingToEditCore && !priceChangeRequiresReview && !isCreatingNewVariantCombo && !removalRequested;

    // ✅ NEW: qty-only intent (actual changes are only qty/inStock flags)
    const baseQtyTouched =
      typeof baseQtyFromOffer === "number" ||
      typeof baseQtyFromTop === "number" ||
      payload.availableQty !== undefined ||
      (payload.offer as any)?.availableQty !== undefined ||
      (payload.offer as any)?.qty !== undefined ||
      (payload.offer as any)?.quantity !== undefined;

    const baseQtyActuallyChanged =
      baseQtyTouched && !sameQty(baseQtyCandidate, currentBaseOffer?.availableQty ?? 0);

    const anyVariantQtyActuallyChanged =
      rawVariantsProvided &&
      validSubmittedVariants.some((v: any) => {
        const vid = String(v?.variantId ?? v?.id ?? "").trim();
        if (!vid) return false;
        const requestedQtyRaw = pickQty(v?.availableQty, v?.qty, v?.quantity);
        if (typeof requestedQtyRaw !== "number") return false;
        const prev = qtyByVariantId.get(vid) ?? 0;
        return clamp0(requestedQtyRaw) !== prev;
      });

    const qtyOnlyIntent =
      stockOnlyIntent &&
      (baseQtyActuallyChanged || anyVariantQtyActuallyChanged) &&
      // if variants provided, ensure they're only touching qty for existing variants
      (!rawVariantsProvided || variantsPayloadIsQtyOnly);

    // ✅ Review trigger rules
    // - LIVE + anything other than qty-only => set product PENDING
    // - BUT: qty-only NEVER sets PENDING
    // - BUT: if client explicitly sends stockOnly (and it's actually stock-only), never set PENDING
    const submitForReview = isLive && !qtyOnlyIntent && !stockOnlyOverride && !stockOnlyIntent;

    // ----- STOCK GUARDS (keep yours) -----
    const prevBase = Number(currentBaseOffer?.availableQty ?? 0);

    if (typeof baseQtyCandidate === "number") {
      const nextBase = clampQty(baseQtyCandidate);
      assertStockUpdateAllowed({
        productStatus: product.status,
        prevQty: prevBase,
        nextQty: nextBase,
        label: "base",
      });
    }

    if (rawVariantsProvided && Array.isArray(validSubmittedVariants) && validSubmittedVariants.length) {
      const prevVariantQtyById = new Map<string, number>();
      for (const ov of currentVariantOffers as any[]) {
        prevVariantQtyById.set(String(ov.variantId), Number(ov.availableQty ?? 0));
      }

      for (const v of validSubmittedVariants as any[]) {
        const variantIdMaybe = String(v?.variantId ?? v?.id ?? "").trim();
        const requestedQtyRaw = pickQty(v?.availableQty, v?.qty, v?.quantity);
        if (typeof requestedQtyRaw !== "number") continue;

        const nextV = clampQty(requestedQtyRaw);
        const prevV = variantIdMaybe ? (prevVariantQtyById.get(variantIdMaybe) ?? 0) : 0;

        assertStockUpdateAllowed({
          productStatus: product.status,
          prevQty: prevV,
          nextQty: nextV,
          label: variantIdMaybe ? `variant:${variantIdMaybe}` : "variant:new",
        });
      }
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Orders guard baseline:
      // If product has ANY orders, we enforce "no removals" even in PENDING/REJECTED.
      const productHasOrders = await hasAnyOrdersForProduct(tx as any, id);

      // ----------------------------
      // CORE UPDATE (allowed always; LIVE => submit for review)
      // ----------------------------
      if (hasCoreFieldsInPayload) {
        // LIVE or ordered product: prevent removing existing attribute selections
        if (payload.attributeSelections) {
          const current = await getCurrentAttributeState(tx as any, id);
          const incomingParsed = parseIncomingAttributeSelections(payload.attributeSelections as any[]);

          if (isLive || productHasOrders) {
            // TEXT: if current had a value, incoming must not clear it
            for (const [aid, curText] of current.text.entries()) {
              const nextText = incomingParsed.text.get(aid);
              if (curText && (!nextText || !String(nextText).trim())) {
                throw409("This product has orders / is LIVE. You can’t clear an existing text attribute.");
              }
            }

            // SELECT/MULTI: incoming must be a superset of current for that attributeId.
            for (const [aid, curSet] of current.multi.entries()) {
              const nextSet = incomingParsed.multi.get(aid) ?? new Set<string>();
              for (const v of curSet) {
                if (!nextSet.has(v)) {
                  throw409(
                    "This product has orders / is LIVE. You can’t remove existing attribute values. You can only add more."
                  );
                }
              }
            }
          }
        }

        const data: Prisma.ProductUpdateInput = {};

        if (payload.title !== undefined) data.title = payload.title;
        if (payload.description !== undefined) data.description = payload.description;
        if (payload.sku !== undefined) data.sku = payload.sku.trim();
        if (payload.categoryId !== undefined) (data as any).categoryId = payload.categoryId;
        if (payload.brandId !== undefined) (data as any).brandId = payload.brandId;
        if (payload.imagesJson !== undefined) (data as any).imagesJson = payload.imagesJson;
        if (payload.communicationCost !== undefined) (data as any).communicationCost = payload.communicationCost;

        // ✅ Submit for review ONLY if needed (qty-only will never set this true now)
        if (submitForReview) (data as any).status = "PENDING";

        await tx.product.update({ where: { id }, data });

        if (payload.attributeSelections) {
          await writeProductAttributes(tx, id, payload.attributeSelections as any);
        }
      } else if (submitForReview) {
        // No core fields changed, but non-stock changes (price/bump/new combo/removal) require review
        await tx.product.update({
          where: { id },
          data: { status: "PENDING" } as any,
        });
      }

      // ----------------------------
      // OFFER UPDATE (stock always allowed; price changes trigger review already above)
      // ----------------------------
      const wantsBaseOfferUpdate =
        payload.offer !== undefined ||
        payload.price !== undefined ||
        payload.inStock !== undefined ||
        typeof baseQtyCandidate === "number" ||
        rawVariantsProvided;

      let baseOffer = await tx.supplierProductOffer.findUnique({
        where: { supplierId_productId: { supplierId: s.id, productId: id } },
        select: {
          id: true,
          currency: true,
          leadDays: true,
          inStock: true,
          isActive: true,
          basePrice: true,
          availableQty: true,
        },
      });

      if (wantsBaseOfferUpdate) {
        const nextAvailableQty =
          typeof baseQtyCandidate === "number" ? clampQty(baseQtyCandidate) : Number(baseOffer?.availableQty ?? 0);

        const createdOrUpdated = await upsertSupplierProductOffer(tx, s.id, id, {
          basePrice: payload.offer?.basePrice ?? payload.price ?? baseOffer?.basePrice ?? 0,
          currency: payload.offer?.currency ?? baseOffer?.currency ?? "NGN",
          inStock: nextInStock ?? baseOffer?.inStock ?? true,
          isActive: payload.offer?.isActive ?? baseOffer?.isActive ?? true,
          leadDays: (payload.offer?.leadDays ?? baseOffer?.leadDays ?? null) as any,
          availableQty: nextAvailableQty,
        });

        baseOffer = {
          id: createdOrUpdated.id,
          currency: createdOrUpdated.currency,
          leadDays: createdOrUpdated.leadDays,
          inStock: createdOrUpdated.inStock,
          isActive: createdOrUpdated.isActive,
          basePrice: createdOrUpdated.basePrice,
          availableQty: createdOrUpdated.availableQty,
        } as any;
      }

      // ----------------------------
      // VARIANT OFFERS
      // ----------------------------
      if (rawVariantsProvided) {
        if (!baseOffer) {
          const bo = await upsertSupplierProductOffer(tx, s.id, id, {
            basePrice: payload.offer?.basePrice ?? payload.price ?? 0,
            currency: payload.offer?.currency ?? "NGN",
            inStock: nextInStock ?? true,
            isActive: payload.offer?.isActive ?? true,
            leadDays: (payload.offer?.leadDays ?? null) as any,
            availableQty: typeof baseQtyCandidate === "number" ? Math.max(0, Math.trunc(baseQtyCandidate)) : 0,
          });
          baseOffer = bo as any;
        }

        // LIVE rule: never delete offers; we disable instead.
        // Orders rule: cannot delete/disable variants that have orders.
        if (isExplicitClearVariants) {
          if (isLive) {
            for (const vid of currentOfferVariantIds) {
              if (await hasAnyOrdersForVariant(tx as any, vid)) {
                throw409("Cannot remove/disable a variant that already has orders. Set qty to 0 instead.");
              }
            }

            await tx.supplierVariantOffer.updateMany({
              where: { supplierId: s.id, productId: id },
              data: { isActive: false, inStock: false, availableQty: 0 } as any,
            });
          } else {
            // not LIVE: allow delete only if none have orders
            for (const vid of currentOfferVariantIds) {
              if (await hasAnyOrdersForVariant(tx as any, vid)) {
                throw409("Cannot delete a variant offer that already has orders.");
              }
            }
            await tx.supplierVariantOffer.deleteMany({ where: { supplierId: s.id, productId: id } });
          }
        } else if (hasValidVariants) {
          const existingVariants = await tx.productVariant.findMany({
            where: { productId: id },
            select: {
              id: true,
              sku: true,
              options: { select: { attributeId: true, valueId: true } },
            } as any,
          });

          const comboToVariantId = new Map<string, string>();
          for (const pv of existingVariants as any[]) {
            const key = comboKey(normalizeOptions(pv.options || []));
            if (!comboToVariantId.has(key)) comboToVariantId.set(key, String(pv.id));
          }

          const makeVariantSku = async () => {
            const baseSku = slugSkuBase(product.title || "item").toUpperCase().slice(0, 30) || "VAR";
            for (let i = 1; i <= 500; i++) {
              const candidate = `${baseSku}-V${i}`;
              const exists = await tx.productVariant.findUnique({
                where: { sku: candidate },
                select: { id: true },
              });
              if (!exists) return candidate;
            }
            return `${baseSku}-${randomSkuSuffix(6)}`;
          };

          const resolveOrCreateVariantId = async (v: any): Promise<string> => {
            const direct = String(v?.variantId ?? v?.id ?? "").trim();
            if (direct) {
              const ok = await tx.productVariant.findFirst({
                where: { id: direct, productId: id },
                select: { id: true },
              });
              if (!ok) throw new Error("Invalid variantId for this product.");
              return direct;
            }

            const opts = normalizeOptions(
              v?.options ??
                v?.optionSelections ??
                v?.attributes ??
                v?.attributeSelections ??
                v?.variantOptions ??
                v?.VariantOptions ??
                []
            );
            const key = comboKey(opts);

            const found = comboToVariantId.get(key);
            if (found) return found;

            for (const o of opts) {
              const [attr, val] = await Promise.all([
                (tx as any).attribute.findUnique({ where: { id: o.attributeId }, select: { id: true } }),
                (tx as any).attributeValue.findUnique({
                  where: { id: o.valueId },
                  select: { id: true, attributeId: true },
                }),
              ]);

              if (!attr) throw new Error(`Invalid attributeId: ${o.attributeId}`);
              if (!val) throw new Error(`Invalid valueId: ${o.valueId}`);
              if (String(val.attributeId) !== String(o.attributeId)) {
                throw new Error("Invalid variant option: value does not belong to attribute.");
              }
            }

            if (opts.length) {
              await tx.productAttributeOption.createMany({
                data: opts.map((o) => ({ productId: id, attributeId: o.attributeId, valueId: o.valueId })),
                skipDuplicates: true,
              });
            }

            const desired = prefixVariantSkuWithProductName(product.title, v?.sku ?? null);
            const sku = desired ?? (await makeVariantSku());

            const qty = pickQty(v?.availableQty, v?.qty, v?.quantity) ?? 0;
            const inStock = v?.inStock ?? qty > 0;

            const created = await tx.productVariant.create({
              data: {
                productId: id,
                sku,
                retailPrice: null,
                inStock,
                imagesJson: [],
                availableQty: qty,
              } as any,
              select: { id: true },
            });

            if (opts.length) {
              await tx.productVariantOption.createMany({
                data: opts.map((o) => ({
                  variantId: created.id,
                  attributeId: o.attributeId,
                  valueId: o.valueId,
                  priceBump: null,
                })),
                skipDuplicates: true,
              });
            }

            comboToVariantId.set(key, created.id);
            return created.id;
          };

          const keepIds = new Set<string>();

          for (const v of validSubmittedVariants) {
            const bump = asNumber(v?.priceBump) ?? 0;

            const variantId = await resolveOrCreateVariantId(v);
            keepIds.add(variantId);

            const vQty = pickQty(v?.availableQty, v?.qty, v?.quantity) ?? 0;
            const vInStock = v?.inStock ?? vQty > 0;
            const vIsActive = v?.isActive ?? true;

            const vQtyNonNeg = clampQty(vQty);
            const bumpNum = Number(bump ?? 0);

            const basePriceNum = Number(baseOffer!.basePrice ?? 0);
            const effectiveTotalPrice = basePriceNum + bumpNum;

            if (
              offerBecomesPurchasable({
                isActive: vIsActive,
                inStock: !!vInStock,
                availableQty: vQtyNonNeg,
                price: effectiveTotalPrice,
              })
            ) {
              await assertSupplierPayoutReadyForPurchasableOfferTx(
                tx as any,
                s.id,
                "Cannot activate variant offer."
              );
            }

            await tx.supplierVariantOffer.upsert({
              where: { supplierId_variantId: { supplierId: s.id, variantId } },
              update: {
                productId: id,
                supplierProductOfferId: baseOffer!.id,
                priceBump: toDecimal(bumpNum),
                currency: baseOffer!.currency ?? "NGN",
                availableQty: vQtyNonNeg,
                inStock: !!vInStock,
                isActive: !!vIsActive,
                leadDays: baseOffer!.leadDays ?? null,
              },
              create: {
                supplierId: s.id,
                productId: id,
                variantId,
                supplierProductOfferId: baseOffer!.id,
                priceBump: toDecimal(bumpNum),
                currency: baseOffer!.currency ?? "NGN",
                availableQty: vQtyNonNeg,
                inStock: !!vInStock,
                isActive: !!vIsActive,
                leadDays: baseOffer!.leadDays ?? null,
              },
            });

            await tx.productVariant.update({
              where: { id: variantId },
              data: { availableQty: vQtyNonNeg as any, inStock: !!vInStock } as any,
            });
          }

          // Handle “removals”:
          // - LIVE: disable (never delete)
          // - Not LIVE: delete only if no orders for those variants
          const toRemove = Array.from(currentOfferVariantIds).filter((vid) => !keepIds.has(vid));

          if (toRemove.length) {
            for (const vid of toRemove) {
              if (await hasAnyOrdersForVariant(tx as any, vid)) {
                throw409("Cannot remove/disable a variant that already has orders. Set qty to 0 instead.");
              }
            }

            if (isLive) {
              await tx.supplierVariantOffer.updateMany({
                where: { supplierId: s.id, productId: id, variantId: { in: toRemove } as any },
                data: { isActive: false, inStock: false, availableQty: 0 } as any,
              });
            } else {
              await tx.supplierVariantOffer.deleteMany({
                where: { supplierId: s.id, productId: id, variantId: { in: toRemove } as any },
              });
            }
          }
        }
      }

      // ----------------------------
      // Recompute product qty and inStock (your existing logic)
      // ----------------------------
      const refreshedBaseOffer = await tx.supplierProductOffer.findUnique({
        where: { supplierId_productId: { supplierId: s.id, productId: id } },
        select: {
          id: true,
          availableQty: true,
          inStock: true,
          currency: true,
          leadDays: true,
          isActive: true,
          basePrice: true,
        },
      });

      const variantSum = await tx.supplierVariantOffer.aggregate({
        where: { supplierId: s.id, productId: id, isActive: true, inStock: true },
        _sum: { availableQty: true },
      });

      const baseQty = Number(refreshedBaseOffer?.availableQty ?? 0);
      const variantQty = Number(variantSum._sum?.availableQty ?? 0);
      const effectiveProductQty = Math.max(0, Math.trunc(baseQty)) + Math.max(0, Math.trunc(variantQty));

      await tx.product.update({
        where: { id },
        data: {
          inStock: payload.offer?.inStock ?? payload.inStock ?? effectiveProductQty > 0,
          availableQty: Math.max(0, Math.trunc(effectiveProductQty)) as any,
        } as any,
      });

      await refreshProductAutoPriceIfAutoMode(tx, id);
    });

    res.json({ ok: true, submitForReview });
  } catch (e: any) {
    const status = Number(e?.statusCode) || 500;
    console.error("[supplier.products PATCH] error:", e);
    res.status(status).json({ error: e?.message || "Internal Server Error" });
  }
});





export default router;
