import { prisma } from "../lib/prisma.js";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";

type RecomputeStockSummary = {
  scanned: number;
  updated: number;
  failed: number;
  details: Array<{
    productId: string;
    action: "updated" | "failed";
    reason?: string;
  }>;
};

const DEFAULT_BATCH_SIZE = 50;
const MAX_DETAILS = 100;

function pushDetail(
  summary: RecomputeStockSummary,
  row: {
    productId: string;
    action: "updated" | "failed";
    reason?: string;
  }
) {
  if (summary.details.length < MAX_DETAILS) {
    summary.details.push(row);
  }
}

export async function recomputeProductStockOnce(
  batchSize = DEFAULT_BATCH_SIZE
): Promise<RecomputeStockSummary> {
  const summary: RecomputeStockSummary = {
    scanned: 0,
    updated: 0,
    failed: 0,
    details: [],
  };

  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: Math.max(1, Math.min(batchSize, 200)),
    select: {
      id: true,
    },
  });

  summary.scanned = products.length;

  for (const product of products) {
    try {
      await prisma.$transaction(async (tx) => {
        await recomputeProductStockTx(tx, product.id);
      });

      summary.updated++;
      pushDetail(summary, {
        productId: product.id,
        action: "updated",
      });
    } catch (err: any) {
      summary.failed++;
      pushDetail(summary, {
        productId: product.id,
        action: "failed",
        reason: String(err?.message || err || "unknown_error"),
      });
    }
  }

  return summary;
}