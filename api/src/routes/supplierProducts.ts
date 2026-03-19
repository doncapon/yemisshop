// api/src/routes/supplierProducts.ts
import { Router } from "express";
import { NotificationType, Prisma, PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { z } from "zod";
import { requireAuth, requireSupplier } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requiredString } from "../lib/http.js";
import { notifyAdmins } from "../services/notifications.service.js";
import { AnyCaaRecord } from "dns";

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

async function safeNotifyAdmins(payload: { type: NotificationType; title: string; body: string; data?: any }) {
  try {
    await notifyAdmins(payload as any);
  } catch (e) {
    console.warn("[notifyAdmins] failed:", e);
  }
}


function isNumericOverflowError(e: any) {
  const msg = String(e?.message ?? "");
  return (
    msg.includes("numeric field overflow") ||
    msg.includes("value is out of range for type numeric") ||
    msg.includes("must round to an absolute value less than 10^")
  );
}

function friendlyNumericOverflowError(fieldLabel = "price") {
  const err: any = new Error(`${fieldLabel} is too large.`);
  err.statusCode = 400;
  err.code = "NUMERIC_FIELD_OVERFLOW";
  err.userMessage = `The ${fieldLabel.toLowerCase()} entered is too large for the current database limit. Please enter a smaller amount or increase the database decimal precision.`;
  return err;
}
/* ========================================================================== */
/* Supplier+Brand+Title SKU policy                                             */
/* ========================================================================== */

function isPrismaUniqueErr(e: any) {
  return e && typeof e === "object" && e.code === "P2002";
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

function hasScalarField(modelName: string, fieldName: string): boolean {
  try {
    const dmmf =
      (prisma as any)?._dmmf?.datamodel ??
      (prisma as any)?._baseDmmf?.datamodel ??
      (prisma as any)?._engine?.dmmf?.datamodel ??
      (Prisma as any)?.dmmf?.datamodel ??
      null;

    const model = dmmf?.models?.find((m: any) => m.name === modelName);
    if (!model) return false;

    return Boolean(model.fields?.some((f: any) => f.name === fieldName && f.kind === "scalar"));
  } catch {
    return false;
  }
}

/**
 * ✅ SKU is ALWAYS computed from supplierId + brandId + title
 * Uses IDs (no lookups), and includes a short hash to prevent collisions.
 */
function makeSkuFromSupplierBrandTitle(input: { supplierId: string; brandId: string; title: string }) {
  const supplierId = String(input.supplierId || "").trim();
  const brandId = String(input.brandId || "").trim();
  const title = String(input.title || "").trim();

  const supplierShort = skuSafePart(supplierId).slice(0, 8) || "SUP";
  const brandShort = skuSafePart(brandId).slice(0, 8) || "BR";
  const titleSlug = skuSafePart(title).slice(0, 30) || "ITEM";

  const sig = `${supplierId}|${brandId}|${title.toLowerCase()}`;
  const hash6 = crypto.createHash("sha1").update(sig).digest("hex").slice(0, 6).toUpperCase();

  const sku = `SUP-${supplierShort}-BR-${brandShort}-${titleSlug}-${hash6}`;
  return skuSafePart(sku).slice(0, 80) || `PRODUCT-${Date.now()}`;
}

/**
 * ✅ Supplier+Brand-aware SKU uniqueness helper
 * - Enforce uniqueness within supplier+brand (when fields exist).
 * - If isDeleted exists, enforce uniqueness within isDeleted=false.
 */
async function ensureUniqueProductSku(
  tx: Tx,
  desired: string,
  opts?: { excludeProductId?: string; brandId?: string | null | undefined; supplierId?: string | null | undefined }
) {
  const excludeProductId = opts?.excludeProductId;
  const brandId = (opts?.brandId ?? null) ? String(opts?.brandId).trim() : null;
  const supplierId = (opts?.supplierId ?? null) ? String(opts?.supplierId).trim() : null;

  let base = skuSafePart(desired);
  if (!base) base = `PRODUCT-${Date.now()}`;

  const exists = async (sku: string) => {
    const where: any = { sku };

    if (hasScalarField("Product", "isDeleted")) where.isDeleted = false;

    if (supplierId && hasScalarField("Product", "supplierId")) where.supplierId = supplierId;
    if (brandId && hasScalarField("Product", "brandId")) where.brandId = brandId;

    if (excludeProductId) where.id = { not: excludeProductId };

    const hit = await (tx as any).product.findFirst({ where, select: { id: true } });
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

/**
 * ✅ Friendly guard for duplicates (Supplier + Brand + SKU) before Prisma throws.
 * Works whether DB unique key is:
 * - (brandId, sku, isDeleted) OR
 * - (supplierId, brandId, sku, isDeleted)
 */
async function assertNoDuplicateSupplierBrandSkuTx(
  tx: Tx,
  args: { supplierId?: string | null; brandId?: string | null; sku?: string | null; excludeProductId?: string }
) {
  const sku = String(args.sku ?? "").trim();
  const brandId = args.brandId != null ? String(args.brandId).trim() : "";
  const supplierId = args.supplierId != null ? String(args.supplierId).trim() : "";

  if (!sku) return;

  const where: any = {
    sku,
    ...(hasScalarField("Product", "isDeleted") ? { isDeleted: false } : {}),
    ...(args.excludeProductId ? { id: { not: args.excludeProductId } } : {}),
  };

  if (brandId && hasScalarField("Product", "brandId")) where.brandId = brandId;
  if (supplierId && hasScalarField("Product", "supplierId")) where.supplierId = supplierId;

  const hit = await (tx as any).product.findFirst({ where, select: { id: true } });
  if (hit?.id) {
    const err: any = new Error("A product with this Supplier, Brand and SKU already exists.");
    err.statusCode = 409;
    err.code = "DUPLICATE_PRODUCT_SUPPLIER_BRAND_SKU";
    err.meta = { existingProductId: String(hit.id), supplierId: supplierId || null, brandId: brandId || null, sku };
    err.userMessage = "You already have a product for that brand/title. Please change title or brand.";
    throw err;
  }
}

async function recomputeProductStockTx(tx: Prisma.TransactionClient, productId: string) {
  const [baseAgg, variantAgg] = await Promise.all([
    tx.supplierProductOffer.aggregate({
      where: {
        productId,
        isActive: true,
        inStock: true,
      },
      _sum: { availableQty: true },
    }),
    tx.supplierVariantOffer.aggregate({
      where: {
        productId,
        isActive: true,
        inStock: true,
      },
      _sum: { availableQty: true },
    }),
  ]);

  const baseQty = Number(baseAgg._sum?.availableQty ?? 0);
  const variantQty = Number(variantAgg._sum?.availableQty ?? 0);
  const total = Math.max(0, Math.trunc(baseQty + variantQty));

  await tx.product.update({
    where: { id: productId },
    data: {
      availableQty: total,
      inStock: total > 0,
    } as any,
  });
}

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
  },
  warnings: string[]
) {
  let {
    basePrice,
    currency = "NGN",
    inStock = true,
    isActive = true,
    leadDays = null,
    availableQty = 0,
  } = input;

  const basePriceNum =
    basePrice instanceof Prisma.Decimal ? Number(basePrice) : Number(basePrice ?? 0);

  const guarded = await maybeDeactivateIfPayoutNotReadyTx(
    tx as any,
    supplierId,
    { isActive, inStock, availableQty: Math.max(0, Math.trunc(availableQty ?? 0)), basePrice: basePriceNum },
    "Base offer",
    warnings
  );

  isActive = guarded.isActive !== false;
  inStock = guarded.inStock !== false;

  const qtyInt = Math.max(0, Math.trunc(availableQty ?? 0));

  const data: any = {
    supplierId,
    basePrice: toDecimal(basePrice),
    currency,
    inStock,
    isActive,
    leadDays,
    availableQty: qtyInt,
  };

  try {
    const existing = await tx.supplierProductOffer.findFirst({
      where: { productId, supplierId },
      select: { id: true },
    });

    let offer;
    if (existing) {
      offer = await tx.supplierProductOffer.update({
        where: { id: existing.id },
        data,
      });
    } else {
      offer = await tx.supplierProductOffer.create({
        data: {
          productId,
          ...data,
        },
      });
    }

    await recomputeProductStockTx(tx, productId);
    await refreshProductAutoPriceIfAutoMode(tx, productId);

    return offer;
  } catch (e: any) {
    if (isNumericOverflowError(e)) {
      throw friendlyNumericOverflowError("Base price");
    }
    throw e;
  }
}

function assertMoneyWithinDbLimit(value: any, fieldLabel: string, max = 99_999_999.99) {
  if (value === "" || value == null) return;

  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return;

  if (Math.abs(n) > max) {
    const err: any = new Error(`${fieldLabel} is too large.`);
    err.statusCode = 400;
    err.code = "MONEY_LIMIT_EXCEEDED";
    err.userMessage = `${fieldLabel} cannot exceed ₦${max.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}.`;
    throw err;
  }
}

/* ========================================================================== */
/* Supplier context                                                            */
/* ========================================================================== */

type SupplierCtx =
  | {
    ok: true;
    supplierId: string;
    supplier: { id: string; name?: string | null; status?: any; userId?: string | null };
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
      return { ok: false, status: 400, error: "Missing supplierId query param for admin view" };
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
    if (!supplier) return { ok: false, status: 403, error: "Supplier profile not found for this user" };

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
 * ✅ UI sometimes sends qty/quantity instead of availableQty.
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

async function makeUniqueVariantSku(tx: Tx, desired: string | null | undefined, seen: Set<string>, fallbackBase: string) {
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
    String(o?.attributeId ?? o?.attribute?.id ?? o?.attributeValue?.attributeId ?? o?.value?.attributeId ?? "").trim();

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
 * ✅ If UI sends "variants" as one-row-per-attribute (NOT real variant combos),
 * collapse them into a single "base combo" stored on Product attributes.
 */
function collapseVariantsIntoBaseCombo(variants: any[]) {
  const rows = Array.isArray(variants) ? variants : [];
  if (!rows.length) return { isBaseCombo: false as const, options: [] as any[] };

  const combined = new Map<string, string>(); // attributeId -> valueId
  let sawAnyOption = false;

  for (const v of rows) {
    const directId = String(v?.variantId ?? v?.id ?? "").trim();
    if (directId) return { isBaseCombo: false as const, options: [] as any[] };

    const sku = String(v?.sku ?? "").trim();
    if (sku) return { isBaseCombo: false as const, options: [] as any[] };

    const unitPriceProvided = v?.unitPrice !== undefined && v?.unitPrice !== null && String(v.unitPrice) !== "";
    if (unitPriceProvided) return { isBaseCombo: false as const, options: [] as any[] };

    const rowQtyProvided = v?.availableQty !== undefined || v?.qty !== undefined || v?.quantity !== undefined;
    if (rowQtyProvided) {
      const q = pickQty(v?.availableQty, v?.qty, v?.quantity);
      if (q != null) return { isBaseCombo: false as const, options: [] as any[] };
    }

    const opts = normalizeOptions(
      v?.options ?? v?.optionSelections ?? v?.attributes ?? v?.attributeSelections ?? v?.variantOptions ?? v?.VariantOptions ?? []
    );

    if (opts.length !== 1) return { isBaseCombo: false as const, options: [] as any[] };

    const o = opts[0];
    if (!o?.attributeId || !o?.valueId) continue;

    sawAnyOption = true;
    combined.set(String(o.attributeId), String(o.valueId)); // last wins
  }

  if (!sawAnyOption) return { isBaseCombo: false as const, options: [] as any[] };

  return {
    isBaseCombo: true as const,
    options: Array.from(combined.entries()).map(([attributeId, valueId]) => ({ attributeId, valueId })),
  };
}

function mergeBaseComboIntoAttributeSelections(attributeSelections: any[], comboOptions: Array<{ attributeId: string; valueId: string }>) {
  const base = Array.isArray(attributeSelections) ? attributeSelections : [];

  const comboAttrIds = new Set(comboOptions.map((o) => String(o.attributeId)));

  const out: any[] = [];
  const singles = new Map<string, string>();

  for (const sel of base) {
    const aid = String(sel?.attributeId ?? "").trim();
    if (!aid) continue;

    if (typeof sel?.text === "string" && sel.text.trim()) {
      out.push({ attributeId: aid, text: sel.text.trim() });
      continue;
    }

    if (Array.isArray(sel?.valueIds) && sel.valueIds.length) {
      if (!comboAttrIds.has(aid)) {
        out.push({ attributeId: aid, valueIds: sel.valueIds.map((x: any) => String(x)).filter(Boolean) });
      }
      continue;
    }

    if (sel?.valueId) singles.set(aid, String(sel.valueId));
  }

  for (const o of comboOptions) {
    const aid = String(o.attributeId).trim();
    const vid = String(o.valueId).trim();
    if (!aid || !vid) continue;
    singles.set(aid, vid);
  }

  for (const [attributeId, valueId] of singles.entries()) out.push({ attributeId, valueId });

  return out;
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
/**
 * Prisma schema note:
 * - SupplierProductOffer is UNIQUE by productId (no supplierId field).
 * - SupplierVariantOffer is UNIQUE by variantId (no supplierId field).
 * - Product has REQUIRED supplierId (one supplier per product).
 */
async function refreshProductAutoPriceIfAutoMode(tx: Prisma.TransactionClient, productId: string) {
  const p = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, priceMode: true },
  });
  if (!p) return;

  if (String((p as any).priceMode ?? "AUTO").toUpperCase() !== "AUTO") return;

  const base = await tx.supplierProductOffer.findFirst({
    where: {
      productId,
      isActive: true,
      inStock: true,
      availableQty: { gt: 0 },
      basePrice: { gt: new Prisma.Decimal("0") },
    } as any,
    select: { basePrice: true },
  });

  await tx.product.update({
    where: { id: productId },
    data: { autoPrice: base?.basePrice ?? null },
  });
}

/* ------------------------- Offer purchasable guard ------------------------ */

function offerBecomesPurchasable(input: { isActive?: boolean; inStock?: boolean; availableQty?: number; basePrice?: number }) {
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
      accountName: true,
      bankCode: true,
      bankCountry: true,
      bankVerificationStatus: true,
      bankVerifiedAt: true,
    },
  });

  if (!s) return false;

  const nonEmpty = (v: any) => (typeof v === "string" ? v.trim().length > 0 : !!v);

  const verified = String(s.bankVerificationStatus ?? "").toUpperCase() === "VERIFIED" || !!(s as any).bankVerifiedAt;

  if (!s.isPayoutEnabled) return false;
  if (!verified) return false;

  if (!nonEmpty(s.accountNumber)) return false;
  if (!nonEmpty(s.bankCode)) return false;

  return true;
}

/**
 * ✅ SOFT payout guard:
 * If offer would become purchasable but payout isn't ready:
 * - do NOT throw
 * - force isActive=false
 * - add a warning (returned to client)
 */
function forceNonPurchasable<T extends { isActive?: boolean; inStock?: boolean }>(input: T): T {
  return { ...input, isActive: false } as T;
}

async function maybeDeactivateIfPayoutNotReadyTx(
  tx: Tx,
  supplierId: string,
  offerInput: { isActive?: boolean; inStock?: boolean; availableQty?: number; basePrice?: number },
  contextMsg: string,
  warnings: string[]
) {
  if (!offerBecomesPurchasable(offerInput)) return offerInput;

  const ok = await isSupplierPayoutReadyTx(tx, supplierId);
  if (ok) return offerInput;

  warnings.push(
    `${contextMsg}: supplier payout not ready. Saved, but deactivated (isActive=false) until bank details are verified.`
  );

  return forceNonPurchasable(offerInput);
}

/* -------------------------- Attributes writer --------------------------- */

async function writeProductAttributes(
  tx: Prisma.TransactionClient,
  productId: string,
  attributeSelections?: Array<{ attributeId: string; valueId?: string; valueIds?: string[]; text?: string }>
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
    select: { id: true, options: { select: { attributeId: true, valueId: true } } } as any,
  });

  const existingMap = new Map<string, string>();
  for (const v of existing as any[]) {
    const k = comboKey((v.options || []).map((o: any) => ({ attributeId: o.attributeId, valueId: o.valueId })));
    if (k) existingMap.set(k, v.id);
  }

  const already = existingMap.get(key);
  if (already) return already;

  const seen = new Set<string>();
  const fallbackBase = `${String(productSkuBase || "VAR").trim()}-VAR`;
  const sku = await makeUniqueVariantSku(tx as any, desiredSku ?? null, seen, fallbackBase);

  const created = await tx.productVariant.create({
    data: { productId, sku, retailPrice: null, inStock, imagesJson: [], availableQty: qty } as any,
    select: { id: true },
  });

  await tx.productVariantOption.createMany({
    data: cleanOptions.map((o) => ({ variantId: created.id, attributeId: o.attributeId, valueId: o.valueId, unitPrice: null })),
    skipDuplicates: true,
  });

  return created.id;
}

// ------- sku helpers ------
function prefixVariantSkuWithProductName(productTitle: string, rawSku?: string | null) {
  const prefix = slugSkuBase(productTitle).toUpperCase().slice(0, 30) || "PRODUCT";
  const s = String(rawSku ?? "").trim();
  if (!s) return null;

  const clean = s.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "").toUpperCase();

  if (!clean) return null;
  if (clean.startsWith(prefix + "-")) return clean;

  return `${prefix}-${clean}`;
}


function baseComboKeyFromAttributeSelections(attributeSelections: any[]) {
  const sels = Array.isArray(attributeSelections) ? attributeSelections : [];

  // Only SINGLE select combos matter for base-combo equivalence.
  // (Ignore TEXT and MULTISELECT because variants are single valueId per attribute.)
  const opts: Array<{ attributeId: string; valueId: string }> = [];

  for (const sel of sels) {
    const aid = String(sel?.attributeId ?? "").trim();
    const vid = String(sel?.valueId ?? "").trim();
    if (!aid || !vid) continue;
    opts.push({ attributeId: aid, valueId: vid });
  }

  const clean = normalizeOptions(opts);
  return clean.length ? comboKey(clean) : "";
}

async function baseComboKeyFromDbTx(tx: Prisma.TransactionClient, productId: string) {
  const rows = await tx.productAttributeOption.findMany({
    where: { productId },
    select: { attributeId: true, valueId: true },
  });

  const opts = (rows || [])
    .map((r) => ({
      attributeId: String(r.attributeId ?? "").trim(),
      valueId: String(r.valueId ?? "").trim(),
    }))
    .filter((o) => o.attributeId && o.valueId);

  const clean = normalizeOptions(opts);
  return clean.length ? comboKey(clean) : "";
}

function assertNoDuplicateVariantCombosAndNoBaseCollision(args: {
  variants: any[];
  baseComboKey: string; // "" means no base combo
}) {
  const { variants, baseComboKey } = args;

  const rows = Array.isArray(variants) ? variants : [];
  if (!rows.length) return;

  const seen = new Map<string, number>(); // comboKey -> first index

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];

    const opts = normalizeOptions(
      v?.options ??
      v?.optionSelections ??
      v?.attributes ??
      v?.attributeSelections ??
      v?.variantOptions ??
      v?.VariantOptions ??
      []
    );

    // Ignore rows that don’t describe a combo (could be directId updates)
    if (!opts.length) continue;

    const ck = comboKey(opts);
    if (!ck) continue;

    // (2) base combo collision
    if (baseComboKey && ck === baseComboKey) {
      const err: any = new Error("Variant combo duplicates the base product combo.");
      err.statusCode = 400;
      err.code = "DUPLICATE_BASE_AND_VARIANT_COMBO";
      err.userMessage =
        "A variant option combination cannot be the same as the base product option combination. Remove the duplicate variant or change the base attributes.";
      err.meta = { index: i, comboKey: ck };
      throw err;
    }

    // (1) duplicate variants inside payload
    const first = seen.get(ck);
    if (first != null) {
      const err: any = new Error("Duplicate variant combinations in request.");
      err.statusCode = 400;
      err.code = "DUPLICATE_VARIANT_COMBO";
      err.userMessage =
        "You have duplicate variant combinations. Each variant option combination must be unique.";
      err.meta = { firstIndex: first, dupIndex: i, comboKey: ck };
      throw err;
    }
    seen.set(ck, i);
  }
}

type ModerationSummary = {
  moderationStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  moderationMessage: string | null;
  moderationReviewedAt: string | null;
};

function modelTimestampField(modelName: string) {
  if (modelHasField(modelName, "reviewedAt")) return "reviewedAt";
  if (modelHasField(modelName, "updatedAt")) return "updatedAt";
  if (modelHasField(modelName, "createdAt")) return "createdAt";
  return null;
}

function moderationMessageFields(modelName: string) {
  return [
    "reason",
    "rejectionReason",
    "reviewNote",
    "adminNote",
    "reviewerMessage",
    "note",
  ].filter((f) => modelHasField(modelName, f));
}

function moderationSelect(modelName: string) {
  const select: any = {
    id: true,
    productId: true,
    status: true,
  };

  const ts = modelTimestampField(modelName);
  if (ts) select[ts] = true;

  for (const f of moderationMessageFields(modelName)) {
    select[f] = true;
  }

  return select;
}

function moderationEventTime(modelName: string, row: any) {
  const ts = modelTimestampField(modelName);
  const raw = ts ? row?.[ts] : null;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function moderationEventMessage(modelName: string, row: any) {
  for (const f of moderationMessageFields(modelName)) {
    const v = String(row?.[f] ?? "").trim();
    if (v) return v;
  }
  return null;
}

async function getLatestModerationByProduct(
  supplierId: string,
  productIds: string[]
): Promise<Record<string, ModerationSummary>> {
  const out: Record<string, ModerationSummary> = {};
  if (!supplierId || !productIds.length) return out;

  const rows: Array<{
    productId: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | null;
    message: string | null;
    whenMs: number;
    whenIso: string | null;
  }> = [];

  const productChangeRequest = getDelegate(prisma, "productChangeRequest");
  if (productChangeRequest) {
    const modelName = "ProductChangeRequest";
    const found = await productChangeRequest.findMany({
      where: {
        supplierId,
        productId: { in: productIds },
        status: { in: ["PENDING", "APPROVED", "REJECTED"] },
      },
      select: moderationSelect(modelName),
    });

    for (const row of found as any[]) {
      const whenMs = moderationEventTime(modelName, row);
      rows.push({
        productId: String(row.productId),
        status: (row.status as any) ?? null,
        message: moderationEventMessage(modelName, row),
        whenMs,
        whenIso: whenMs ? new Date(whenMs).toISOString() : null,
      });
    }
  }

  const supplierOfferChangeRequest = getDelegate(prisma, "supplierOfferChangeRequest");
  if (supplierOfferChangeRequest) {
    const modelName = "SupplierOfferChangeRequest";
    const found = await supplierOfferChangeRequest.findMany({
      where: {
        supplierId,
        productId: { in: productIds },
        status: { in: ["PENDING", "APPROVED", "REJECTED"] },
      },
      select: moderationSelect(modelName),
    });

    for (const row of found as any[]) {
      const whenMs = moderationEventTime(modelName, row);
      rows.push({
        productId: String(row.productId),
        status: (row.status as any) ?? null,
        message: moderationEventMessage(modelName, row),
        whenMs,
        whenIso: whenMs ? new Date(whenMs).toISOString() : null,
      });
    }
  }

  for (const row of rows) {
    const existing = out[row.productId];
    if (!existing) {
      out[row.productId] = {
        moderationStatus: row.status,
        moderationMessage: row.message,
        moderationReviewedAt: row.whenIso,
      };
      continue;
    }

    const existingMs = existing.moderationReviewedAt
      ? new Date(existing.moderationReviewedAt).getTime()
      : 0;

    if (row.whenMs >= existingMs) {
      out[row.productId] = {
        moderationStatus: row.status,
        moderationMessage: row.message,
        moderationReviewedAt: row.whenIso,
      };
    }
  }

  return out;
}

/* ------------------------------- Schemas -------------------------------- */

const zCoerceIntNonNegOpt = () =>
  z
    .preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().finite().transform((n) => Math.max(0, Math.trunc(n))))
    .optional();

const zCoerceIntNullableOpt = () => z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int()).nullable().optional();

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
    value: z.object({ id: z.string().optional(), attributeId: z.string().optional() }).optional(),
    attributeValue: z.object({ id: z.string().optional(), attributeId: z.string().optional() }).optional(),
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
  sku: z.string().trim().min(1).nullable().optional(), // ignored; SKU is computed
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
    sku: z.string().min(1).optional(), // ignored; SKU is computed
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
  if (modelHasField("SupplierProductOffer", "updatedAt")) return { updatedAt: "desc" as const };
  if (modelHasField("SupplierProductOffer", "createdAt")) return { createdAt: "desc" as const };
  return undefined;
}

/* ------------------------------- CREATE ---------------------------------- */



router.get("/", requireAuth, async (req, res) => {
  try {
    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const s = ctx.supplier;

    const q = String(req.query.q ?? "").trim();
    const take = Math.min(100, Math.max(1, Number(req.query.take) || 24));
    const skip = Math.max(0, Number(req.query.skip) || 0);
    const categoryId = String(req.query.categoryId ?? "").trim();
    const brandId = String(req.query.brandId ?? "").trim();

    const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 3);

    const rawStatus = String(req.query.status ?? "ANY").trim().toUpperCase();

    const statusAliasMap: Record<string, string> = {
      ANY: "ANY",
      PENDING: "PENDING",
      LIVE: "LIVE",
      ACTIVE: "LIVE",
      APPROVED: "APPROVED",
      PUBLISHED: "PUBLISHED",
      REJECTED: "REJECTED",
    };

    const status = statusAliasMap[rawStatus] ?? "ANY";

    const ownershipOr: any[] = [
      { supplierId: s.id } as any,
      ...(s.userId
        ? ([{ ownerId: s.userId } as any, { userId: s.userId } as any] as any[])
        : []),
    ];

    const baseWhere: Prisma.ProductWhereInput = {
      isDeleted: false,
      OR: ownershipOr as any,
      ...(categoryId ? { categoryId } : {}),
      ...(brandId ? { brandId } : {}),
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

    const isModerationFilteredStatus =
      status === "PENDING" || status === "REJECTED" || status === "APPROVED";

    let pageProductIds: string[] = [];
    let total = 0;

    if (!isModerationFilteredStatus) {
      const dbWhere: Prisma.ProductWhereInput = {
        ...baseWhere,
        ...(status !== "ANY" ? { status: status as any } : {}),
      };

      const [pagedIds, rawTotal] = await Promise.all([
        prisma.product.findMany({
          where: dbWhere,
          orderBy: { createdAt: "desc" },
          skip,
          take,
          select: { id: true },
        }),
        prisma.product.count({ where: dbWhere }),
      ]);

      pageProductIds = pagedIds.map((x: any) => String(x.id));
      total = rawTotal;
    } else {
      const candidateRows = await prisma.product.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          hasPendingChanges: true,
        },
      });

      const candidateIds = candidateRows.map((x: any) => String(x.id));

      const moderationByProduct = await getLatestModerationByProduct(String(s.id), candidateIds);

      const filteredIds = candidateRows
        .filter((p: any) => {
          const pid = String(p.id);
          const moderation = moderationByProduct[pid] ?? {
            moderationStatus: null,
          };

          const hasPendingChanges =
            Boolean(p.hasPendingChanges) ||
            moderation.moderationStatus === "PENDING" ||
            String(p.status ?? "").toUpperCase() === "PENDING";

          const effectiveModerationStatus = hasPendingChanges
            ? "PENDING"
            : moderation.moderationStatus;

          if (status === "PENDING") return effectiveModerationStatus === "PENDING";
          if (status === "REJECTED") return effectiveModerationStatus === "REJECTED";
          if (status === "APPROVED") return effectiveModerationStatus === "APPROVED";
          return true;
        })
        .map((p: any) => String(p.id));

      total = filteredIds.length;
      pageProductIds = filteredIds.slice(skip, skip + take);
    }

    if (!pageProductIds.length) {
      return res.json({
        data: [],
        total,
        meta: { lowStockThreshold: LOW_STOCK_THRESHOLD },
      });
    }

    const items = await prisma.product.findMany({
      where: { id: { in: pageProductIds } },
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
        hasPendingChanges: true,
        supplierId: true,
        ownerId: true as any,
        userId: true as any,
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
      },
    });

    const productIds = pageProductIds.slice();

    const [moderationByProduct, variantMin, baseAgg, variantAgg] = await Promise.all([
      getLatestModerationByProduct(String(s.id), productIds),

      prisma.supplierVariantOffer.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          supplierId: s.id,
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
          unitPrice: { gt: new Prisma.Decimal("0") },
        } as any,
        _min: { unitPrice: true },
      }),

      prisma.supplierProductOffer.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          supplierId: s.id,
          isActive: true,
          inStock: true,
        } as any,
        _sum: { availableQty: true },
      }),

      prisma.supplierVariantOffer.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          supplierId: s.id,
          isActive: true,
          inStock: true,
        } as any,
        _sum: { availableQty: true },
      }),
    ]);

    const variantMinByProduct: Record<string, number> = {};
    for (const r of variantMin as any[]) {
      variantMinByProduct[String(r.productId)] = Number(r._min?.unitPrice ?? 0) || 0;
    }

    const totalsByProduct: Record<string, number> = {};
    for (const r of baseAgg as any[]) {
      const pid = String(r.productId);
      totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + Number(r._sum?.availableQty ?? 0);
    }
    for (const r of variantAgg as any[]) {
      const pid = String(r.productId);
      totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + Number(r._sum?.availableQty ?? 0);
    }

    const itemById = new Map<string, any>();
    for (const p of items as any[]) {
      itemById.set(String(p.id), p);
    }

    const mapped = pageProductIds
      .map((pid) => itemById.get(String(pid)))
      .filter(Boolean)
      .map((p: any) => {
        const pid = String(p.id);
        const offer = p.supplierProductOffers?.[0] ?? null;

        const offerQtyTotal = totalsByProduct[pid] ?? 0;
        const availableQty =
          offerQtyTotal > 0 ? offerQtyTotal : Number(offer?.availableQty ?? p.availableQty ?? 0);

        const inStock =
          offer != null ? availableQty > 0 || offer.inStock === true : Boolean(p.inStock);

        const ownedBySupplier =
          String(p.supplierId ?? "") === String(s.id) ||
          (s.userId &&
            (String(p.ownerId ?? "") === String(s.userId) ||
              String(p.userId ?? "") === String(s.userId)));

        const baseOfferPrice =
          offer?.basePrice != null && Number(offer.basePrice) > 0 ? Number(offer.basePrice) : 0;
        const variantFallbackPrice = variantMinByProduct[pid] ?? 0;
        const displayBasePrice = baseOfferPrice > 0 ? baseOfferPrice : variantFallbackPrice;

        const moderation = moderationByProduct[pid] ?? {
          moderationStatus: null,
          moderationMessage: null,
          moderationReviewedAt: null,
        };

        const hasPendingChanges =
          Boolean(p.hasPendingChanges) ||
          moderation.moderationStatus === "PENDING" ||
          String(p.status ?? "").toUpperCase() === "PENDING";

        const isRejected =
          !hasPendingChanges && moderation.moderationStatus === "REJECTED";

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

          basePrice: displayBasePrice,
          currency: offer?.currency ?? "NGN",
          offerIsActive: offer?.isActive ?? false,

          isLowStock: availableQty <= LOW_STOCK_THRESHOLD,
          isDerived: !ownedBySupplier,

          hasPendingChanges,
          moderationStatus: hasPendingChanges ? "PENDING" : moderation.moderationStatus,
          moderationMessage: isRejected ? moderation.moderationMessage : null,
          moderationReviewedAt: isRejected ? moderation.moderationReviewedAt : null,
        };
      });

    return res.json({
      data: mapped,
      total,
      meta: { lowStockThreshold: LOW_STOCK_THRESHOLD },
    });
  } catch (e: any) {
    console.error("GET /api/supplier/products failed:", e);
    return res.status(500).json({
      error: e?.message || "Failed to load supplier products",
    });
  }
});

/* ------------------------------- CREATE ---------------------------------- */
router.post("/", requireAuth, requireSupplier, async (req, res) => {
  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) {
      return res.status(403).json({ error: "Supplier profile not found for this user" });
    }

    const incoming: any = req.body ?? {};
    const base: any = incoming?.data ?? incoming?.product ?? incoming;
    const payload = CreateSchema.parse(base ?? {});

    if (payload.imagesJson) assertMaxImages(payload.imagesJson);

    assertMoneyWithinDbLimit(payload.basePrice, "Base price");
    if (payload.communicationCost != null) {
      assertMoneyWithinDbLimit(payload.communicationCost, "Communication cost");
    }
    for (const v of payload.variants ?? []) {
      assertMoneyWithinDbLimit((v as any)?.unitPrice, "Variant price");
    }

    const title = String(payload.title ?? "").trim();
    const description = String(payload.description ?? "").trim();
    const brandId = String(payload.brandId ?? "").trim();
    const categoryId = String(payload.categoryId ?? "").trim() || null;

    if (!title) {
      return res.status(400).json({
        error: "Title is required",
        code: "TITLE_REQUIRED",
        userMessage: "Please enter a product title.",
      });
    }

    if (!description) {
      return res.status(400).json({
        error: "Description is required",
        code: "DESCRIPTION_REQUIRED",
        userMessage: "Please enter a product description.",
      });
    }

    if (!brandId) {
      return res.status(400).json({
        error: "Brand is required",
        code: "BRAND_REQUIRED",
        userMessage: "Please select a brand.",
      });
    }

    const warnings: string[] = [];

    const created = await prisma.$transaction(async (tx) => {
      const brand = await tx.brand.findFirst({
        where: { id: brandId, isActive: true } as any,
        select: { id: true, name: true },
      });
      if (!brand) {
        const err: any = new Error("Invalid brand");
        err.statusCode = 400;
        err.code = "INVALID_BRAND";
        err.userMessage = "Selected brand was not found.";
        throw err;
      }

      if (categoryId) {
        const category = await tx.category.findFirst({
          where: { id: categoryId, isActive: true } as any,
          select: { id: true, name: true },
        });
        if (!category) {
          const err: any = new Error("Invalid category");
          err.statusCode = 400;
          err.code = "INVALID_CATEGORY";
          err.userMessage = "Selected category was not found.";
          throw err;
        }
      }

      const normalizedImages = normalizeImagesJson(payload.imagesJson ?? []);

      const baseQty =
        pickQty(payload.availableQty, (payload as any).qty, (payload as any).quantity) ?? 0;

      const basePriceNum = Number(asNumber(payload.basePrice) ?? 0);
      if (!Number.isFinite(basePriceNum) || basePriceNum <= 0) {
        const err: any = new Error("Base price must be greater than 0");
        err.statusCode = 400;
        err.code = "INVALID_BASE_PRICE";
        err.userMessage = "Base price must be greater than 0.";
        throw err;
      }

      let attributeSelections = Array.isArray(payload.attributeSelections)
        ? [...payload.attributeSelections]
        : [];

      const collapsed = collapseVariantsIntoBaseCombo(payload.variants ?? []);
      if (collapsed.isBaseCombo) {
        attributeSelections = mergeBaseComboIntoAttributeSelections(
          attributeSelections,
          collapsed.options
        );
      }

      const baseComboKey = baseComboKeyFromAttributeSelections(attributeSelections as any);

      if (!collapsed.isBaseCombo) {
        assertNoDuplicateVariantCombosAndNoBaseCollision({
          variants: payload.variants ?? [],
          baseComboKey,
        });
      }

      const computedSku = makeSkuFromSupplierBrandTitle({
        supplierId: s.id,
        brandId,
        title,
      });

      const uniqueSku = await ensureUniqueProductSku(tx as any, computedSku, {
        supplierId: s.id,
        brandId,
      });

      await assertNoDuplicateSupplierBrandSkuTx(tx as any, {
        supplierId: s.id,
        brandId,
        sku: uniqueSku,
      });

      const product = await tx.product.create({
        data: {
          title,
          description,
          sku: uniqueSku,
          retailPrice: toDecimal(basePriceNum),
          inStock: baseQty > 0,
          status: "PENDING",
          imagesJson: normalizedImages,
          brandId,
          ...(categoryId ? { categoryId } : {}),
          ...(categoryId ? { categoryName: undefined } : {}),
          ...(payload.communicationCost != null
            ? { communicationCost: toDecimal(payload.communicationCost) }
            : {}),
          availableQty: baseQty,
          supplierId: s.id,
          ownerId: req.user!.id,
          userId: req.user!.id,
          createdById: req.user!.id,
          updatedById: req.user!.id,
          hasPendingChanges: false,
        } as any,
        select: {
          id: true,
          title: true,
          sku: true,
          status: true,
          brandId: true,
          categoryId: true,
        },
      });

      await writeProductAttributes(tx, product.id, attributeSelections as any);

      const baseOfferInput = {
        basePrice: payload.offer?.basePrice ?? basePriceNum,
        currency: payload.offer?.currency ?? "NGN",
        inStock: payload.offer?.inStock ?? baseQty > 0,
        isActive: payload.offer?.isActive ?? true,
        leadDays: payload.offer?.leadDays ?? null,
        availableQty:
          pickQty(
            payload.offer?.availableQty,
            (payload.offer as any)?.qty,
            (payload.offer as any)?.quantity,
            payload.availableQty,
            (payload as any)?.qty,
            (payload as any)?.quantity
          ) ?? baseQty,
      };

      const baseOffer = await upsertSupplierProductOffer(
        tx,
        s.id,
        product.id,
        baseOfferInput,
        warnings
      );

      const seenVariantSkus = new Set<string>();
      const rows = Array.isArray(payload.variants) ? payload.variants : [];

      for (const raw of rows) {
        const directId = String((raw as any)?.variantId ?? "").trim();

        const opts = normalizeOptions(
          (raw as any)?.options ??
            (raw as any)?.optionSelections ??
            (raw as any)?.attributes ??
            (raw as any)?.attributeSelections ??
            (raw as any)?.variantOptions ??
            (raw as any)?.VariantOptions ??
            []
        );

        if (directId) {
          const err: any = new Error("variantId is not allowed when creating a new product");
          err.statusCode = 400;
          err.code = "CREATE_VARIANT_ID_NOT_ALLOWED";
          err.userMessage = "New products cannot reference an existing variantId.";
          throw err;
        }

        if (!opts.length) continue;

        const vQty =
          pickQty((raw as any)?.availableQty, (raw as any)?.qty, (raw as any)?.quantity) ?? 0;

        const unitPriceNum =
          Number(asNumber((raw as any)?.unitPrice) ?? basePriceNum);

        const desiredSku = prefixVariantSkuWithProductName(
          title,
          String((raw as any)?.sku ?? "").trim() || null
        );

        const fallbackBase = `${slugSkuBase(title).toUpperCase() || "PRODUCT"}-VAR`;
        const uniqueVariantSku = await makeUniqueVariantSku(
          tx as any,
          desiredSku,
          seenVariantSkus,
          fallbackBase
        );

        const variant = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: uniqueVariantSku,
            retailPrice: Number.isFinite(unitPriceNum) && unitPriceNum > 0 ? toDecimal(unitPriceNum) : null,
            inStock: vQty > 0,
            imagesJson: normalizeImagesJson((raw as any)?.imagesJson ?? []),
            availableQty: vQty,
            isActive: true,
          } as any,
          select: { id: true, sku: true },
        });

        await tx.productVariantOption.createMany({
          data: opts.map((o) => ({
            variantId: variant.id,
            attributeId: o.attributeId,
            valueId: o.valueId,
            unitPrice: null,
          })),
          skipDuplicates: true,
        });

        const guardedVar = await maybeDeactivateIfPayoutNotReadyTx(
          tx as any,
          s.id,
          {
            isActive: (raw as any)?.isActive ?? true,
            inStock: (raw as any)?.inStock ?? vQty > 0,
            availableQty: vQty,
            basePrice: unitPriceNum,
          },
          "Variant offer",
          warnings
        );

        await tx.supplierVariantOffer.create({
          data: {
            supplierId: s.id,
            productId: product.id,
            variantId: variant.id,
            supplierProductOfferId: baseOffer.id,
            unitPrice: toDecimal(unitPriceNum),
            currency: payload.offer?.currency ?? "NGN",
            availableQty: vQty,
            inStock: guardedVar.inStock !== false,
            isActive: guardedVar.isActive !== false,
            leadDays: (raw as any)?.leadDays ?? payload.offer?.leadDays ?? null,
          } as any,
        });
      }

      await recomputeProductStockTx(tx, product.id);
      await refreshProductAutoPriceIfAutoMode(tx, product.id);

      return tx.product.findUnique({
        where: { id: product.id },
        include: {
          brand: { select: { id: true, name: true } },
          supplierProductOffers: {
            where: { supplierId: s.id },
            take: 1,
            ...(supplierOfferOrderBy() ? { orderBy: supplierOfferOrderBy() as any } : {}),
          },
          ProductVariant: {
            include: {
              options: {
                include: {
                  attribute: { select: { id: true, name: true, type: true } },
                  value: { select: { id: true, name: true, code: true } },
                },
              },
              supplierVariantOffers: {
                where: { supplierId: s.id },
                take: 1,
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });

    await safeNotifyAdmins({
      type: NotificationType.PRODUCT_SUBMITTED,
      title: "Supplier product submitted",
      body: `${s.name ?? "A supplier"} submitted a new product: ${created?.title ?? title} (${created?.sku ?? "no-sku"}).`,
      data: {
        supplierId: s.id,
        supplierName: s.name ?? null,
        productId: (created as any)?.id ?? null,
        productSku: (created as any)?.sku ?? null,
      },
    });

    return res.status(201).json({
      data: created,
      warnings,
    });
  } catch (e: any) {
    if (isPrismaUniqueErr(e) || e?.code === "DUPLICATE_PRODUCT_SUPPLIER_BRAND_SKU") {
      return res.status(409).json({
        error: "A product with this Supplier, Brand and SKU already exists.",
        code: "DUPLICATE_PRODUCT_SUPPLIER_BRAND_SKU",
        userMessage:
          "You already have a product for that brand/title. Please change title or brand.",
        meta: e?.meta,
      });
    }

    if (
      isNumericOverflowError(e) ||
      e?.code === "NUMERIC_FIELD_OVERFLOW" ||
      e?.code === "MONEY_LIMIT_EXCEEDED"
    ) {
      return res.status(400).json({
        error: "One or more money values are too large.",
        code: e?.code ?? "NUMERIC_FIELD_OVERFLOW",
        userMessage:
          e?.userMessage ??
          "The amount entered is too large for the current database limit. Please enter a smaller value.",
      });
    }

    const status = Number(e?.statusCode) || 500;
    console.error("[supplier.products CREATE] error:", e);

    return res.status(status).json({
      error: status >= 500 ? "Failed to create product" : e?.message || "Request failed",
      code: e?.code,
      userMessage:
        e?.userMessage ??
        "We couldn’t create the product. Please review the form and try again.",
    });
  }
});


router.post("/attach", requireAuth, requireSupplier, async (req, res) => {
  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

    const payload = AttachSchema.parse(req.body ?? {});
    const productId = String(payload.productId).trim();

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isDeleted: false,
        status: { in: ["LIVE", "ACTIVE", "PUBLISHED"] as any },
      },
      select: {
        id: true,
        title: true,
        sku: true,
        status: true,
        ProductVariant: {
          where: { isActive: true, archivedAt: null } as any,
          select: { id: true },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found or not attachable" });
    }

    const warnings: string[] = [];

    const result = await prisma.$transaction(async (tx) => {
      const baseQty =
        pickQty(
          payload.offer?.availableQty,
          (payload.offer as any)?.qty,
          (payload.offer as any)?.quantity
        ) ?? 0;

      const baseOffer = await upsertSupplierProductOffer(
        tx,
        s.id,
        productId,
        {
          basePrice: payload.offer.basePrice,
          currency: payload.offer.currency ?? "NGN",
          inStock: payload.offer.inStock ?? baseQty > 0,
          isActive: payload.offer.isActive ?? true,
          leadDays: payload.offer.leadDays ?? null,
          availableQty: baseQty,
        },
        warnings
      );

      const validVariantIds = new Set(
        ((product as any).ProductVariant ?? []).map((v: any) => String(v.id))
      );

      for (const v of payload.variants ?? []) {
        const variantId = String(v.variantId).trim();
        if (!variantId || !validVariantIds.has(variantId)) continue;

        const vQty = pickQty(v.availableQty, (v as any).qty, (v as any).quantity) ?? 0;
        const unitPriceNum = Number(asNumber(v.unitPrice) ?? 0);

        const guardedVar = await maybeDeactivateIfPayoutNotReadyTx(
          tx as any,
          s.id,
          {
            isActive: v.isActive ?? true,
            inStock: v.inStock ?? vQty > 0,
            availableQty: vQty,
            basePrice: unitPriceNum,
          },
          "Variant offer",
          warnings
        );

        const existing = await tx.supplierVariantOffer.findFirst({
          where: { supplierId: s.id, variantId },
          select: { id: true },
        });

        if (existing) {
          await tx.supplierVariantOffer.update({
            where: { id: existing.id },
            data: {
              productId,
              supplierId: s.id,
              supplierProductOfferId: baseOffer.id,
              unitPrice: toDecimal(unitPriceNum),
              currency: payload.offer.currency ?? "NGN",
              availableQty: vQty,
              inStock: guardedVar.inStock !== false,
              isActive: guardedVar.isActive !== false,
              leadDays: payload.offer.leadDays ?? null,
            } as any,
          });
        } else {
          await tx.supplierVariantOffer.create({
            data: {
              productId,
              variantId,
              supplierId: s.id,
              supplierProductOfferId: baseOffer.id,
              unitPrice: toDecimal(unitPriceNum),
              currency: payload.offer.currency ?? "NGN",
              availableQty: vQty,
              inStock: guardedVar.inStock !== false,
              isActive: guardedVar.isActive !== false,
              leadDays: payload.offer.leadDays ?? null,
            } as any,
          });
        }
      }

      await recomputeProductStockTx(tx, productId);
      await refreshProductAutoPriceIfAutoMode(tx, productId);

      return tx.product.findUnique({ where: { id: productId } });
    });

    await safeNotifyAdmins({
      type: NotificationType.SUPPLIER_OFFER_CHANGE_SUBMITTED,
      title: "Supplier attached to existing product",
      body: `${s.name ?? "A supplier"} added an offer to ${product.title} (${product.sku}).`,
      data: {
        supplierId: s.id,
        supplierName: s.name ?? null,
        productId: product.id,
        productSku: product.sku,
      },
    });

    return res.status(201).json({ data: result, warnings });
  } catch (e: any) {
    console.error("[supplier.products ATTACH] error:", e);
    return res.status(Number(e?.statusCode) || 500).json({
      error: e?.message || "Internal Server Error",
      code: e?.code,
      userMessage: e?.userMessage,
    });
  }
});

/* ============================================================
   Eligibility endpoint (bulk) — schema-aligned
============================================================ */
router.get("/delete-eligibility", requireAuth, async (req: any, res) => {
  try {
    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const idsRaw = String(req.query?.ids ?? req.query?.productIds ?? "").trim();
    const ids = idsRaw.split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length) return res.json({ data: {} });

    const supplierId = String(ctx.supplierId || "");
    const userId = String(req.user?.id || "");
    if (!supplierId || !userId) return res.json({ data: {} });

    const products = await prisma.product.findMany({
      where: { id: { in: ids }, isDeleted: false } as any,
      select: { id: true, title: true, sku: true, supplierId: true, ownerId: true as any, userId: true as any } as any,
    });

    const byId: Record<string, { canDelete: boolean; reason?: string | null }> = {};
    for (const pid of ids) byId[pid] = { canDelete: false, reason: "Not found" };

    const ownedIds: string[] = [];

    for (const p of products as any[]) {
      const pid = String(p.id);
      const owned =
        String(p.supplierId || "") === supplierId || String(p.ownerId || "") === userId || String(p.userId || "") === userId;

      if (!owned) {
        byId[pid] = { canDelete: false, reason: "You can’t delete this product because you don’t own it." };
        continue;
      }

      byId[pid] = { canDelete: true, reason: null };
      ownedIds.push(pid);
    }

    if (!ownedIds.length) return res.json({ data: byId });

    // Orders by product or by variants
    const variants = await prisma.productVariant.findMany({
      where: { productId: { in: ownedIds } } as any,
      select: { id: true, productId: true },
    });

    const variantToProduct: Record<string, string> = {};
    const allVariantIds: string[] = [];
    for (const v of variants as any[]) {
      const vid = String(v.id);
      const pid = String(v.productId);
      if (!vid || !pid) continue;
      variantToProduct[vid] = pid;
      allVariantIds.push(vid);
    }

    const hasOrdersByProduct: Record<string, boolean> = {};
    for (const pid of ownedIds) hasOrdersByProduct[pid] = false;

    const orderHits = await prisma.orderItem.findMany({
      where: { OR: [{ productId: { in: ownedIds } }, ...(allVariantIds.length ? [{ variantId: { in: allVariantIds } }] : [])] } as any,
      select: { productId: true, variantId: true },
      take: 5000,
    });

    for (const hit of orderHits as any[]) {
      const pid = hit.productId ? String(hit.productId) : null;
      const vid = hit.variantId ? String(hit.variantId) : null;
      if (pid) hasOrdersByProduct[pid] = true;
      if (vid && variantToProduct[vid]) hasOrdersByProduct[variantToProduct[vid]] = true;
    }

    for (const pid of ownedIds) {
      if (hasOrdersByProduct[pid]) {
        byId[pid] = { canDelete: false, reason: "This product can’t be deleted because it already has orders." };
      } else {
        byId[pid] = { canDelete: true, reason: null };
      }
    }

    return res.json({ data: byId });
  } catch (e: any) {
    console.error("GET /api/supplier/products/delete-eligibility failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute delete eligibility" });
  }
});





const AttachSchema = z.object({
  productId: z.string().min(1),
  offer: z.object({
    basePrice: z.union([z.number(), z.string()]),
    currency: z.string().optional(),
    inStock: z.boolean().optional(),
    isActive: z.boolean().optional(),
    leadDays: zCoerceIntNullableOpt(),
    availableQty: zCoerceIntNonNegOpt(),
    qty: zCoerceIntNonNegOpt(),
    quantity: zCoerceIntNonNegOpt(),
  }),
  variants: z.array(
    z.object({
      variantId: z.string().min(1),
      unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
      availableQty: z.union([z.number(), z.string()]).optional().nullable(),
      qty: z.union([z.number(), z.string()]).optional().nullable(),
      quantity: z.union([z.number(), z.string()]).optional().nullable(),
      inStock: z.boolean().optional(),
      isActive: z.boolean().optional(),
    })
  ).optional(),
});


router.get("/catalog/search", requireAuth, requireSupplier, async (req, res) => {
  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) return res.status(403).json({ error: "Supplier profile not found for this user" });

    const q = String(req.query.q ?? "").trim();
    const take = Math.min(50, Math.max(1, Number(req.query.take) || 20));

    const where: Prisma.ProductWhereInput = {
      isDeleted: false,
      status: { in: ["LIVE", "ACTIVE", "PUBLISHED"] as any },
      ...(q
        ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
        : {}),
    };

    const items = await prisma.product.findMany({
      where,
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        sku: true,
        status: true,
        imagesJson: true,
        brandId: true,
        categoryId: true,
        supplierId: true,
        supplierProductOffers: {
          where: { supplierId: s.id },
          select: {
            id: true,
            basePrice: true,
            currency: true,
            availableQty: true,
            isActive: true,
            inStock: true,
          },
          take: 1,
        },
      },
    });

    return res.json({
      data: items.map((p: any) => ({
        id: p.id,
        title: p.title,
        sku: p.sku,
        status: p.status,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        brandId: p.brandId ?? null,
        categoryId: p.categoryId ?? null,
        alreadyAttached: !!p.supplierProductOffers?.[0],
        myOffer: p.supplierProductOffers?.[0] ?? null,
        isOwnedByMe: String(p.supplierId ?? "") === String(s.id),
      })),
    });
  } catch (e: any) {
    console.error("GET /api/supplier/products/catalog/search failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to search supplier catalog" });
  }
});

/* ------------------------------ DELETE /:id ------------------------------ */

function getDelegate(tx: any, name: string) {
  const d = (tx as any)?.[name];
  return d && typeof d === "object" ? d : null;
}

router.delete("/:id", requireAuth, async (req: any, res) => {
  try {
    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const productId = requiredString(req.params?.id, "Missing product id");

    const supplierId = ctx.supplierId;
    const supplierName = ctx.supplier?.name ?? null;
    const userId = String(req.user?.id || "");

    const hasSupplierId = hasScalarField("Product", "supplierId");
    const hasOwnerId = hasScalarField("Product", "ownerId");
    const hasUserId = hasScalarField("Product", "userId");
    const hasIsDeleted = hasScalarField("Product", "isDeleted");

    const result = await prisma.$transaction(async (tx) => {
      const where: any = { id: productId };
      if (hasIsDeleted) where.isDeleted = false;

      const product = await tx.product.findFirst({
        where,
        select: {
          id: true,
          title: true,
          sku: true,
          ...(hasScalarField("Product", "brandId") ? { brandId: true } : {}),

          ...(hasSupplierId ? { supplierId: true } : {}),
          ...(hasOwnerId ? { ownerId: true } : {}),
          ...(hasUserId ? { userId: true } : {}),
        } as any,
      });

      if (!product) {
        const err: any = new Error("Product not found");
        err.statusCode = 404;
        throw err;
      }

      const owned =
        (hasSupplierId && String((product as any).supplierId || "") === String(supplierId)) ||
        (hasOwnerId && String((product as any).ownerId || "") === String(userId)) ||
        (hasUserId && String((product as any).userId || "") === String(userId));

      const myBaseOffer = await tx.supplierProductOffer.findFirst({
        where: { productId, supplierId },
        select: { id: true },
      });

      const myVariantOffers = await tx.supplierVariantOffer.findMany({
        where: { productId, supplierId },
        select: { id: true, variantId: true },
      });

      const otherBaseOffersCount = await tx.supplierProductOffer.count({
        where: {
          productId,
          supplierId: { not: supplierId },
        },
      });

      const isSharedAttachmentOnly = !owned || otherBaseOffersCount > 0;

      if (!owned) {
        const err: any = new Error("You can’t delete this product because you don’t own it.");
        err.statusCode = 403;
        throw err;
      }

      const ProductVariant = getDelegate(tx, "productVariant");
      const variants = ProductVariant
        ? await ProductVariant.findMany({ where: { productId }, select: { id: true, productId: true } })
        : [];

      const variantIds = (variants as any[]).map((v) => String(v.id)).filter(Boolean);

      const orderHit = await tx.orderItem.findFirst({
        where: { OR: [{ productId }, ...(variantIds.length ? [{ variantId: { in: variantIds } }] : [])] },
        select: { id: true },
      });

      if (orderHit) {
        const err: any = new Error("This product can’t be deleted because it already has orders.");
        err.statusCode = 400;
        throw err;
      }

      // schema: offers are NOT supplier-keyed; delete all offers for this product
      await tx.supplierVariantOffer.deleteMany({ where: { productId } });
      await tx.supplierProductOffer.deleteMany({ where: { productId } });

      const ProductVariantOption = getDelegate(tx, "productVariantOption");
      if (ProductVariantOption && variantIds.length) {
        await ProductVariantOption.deleteMany({ where: { variantId: { in: variantIds } } as any });
      }
      if (ProductVariant) await ProductVariant.deleteMany({ where: { productId } });

      const ProductAttributeOption = getDelegate(tx, "productAttributeOption");
      if (ProductAttributeOption) await ProductAttributeOption.deleteMany({ where: { productId } });

      if (isSharedAttachmentOnly) {
        await tx.supplierVariantOffer.deleteMany({
          where: { productId, supplierId },
        });

        await tx.supplierProductOffer.deleteMany({
          where: { productId, supplierId },
        });

        await recomputeProductStockTx(tx, productId);
        await refreshProductAutoPriceIfAutoMode(tx, productId);

        return { id: productId, detached: true };
      }
      const ProductAttributeText = getDelegate(tx, "productAttributeText");
      if (ProductAttributeText) await ProductAttributeText.deleteMany({ where: { productId } });

      if (hasIsDeleted) {
        await tx.product.update({ where: { id: productId }, data: { isDeleted: true } as any });
      } else {
        await tx.product.delete({ where: { id: productId } });
      }

      try {
        await notifyAdmins(
          {
            type: NotificationType.PRODUCT_DELETED,
            title: "Supplier product deleted",
            body: `${supplierName ?? "A supplier"} deleted a product: ${(product as any).title} (${(product as any).sku}).`,
            data: { supplierId, supplierName, productId, sku: (product as any).sku ?? null, title: (product as any).title ?? null },
          },
          tx
        );
      } catch (notifyErr) {
        console.error("notifyAdmins failed (product delete):", notifyErr);
      }

      return { id: productId };
    });

    return res.json({ ok: true, data: result });
  } catch (e: any) {
    const status = Number(e?.statusCode) || 500;
    return res.status(status).json({ error: e?.message || "Failed to delete product" });
  }
});

/* ------------------------------- PATCH ---------------------------------- */
/**
 * Kept behavior, but schema-aligned:
 * - base offer unique by productId
 * - variant offer unique by variantId
 * - product is owned by supplierId (required)
 */
router.patch("/:id", requireAuth, requireSupplier, async (req, res) => {
  try {
    const s = await getSupplierForUser(req.user!.id);
    if (!s) {
      return res.status(403).json({ error: "Supplier profile not found for this user" });
    }

    const id = requiredString(req.params.id);

    const incoming: any = req.body ?? {};
    const base: any = incoming?.data ?? incoming?.product ?? incoming;
    const payload = UpdateSchema.parse(base ?? {});

    if (payload.imagesJson) assertMaxImages(payload.imagesJson);

    assertMoneyWithinDbLimit(payload.basePrice ?? payload.offer?.basePrice, "Base price");
    if (payload.communicationCost != null) {
      assertMoneyWithinDbLimit(payload.communicationCost, "Communication cost");
    }
    for (const v of payload.variants ?? []) {
      assertMoneyWithinDbLimit((v as any)?.unitPrice, "Variant price");
    }

    const stockOnlyFlag = payload.stockOnly === true || payload?.meta?.stockOnly === true;

    const product = await prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
        OR: [
          { supplierId: s.id } as any,
          { ownerId: req.user!.id } as any,
          { userId: req.user!.id } as any,
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
        hasPendingChanges: true,
      } as any,
    });

    if (!product) return res.status(404).json({ error: "Not found" });

    const ownedBySupplier =
      String((product as any).supplierId ?? "") === String(s.id) ||
      String((product as any).ownerId ?? "") === String(req.user!.id) ||
      String((product as any).userId ?? "") === String(req.user!.id);

    const statusUpper = String((product as any).status ?? "").toUpperCase();

    const isPublishedState =
      statusUpper === "LIVE" ||
      statusUpper === "ACTIVE" ||
      statusUpper === "PUBLISHED";

    const isPendingState = statusUpper === "PENDING";
    const isRejectedState = statusUpper === "REJECTED";
    const hasPendingFlag = Boolean((product as any).hasPendingChanges);

    /**
     * Review-managed products:
     * - already live/published
     * - already pending review
     * - previously rejected and being re-submitted
     */
    const requiresApprovalFlow =
      isPublishedState || isPendingState || isRejectedState || hasPendingFlag;

    /**
     * Title + SKU remain locked once product is review-managed.
     */
    if (requiresApprovalFlow) {
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
          error: "This product is under review. Title and SKU are locked.",
          code: "PRODUCT_REVIEW_CORE_LOCKED",
          userMessage: "This product is under review. Title and SKU can’t be changed.",
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

    const warnings: string[] = [];

    const updated = await prisma.$transaction(async (tx) => {
      const existingBaseOffer = await tx.supplierProductOffer.findFirst({
        where: { productId: id, supplierId: s.id },
        select: {
          id: true,
          basePrice: true,
          currency: true,
          inStock: true,
          isActive: true,
          leadDays: true,
          availableQty: true,
        },
      });

      const existingVariantOffers = await tx.supplierVariantOffer.findMany({
        where: { productId: id, supplierId: s.id },
        select: {
          id: true,
          variantId: true,
          unitPrice: true,
          availableQty: true,
          inStock: true,
          isActive: true,
          leadDays: true,
          currency: true,
        },
      });

      const existingVariantOfferByVariantId = new Map<string, any>();
      for (const row of existingVariantOffers) {
        existingVariantOfferByVariantId.set(String(row.variantId), row);
      }

      const existingPendingProductChange = await tx.productChangeRequest.findFirst({
        where: {
          productId: id,
          supplierId: s.id,
          status: "PENDING",
        },
        select: {
          id: true,
          proposedPatch: true,
          currentSnapshot: true,
        } as any,
      });

      const existingPendingOfferChanges = await tx.supplierOfferChangeRequest.findMany({
        where: {
          productId: id,
          supplierId: s.id,
          status: "PENDING",
        },
        select: {
          id: true,
          scope: true,
          supplierProductOfferId: true,
          supplierVariantOfferId: true,
          patchJson: true,
        } as any,
      });

      const existingPendingBaseOfferChange =
        existingPendingOfferChanges.find(
          (x: any) => String(x.scope ?? "").toUpperCase() === "BASE_OFFER"
        ) ?? null;

      const existingPendingVariantOfferByKey = new Map<string, any>();
      for (const row of existingPendingOfferChanges) {
        if (String(row.scope ?? "").toUpperCase() !== "VARIANT_OFFER") continue;

        const offerIdKey = row?.supplierVariantOfferId
          ? `offer:${String(row.supplierVariantOfferId)}`
          : null;

        const patchVariantId = String((row as any)?.patchJson?.variantId ?? "").trim();
        const variantIdKey = patchVariantId ? `variant:${patchVariantId}` : null;

        if (offerIdKey) existingPendingVariantOfferByKey.set(offerIdKey, row);
        if (variantIdKey) existingPendingVariantOfferByKey.set(variantIdKey, row);
      }

      const nextBaseQty = pickQty(
        payload.offer?.availableQty,
        (payload.offer as any)?.qty,
        (payload.offer as any)?.quantity,
        payload.availableQty,
        (payload as any)?.qty,
        (payload as any)?.quantity
      );

      const nextBasePriceRaw = payload.offer?.basePrice ?? payload.basePrice;
      const nextBasePriceNum = Number(
        asNumber(nextBasePriceRaw) ??
        (existingBaseOffer?.basePrice != null ? Number(existingBaseOffer.basePrice) : 0)
      );

      const nextCurrency = payload.offer?.currency ?? existingBaseOffer?.currency ?? "NGN";
      const nextIsActive = payload.offer?.isActive ?? existingBaseOffer?.isActive ?? true;
      const nextInStock =
        payload.offer?.inStock ??
        existingBaseOffer?.inStock ??
        (nextBaseQty != null ? nextBaseQty > 0 : true);
      const nextLeadDays = (payload.offer?.leadDays ?? existingBaseOffer?.leadDays ?? null) as any;

      const touchesBaseOffer =
        payload.offer != null ||
        payload.basePrice != null ||
        payload.availableQty != null ||
        (payload as any).qty != null ||
        (payload as any).quantity != null;

      const variantsIncoming = Array.isArray(payload.variants) ? payload.variants : [];

      let baseComboKey = "";
      if (payload.attributeSelections !== undefined) {
        baseComboKey = baseComboKeyFromAttributeSelections(payload.attributeSelections as any);
      } else {
        baseComboKey = await baseComboKeyFromDbTx(tx, id);
      }

      assertNoDuplicateVariantCombosAndNoBaseCollision({
        variants: variantsIncoming,
        baseComboKey,
      });

      const liveProductPatch: any = {};
      const liveProductCurrent: any = {};
      const liveBaseOfferPatch: any = {};
      const liveVariantOfferRequests: Array<{
        variantId: string;
        supplierVariantOfferId: string | null;
        proposedPatch: any;
        currentSnapshot: any;
      }> = [];
      const liveVariantStructurePatch: any[] = [];

      const nextImages = payload.imagesJson
        ? normalizeImagesJson(payload.imagesJson)
        : undefined;

      // ------------------------------------------------
      // 1) REVIEW-REQUIRED PRODUCT: queue reviewable core changes
      // ------------------------------------------------
      if (requiresApprovalFlow && ownedBySupplier && !stockOnlyFlag) {
        if (
          payload.description !== undefined &&
          String(payload.description ?? "") !== String((product as any).description ?? "")
        ) {
          liveProductCurrent.description = (product as any).description ?? "";
          liveProductPatch.description = payload.description ?? "";
        }

        if (
          payload.categoryId !== undefined &&
          String(payload.categoryId ?? "") !== String((product as any).categoryId ?? "")
        ) {
          liveProductCurrent.categoryId = (product as any).categoryId ?? null;
          liveProductPatch.categoryId = payload.categoryId ?? null;
        }

        if (
          payload.brandId !== undefined &&
          String(payload.brandId ?? "") !== String((product as any).brandId ?? "")
        ) {
          liveProductCurrent.brandId = (product as any).brandId ?? null;
          liveProductPatch.brandId = payload.brandId ?? null;
        }

        if (payload.communicationCost !== undefined) {
          const currentComms =
            (product as any).communicationCost != null
              ? String((product as any).communicationCost)
              : null;
          const nextComms =
            payload.communicationCost == null ? null : String(payload.communicationCost);

          if (currentComms !== nextComms) {
            liveProductCurrent.communicationCost = currentComms;
            liveProductPatch.communicationCost = nextComms;
          }
        }

        if (nextImages !== undefined) {
          const currImgs = Array.isArray((product as any).imagesJson)
            ? (product as any).imagesJson
            : [];

          if (JSON.stringify(currImgs) !== JSON.stringify(nextImages)) {
            liveProductCurrent.imagesJson = currImgs;
            liveProductPatch.imagesJson = nextImages;
          }
        }

        if (payload.attributeSelections !== undefined) {
          const currentAttrOptions = await tx.productAttributeOption.findMany({
            where: { productId: id },
            select: { attributeId: true, valueId: true },
            orderBy: [{ attributeId: "asc" }, { valueId: "asc" }],
          });

          const currentAttrTexts = await tx.productAttributeText.findMany({
            where: { productId: id },
            select: { attributeId: true, value: true },
            orderBy: [{ attributeId: "asc" }],
          });

          liveProductCurrent.attributeSelections = {
            optionRows: currentAttrOptions,
            textRows: currentAttrTexts,
          };
          liveProductPatch.attributeSelections = payload.attributeSelections;
        }
      }

      // ------------------------------------------------
      // 2) BASE OFFER
      // ------------------------------------------------
      let baseOffer: any = existingBaseOffer;

      if (touchesBaseOffer) {
        const qty = Math.max(
          0,
          Math.trunc(nextBaseQty ?? existingBaseOffer?.availableQty ?? 0)
        );

        if (requiresApprovalFlow) {
          /**
           * Stock applies immediately.
           * Reviewable pricing/status changes are stored in pending request.
           */
          baseOffer = await upsertSupplierProductOffer(
            tx,
            s.id,
            id,
            {
              basePrice:
                existingBaseOffer?.basePrice != null
                  ? Number(existingBaseOffer.basePrice)
                  : nextBasePriceNum,
              currency: existingBaseOffer?.currency ?? nextCurrency,
              inStock: qty > 0,
              isActive: existingBaseOffer?.isActive ?? true,
              leadDays: existingBaseOffer?.leadDays ?? null,
              availableQty: qty,
            },
            warnings
          );

          const currentBasePrice =
            existingBaseOffer?.basePrice != null ? Number(existingBaseOffer.basePrice) : 0;
          const currentLeadDays = existingBaseOffer?.leadDays ?? null;
          const currentIsActive = existingBaseOffer?.isActive ?? true;
          const currentCurrency = existingBaseOffer?.currency ?? "NGN";

          const basePriceChanged =
            nextBasePriceRaw !== undefined &&
            Number.isFinite(nextBasePriceNum) &&
            nextBasePriceNum > 0 &&
            nextBasePriceNum !== currentBasePrice;

          const leadDaysChanged =
            payload.offer?.leadDays !== undefined &&
            (nextLeadDays ?? null) !== (currentLeadDays ?? null);

          const activeChanged =
            payload.offer?.isActive !== undefined &&
            Boolean(nextIsActive) !== Boolean(currentIsActive);

          const currencyChanged =
            payload.offer?.currency !== undefined &&
            String(nextCurrency) !== String(currentCurrency);

          if (!stockOnlyFlag && (basePriceChanged || leadDaysChanged || activeChanged || currencyChanged)) {
            if (basePriceChanged) liveBaseOfferPatch.basePrice = nextBasePriceNum;
            if (leadDaysChanged) liveBaseOfferPatch.leadDays = nextLeadDays ?? null;
            if (activeChanged) liveBaseOfferPatch.isActive = !!nextIsActive;
            if (currencyChanged) liveBaseOfferPatch.currency = nextCurrency;
          }
        } else {
          baseOffer = await upsertSupplierProductOffer(
            tx,
            s.id,
            id,
            {
              basePrice: nextBasePriceNum,
              currency: nextCurrency,
              inStock: !!nextInStock,
              isActive: !!nextIsActive,
              leadDays: nextLeadDays,
              availableQty: qty,
            },
            warnings
          );
        }
      }

      // ------------------------------------------------
      // 3) VARIANTS
      // ------------------------------------------------
      if (variantsIncoming.length) {
        const pRow = await tx.product.findUnique({
          where: { id },
          select: { id: true, sku: true, title: true },
        });

        const productSkuBase = String(
          pRow?.sku || slugSkuBase(pRow?.title || "product")
        ).toUpperCase();

        for (const v of variantsIncoming as any[]) {
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

          if (!directId && !opts.length) continue;

          const vQty = pickQty(v?.availableQty, v?.qty, v?.quantity);
          const vQtyProvided = vQty != null;
          const vQtyNonNeg = Math.max(0, Math.trunc(vQty ?? 0));

          const unitPriceProvided =
            v?.unitPrice !== undefined &&
            v?.unitPrice !== null &&
            String(v.unitPrice) !== "";

          const unitPriceNumMaybe = unitPriceProvided
            ? Number(asNumber(v?.unitPrice) ?? 0)
            : undefined;

          let variantId: string | null = null;
          let createdNewCombo = false;

          if (directId) {
            const ok = await tx.productVariant.findFirst({
              where: { id: directId, productId: id },
              select: { id: true, sku: true },
            });

            if (!ok) {
              const e: any = new Error("Invalid variantId for this product");
              e.statusCode = 400;
              e.code = "INVALID_VARIANT";
              throw e;
            }

            variantId = directId;
          } else {
            if (requiresApprovalFlow) {
              if (!stockOnlyFlag) {
                liveVariantStructurePatch.push({
                  action: "CREATE_VARIANT_COMBO",
                  sku: v?.sku ?? null,
                  options: opts,
                  availableQty: vQtyNonNeg,
                  unitPrice: unitPriceNumMaybe ?? null,
                  inStock: v?.inStock ?? (vQtyProvided ? vQtyNonNeg > 0 : true),
                  isActive: v?.isActive ?? true,
                });
              }
              continue;
            }

            variantId = await createOrGetVariantByCombo(tx, {
              productId: id,
              productSkuBase,
              desiredSku: prefixVariantSkuWithProductName(
                pRow?.title || "PRODUCT",
                v?.sku ?? null
              ),
              options: opts,
              qty: vQtyNonNeg,
              inStock: v?.inStock ?? (vQtyProvided ? vQtyNonNeg > 0 : true),
            });
            createdNewCombo = true;
          }

          if (!variantId) continue;

          const existingVarOffer = existingVariantOfferByVariantId.get(String(variantId));

          const nextUnitPriceNum = unitPriceProvided
            ? unitPriceNumMaybe ?? 0
            : existingVarOffer?.unitPrice != null
              ? Number(existingVarOffer.unitPrice)
              : Number(baseOffer?.basePrice ?? 0);

          const nextQty = vQtyProvided
            ? vQtyNonNeg
            : Number(existingVarOffer?.availableQty ?? 0);

          const nextActiveRaw = (v?.isActive ?? existingVarOffer?.isActive ?? true) as boolean;
          const nextStockRaw = (
            v?.inStock ??
            (vQtyProvided ? vQtyNonNeg > 0 : existingVarOffer?.inStock ?? true)
          ) as boolean;

          const guardedVar = await maybeDeactivateIfPayoutNotReadyTx(
            tx as any,
            s.id,
            {
              isActive: !!nextActiveRaw,
              inStock: !!nextStockRaw,
              availableQty: nextQty,
              basePrice: nextUnitPriceNum,
            },
            "Variant offer",
            warnings
          );

          const nextActive = guardedVar.isActive !== false;
          const nextStock = guardedVar.inStock !== false;

          if (ownedBySupplier && vQtyProvided) {
            await tx.productVariant.update({
              where: { id: variantId },
              data: { availableQty: vQtyNonNeg, inStock: nextStock } as any,
            });
          }

          if (requiresApprovalFlow) {
            const currentUnitPrice =
              existingVarOffer?.unitPrice != null
                ? Number(existingVarOffer.unitPrice)
                : Number(baseOffer?.basePrice ?? 0);

            const currentLeadDays = existingVarOffer?.leadDays ?? null;
            const currentIsActive = existingVarOffer?.isActive ?? true;
            const currentCurrency = existingVarOffer?.currency ?? nextCurrency;

            const variantPriceChanged =
              unitPriceProvided &&
              Number.isFinite(nextUnitPriceNum) &&
              nextUnitPriceNum > 0 &&
              nextUnitPriceNum !== currentUnitPrice;

            const variantLeadChanged =
              v?.leadDays !== undefined &&
              (v.leadDays ?? null) !== (currentLeadDays ?? null);

            const variantActiveChanged =
              v?.isActive !== undefined &&
              Boolean(nextActive) !== Boolean(currentIsActive);

            const variantCurrencyChanged =
              v?.currency !== undefined &&
              String(v.currency ?? nextCurrency) !== String(currentCurrency);

            if (
              !stockOnlyFlag &&
              (variantPriceChanged || variantLeadChanged || variantActiveChanged || variantCurrencyChanged)
            ) {
              const proposedPatch: any = { variantId };

              if (variantPriceChanged) proposedPatch.unitPrice = nextUnitPriceNum;
              if (variantLeadChanged) proposedPatch.leadDays = v.leadDays ?? null;
              if (variantActiveChanged) proposedPatch.isActive = nextActive;
              if (variantCurrencyChanged) proposedPatch.currency = v.currency ?? nextCurrency;

              liveVariantOfferRequests.push({
                variantId,
                supplierVariantOfferId: existingVarOffer?.id ?? null,
                proposedPatch,
                currentSnapshot: {
                  unitPrice: currentUnitPrice,
                  leadDays: currentLeadDays,
                  isActive: currentIsActive,
                  currency: currentCurrency,
                },
              });
            }

            if (!existingVarOffer && !createdNewCombo) {
              await tx.supplierVariantOffer.create({
                data: {
                  productId: id,
                  variantId,
                  supplierId: s.id,
                  supplierProductOfferId: baseOffer?.id ?? null,
                  unitPrice: toDecimal(
                    existingBaseOffer?.basePrice != null
                      ? Number(existingBaseOffer.basePrice)
                      : Number(baseOffer?.basePrice ?? 0)
                  ),
                  currency: nextCurrency,
                  availableQty: nextQty,
                  inStock: nextStock,
                  isActive: true,
                  leadDays: nextLeadDays ?? null,
                } as any,
              });
            }
          } else {
            const existingSupplierVariantOffer = await tx.supplierVariantOffer.findFirst({
              where: { supplierId: s.id, variantId },
              select: { id: true },
            });

            if (existingSupplierVariantOffer) {
              await tx.supplierVariantOffer.update({
                where: { id: existingSupplierVariantOffer.id },
                data: {
                  productId: id,
                  variantId,
                  supplierId: s.id,
                  supplierProductOfferId: baseOffer?.id ?? null,
                  ...(unitPriceProvided ? { unitPrice: toDecimal(nextUnitPriceNum) } : {}),
                  currency: nextCurrency,
                  ...(vQtyProvided ? { availableQty: nextQty } : {}),
                  inStock: nextStock,
                  isActive: nextActive,
                  leadDays: v?.leadDays ?? nextLeadDays ?? null,
                } as any,
              });
            } else {
              await tx.supplierVariantOffer.create({
                data: {
                  productId: id,
                  variantId,
                  supplierId: s.id,
                  supplierProductOfferId: baseOffer?.id ?? null,
                  unitPrice: toDecimal(nextUnitPriceNum),
                  currency: nextCurrency,
                  availableQty: nextQty,
                  inStock: nextStock,
                  isActive: nextActive,
                  leadDays: v?.leadDays ?? nextLeadDays ?? null,
                } as any,
              });
            }
          }
        }
      }

      // ------------------------------------------------
      // 4) NON-REVIEW direct product edits
      // ------------------------------------------------
      if (!requiresApprovalFlow && ownedBySupplier && !stockOnlyFlag) {
        const nextImagesDirect = payload.imagesJson
          ? normalizeImagesJson(payload.imagesJson)
          : undefined;

        await tx.product.update({
          where: { id },
          data: {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.description !== undefined
              ? { description: payload.description ?? "" }
              : {}),
            ...(payload.categoryId !== undefined
              ? { categoryId: payload.categoryId ?? null }
              : {}),
            ...(payload.brandId !== undefined ? { brandId: payload.brandId ?? null } : {}),
            ...(payload.communicationCost !== undefined
              ? {
                communicationCost:
                  payload.communicationCost == null
                    ? null
                    : toDecimal(payload.communicationCost),
              }
              : {}),
            ...(nextImagesDirect !== undefined ? { imagesJson: nextImagesDirect } : {}),
          } as any,
        });

        if (payload.attributeSelections !== undefined) {
          await writeProductAttributes(tx, id, payload.attributeSelections as any);
        }

        const nextBrandId =
          payload.brandId !== undefined
            ? payload.brandId == null
              ? null
              : String(payload.brandId).trim()
            : (product as any).brandId ?? null;

        if (!nextBrandId) {
          const err: any = new Error("brandId is required");
          err.statusCode = 400;
          err.code = "BRAND_REQUIRED";
          throw err;
        }

        const nextTitle =
          payload.title !== undefined
            ? String(payload.title ?? "").trim()
            : String((product as any).title ?? "").trim();

        const mustRecomputeSku =
          payload.title !== undefined ||
          payload.brandId !== undefined ||
          payload.sku !== undefined;

        if (mustRecomputeSku) {
          const computed = makeSkuFromSupplierBrandTitle({
            supplierId: s.id,
            brandId: nextBrandId,
            title: nextTitle,
          });

          const unique = await ensureUniqueProductSku(tx as any, computed, {
            excludeProductId: id,
            brandId: nextBrandId,
            supplierId: s.id,
          });

          await assertNoDuplicateSupplierBrandSkuTx(tx as any, {
            supplierId: s.id,
            brandId: nextBrandId,
            sku: unique,
            excludeProductId: id,
          });

          await tx.product.update({
            where: { id },
            data: { sku: unique } as any,
          });
        }
      }

      // ------------------------------------------------
      // 5) UPSERT pending review rows for moderation-managed edits
      // ------------------------------------------------
      let hasPendingChanges = false;

      if (requiresApprovalFlow && !stockOnlyFlag) {
        // BASE OFFER pending row
        if (Object.keys(liveBaseOfferPatch).length > 0) {
          if (existingPendingBaseOfferChange?.id) {
            await tx.supplierOfferChangeRequest.update({
              where: { id: existingPendingBaseOfferChange.id },
              data: {
                supplierProductOfferId: existingBaseOffer?.id ?? null,
                patchJson: liveBaseOfferPatch,
                note: isRejectedState
                  ? "Rejected base offer updated and re-submitted by supplier"
                  : "Pending base offer updated by supplier",
                requestedByUserId: req.user!.id,
                status: "PENDING",
              } as any,
            });
          } else {
            await tx.supplierOfferChangeRequest.create({
              data: {
                supplierId: s.id,
                productId: id,
                supplierProductOfferId: existingBaseOffer?.id ?? null,
                scope: "BASE_OFFER",
                status: "PENDING",
                patchJson: liveBaseOfferPatch,
                note: isRejectedState
                  ? "Rejected base offer updated and re-submitted by supplier"
                  : "Live base offer change submitted by supplier",
                requestedByUserId: req.user!.id,
              } as any,
            });
          }
          hasPendingChanges = true;
        } else if (existingPendingBaseOfferChange?.id) {
          await tx.supplierOfferChangeRequest.delete({
            where: { id: existingPendingBaseOfferChange.id },
          });
        }

        // VARIANT OFFER pending rows
        const desiredPendingVariantKeys = new Set<string>();

        for (const item of liveVariantOfferRequests) {
          const key =
            item.supplierVariantOfferId != null
              ? `offer:${String(item.supplierVariantOfferId)}`
              : `variant:${String(item.variantId)}`;

          desiredPendingVariantKeys.add(key);

          const existingPendingRow =
            existingPendingVariantOfferByKey.get(
              item.supplierVariantOfferId != null
                ? `offer:${String(item.supplierVariantOfferId)}`
                : `variant:${String(item.variantId)}`
            ) ??
            existingPendingVariantOfferByKey.get(`variant:${String(item.variantId)}`) ??
            null;

          if (existingPendingRow?.id) {
            await tx.supplierOfferChangeRequest.update({
              where: { id: existingPendingRow.id },
              data: {
                supplierVariantOfferId: item.supplierVariantOfferId,
                patchJson: item.proposedPatch,
                note: isRejectedState
                  ? "Rejected variant offer updated and re-submitted by supplier"
                  : "Pending variant offer updated by supplier",
                requestedByUserId: req.user!.id,
                status: "PENDING",
              } as any,
            });
          } else {
            await tx.supplierOfferChangeRequest.create({
              data: {
                supplierId: s.id,
                productId: id,
                supplierVariantOfferId: item.supplierVariantOfferId,
                scope: "VARIANT_OFFER",
                status: "PENDING",
                patchJson: item.proposedPatch,
                note: isRejectedState
                  ? "Rejected variant offer updated and re-submitted by supplier"
                  : "Live variant offer change submitted by supplier",
                requestedByUserId: req.user!.id,
              } as any,
            });
          }

          hasPendingChanges = true;
        }

        for (const row of existingPendingOfferChanges) {
          if (String(row.scope ?? "").toUpperCase() !== "VARIANT_OFFER") continue;

          const offerKey = row?.supplierVariantOfferId
            ? `offer:${String(row.supplierVariantOfferId)}`
            : null;
          const patchVariantId = String((row as any)?.patchJson?.variantId ?? "").trim();
          const variantKey = patchVariantId ? `variant:${patchVariantId}` : null;

          const keep =
            (offerKey && desiredPendingVariantKeys.has(offerKey)) ||
            (variantKey && desiredPendingVariantKeys.has(variantKey));

          if (!keep) {
            await tx.supplierOfferChangeRequest.delete({
              where: { id: row.id },
            });
          }
        }

        // PRODUCT pending row
        const productPatchForReview: any = {};
        const currentSnapshotForReview: any = {};

        if (Object.keys(liveProductPatch).length > 0) {
          Object.assign(productPatchForReview, liveProductPatch);
          Object.assign(currentSnapshotForReview, liveProductCurrent);
        }

        if (liveVariantStructurePatch.length > 0) {
          productPatchForReview.variants = liveVariantStructurePatch;
          currentSnapshotForReview.variants = isRejectedState
            ? "REJECTED_VARIANT_STRUCTURE_RESUBMITTED"
            : "LIVE_VARIANT_STRUCTURE_LOCKED";
        }

        if (Object.keys(productPatchForReview).length > 0) {
          if (existingPendingProductChange?.id) {
            await tx.productChangeRequest.update({
              where: { id: existingPendingProductChange.id },
              data: {
                proposedPatch: productPatchForReview,
                currentSnapshot: currentSnapshotForReview,
                requestedByUserId: req.user!.id,
                status: "PENDING",
              } as any,
            });
          } else {
            await tx.productChangeRequest.create({
              data: {
                productId: id,
                supplierId: s.id,
                status: "PENDING",
                proposedPatch: productPatchForReview,
                currentSnapshot: currentSnapshotForReview,
                requestedByUserId: req.user!.id,
              } as any,
            });
          }
          hasPendingChanges = true;
        } else if (existingPendingProductChange?.id) {
          await tx.productChangeRequest.delete({
            where: { id: existingPendingProductChange.id },
          });
        }

        await tx.product.update({
          where: { id },
          data: {
            hasPendingChanges,
            ...(hasPendingChanges ? { status: "PENDING" } : {}),
          } as any,
        });

        if (hasPendingChanges) {
          warnings.push("Your changes were submitted for admin approval.");
        }
      }

      await recomputeProductStockTx(tx, id);
      await refreshProductAutoPriceIfAutoMode(tx, id);

      return tx.product.findUnique({ where: { id } });
    });

    await safeNotifyAdmins({
      type: NotificationType.PRODUCT_CHANGE_SUBMITTED,
      title: requiresApprovalFlow
        ? "Live supplier product change submitted"
        : "Supplier product updated",
      body: `${s.name ?? "A supplier"} ${requiresApprovalFlow ? "submitted changes for" : "updated"
        } a product: ${(updated as any)?.title ?? (product as any)?.title ?? "Unknown"
        } (${(updated as any)?.sku ?? (product as any)?.sku ?? id}).`,
      data: {
        supplierId: s.id,
        supplierName: s.name ?? null,
        productId: id,
        sku: (updated as any)?.sku ?? (product as any)?.sku ?? null,
        status: (updated as any)?.status ?? (product as any)?.status ?? null,
        source: "supplierProducts.patch",
        requiresApprovalFlow,
      },
    });

    return res.json({ data: updated, warnings });
  } catch (e: any) {
    if (isPrismaUniqueErr(e) || e?.code === "DUPLICATE_PRODUCT_SUPPLIER_BRAND_SKU") {
      return res.status(409).json({
        error: "A product with this Supplier, Brand and SKU already exists.",
        code: "DUPLICATE_PRODUCT_SUPPLIER_BRAND_SKU",
        userMessage:
          "You already have a product for that brand/title. Please change title or brand.",
        meta: e?.meta,
      });
    }

    if (
      isNumericOverflowError(e) ||
      e?.code === "NUMERIC_FIELD_OVERFLOW" ||
      e?.code === "MONEY_LIMIT_EXCEEDED"
    ) {
      return res.status(400).json({
        error: "One or more money values are too large.",
        code: e?.code ?? "NUMERIC_FIELD_OVERFLOW",
        userMessage:
          e?.userMessage ??
          "The amount entered is too large for the current database limit. Please enter a smaller value.",
      });
    }

    const status = Number(e?.statusCode) || 500;
    console.error("[supplier.products PATCH] error:", e);

    return res.status(status).json({
      error: status >= 500 ? "Failed to save product changes" : e?.message || "Request failed",
      code: e?.code,
      userMessage:
        e?.userMessage ??
        "We couldn’t save your changes. Please review the form and try again.",
    });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const s = ctx.supplier;
    const id = requiredString(req.params.id);

    const productVariantsRel = "ProductVariant";
    const productBaseOffersRel = "supplierProductOffers";
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
            supplierId: true,
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
        supplierId: true,
        basePrice: true,
        currency: true,
        inStock: true,
        isActive: true,
        leadDays: true,
        availableQty: true,
        ...(modelHasField("SupplierProductOffer", "updatedAt") ? { updatedAt: true } : {}),
        ...(modelHasField("SupplierProductOffer", "createdAt") ? { createdAt: true } : {}),
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
          { supplierId: s.id } as any,
          ...(s.userId
            ? ([{ ownerId: s.userId } as any, { userId: s.userId } as any] as any[])
            : []),
          { status: { in: ["LIVE", "ACTIVE", "PUBLISHED"] as any } } as any,
        ],
      },
      include,
    });

    if (!p) return res.status(404).json({ error: "Not found" });

    const ownedBySupplier =
      String((p as any).supplierId ?? "") === String(s.id) ||
      (s.userId &&
        (String((p as any).ownerId ?? "") === String(s.userId) ||
          String((p as any).userId ?? "") === String(s.userId)));

    const myOffer = (p as any)[productBaseOffersRel]?.[0] ?? null;

    const basePrice = myOffer?.basePrice != null ? Number(myOffer.basePrice) : 0;
    const baseQty = myOffer?.availableQty ?? (p as any).availableQty ?? 0;
    const currency = myOffer?.currency ?? "NGN";

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
          select: {
            id: true,
            name: true,
            code: true,
            attributeId: true,
            isActive: true,
            position: true,
          },
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
              variantId: vo.variantId ?? v.id,
            }
            : null,
          options: Array.isArray(v?.[variantOptionsRel])
            ? v[variantOptionsRel].map((o: any) => ({
              attributeId: o.attributeId,
              valueId: o.valueId,
            }))
            : [],
        };
      })
      : [];

    const moderationByProduct = await getLatestModerationByProduct(String(s.id), [id]);
    const moderation = moderationByProduct[id] ?? {
      moderationStatus: null,
      moderationMessage: null,
      moderationReviewedAt: null,
    };

    const hasPendingChanges =
      Boolean((p as any).hasPendingChanges) ||
      moderation.moderationStatus === "PENDING" ||
      String((p as any).status ?? "").toUpperCase() === "PENDING";

    const isRejected =
      !hasPendingChanges && moderation.moderationStatus === "REJECTED";

    let pendingProductChanges: any[] = [];
    let pendingOfferChanges: any[] = [];

    if (ownedBySupplier) {
      const productChangeSelect: any = {
        id: true,
        status: true,
        proposedPatch: true,
        currentSnapshot: true,
        requestedByUserId: true,
      };

      if (modelHasField("ProductChangeRequest", "createdAt")) {
        productChangeSelect.createdAt = true;
      }
      if (modelHasField("ProductChangeRequest", "updatedAt")) {
        productChangeSelect.updatedAt = true;
      }
      if (modelHasField("ProductChangeRequest", "requestedAt")) {
        productChangeSelect.requestedAt = true;
      }

      const productChangeOrderBy =
        modelHasField("ProductChangeRequest", "updatedAt")
          ? ({ updatedAt: "desc" } as any)
          : modelHasField("ProductChangeRequest", "createdAt")
            ? ({ createdAt: "desc" } as any)
            : modelHasField("ProductChangeRequest", "requestedAt")
              ? ({ requestedAt: "desc" } as any)
              : undefined;

      pendingProductChanges = await prisma.productChangeRequest.findMany({
        where: {
          productId: id,
          supplierId: s.id,
          status: "PENDING",
        },
        select: productChangeSelect,
        ...(productChangeOrderBy ? { orderBy: productChangeOrderBy } : {}),
      });

      const offerChangeSelect: any = {
        id: true,
        scope: true,
        status: true,
        supplierProductOfferId: true,
        supplierVariantOfferId: true,
        patchJson: true,
        note: true,
        requestedByUserId: true,
      };

      if (modelHasField("SupplierOfferChangeRequest", "createdAt")) {
        offerChangeSelect.createdAt = true;
      }
      if (modelHasField("SupplierOfferChangeRequest", "updatedAt")) {
        offerChangeSelect.updatedAt = true;
      }
      if (modelHasField("SupplierOfferChangeRequest", "requestedAt")) {
        offerChangeSelect.requestedAt = true;
      }

      const offerChangeOrderBy =
        modelHasField("SupplierOfferChangeRequest", "updatedAt")
          ? ({ updatedAt: "desc" } as any)
          : modelHasField("SupplierOfferChangeRequest", "createdAt")
            ? ({ createdAt: "desc" } as any)
            : modelHasField("SupplierOfferChangeRequest", "requestedAt")
              ? ({ requestedAt: "desc" } as any)
              : undefined;

      pendingOfferChanges = await prisma.supplierOfferChangeRequest.findMany({
        where: {
          productId: id,
          supplierId: s.id,
          status: "PENDING",
        },
        select: offerChangeSelect,
        ...(offerChangeOrderBy ? { orderBy: offerChangeOrderBy } : {}),
      });
    }

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
            ...(myOffer.updatedAt != null ? { updatedAt: myOffer.updatedAt } : {}),
            ...(myOffer.createdAt != null ? { createdAt: myOffer.createdAt } : {}),
          }
          : null,

        variants,

        pendingProductChanges,
        productChangeRequests: pendingProductChanges,

        pendingOfferChanges,
        offerChangeRequests: pendingOfferChanges,

        hasPendingChanges,
        moderationStatus: hasPendingChanges ? "PENDING" : moderation.moderationStatus,
        moderationMessage: isRejected ? moderation.moderationMessage : null,
        moderationReviewedAt: isRejected ? moderation.moderationReviewedAt : null,
      },
    });
  } catch (e: any) {
    console.error("GET /api/supplier/products/:id failed:", e);
    return res.status(500).json({
      error: e?.message || "Failed to load supplier product",
    });
  }
});

export default router;