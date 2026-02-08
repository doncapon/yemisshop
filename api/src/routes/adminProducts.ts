// api/src/routes/adminProducts.ts
import express, { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { requireAdmin, requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";

const router = Router();

/* ------------------------- Schema-introspection (SAFE) ------------------------- */
/**
 * Prisma throws at runtime if you select/include/write fields that don't exist.
 * We only touch fields/relations that exist in your schema.
 */
const PRODUCT_MODEL = Prisma.dmmf.datamodel.models.find((m) => m.name === "Product");
const PRODUCT_FIELDS = new Map((PRODUCT_MODEL?.fields ?? []).map((f) => [f.name, f]));

const getProductField = (name: string) => PRODUCT_FIELDS.get(name) as any | undefined;
const hasProductField = (name: string) => PRODUCT_FIELDS.has(name);

// distinguish scalar FK fields vs relation fields
const hasProductScalarField = (name: string) => {
  const f = getProductField(name);
  return !!f && f.kind === "scalar";
};
const hasProductRelationField = (name: string) => {
  const f = getProductField(name);
  return !!f && f.kind === "object";
};

const SUPPLIER_MODEL = Prisma.dmmf.datamodel.models.find((m) => m.name === "Supplier");
const SUPPLIER_FIELDS = new Map((SUPPLIER_MODEL?.fields ?? []).map((f) => [f.name, f]));

const getSupplierField = (name: string) => SUPPLIER_FIELDS.get(name) as any | undefined;
const hasSupplierField = (name: string) => SUPPLIER_FIELDS.has(name);

const hasSupplierScalarField = (name: string) => {
  const f = getSupplierField(name);
  return !!f && f.kind === "scalar";
};
const hasSupplierRelationField = (name: string) => {
  const f = getSupplierField(name);
  return !!f && f.kind === "object";
};

// detect Product -> Supplier relation field name dynamically (could be "supplier", "Supplier", etc.)
const PRODUCT_SUPPLIER_REL =
  Array.from(PRODUCT_FIELDS.values()).find((f: any) => f.kind === "object" && f.type === "Supplier")?.name ?? null;

// detect Product -> User owner/user/createdBy relation field names
const PRODUCT_USER_RELS = Array.from(PRODUCT_FIELDS.values())
  .filter((f: any) => f.kind === "object" && f.type === "User")
  .map((f: any) => f.name);

const PRODUCT_OWNER_REL =
  PRODUCT_USER_RELS.find((n) => n === "owner") ??
  PRODUCT_USER_RELS.find((n) => n === "user") ??
  PRODUCT_USER_RELS.find((n) => n === "createdBy") ??
  null;

// detect Product -> variants list relation (MUST be ProductVariant; avoid Offer relations)
const PRODUCT_VARIANTS_REL = (() => {
  const fields = Array.from(PRODUCT_FIELDS.values());

  // 1) Strong preference: relation list where type is exactly ProductVariant
  const exact = fields.find((f: any) => f.kind === "object" && f.isList === true && String(f.type) === "ProductVariant");
  if (exact) return exact.name ?? null;

  // 2) Next: name suggests variants AND type suggests variant, but NOT offer/offer-like
  const fallback = fields.find((f: any) => {
    if (!(f.kind === "object" && f.isList === true)) return false;

    const name = String(f.name || "").toLowerCase();
    const type = String(f.type || "").toLowerCase();

    const looksLikeVariantsName = name === "variants" || name.endsWith("variants") || name.includes("productvariants");
    const looksLikeVariantType = type.includes("variant");
    const looksLikeOffer = name.includes("offer") || type.includes("offer");

    return looksLikeVariantsName && looksLikeVariantType && !looksLikeOffer;
  });

  return fallback?.name ?? null;
})();

// detect Product -> supplierOffers list relation (name could differ)
const PRODUCT_SUPPLIER_OFFERS_REL =
  Array.from(PRODUCT_FIELDS.values()).find(
    (f: any) =>
      f.kind === "object" &&
      f.isList === true &&
      (String(f.name).toLowerCase().includes("offer") ||
        String(f.name).toLowerCase().includes("supplieroffer") ||
        String(f.name).toLowerCase().includes("supplier_offers") ||
        String(f.type).toLowerCase().includes("offer"))
  )?.name ?? null;

/* --------------------------- Generic model helpers ---------------------------- */

const MODEL_FIELDS_CACHE = new Map<string, Map<string, any>>();

function getModelFields(modelName: string): Map<string, any> {
  if (!modelName) return new Map();
  if (!MODEL_FIELDS_CACHE.has(modelName)) {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelName);
    MODEL_FIELDS_CACHE.set(modelName, new Map((m?.fields ?? []).map((f) => [f.name, f])));
  }
  return MODEL_FIELDS_CACHE.get(modelName)!;
}

function hasScalar(modelName: string, fieldName: string) {
  const f = getModelFields(modelName).get(fieldName);
  return !!f && f.kind === "scalar";
}
function hasRelation(modelName: string, fieldName: string) {
  const f = getModelFields(modelName).get(fieldName);
  return !!f && f.kind === "object";
}

function findVariantOptionsRel(variantModelName: string): string | null {
  const fields = Array.from(getModelFields(variantModelName).values());
  const rel =
    fields.find((f: any) => f.kind === "object" && f.isList && String(f.type) === "ProductVariantOption") ??
    fields.find((f: any) => f.kind === "object" && f.isList && String(f.name).toLowerCase().includes("option")) ??
    null;
  return rel?.name ?? null;
}

/* --------------------- Product status enum values (SAFE) ---------------------- */

const PRODUCT_STATUS_FIELD = getProductField("status");
const PRODUCT_STATUS_ENUM_NAME = PRODUCT_STATUS_FIELD?.kind === "enum" ? String(PRODUCT_STATUS_FIELD.type) : null;

const PRODUCT_STATUS_VALUES = new Set(
  (Prisma.dmmf.datamodel.enums.find((e) => e.name === PRODUCT_STATUS_ENUM_NAME)?.values ?? []).map((v: any) =>
    String(v.name).toUpperCase()
  )
);

function isValidProductStatus(s: string) {
  // If schema does not expose enum values (edge), do not hard-block.
  return PRODUCT_STATUS_VALUES.size ? PRODUCT_STATUS_VALUES.has(s) : true;
}

/* -------------------------------- Types --------------------------------- */

type Tx = Prisma.TransactionClient | PrismaClient;

type OfferInput = {
  supplierId: string;
  price: number | string; // NGN
  variantId?: string | null;
  inStock?: boolean;
  isActive?: boolean;
  availableQty?: number | string;
  leadDays?: number | string | null;
  currency?: string;
};

type NormalizedVariantOption = {
  attributeId: string;
  valueId: string;
  /** Stored as ProductVariantOption.unitPrice in your schema. No pricing derivation is done from this. */
  unitPrice: number | null;
};

type NormalizedVariant = {
  sku: string | null;
  /** FULL VARIANT PRICE (stands alone) */
  price: number | null;
  inStock: boolean;
  imagesJson: string[];
  options: NormalizedVariantOption[];
};

function isCompleteOption(o: { attributeId?: string | null; valueId?: string | null }): o is NormalizedVariantOption {
  return !!o.attributeId && !!o.valueId;
}

/* ------------------------------ Utilities ------------------------------- */

const toDecimal = (v: any) => new Prisma.Decimal(String(v));

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler =>
    (req, res, next) =>
      Promise.resolve(fn(req, res, next)).catch(next);

/**
 * ✅ supplier id may come as:
 * - supplierId: "..."
 * - supplier: "..."
 * - supplier: { id: "..." }
 * - data: { supplierId: "..." } or data: { supplier: { id } }
 */
function extractSupplierIdFromBody(body: any): string | undefined {
  const raw =
    body?.supplierId ??
    body?.supplier?.id ??
    body?.supplier ??
    body?.data?.supplierId ??
    body?.data?.supplier?.id ??
    body?.data?.supplier;

  const s = typeof raw === "string" ? raw.trim() : "";
  return s ? s : undefined;
}

/**
 * Price display rule:
 * - If priceMode=ADMIN & retailPrice>0 => retailPrice
 * - Else if autoPrice>0 => autoPrice
 * - Else fallback to retailPrice
 */
function computeDisplayPrice(p: any) {
  const mode = String(p?.priceMode ?? "AUTO").toUpperCase();
  const adminPrice = p?.retailPrice != null ? Number(p.retailPrice) : null;
  const autoPrice = p?.autoPrice != null ? Number(p.autoPrice) : null;

  if (mode === "ADMIN" && adminPrice != null && adminPrice > 0) return adminPrice;
  if (autoPrice != null && autoPrice > 0) return autoPrice;

  return adminPrice;
}

function skuSafePart(input: any) {
  const s = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/['"]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s;
}

function buildSkuFromTitle(title: string) {
  const out = skuSafePart(title);
  return out || `PRODUCT-${Date.now()}`;
}

async function ensureUniqueProductSku(tx: any, desired: string, excludeProductId?: string) {
  let base = skuSafePart(desired);
  if (!base) base = `PRODUCT-${Date.now()}`;

  const exists = async (sku: string) => {
    const where: any = { sku };
    if (excludeProductId) where.id = { not: excludeProductId };
    const hit = await tx.product.findFirst({ where, select: { id: true } });
    return !!hit;
  };

  let candidate = base;
  let i = 1;

  while (await exists(candidate)) {
    i += 1;
    candidate = `${base}-${i}`;
    if (i > 2000) throw new Error("Exceeded SKU uniquifier attempts while generating unique product SKU");
  }

  return candidate;
}

/* -------------------- Retail price auto-calc (SAFE) -------------------- */
/**
 * Goal: auto-calc retailPrice if admin didn't provide it.
 *
 * Rule:
 * - If retailPrice provided -> use it
 * - Else if price provided -> use it
 * - Else if variants provided:
 *    - if any variant has explicit price -> retailPrice = MIN(explicit variant price)
 * - Else -> undefined (don’t write retailPrice)
 *
 * IMPORTANT: No derivation from options/unitPrice; no bump logic.
 */
function toMoneyNumber(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** 🔢 5% markup based on supplier offer */
const SUPPLIER_MARKUP = 1.05;
function applySupplierMarkup(n: number | null | undefined): number | null {
  if (n == null) return null;
  const raw = n * SUPPLIER_MARKUP;
  return Math.round(raw * 100) / 100;
}

function computeRetailPriceAuto(reqBody: any, parsedBody: any): number | undefined {
  const explicitRetail = toMoneyNumber(parsedBody?.retailPrice);
  if (explicitRetail !== undefined) return round2(explicitRetail);

  const explicitPrice = toMoneyNumber(parsedBody?.price);
  if (explicitPrice !== undefined) return round2(explicitPrice);

  // Try variants from raw request body (schemas don't include variants in create/update payload)
  const variantsNorm = normalizeVariantsPayload(reqBody);
  if (!variantsNorm.length) return undefined;

  const explicitVariantPrices = variantsNorm
    .map((v) => toMoneyNumber(v?.price))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);

  if (explicitVariantPrices.length) return round2(Math.min(...explicitVariantPrices));

  return undefined;
}

/**
 * Owner resolver:
 * - Prefer relation owner.id
 * - Else relation user.id
 * - Else scalar ownerId/userId if they exist and were selected
 */
function effectiveOwnerId(p: any): string | null {
  const relOwnerId = p?.owner?.id ? String(p.owner.id) : null;
  const relUserId = p?.user?.id ? String(p.user.id) : null;

  const scalarUserId = hasProductScalarField("userId") ? (p?.userId ? String(p.userId) : null) : null;
  const scalarOwnerId = hasProductScalarField("ownerId") ? (p?.ownerId ? String(p.ownerId) : null) : null;

  return relOwnerId ?? relUserId ?? scalarOwnerId ?? scalarUserId ?? null;
}

async function loadUserEmailMap(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return new Map<string, string>();

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true },
  });

  const map = new Map<string, string>();
  for (const u of users) map.set(u.id, u.email ?? "");
  return map;
}

/**
 * SAFE supplier->user lookup (works whether Supplier has userId OR user relation).
 */
async function getSupplierLinkedUserId(supplierId: string): Promise<string | null> {
  const sid = String(supplierId || "").trim();
  if (!sid) return null;

  const select: any = { id: true };

  if (hasSupplierScalarField("userId")) select.userId = true;
  if (hasSupplierRelationField("user")) select.user = { select: { id: true } };

  const s = await (prisma as any).supplier.findUnique({
    where: { id: sid },
    select,
  });

  const uid =
    (hasSupplierScalarField("userId") && s?.userId ? String(s.userId) : null) ?? (s?.user?.id ? String(s.user.id) : null);

  return uid ?? null;
}

/* ------------------------ Variants normalization ------------------------ */
/**
 * NOTE: We keep `unitPrice` only as a stored column on ProductVariantOption (your schema),
 * but we DO NOT treat it as a "bump" or use it to compute prices anywhere.
 */

const OptionLooseSchema = z
  .object({
    attributeId: z.string().optional(),
    valueId: z.string().optional(),
    attribute: z.object({ id: z.string() }).optional(),
    value: z.object({ id: z.string() }).optional(),
    attributeValueId: z.string().optional(),

    unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
  })
  .transform((o) => {
    const raw = o.unitPrice;
    const n = raw === "" || raw == null ? null : Number(raw);
    return {
      attributeId: o.attributeId ?? o.attribute?.id ?? undefined,
      valueId: o.valueId ?? o.attributeValueId ?? o.value?.id ?? undefined,
      unitPrice: Number.isFinite(n as any) ? (n as number) : null,
    };
  });

const VariantLooseSchema = z.object({
  sku: z
    .any()
    .optional()
    .nullable()
    .transform((v) => {
      const s = String(v ?? "").trim();
      return s ? s : null;
    }),

  // ✅ price is the FULL variant price
  price: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().nullable()).optional(),

  inStock: z.coerce.boolean().optional(),
  imagesJson: z.array(z.string()).optional(),
  options: z.array(OptionLooseSchema).default([]),
});

function normalizeVariantsPayload(body: any): NormalizedVariant[] {
  const raw = body?.variants ?? body?.data?.variants ?? (Array.isArray(body) ? body : undefined);
  if (!raw) return [];

  const parsed = z.array(VariantLooseSchema).parse(raw);

  return parsed.map((v) => {
    const options = (v.options || [])
      .map((o) => ({
        attributeId: (o as any).attributeId,
        valueId: (o as any).valueId,
        unitPrice: (o as any).unitPrice ?? null,
      }))
      .filter(isCompleteOption);

    return {
      sku: v.sku ?? null,
      price: v.price ?? null,
      inStock: v.inStock ?? true,
      imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
      options,
    };
  });
}

/* --------------------- Attributes + Variants writer --------------------- */

function variantActiveWhere(variantModelName: string) {
  const where: any = {};
  if (variantModelName && hasScalar(variantModelName, "isActive")) where.isActive = true;
  if (variantModelName && hasScalar(variantModelName, "isDeleted")) where.isDeleted = false;
  return Object.keys(where).length ? where : undefined;
}

async function writeAttributesAndVariants(
  tx: Prisma.TransactionClient,
  productId: string,
  attributeSelections?: Array<{
    attributeId: string;
    valueId?: string;
    valueIds?: string[];
    text?: string;
  }>,
  variants?: NormalizedVariant[]
) {
  if (attributeSelections && attributeSelections.length) {
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
        for (const vId of sel.valueIds) optionRows.push({ productId, attributeId: sel.attributeId, valueId: vId });
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

  const base = await tx.product.findUnique({
    where: { id: productId },
    select: { retailPrice: true },
  });
  const basePrice = base?.retailPrice != null ? Number(base.retailPrice) : 0;

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

    const seen = new Set<string>();

    const existsInDb = async (sku: string) =>
      !!(await (tx as any).productVariant.findUnique({
        where: { sku },
        select: { id: true },
      }));

    for (const v of variants) {
      // generate unique SKU
      let baseSku = (v.sku || "").trim();
      if (!baseSku) baseSku = `${productId}-VAR`;
      let candidate = baseSku.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "").toUpperCase();
      if (!candidate) candidate = `${productId}-VAR`;

      let i = 1;
      while (seen.has(candidate) || (await existsInDb(candidate))) {
        i += 1;
        candidate = `${baseSku}-${i}`.toUpperCase();
        if (i > 1000) throw new Error("Exceeded SKU uniquifier attempts while generating unique variant SKU");
      }
      seen.add(candidate);

      // ✅ NO bump logic: variant price stands alone; fallback to product retailPrice (basePrice) if missing.
      const derived =
        v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : Number.isFinite(basePrice) ? basePrice : 0;

      const created = await tx.productVariant.create({
        data: {
          productId,
          sku: candidate,
          retailPrice: new Prisma.Decimal(String(derived)),
          inStock: v.inStock !== false,
          imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        },
        select: { id: true },
      });

      if (Array.isArray(v.options) && v.options.length) {
        const HAS_UNIT_PRICE = hasScalar("ProductVariantOption", "unitPrice");

        await tx.productVariantOption.createMany({
          data: v.options.map((o) => {
            const unit = o.unitPrice == null ? null : new Prisma.Decimal(String(o.unitPrice));
            return {
              variantId: created.id,
              attributeId: o.attributeId,
              valueId: o.valueId,
              ...(HAS_UNIT_PRICE ? { unitPrice: unit } : {}),
            };
          }),
          skipDuplicates: true,
        });
      }
    }

    // Seed productAttributeOption from variants
    const allOptions = await tx.productVariantOption.findMany({
      where: { variant: { productId } } as any,
      select: { attributeId: true, valueId: true },
      distinct: ["attributeId", "valueId"] as any,
    });

    await tx.productAttributeOption.deleteMany({ where: { productId } });
    if (allOptions.length) {
      await tx.productAttributeOption.createMany({
        data: allOptions.map((o) => ({ productId, attributeId: o.attributeId, valueId: o.valueId })),
        skipDuplicates: true,
      });
    }
  }
}

/* ------------------------------- Zod ------------------------------------ */

const StatusSchema = z.object({
  status: z
    .string()
    .transform((s) => String(s).trim().toUpperCase())
    .refine((s) => isValidProductStatus(s), { message: "Invalid status for Product enum" }),
});

// Accept number or numeric string (e.g. "1200.50")
const MoneyLike = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/)]);

export const CreateProductSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  sku: z.string().trim().optional(),

  price: MoneyLike.optional(),
  retailPrice: MoneyLike.optional(),

  status: z.string().optional(),
  inStock: z.boolean().optional(),
  imagesJson: z.array(z.string()).optional(),

  brandId: z.string().trim().min(1).nullable().optional(),
  categoryId: z.string().trim().min(1).nullable().optional(),

  supplierId: z.string().trim().min(1).nullable().optional(),

  communicationCost: MoneyLike.nullable().optional(),

  attributeSelections: z.array(z.any()).optional(),
});

const emptyToUndef = (v: any) => (v === "" || v == null ? undefined : v);

const NumLikeOptional = z.preprocess(emptyToUndef, z.coerce.number()).optional();
const NumLikeNullable = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().nullable()).optional();

const emptyToNull = (v: any) => (v === "" ? null : v);

const SupplierIdUpdate = z.preprocess(emptyToNull, z.union([z.string().min(1), z.null()])).optional();

const NullableIdUpdate = z.preprocess(emptyToNull, z.string().min(1).nullable()).optional();

const UpdateProductSchema = z
  .object({
    supplierId: SupplierIdUpdate,

    title: z.string().min(1).optional(),
    description: z.string().optional(),

    price: NumLikeOptional,
    retailPrice: NumLikeOptional,

    sku: z.string().optional(),
    status: z.string().optional(), // validated downstream if used
    inStock: z.boolean().optional(),

    categoryId: NullableIdUpdate,
    brandId: NullableIdUpdate,

    imagesJson: z.array(z.string()).optional(),

    communicationCost: NumLikeNullable,

    attributeSelections: z.array(z.any()).optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

router.use(requireAuth);

/* -------------------------------------------------------------------------- */
/* LIST ROUTES                                                                */
/* -------------------------------------------------------------------------- */

function parseTake(v: any, def = 50) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(200, Math.floor(n)));
}
function parseSkip(v: any, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

function parseIncludeParam(q: any): Set<string> {
  const raw = String(q?.include ?? "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function normalizeStatusParam(raw: any): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s || s === "ANY" || s === "ALL") return null;
  return isValidProductStatus(s) ? s : null;
}

/**
 * Your public `products.ts` always returns `variants` and each variant uses:
 * `{ id, sku, price, inStock, imagesJson, availableQty? }`.
 */
function normalizeVariantsForApiResponse(product: any, includeOptions = false) {
  if (!product) return undefined;

  const rawCandidates =
    (Array.isArray(product?.variants) && product.variants) ||
    (Array.isArray(product?.ProductVariant) && product.ProductVariant) ||
    (Array.isArray(product?.productVariants) && product.productVariants) ||
    (PRODUCT_VARIANTS_REL && Array.isArray(product?.[PRODUCT_VARIANTS_REL]) ? product[PRODUCT_VARIANTS_REL] : []) ||
    [];

  const raw: any[] = Array.isArray(rawCandidates) ? rawCandidates : [];

  const pickOptionsArray = (v: any): any[] => {
    const cands = [
      v?.options,
      v?.optionSelections,
      v?.ProductVariantOption,
      v?.ProductVariantOptions,
      v?.productVariantOptions,
      v?.variantOptions,
      v?.VariantOption,
      v?.VariantOptions,
    ];
    for (const c of cands) if (Array.isArray(c) && c.length) return c;
    for (const c of cands) if (Array.isArray(c)) return c;
    return [];
  };

  const toNum = (x: any) => {
    if (x == null) return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };

  const mapped = raw.map((v: any) => {
    const retailPrice = v?.retailPrice ?? v?.price ?? null;

    const out: any = {
      ...v,
      id: String(v?.id ?? v?.variantId ?? v?.variant?.id ?? ""),
      sku: v?.sku ?? null,
      price: retailPrice != null ? Number(retailPrice) : null,
      retailPrice: retailPrice != null ? Number(retailPrice) : null,
      inStock: typeof v?.inStock === "boolean" ? v.inStock : true,
      imagesJson: Array.isArray(v?.imagesJson) ? v.imagesJson : [],
      availableQty: v?.availableQty ?? 0,
    };

    if (includeOptions) {
      const optsRaw = pickOptionsArray(v);
      out.options = (optsRaw || [])
        .map((o: any) => ({
          id: o?.id,
          attributeId: String(o?.attributeId ?? o?.attribute?.id ?? ""),
          valueId: String(o?.valueId ?? o?.attributeValueId ?? o?.value?.id ?? ""),
          unitPrice: toNum(o?.unitPrice),
        }))
        .filter((o: any) => o.attributeId && o.valueId);
    }

    return out;
  });

  product.variants = mapped;
  return mapped;
}

/**
 * Normalize supplier offers list field name into `supplierOffers` (optional)
 * without breaking existing payloads.
 */
function normalizeSupplierOffersForApiResponse(p: any) {
  if (!PRODUCT_SUPPLIER_OFFERS_REL) return undefined;
  const raw = p?.[PRODUCT_SUPPLIER_OFFERS_REL];
  if (!Array.isArray(raw)) return undefined;
  return raw;
}

/* -------------------------------------------------------------------------- */
/* SAFE schema helpers for offer filters                                       */
/* -------------------------------------------------------------------------- */

function modelExists(name: string) {
  return Prisma.dmmf.datamodel.models.some((m) => m.name === name);
}
function delegateName(modelName: string) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}
function getModel(modelName: string) {
  return Prisma.dmmf.datamodel.models.find((m) => m.name === modelName) ?? null;
}
function getModelField(modelName: string, fieldName: string) {
  const m = getModel(modelName);
  return (m?.fields ?? []).find((f: any) => f.name === fieldName) ?? null;
}
function findRelationField(modelName: string, targetType: string) {
  const m = getModel(modelName);
  return (m?.fields ?? []).find((f: any) => f.kind === "object" && f.type === targetType && !f.isList) ?? null;
}
async function safeCount(modelName: string, where: any) {
  const delegate = (prisma as any)[delegateName(modelName)];
  if (!delegate || typeof delegate.count !== "function") return 0;
  try {
    return await delegate.count({ where });
  } catch {
    return 0;
  }
}

/**
 * ✅ Fix for your crash:
 * - For non-nullable Decimal fields, Prisma rejects `{ not: null }`.
 * - For nullable Decimal fields, `{ not: null, gt: 0 }` is fine.
 */
function decimalGtZeroFilter(modelName: string, fieldName: string) {
  const f: any = getModelField(modelName, fieldName);
  if (!f || f.kind !== "scalar") return undefined;

  const gt = new Prisma.Decimal("0");
  // If the field is REQUIRED/non-nullable, do NOT add not:null.
  if (f.isRequired) return { gt };
  // Nullable field: exclude nulls explicitly then gt 0
  return { not: null, gt };
}

function intGtZeroFilter(modelName: string, fieldName: string) {
  const f: any = getModelField(modelName, fieldName);
  if (!f || f.kind !== "scalar") return undefined;
  return { gt: 0 };
}

async function listProductsCore(req: Request, res: Response, forcedStatus?: string | null) {
  const status = forcedStatus ?? normalizeStatusParam((req.query as any)?.status);
  const q = String((req.query as any)?.q ?? "").trim();
  const take = parseTake((req.query as any)?.take, 50);
  const skip = parseSkip((req.query as any)?.skip, 0);
  const includeSet = parseIncludeParam(req.query);

  const where: any = {};

  // soft-delete flags if present
  if (hasProductScalarField("isDeleted")) where.isDeleted = false;
  if (hasProductScalarField("isDelete")) where.isDelete = false;
  if (hasProductScalarField("isArchived")) where.isArchived = false;
  if (hasProductScalarField("isActive")) where.isActive = true;

  if (status) where.status = status;

  if (q) {
    const or: any[] = [];

    // ---------------- product scalars ----------------
    if (hasProductScalarField("title")) or.push({ title: { contains: q, mode: "insensitive" } });
    if (hasProductScalarField("sku")) or.push({ sku: { contains: q, mode: "insensitive" } });
    if (hasProductScalarField("description")) or.push({ description: { contains: q, mode: "insensitive" } });
    if (hasProductScalarField("categoryName")) or.push({ categoryName: { contains: q, mode: "insensitive" } });

    // ---------------- user email relations ----------------
    const addUserEmailRel = (relName: string) => {
      if (!hasProductRelationField(relName)) return;
      const relModel = String(getProductField(relName)?.type ?? "");
      if (!relModel) return;
      if (!hasScalar(relModel, "email")) return;

      or.push({
        [relName]: {
          is: { email: { contains: q, mode: "insensitive" } },
        },
      });
    };

    addUserEmailRel("owner");
    addUserEmailRel("user");
    addUserEmailRel("createdBy");
    addUserEmailRel("updatedBy");

    // ---------------- supplier relation ----------------
    const addSupplierRel = (relName: string) => {
      if (!hasProductRelationField(relName)) return;
      const relModel = String(getProductField(relName)?.type ?? "");
      if (!relModel) return;

      const innerOr: any[] = [];
      if (hasScalar(relModel, "name")) innerOr.push({ name: { contains: q, mode: "insensitive" } });
      if (hasScalar(relModel, "contactEmail")) innerOr.push({ contactEmail: { contains: q, mode: "insensitive" } });
      if (hasScalar(relModel, "whatsappPhone")) innerOr.push({ whatsappPhone: { contains: q, mode: "insensitive" } });

      if (!innerOr.length) return;

      or.push({
        [relName]: {
          is: { OR: innerOr },
        },
      });
    };

    addSupplierRel("supplier");

    // ---------------- brand/category name relations ----------------
    const addNameRel = (relName: string) => {
      if (!hasProductRelationField(relName)) return;
      const relModel = String(getProductField(relName)?.type ?? "");
      if (!relModel) return;
      if (!hasScalar(relModel, "name")) return;

      or.push({
        [relName]: {
          is: { name: { contains: q, mode: "insensitive" } },
        },
      });
    };

    addNameRel("brand");
    addNameRel("category");

    if (or.length) where.OR = or;
  }

  const select: any = {
    id: true,
    ...(hasProductScalarField("title") ? { title: true } : {}),
    ...(hasProductScalarField("status") ? { status: true } : {}),
    ...(hasProductScalarField("inStock") ? { inStock: true } : {}),
    ...(hasProductScalarField("imagesJson") ? { imagesJson: true } : {}),
    ...(hasProductScalarField("retailPrice") ? { retailPrice: true } : {}),
    ...(hasProductScalarField("autoPrice") ? { autoPrice: true } : {}),
    ...(hasProductScalarField("priceMode") ? { priceMode: true } : {}),
    ...(hasProductScalarField("categoryId") ? { categoryId: true } : {}),
    ...(hasProductScalarField("brandId") ? { brandId: true } : {}),
    ...(hasProductScalarField("supplierId") ? { supplierId: true } : {}),
    ...(hasProductScalarField("ownerId") ? { ownerId: true } : {}),
    ...(hasProductScalarField("userId") ? { userId: true } : {}),
    ...(hasProductScalarField("createdAt") ? { createdAt: true } : {}),
    ...(hasProductScalarField("updatedAt") ? { updatedAt: true } : {}),
    ...(hasProductScalarField("isDeleted") ? { isDeleted: true } : {}),
    ...(hasProductScalarField("isDelete") ? { isDelete: true } : {}),
  };

  // include owner/user
  if (includeSet.has("owner") && PRODUCT_OWNER_REL && hasProductRelationField(PRODUCT_OWNER_REL)) {
    select[PRODUCT_OWNER_REL] = { select: { id: true, email: true } };
  }

  // ---- variants (+ options) - schema-safe ----
  let variantModelName = "";
  let optionsRel: string | null = null;

  if (includeSet.has("variants") && PRODUCT_VARIANTS_REL && hasProductRelationField(PRODUCT_VARIANTS_REL)) {
    variantModelName = String(getProductField(PRODUCT_VARIANTS_REL)?.type ?? "");
    optionsRel = variantModelName ? findVariantOptionsRel(variantModelName) : null;

    // fallback: literal "options"
    if (!optionsRel && variantModelName && hasRelation(variantModelName, "options")) optionsRel = "options";

    const variantSelect: any = { id: true };

    if (variantModelName) {
      if (hasScalar(variantModelName, "sku")) variantSelect.sku = true;
      if (hasScalar(variantModelName, "inStock")) variantSelect.inStock = true;
      if (hasScalar(variantModelName, "retailPrice")) variantSelect.retailPrice = true;
      if (hasScalar(variantModelName, "imagesJson")) variantSelect.imagesJson = true;
      if (hasScalar(variantModelName, "availableQty")) variantSelect.availableQty = true;
    }

    // include variant options if relation exists
    if (optionsRel) {
      const optionModelName = variantModelName ? String(getModelField(variantModelName, optionsRel)?.type ?? "") : "";
      const optionSelect: any = { id: true };

      if (optionModelName) {
        if (hasScalar(optionModelName, "attributeId")) optionSelect.attributeId = true;
        if (hasScalar(optionModelName, "valueId")) optionSelect.valueId = true;
        if (!optionSelect.valueId && hasScalar(optionModelName, "attributeValueId")) optionSelect.attributeValueId = true;

        // NOTE: we can still select unitPrice if you want, but it is NOT used for pricing anymore.
        if (hasScalar(optionModelName, "unitPrice")) optionSelect.unitPrice = true;
      } else {
        optionSelect.attributeId = true;
        optionSelect.valueId = true;
        optionSelect.unitPrice = true;
      }

      variantSelect[optionsRel] = {
        select: optionSelect,
        ...(optionSelect.attributeId ? { orderBy: { attributeId: "asc" as const } } : {}),
      };
    }

    const vWhere = variantActiveWhere(variantModelName);

    select[PRODUCT_VARIANTS_REL] = {
      ...(vWhere ? { where: vWhere } : {}),
      select: variantSelect,
      orderBy:
        variantModelName && hasScalar(variantModelName, "createdAt")
          ? ({ createdAt: "asc" } as any)
          : undefined,
    };
  }

  // include supplierOffers (list) - schema-safe (kept)
  if (
    includeSet.has("supplierOffers") &&
    PRODUCT_SUPPLIER_OFFERS_REL &&
    hasProductRelationField(PRODUCT_SUPPLIER_OFFERS_REL)
  ) {
    const offerModelName = String(getProductField(PRODUCT_SUPPLIER_OFFERS_REL)?.type ?? "");
    const offerSelect: any = { id: true };

    if (offerModelName) {
      if (hasScalar(offerModelName, "productId")) offerSelect.productId = true;
      if (hasScalar(offerModelName, "supplierId")) offerSelect.supplierId = true;
      if (hasScalar(offerModelName, "variantId")) offerSelect.variantId = true;
      if (hasScalar(offerModelName, "isActive")) offerSelect.isActive = true;
      if (hasScalar(offerModelName, "inStock")) offerSelect.inStock = true;
      if (hasScalar(offerModelName, "availableQty")) offerSelect.availableQty = true;
      if (hasScalar(offerModelName, "offerPrice")) offerSelect.offerPrice = true;
      if (hasScalar(offerModelName, "unitPrice")) offerSelect.unitPrice = true;
      if (hasScalar(offerModelName, "basePrice")) offerSelect.basePrice = true;
      if (hasScalar(offerModelName, "currency")) offerSelect.currency = true;
    }

    select[PRODUCT_SUPPLIER_OFFERS_REL] = { select: offerSelect };
  }

  const items = await prisma.product.findMany({
    where,
    select,
    orderBy: hasProductScalarField("createdAt") ? ({ createdAt: "desc" } as any) : ({ id: "desc" } as any),
    take,
    skip,
  });

  // ------------------------------
  // ✅ compute cheapest supplier prices (base + per variant)
  // ------------------------------
  const productIds = items.map((p: any) => p?.id).filter(Boolean) as string[];

  // Collect variantIds (only if variants were included)
  const allVariantIds: string[] = [];
  if (includeSet.has("variants")) {
    for (const p of items as any[]) {
      const variantsArr = ((p?.[PRODUCT_VARIANTS_REL as any] ?? p?.variants ?? p?.ProductVariant ?? []) as any[]) || [];
      for (const v of variantsArr) if (v?.id) allVariantIds.push(String(v.id));
    }
  }

  // These models exist in your schema, so we use them as the source of truth
  const [baseOffers, variantOffers] = await Promise.all([
    productIds.length
      ? prisma.supplierProductOffer.findMany({
          where: {
            productId: { in: productIds },

            ...(getModelField("SupplierProductOffer", "isActive") ? { isActive: true } : {}),
            ...(getModelField("SupplierProductOffer", "inStock") ? { inStock: true } : {}),
            ...(getModelField("SupplierProductOffer", "availableQty")
              ? { availableQty: intGtZeroFilter("SupplierProductOffer", "availableQty") }
              : {}),

            // ✅ price must be > 0 (schema-safe; no invalid `not: null` for non-nullable Decimals)
            ...(getModelField("SupplierProductOffer", "basePrice")
              ? { basePrice: decimalGtZeroFilter("SupplierProductOffer", "basePrice") }
              : getModelField("SupplierProductOffer", "offerPrice")
                ? { offerPrice: decimalGtZeroFilter("SupplierProductOffer", "offerPrice") }
                : getModelField("SupplierProductOffer", "price")
                  ? { price: decimalGtZeroFilter("SupplierProductOffer", "price") }
                  : {}),
          } as any,
          select: {
            productId: true,
            supplierId: true,
            ...(getModelField("SupplierProductOffer", "basePrice") ? { basePrice: true } : {}),
            ...(getModelField("SupplierProductOffer", "offerPrice") ? { offerPrice: true } : {}),
            ...(getModelField("SupplierProductOffer", "price") ? { price: true } : {}),
          } as any,
        })
      : Promise.resolve([] as any[]),

    allVariantIds.length
      ? prisma.supplierVariantOffer.findMany({
          where: {
            variantId: { in: allVariantIds },

            ...(getModelField("SupplierVariantOffer", "isActive") ? { isActive: true } : {}),
            ...(getModelField("SupplierVariantOffer", "inStock") ? { inStock: true } : {}),
            ...(getModelField("SupplierVariantOffer", "availableQty")
              ? { availableQty: intGtZeroFilter("SupplierVariantOffer", "availableQty") }
              : {}),

            // ✅ unit price must be > 0 (schema-safe)
            ...(getModelField("SupplierVariantOffer", "unitPrice")
              ? { unitPrice: decimalGtZeroFilter("SupplierVariantOffer", "unitPrice") }
              : getModelField("SupplierVariantOffer", "offerPrice")
                ? { offerPrice: decimalGtZeroFilter("SupplierVariantOffer", "offerPrice") }
                : getModelField("SupplierVariantOffer", "price")
                  ? { price: decimalGtZeroFilter("SupplierVariantOffer", "price") }
                  : {}),
          } as any,
          select: {
            variantId: true,
            productId: true,
            supplierId: true,
            ...(getModelField("SupplierVariantOffer", "unitPrice") ? { unitPrice: true } : {}),
            ...(getModelField("SupplierVariantOffer", "offerPrice") ? { offerPrice: true } : {}),
            ...(getModelField("SupplierVariantOffer", "price") ? { price: true } : {}),
          } as any,
        })
      : Promise.resolve([] as any[]),
  ]);

  const bestBaseByProductId = new Map<string, number>();
  for (const o of baseOffers as any[]) {
    const pid = String(o.productId);

    // pick whichever field exists
    const raw = o.basePrice ?? o.offerPrice ?? o.price;
    const price = Number(raw);

    if (!Number.isFinite(price)) continue;
    const cur = bestBaseByProductId.get(pid);
    if (cur == null || price < cur) bestBaseByProductId.set(pid, price);
  }

  const bestUnitByVariantId = new Map<string, number>();
  for (const o of variantOffers as any[]) {
    const vid = String(o.variantId);

    const raw = o.unitPrice ?? o.offerPrice ?? o.price;
    const price = Number(raw);

    if (!Number.isFinite(price)) continue;
    const cur = bestUnitByVariantId.get(vid);
    if (cur == null || price < cur) bestUnitByVariantId.set(vid, price);
  }

  const ownerIds = items.map(effectiveOwnerId).filter(Boolean) as string[];
  const emailMap = await loadUserEmailMap(ownerIds);

  const mapped = items.map((p: any) => {
    const ownerId = effectiveOwnerId(p);
    const ownerEmail =
      (p?.owner?.email as string | undefined) ||
      (p?.user?.email as string | undefined) ||
      (ownerId ? emailMap.get(ownerId) : null) ||
      null;

    const bestSupplierBasePrice = bestBaseByProductId.get(String(p.id)) ?? null;
    const baseRetailFromSupplier = applySupplierMarkup(bestSupplierBasePrice);

    let retailPrice = p.retailPrice != null ? Number(p.retailPrice) : null;
    const autoPrice = p.autoPrice != null ? Number(p.autoPrice) : null;
    let price = computeDisplayPrice(p);

    // 🔥 Override displayed retail/price with supplier-derived base if available
    if (baseRetailFromSupplier != null) {
      retailPrice = baseRetailFromSupplier;
      price = baseRetailFromSupplier;
    }

    const out: any = {
      ...p,
      retailPrice,
      autoPrice,
      price,
      ownerEmail,

      // cheapest base supplier price for this product
      bestSupplierBasePrice,
      bestSupplierBaseRetail: baseRetailFromSupplier,
    };

    if (includeSet.has("variants")) {
      normalizeVariantsForApiResponse(out, true);

      const variantsArr = (out?.variants ?? out?.[PRODUCT_VARIANTS_REL as any] ?? []) as any[];
      if (Array.isArray(variantsArr)) {
        const prodRetailFallback =
          out.retailPrice != null
            ? Number(out.retailPrice)
            : out.price != null
              ? Number(out.price)
              : null;

        for (const v of variantsArr) {
          const bestUnit = v?.id ? bestUnitByVariantId.get(String(v.id)) ?? null : null;
          const effectiveUnit = bestUnit ?? bestSupplierBasePrice ?? null;
          const variantRetail = applySupplierMarkup(effectiveUnit);

          v.bestSupplierUnitPrice = effectiveUnit;

          // ✅ supplier-derived override
          if (variantRetail != null) {
            v.retailPrice = variantRetail;
            v.price = variantRetail;
            continue;
          }

          // ✅ fallback if supplier-derived is missing AND stored retail is missing/invalid
          const curVarRetail =
            v.retailPrice != null
              ? Number(v.retailPrice)
              : v.price != null
                ? Number(v.price)
                : null;

          const curValid = curVarRetail != null && Number.isFinite(curVarRetail) && curVarRetail > 0;

          if (!curValid && prodRetailFallback != null) {
            v.retailPrice = prodRetailFallback;
            v.price = prodRetailFallback;
          }
        }
      }
    }

    if (includeSet.has("supplierOffers")) {
      const normalizedOffers = normalizeSupplierOffersForApiResponse(out);
      if (normalizedOffers !== undefined) out.supplierOffers = normalizedOffers;
    }

    return out;
  });

  return res.json({ data: mapped });
}

async function computeHasLiveEligibleOffer(productId: string): Promise<boolean> {
  const pid = String(productId || "").trim();
  if (!pid) return false;

  const has2Table = modelExists("SupplierProductOffer") || modelExists("SupplierVariantOffer");

  if (has2Table) {
    let count = 0;

    if (modelExists("SupplierProductOffer")) {
      const where: any = { productId: pid };
      if (getModelField("SupplierProductOffer", "isActive")) where.isActive = true;
      if (getModelField("SupplierProductOffer", "inStock")) where.inStock = true;
      if (getModelField("SupplierProductOffer", "availableQty")) where.availableQty = { gt: 0 };

      if (getModelField("SupplierProductOffer", "basePrice")) {
        where.basePrice = decimalGtZeroFilter("SupplierProductOffer", "basePrice");
      } else if (getModelField("SupplierProductOffer", "offerPrice")) {
        where.offerPrice = decimalGtZeroFilter("SupplierProductOffer", "offerPrice");
      } else if (getModelField("SupplierProductOffer", "price")) {
        where.price = decimalGtZeroFilter("SupplierProductOffer", "price");
      }

      count += await safeCount("SupplierProductOffer", where);
    }

    if (count > 0) return true;

    if (modelExists("SupplierVariantOffer")) {
      const where: any = { productId: pid };
      if (getModelField("SupplierVariantOffer", "isActive")) where.isActive = true;
      if (getModelField("SupplierVariantOffer", "inStock")) where.inStock = true;
      if (getModelField("SupplierVariantOffer", "availableQty")) where.availableQty = { gt: 0 };

      if (getModelField("SupplierVariantOffer", "unitPrice")) {
        where.unitPrice = decimalGtZeroFilter("SupplierVariantOffer", "unitPrice");
      } else if (getModelField("SupplierVariantOffer", "offerPrice")) {
        where.offerPrice = decimalGtZeroFilter("SupplierVariantOffer", "offerPrice");
      } else if (getModelField("SupplierVariantOffer", "price")) {
        where.price = decimalGtZeroFilter("SupplierVariantOffer", "price");
      }

      count += await safeCount("SupplierVariantOffer", where);
    }

    return count > 0;
  }

  if (PRODUCT_SUPPLIER_OFFERS_REL) {
    const offerModelName = String(getProductField(PRODUCT_SUPPLIER_OFFERS_REL)?.type ?? "");
    if (offerModelName && modelExists(offerModelName)) {
      const where: any = { productId: pid };
      if (getModelField(offerModelName, "isActive")) where.isActive = true;
      if (getModelField(offerModelName, "inStock")) where.inStock = true;
      if (getModelField(offerModelName, "availableQty")) where.availableQty = { gt: 0 };

      if (getModelField(offerModelName, "offerPrice")) {
        where.offerPrice = decimalGtZeroFilter(offerModelName, "offerPrice");
      } else if (getModelField(offerModelName, "price")) {
        where.price = decimalGtZeroFilter(offerModelName, "price");
      } else if (getModelField(offerModelName, "unitPrice")) {
        where.unitPrice = decimalGtZeroFilter(offerModelName, "unitPrice");
      }

      const c = await safeCount(offerModelName, where);
      return c > 0;
    }
  }

  return false;
}

// ✅ This is the endpoint your frontend calls:
router.get(
  "/",
  requireAdmin,
  wrap(async (req, res) => listProductsCore(req, res, null))
);

// ✅ This is the endpoint AdminDashboard.tsx calls:
router.get(
  "/published",
  requireAdmin,
  wrap(async (req, res) => listProductsCore(req, res, "PUBLISHED"))
);

/* --------------------- Status / Approve / Reject --------------------- */

router.post(
  "/:id/status",
  requireAdmin,
  wrap(async (req, res) => {
    const { id } = req.params;
    const { status } = StatusSchema.parse(req.body ?? {});

    if (status === "PUBLISHED" || status === "LIVE") {
      const role = (req as any).user?.role;
      if (role !== "SUPER_ADMIN") {
        return res.status(403).json({ error: "Only SUPER_ADMIN can set status to PUBLISHED or LIVE." });
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { status } as any,
      select: {
        id: true,
        title: true,
        status: true,
        retailPrice: true,
        autoPrice: true,
        priceMode: true,
        sku: true,
        inStock: true,
        imagesJson: true,
      },
    });

    res.json({
      data: {
        ...updated,
        retailPrice: updated.retailPrice != null ? Number(updated.retailPrice) : null,
        autoPrice: updated.autoPrice != null ? Number(updated.autoPrice) : null,
        price: computeDisplayPrice(updated),
      },
    });
  })
);

router.post(
  "/:productId/approve",
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { productId } = req.params;

    if (!isValidProductStatus("PUBLISHED")) {
      return res.status(400).json({ error: "Schema does not support PUBLISHED status" });
    }

    const data = await prisma.product.update({
      where: { id: productId },
      data: { status: "PUBLISHED" } as any,
      select: {
        id: true,
        title: true,
        status: true,
        retailPrice: true,
        autoPrice: true,
        priceMode: true,
        imagesJson: true,
        createdAt: true,
      },
    });

    res.json({
      data: {
        ...data,
        retailPrice: data.retailPrice != null ? Number(data.retailPrice) : null,
        autoPrice: data.autoPrice != null ? Number(data.autoPrice) : null,
        price: computeDisplayPrice(data),
      },
    });
  })
);

router.post(
  "/:productId/reject",
  requireAdmin,
  wrap(async (req, res) => {
    const { productId } = req.params;

    if (!isValidProductStatus("REJECTED")) {
      return res.status(400).json({ error: "Schema does not support REJECTED status" });
    }

    const data = await prisma.product.update({
      where: { id: productId },
      data: { status: "REJECTED" } as any,
      select: {
        id: true,
        title: true,
        status: true,
        retailPrice: true,
        autoPrice: true,
        priceMode: true,
        imagesJson: true,
        createdAt: true,
      },
    });

    res.json({
      data: {
        ...data,
        retailPrice: data.retailPrice != null ? Number(data.retailPrice) : null,
        autoPrice: data.autoPrice != null ? Number(data.autoPrice) : null,
        price: computeDisplayPrice(data),
      },
    });
  })
);

/* --------------------- Admin-only routes from here --------------------- */
router.use(requireAdmin);

/* --------------------- Create product (admin) --------------------- */

// ---- PriceMode enum values (SAFE) ----
const PRICE_MODE_FIELD = getProductField("priceMode");
const PRICE_MODE_ENUM_NAME = PRICE_MODE_FIELD?.kind === "enum" ? String(PRICE_MODE_FIELD.type) : null;

const PRICE_MODE_VALUES = new Set(
  (Prisma.dmmf.datamodel.enums.find((e) => e.name === PRICE_MODE_ENUM_NAME)?.values ?? []).map((v: any) => String(v.name))
);

function pickAdminPriceModeValue(): string | null {
  const preferred = ["ADMIN", "MANUAL", "FIXED", "OVERRIDE", "CUSTOM", "RETAIL"];
  for (const p of preferred) if (PRICE_MODE_VALUES.has(p)) return p;

  for (const v of PRICE_MODE_VALUES) {
    if (String(v).toUpperCase() !== "AUTO") return v;
  }
  return null;
}

const hasProductWritableField = (name: string) => {
  const f = getProductField(name);
  return !!f && (f.kind === "scalar" || f.kind === "enum");
};

export const createProductHandler = wrap(async (req, res) => {
  const parsed = CreateProductSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", issues: parsed.error.issues });
  }

  const body = parsed.data;

  const supplierId = extractSupplierIdFromBody(req.body) ?? body.supplierId ?? undefined;

  const autoRetail = computeRetailPriceAuto(req.body, body);
  const nextRetail =
    body.price != null
      ? body.price
      : body.retailPrice != null
        ? body.retailPrice
        : autoRetail !== undefined
          ? autoRetail
          : undefined;

  const created = await prisma.$transaction(async (tx: any) => {
    const adminMode = hasProductWritableField("priceMode") ? pickAdminPriceModeValue() : null;
    const desiredSku = String(body.sku ?? "").trim() ? skuSafePart(body.sku) : buildSkuFromTitle(body.title);

    // ✅ normalize + ensure unique
    const finalSku = await ensureUniqueProductSku(tx, desiredSku);

    const data: any = {
      title: body.title,
      description: body.description,
      sku: finalSku,
      status: body.status ?? "PUBLISHED",
      inStock: body.inStock ?? true,
      imagesJson: body.imagesJson ?? [],

      ...(nextRetail !== undefined ? { retailPrice: toDecimal(nextRetail) } : {}),
      ...(nextRetail !== undefined && adminMode ? { priceMode: adminMode } : {}),

      ...(body.communicationCost !== undefined
        ? { communicationCost: body.communicationCost == null ? null : toDecimal(body.communicationCost) }
        : {}),
      ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
    };

    if (data.status && !isValidProductStatus(String(data.status).toUpperCase())) {
      throw new Error("Invalid status for Product enum");
    }

    if (supplierId) {
      const supExists = await (tx as any).supplier.findUnique({
        where: { id: String(supplierId) },
        select: { id: true },
      });
      if (!supExists) throw new Error("Supplier not found");

      if (hasProductScalarField("supplierId")) data.supplierId = String(supplierId);

      const linkedUserId = await getSupplierLinkedUserId(String(supplierId));
      if (linkedUserId) {
        if (hasProductScalarField("userId")) data.userId = linkedUserId;
        if (hasProductScalarField("ownerId")) data.ownerId = linkedUserId;
      }
    }

    if (nextRetail !== undefined) {
      const adminMode2 = hasProductWritableField("priceMode") ? pickAdminPriceModeValue() : null;
      if (adminMode2) data.priceMode = adminMode2;
      if (hasProductScalarField("autoPrice")) data.autoPrice = null;
    }

    const product = await (tx as any).product.create({
      data,
      select: {
        id: true,
        title: true,
        sku: true,
        status: true,
        inStock: true,
        retailPrice: true,
        autoPrice: true,
        priceMode: true,
        imagesJson: true,
        categoryId: true,
        brandId: true,
        supplierId: true,
        communicationCost: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // ✅ IMPORTANT: compute the product retail numeric fallback ONCE
    const productRetailNum =
      nextRetail !== undefined
        ? Number(nextRetail)
        : product.retailPrice != null
          ? Number(product.retailPrice)
          : 0;

    // ✅ IMPORTANT: default variant.retailPrice if missing/null/undefined
    const variantsWithDefaultRetail = Array.isArray((body as any).variants)
      ? (body as any).variants.map((v: any) => {
          const raw = v?.retailPrice ?? v?.price;
          const n = raw == null ? null : Number(raw);
          const hasValid = n != null && Number.isFinite(n) && n > 0;

          return {
            ...v,
            retailPrice: hasValid ? n : productRetailNum,
          };
        })
      : undefined;

    if (Array.isArray(body.attributeSelections) && body.attributeSelections.length) {
      // ✅ PASS variants into writer AND ensure missing retailPrice is defaulted
      await writeAttributesAndVariants(
        tx as any,
        String(product.id),
        body.attributeSelections as any,
        variantsWithDefaultRetail
      );
    }

    return product;
  });

  return res.json({
    data: {
      ...created,
      retailPrice: created.retailPrice != null ? Number(created.retailPrice) : null,
      autoPrice: created.autoPrice != null ? Number(created.autoPrice) : null,
      communicationCost: (created as any).communicationCost != null ? Number((created as any).communicationCost) : null,
    },
  });
});

router.post("/", createProductHandler);

/* --------------------- Update product (PUT/PATCH) unified --------------------- */

export const updateProductHandler = wrap(async (req, res) => {
  const id = String(req.params.id);

  const parsed = UpdateProductSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", issues: parsed.error.issues });
  }
  const body = parsed.data;

  const supplierIdFromBody = extractSupplierIdFromBody(req.body);
  const supplierId = supplierIdFromBody !== undefined ? supplierIdFromBody : body.supplierId;

  const autoRetail = computeRetailPriceAuto(req.body, body);
  const nextRetail =
    body.price != null ? body.price : body.retailPrice != null ? body.retailPrice : autoRetail !== undefined ? autoRetail : undefined;

  const updated = await prisma.$transaction(async (tx: any) => {
    const data: any = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(nextRetail !== undefined ? { retailPrice: toDecimal(nextRetail) } : {}),
      ...(body.sku !== undefined
        ? String(body.sku ?? "").trim()
          ? { sku: skuSafePart(body.sku) }
          : {}
        : {}),
      ...(body.status !== undefined ? { status: String(body.status).trim().toUpperCase() } : {}),
      ...(body.inStock !== undefined ? { inStock: body.inStock } : {}),
      ...(body.imagesJson !== undefined ? { imagesJson: body.imagesJson } : {}),
      ...(body.communicationCost !== undefined
        ? { communicationCost: body.communicationCost == null ? null : toDecimal(body.communicationCost) }
        : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
    };

    if (nextRetail !== undefined) {
      const adminMode = hasProductWritableField("priceMode") ? pickAdminPriceModeValue() : null;
      if (adminMode) data.priceMode = adminMode;
      if (hasProductWritableField("autoPrice")) data.autoPrice = null;
    }

    if (data.status !== undefined && !isValidProductStatus(String(data.status))) {
      throw new Error("Invalid status for Product enum");
    }

    if (supplierId === null) {
      if (hasProductScalarField("supplierId")) data.supplierId = null;
    } else if (supplierId) {
      const supExists = await (tx as any).supplier.findUnique({
        where: { id: String(supplierId) },
        select: { id: true },
      });
      if (!supExists) throw new Error("Supplier not found");

      if (hasProductScalarField("supplierId")) data.supplierId = String(supplierId);

      const linkedUserId = await getSupplierLinkedUserId(String(supplierId));
      if (linkedUserId) {
        if (hasProductScalarField("userId")) data.userId = linkedUserId;
        if (hasProductScalarField("ownerId")) data.ownerId = linkedUserId;
      }
    }

    // generate SKU if missing and title updated
    if (body.title !== undefined) {
      const current = await tx.product.findUnique({
        where: { id },
        select: { sku: true, title: true },
      });

      const currentSku = String(current?.sku ?? "").trim();
      if (!currentSku) {
        const gen = buildSkuFromTitle(String(body.title ?? current?.title ?? ""));
        const unique = await ensureUniqueProductSku(tx, gen, id);
        data.sku = unique;
      }
    }

    const product = await (tx as any).product.update({
      where: { id },
      data,
      select: {
        id: true,
        title: true,
        status: true,
        sku: true,
        inStock: true,
        retailPrice: true,
        autoPrice: true,
        priceMode: true,
        imagesJson: true,
        categoryId: true,
        brandId: true,
        supplierId: true,
        communicationCost: true,
        updatedAt: true,
      },
    });

    if (Array.isArray(body.attributeSelections)) {
      await writeAttributesAndVariants(tx as any, String(product.id), body.attributeSelections as any, undefined);
    }

    return product;
  });

  return res.json({
    data: {
      ...updated,
      retailPrice: updated.retailPrice != null ? Number(updated.retailPrice) : null,
      autoPrice: updated.autoPrice != null ? Number(updated.autoPrice) : null,
      communicationCost: (updated as any).communicationCost != null ? Number((updated as any).communicationCost) : null,
    },
  });
});

router.put("/:id", updateProductHandler);
router.patch("/:id", updateProductHandler);

/* --------------------- Variants bulk (NO BUMPS) --------------------- */

function normalizeNullableId(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "null" || s === "undefined") return null;
  return s;
}

function toIntSafe(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
}

function toDecimalOrNull(x: any) {
  if (x == null || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return n;
}

function pickAttrId(o: any): string | null {
  return normalizeNullableId(
    o?.attributeId ?? o?.productAttributeId ?? o?.attribute?.id ?? o?.attributeValue?.attributeId ?? o?.value?.attributeId
  );
}

function pickValueId(o: any): string | null {
  return normalizeNullableId(o?.valueId ?? o?.attributeValueId ?? o?.value?.id ?? o?.attributeValue?.id);
}

function normalizeVariantsPayloadForDb(variantsRaw: any[]) {
  const out: Array<{
    id?: string | null;
    sku: string | null;
    inStock: boolean;
    availableQty: number;
    imagesJson: string[];
    retailPrice: any;
    isActive: boolean;
    options: Array<{ attributeId: string; valueId: string; unitPrice: any }>;
  }> = [];

  for (const v of variantsRaw || []) {
    const id = normalizeNullableId(v?.id ?? v?.variantId ?? v?.variant?.id);
    const sku = (v?.sku != null ? String(v.sku).trim() : "") || null;

    const inStock = typeof v?.inStock === "boolean" ? v.inStock : true;
    const availableQty = toIntSafe(v?.availableQty ?? v?.qty ?? v?.stock ?? 0, 0);

    // ✅ retailPrice is FULL variant price now (if provided)
    const retailPrice = toDecimalOrNull(v?.retailPrice ?? v?.price ?? null);

    const imagesJson = Array.isArray(v?.imagesJson) ? v.imagesJson : [];

    const optsRaw =
      (Array.isArray(v?.options) && v.options) ||
      (Array.isArray(v?.optionSelections) && v.optionSelections) ||
      (Array.isArray(v?.attributes) && v.attributes) ||
      (Array.isArray(v?.variantOptions) && v.variantOptions) ||
      [];

    const options = (optsRaw || [])
      .map((o: any) => {
        const attributeId = pickAttrId(o);
        const valueId = pickValueId(o);
        if (!attributeId || !valueId) return null;

        const unitPrice = toDecimalOrNull(o?.unitPrice ?? null);
        return { attributeId, valueId, unitPrice };
      })
      .filter(Boolean) as Array<{ attributeId: string; valueId: string; unitPrice: any }>;

    out.push({
      ...(id ? { id } : {}),
      sku,
      inStock,
      availableQty,
      imagesJson,
      retailPrice,
      isActive: typeof v?.isActive === "boolean" ? v.isActive : true,
      options,
    });
  }

  return out;
}

router.post(
  "/:id/variants/bulk",
  requireAdmin,
  wrap(async (req, res) => {
    const productId = String(req.params.id);

    const variantsRaw = Array.isArray(req.body?.variants) ? req.body.variants : [];
    const replace = req.body?.replace !== false;

    const variants = normalizeVariantsPayloadForDb(variantsRaw);

    const variantModelName = "ProductVariant";
    let optionsRel: string | null = findVariantOptionsRel(variantModelName);
    if (!optionsRel && hasRelation(variantModelName, "options")) optionsRel = "options";

    const OPTION_MODEL = "ProductVariantOption";
    const HAS_UNIT_PRICE = hasScalar(OPTION_MODEL, "unitPrice");

    const comboKey = (opts: Array<{ attributeId: string; valueId: string }>) => {
      const parts = (opts || [])
        .filter((o) => o?.attributeId && o?.valueId)
        .map((o) => `${String(o.attributeId)}::${String(o.valueId)}`)
        .sort();
      return parts.join("||");
    };

    const canSoftDisable = hasScalar(variantModelName, "isActive") || hasScalar(variantModelName, "isDeleted");
    const hasIsActive = hasScalar(variantModelName, "isActive");
    const hasIsDeleted = hasScalar(variantModelName, "isDeleted");

    const result = await prisma.$transaction(async (tx: any) => {
      const include: any = {};
      if (optionsRel) include[optionsRel] = true;

      const existing = await tx.productVariant.findMany({
        where: { productId },
        ...(Object.keys(include).length ? { include } : {}),
        select: Object.keys(include).length ? undefined : { id: true },
      });

      const existingIds = (existing || []).map((v: any) => String(v.id));
      const existingById = new Set(existingIds);

      const baseProduct = await tx.product.findUnique({
        where: { id: productId },
        select: { retailPrice: true },
      });
      const baseRetail = baseProduct?.retailPrice != null ? Number(baseProduct.retailPrice) : 0;

      const existingByCombo = new Map<string, string>();
      for (const ev of existing || []) {
        const opts = (optionsRel && ev?.[optionsRel]) || ev?.options || ev?.ProductVariantOptions || ev?.ProductVariantOption || [];
        const k = comboKey(Array.isArray(opts) ? opts : []);
        if (k && !existingByCombo.has(k)) existingByCombo.set(k, String(ev.id));
      }

      // Locked IDs (supplier variant offers)
      let lockedIds = new Set<string>();
      if (modelExists("SupplierVariantOffer") && existingIds.length) {
        const lockedRows = await tx.supplierVariantOffer.findMany({
          where: { productId, variantId: { in: existingIds } },
          select: { variantId: true },
        });
        lockedIds = new Set(lockedRows.map((r: any) => String(r.variantId)).filter(Boolean));
      }

      const keptIds = new Set<string>();

      // Upsert incoming variants (match by id OR combo)
      for (const v of variants as any[]) {
        const incomingId = normalizeNullableId(v?.id);
        const k = comboKey(v?.options || []);
        const matchedId = incomingId && existingById.has(incomingId) ? incomingId : k ? existingByCombo.get(k) : null;

        // ✅ NO bump logic: if retailPrice not provided, fallback to product base retailPrice (baseRetail).
        const finalRetail = v.retailPrice != null ? Number(v.retailPrice) : baseRetail;

        const data: any = {
          productId,
          sku: v.sku ?? null,
          inStock: v.inStock ?? true,
          availableQty: v.availableQty ?? 0,
          imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
          retailPrice: Number.isFinite(finalRetail) ? finalRetail : null,
          ...(hasIsActive ? { isActive: v.isActive ?? true } : {}),
          ...(hasIsDeleted ? { isDeleted: false } : {}),
        };

        if (matchedId) {
          keptIds.add(matchedId);

          await tx.productVariant.update({
            where: { id: matchedId },
            data,
          });

          await tx.productVariantOption.deleteMany({ where: { variantId: matchedId } });

          if (Array.isArray(v.options) && v.options.length) {
            await tx.productVariantOption.createMany({
              data: v.options.map((o: any) => {
                const unit = o?.unitPrice ?? null;
                return {
                  variantId: matchedId,
                  attributeId: o.attributeId,
                  valueId: o.valueId,
                  ...(HAS_UNIT_PRICE ? { unitPrice: unit } : {}),
                };
              }),
              skipDuplicates: true,
            });
          }

          continue;
        }

        const created = await tx.productVariant.create({ data });
        keptIds.add(String(created.id));

        if (Array.isArray(v.options) && v.options.length) {
          await tx.productVariantOption.createMany({
            data: v.options.map((o: any) => {
              const unit = o?.unitPrice ?? null;
              return {
                variantId: created.id,
                attributeId: o.attributeId,
                valueId: o.valueId,
                ...(HAS_UNIT_PRICE ? { unitPrice: unit } : {}),
              };
            }),
            skipDuplicates: true,
          });
        }
      }

      // Replace mode: remove anything not kept (never hard-delete locked)
      if (replace && existingIds.length) {
        const removedIds = existingIds.filter((id: string) => !keptIds.has(id));

        for (const id of removedIds) {
          if (lockedIds.has(id)) {
            if (canSoftDisable) {
              const softData: any = {};
              if (hasIsActive) softData.isActive = false;
              if (hasIsDeleted) softData.isDeleted = true;
              await tx.productVariant.update({ where: { id }, data: softData });
            }
            continue;
          }

          if (canSoftDisable) {
            const softData: any = {};
            if (hasIsActive) softData.isActive = false;
            if (hasIsDeleted) softData.isDeleted = true;
            await tx.productVariant.update({ where: { id }, data: softData });
          } else {
            await tx.productVariantOption.deleteMany({ where: { variantId: id } });
            await tx.productVariant.delete({ where: { id } });
          }
        }
      }

      // Return fresh list WITH options, but EXCLUDE inactive/deleted
      const include2: any = {};
      if (optionsRel) include2[optionsRel] = true;

      const whereFresh: any = { productId };
      if (hasIsActive) whereFresh.isActive = true;
      if (hasIsDeleted) whereFresh.isDeleted = false;

      const fresh = await tx.productVariant.findMany({
        where: whereFresh,
        orderBy: hasScalar(variantModelName, "createdAt") ? ({ createdAt: "asc" } as any) : ({ id: "asc" } as any),
        ...(Object.keys(include2).length ? { include: include2 } : {}),
      });

      return (fresh || []).map((row: any) => {
        const opts = (optionsRel && row?.[optionsRel]) || row?.options || row?.ProductVariantOptions || row?.ProductVariantOption || [];
        return { ...row, options: Array.isArray(opts) ? opts : [] };
      });
    });

    return res.json({ data: result });
  })
);

/* -------------------------------------------------------------------------- */
/* Go-live / Publish helper                                                    */
/* -------------------------------------------------------------------------- */

router.post(
  "/:id/go-live",
  requireSuperAdmin,
  wrap(async (req, res) => {
    const id = String(req.params.id);

    const mustHaveOffer = String((req.query as any)?.requireOffer ?? "1") !== "0";
    if (mustHaveOffer) {
      const ok = await computeHasLiveEligibleOffer(id);
      if (!ok) return res.status(400).json({ error: "Cannot go-live: no active in-stock offer with price/qty found." });
    }

    const nextStatus = isValidProductStatus("PUBLISHED") ? "PUBLISHED" : isValidProductStatus("LIVE") ? "LIVE" : null;
    if (!nextStatus) return res.status(400).json({ error: "Schema does not support PUBLISHED/LIVE status" });

    const updated = await prisma.product.update({
      where: { id },
      data: { status: nextStatus } as any,
      select: { id: true, status: true, retailPrice: true, autoPrice: true, priceMode: true, title: true },
    });

    return res.json({
      data: {
        ...updated,
        retailPrice: updated.retailPrice != null ? Number(updated.retailPrice) : null,
        autoPrice: updated.autoPrice != null ? Number(updated.autoPrice) : null,
        price: computeDisplayPrice(updated),
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Delete product                                                              */
/* -------------------------------------------------------------------------- */

router.delete(
  "/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const id = String(req.params.id);

    const canSoft = hasProductScalarField("isDeleted") || hasProductScalarField("isDelete");

    let hasOrders = false;
    if (modelExists("OrderItem")) {
      const c = await safeCount("OrderItem", { productId: id });
      hasOrders = c > 0;
    }

    if (canSoft || hasOrders) {
      const data: any = {};
      if (hasProductScalarField("isDeleted")) data.isDeleted = true;
      if (hasProductScalarField("isDelete")) data.isDelete = true;
      if (hasProductScalarField("deletedAt")) data.deletedAt = new Date();
      if (hasProductScalarField("status") && isValidProductStatus("DISABLED")) data.status = "DISABLED";

      const updated = await prisma.product.update({
        where: { id },
        data,
        select: { id: true, isDeleted: hasProductScalarField("isDeleted") ? true : undefined, status: true },
      });

      return res.json({ data: { ...updated, softDeleted: true, hasOrders } });
    }

    await prisma.product.delete({ where: { id } });
    return res.json({ data: { id, deleted: true, softDeleted: false, hasOrders: false } });
  })
);

/* --------------------- GET single product (admin) --------------------- */

router.get(
  "/:id/has-orders",
  requireAdmin,
  wrap(async (req, res) => {
    const productId = String(req.params.id);

    let total = 0;

    if (modelExists("OrderItem")) {
      const hasProductId = !!getModelField("OrderItem", "productId");
      if (hasProductId) total += await safeCount("OrderItem", { productId });
      else {
        const rel = findRelationField("OrderItem", "Product");
        if (rel) total += await safeCount("OrderItem", { [rel.name]: { is: { id: productId } } });
      }

      const variantRel = findRelationField("OrderItem", "ProductVariant");
      const variantHasProductId = !!getModelField("ProductVariant", "productId");
      if (variantRel && variantHasProductId) total += await safeCount("OrderItem", { [variantRel.name]: { is: { productId } } });
    }

    for (const m of Prisma.dmmf.datamodel.models) {
      const name = m.name;
      const looksLikeOrderLine = /order/i.test(name) && /(item|line|product)/i.test(name) && name !== "OrderItem";
      if (!looksLikeOrderLine) continue;

      const hasProductId = !!getModelField(name, "productId");
      if (hasProductId) {
        total += await safeCount(name, { productId });
        continue;
      }

      const rel = findRelationField(name, "Product");
      if (rel) {
        total += await safeCount(name, { [rel.name]: { is: { id: productId } } });
        continue;
      }

      const vRel = findRelationField(name, "ProductVariant");
      const variantHasProductId = !!getModelField("ProductVariant", "productId");
      if (vRel && variantHasProductId) {
        total += await safeCount(name, { [vRel.name]: { is: { productId } } });
        continue;
      }
    }

    return res.json({
      data: { productId, hasOrders: total > 0, orderLineCount: total },
    });
  })
);

function getRelArray(obj: any, rel: string | null): any[] | null {
  if (!rel) return null;
  const v = obj?.[rel];
  return Array.isArray(v) ? v : null;
}

router.get(
  "/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const includeSet = parseIncludeParam(req.query);

    const select: any = {
      id: true,
      ...(hasProductScalarField("sku") ? { sku: true } : {}),
      ...(hasProductScalarField("title") ? { title: true } : {}),
      ...(hasProductScalarField("description") ? { description: true } : {}),
      ...(hasProductScalarField("status") ? { status: true } : {}),
      ...(hasProductScalarField("inStock") ? { inStock: true } : {}),
      ...(hasProductScalarField("imagesJson") ? { imagesJson: true } : {}),
      ...(hasProductScalarField("retailPrice") ? { retailPrice: true } : {}),
      ...(hasProductScalarField("autoPrice") ? { autoPrice: true } : {}),
      ...(hasProductScalarField("priceMode") ? { priceMode: true } : {}),
      ...(hasProductScalarField("categoryId") ? { categoryId: true } : {}),
      ...(hasProductScalarField("brandId") ? { brandId: true } : {}),
      ...(hasProductScalarField("supplierId") ? { supplierId: true } : {}),
      ...(hasProductScalarField("ownerId") ? { ownerId: true } : {}),
      ...(hasProductScalarField("userId") ? { userId: true } : {}),
      ...(hasProductScalarField("communicationCost") ? { communicationCost: true } : {}),
    };

    if (includeSet.has("owner") && PRODUCT_OWNER_REL && hasProductRelationField(PRODUCT_OWNER_REL)) {
      select[PRODUCT_OWNER_REL] = { select: { id: true, email: true } };
    }

    if (includeSet.has("supplier") && PRODUCT_SUPPLIER_REL && hasProductRelationField(PRODUCT_SUPPLIER_REL)) {
      select[PRODUCT_SUPPLIER_REL] = { select: { id: true, name: true } };
    }

    // variants + options (editor needs this)
    let variantModelName = "";
    let optionsRel: string | null = null;

    if (includeSet.has("variants") && PRODUCT_VARIANTS_REL && hasProductRelationField(PRODUCT_VARIANTS_REL)) {
      variantModelName = String(getProductField(PRODUCT_VARIANTS_REL)?.type ?? "");
      optionsRel = variantModelName ? findVariantOptionsRel(variantModelName) : null;
      if (!optionsRel && variantModelName && hasRelation(variantModelName, "options")) optionsRel = "options";

      const variantSelect: any = { id: true };

      if (variantModelName) {
        if (hasScalar(variantModelName, "sku")) variantSelect.sku = true;
        if (hasScalar(variantModelName, "inStock")) variantSelect.inStock = true;
        if (hasScalar(variantModelName, "retailPrice")) variantSelect.retailPrice = true;
        if (hasScalar(variantModelName, "imagesJson")) variantSelect.imagesJson = true;
        if (hasScalar(variantModelName, "availableQty")) variantSelect.availableQty = true;

        if (hasScalar(variantModelName, "isActive")) variantSelect.isActive = true;
        if (hasScalar(variantModelName, "isDeleted")) variantSelect.isDeleted = true;
        if (hasScalar(variantModelName, "isDelete")) variantSelect.isDelete = true;
        if (hasScalar(variantModelName, "isArchived")) variantSelect.isArchived = true;
      }

      if (optionsRel) {
        // NOTE: ProductVariantOption.unitPrice is NOT supplier offer pricing.
        // Keeping it because your editor expects it, but it should NOT be used for supplier unit prices.
        variantSelect[optionsRel] = {
          select: {
            id: true,
            attributeId: true,
            valueId: true,
            ...(hasScalar("ProductVariantOption", "unitPrice") ? { unitPrice: true } : {}),
          },
          orderBy: { attributeId: "asc" as const },
        };
      }

      const variantWhere: any = {};
      if (variantModelName) {
        if (hasScalar(variantModelName, "isActive")) variantWhere.isActive = true;
        if (hasScalar(variantModelName, "isDeleted")) variantWhere.isDeleted = false;
        if (hasScalar(variantModelName, "isDelete")) variantWhere.isDelete = false;
        if (hasScalar(variantModelName, "isArchived")) variantWhere.isArchived = false;
      }

      select[PRODUCT_VARIANTS_REL] = {
        ...(Object.keys(variantWhere).length ? { where: variantWhere } : {}),
        select: variantSelect,
        orderBy: variantModelName && hasScalar(variantModelName, "createdAt") ? ({ createdAt: "asc" } as any) : undefined,
      };
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select,
    });

    if (!product) return res.status(404).json({ error: "Product not found" });

    // attributes (editor needs this when include=attributes)
    let attributes: any = null;
    if (includeSet.has("attributes")) {
      const [opts, texts] = await Promise.all([
        prisma.productAttributeOption.findMany({
          where: { productId: id },
          include: {
            attribute: { select: { id: true, name: true, type: true } },
            value: { select: { id: true, name: true, code: true } },
          },
          orderBy: [{ attributeId: "asc" }, { valueId: "asc" }],
        }),
        prisma.productAttributeText.findMany({
          where: { productId: id },
          include: {
            attribute: { select: { id: true, name: true, type: true } },
          },
          orderBy: [{ attributeId: "asc" }],
        }),
      ]);

      attributes = { options: opts, texts };
    }

    const out: any = {
      ...product,
      attributes,
      retailPrice: (product as any).retailPrice != null ? Number((product as any).retailPrice) : null,
      autoPrice: (product as any).autoPrice != null ? Number((product as any).autoPrice) : null,
      communicationCost: (product as any).communicationCost != null ? Number((product as any).communicationCost) : null,
      price: computeDisplayPrice(product),
    };

    // normalize variants (your existing helper)
    if (includeSet.has("variants")) {
      const normalized = normalizeVariantsForApiResponse(out, true);
      if (normalized !== undefined) out.variants = normalized;
    }

    /**
     * ✅ Attach best supplier base/unit prices + derived retails
     * - base retail = cheapest basePrice * 1.05
     * - variant retail = cheapest unitPrice for that variant * 1.05 (fallback to base)
     */
    {
      // gather variant ids from normalized output if available, else from raw relation
      const relVariants = getRelArray(out as any, PRODUCT_VARIANTS_REL);

      const rawVariants: any[] = (Array.isArray(out.variants) && out.variants) || relVariants || [];

      const variantIds = rawVariants.map((v) => v?.id).filter(Boolean).map(String);

      // cheapest base offer
      const baseOffers = await prisma.supplierProductOffer.findMany({
        where: {
          productId: id,
          ...(getModelField("SupplierProductOffer", "isActive") ? { isActive: true } : {}),
          ...(getModelField("SupplierProductOffer", "inStock") ? { inStock: true } : {}),
          ...(getModelField("SupplierProductOffer", "availableQty") ? { availableQty: { gt: 0 } } : {}),
          ...(getModelField("SupplierProductOffer", "basePrice")
            ? { basePrice: decimalGtZeroFilter("SupplierProductOffer", "basePrice") }
            : {}),
        } as any,
        select: { basePrice: true, supplierId: true },
      });

      let bestSupplierBasePrice: number | null = null;
      let bestSupplierBaseSupplierId: string | null = null;

      for (const o of baseOffers as any[]) {
        const n = Number((o as any).basePrice);
        if (!Number.isFinite(n)) continue;
        if (bestSupplierBasePrice == null || n < bestSupplierBasePrice) {
          bestSupplierBasePrice = n;
          bestSupplierBaseSupplierId = String((o as any).supplierId);
        }
      }

      // cheapest unit per variant
      const variantOffers = variantIds.length
        ? await prisma.supplierVariantOffer.findMany({
            where: {
              variantId: { in: variantIds },
              ...(getModelField("SupplierVariantOffer", "isActive") ? { isActive: true } : {}),
              ...(getModelField("SupplierVariantOffer", "inStock") ? { inStock: true } : {}),
              ...(getModelField("SupplierVariantOffer", "availableQty") ? { availableQty: { gt: 0 } } : {}),
              ...(getModelField("SupplierVariantOffer", "unitPrice")
                ? { unitPrice: decimalGtZeroFilter("SupplierVariantOffer", "unitPrice") }
                : {}),
            } as any,
            select: { variantId: true, unitPrice: true, supplierId: true },
          })
        : [];

      const bestUnitByVariantId = new Map<string, { unit: number; supplierId: string }>();

      for (const o of variantOffers as any[]) {
        const vid = String((o as any).variantId);
        const n = Number((o as any).unitPrice);
        if (!Number.isFinite(n)) continue;

        const cur = bestUnitByVariantId.get(vid);
        if (!cur || n < cur.unit) {
          bestUnitByVariantId.set(vid, { unit: n, supplierId: String((o as any).supplierId) });
        }
      }

      // cheapest variant unit across all combos
      let cheapestVariantUnitPrice: number | null = null;
      for (const { unit } of bestUnitByVariantId.values()) {
        if (cheapestVariantUnitPrice == null || unit < cheapestVariantUnitPrice) {
          cheapestVariantUnitPrice = unit;
        }
      }

      const baseRetailFromSupplier = applySupplierMarkup(bestSupplierBasePrice);
      const cheapestVariantRetailPrice = applySupplierMarkup(cheapestVariantUnitPrice);

      // attach to product
      out.bestSupplierBasePrice = bestSupplierBasePrice;
      out.bestSupplierBaseSupplierId = bestSupplierBaseSupplierId;
      out.bestSupplierBaseRetail = baseRetailFromSupplier;
      out.cheapestVariantUnitPrice = cheapestVariantUnitPrice;
      out.cheapestVariantRetailPrice = cheapestVariantRetailPrice;

      // override product-level retail & price if we have supplier base
      if (baseRetailFromSupplier != null) {
        out.retailPrice = baseRetailFromSupplier;
        out.price = baseRetailFromSupplier;
      }

      // attach to variants: best unit OR base fallback + derived retail
      const attachTo = (arr: any[]) => {
        for (const v of arr) {
          const vid = v?.id ? String(v.id) : "";
          const best = vid ? bestUnitByVariantId.get(vid) ?? null : null;

          const unit = best?.unit ?? null;
          const supplierId = best?.supplierId ?? null;

          const effectiveUnit = unit ?? bestSupplierBasePrice ?? null;
          const variantRetail = applySupplierMarkup(effectiveUnit);

          v.bestSupplierUnitPrice = effectiveUnit;
          v.bestSupplierUnitSupplierId = supplierId ?? (bestSupplierBaseSupplierId ?? null);

          if (variantRetail != null) {
            v.retailPrice = variantRetail;
            v.price = variantRetail;
          }
        }
      };

      if (Array.isArray(out.variants)) attachTo(out.variants);
      if (relVariants) attachTo(relVariants);
    }

    return res.json({ data: out });
  })
);

export default router;
