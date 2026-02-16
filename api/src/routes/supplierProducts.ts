// api/src/routes/supplierProducts.ts
import { Router } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireSupplier } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requiredString } from "../lib/http.js";

const router = Router();

const MAX_IMAGES = 5;

/* ------------------------------ Role helpers ----------------------------- */
const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

type Tx = Prisma.TransactionClient | PrismaClient;

// ✅ accepts Decimal, number, string, null/undefined safely
type Decimalish = Prisma.Decimal | number | string | null | undefined;

const toDecimal = (v: Decimalish) => {
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(String(v ?? 0));
};

type SupplierCtx =
  | {
    ok: true;
    supplierId: string;
    supplier: {
      id: string;
      name?: string | null;
      status?: any;
      userId?: string | null;
    };
    impersonating: boolean;
  }
  | { ok: false; status: number; error: string };

async function resolveSupplierContext(req: any): Promise<SupplierCtx> {
  const role = req.user?.role;
  const userId = req.user?.id;
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };

  // ADMIN/SUPER_ADMIN view-as supplier
  if (isAdmin(role)) {
    const supplierId = String(req.query?.supplierId ?? "").trim();
    if (!supplierId) {
      return {
        ok: false,
        status: 400,
        error: "Missing supplierId query param for admin view",
      };
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true },
    });

    if (!supplier) return { ok: false, status: 404, error: "Supplier not found" };

    return { ok: true, supplierId: supplier.id, supplier, impersonating: true };
  }

  // Supplier normal mode
  if (isSupplier(role)) {
    const supplier = await prisma.supplier.findFirst({
      where: { userId },
      select: { id: true, name: true, status: true, userId: true },
    });
    if (!supplier)
      return {
        ok: false,
        status: 403,
        error: "Supplier profile not found for this user",
      };

    return { ok: true, supplierId: supplier.id, supplier, impersonating: false };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

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
    !!(await (tx as any).productVariant.findUnique({
      where: { sku },
      select: { id: true },
    }));

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

/* ------------------------- Images helper (MAX 5) ------------------------- */
function normalizeImagesJson(input: any): string[] {
  const arr = Array.isArray(input) ? input : [];
  const clean = arr.map((x) => String(x ?? "").trim()).filter(Boolean);

  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const u of clean) {
    if (seen.has(u)) continue;
    seen.add(u);
    uniq.push(u);
    if (uniq.length >= MAX_IMAGES) break;
  }
  return uniq;
}

function assertMaxImages(images: any) {
  const arr = Array.isArray(images) ? images : [];
  if (arr.length > MAX_IMAGES) {
    const e: any = new Error(`Maximum of ${MAX_IMAGES} images allowed.`);
    e.statusCode = 400;
    e.code = "MAX_IMAGES_EXCEEDED";
    e.userMessage = `Please upload or provide at most ${MAX_IMAGES} images.`;
    throw e;
  }
}

/* ------------------------- AUTO pricing helpers ------------------------- */

function payoutReadySupplierWhere() {
  const nonEmpty = { not: "" } as any;

  return {
    isPayoutEnabled: true,
    AND: [
      { accountNumber: { not: null } },
      { accountNumber: nonEmpty },

      { accountName: { not: null } },
      { accountName: nonEmpty },

      { bankCode: { not: null } },
      { bankCode: nonEmpty },

      { bankCountry: { not: null } },
      { bankCountry: nonEmpty },

      { bankVerificationStatus: "VERIFIED" },
    ],
  } as const;
}

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

/* ------------------------- Offer purchasable guard ------------------------ */

function offerBecomesPurchasable(input: {
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number;
  basePrice?: number;
}) {
  const isActive = input.isActive !== false;
  const inStock = input.inStock !== false;
  const qty = Math.max(0, Math.trunc(input.availableQty ?? 0));
  const price = Number(input.basePrice ?? 0);

  return isActive && inStock && qty > 0 && price > 0;
}

async function isSupplierPayoutReadyTx(tx: Tx, supplierId: string): Promise<boolean> {
  if (!supplierId) return false;

  const s = await (tx as any).supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      isPayoutEnabled: true,
      accountNumber: true,
      accountName: true, // keep selected for debugging/logs if you want
      bankCode: true,
      bankCountry: true,
      bankVerificationStatus: true,
      bankVerifiedAt: true, // if your schema has it, this is a helpful fallback
    },
  });

  if (!s) return false;

  const nonEmpty = (v: any) => (typeof v === "string" ? v.trim().length > 0 : !!v);

  const verified =
    String(s.bankVerificationStatus ?? "").toUpperCase() === "VERIFIED" ||
    !!(s as any).bankVerifiedAt;

  // Core requirements for being able to activate purchasable offers
  // - payouts enabled
  // - bank verified
  // - at least the key bank routing fields present
  if (!s.isPayoutEnabled) return false;
  if (!verified) return false;

  if (!nonEmpty(s.accountNumber)) return false;
  if (!nonEmpty(s.bankCode)) return false;

  // bankCountry is often defaulted to "NG" elsewhere; don't block activation on it
  // accountName can be null/blank depending on your Paystack resolution / locking; don't block on it
  return true;
}


async function assertSupplierPayoutReadyForPurchasableOfferTx(tx: Tx, supplierId: string, contextMsg: string) {
  const s = await (tx as any).supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      isPayoutEnabled: true,
      bankVerificationStatus: true,
      bankVerifiedAt: true,
      accountNumber: true,
      bankCode: true,
      bankCountry: true,
      accountName: true,
    },
  });

  const ok = await isSupplierPayoutReadyTx(tx, supplierId);

  if (!ok) {
    const err: any = new Error(
      `${contextMsg} Supplier payout not ready: ${JSON.stringify(
        {
          supplierId,
          isPayoutEnabled: s?.isPayoutEnabled,
          bankVerificationStatus: s?.bankVerificationStatus,
          bankVerifiedAt: s?.bankVerifiedAt,
          hasAccountNumber: !!(s?.accountNumber && String(s.accountNumber).trim()),
          hasBankCode: !!(s?.bankCode && String(s.bankCode).trim()),
          bankCountry: s?.bankCountry ?? null,
          accountName: s?.accountName ?? null,
        },
        null,
        2
      )}`
    );
    err.statusCode = 400;
    err.code = "SUPPLIER_PAYOUT_NOT_READY";
    err.userMessage =
      "Please complete and verify your bank details in Supplier Settings before activating offers with stock.";
    throw err;
  }
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

  const basePriceNum =
    basePrice instanceof Prisma.Decimal ? Number(basePrice) : Number(basePrice ?? 0);

  if (
    offerBecomesPurchasable({
      isActive,
      inStock,
      availableQty: Math.max(0, Math.trunc(availableQty ?? 0)),
      basePrice: basePriceNum,
    })
  ) {
    await assertSupplierPayoutReadyForPurchasableOfferTx(tx as any, supplierId, "Cannot activate base offer.");
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
      unitPrice: null,
    })),
    skipDuplicates: true,
  });

  return created.id;
}

// ------- sku helpers ------
function prefixVariantSkuWithProductName(productTitle: string, rawSku?: string | null) {
  const prefix = slugSkuBase(productTitle).toUpperCase().slice(0, 30) || "PRODUCT";
  const s = String(rawSku ?? "").trim();
  if (!s) return null;

  const clean = s
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .toUpperCase();

  if (!clean) return null;
  if (clean.startsWith(prefix + "-")) return clean;

  return `${prefix}-${clean}`;
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
    unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
    availableQty: z.union([z.number(), z.string()]).optional().nullable(),
    qty: z.union([z.number(), z.string()]).optional().nullable(),
    quantity: z.union([z.number(), z.string()]).optional().nullable(),
    inStock: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sku: z.string().optional().nullable(),
    options: z.any().optional(),
  })
  .passthrough();

const VariantOptionInputSchema = z
  .object({
    attributeId: z.string().optional(),
    valueId: z.string().optional(),

    attributeValueId: z.string().optional(),
    attribute: z.object({ id: z.string().optional() }).optional(),
    value: z
      .object({ id: z.string().optional(), attributeId: z.string().optional() })
      .optional(),
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
    unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
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
  basePrice: z.union([z.number(), z.string()]),
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
        unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
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

const UpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    basePrice: z.union([z.number(), z.string()]).optional(),
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
  })
  .extend({
    stockOnly: z.boolean().optional(),
    meta: z
      .object({
        stockOnly: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  });

/* -------------------- Prisma DMMF helpers (safe orderBy) ----------------- */

function modelHasField(modelName: string, fieldName: string) {
  const m = (Prisma as any).dmmf?.datamodel?.models?.find((x: any) => x.name === modelName);
  return !!m?.fields?.some((f: any) => f.name === fieldName);
}

function supplierOfferOrderBy() {
  // Prefer updatedAt > createdAt > none
  if (modelHasField("SupplierProductOffer", "updatedAt")) return { updatedAt: "desc" as const };
  if (modelHasField("SupplierProductOffer", "createdAt")) return { createdAt: "desc" as const };
  return undefined;
}

/* ------------------------------ Products ------------------------------ */
/**
 * ✅ LIST
 * SupplierProducts table must show:
 *  - products owned/created by supplier
 *  - AND products the supplier has ever offered (base or variant offer)
 *  - de-duped to one row per Product (Prisma findMany already returns unique products)
 */
router.get("/", requireAuth, async (req, res) => {
  const ctx = await resolveSupplierContext(req);
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

  const s = ctx.supplier;

  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "ANY").toUpperCase();
  const take = Math.min(100, Math.max(1, Number(req.query.take) || 50));
  const skip = Math.max(0, Number(req.query.skip) || 0);

  const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 3);

  // ✅ include: owned/created OR ever offered via base OR ever offered via variant
  const ownershipOrOfferOr: any[] = [
    { supplierId: s.id } as any,
    ...(s.userId ? ([{ ownerId: s.userId } as any, { userId: s.userId } as any] as any[]) : []),
    { supplierProductOffers: { some: { supplierId: s.id } } } as any,
    { supplierVariantOffers: { some: { supplierId: s.id } } } as any,
  ];

  const where: Prisma.ProductWhereInput = {
    isDeleted: false,
    OR: ownershipOrOfferOr as any,
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
        availableQty: true,

        // ✅ show supplier's *latest* offer if any (active or inactive)
        supplierProductOffers: {
          where: { supplierId: s.id },
          select: {
            basePrice: true,
            currency: true,
            inStock: true,
            availableQty: true,
            isActive: true,
          },
          ...(supplierOfferOrderBy() ? { orderBy: supplierOfferOrderBy() as any } : {}),
          take: 1,
        },

        supplierId: true,
        ownerId: true as any,
        userId: true as any,
      },
    }),
    prisma.product.count({ where }),
  ]);

  const productIds = items.map((p: any) => String(p.id));

  const variantMin = await prisma.supplierVariantOffer.groupBy({
    by: ["productId"],
    where: {
      supplierId: s.id,
      productId: { in: productIds },
      isActive: true,
      inStock: true,
      availableQty: { gt: 0 },
      unitPrice: { gt: new Prisma.Decimal("0") },
    } as any,
    _min: { unitPrice: true },
  });

  const variantMinByProduct: Record<string, number> = {};
  for (const r of variantMin as any[]) {
    variantMinByProduct[String(r.productId)] = Number(r._min?.unitPrice ?? 0) || 0;
  }

  // ✅ active/in-stock totals (used for row stock display)
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

      const availableQty =
        offerQtyTotal > 0 ? offerQtyTotal : Number(offer?.availableQty ?? p.availableQty ?? 0);

      const inStock =
        offer != null ? availableQty > 0 || offer.inStock === true : Boolean(p.inStock);

      // ✅ derived row: product is included because of offer relationship, not ownership
      const ownedBySupplier =
        String(p.supplierId ?? "") === String(s.id) ||
        (s.userId &&
          (String(p.ownerId ?? "") === String(s.userId) ||
            String(p.userId ?? "") === String(s.userId)));

      const baseOfferPrice =
        offer?.basePrice != null && Number(offer.basePrice) > 0 ? Number(offer.basePrice) : 0;

      const variantFallbackPrice = variantMinByProduct[pid] ?? 0;

      const displayBasePrice = baseOfferPrice > 0 ? baseOfferPrice : variantFallbackPrice;

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

        // ✅ supplier display price: base offer price if present, else min variant unitPrice
        basePrice: displayBasePrice,
        currency: offer?.currency ?? "NGN",
        offerIsActive: offer?.isActive ?? false,

        isLowStock: availableQty <= LOW_STOCK_THRESHOLD,
        isDerived: !ownedBySupplier,
      };
    }),
    total,
    meta: { lowStockThreshold: LOW_STOCK_THRESHOLD },
  });
});

/* ------------------------------- CREATE ---------------------------------- */
router.post("/", requireAuth, requireSupplier, async (req, res) => {
  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

    const payload = CreateSchema.parse(req.body ?? {});

    assertMaxImages(payload.imagesJson);

    let sku = (payload.sku ?? "").trim();
    if (!sku) {
      const base = slugSkuBase(payload.title);
      sku = `${base}-${randomSkuSuffix(4)}`.toUpperCase();
    }

    const attributeSelections = Array.isArray(payload.attributeSelections) ? payload.attributeSelections : [];
    const variants = Array.isArray(payload.variants) ? payload.variants : [];

    // ✅ base qty comes ONLY from base offer/top-level qty fields now
    const baseQtyFromInputs =
      pickQty(
        payload.offer?.availableQty,
        (payload.offer as any)?.qty,
        (payload.offer as any)?.quantity,
        payload.availableQty,
        (payload as any)?.qty,
        (payload as any)?.quantity
      ) ?? 0;

    const qty = Math.max(0, Math.trunc(baseQtyFromInputs));

    const inStock = payload.offer?.inStock ?? payload.inStock ?? qty > 0;

    const created = await prisma.$transaction(async (tx) => {
      const offerBasePrice = payload.offer?.basePrice ?? payload.basePrice;

      const product = await tx.product.create({
        data: {
          title: payload.title,
          description: payload.description ?? "",
          retailPrice: null,
          sku,
          status: "PENDING",
          inStock,
          imagesJson: normalizeImagesJson(payload.imagesJson),

          ownerId: req.user!.id,
          userId: req.user!.id,

          supplierId: s.id,

          categoryId: payload.categoryId ?? null,
          brandId: payload.brandId ?? null,
          availableQty: qty,
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
        availableQty: qty,
      });

      await writeProductAttributes(tx, product.id, attributeSelections as any);

      // ✅ Variant offers use FULL unitPrice (SupplierVariantOffer.unitPrice)
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

          const directId = String(v?.variantId ?? v?.id ?? "").trim();
          if (!directId && !opts.length) {
            // no id, no options => ignore silently (prevents phantom rows)
            continue;
          }

          const vQty = pickQty(v?.availableQty, v?.qty, v?.quantity) ?? 0;
          const vQtyNonNeg = Math.max(0, Math.trunc(vQty));
          const vInStock = v?.inStock ?? vQtyNonNeg > 0;
          const vIsActive = v?.isActive ?? true;

          const unitPriceNum = Number(asNumber(v?.unitPrice) ?? 0);

          // require payout-ready supplier if this variant offer becomes purchasable
          if (
            offerBecomesPurchasable({
              isActive: vIsActive,
              inStock: !!vInStock,
              availableQty: vQtyNonNeg,
              basePrice: unitPriceNum, // ✅ unitPrice
            })
          ) {
            await assertSupplierPayoutReadyForPurchasableOfferTx(tx as any, s.id, "Cannot activate variant offer.");
          }

          let variantId: string | null = null;

          if (directId) {
            variantId = directId;
          } else {
            variantId = await createOrGetVariantByCombo(tx, {
              productId: product.id,
              productSkuBase,
              desiredSku: prefixVariantSkuWithProductName(product.title, v?.sku ?? null),
              options: opts,
              qty: vQtyNonNeg,
              inStock: !!vInStock,
            });
          }

          if (!variantId) continue;

          await tx.supplierVariantOffer.upsert({
            where: { supplierId_variantId: { supplierId: s.id, variantId } },
            update: {
              productId: product.id,
              supplierProductOfferId: baseOffer.id,
              unitPrice: toDecimal(unitPriceNum),
              currency: baseOffer.currency ?? "NGN",
              availableQty: vQtyNonNeg,
              inStock: !!vInStock,
              isActive: !!vIsActive,
              leadDays: baseOffer.leadDays ?? null,
            },
            create: {
              supplierId: s.id,
              productId: product.id,
              variantId,
              supplierProductOfferId: baseOffer.id,
              unitPrice: toDecimal(unitPriceNum),
              currency: baseOffer.currency ?? "NGN",
              availableQty: vQtyNonNeg,
              inStock: !!vInStock,
              isActive: !!vIsActive,
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
      const effectiveQty = qty + variantQty;

      await tx.product.update({
        where: { id: product.id },
        data: {
          availableQty: Math.max(0, Math.trunc(effectiveQty)) as any,
          inStock: effectiveQty > 0,
        } as any,
      });

      await refreshProductAutoPriceIfAutoMode(tx, product.id);

      return tx.product.findUnique({ where: { id: product.id } });
    });

    res.status(201).json({ data: created });
  } catch (e: any) {
    const status = Number(e?.statusCode) || 500;
    console.error("[supplier.products POST] error:", e);
    res.status(status).json({
      error: e?.message || "Internal Server Error",
      code: e?.code,
      userMessage: e?.userMessage,
    });
  }
});

/* ------------------------------ GET /:id ------------------------------ */
router.get("/:id", requireAuth, async (req, res) => {
  const ctx = await resolveSupplierContext(req);
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

  const s = ctx.supplier;
  const id = requiredString(req.params.id);

  // Product relations (names vary per schema, so resolve dynamically)
  const productVariantsRel = "ProductVariant";
  const productBaseOffersRel = "supplierProductOffers";
  const productVariantOffersRel = "supplierVariantOffers";
  const productBrandRel = "brand";

  const variantOptionsRel = "options";
  const variantSupplierOffersRel = "supplierVariantOffers";

  const include: any = {};

  include[productVariantsRel] = {
    where: { isActive: true, archivedAt: null } as any,
    include: {
      [variantOptionsRel]: {
        select: {
          attributeId: true,
          valueId: true,
          attribute: { select: { id: true, name: true, type: true } },
          value: { select: { id: true, name: true, code: true } },
        },
      },
      [variantSupplierOffersRel]: {
        where: { supplierId: s.id },
        select: {
          id: true,
          unitPrice: true,
          availableQty: true,
          inStock: true,
          isActive: true,
          leadDays: true,
          currency: true,
          variantId: true,
        },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  };

  include[productBaseOffersRel] = {
    where: { supplierId: s.id },
    select: {
      id: true,
      basePrice: true,
      currency: true,
      inStock: true,
      isActive: true,
      leadDays: true,
      availableQty: true,
      updatedAt: true,
      createdAt: true,
    },
    ...(supplierOfferOrderBy() ? { orderBy: supplierOfferOrderBy() as any } : {}),
    take: 1,
  };

  include[productBrandRel] = { select: { id: true, name: true } };

  const p = await prisma.product.findFirst({
    where: {
      id,
      isDeleted: false,
      OR: [
        // owned
        { supplierId: s.id } as any,
        ...(s.userId ? ([{ ownerId: s.userId } as any, { userId: s.userId } as any] as any[]) : []),

        // ever offered
        { [productBaseOffersRel]: { some: { supplierId: s.id } } } as any,
        { [productVariantOffersRel]: { some: { supplierId: s.id } } } as any,

        // ✅ allow viewing LIVE catalog products not owned by this supplier
        {
          AND: [{ status: "LIVE" as any }, { OR: [{ supplierId: { not: s.id } }, { supplierId: null }] } as any],
        } as any,
      ],
    },
    include,
  });

  if (!p) return res.status(404).json({ error: "Not found" });

  const myOffer = (p as any)[productBaseOffersRel]?.[0] ?? null;

  const basePrice = myOffer?.basePrice != null ? Number(myOffer.basePrice) : 0;
  const baseQty = myOffer?.availableQty ?? (p as any).availableQty ?? 0;
  const currency = myOffer?.currency ?? "NGN";

  // attribute guide (kept same as your approach)
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

  if (!attributeValues.length) {
    attributeValues = await prisma.productVariantOption.findMany({
      where: { variant: { productId: id } } as any,
      select: { attributeId: true, valueId: true },
      distinct: ["attributeId", "valueId"] as any,
    });
  }

  const attrIds = Array.from(new Set(attributeValues.map((x: any) => String(x.attributeId))));
  const valIds = Array.from(new Set(attributeValues.map((x: any) => String(x.valueId))));

  const [attrs, vals] = await Promise.all([
    attrIds.length
      ? (prisma as any).attribute.findMany({
        where: { id: { in: attrIds } },
        select: { id: true, name: true, type: true, isActive: true },
      })
      : Promise.resolve([]),
    valIds.length
      ? (prisma as any).attributeValue.findMany({
        where: { id: { in: valIds } },
        select: { id: true, name: true, code: true, attributeId: true, isActive: true, position: true },
      })
      : Promise.resolve([]),
  ]);

  const attrById = new Map<string, any>((attrs as any[]).map((a: any) => [String(a.id), a]));

  const valsByAttr = new Map<string, any[]>();
  for (const v of vals as any[]) {
    const aid = String(v.attributeId ?? "");
    if (!aid) continue;
    const list = valsByAttr.get(aid) ?? [];
    list.push(v);
    valsByAttr.set(aid, list);
  }

  const attributeGuide = attrIds.map((attributeId: any) => {
    const a = attrById.get(attributeId);
    const values = (valsByAttr.get(attributeId) ?? [])
      .map((v: any) => ({
        id: String(v.id),
        name: String(v.name ?? ""),
        code: v.code ?? null,
      }))
      .sort((x: any, y: any) => String(x.name).localeCompare(String(y.name)));

    return {
      attributeId,
      attributeName: a?.name ?? attributeId,
      attributeType: a?.type ?? null,
      values,
    };
  });

  const attributeTextGuide = (attributeTexts as any[]).map((t: any) => {
    const a = attrById.get(String(t.attributeId));
    return {
      attributeId: String(t.attributeId),
      attributeName: a?.name ?? String(t.attributeId),
      attributeType: a?.type ?? null,
      value: String(t.value ?? ""),
    };
  });

  const variantsRelData = (p as any)[productVariantsRel] ?? [];
  const variants = Array.isArray(variantsRelData)
    ? variantsRelData.map((v: any) => {
      const vo = v?.[variantSupplierOffersRel]?.[0] ?? null;
      return {
        id: v.id,
        sku: v.sku,
        unitPrice: vo?.unitPrice != null ? Number(vo.unitPrice) : 0,
        availableQty: vo?.availableQty ?? v.availableQty ?? 0,
        inStock: vo?.inStock ?? v.inStock,
        isActive: vo?.isActive ?? true,
        supplierVariantOffer: vo
          ? {
            id: vo.id,
            unitPrice: Number(vo.unitPrice ?? 0),
            availableQty: vo.availableQty ?? 0,
            inStock: vo.inStock ?? true,
            isActive: vo.isActive ?? true,
            leadDays: vo.leadDays ?? null,
            currency: vo.currency ?? "NGN",
          }
          : null,
        options: Array.isArray(v?.[variantOptionsRel])
          ? v[variantOptionsRel].map((o: any) => ({ attributeId: o.attributeId, valueId: o.valueId }))
          : [],
      };
    })
    : [];

  return res.json({
    data: {
      attributeGuide,
      attributeTextGuide,

      attributeValues,
      attributeTexts,

      id: (p as any).id,
      title: (p as any).title,
      description: (p as any).description,
      sku: (p as any).sku,
      status: (p as any).status,
      imagesJson: Array.isArray((p as any).imagesJson) ? (p as any).imagesJson : [],
      categoryId: (p as any).categoryId ?? null,
      brandId: (p as any).brandId ?? null,
      brand: (p as any)[productBrandRel] ?? null,

      basePrice,
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

      variants,
    },
  });
});

/* ------------------------------- PATCH ---------------------------------- */
/**
 * ✅ Full PATCH:
 * - supplier can edit product if owned OR has ever offered (base/variant)
 * - derived products: ONLY offers/variants/stock (no core edits)
 * - variants always use unitPrice
 * - imagesJson max 5
 */
router.patch("/:id", requireAuth, requireSupplier, async (req, res) => {
  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

    const id = requiredString(req.params.id);

    const incoming: any = req.body ?? {};
    const base: any = incoming?.data ?? incoming?.product ?? incoming;
    const payload = UpdateSchema.parse(base ?? {});

    if (payload.imagesJson) assertMaxImages(payload.imagesJson);

    const stockOnlyFlag = payload.stockOnly === true || payload?.meta?.stockOnly === true;

    const product = await prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
        OR: [
          { supplierId: s.id } as any,
          { ownerId: req.user!.id } as any,
          { userId: req.user!.id } as any,
          { supplierProductOffers: { some: { supplierId: s.id } } } as any,
          { supplierVariantOffers: { some: { supplierId: s.id } } } as any,
        ],
      },
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
        supplierId: true,
        ownerId: true as any,
        userId: true as any,
      } as any,
    });

    if (!product) return res.status(404).json({ error: "Not found" });

    const ownedBySupplier =
      String((product as any).supplierId ?? "") === String(s.id) ||
      String((product as any).ownerId ?? "") === String(req.user!.id) ||
      String((product as any).userId ?? "") === String(req.user!.id);

    const statusUpper = String((product as any).status ?? "").toUpperCase();
    const isLiveLocked = statusUpper === "LIVE" || statusUpper === "ACTIVE";

    if (isLiveLocked) {
      const incomingTitle =
        payload.title !== undefined ? String(payload.title ?? "").trim() : undefined;
      const incomingSku =
        payload.sku !== undefined ? String(payload.sku ?? "").trim() : undefined;

      const curTitle = String((product as any).title ?? "").trim();
      const curSku = String((product as any).sku ?? "").trim();

      const titleChanged = incomingTitle !== undefined && incomingTitle !== curTitle;
      const skuChanged = incomingSku !== undefined && incomingSku !== curSku;

      if (titleChanged || skuChanged) {
        return res.status(400).json({
          error: "This product is LIVE. Title and SKU are locked.",
          code: "PRODUCT_LIVE_CORE_LOCKED",
          userMessage: "This product is LIVE. Title and SKU can’t be changed.",
        });
      }
    }


    const triesCoreEdit =
      payload.title !== undefined ||
      payload.description !== undefined ||
      payload.sku !== undefined ||
      payload.categoryId !== undefined ||
      payload.brandId !== undefined ||
      payload.imagesJson !== undefined ||
      payload.communicationCost !== undefined ||
      payload.attributeSelections !== undefined;

    if (!ownedBySupplier && triesCoreEdit) {
      return res.status(403).json({
        error: "Forbidden",
        code: "SUPPLIER_DERIVED_PRODUCT_CORE_EDIT_FORBIDDEN",
        userMessage:
          "You can only edit your offers, variants and stock for this product. Core product details can’t be edited because you do not own the product.",
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Load existing base offer (may be null)
      const existingBaseOffer = await tx.supplierProductOffer.findUnique({
        where: { supplierId_productId: { supplierId: s.id, productId: id } },
        select: { id: true, basePrice: true, currency: true, inStock: true, isActive: true, leadDays: true, availableQty: true },
      });

      // Base offer fields (allow partial)
      const nextBaseQty =
        pickQty(
          payload.offer?.availableQty,
          (payload.offer as any)?.qty,
          (payload.offer as any)?.quantity,
          payload.availableQty,
          (payload as any)?.qty,
          (payload as any)?.quantity
        );

      const nextBasePriceRaw = payload.offer?.basePrice ?? payload.basePrice;
      const nextBasePriceNum = Number(asNumber(nextBasePriceRaw) ?? (existingBaseOffer?.basePrice != null ? Number(existingBaseOffer.basePrice) : 0));
      const nextCurrency = payload.offer?.currency ?? existingBaseOffer?.currency ?? "NGN";
      const nextIsActive = payload.offer?.isActive ?? existingBaseOffer?.isActive ?? true;
      const nextInStock =
        payload.offer?.inStock ??
        existingBaseOffer?.inStock ??
        (nextBaseQty != null ? nextBaseQty > 0 : true);
      const nextLeadDays = (payload.offer?.leadDays ?? existingBaseOffer?.leadDays ?? null) as any;

      // Only upsert base offer if user is actually changing base offer fields OR it already exists
      const touchesBaseOffer =
        payload.offer != null ||
        payload.basePrice != null ||
        payload.availableQty != null ||
        (payload as any).qty != null ||
        (payload as any).quantity != null;

      let baseOffer: any = existingBaseOffer;

      if (touchesBaseOffer) {
        const qty = Math.max(0, Math.trunc(nextBaseQty ?? existingBaseOffer?.availableQty ?? 0));

        if (
          offerBecomesPurchasable({
            isActive: nextIsActive,
            inStock: !!nextInStock,
            availableQty: qty,
            basePrice: nextBasePriceNum,
          })
        ) {
          await assertSupplierPayoutReadyForPurchasableOfferTx(tx as any, s.id, "Cannot activate base offer.");
        }

        baseOffer = await upsertSupplierProductOffer(tx, s.id, id, {
          basePrice: nextBasePriceNum,
          currency: nextCurrency,
          inStock: !!nextInStock,
          isActive: !!nextIsActive,
          leadDays: nextLeadDays,
          availableQty: qty,
        });
      }

      // Core product update (owned only, not stockOnly)
      if (ownedBySupplier && !stockOnlyFlag) {
        const nextImages = payload.imagesJson ? normalizeImagesJson(payload.imagesJson) : undefined;

        await tx.product.update({
          where: { id },
          data: {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.description !== undefined ? { description: payload.description ?? "" } : {}),
            ...(payload.sku !== undefined ? { sku: payload.sku } : {}),
            ...(payload.categoryId !== undefined ? { categoryId: payload.categoryId ?? null } : {}),
            ...(payload.brandId !== undefined ? { brandId: payload.brandId ?? null } : {}),
            ...(payload.communicationCost !== undefined
              ? { communicationCost: payload.communicationCost == null ? null : toDecimal(payload.communicationCost) }
              : {}),
            ...(nextImages !== undefined ? { imagesJson: nextImages } : {}),
          } as any,
        });

        if (payload.attributeSelections !== undefined) {
          await writeProductAttributes(tx, id, payload.attributeSelections as any);
        }
      }

      // Variants / variant offers
      const variants = Array.isArray(payload.variants) ? payload.variants : [];

      if (variants.length) {
        const pRow = await tx.product.findUnique({
          where: { id },
          select: { id: true, sku: true, title: true },
        });

        const productSkuBase = String(pRow?.sku || slugSkuBase(pRow?.title || "product")).toUpperCase();
        for (const v of variants as any[]) {
          const directId = String(v?.variantId ?? v?.id ?? "").trim();

          const opts = normalizeOptions(
            v?.options ??
            v?.optionSelections ??
            v?.attributes ??
            v?.attributeSelections ??
            v?.variantOptions ??
            v?.VariantOptions ??
            []
          );

          // ignore phantom rows
          if (!directId && !opts.length) continue;

          const vQty = pickQty(v?.availableQty, v?.qty, v?.quantity); // may be undefined
          const vQtyProvided = vQty != null;
          const vQtyNonNeg = Math.max(0, Math.trunc(vQty ?? 0));

          const unitPriceProvided =
            v?.unitPrice !== undefined && v?.unitPrice !== null && String(v.unitPrice) !== "";
          const unitPriceNumMaybe = unitPriceProvided ? Number(asNumber(v?.unitPrice) ?? 0) : undefined;

          let variantId: string | null = null;

          if (directId) {
            // ensure variant belongs to this product
            const ok = await tx.productVariant.findFirst({
              where: { id: directId, productId: id },
              select: { id: true },
            });
            if (!ok) {
              const e: any = new Error("Invalid variantId for this product");
              e.statusCode = 400;
              e.code = "INVALID_VARIANT";
              throw e;
            }
            variantId = directId;
          } else {
            // create or get by combo (requires opts)
            variantId = await createOrGetVariantByCombo(tx, {
              productId: id,
              productSkuBase,
              desiredSku: prefixVariantSkuWithProductName(pRow?.title || "PRODUCT", v?.sku ?? null),
              options: opts,
              qty: vQtyNonNeg,
              inStock: v?.inStock ?? (vQtyProvided ? vQtyNonNeg > 0 : true),
            });
          }

          if (!variantId) continue;

          // Load existing offer so we can:
          // - avoid wiping unitPrice to 0 when UI doesn't send it
          // - avoid wiping qty when UI doesn't send it
          // - still enforce payout readiness when stock/active changes make it purchasable
          const existingVarOffer = await tx.supplierVariantOffer.findUnique({
            where: { supplierId_variantId: { supplierId: s.id, variantId } },
            select: { unitPrice: true, availableQty: true, inStock: true, isActive: true },
          });

          const nextUnitPriceNum = unitPriceProvided
            ? (unitPriceNumMaybe ?? 0)
            : existingVarOffer?.unitPrice != null
              ? Number(existingVarOffer.unitPrice)
              : Number(baseOffer?.basePrice ?? 0);

          const nextQty = vQtyProvided ? vQtyNonNeg : Number(existingVarOffer?.availableQty ?? 0);

          const nextActive = (v?.isActive ?? existingVarOffer?.isActive ?? true) as boolean;

          const nextStock = (v?.inStock ??
            (vQtyProvided ? vQtyNonNeg > 0 : existingVarOffer?.inStock ?? true)) as boolean;

          // ✅ enforce payout-ready only when offer becomes purchasable
          if (
            offerBecomesPurchasable({
              isActive: nextActive,
              inStock: nextStock,
              availableQty: nextQty,
              basePrice: nextUnitPriceNum, // ✅ uses existing/base if unitPrice not provided
            })
          ) {
            await assertSupplierPayoutReadyForPurchasableOfferTx(
              tx as any,
              s.id,
              "Cannot activate variant offer."
            );
          }

          // If owned, mirror qty/inStock into ProductVariant too (keeps your variant table consistent)
          if (ownedBySupplier && vQtyProvided) {
            await tx.productVariant.update({
              where: { id: variantId },
              data: { availableQty: vQtyNonNeg, inStock: nextStock } as any,
            });
          }

          await tx.supplierVariantOffer.upsert({
            where: { supplierId_variantId: { supplierId: s.id, variantId } },
            update: {
              productId: id,
              supplierProductOfferId: baseOffer?.id ?? null,

              // ✅ only overwrite unitPrice if explicitly sent
              ...(unitPriceProvided ? { unitPrice: toDecimal(nextUnitPriceNum) } : {}),

              currency: nextCurrency,

              // ✅ only overwrite qty if explicitly sent
              ...(vQtyProvided ? { availableQty: nextQty } : {}),

              inStock: nextStock,
              isActive: nextActive,
              leadDays: nextLeadDays ?? null,
            } as any,
            create: {
              supplierId: s.id,
              productId: id,
              variantId,
              supplierProductOfferId: baseOffer?.id ?? null,

              // ✅ for new offers: default unitPrice to existing/base when not sent
              unitPrice: toDecimal(nextUnitPriceNum),

              currency: nextCurrency,
              availableQty: nextQty,
              inStock: nextStock,
              isActive: nextActive,
              leadDays: nextLeadDays ?? null,
            } as any,
          });
        }

      }

      // If owned: update Product.availableQty/inStock to reflect base+active variant offers (this supplier)
      if (ownedBySupplier) {
        const baseQty =
          (baseOffer?.availableQty ?? existingBaseOffer?.availableQty ?? 0) as number;

        const variantAgg = await tx.supplierVariantOffer.aggregate({
          where: { supplierId: s.id, productId: id, isActive: true },
          _sum: { availableQty: true },
        });

        const variantQty = Number(variantAgg._sum?.availableQty ?? 0);
        const effectiveQty = Math.max(0, Math.trunc(baseQty + variantQty));

        await tx.product.update({
          where: { id },
          data: {
            availableQty: effectiveQty as any,
            inStock: effectiveQty > 0,
          } as any,
        });

        await refreshProductAutoPriceIfAutoMode(tx, id);
      }

      return tx.product.findUnique({ where: { id } });
    });

    return res.json({ data: updated });
  } catch (e: any) {
    const status = Number(e?.statusCode) || 500;
    console.error("[supplier.products PATCH] error:", e);
    res.status(status).json({
      error: e?.message || "Internal Server Error",
      code: e?.code,
      userMessage: e?.userMessage,
    });
  }
});

export default router;
