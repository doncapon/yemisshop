import { prisma } from "../lib/prisma.js";
import { NotificationType } from "@prisma/client";
import { notifySupplierBySupplierId } from "../services/notifications.service.js";

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 3);

// Don't re-notify the same supplier more than once in this window, even if
// they still have low-stock products on every hourly tick.
const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function countLowStockProducts(supplierId: string): Promise<number> {
  const [baseOfferProducts, variantOfferProducts] = await Promise.all([
    prisma.supplierProductOffer.findMany({
      where: { isActive: true, inStock: true, product: { supplierId } } as any,
      select: { productId: true },
    }),
    prisma.supplierVariantOffer.findMany({
      where: { isActive: true, inStock: true, product: { supplierId } } as any,
      select: { productId: true },
    }),
  ]);

  const liveProductIds = new Set<string>();
  for (const r of baseOfferProducts) liveProductIds.add(String(r.productId));
  for (const r of variantOfferProducts) liveProductIds.add(String(r.productId));

  const [baseAgg, variantAgg] = await Promise.all([
    prisma.supplierProductOffer.groupBy({
      by: ["productId"],
      where: { isActive: true, inStock: true, product: { supplierId } } as any,
      _sum: { availableQty: true },
    }),
    prisma.supplierVariantOffer.groupBy({
      by: ["productId"],
      where: { isActive: true, inStock: true, product: { supplierId } } as any,
      _sum: { availableQty: true },
    }),
  ]);

  const totalsByProduct: Record<string, number> = {};
  for (const r of baseAgg as any[]) {
    const pid = String(r.productId);
    totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + num(r._sum.availableQty);
  }
  for (const r of variantAgg as any[]) {
    const pid = String(r.productId);
    totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + num(r._sum.availableQty);
  }

  let lowStock = 0;
  for (const pid of liveProductIds) {
    if ((totalsByProduct[pid] ?? 0) <= LOW_STOCK_THRESHOLD) lowStock++;
  }
  return lowStock;
}

type LowStockCheckSummary = {
  scanned: number;
  notified: number;
  skippedRecentlyNotified: number;
  failed: number;
};

export async function checkLowStockOnce(): Promise<LowStockCheckSummary> {
  const summary: LowStockCheckSummary = {
    scanned: 0,
    notified: 0,
    skippedRecentlyNotified: 0,
    failed: 0,
  };

  const suppliers = await prisma.supplier.findMany({
    where: {
      status: "ACTIVE" as any,
      shippingEnabled: true,
      notifyLowStock: true,
    },
    select: { id: true, lastLowStockNotifiedAt: true },
  });

  summary.scanned = suppliers.length;

  const now = Date.now();

  for (const supplier of suppliers) {
    try {
      const recentlyNotified =
        supplier.lastLowStockNotifiedAt &&
        now - new Date(supplier.lastLowStockNotifiedAt).getTime() < RENOTIFY_AFTER_MS;

      if (recentlyNotified) {
        summary.skippedRecentlyNotified++;
        continue;
      }

      const lowStockCount = await countLowStockProducts(supplier.id);
      if (lowStockCount <= 0) continue;

      await notifySupplierBySupplierId(supplier.id, {
        type: NotificationType.LOW_STOCK,
        title: "Products running low on stock",
        body: `${lowStockCount} product${lowStockCount === 1 ? " is" : "s are"} at or below ${LOW_STOCK_THRESHOLD} units. Restock soon to avoid going out of stock.`,
        data: { lowStockCount, threshold: LOW_STOCK_THRESHOLD },
      });

      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { lastLowStockNotifiedAt: new Date() },
      });

      summary.notified++;
    } catch (err: any) {
      summary.failed++;
      console.error("[low-stock-check] failed for supplier", supplier.id, err?.message || err);
    }
  }

  return summary;
}
