// api/src/routes/favourites.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();
router.use(requireAuth);

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

    const v = Math.max(0, Number.isFinite(vA as any) ? (vA as number) : Number.isFinite(vB as any) ? (vB as number) : 0);
    cachedMargin = { v, at: now };
    return v;
  } catch {
    cachedMargin = { v: 0, at: now };
    return 0;
  }
}

async function buildFavoritesItems(userId: string) {
  const marginPercent = await getMarginPercentCached();

  const rows = await prisma.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
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

          // ✅ Needed to compute cheapest offer like Catalog/ProductDetail
          supplierProductOffers: {
            select: {
              id: true,
              basePrice: true,
              isActive: true,
              inStock: true,
              availableQty: true,
            },
          },
          supplierVariantOffers: {
            select: {
              id: true,
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
  });

  const items = rows.map((r) => {
    const p = r.product;

    let supplierMinPrice: number | null = null;
    let computedRetailPrice: number | null = null;

    if (p) {
      supplierMinPrice = pickCheapestSupplierPrice(p);
      computedRetailPrice =
        supplierMinPrice != null && supplierMinPrice > 0 ? applyMargin(supplierMinPrice, marginPercent) : null;
    }

    return {
      id: r.id,
      productId: r.productId,
      createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt ?? ""),

      // ✅ top-level computed fields (easy for UI)
      supplierMinPrice,
      computedRetailPrice,

      product: p
        ? {
            id: p.id,
            title: p.title,
            slug: null as null, // keep your UI shape stable
            retailPrice: p.retailPrice != null ? Number(p.retailPrice as any) : null,
            images: normalizeImages((p as any).imagesJson),
            sku: (p as any).sku ?? null,

            // (optional) also include computed fields inside product if you prefer
            // supplierMinPrice,
            // computedRetailPrice,
          }
        : null,
    };
  });

  return items;
}

/**
 * GET /api/favorites
 * ✅ Returns the user's "wishlisted" items (Favorites)
 * Response: { items: WishlistItem[] }
 */
router.get("/", async (req, res, next) => {
  try {
    const items = await buildFavoritesItems(req.user!.id);
    return res.json({ items });
  } catch (e) {
    next(e);
  }
});

/**
 * Optional alias (if referenced elsewhere)
 */
router.get("/mine", async (req, res, next) => {
  try {
    const items = await buildFavoritesItems(req.user!.id);
    return res.json({ items });
  } catch (e) {
    next(e);
  }
});

export default router;
