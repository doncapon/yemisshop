import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';

// replace your parseItemsParam with this one
type Pair = { productId: string; variantId: string | null };

function parseItemsParam(itemsParam: unknown): Pair[] {
  // 1) flatten to a string[]
  let rawParts: string[] = [];

  if (typeof itemsParam === 'string') {
    rawParts = [itemsParam];
  } else if (Array.isArray(itemsParam)) {
    // could be (string | ParsedQs)[]
    rawParts = (itemsParam as unknown[]).map((v) => String(v));
  } else if (itemsParam != null) {
    rawParts = [String(itemsParam)];
  }

  // 2) split comma-separated values into tokens like "productId:variantId"
  const tokens = rawParts
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  // 3) map tokens to pairs and de-duplicate
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
    return res.status(400).json({ error: 'Query param "items" is required, e.g. items=prod1:varA,prod2:' });
  }

  // Collect unique productIds
  const productIds = Array.from(new Set(pairs.map(p => p.productId)));

  // Fetch all active offers for those products (one trip)
  const offers = await prisma.supplierOffer.findMany({
    where: { productId: { in: productIds }, isActive: true },
    select: {
      productId: true,
      variantId: true,       // can be null = product-wide
      availableQty: true,
      price: true,
    },
  });

  // Pre-bucket offers by product to make aggregation cheap
  const byProduct = new Map<string, Array<{
    variantId: string | null;
    availableQty: number;
    price: number | null;
  }>>();

  for (const o of offers) {
    const arr = byProduct.get(o.productId) ?? [];
    arr.push({
      variantId: o.variantId ?? null,
      availableQty: Math.max(0, Number(o.availableQty ?? 0) || 0),
      price: Number.isFinite(Number(o.price)) ? Number(o.price) : null,
    });
    byProduct.set(o.productId, arr);
  }

  // Build response aligned to request order
  const data = pairs.map(({ productId, variantId }) => {
    const list = byProduct.get(productId) ?? [];

    let totalAvailable = 0;
    let cheapest: number | null = null;

    for (const o of list) {
      // Rule:
      // - if variantId === null → include ONLY product-wide offers (o.variantId === null)
      // - if variantId is set  → include exact matches (o.variantId === variantId) AND product-wide (o.variantId === null)
      const include =
        (variantId === null && o.variantId === null) ||
        (variantId !== null && (o.variantId === variantId || o.variantId === null));

      if (!include) continue;

      totalAvailable += o.availableQty;
      if (o.price != null) {
        cheapest = cheapest == null ? o.price : Math.min(cheapest, o.price);
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
router.get(['/catalog/availability', '/products/availability', '/supplier-offers/availability'], availabilityHandler);

export default router;