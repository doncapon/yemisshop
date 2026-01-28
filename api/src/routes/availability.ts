// api/src/routes/availability.ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';

type Pair = { productId: string; variantId: string | null };

function parseItemsParam(itemsParam: unknown): Pair[] {
  let rawParts: string[] = [];

  if (typeof itemsParam === 'string') {
    rawParts = [itemsParam];
  } else if (Array.isArray(itemsParam)) {
    rawParts = (itemsParam as unknown[]).map((v) => String(v));
  } else if (itemsParam != null) {
    rawParts = [String(itemsParam)];
  }

  const tokens = rawParts
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Pair[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const [pidRaw, vidRaw] = token.split(':', 2);
    const productId = (pidRaw ?? '').trim();
    if (!productId) continue;

    const variantId = vidRaw == null || vidRaw.trim() === '' ? null : vidRaw.trim();

    const key = `${productId}::${variantId ?? 'null'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ productId, variantId });
  }

  return out;
}

const router = Router();

/**
 * GET /api/(catalog|products|supplier-offers)/availability?items=productId:variantId,productId2:
 *
 * Response:
 * {
 *   data: Array<{
 *     productId: string,
 *     variantId: string | null,
 *     totalAvailable: number,
 *     cheapestSupplierUnit: number | null
 *   }>
 * }
 */
async function availabilityHandler(req: Request, res: Response) {
  const pairs = parseItemsParam(req.query.items);
  if (pairs.length === 0) {
    return res
      .status(400)
      .json({ error: 'Query param "items" is required, e.g. items=prod1:varA,prod2:' });
  }

  const productIds = Array.from(new Set(pairs.map((p) => p.productId)));

  // 1) Base offers (SupplierProductOffer)
  const baseOffers = await prisma.supplierProductOffer.findMany({
    where: {
      productId: { in: productIds },
      isActive: true,
      inStock: true,
    },
    select: {
      productId: true,
      availableQty: true,
      basePrice: true,
    },
  });

  // 2) Variant offers (SupplierVariantOffer)
  const variantOffers = await prisma.supplierVariantOffer.findMany({
    where: {
      productId: { in: productIds },
      isActive: true,
      inStock: true,
    },
    select: {
      productId: true,
      variantId: true,
      availableQty: true,
      priceBump: true,
      supplierProductOffer: {
        select: {
          basePrice: true,
        },
      },
    },
  });

  // Buckets
  const baseByProduct = new Map<
    string,
    Array<{ availableQty: number; basePrice: number | null }>
  >();

  const variantByProduct = new Map<
    string,
    Array<{
      variantId: string;
      availableQty: number;
      unitPrice: number | null; // basePrice + priceBump
    }>
  >();

  for (const o of baseOffers) {
    const arr = baseByProduct.get(o.productId) ?? [];
    arr.push({
      availableQty: Math.max(0, Number(o.availableQty ?? 0) || 0),
      basePrice: o.basePrice != null ? Number(o.basePrice) : null,
    });
    baseByProduct.set(o.productId, arr);
  }

  for (const o of variantOffers) {
    const pid = o.productId;
    const vid = String(o.variantId);

    const basePrice =
      o.supplierProductOffer?.basePrice != null ? Number(o.supplierProductOffer.basePrice) : null;
    const bump = o.priceBump != null ? Number(o.priceBump) : 0;

    const unitPrice =
      basePrice != null && Number.isFinite(basePrice) ? basePrice + bump : null;

    const arr = variantByProduct.get(pid) ?? [];
    arr.push({
      variantId: vid,
      availableQty: Math.max(0, Number(o.availableQty ?? 0) || 0),
      unitPrice: unitPrice != null && Number.isFinite(unitPrice) ? unitPrice : null,
    });
    variantByProduct.set(pid, arr);
  }

  // Build response aligned to request order
  const data = pairs.map(({ productId, variantId }) => {
    if (variantId == null) {
      // BASE line: only SupplierProductOffer pool
      const list = baseByProduct.get(productId) ?? [];
      let totalAvailable = 0;
      let cheapest: number | null = null;

      for (const o of list) {
        totalAvailable += o.availableQty;
        if (o.basePrice != null) {
          cheapest = cheapest == null ? o.basePrice : Math.min(cheapest, o.basePrice);
        }
      }

      return {
        productId,
        variantId: null as string | null,
        totalAvailable,
        cheapestSupplierUnit: cheapest,
      };
    }

    // VARIANT line: only SupplierVariantOffer for that variantId (no borrowing from base)
    const list = variantByProduct.get(productId) ?? [];
    let totalAvailable = 0;
    let cheapest: number | null = null;

    for (const o of list) {
      if (o.variantId !== variantId) continue;
      totalAvailable += o.availableQty;
      if (o.unitPrice != null) {
        cheapest = cheapest == null ? o.unitPrice : Math.min(cheapest, o.unitPrice);
      }
    }

    return {
      productId,
      variantId,
      totalAvailable,
      cheapestSupplierUnit: cheapest,
    };
  });

  res.json({ data });
}

// Mount the same handler under all three paths your frontend probes
router.get(
  ['/catalog/availability', '/products/availability', '/supplier-offers/availability'],
  availabilityHandler
);

export default router;
