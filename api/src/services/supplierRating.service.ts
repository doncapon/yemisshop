// api/src/services/supplierRating.service.ts
import { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function num(v: any) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object" && typeof (v as any).toNumber === "function") {
    const n = (v as any).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Core "lifetime" store rating based on fulfilment / cancellations / refunds.
 * This mirrors the logic you had in supplierDashboard.ts.
 */
async function computeSupplierLifetimeCoreRating(supplierId: string) {
  const [totalPO, deliveredPO, canceledPO, refunds] = await Promise.all([
    prisma.purchaseOrder.count({ where: { supplierId } }),
    prisma.purchaseOrder.count({
      where: { supplierId, status: PurchaseOrderStatus.DELIVERED },
    }),
    prisma.purchaseOrder.count({
      where: { supplierId, status: PurchaseOrderStatus.CANCELED },
    }),
    prisma.refund.count({ where: { supplierId } }),
  ]);

  const n = totalPO;

  const deliveredRate = n > 0 ? deliveredPO / n : 0;
  const cancelRate = n > 0 ? canceledPO / n : 0;
  const refundRate = n > 0 ? refunds / n : 0;

  const scoreFulfillment = clamp(deliveredRate * 5, 0, 5);
  const scoreCancels = clamp((1 - cancelRate) * 5, 0, 5);
  const scoreRefunds = clamp((1 - refundRate) * 5, 0, 5);

  const rawRating =
    0.55 * scoreFulfillment + 0.25 * scoreCancels + 0.2 * scoreRefunds;

  const prior = 4.2;
  const priorWeight = 10;

  const lifetimeRating =
    n === 0
      ? prior
      : (priorWeight * prior + n * rawRating) / (priorWeight + n);

  return {
    lifetimeRating: Math.round(lifetimeRating * 10) / 10,
    lifetimeRaw: Math.round(rawRating * 100) / 100,
    totalPO,
    deliveredPO,
    canceledPO,
    refunds,
  };
}

/**
 * Blend lifetime performance with SupplierReview rows.
 * Returns combined rating + breakdown.
 *
 * You can optionally persist into Supplier later if you add fields.
 */
export async function recomputeSupplierRatingWithReviews(supplierId: string) {
  const core = await computeSupplierLifetimeCoreRating(supplierId);

  const reviewAgg = await prisma.supplierReview.aggregate({
    where: { supplierId },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const reviewAvg = num(reviewAgg._avg.rating);
  const reviewCount = num(reviewAgg._count._all);

  // Bayesian-style blend:
  // prior (4.2) with weight 10 is already baked into lifetimeRating.
  // Here we treat each review as another sample around its own mean.
  const prior = 4.2;
  const priorWeight = 10;

  const coreWeight = core.totalPO; // each PO is one sample
  const reviewWeight = reviewCount;

  const totalWeight = priorWeight + coreWeight + reviewWeight;

  let combined = prior * priorWeight + core.lifetimeRating * coreWeight;
  if (reviewCount > 0 && reviewAvg > 0) {
    combined += reviewAvg * reviewWeight;
  }

  const combinedRating =
    totalWeight > 0 ? Math.round((combined / totalWeight) * 10) / 10 : prior;

  // If later you add fields on Supplier, you can persist here, e.g.:
  //
  // await prisma.supplier.update({
  //   where: { id: supplierId },
  //   data: {
  //     rating: new Prisma.Decimal(combinedRating),
  //     ratingCount: reviewCount,
  //   },
  // });

  return {
    ratingAvg: combinedRating,
    ratingCount: reviewCount,
    lifetime: core,
    reviews: {
      reviewAvg,
      reviewCount,
    },
  };
}