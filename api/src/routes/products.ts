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

  if (typeof d === "object" && d && typeof (d as any).toNumber === "function") {
    const n = (d as any).toNumber();
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

/* -------------------------------------------------------------------------- */
/* Schema-safe helpers                                                        */
/* -------------------------------------------------------------------------- */

function getModelFields(modelName: string): Map<string, any> {
  const m = Prisma.dmmf.datamodel.models.find((x: any) => x.name === modelName);
  return new Map((m?.fields ?? []).map((f: any) => [f.name, f]));
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

function productRowIsActive(row: any) {
  if (!row) return false;
  if (hasScalar(PRODUCT_MODEL, "isDeleted") && row.isDeleted === true) return false;
  if (hasScalar(PRODUCT_MODEL, "isDelete") && row.isDelete === true) return false;
  if (hasScalar(PRODUCT_MODEL, "isArchived") && row.isArchived === true) return false;
  if (hasScalar(PRODUCT_MODEL, "archivedAt") && row.archivedAt != null) return false;
  if (hasScalar(PRODUCT_MODEL, "isActive") && row.isActive !== true) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Supplier payout-ready helpers                                              */
/* -------------------------------------------------------------------------- */

const SUPPLIER_MODEL = "Supplier";
const BASE_OFFER_MODEL = "SupplierProductOffer";
const VAR_OFFER_MODEL = "SupplierVariantOffer";

function supplierPayoutReadyWhere() {
  const where: any = {};

  if (hasScalar(SUPPLIER_MODEL, "isPayoutEnabled")) where.isPayoutEnabled = true;
  if (hasScalar(SUPPLIER_MODEL, "payoutEnabled")) where.payoutEnabled = true;

  const nonNull = { not: null as any };

  if (hasScalar(SUPPLIER_MODEL, "accountNumber")) where.accountNumber = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankAccountNumber")) where.bankAccountNumber = nonNull;

  if (hasScalar(SUPPLIER_MODEL, "accountName")) where.accountName = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankAccountName")) where.bankAccountName = nonNull;

  if (hasScalar(SUPPLIER_MODEL, "bankCode")) where.bankCode = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankName")) where.bankName = nonNull;
  if (hasScalar(SUPPLIER_MODEL, "bankCountry")) where.bankCountry = nonNull;

  if (hasScalar(SUPPLIER_MODEL, "bankVerificationStatus"))
    where.bankVerificationStatus = "VERIFIED";

  return Object.keys(where).length ? where : {};
}

function offerSupplierPayoutReadyWhere(offerModelName: string, enforce: boolean) {
  if (!enforce) return {};

  if (hasRelation(offerModelName, "supplier")) {
    const sw = supplierPayoutReadyWhere();
    return Object.keys(sw).length ? { supplier: sw } : {};
  }
  return {};
}

function nonEmptyString(v: any) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeId(v: any) {
  return nonEmptyString(v) ? String(v).trim() : null;
}

function buildExcludeSupplierWhere(raw: unknown) {
  const id = normalizeId(raw);
  return id ? { supplierId: { not: id } } : {};
}

/**
 * Guard offer queries by filtering supplierId IS NOT NULL only
 * for models where supplierId is nullable in the schema.
 *
 * Your current schema does not need extra filtering here.
 */
function offerNonNullSupplierIdWhere(_modelName: string) {
  return {};
}

/* -------------------------------------------------------------------------- */
/* Supplier ratings helpers                                                   */
/* -------------------------------------------------------------------------- */

function supplierRatingSelect(includeName: boolean) {
  const sel: any = { id: true };
  if (includeName && hasScalar(SUPPLIER_MODEL, "name")) sel.name = true;
  if (hasScalar(SUPPLIER_MODEL, "ratingAvg")) sel.ratingAvg = true;
  if (hasScalar(SUPPLIER_MODEL, "ratingCount")) sel.ratingCount = true;
  return sel;
}

function readSupplierRatingFromOffer(o: any): {
  supplierId: string;
  ratingAvg: number;
  ratingCount: number;
} {
  const sid = String(
    o?.supplierId ??
      o?.supplier?.id ??
      o?.product?.supplierId ??
      o?.product?.supplier?.id ??
      ""
  );

  const avgRaw = o?.supplier?.ratingAvg ?? o?.product?.supplier?.ratingAvg;
  const cntRaw = o?.supplier?.ratingCount ?? o?.product?.supplier?.ratingCount;

  const ratingAvg = toNum(avgRaw) ?? 0;
  const ratingCount = Number(cntRaw ?? 0) || 0;

  return { supplierId: sid, ratingAvg, ratingCount };
}

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

async function readSettingValue(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } as any });
    if (row?.value != null) return String(row.value);
  } catch {
    //
  }

  try {
    const row = await prisma.setting.findFirst({ where: { key } as any });
    if (row?.value != null) return String(row.value);
  } catch {
    //
  }

  return null;
}

async function getPublicPricingSettings() {
  const [
    baseServiceFeeNGNRaw,
    commsUnitCostNGNRaw,
    gatewayFeePercentRaw,
    gatewayFixedFeeNGNRaw,
    gatewayFeeCapNGNRaw,
  ] = await Promise.all([
    readSettingValue("baseServiceFeeNGN"),
    readSettingValue("commsUnitCostNGN"),
    readSettingValue("gatewayFeePercent"),
    readSettingValue("gatewayFixedFeeNGN"),
    readSettingValue("gatewayFeeCapNGN"),
  ]);

  return {
    baseServiceFeeNGN: toNumber(baseServiceFeeNGNRaw ?? 0),
    commsUnitCostNGN: toNumber(commsUnitCostNGNRaw ?? 0),
    gatewayFeePercent: toNumber(gatewayFeePercentRaw ?? 1.5),
    gatewayFixedFeeNGN: toNumber(gatewayFixedFeeNGNRaw ?? 100),
    gatewayFeeCapNGN: toNumber(gatewayFeeCapNGNRaw ?? 2000),
  };
}

let publicPricingCache:
  | {
      at: number;
      data: {
        baseServiceFeeNGN: number;
        commsUnitCostNGN: number;
        gatewayFeePercent: number;
        gatewayFixedFeeNGN: number;
        gatewayFeeCapNGN: number;
      };
    }
  | null = null;

const PUBLIC_PRICING_CACHE_TTL_MS = 60_000;

async function getPublicPricingSettingsCached() {
  const now = Date.now();
  if (publicPricingCache && now - publicPricingCache.at < PUBLIC_PRICING_CACHE_TTL_MS) {
    return publicPricingCache.data;
  }

  const data = await getPublicPricingSettings();
  publicPricingCache = { at: now, data };
  return data;
}

function estimateGatewayFeeFromSettings(args: {
  amountNaira: number;
  gatewayFeePercent: number;
  gatewayFixedFeeNGN: number;
  gatewayFeeCapNGN: number;
}) {
  const amount = Number(args.amountNaira);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const percentFee = amount * (Number(args.gatewayFeePercent || 0) / 100);
  const gross = percentFee + Number(args.gatewayFixedFeeNGN || 0);
  const cap = Number(args.gatewayFeeCapNGN || 0);

  if (cap > 0) return Math.min(gross, cap);
  return gross;
}

function computeRetailPriceFromSupplierPrice(args: {
  supplierPrice: number;
  baseServiceFeeNGN: number;
  commsUnitCostNGN: number;
  gatewayFeePercent: number;
  gatewayFixedFeeNGN: number;
  gatewayFeeCapNGN: number;
}) {
  const supplierPrice = Number(args.supplierPrice);
  if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) return null;

  const gatewayFeeNGN = estimateGatewayFeeFromSettings({
    amountNaira: supplierPrice,
    gatewayFeePercent: args.gatewayFeePercent,
    gatewayFixedFeeNGN: args.gatewayFixedFeeNGN,
    gatewayFeeCapNGN: args.gatewayFeeCapNGN,
  });

  const extras =
    Number(args.baseServiceFeeNGN || 0) +
    Number(args.commsUnitCostNGN || 0) +
    Number(gatewayFeeNGN || 0);

  const out = Math.round(supplierPrice + extras);
  return Number.isFinite(out) && out > 0 ? out : null;
}

function computePublicDisplayPriceRetailOnly(
  p: any,
  pricing: {
    baseServiceFeeNGN: number;
    commsUnitCostNGN: number;
    gatewayFeePercent: number;
    gatewayFixedFeeNGN: number;
    gatewayFeeCapNGN: number;
  }
) {
  const retail = p?.retailPrice != null ? toNum(p.retailPrice) : null;
  if (retail != null && retail > 0) return retail;

  const auto = p?.autoPrice != null ? toNum(p.autoPrice) : null;
  if (auto != null && auto > 0) return auto;

  const displayBase = p?.displayBasePrice != null ? toNum(p.displayBasePrice) : null;
  if (displayBase != null && displayBase > 0) {
    return computeRetailPriceFromSupplierPrice({
      supplierPrice: displayBase,
      baseServiceFeeNGN: pricing.baseServiceFeeNGN,
      commsUnitCostNGN: pricing.commsUnitCostNGN,
      gatewayFeePercent: pricing.gatewayFeePercent,
      gatewayFixedFeeNGN: pricing.gatewayFixedFeeNGN,
      gatewayFeeCapNGN: pricing.gatewayFeeCapNGN,
    });
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Query schema & pagination helpers                                          */
/* -------------------------------------------------------------------------- */

const QSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  take: z.coerce.number().optional(),
  skip: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  include: z.string().optional(),
});

function resolvePagination(args: { take?: number; skip?: number; page?: number }) {
  const rawTake = Number(args.take ?? 24);
  const take = Math.min(100, Math.max(1, rawTake));

  const hasPage = Number.isFinite(Number(args.page));
  const page = hasPage ? Math.max(1, Number(args.page)) : 1;

  let skip = 0;
  if (hasPage) {
    skip = (page - 1) * take;
  } else {
    skip = Math.max(0, Number(args.skip ?? 0));
  }

  const currentPage = Math.floor(skip / take) + 1;

  return {
    take,
    skip,
    page: currentPage,
  };
}

/* -------------------------------------------------------------------------- */
/* LIST: GET /api/products                                                    */
/* -------------------------------------------------------------------------- */

router.get(
  "/",
  wrap(async (req, res) => {
    const parsed = QSchema.parse(req.query ?? {});
    const q = String(parsed.q ?? "").trim();

    const { take, skip, page } = resolvePagination({
      take: parsed.take,
      skip: parsed.skip,
      page: parsed.page,
    });

    const includeParam = String((req.query as any).include ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const wantBrand = includeParam.includes("brand");
    const wantCategory = includeParam.includes("category");
    const wantVariants = includeParam.includes("variants");
    const wantAttributes = includeParam.includes("attributes");
    const wantOffers = includeParam.includes("offers");

    const statusRaw = String(parsed.status ?? "LIVE").trim().toUpperCase() || "LIVE";
    const isLive = statusRaw === "LIVE";
    const needOffers = wantOffers || isLive;

    const pricing = await getPublicPricingSettingsCached();
    const dec0 = new Prisma.Decimal("0");

    const excludeSupplierId = normalizeId((req.query as any)?.excludeSupplierId);

    const payoutWhereBaseOffer = offerSupplierPayoutReadyWhere(BASE_OFFER_MODEL, true);
    const payoutWhereVarOffer = offerSupplierPayoutReadyWhere(VAR_OFFER_MODEL, true);

    const baseWhere: Prisma.ProductWhereInput = {
      ...(productActiveWhere() as any),
      ...(statusRaw ? { status: statusRaw as any } : {}),
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

    const eligibilityOr: Prisma.ProductWhereInput[] = [
      { retailPrice: { gt: dec0 } as any },
      { autoPrice: { gt: dec0 } as any },
      {
        ProductVariant: {
          some: {
            retailPrice: { gt: dec0 } as any,
            ...(variantActiveWhere() ? (variantActiveWhere() as any) : {}),
          },
        },
      },
      {
        supplierProductOffers: {
          some: {
            isActive: true,
            inStock: true,
            availableQty: { gt: 0 },
            basePrice: { gt: dec0 } as any,
            ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
            ...(payoutWhereBaseOffer as any),
          },
        },
      },
      {
        supplierVariantOffers: {
          some: {
            isActive: true,
            inStock: true,
            availableQty: { gt: 0 },
            unitPrice: { gt: dec0 } as any,
            ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
            ...(payoutWhereVarOffer as any),
          },
        },
      },
    ];

    const productWhere: Prisma.ProductWhereInput = {
      ...baseWhere,
      OR: eligibilityOr,
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where: productWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
        where: productWhere,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / take));

    if (!items.length) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        data: [],
        total,
        meta: {
          page,
          take,
          skip,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    }

    const ids = items.map((p) => String(p.id));
    const categoryIds = Array.from(new Set(items.map((p: any) => p.categoryId).filter(Boolean))) as string[];
    const brandIds = Array.from(new Set(items.map((p: any) => p.brandId).filter(Boolean))) as string[];

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

    type CatLite = { id: string; name: string | null; slug?: string | null };
    type BrandLite = { id: string; name: string | null };

    const catMap = new Map<string, CatLite>();
    const brandMap = new Map<string, BrandLite>();

    for (const c of cats as any[]) {
      catMap.set(String(c.id), {
        id: String(c.id),
        name: c.name != null ? String(c.name) : null,
        slug: c.slug ?? null,
      });
    }

    for (const b of brands as any[]) {
      brandMap.set(String(b.id), {
        id: String(b.id),
        name: b.name != null ? String(b.name) : null,
      });
    }

    const vWhere = variantActiveWhere();

    const variantsRows =
      wantVariants || needOffers
        ? await prisma.productVariant.findMany({
            where: {
              productId: { in: ids },
              ...(vWhere ? (vWhere as any) : {}),
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
    const variantToProduct = new Map<string, string>();

    for (const v of variantsRows as any[]) {
      const pid = String(v.productId);
      const vid = String(v.id);
      variantToProduct.set(vid, pid);

      const list = variantsByProduct.get(pid) ?? [];
      list.push(v);
      variantsByProduct.set(pid, list);
    }

    const baseOfferSelect: any = {
      id: true,
      productId: true,
      basePrice: true,
      inStock: true,
      isActive: true,
      availableQty: true,
      currency: true,
      leadDays: true,
      supplierId: true,
    };

    if (hasRelation(BASE_OFFER_MODEL, "supplier")) {
      baseOfferSelect.supplier = { select: supplierRatingSelect(true) };
    } else if (hasRelation(BASE_OFFER_MODEL, "product")) {
      baseOfferSelect.product = {
        select: {
          supplierId: true,
          supplier: { select: supplierRatingSelect(true) },
        },
      };
    }

    const varOfferSelect: any = {
      id: true,
      productId: true,
      variantId: true,
      supplierProductOfferId: true,
      unitPrice: true,
      inStock: true,
      isActive: true,
      availableQty: true,
      currency: true,
      leadDays: true,
      supplierId: true,
    };

    if (hasRelation(VAR_OFFER_MODEL, "supplier")) {
      varOfferSelect.supplier = { select: supplierRatingSelect(true) };
    } else if (hasRelation(VAR_OFFER_MODEL, "product")) {
      varOfferSelect.product = {
        select: {
          supplierId: true,
          supplier: { select: supplierRatingSelect(true) },
        },
      };
    }

    const [baseOffers, variantOffers, baseMin, variantMin, baseQtyAgg, variantQtyAgg] =
      await Promise.all([
        needOffers
          ? prisma.supplierProductOffer.findMany({
              where: {
                productId: { in: ids },
                isActive: true,
                inStock: true,
                availableQty: { gt: 0 },
                basePrice: { gt: dec0 },
                ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
                ...(payoutWhereBaseOffer as any),
              } as any,
              select: baseOfferSelect,
            })
          : Promise.resolve([]),

        needOffers
          ? prisma.supplierVariantOffer.findMany({
              where: {
                productId: { in: ids },
                isActive: true,
                inStock: true,
                availableQty: { gt: 0 },
                unitPrice: { gt: dec0 },
                ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
                ...(payoutWhereVarOffer as any),
              } as any,
              select: varOfferSelect,
            })
          : Promise.resolve([]),

        ids.length
          ? prisma.supplierProductOffer.groupBy({
              by: ["productId"],
              where: {
                productId: { in: ids },
                isActive: true,
                inStock: true,
                availableQty: { gt: 0 },
                basePrice: { gt: dec0 },
                ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
                ...(payoutWhereBaseOffer as any),
              } as any,
              _min: { basePrice: true },
            })
          : Promise.resolve([] as any[]),

        ids.length
          ? prisma.supplierVariantOffer.groupBy({
              by: ["productId"],
              where: {
                productId: { in: ids },
                isActive: true,
                inStock: true,
                availableQty: { gt: 0 },
                unitPrice: { gt: dec0 },
                ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
                ...(payoutWhereVarOffer as any),
              } as any,
              _min: { unitPrice: true },
            })
          : Promise.resolve([] as any[]),

        ids.length
          ? prisma.supplierProductOffer.groupBy({
              by: ["productId"],
              where: {
                productId: { in: ids },
                isActive: true,
                inStock: true,
                availableQty: { gt: 0 },
                ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
                ...(payoutWhereBaseOffer as any),
              } as any,
              _sum: { availableQty: true },
            })
          : Promise.resolve([] as any[]),

        ids.length
          ? prisma.supplierVariantOffer.groupBy({
              by: ["productId"],
              where: {
                productId: { in: ids },
                isActive: true,
                inStock: true,
                availableQty: { gt: 0 },
                ...(excludeSupplierId ? { supplierId: { not: excludeSupplierId } } : {}),
                ...(payoutWhereVarOffer as any),
              } as any,
              _sum: { availableQty: true },
            })
          : Promise.resolve([] as any[]),
      ]);

    const baseMinByProduct: Record<string, number> = {};
    for (const r of baseMin as any[]) {
      baseMinByProduct[String(r.productId)] = Number(r._min?.basePrice ?? 0) || 0;
    }

    const variantMinByProduct: Record<string, number> = {};
    for (const r of variantMin as any[]) {
      variantMinByProduct[String(r.productId)] = Number(r._min?.unitPrice ?? 0) || 0;
    }

    const qtyByProduct: Record<string, number> = {};
    for (const r of baseQtyAgg as any[]) {
      qtyByProduct[String(r.productId)] =
        (qtyByProduct[String(r.productId)] ?? 0) + Number(r._sum?.availableQty ?? 0);
    }
    for (const r of variantQtyAgg as any[]) {
      qtyByProduct[String(r.productId)] =
        (qtyByProduct[String(r.productId)] ?? 0) + Number(r._sum?.availableQty ?? 0);
    }

    const baseBySupplierByProduct = new Map<string, Map<string, number>>();
    const minBasePriceByProduct = new Map<string, number>();

    const ratingsByProduct = new Map<string, Array<{ ratingAvg: number; ratingCount: number }>>();
    const ratingsByVariant = new Map<string, Array<{ ratingAvg: number; ratingCount: number }>>();
    const variantOffersByVariant = new Map<string, any[]>();
    const offersFromByProduct = new Map<string, number | null>();

    for (const pid of ids) {
      ratingsByProduct.set(pid, []);
      offersFromByProduct.set(pid, null);
    }

    for (const o of baseOffers as any[]) {
      const pid = String(o.productId);
      const r = readSupplierRatingFromOffer(o);
      const sid = r.supplierId;
      const bp = toNum(o.basePrice) ?? 0;

      if (!baseBySupplierByProduct.has(pid)) baseBySupplierByProduct.set(pid, new Map());
      if (sid) baseBySupplierByProduct.get(pid)!.set(sid, bp);

      if (o.isActive === true && o.inStock === true) {
        const qty = Number(o.availableQty ?? 0) || 0;
        if (bp > 0 && qty > 0) {
          const cur = minBasePriceByProduct.get(pid);
          if (cur == null || bp < cur) minBasePriceByProduct.set(pid, bp);
        }
      }

      if (sid) {
        const arr = ratingsByProduct.get(pid) ?? [];
        arr.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
        ratingsByProduct.set(pid, arr);
      }
    }

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

      if (o.isActive === true && o.inStock === true) {
        const qty = Number(o.availableQty ?? 0) || 0;
        if (qty > 0) {
          const unit = toNum(o.unitPrice);
          let effective = unit != null && unit > 0 ? unit : null;

          if (effective == null) {
            const r = readSupplierRatingFromOffer(o);
            const baseMap = baseBySupplierByProduct.get(pid) ?? new Map<string, number>();
            const base = r.supplierId ? baseMap.get(r.supplierId) : undefined;
            if (base != null && base > 0) effective = base;
          }

          if (effective != null && effective > 0) {
            const cur = offersFromByProduct.get(pid);
            const curMin = cur == null ? Infinity : Number(cur);
            offersFromByProduct.set(pid, Math.min(curMin, effective));
          }
        }
      }

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

    const data = items.map((p: any) => {
      const pid = String(p.id);

      const cat = wantCategory && p.categoryId ? catMap.get(String(p.categoryId)) : null;
      const br = wantBrand && p.brandId ? brandMap.get(String(p.brandId)) : null;

      const aggregatedQty = qtyByProduct[pid] ?? 0;
      const bestProductRating = pickBestRating(ratingsByProduct.get(pid) ?? []);

      const baseOfferPrice = baseMinByProduct[pid] ?? 0;
      const variantOfferPrice = variantMinByProduct[pid] ?? 0;

      const supplierDisplayBase =
        baseOfferPrice > 0 && variantOfferPrice > 0
          ? Math.min(baseOfferPrice, variantOfferPrice)
          : baseOfferPrice > 0
          ? baseOfferPrice
          : variantOfferPrice > 0
          ? variantOfferPrice
          : Number(p.retailPrice ?? p.autoPrice ?? 0) || 0;

      const offersFrom = needOffers ? offersFromByProduct.get(pid) ?? null : null;

      const offerRetail =
        offersFrom != null && Number(offersFrom) > 0
          ? computeRetailPriceFromSupplierPrice({
              supplierPrice: Number(offersFrom),
              baseServiceFeeNGN: pricing.baseServiceFeeNGN,
              commsUnitCostNGN: pricing.commsUnitCostNGN,
              gatewayFeePercent: pricing.gatewayFeePercent,
              gatewayFixedFeeNGN: pricing.gatewayFixedFeeNGN,
              gatewayFeeCapNGN: pricing.gatewayFeeCapNGN,
            })
          : null;

      const retailOnly = computePublicDisplayPriceRetailOnly(
        {
          ...p,
          displayBasePrice: supplierDisplayBase > 0 ? supplierDisplayBase : null,
        },
        pricing
      );

      const displayPrice = offerRetail != null ? offerRetail : retailOnly;

      const rawRetail = p.retailPrice != null ? toNum(p.retailPrice) : null;
      const attrs = attrByProduct.get(pid);

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
                      unitPrice: o.unitPrice != null ? toNum(o.unitPrice) : null,
                      supplierRatingAvg: r.ratingAvg,
                      supplierRatingCount: r.ratingCount,
                      supplier: r.supplierId
                        ? {
                            id: r.supplierId,
                            ratingAvg: r.ratingAvg,
                            ratingCount: r.ratingCount,
                          }
                        : undefined,
                    };
                  })
                : [],

              bestSupplierRating: bestVariantRating,
            };
          })
        : [];

      return {
        id: pid,
        title: p.title,
        description: p.description,
        sku: p.sku,

        retailPrice: rawRetail,
        computedRetailPrice: displayPrice != null ? displayPrice : null,
        autoPrice: p.autoPrice != null ? toNum(p.autoPrice) : null,
        displayBasePrice: supplierDisplayBase > 0 ? supplierDisplayBase : null,
        priceMode: p.priceMode ?? null,

        commissionPctInt: p.commissionPctInt != null ? Number(p.commissionPctInt) : null,

        inStock: aggregatedQty > 0 || p.inStock === true,
        availableQty: aggregatedQty,

        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        categoryId: p.categoryId ?? null,
        categoryName: wantCategory ? cat?.name ?? null : null,

        brand: wantBrand ? (br ? { id: br.id, name: br.name } : null) : null,
        brandName: wantBrand ? br?.name ?? null : null,

        status: statusRaw,

        offersFrom,

        ratingAvg: bestProductRating?.ratingAvg ?? null,
        ratingCount: bestProductRating?.ratingCount ?? null,
        bestSupplierRating: bestProductRating,

        supplierProductOffers: needOffers
          ? (baseOffers as any[])
              .filter((o: any) => String(o.productId) === pid)
              .map((o: any) => {
                const r = readSupplierRatingFromOffer(o);
                return {
                  id: String(o.id),
                  supplierId: r.supplierId,
                  isActive: o.isActive === true,
                  inStock: o.inStock === true,
                  availableQty: Number(o.availableQty ?? 0) || 0,
                  basePrice: o.basePrice != null ? toNum(o.basePrice) : null,
                  currency: o.currency ?? "NGN",
                  leadDays: o.leadDays ?? null,
                  supplierRatingAvg: r.ratingAvg,
                  supplierRatingCount: r.ratingCount,
                  supplier: r.supplierId
                    ? {
                        id: r.supplierId,
                        ratingAvg: r.ratingAvg,
                        ratingCount: r.ratingCount,
                      }
                    : undefined,
                };
              })
          : [],

        variants: variantsOut,

        attributesSummary: wantAttributes ? attrs?.summary ?? [] : [],
      };
    });

    return res.json({
      data,
      total,
      meta: {
        page,
        take,
        skip,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* SIMILAR: GET /api/products/:id/similar                                     */
/* -------------------------------------------------------------------------- */

router.get(
  "/:id/similar",
  wrap(async (req, res) => {
    const { id } = req.params;
    const dec0 = new Prisma.Decimal("0");
    const excludeSupplierId = normalizeId((req.query as any)?.excludeSupplierId);
    const excludeSupplierWhere = buildExcludeSupplierWhere(excludeSupplierId);

    const payoutWhereBaseOffer = offerSupplierPayoutReadyWhere(BASE_OFFER_MODEL, true);
    const payoutWhereVarOffer = offerSupplierPayoutReadyWhere(VAR_OFFER_MODEL, true);

    const nonNullBaseOffer = offerNonNullSupplierIdWhere(BASE_OFFER_MODEL);
    const nonNullVarOffer = offerNonNullSupplierIdWhere(VAR_OFFER_MODEL);
    const pricing = await getPublicPricingSettingsCached();

    const me = await prisma.product.findFirst({
      where: { id, status: "LIVE" as any, ...(productActiveWhere() as any) },
      select: {
        id: true,
        retailPrice: true,
        autoPrice: true,
        commissionPctInt: true,
        categoryId: true,
      },
    });

    if (!me) return res.status(404).json({ error: "Product not found" });

    const candidateBaseWhere: Prisma.ProductWhereInput = {
      id: { not: id },
      status: "LIVE" as any,
      ...(productActiveWhere() as any),
    };

    const sameCategoryWhere: Prisma.ProductWhereInput = {
      ...candidateBaseWhere,
      ...(me.categoryId ? { categoryId: me.categoryId } : {}),
    };

    const seedIds = await prisma.product.findMany({
      where: sameCategoryWhere,
      take: 24,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    let candidateIds = seedIds.map((x: any) => String(x.id)).filter(Boolean);

    if (candidateIds.length < 12) {
      const meDisplayBase = Number(me.retailPrice ?? me.autoPrice ?? 0) || 0;

      const byPrice =
        meDisplayBase > 0
          ? await prisma.product.findMany({
              where: {
                ...candidateBaseWhere,
                OR: [
                  { retailPrice: { gte: Math.max(0, meDisplayBase * 0.6), lte: meDisplayBase * 1.4 } },
                  { autoPrice: { gte: Math.max(0, meDisplayBase * 0.6), lte: meDisplayBase * 1.4 } },
                ],
              },
              take: 24,
              orderBy: { createdAt: "desc" },
              select: { id: true },
            })
          : [];

      const seen = new Set(candidateIds);
      for (const row of byPrice as any[]) {
        const pid = String(row.id);
        if (!seen.has(pid)) {
          seen.add(pid);
          candidateIds.push(pid);
        }
      }
    }

    candidateIds = candidateIds.slice(0, 24);

    if (!candidateIds.length) return res.json({ data: [] });

    const [items, baseMin, variantMin, baseQtyAgg, variantQtyAgg] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: candidateIds } },
        orderBy: { createdAt: "desc" },
        take: 24,
        select: {
          id: true,
          title: true,
          retailPrice: true,
          autoPrice: true,
          commissionPctInt: true,
          imagesJson: true,
          inStock: true,
          categoryId: true,
        },
      }),

      prisma.supplierProductOffer.groupBy({
        by: ["productId"],
        where: {
          productId: { in: candidateIds },
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
          basePrice: { gt: dec0 },
          ...(payoutWhereBaseOffer as any),
          ...(nonNullBaseOffer as any),
          ...(excludeSupplierWhere as any),
        } as any,
        _min: { basePrice: true },
      }),

      prisma.supplierVariantOffer.groupBy({
        by: ["productId"],
        where: {
          productId: { in: candidateIds },
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
          unitPrice: { gt: dec0 },
          ...(payoutWhereVarOffer as any),
          ...(nonNullVarOffer as any),
          ...(excludeSupplierWhere as any),
        } as any,
        _min: { unitPrice: true },
      }),

      prisma.supplierProductOffer.groupBy({
        by: ["productId"],
        where: {
          productId: { in: candidateIds },
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
          ...(payoutWhereBaseOffer as any),
          ...(nonNullBaseOffer as any),
          ...(excludeSupplierWhere as any),
        } as any,
        _sum: { availableQty: true },
      }),

      prisma.supplierVariantOffer.groupBy({
        by: ["productId"],
        where: {
          productId: { in: candidateIds },
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
          ...(payoutWhereVarOffer as any),
          ...(nonNullVarOffer as any),
          ...(excludeSupplierWhere as any),
        } as any,
        _sum: { availableQty: true },
      }),
    ]);

    const baseMinByProduct: Record<string, number> = {};
    for (const r of baseMin as any[]) {
      baseMinByProduct[String(r.productId)] = Number(r._min?.basePrice ?? 0) || 0;
    }

    const variantMinByProduct: Record<string, number> = {};
    for (const r of variantMin as any[]) {
      variantMinByProduct[String(r.productId)] = Number(r._min?.unitPrice ?? 0) || 0;
    }

    const qtyByProduct: Record<string, number> = {};
    for (const r of baseQtyAgg as any[]) {
      qtyByProduct[String(r.productId)] =
        (qtyByProduct[String(r.productId)] ?? 0) + Number(r._sum?.availableQty ?? 0);
    }
    for (const r of variantQtyAgg as any[]) {
      qtyByProduct[String(r.productId)] =
        (qtyByProduct[String(r.productId)] ?? 0) + Number(r._sum?.availableQty ?? 0);
    }

    const data = items
      .map((p: any) => {
        const pid = String(p.id);

        const baseOfferPrice = baseMinByProduct[pid] ?? 0;
        const variantOfferPrice = variantMinByProduct[pid] ?? 0;

        const offersFrom =
          baseOfferPrice > 0 && variantOfferPrice > 0
            ? Math.min(baseOfferPrice, variantOfferPrice)
            : baseOfferPrice > 0
            ? baseOfferPrice
            : variantOfferPrice > 0
            ? variantOfferPrice
            : null;

        const computedRetail =
          offersFrom != null && Number(offersFrom) > 0
            ? computeRetailPriceFromSupplierPrice({
                supplierPrice: Number(offersFrom),
                baseServiceFeeNGN: pricing.baseServiceFeeNGN,
                commsUnitCostNGN: pricing.commsUnitCostNGN,
                gatewayFeePercent: pricing.gatewayFeePercent,
                gatewayFixedFeeNGN: pricing.gatewayFixedFeeNGN,
                gatewayFeeCapNGN: pricing.gatewayFeeCapNGN,
              })
            : null;

        const fallbackRetail = computePublicDisplayPriceRetailOnly(
          {
            retailPrice: p.retailPrice,
            autoPrice: p.autoPrice,
            displayBasePrice: offersFrom,
          },
          pricing
        );

        const availableQty = qtyByProduct[pid] ?? 0;
        const inStock = availableQty > 0 || p.inStock === true;

        return {
          id: pid,
          title: p.title,
          retailPrice: fallbackRetail,
          computedRetailPrice: computedRetail != null ? computedRetail : fallbackRetail,
          offersFrom,
          imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
          inStock,
          availableQty,
          categoryId: p.categoryId ?? null,
        };
      })
      .filter((x) => x.inStock || x.computedRetailPrice != null)
      .slice(0, 12);

    res.json({ data });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/products/:id                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  "/:id",
  wrap(async (req, res) => {
    const { id } = req.params;

    const includeParts = String(req.query.include || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const wantBrand = includeParts.includes("brand");
    const wantCategory = includeParts.includes("category");
    const wantVariants = includeParts.includes("variants");
    const wantAttributes = includeParts.includes("attributes");
    const wantOffers = includeParts.includes("offers");

    const excludeSupplierId = normalizeId((req.query as any)?.excludeSupplierId);
    const excludeSupplierWhere = buildExcludeSupplierWhere(excludeSupplierId);
    const dec0 = new Prisma.Decimal("0");
    const vWhere = variantActiveWhere();

    const productSelect: any = {
      id: true,
      title: true,
      description: true,
      sku: true,
      retailPrice: true,
      autoPrice: true,
      priceMode: true,
      inStock: true,
      imagesJson: true,
      categoryId: true,
      brandId: true,
      status: true,
    };

    if (hasScalar(PRODUCT_MODEL, "isActive")) productSelect.isActive = true;
    if (hasScalar(PRODUCT_MODEL, "isDeleted")) productSelect.isDeleted = true;
    if (hasScalar(PRODUCT_MODEL, "isDelete")) productSelect.isDelete = true;
    if (hasScalar(PRODUCT_MODEL, "isArchived")) productSelect.isArchived = true;
    if (hasScalar(PRODUCT_MODEL, "archivedAt")) productSelect.archivedAt = true;

    const p = await prisma.product.findUnique({
      where: { id },
      select: productSelect,
    } as any);

    if (!p || !productRowIsActive(p)) {
      return res.status(404).json({ error: "Not found" });
    }

    const retailPrice = (p as any).retailPrice != null ? toNum((p as any).retailPrice) : null;
    const autoPrice = (p as any).autoPrice != null ? toNum((p as any).autoPrice) : null;
    const priceMode = (p as any).priceMode ?? null;

    const [
      brandRow,
      categoryRow,
      productVariants,
      attributeOptionsRows,
      attributeTextsRows,
    ] = await Promise.all([
      wantBrand && (p as any).brandId
        ? prisma.brand.findUnique({
            where: { id: String((p as any).brandId) },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),

      wantCategory && (p as any).categoryId
        ? prisma.category.findUnique({
            where: { id: String((p as any).categoryId) },
            select: { id: true, name: true, slug: true },
          })
        : Promise.resolve(null),

      wantVariants || wantOffers
        ? prisma.productVariant.findMany({
            where: {
              productId: id,
              ...(vWhere ? (vWhere as any) : {}),
            } as any,
            select: {
              id: true,
              sku: true,
              retailPrice: true,
              inStock: true,
              imagesJson: true,
              availableQty: true,
              options: {
                select: {
                  attributeId: true,
                  valueId: true,
                  unitPrice: true,
                  attribute: { select: { id: true, name: true, type: true } },
                  value: { select: { id: true, name: true, code: true } },
                },
              },
            },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([]),

      wantAttributes
        ? prisma.productAttributeOption.findMany({
            where: { productId: id },
            include: {
              attribute: { select: { id: true, name: true, type: true } },
              value: { select: { id: true, name: true, code: true } },
            },
            orderBy: [{ attribute: { name: "asc" } }],
          })
        : Promise.resolve([]),

      wantAttributes
        ? prisma.productAttributeText.findMany({
            where: { productId: id },
            include: {
              attribute: { select: { id: true, name: true, type: true } },
            },
            orderBy: [{ attribute: { name: "asc" } }],
          })
        : Promise.resolve([]),
    ]);

    const variantIds = (productVariants as any[]).map((v: any) => String(v.id));

    let baseOffers: any[] = [];
    let variantOffers: any[] = [];

    if (wantOffers) {
      const baseOfferSelect: any = {
        id: true,
        productId: true,
        basePrice: true,
        currency: true,
        availableQty: true,
        inStock: true,
        isActive: true,
        leadDays: true,
      };

      if (hasScalar(BASE_OFFER_MODEL, "supplierId")) baseOfferSelect.supplierId = true;

      if (hasRelation(BASE_OFFER_MODEL, "supplier")) {
        baseOfferSelect.supplier = { select: supplierRatingSelect(false) };
      } else if (hasRelation(BASE_OFFER_MODEL, "product")) {
        baseOfferSelect.product = {
          select: {
            supplierId: true,
            supplier: { select: supplierRatingSelect(false) },
          },
        };
      }

      const varOfferSelect: any = {
        id: true,
        variantId: true,
        inStock: true,
        isActive: true,
        availableQty: true,
        unitPrice: true,
        currency: true,
        leadDays: true,
        supplierProductOfferId: true,
        productId: true,
      };

      if (hasScalar(VAR_OFFER_MODEL, "supplierId")) varOfferSelect.supplierId = true;

      if (hasRelation(VAR_OFFER_MODEL, "supplier")) {
        varOfferSelect.supplier = { select: supplierRatingSelect(false) };
      } else if (hasRelation(VAR_OFFER_MODEL, "product")) {
        varOfferSelect.product = {
          select: {
            supplierId: true,
            supplier: { select: supplierRatingSelect(false) },
          },
        };
      }

      [baseOffers, variantOffers] = await Promise.all([
        prisma.supplierProductOffer.findMany({
          where: {
            productId: id,
            isActive: true,
            inStock: true,
            availableQty: { gt: 0 },
            basePrice: { gt: dec0 },
            ...(offerSupplierPayoutReadyWhere(BASE_OFFER_MODEL, false) as any),
            ...(offerNonNullSupplierIdWhere(BASE_OFFER_MODEL) as any),
            ...(excludeSupplierWhere as any),
          } as any,
          select: baseOfferSelect,
          orderBy: [{ basePrice: "asc" }, { createdAt: "asc" as any }],
        }),

        variantIds.length
          ? prisma.supplierVariantOffer.findMany({
              where: {
                productId: id,
                variantId: { in: variantIds },
                isActive: true,
                inStock: true,
                availableQty: { gt: 0 },
                unitPrice: { gt: dec0 },
                ...(offerSupplierPayoutReadyWhere(VAR_OFFER_MODEL, false) as any),
                ...(offerNonNullSupplierIdWhere(VAR_OFFER_MODEL) as any),
                ...(excludeSupplierWhere as any),
              } as any,
              select: varOfferSelect,
              orderBy: [{ unitPrice: "asc" }, { createdAt: "asc" as any }],
            })
          : Promise.resolve([]),
      ]);
    }

    const data: any = {
      id: p.id,
      title: p.title,
      description: p.description,
      sku: (p as any).sku ?? null,
      retailPrice,
      autoPrice,
      priceMode,
      inStock: p.inStock,
      imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
      categoryId: (p as any).categoryId ?? null,
      brandId: (p as any).brandId ?? null,
      status: (p as any).status ?? "LIVE",
    };

    if (wantCategory) {
      data.categoryName = (categoryRow as any)?.name ?? null;
      data.category = categoryRow
        ? {
            id: (categoryRow as any).id,
            name: (categoryRow as any).name,
            slug: (categoryRow as any).slug ?? null,
          }
        : null;
    }

    if (wantBrand) {
      data.brand = brandRow
        ? { id: (brandRow as any).id, name: (brandRow as any).name }
        : null;
      data.brandName = (brandRow as any)?.name ?? null;
    }

    if (wantAttributes) {
      data.attributes =
        (attributeOptionsRows as any[]).map((o: any) => ({
          attributeId: o.attribute.id,
          attributeName: o.attribute.name,
          attributeType: o.attribute.type,
          valueId: o.value.id,
          valueName: o.value.name,
          valueCode: o.value.code ?? null,
        })) ?? [];

      data.attributeTexts =
        (attributeTextsRows as any[]).map((t: any) => ({
          attributeId: t.attribute.id,
          attributeName: t.attribute.name,
          attributeType: t.attribute.type,
          value: t.value,
        })) ?? [];

      data.attributeSelections = [
        ...((attributeOptionsRows as any[]).map((o: any) => ({
          attributeId: String(o.attribute.id),
          valueId: String(o.value.id),
        })) ?? []),
        ...((attributeTextsRows as any[]).map((t: any) => ({
          attributeId: String(t.attribute.id),
          text: String(t.value ?? ""),
        })) ?? []),
      ];
    }

    const baseByOfferId = new Map<string, number>();
    const baseBySupplier = new Map<string, number>();
    const ratingsAll: Array<{ ratingAvg: number; ratingCount: number }> = [];

    for (const bo of baseOffers as any[]) {
      const bp = bo.basePrice != null ? (toNum(bo.basePrice) ?? 0) : 0;
      baseByOfferId.set(String(bo.id), bp);

      const r = readSupplierRatingFromOffer(bo);
      if (r.supplierId) {
        baseBySupplier.set(r.supplierId, bp);
        ratingsAll.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
      }
    }

    for (const vo of variantOffers as any[]) {
      const r = readSupplierRatingFromOffer(vo);
      if (r.supplierId) ratingsAll.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
    }

    const bestSupplierRating = pickBestRating(ratingsAll);
    data.bestSupplierRating = bestSupplierRating;
    data.ratingAvg = bestSupplierRating?.ratingAvg ?? null;
    data.ratingCount = bestSupplierRating?.ratingCount ?? null;

    const baseQty = baseOffers.reduce((sum: number, o: any) => {
      if (o?.isActive !== true || o?.inStock !== true) return sum;
      const qty = Number(o?.availableQty ?? 0) || 0;
      return sum + (qty > 0 ? qty : 0);
    }, 0);

    const variantQty = variantOffers.reduce((sum: number, o: any) => {
      if (o?.isActive !== true || o?.inStock !== true) return sum;
      const qty = Number(o?.availableQty ?? 0) || 0;
      return sum + (qty > 0 ? qty : 0);
    }, 0);

    const aggregatedQty = wantOffers ? baseQty + variantQty : 0;
    data.availableQty = aggregatedQty;
    data.inStock = aggregatedQty > 0 || p.inStock === true;

    const baseOfferNums = baseOffers
      .map((o: any) => (o.basePrice != null ? Number(toNum(o.basePrice) ?? 0) : 0))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    const variantOfferNums = variantOffers
      .map((o: any) => (o.unitPrice != null ? Number(toNum(o.unitPrice) ?? 0) : 0))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    const minBaseOfferPrice = baseOfferNums.length ? Math.min(...baseOfferNums) : 0;
    const minVariantOfferPrice = variantOfferNums.length ? Math.min(...variantOfferNums) : 0;

    const offersFrom =
      minBaseOfferPrice > 0 && minVariantOfferPrice > 0
        ? Math.min(minBaseOfferPrice, minVariantOfferPrice)
        : minBaseOfferPrice > 0
        ? minBaseOfferPrice
        : minVariantOfferPrice > 0
        ? minVariantOfferPrice
        : null;

    data.offersFrom = offersFrom;

    if (wantVariants || wantOffers) {
      const variantOffersByVariant = new Map<string, any[]>();
      const ratingsByVariant = new Map<string, Array<{ ratingAvg: number; ratingCount: number }>>();

      for (const vo of variantOffers as any[]) {
        const vid = String(vo.variantId ?? "");
        if (!vid) continue;

        const list = variantOffersByVariant.get(vid) ?? [];
        list.push(vo);
        variantOffersByVariant.set(vid, list);

        const r = readSupplierRatingFromOffer(vo);
        if (r.supplierId) {
          const arr = ratingsByVariant.get(vid) ?? [];
          arr.push({ ratingAvg: r.ratingAvg, ratingCount: r.ratingCount });
          ratingsByVariant.set(vid, arr);
        }
      }

      const variantsOut = (productVariants as any[]).map((v: any) => {
        const vid = String(v.id);
        const vOffers = wantOffers ? variantOffersByVariant.get(vid) ?? [] : [];

        const vQty = wantOffers
          ? vOffers.reduce((acc: number, x: any) => {
              if (x?.isActive !== true) return acc;
              if (x?.inStock !== true) return acc;
              const qn = Number(x?.availableQty ?? 0) || 0;
              return acc + (qn > 0 ? qn : 0);
            }, 0)
          : Number(v.availableQty ?? 0) || 0;

        const bestVariantRating = pickBestRating(ratingsByVariant.get(vid) ?? []);

        return {
          id: vid,
          sku: v.sku ?? null,
          retailPrice: v.retailPrice != null ? toNum(v.retailPrice) : null,
          inStock: vQty > 0 || v.inStock === true,
          imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
          availableQty: vQty,
          options: (v.options || []).map((o: any) => ({
            attributeId: String(o.attributeId),
            valueId: String(o.valueId),
            unitPrice: o.unitPrice != null ? toNum(o.unitPrice) : null,
            attribute: { id: o.attribute.id, name: o.attribute.name, type: o.attribute.type },
            value: { id: o.value.id, name: o.value.name, code: o.value.code ?? null },
          })),
          offers: wantOffers
            ? vOffers.map((o: any) => {
                const r = readSupplierRatingFromOffer(o);
                return {
                  id: String(o.id),
                  supplierId: r.supplierId,
                  productId: String(o.productId),
                  variantId: String(o.variantId),
                  supplierProductOfferId: o.supplierProductOfferId ? String(o.supplierProductOfferId) : null,
                  unitPrice: o.unitPrice != null ? toNum(o.unitPrice) : null,
                  currency: o.currency ?? "NGN",
                  availableQty: Number(o.availableQty ?? 0) || 0,
                  inStock: o.inStock === true,
                  isActive: o.isActive === true,
                  leadDays: o.leadDays ?? null,
                  supplierRatingAvg: r.ratingAvg,
                  supplierRatingCount: r.ratingCount,
                  supplier: r.supplierId
                    ? {
                        id: r.supplierId,
                        ratingAvg: r.ratingAvg,
                        ratingCount: r.ratingCount,
                      }
                    : undefined,
                };
              })
            : [],
          bestSupplierRating: bestVariantRating,
        };
      });

      data.variants = variantsOut;
    }

    if (wantOffers) {
      data.supplierProductOffers = baseOffers.map((o: any) => {
        const r = readSupplierRatingFromOffer(o);
        return {
          id: String(o.id),
          supplierId: r.supplierId,
          productId: String(o.productId),
          basePrice: o.basePrice != null ? toNum(o.basePrice) : null,
          currency: o.currency ?? "NGN",
          availableQty: Number(o.availableQty ?? 0) || 0,
          inStock: o.inStock === true,
          isActive: o.isActive === true,
          leadDays: o.leadDays ?? null,
          supplierRatingAvg: r.ratingAvg,
          supplierRatingCount: r.ratingCount,
          supplier: r.supplierId
            ? {
                id: r.supplierId,
                ratingAvg: r.ratingAvg,
                ratingCount: r.ratingCount,
              }
            : undefined,
        };
      });

      data.supplierVariantOffers = variantOffers.map((o: any) => {
        const r = readSupplierRatingFromOffer(o);
        return {
          id: String(o.id),
          supplierId: r.supplierId,
          productId: String(o.productId),
          variantId: String(o.variantId),
          supplierProductOfferId: o.supplierProductOfferId ? String(o.supplierProductOfferId) : null,
          unitPrice: o.unitPrice != null ? toNum(o.unitPrice) : null,
          currency: o.currency ?? "NGN",
          availableQty: Number(o.availableQty ?? 0) || 0,
          inStock: o.inStock === true,
          isActive: o.isActive === true,
          leadDays: o.leadDays ?? null,
          supplierRatingAvg: r.ratingAvg,
          supplierRatingCount: r.ratingCount,
          supplier: r.supplierId
            ? {
                id: r.supplierId,
                ratingAvg: r.ratingAvg,
                ratingCount: r.ratingCount,
              }
            : undefined,
        };
      });

      data.offers = [
        ...baseOffers.map((o: any) => {
          const r = readSupplierRatingFromOffer(o);
          return {
            id: String(o.id),
            supplierId: r.supplierId,
            productId: String(o.productId),
            variantId: null,
            currency: o.currency ?? "NGN",
            inStock: o.inStock === true,
            isActive: o.isActive === true,
            availableQty: Number(o.availableQty ?? 0) || 0,
            leadDays: o.leadDays ?? null,
            basePrice: o.basePrice != null ? toNum(o.basePrice) : null,
            unitPrice: o.basePrice != null ? toNum(o.basePrice) : null,
            model: "BASE",
            supplierRatingAvg: r.ratingAvg,
            supplierRatingCount: r.ratingCount,
            supplier: r.supplierId
              ? {
                  id: r.supplierId,
                  ratingAvg: r.ratingAvg,
                  ratingCount: r.ratingCount,
                }
              : undefined,
          };
        }),

        ...variantOffers.map((o: any) => {
          const r = readSupplierRatingFromOffer(o);

          const unit = toNum(o.unitPrice);
          const fallbackBase =
            baseByOfferId.get(String(o.supplierProductOfferId)) ??
            (r.supplierId ? baseBySupplier.get(r.supplierId) : undefined) ??
            0;

          const finalPrice = unit != null && unit > 0 ? unit : fallbackBase > 0 ? fallbackBase : null;

          return {
            id: String(o.id),
            supplierId: r.supplierId,
            productId: String(o.productId),
            variantId: o.variantId ? String(o.variantId) : null,
            currency: o.currency ?? "NGN",
            inStock: o.inStock === true,
            isActive: o.isActive === true,
            availableQty: Number(o.availableQty ?? 0) || 0,
            leadDays: o.leadDays ?? null,
            unitPrice: finalPrice,
            model: "VARIANT",
            supplierRatingAvg: r.ratingAvg,
            supplierRatingCount: r.ratingCount,
            supplier: r.supplierId
              ? {
                  id: r.supplierId,
                  ratingAvg: r.ratingAvg,
                  ratingCount: r.ratingCount,
                }
              : undefined,
          };
        }),
      ];
    }

    res.json({ data });
  })
);

export default router;