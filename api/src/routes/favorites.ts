// api/src/routes/favorites.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();
router.use(requireAuth);


type FavoriteListArgs = {
  userId: string;
  page: number;
  pageSize: number;
};

type FavoriteListResult = {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};


function clampPage(v: any, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function clampPageSize(v: any, fallback = 12, max = 48) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function normalizeImages(imagesJson: any): string[] {
  if (!imagesJson) return [];
  if (Array.isArray(imagesJson)) return imagesJson.filter(Boolean).map(String);

  // sometimes stored as JSON string
  if (typeof imagesJson === "string") {
    try {
      const parsed = JSON.parse(imagesJson);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // ignore
    }
  }
  return [];
}

/* ----------------------------- pricing helpers ----------------------------- */

function toNumAny(v: any): number | null {
  if (v == null) return null;

  // Prisma Decimal sometimes has toNumber()
  if (typeof v === "object" && typeof (v as any).toNumber === "function") {
    const n = (v as any).toNumber();
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function applyMargin(supplierPrice: number, marginPercent: number) {
  const m = Math.max(0, Number(marginPercent) || 0);
  return round2(supplierPrice * (1 + m / 100));
}

function pickCheapestSupplierPrice(p: any): number | null {
  const baseOffers: any[] = Array.isArray(p?.supplierProductOffers) ? p.supplierProductOffers : [];
  const varOffers: any[] = Array.isArray(p?.supplierVariantOffers) ? p.supplierVariantOffers : [];

  let best: number | null = null;

  const consider = (o: any, field: "basePrice" | "unitPrice") => {
    if (!o) return;

    const isActive = o?.isActive !== false;
    const inStock = o?.inStock !== false;
    const qty = Number(o?.availableQty ?? 0) || 0;

    if (!isActive || !inStock || qty <= 0) return;

    const price = toNumAny(o?.[field]);
    if (price == null || price <= 0) return;

    if (best == null || price < best) best = price;
  };

  for (const o of baseOffers) consider(o, "basePrice");
  for (const o of varOffers) consider(o, "unitPrice");

  return best;
}

/**
 * Read marginPercent from settings table.
 * Supports either:
 * - key="marginPercent"
 * - key="pricingMarkupPercent"
 */
let cachedMargin: { v: number; at: number } | null = null;
async function getMarginPercentCached(): Promise<number> {
  const now = Date.now();
  if (cachedMargin && now - cachedMargin.at < 30_000) return cachedMargin.v;

  try {
    const rowA = await prisma.setting.findUnique({ where: { key: "marginPercent" } });
    const vA = toNumAny(rowA?.value);

    const rowB = await prisma.setting.findUnique({ where: { key: "pricingMarkupPercent" } });
    const vB = toNumAny(rowB?.value);

    const v = Math.max(
      0,
      Number.isFinite(vA as any)
        ? (vA as number)
        : Number.isFinite(vB as any)
          ? (vB as number)
          : 0
    );
    cachedMargin = { v, at: now };
    return v;
  } catch {
    cachedMargin = { v: 0, at: now };
    return 0;
  }
}

async function buildFavoritesItemsPaginated(args: FavoriteListArgs): Promise<FavoriteListResult> {
  const { userId, page, pageSize } = args;

  const marginPercent = await getMarginPercentCached();

  const [total, rows] = await prisma.$transaction([
    prisma.favorite.count({
      where: { userId },
    }),

    prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        productId: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            title: true,
            retailPrice: true,
            imagesJson: true,
            sku: true,

            // ✅ schema says ProductVariant, not variants
            ProductVariant: {
              select: { id: true },
              take: 1,
            },

            // ✅ schema says SupplierProductOffer has basePrice, NOT unitPrice
            supplierProductOffers: {
              select: {
                id: true,
                supplierId: true,
                basePrice: true,
                isActive: true,
                inStock: true,
                availableQty: true,
              },
            },

            // ✅ schema says SupplierVariantOffer has unitPrice
            supplierVariantOffers: {
              select: {
                id: true,
                supplierId: true,
                unitPrice: true,
                isActive: true,
                inStock: true,
                availableQty: true,
                variantId: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const items = rows.map((r) => {
    const p = r.product;

    let supplierMinPrice: number | null = null;
    let computedRetailPrice: number | null = null;

    if (p) {
      supplierMinPrice = pickCheapestSupplierPrice(p);
      computedRetailPrice =
        supplierMinPrice != null && supplierMinPrice > 0
          ? applyMargin(supplierMinPrice, marginPercent)
          : null;
    }

    return {
      id: r.id,
      productId: r.productId,
      createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt ?? ""),

      supplierMinPrice,
      computedRetailPrice,

      product: p
        ? {
            id: p.id,
            title: p.title,
            slug: null as null,
            retailPrice: p.retailPrice != null ? Number(p.retailPrice as any) : null,
            images: normalizeImages(p.imagesJson),
            imagesJson: normalizeImages(p.imagesJson),
            sku: p.sku ?? null,

            // ✅ keep frontend shape stable as "variants"
            variants: Array.isArray(p.ProductVariant)
              ? p.ProductVariant.map((v) => ({ id: String(v.id) }))
              : [],
          }
        : null,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * GET /api/favorites
 * ✅ Returns the user's "wishlisted" items (Favorites)
 * Response: { items: WishlistItem[] }
 */
router.get("/", async (req, res, next) => {
  try {
    const page = clampPage(req.query.page, 1);
    const pageSize = clampPageSize(req.query.pageSize ?? req.query.take, 12, 48);

    const result = await buildFavoritesItemsPaginated({
      userId: req.user!.id,
      page,
      pageSize,
    });

    return res.json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/favorites/mine
 * ✅ Shape tailored for Catalog.tsx favourites badge:
 *    returns { productIds: string[] }
 */
router.get("/mine", async (req, res, next) => {
  try {
    const rows = await prisma.favorite.findMany({
      where: { userId: req.user!.id },
      select: { productId: true },
      orderBy: { createdAt: "desc" },
    });

    const productIds = rows.map((it) => String(it.productId));
    return res.json({ productIds });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/favorites/toggle
 * Body: { productId: string }
 * Toggles a single product in the current user's favorites list.
 * Response:
 *   - { isFavorite: true, id: string } if now added
 *   - { isFavorite: false } if removed
 */
router.post("/toggle", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const productIdRaw = (req.body as any)?.productId;
    const productId = typeof productIdRaw === "string" ? productIdRaw.trim() : "";

    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    const existing = await prisma.favorite.findFirst({
      where: { userId, productId },
      select: { id: true },
    });

    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return res.json({ isFavorite: false });
    }

    const created = await prisma.favorite.create({
      data: { userId, productId },
      select: { id: true },
    });

    return res.json({ isFavorite: true, id: created.id });
  } catch (e) {
    next(e);
  }
});

export default router;