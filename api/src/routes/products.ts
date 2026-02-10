// api/src/routes/products.ts
import { Router } from "express";
import express from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const router = Router();

const wrap =
  (fn: express.RequestHandler): express.RequestHandler =>
    (req, res, next) =>
      Promise.resolve(fn(req, res, next)).catch(next);

function toNumber(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function toNum(d: any): number | null {
  if (d == null) return null;

  // ✅ REQUIRED: handle Prisma Decimal safely
  if (typeof d === "object" && d && typeof (d as any).toNumber === "function") {
    const n = (d as any).toNumber();
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

/* -------------------------------------------------------------------------- */
/* Schema-safe helpers (public routes must not assume fields exist)            */
/* -------------------------------------------------------------------------- */

function getModelFields(modelName: string): Map<string, any> {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelName);
  return new Map((m?.fields ?? []).map((f) => [f.name, f]));
}
function hasScalar(modelName: string, fieldName: string) {
  const f = getModelFields(modelName).get(fieldName);
  return !!f && f.kind === "scalar";
}
function hasRelation(modelName: string, fieldName: string) {
  const f = getModelFields(modelName).get(fieldName);
  return !!f && f.kind === "object";
}

const PRODUCT_MODEL = "Product";
const VARIANT_MODEL = "ProductVariant";

function productActiveWhere() {
  const where: any = {};
  if (hasScalar(PRODUCT_MODEL, "isDeleted")) where.isDeleted = false;
  if (hasScalar(PRODUCT_MODEL, "isDelete")) where.isDelete = false;
  if (hasScalar(PRODUCT_MODEL, "isArchived")) where.isArchived = false;
  if (hasScalar(PRODUCT_MODEL, "isActive")) where.isActive = true;
  // common “archivedAt” pattern
  if (hasScalar(PRODUCT_MODEL, "archivedAt")) where.archivedAt = null;
  return Object.keys(where).length ? where : {};
}

function variantActiveWhere() {
  const where: any = {};
  if (hasScalar(VARIANT_MODEL, "isActive")) where.isActive = true;
  if (hasScalar(VARIANT_MODEL, "isDeleted")) where.isDeleted = false;
  if (hasScalar(VARIANT_MODEL, "isDelete")) where.isDelete = false;
  if (hasScalar(VARIANT_MODEL, "isArchived")) where.isArchived = false;
  if (hasScalar(VARIANT_MODEL, "archivedAt")) where.archivedAt = null;
  return Object.keys(where).length ? where : undefined;
}

/**
 * Build a small “attributes summary” array for list cards/search UI.
 */
function buildAttributesSummary(p: any): Array<{ attribute: string; value: string }> {
  const out: Array<{ attribute: string; value: string }> = [];

  const opts = Array.isArray(p.attributeOptions) ? p.attributeOptions : [];
  for (const o of opts) {
    const an = o?.attribute?.name;
    const vn = o?.value?.name;
    if (an && vn) out.push({ attribute: String(an), value: String(vn) });
  }

  const texts = Array.isArray(p.ProductAttributeText) ? p.ProductAttributeText : [];
  for (const t of texts) {
    const an = t?.attribute?.name;
    const val = t?.value;
    if (an && val) out.push({ attribute: String(an), value: String(val) });
  }

  return out;
}

/**
 * Compute cheapest *effective* offer price from supplier offers.
 * (kept for compatibility / analytics; NOT used for retail display price anymore)
 *
 * ✅ Supplier variant pricing uses SupplierVariantOffer.unitPrice (final price),
 * NO "bump" math anywhere.
 */
function computeOffersFrom(p: any): number | null {
  let min = Infinity;

  // base offers (final base price)
  for (const bo of p.supplierProductOffers ?? []) {
    if (bo?.isActive === false || bo?.inStock === false) continue;
    if ((bo?.availableQty ?? 0) <= 0) continue;

    const n = toNum(bo.basePrice);
    if (n != null && n > 0) min = Math.min(min, n);
  }

  // variant offers (final unit price)
  for (const v of p.ProductVariant ?? []) {
    for (const vo of v.supplierVariantOffers ?? []) {
      if (vo?.isActive === false || vo?.inStock === false) continue;
      if ((vo?.availableQty ?? 0) <= 0) continue;

      const unit = toNum((vo as any).unitPrice);
      if (unit != null && unit > 0) min = Math.min(min, unit);
    }
  }

  return min === Infinity ? null : min;
}

/* ---------------- LIST: GET /api/products ---------------- */

const QSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(), // LIVE | PUBLISHED | ANY | ALL | PENDING | REJECTED
  take: z.coerce.number().optional(),
  skip: z.coerce.number().optional(),
  include: z.string().optional(), // brand,category,variants,attributes,offers
});

/**
 * ✅ Retail-only public price
 * - If priceMode=ADMIN and retailPrice>0 => retailPrice
 * - Else if autoPrice>0 => autoPrice
 * - Else retailPrice (nullable)
 *
 * IMPORTANT: offersFrom (supplier price) is NOT used here.
 */
function computePublicDisplayPriceRetailOnly(p: any) {
  const mode = String(p?.priceMode ?? "AUTO").toUpperCase();
  const retail = p?.retailPrice != null ? toNum(p.retailPrice) : null;
  const auto = p?.autoPrice != null ? toNum(p.autoPrice) : null;

  if (mode === "ADMIN") {
    return retail != null && retail > 0 ? retail : null;
  }

  if (auto != null && auto > 0) return auto;
  if (retail != null && retail > 0) return retail;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Supplier payout-ready filtering (PUBLIC routes)                             */
/* -------------------------------------------------------------------------- */

const SUPPLIER_MODEL = "Supplier";
const BASE_OFFER_MODEL = "SupplierProductOffer";
const VAR_OFFER_MODEL = "SupplierVariantOffer";

/**
 * Build a schema-safe Supplier "payout-ready" where clause.
 * If your Supplier model doesn't have a field, it is ignored.
 */
function supplierPayoutReadyWhere() {
  const where: any = {};

  // switch / gate (optional)
  if (hasScalar(SUPPLIER_MODEL, "isPayoutEnabled")) where.isPayoutEnabled = true;
  if (hasScalar(SUPPLIER_MODEL, "payoutEnabled")) where.payoutEnabled = true;

  // common bank fields (optional, but if present we enforce non-null)
  const nonNull = { not: null };

  if (hasScalar(SUPPLIER_MODEL, "accountNumber")) where.accountNumber = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankAccountNumber")) where.bankAccountNumber = nonNull;

  if (hasScalar(SUPPLIER_MODEL, "accountName")) where.accountName = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankAccountName")) where.bankAccountName = nonNull;

  if (hasScalar(SUPPLIER_MODEL, "bankCode")) where.bankCode = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankName")) where.bankName = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankCountry")) where.bankCountry = nonNull;

  // verification status if present
  if (hasScalar(SUPPLIER_MODEL, "bankVerificationStatus")) where.bankVerificationStatus = "VERIFIED";

  return Object.keys(where).length ? where : {};
}

/**
 * Attach supplier payout-ready filter to offer models, schema-safely.
 * If your offer model does NOT have a `supplier` relation, it returns {} to avoid breaking.
 */
function offerSupplierPayoutReadyWhere(offerModelName: string, enforce: boolean) {
  if (!enforce) return {}; // ✅ allow all offers

  if (hasRelation(offerModelName, "supplier")) {
    const sw = supplierPayoutReadyWhere();
    return Object.keys(sw).length ? { supplier: sw } : {};
  }
  return {};
}


/* -------------------------------------------------------------------------- */
/* Supplier ratings (schema-safe + works even if Product.supplierId is null)  */
/* -------------------------------------------------------------------------- */

function supplierRatingSelect() {
  const sel: any = { id: true };
  if (hasScalar(SUPPLIER_MODEL, "ratingAvg")) sel.ratingAvg = true;
  if (hasScalar(SUPPLIER_MODEL, "ratingCount")) sel.ratingCount = true;
  return sel;
}

function readSupplierRatingFromOffer(o: any): { supplierId: string; ratingAvg: number; ratingCount: number } {
  const sid = String(o?.supplierId ?? o?.supplier?.id ?? "");
  const avgRaw = o?.supplier?.ratingAvg;
  const cntRaw = o?.supplier?.ratingCount;

  const ratingAvg = toNum(avgRaw) ?? 0; // Decimal-safe
  const ratingCount = Number(cntRaw ?? 0) || 0;

  return { supplierId: sid, ratingAvg, ratingCount };
}

/**
 * Bayesian-ish smoothing so low counts don’t dominate.
 * Tune these later if you want.
 */
const PRIOR_AVG = 4.0;
const PRIOR_COUNT = 5;

function ratingScore(avg: number, count: number) {
  const c = Math.max(0, count || 0);
  const a = Number.isFinite(avg) ? avg : 0;
  return (a * c + PRIOR_AVG * PRIOR_COUNT) / (c + PRIOR_COUNT);
}

function pickBestRating(ratings: Array<{ ratingAvg: number; ratingCount: number }>) {
  let best: { ratingAvg: number; ratingCount: number; score: number } | null = null;

  for (const r of ratings) {
    const score = ratingScore(r.ratingAvg, r.ratingCount);
    if (!best || score > best.score) best = { ...r, score };
  }

  return best ? { ratingAvg: best.ratingAvg, ratingCount: best.ratingCount } : null;
}

// ---------------- LIST: GET /api/products ----------------
router.get(
  "/",
  wrap(async (req, res) => {
    const parsed = QSchema.parse(req.query ?? {});
    const q = String(parsed.q ?? "").trim();

    // current behavior you had (public catalogue defaults to LIVE)
    const statusRaw = "LIVE";
    const isLive = true;
    const isAny = false;
    const isDb = false;

    const take = Math.min(100, Math.max(1, Number(parsed.take ?? 24)));
    const skip = Math.max(0, Number(parsed.skip ?? 0));

    const includeParam = String((req.query as any).include ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const wantBrand = includeParam.includes("brand");
    const wantCategory = includeParam.includes("category");
    const wantVariants = includeParam.includes("variants");
    const wantAttributes = includeParam.includes("attributes");
    const wantOffers = includeParam.includes("offers");

    const needOffers = wantOffers || statusRaw === "LIVE";

    if (!isAny && !isLive && !isDb) {
      return res.status(400).json({ error: `Invalid status "${statusRaw}"` });
    }

    const dec0 = new Prisma.Decimal("0");

    const baseWhere: Prisma.ProductWhereInput = {
      ...(productActiveWhere() as any),
      ...(isDb ? { status: statusRaw as any } : {}),
      ...(isLive ? { status: "LIVE" as any } : {}),
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

    /**
     * ✅ Eligibility for listing:
     * Keep your current logic (retail/auto/variant retail OR supplier offers),
     * BUT for PUBLIC routes we only count supplier offers from payout-ready suppliers.
     *
     * ✅ IMPORTANT: No bump logic anywhere.
     */
    const payoutWhereBaseOffer = offerSupplierPayoutReadyWhere(BASE_OFFER_MODEL, true);
    const payoutWhereVarOffer = offerSupplierPayoutReadyWhere(VAR_OFFER_MODEL, true);

    const [priceProducts, variantPriceProducts, baseOfferProducts, variantOfferProducts] =
      await Promise.all([
        prisma.product.findMany({
          where: {
            ...baseWhere,
            OR: [{ retailPrice: { gt: dec0 } }, { autoPrice: { gt: dec0 } }],
          },
          select: { id: true },
        }),
        prisma.productVariant.findMany({
          where: {
            retailPrice: { gt: dec0 },
            product: baseWhere,
          } as any,
          select: { productId: true },
        }),

        prisma.supplierProductOffer.findMany({
          where: {
            isActive: true,
            basePrice: { gt: dec0 },
            product: baseWhere,
            ...(payoutWhereBaseOffer as any), // payout-ready suppliers only
          } as any,
          select: { productId: true },
        }),

        prisma.supplierVariantOffer.findMany({
          where: {
            isActive: true,
            product: baseWhere,
            ...(payoutWhereVarOffer as any), // payout-ready suppliers only
          } as any,
          select: { productId: true },
        }),
      ]);

    const eligibleIdSet = new Set<string>();
    for (const r of priceProducts as any[]) eligibleIdSet.add(String(r.id));
    for (const r of variantPriceProducts as any[]) eligibleIdSet.add(String(r.productId));
    for (const r of baseOfferProducts as any[]) eligibleIdSet.add(String(r.productId));
    for (const r of variantOfferProducts as any[]) eligibleIdSet.add(String(r.productId));

    const finalIds = Array.from(eligibleIdSet);

    if (!finalIds.length) return res.json({ data: [], total: 0 });

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: finalIds } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select: {
          id: true,
          title: true,
          description: true,
          sku: true,

          retailPrice: true,
          autoPrice: true,
          priceMode: true,

          // ✅ needed to compute (supplierOfferPrice + marginPct)
          commissionPctInt: true,

          inStock: true,
          imagesJson: true,
          categoryId: true,
          brandId: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.product.count({
        where: { id: { in: finalIds } },
      }),
    ]);

    const ids = items.map((p: { id: any }) => String(p.id));

    const categoryIds = Array.from(
      new Set(items.map((p: { categoryId: any }) => p.categoryId).filter(Boolean))
    ) as string[];
    const brandIds = Array.from(
      new Set(items.map((p: { brandId: any }) => p.brandId).filter(Boolean))
    ) as string[];

    const [cats, brands] = await Promise.all([
      wantCategory && categoryIds.length
        ? prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, slug: true },
        })
        : Promise.resolve([]),
      wantBrand && brandIds.length
        ? prisma.brand.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, name: true },
        })
        : Promise.resolve([]),
    ]);

    type CatLite = { id: string; name: string | null };
    type BrandLite = { id: string; name: string | null };

    const catMap = new Map<string, CatLite>();
    const brandMap = new Map<string, BrandLite>();

    for (const c of cats as any[]) {
      catMap.set(String(c.id), { id: String(c.id), name: c.name != null ? String(c.name) : null });
    }
    for (const b of brands as any[]) {
      brandMap.set(String(b.id), { id: String(b.id), name: b.name != null ? String(b.name) : null });
    }

    const vWhere = variantActiveWhere();
    const variantsRows =
      wantVariants || needOffers
        ? await prisma.productVariant.findMany({
          where: {
            productId: { in: ids },
            ...(vWhere ? vWhere : {}),
          } as any,
          select: {
            id: true,
            productId: true,
            sku: true,
            retailPrice: true,
            inStock: true,
            imagesJson: true,
            availableQty: true,
          },
          orderBy: { createdAt: "asc" },
        })
        : [];

    const variantsByProduct = new Map<string, any[]>();
    const variantIdsAll: string[] = [];
    for (const v of variantsRows as any[]) {
      const pid = String(v.productId);
      const list = variantsByProduct.get(pid) ?? [];
      list.push(v);
      variantsByProduct.set(pid, list);
      variantIdsAll.push(String(v.id));
    }

    /**
     * ✅ Offers: restrict returned offers to payout-ready suppliers
     */
    const baseOffers =
      needOffers
        ? await prisma.supplierProductOffer.findMany({
          where: {
            productId: { in: ids },
            isActive: true,
            ...(offerSupplierPayoutReadyWhere(BASE_OFFER_MODEL, false) as any),
          } as any,
          select: {
            id: true,
            productId: true,
            supplierId: true,
            basePrice: true,
            inStock: true,
            isActive: true,
            availableQty: true,
            currency: true,
            leadDays: true,

            ...(hasRelation(BASE_OFFER_MODEL, "supplier")
              ? { supplier: { select: supplierRatingSelect() } }
              : {}),
          },
        })
        : [];

    const baseBySupplierByProduct = new Map<string, Map<string, number>>();
    const baseQtyByProduct = new Map<string, number>();
    const minBasePriceByProduct = new Map<string, number>();

    // ratings aggregated from offers (NOT Product.supplierId)
    const ratingsByProduct = new Map<string, Array<{ ratingAvg: number; ratingCount: number }>>();
    const ratingsByVariant = new Map<string, Array<{ ratingAvg: number; ratingCount: number }>>();
    for (const pid of ids) ratingsByProduct.set(pid, []);

    for (const o of baseOffers as any[]) {
      const pid = String(o.productId);
      const sid = String(o.supplierId);
      const bp = toNum(o.basePrice) ?? 0;

      if (!baseBySupplierByProduct.has(pid)) baseBySupplierByProduct.set(pid, new Map());
      baseBySupplierByProduct.get(pid)!.set(sid, bp);

      // qty used for "inStock" badge (still requires actual qty)
      if (o.isActive === true && o.inStock === true) {
        const qty = Number(o.availableQty ?? 0) || 0;
        if (qty > 0) {
          baseQtyByProduct.set(pid, (baseQtyByProduct.get(pid) ?? 0) + qty);
        }

        // ✅ seed cheapest PURCHASABLE base offer
        if (bp > 0 && qty > 0) {
          const cur = minBasePriceByProduct.get(pid);
          if (cur == null || bp < cur) minBasePriceByProduct.set(pid, bp);
        }
      }

      // ratings (attach even if out of stock, but only if present)
      const r = readSupplierRatingFromOffer(o);
      if (r.supplierId) {
        const arr = ratingsByProduct.get(pid) ?? [];
        arr.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
        ratingsByProduct.set(pid, arr);
      }
    }

    const variantOffers =
      needOffers && variantIdsAll.length
        ? await prisma.supplierVariantOffer.findMany({
          where: {
            variantId: { in: variantIdsAll },
            isActive: true,
            ...(offerSupplierPayoutReadyWhere(VAR_OFFER_MODEL, false) as any),
          } as any,
          select: {
            id: true,
            variantId: true,
            supplierId: true,
            inStock: true,
            isActive: true,
            availableQty: true,

            // ✅ Schema: SupplierVariantOffer.unitPrice is the final unit price
            unitPrice: true,

            currency: true,
            leadDays: true,
            supplierProductOfferId: true,
            productId: true,

            ...(hasRelation(VAR_OFFER_MODEL, "supplier")
              ? { supplier: { select: supplierRatingSelect() } }
              : {}),
          } as any,
        })
        : [];

    const variantOffersByVariant = new Map<string, any[]>();
    const variantQtyByProduct = new Map<string, number>();
    const offersFromByProduct = new Map<string, number | null>();

    const variantToProduct = new Map<string, string>();
    for (const v of variantsRows as any[]) variantToProduct.set(String(v.id), String(v.productId));

    for (const pid of ids) {
      const seed = minBasePriceByProduct.get(pid);
      offersFromByProduct.set(pid, seed != null ? seed : null);
    }

    for (const o of variantOffers as any[]) {
      const vid = String(o.variantId);
      const pid = variantToProduct.get(vid) ?? String(o.productId ?? "");
      if (!pid) continue;

      const list = variantOffersByVariant.get(vid) ?? [];
      list.push(o);
      variantOffersByVariant.set(vid, list);

      // qty used for "inStock" badge (still requires actual qty)
      if (o.isActive === true && o.inStock === true) {
        const qty = Number(o.availableQty ?? 0) || 0;
        if (qty > 0) {
          variantQtyByProduct.set(pid, (variantQtyByProduct.get(pid) ?? 0) + qty);
        }
      }

      // ✅ offersFrom compatibility: cheapest PURCHASABLE supplier offer
      // Use unitPrice if present, else fall back to base price for that supplier (NO bump math).
      // IMPORTANT: only count offers that are actually purchasable: inStock && qty>0
      if (o.isActive === true && o.inStock === true) {
        const qty = Number(o.availableQty ?? 0) || 0;
        if (qty > 0) {
          const unit = toNum((o as any).unitPrice);
          let effective = unit != null && unit > 0 ? unit : null;

          if (effective == null) {
            const baseMap = baseBySupplierByProduct.get(pid) ?? new Map<string, number>();
            const base = baseMap.get(String(o.supplierId));
            if (base != null && base > 0) effective = base;
          }

          if (effective != null && effective > 0) {
            const cur = offersFromByProduct.get(pid);
            const curMin = cur == null ? Infinity : Number(cur);
            offersFromByProduct.set(pid, Math.min(curMin, effective));
          }
        }
      }

      // ratings from variant offers (product-level + variant-level)
      const r = readSupplierRatingFromOffer(o);
      if (r.supplierId) {
        const parr = ratingsByProduct.get(pid) ?? [];
        parr.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
        ratingsByProduct.set(pid, parr);

        const varr = ratingsByVariant.get(vid) ?? [];
        varr.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
        ratingsByVariant.set(vid, varr);
      }
    }

    for (const pid of ids) {
      const v = offersFromByProduct.get(pid);
      if (v == null) continue;
      if (!Number.isFinite(Number(v))) offersFromByProduct.set(pid, null);
    }

    const [attrOpts, attrTexts] = wantAttributes
      ? await Promise.all([
        prisma.productAttributeOption.findMany({
          where: { productId: { in: ids } },
          include: {
            attribute: { select: { id: true, name: true, type: true } },
            value: { select: { id: true, name: true, code: true } },
          },
        }),
        prisma.productAttributeText.findMany({
          where: { productId: { in: ids } },
          include: {
            attribute: { select: { id: true, name: true, type: true } },
          },
        }),
      ])
      : [[], []];

    const attrByProduct = new Map<string, { values: any[]; texts: any[]; summary: any[] }>();
    for (const pid of ids) attrByProduct.set(pid, { values: [], texts: [], summary: [] });

    for (const o of attrOpts as any[]) {
      const pid = String(o.productId);
      const bucket = attrByProduct.get(pid);
      if (!bucket) continue;
      bucket.values.push({
        id: o.id,
        attribute: { id: o.attribute.id, name: o.attribute.name, type: o.attribute.type },
        value: { id: o.value.id, name: o.value.name, code: o.value.code ?? null },
      });
      bucket.summary.push({ attribute: o.attribute.name, value: o.value.name });
    }

    for (const t of attrTexts as any[]) {
      const pid = String(t.productId);
      const bucket = attrByProduct.get(pid);
      if (!bucket) continue;
      bucket.texts.push({
        id: t.id,
        attribute: { id: t.attribute.id, name: t.attribute.name, type: t.attribute.type },
        value: t.value,
      });
      bucket.summary.push({ attribute: t.attribute.name, value: t.value });
    }

    res.setHeader("Cache-Control", "no-store");

    // ✅ helper: compute retail display from offer price + margin percent
    const computeRetailFromOfferAndMargin = (offerPrice: number | null, commissionPctInt: any) => {
      const op = offerPrice != null ? Number(offerPrice) : NaN;
      if (!Number.isFinite(op) || op <= 0) return null;

      const m = Number(commissionPctInt);
      const pct = Number.isFinite(m) && m > 0 ? m : 0;

      const out = op * (1 + pct / 100);
      return Number.isFinite(out) && out > 0 ? out : null;
    };

    const data = items.map((p: any) => {
      const pid = String(p.id);

      const cat = wantCategory && p.categoryId ? catMap.get(String(p.categoryId)) : null;
      const br = wantBrand && p.brandId ? brandMap.get(String(p.brandId)) : null;

      const baseQty = baseQtyByProduct.get(pid) ?? 0;
      const varQty = variantQtyByProduct.get(pid) ?? 0;

      // if any variant qty exists, treat it as the signal, otherwise base qty
      const effectiveQty = varQty > 0 ? varQty : baseQty;

      const bestProductRating = pickBestRating(ratingsByProduct.get(pid) ?? []);

      const variantsOut = wantVariants
        ? (variantsByProduct.get(pid) ?? []).map((v: any) => {
          const vid = String(v.id);
          const vOffers = needOffers ? variantOffersByVariant.get(vid) ?? [] : [];

          const vQty = needOffers
            ? vOffers.reduce((acc: number, x: any) => {
              if (x?.isActive !== true) return acc;
              if (x?.inStock !== true) return acc;
              const qn = Number(x?.availableQty ?? 0) || 0;
              return acc + (qn > 0 ? qn : 0);
            }, 0)
            : 0;

          const bestVariantRating = pickBestRating(ratingsByVariant.get(vid) ?? []);

          return {
            id: vid,
            sku: v.sku ?? null,
            retailPrice: v.retailPrice != null ? toNum(v.retailPrice) : null,
            inStock: vQty > 0 || v.inStock === true,
            imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
            availableQty: vQty,

            offers: needOffers
              ? vOffers.map((o: any) => {
                const r = readSupplierRatingFromOffer(o);
                return {
                  id: String(o.id),
                  supplierId: r.supplierId,

                  isActive: o.isActive === true,
                  inStock: o.inStock === true,
                  availableQty: Number(o.availableQty ?? 0) || 0,

                  // ✅ expose unitPrice for frontend to compute retail display if needed
                  unitPrice: o.unitPrice != null ? toNum(o.unitPrice) : null,

                  supplier: {
                    id: r.supplierId,
                    ratingAvg: r.ratingAvg,
                    ratingCount: r.ratingCount,
                  },
                };
              })
              : [],

            bestSupplierRating: bestVariantRating,
          };
        })
        : [];

      const attrs = attrByProduct.get(pid);
      const offersFrom = needOffers ? (offersFromByProduct.get(pid) ?? null) : null;

      const retailPrice = p.retailPrice != null ? toNum(p.retailPrice) : null;
      const autoPrice = p.autoPrice != null ? toNum(p.autoPrice) : null;

      // ✅ NEW: computed retail from cheapest supplier offer (offersFrom) + commissionPctInt
      const offerRetail = computeRetailFromOfferAndMargin(offersFrom, p.commissionPctInt);

      // ✅ Prefer refreshed offer retail when available; fallback to your existing retail/auto logic
      const retailOnly = computePublicDisplayPriceRetailOnly(p);
      const displayPrice = offerRetail != null ? offerRetail : retailOnly;

      return {
        id: pid,
        title: p.title,
        description: p.description,

        // ✅ price that the catalogue should display (now refreshes from supplier offers)
        retailPrice: displayPrice,
        autoPrice,
        priceMode: p.priceMode ?? null,

        // ✅ send margin percent to frontend too
        commissionPctInt: p.commissionPctInt != null ? Number(p.commissionPctInt) : null,

        // drives your "Out of stock" badge
        inStock: effectiveQty > 0 || p.inStock === true,

        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        categoryId: p.categoryId ?? null,
        categoryName: wantCategory ? (cat?.name ?? null) : null,

        brand: wantBrand ? (br ? { id: br.id, name: br.name } : null) : null,
        brandName: wantBrand ? (br?.name ?? null) : null,

        status: "LIVE",

        offersFrom,

        bestSupplierRating: bestProductRating,

        supplierOffers: needOffers
          ? (baseOffers as any[])
            .filter((o: any) => String(o.productId) === pid)
            .map((o: any) => {
              const r = readSupplierRatingFromOffer(o);
              return {
                id: String(o.id),
                supplierId: String(o.supplierId),

                isActive: o.isActive === true,
                inStock: o.inStock === true,
                availableQty: Number(o.availableQty ?? 0) || 0,

                // ✅ expose basePrice for frontend to compute retail display if needed
                basePrice: o.basePrice != null ? toNum(o.basePrice) : null,

                supplier: {
                  id: r.supplierId,
                  ratingAvg: r.ratingAvg,
                  ratingCount: r.ratingCount,
                },
              };
            })
          : [],

        variants: variantsOut,

        attributesSummary: wantAttributes ? attrs?.summary ?? [] : [],
      };
    });

    res.json({ data, total });
  })
);


/* ---------------- SIMILAR: must be before '/:id' ---------------- */

router.get(
  "/:id/similar",
  wrap(async (req, res) => {
    const { id } = req.params;

    const me = await prisma.product.findFirst({
      where: { id, status: "LIVE" as any, ...(productActiveWhere() as any) },
      select: { id: true, retailPrice: true, categoryId: true },
    });
    if (!me) return res.status(404).json({ error: "Product not found" });

    let results = await prisma.product.findMany({
      where: {
        id: { not: id },
        status: "LIVE" as any,
        ...(productActiveWhere() as any),
        ...(me.categoryId ? { categoryId: me.categoryId } : {}),
      },
      take: 12,
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, retailPrice: true, imagesJson: true, inStock: true },
    });

    if (results.length < 6) {
      const price = toNumber(me.retailPrice);
      const byPrice = await prisma.product.findMany({
        where: {
          id: { not: id },
          status: "LIVE" as any,
          ...(productActiveWhere() as any),
          retailPrice: { gte: Math.max(0, price * 0.6), lte: price * 1.4 },
        },
        take: 12,
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, retailPrice: true, imagesJson: true, inStock: true },
      });

      const seen = new Set(results.map((r: any) => r.id));
      for (const p of byPrice) if (!seen.has(p.id)) results.push(p);
      results = results.slice(0, 12);
    }

    res.json(
      results.map((p: any) => ({
        id: p.id,
        title: p.title,
        retailPrice: p.retailPrice != null ? toNum(p.retailPrice) : null,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        inStock: p.inStock !== false,
      }))
    );
  })
);

/* ---------------- GET /api/products/:id ---------------- */

router.get(
  "/:id",
  wrap(async (req, res) => {
    const { id } = req.params;

    const includeParam = String(req.query.include || "").toLowerCase();
    const wantBrand = includeParam.includes("brand");
    const wantCategory = includeParam.includes("category");
    const wantVariants = includeParam.includes("variants");
    const wantAttributes = includeParam.includes("attributes");
    const wantOffers = includeParam.includes("offers");

    const vWhere = variantActiveWhere();

    const p = await prisma.product.findFirst({
      where: { id, ...(productActiveWhere() as any) } as any,
      include: {
        ...(wantBrand && { brand: { select: { id: true, name: true } } }),
        ...(wantCategory && { category: { select: { id: true, name: true, slug: true } } }),

        ...(wantVariants && {
          ProductVariant: {
            ...(vWhere ? { where: vWhere } : {}),
            include: {
              // ✅ schema: relation is "options"
              options: {
                include: {
                  attribute: { select: { id: true, name: true, type: true } },
                  value: { select: { id: true, name: true, code: true } },
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        }),

        ...(wantAttributes && {
          attributeOptions: {
            include: {
              attribute: { select: { id: true, name: true, type: true } },
              value: { select: { id: true, name: true, code: true } },
            },
            orderBy: [{ attribute: { name: "asc" } }],
          },
          ProductAttributeText: {
            include: { attribute: { select: { id: true, name: true, type: true } } },
            orderBy: [{ attribute: { name: "asc" } }],
          },
        }),
      } as any,
    });

    if (!p) return res.status(404).json({ error: "Not found" });

    const retailPrice = (p as any).retailPrice != null ? toNum((p as any).retailPrice) : null;
    const autoPrice = (p as any).autoPrice != null ? toNum((p as any).autoPrice) : null;
    const priceMode = (p as any).priceMode ?? null;

    const data: any = {
      id: p.id,
      title: p.title,
      description: p.description,

      // expose these like admin does
      retailPrice,
      autoPrice,
      priceMode,

      inStock: p.inStock,
      imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
    };

    if (wantCategory) {
      data.categoryId = (p as any).categoryId ?? null;
      data.categoryName = (p as any).category?.name ?? null;
      data.category = (p as any).category ? { id: (p as any).category.id, name: (p as any).category.name } : null;
    }

    if (wantBrand) {
      data.brand = (p as any).brand ? { id: (p as any).brand.id, name: (p as any).brand.name } : null;
    }

    if (wantVariants) {
      const variants = (p as any).ProductVariant ?? [];
      data.variants = variants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        retailPrice: v.retailPrice != null ? toNum(v.retailPrice) : null,
        inStock: v.inStock,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],

        // ✅ IMPORTANT: no "bump" field exists in schema.
        // ProductVariantOption uses `unitPrice` (optional) as the option-specific price.
        options: (v.options || []).map((o: any) => ({
          attributeId: String(o.attributeId),
          valueId: String(o.valueId),
          unitPrice: o.unitPrice != null ? toNum(o.unitPrice) : null,
          attribute: { id: o.attribute.id, name: o.attribute.name, type: o.attribute.type },
          value: { id: o.value.id, name: o.value.name, code: o.value.code ?? null },
        })),
      }));
    }

    if (wantAttributes) {
      data.attributes =
        (p as any).attributeOptions?.map((o: any) => ({
          attributeId: o.attribute.id,
          attributeName: o.attribute.name,
          valueId: o.value.id,
          valueName: o.value.name,
        })) ?? [];

      data.attributeTexts =
        (p as any).ProductAttributeText?.map((t: any) => ({
          attributeId: t.attribute.id,
          attributeName: t.attribute.name,
          value: t.value,
        })) ?? [];

      // explicit base defaults for the UI
      data.attributeSelections =
        (p as any).attributeOptions?.map((o: any) => ({
          attributeId: String(o.attribute.id),
          valueId: String(o.value.id),
        })) ?? [];
    }

    if (wantOffers) {
      const [baseOffers, variantOffers] = await Promise.all([
        prisma.supplierProductOffer.findMany({
          where: {
            productId: id,
            isActive: true,
            ...(offerSupplierPayoutReadyWhere(BASE_OFFER_MODEL, false) as any),
          } as any,
          select: {
            id: true,
            supplierId: true,
            productId: true,
            basePrice: true,
            currency: true,
            availableQty: true,
            inStock: true,
            isActive: true,
            leadDays: true,

            ...(hasRelation(BASE_OFFER_MODEL, "supplier") ? { supplier: { select: supplierRatingSelect() } } : {}),
          },
        }),
        prisma.supplierVariantOffer.findMany({
          where: {
            productId: id,
            isActive: true,
            ...(offerSupplierPayoutReadyWhere(VAR_OFFER_MODEL, false) as any),
          } as any,
          select: {
            id: true,
            variantId: true,
            supplierId: true,
            inStock: true,
            isActive: true,
            availableQty: true,

            // ✅ schema: final unit price (no bump)
            unitPrice: true,

            currency: true,
            leadDays: true,
            supplierProductOfferId: true,
            productId: true,

            ...(hasRelation(VAR_OFFER_MODEL, "supplier") ? { supplier: { select: supplierRatingSelect() } } : {}),
          } as any,
        }),
      ]);

      // For fallback only: if unitPrice missing, use basePrice (NO bump math).
      const baseByOfferId = new Map<string, number>();
      const baseBySupplier = new Map<string, number>();

      const ratingsAll: Array<{ ratingAvg: number; ratingCount: number }> = [];

      for (const bo of baseOffers as any[]) {
        const bp = bo.basePrice != null ? (toNum(bo.basePrice) ?? 0) : 0;
        baseByOfferId.set(String(bo.id), bp);
        baseBySupplier.set(String(bo.supplierId), bp);

        const r = readSupplierRatingFromOffer(bo);
        if (r.supplierId) ratingsAll.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
      }
      for (const vo of variantOffers as any[]) {
        const r = readSupplierRatingFromOffer(vo);
        if (r.supplierId) ratingsAll.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
      }

      data.bestSupplierRating = pickBestRating(ratingsAll);

      data.offers = [
        ...baseOffers.map((o: any) => {
          const r = readSupplierRatingFromOffer(o);
          return {
            id: String(o.id),
            supplierId: String(o.supplierId),
            productId: String(o.productId),
            variantId: null,
            currency: o.currency ?? "NGN",
            inStock: o.inStock === true,
            isActive: o.isActive === true,
            availableQty: Number(o.availableQty ?? 0) || 0,
            leadDays: o.leadDays ?? null,
            basePrice: o.basePrice != null ? toNum(o.basePrice) : null,
            unitPrice: o.basePrice != null ? toNum(o.basePrice) : null, // ✅ so UI can always read unitPrice
            model: "BASE",
            supplier: {
              id: r.supplierId,
              ratingAvg: r.ratingAvg,
              ratingCount: r.ratingCount,
            },
          };
        }),

        // ✅ ALSO expose schema-shaped arrays so frontend can read them directly
        data.supplierProductOffers = baseOffers.map((o: any) => ({
          id: String(o.id),
          supplierId: String(o.supplierId),
          productId: String(o.productId),

          basePrice: o.basePrice != null ? toNum(o.basePrice) : null,
          currency: o.currency ?? "NGN",

          availableQty: Number(o.availableQty ?? 0) || 0,
          inStock: o.inStock === true,
          isActive: o.isActive === true,
          leadDays: o.leadDays ?? null,

          // ✅ include supplier name so ProductDetail can show it if needed
          supplier: o.supplier
            ? {
              id: String(o.supplier.id ?? o.supplierId),
              name: o.supplier.name ? String(o.supplier.name) : undefined,
              ratingAvg: o.supplier.ratingAvg != null ? toNum(o.supplier.ratingAvg) : undefined,
              ratingCount: Number(o.supplier.ratingCount ?? 0) || 0,
            }
            : undefined,
        })),

        data.supplierVariantOffers = variantOffers.map((o: any) => ({
          id: String(o.id),
          supplierId: String(o.supplierId),
          productId: String(o.productId),
          variantId: String(o.variantId),

          supplierProductOfferId: o.supplierProductOfferId ? String(o.supplierProductOfferId) : null,

          unitPrice: o.unitPrice != null ? toNum(o.unitPrice) : null,
          currency: o.currency ?? "NGN",

          availableQty: Number(o.availableQty ?? 0) || 0,
          inStock: o.inStock === true,
          isActive: o.isActive === true,
          leadDays: o.leadDays ?? null,

          supplier: o.supplier
            ? {
              id: String(o.supplier.id ?? o.supplierId),
              name: o.supplier.name ? String(o.supplier.name) : undefined,
              ratingAvg: o.supplier.ratingAvg != null ? toNum(o.supplier.ratingAvg) : undefined,
              ratingCount: Number(o.supplier.ratingCount ?? 0) || 0,
            }
            : undefined,
        })),


        // ✅ NO bump math. Use unitPrice; if missing, fallback to supplier base price.
        ...variantOffers.map((o: any) => {
          const unit = toNum((o as any).unitPrice);

          const fallbackBase =
            baseByOfferId.get(String(o.supplierProductOfferId)) ??
            baseBySupplier.get(String(o.supplierId)) ??
            0;

          const finalPrice = unit != null && unit > 0 ? unit : fallbackBase > 0 ? fallbackBase : null;

          const r = readSupplierRatingFromOffer(o);

          return {
            id: String(o.id),
            supplierId: String(o.supplierId),
            productId: String(o.productId),
            variantId: o.variantId ? String(o.variantId) : null,
            currency: o.currency ?? "NGN",
            inStock: o.inStock === true,
            isActive: o.isActive === true,
            availableQty: Number(o.availableQty ?? 0) || 0,
            leadDays: o.leadDays ?? null,

            // ✅ final supplier variant unit price
            unitPrice: finalPrice, // ✅ schema-consistent: SupplierVariantOffer.unitPrice

            model: "VARIANT",
            supplier: {
              id: r.supplierId,
              ratingAvg: r.ratingAvg,
              ratingCount: r.ratingCount,
            },
          };
        }),
      ];
    }



    res.json({ data });
  })
);

export default router;
