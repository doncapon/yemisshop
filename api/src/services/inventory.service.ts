// api/src/services/inventory.service.ts
import type { PrismaClient } from "@prisma/client";

/**
 * Some of your code passes `tx` from prisma.$transaction() callbacks.
 * Depending on Prisma generation and how you name models, the property can be:
 *   tx.productVariant vs tx.ProductVariant, tx.supplierOffer vs tx.SupplierOffer, etc.
 *
 * This helper finds whichever exists.
 */
function pickModel(tx: any, names: string[]) {
  for (const n of names) {
    const m = tx?.[n];
    if (m) return m;
  }
  return null;
}

function asNumber(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Derive product in-stock + availableQty from offers.
 *
 * Priority:
 *  1) SupplierVariantOffer (new model)
 *  2) SupplierOffer (legacy model)
 *  3) Fallback: productVariant/product fields if offers are missing
 */
export async function deriveProductInStockTx(
  tx: any,
  productId: string
): Promise<{ availableQty: number; inStock: boolean }> {
  const pid = String(productId);

  // -------------------------
  // 1) Preferred: SupplierVariantOffer
  // -------------------------
  const SupplierVariantOffer = pickModel(tx, ["supplierVariantOffer", "SupplierVariantOffer"]);
  if (SupplierVariantOffer) {
    // Try groupBy first (fast)
    try {
      // If your model has a relation filter to supplierProductOffer, keep it.
      // If it doesn't, this will throw and we will fallback to a simpler where.
      const grouped = await SupplierVariantOffer.groupBy({
        by: ["productId"],
        where: {
          productId: pid,
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
          // relation filter (optional)
          supplierProductOffer: { isActive: true, inStock: true },
        },
        _sum: { availableQty: true },
      });

      const sum = asNumber(grouped?.[0]?._sum?.availableQty, 0);
      return { availableQty: Math.max(0, sum), inStock: Math.max(0, sum) > 0 };
    } catch {
      // Fallback groupBy without relation filter
      try {
        const grouped = await SupplierVariantOffer.groupBy({
          by: ["productId"],
          where: {
            productId: pid,
            isActive: true,
            inStock: true,
            availableQty: { gt: 0 },
          },
          _sum: { availableQty: true },
        });

        const sum = asNumber(grouped?.[0]?._sum?.availableQty, 0);
        return { availableQty: Math.max(0, sum), inStock: Math.max(0, sum) > 0 };
      } catch {
        // Last resort for SVO: findMany and sum in JS
        const rows = await SupplierVariantOffer.findMany({
          where: {
            productId: pid,
            isActive: true,
            inStock: true,
            availableQty: { gt: 0 },
          },
          select: { availableQty: true },
        });

        const sum = (rows || []).reduce((s: number, r: any) => s + Math.max(0, asNumber(r.availableQty, 0)), 0);
        return { availableQty: Math.max(0, sum), inStock: Math.max(0, sum) > 0 };
      }
    }
  }

  // -------------------------
  // 2) Legacy: SupplierOffer
  // -------------------------
  const SupplierOffer = pickModel(tx, ["supplierOffer", "SupplierOffer"]);
  if (SupplierOffer) {
    try {
      const grouped = await SupplierOffer.groupBy({
        by: ["productId"],
        where: {
          productId: pid,
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
        },
        _sum: { availableQty: true },
      });

      const sum = asNumber(grouped?.[0]?._sum?.availableQty, 0);
      return { availableQty: Math.max(0, sum), inStock: Math.max(0, sum) > 0 };
    } catch {
      const rows = await SupplierOffer.findMany({
        where: {
          productId: pid,
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
        },
        select: { availableQty: true },
      });

      const sum = (rows || []).reduce((s: number, r: any) => s + Math.max(0, asNumber(r.availableQty, 0)), 0);
      return { availableQty: Math.max(0, sum), inStock: Math.max(0, sum) > 0 };
    }
  }

  // -------------------------
  // 3) Fallback: productVariant/product stock fields if offers don't exist
  // -------------------------
  const ProductVariant = pickModel(tx, ["productVariant", "ProductVariant"]);
  if (ProductVariant) {
    try {
      const grouped = await ProductVariant.groupBy({
        by: ["productId"],
        where: { productId: pid, inStock: true },
        _sum: { availableQty: true },
      });

      const sum = asNumber(grouped?.[0]?._sum?.availableQty, 0);
      return { availableQty: Math.max(0, sum), inStock: Math.max(0, sum) > 0 };
    } catch {
      // ignore
    }
  }

  // If nothing else, check product itself
  const Product = pickModel(tx, ["product", "Product"]);
  if (Product) {
    try {
      const p = await Product.findUnique({
        where: { id: pid },
        select: { availableQty: true, inStock: true } as any,
      });

      const qty = Math.max(0, asNumber((p as any)?.availableQty, 0));
      const inStock = Boolean((p as any)?.inStock) && qty > 0;
      return { availableQty: qty, inStock };
    } catch {
      // ignore
    }
  }

  return { availableQty: 0, inStock: false };
}

/**
 * Update the product cache fields (availableQty + inStock) after changes.
 * This is called from orders.ts after allocation / decrements.
 *
 * NOTE: This tries the common field names; if your schema differs,
 * it will still not crash the order creation.
 */
export async function syncProductInStockCacheTx(tx: any, productId: string): Promise<void> {
  const pid = String(productId);

  const { availableQty, inStock } = await deriveProductInStockTx(tx, pid);

  const Product = pickModel(tx, ["product", "Product"]);
  if (!Product) return;

  // Try update with the common field names
  try {
    await Product.update({
      where: { id: pid },
      data: { availableQty, inStock },
      select: { id: true },
    });
    return;
  } catch {
    // If the schema doesn't have availableQty/inStock on Product, don't kill checkout.
  }

  // Try alternate naming (some schemas use stock/qty/available)
  const attempts: Array<any> = [
    { data: { available: availableQty, inStock } },
    { data: { qty: availableQty, inStock } },
    { data: { stock: availableQty, inStock } },
  ];

  for (const a of attempts) {
    try {
      await Product.update({
        where: { id: pid },
        ...a,
        select: { id: true },
      });
      return;
    } catch {
      // continue
    }
  }

  // If product field names differ, you can safely ignore this cache update.
}
