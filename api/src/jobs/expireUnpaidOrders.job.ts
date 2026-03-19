import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { logOrderActivityTx } from "../services/activity.service.js";
import {
  hasSuccessfulPaymentForOrderTx,
  markPendingPaymentsCanceledTx,
  restoreOrderInventoryTx,
} from "../services/orderInventory.service.js";

const ORDER_PENDING_TTL_MIN = Number(process.env.ORDER_PENDING_TTL_MIN ?? 60);
const ORDER_EXPIRY_CRON = process.env.ORDER_EXPIRY_CRON || "*/15 * * * *";
const ORDER_EXPIRY_ENABLED =
  String(process.env.ORDER_EXPIRY_ENABLED ?? "true").toLowerCase() === "true";
const ORDER_EXPIRY_BATCH_SIZE = Number(process.env.ORDER_EXPIRY_BATCH_SIZE ?? 50);

let isExpireJobRunning = false;

export async function expireUnpaidOrdersOnce() {
  const cutoff = new Date(Date.now() - ORDER_PENDING_TTL_MIN * 60_000);

  const candidates = await prisma.order.findMany({
    where: {
      createdAt: { lt: cutoff },
      status: { in: ["CREATED", "PENDING"] as any },
    },
    select: {
      id: true,
      createdAt: true,
    },
    take: ORDER_EXPIRY_BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });

  if (!candidates.length) {
    console.log("[expire-unpaid-orders] no candidates");
    return { scanned: 0, expired: 0, failed: 0 };
  }

  let expired = 0;
  let failed = 0;

  for (const row of candidates) {
    try {
      await prisma.$transaction(
        async (tx: any) => {
          const order = await tx.order.findUnique({
            where: { id: row.id },
            select: {
              id: true,
              status: true,
            },
          });

          if (!order) return;
          if (!["CREATED", "PENDING"].includes(String(order.status).toUpperCase())) return;

          const hasPaid = await hasSuccessfulPaymentForOrderTx(tx, order.id);
          if (hasPaid) return;

          await restoreOrderInventoryTx(tx, order.id);

          await tx.purchaseOrder.updateMany({
            where: {
              orderId: order.id,
              status: { in: ["CREATED", "FUNDED", "CONFIRMED", "PACKED"] as any },
            },
            data: {
              status: "CANCELED",
              canceledAt: new Date(),
              cancelReason: "PAYMENT_EXPIRED",
              cancelNote: `Auto-canceled after ${ORDER_PENDING_TTL_MIN} minutes without payment.`,
            } as any,
          });

          await markPendingPaymentsCanceledTx(
            tx,
            order.id,
            `Order auto-expired after ${ORDER_PENDING_TTL_MIN} minutes without payment`
          );

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "CANCELED",
            } as any,
          });

          await logOrderActivityTx(
            tx,
            order.id,
            "ORDER_EXPIRED" as any,
            `Order auto-canceled after ${ORDER_PENDING_TTL_MIN} minutes without payment`
          );

          expired += 1;
        },
        {
          // Serializable is costly; only keep it if you have proven race issues that require it
          maxWait: 5_000,
          timeout: 15_000,
        }
      );
    } catch (e) {
      failed += 1;
      console.error("[expire-unpaid-orders] failed", { orderId: row.id, error: e });
    }
  }

  console.log("[expire-unpaid-orders] finished", {
    scanned: candidates.length,
    expired,
    failed,
    batchSize: ORDER_EXPIRY_BATCH_SIZE,
  });

  return { scanned: candidates.length, expired, failed };
}

export function registerExpireUnpaidOrdersJob() {
  if (!ORDER_EXPIRY_ENABLED) {
    console.log("[cron] unpaid order expiry scheduler disabled");
    return;
  }

  cron.schedule(
    ORDER_EXPIRY_CRON,
    async () => {
      if (isExpireJobRunning) {
        console.log("[cron] unpaid order expiry skipped: already running");
        return;
      }

      isExpireJobRunning = true;

      try {
        await expireUnpaidOrdersOnce();
      } catch (e) {
        console.error("[cron] unpaid order expiry failed", e);
      } finally {
        isExpireJobRunning = false;
      }
    },
    {
      timezone: "UTC",
    }
  );

  console.log("[cron] unpaid order expiry scheduler registered", {
    expression: ORDER_EXPIRY_CRON,
    ttlMinutes: ORDER_PENDING_TTL_MIN,
    enabled: ORDER_EXPIRY_ENABLED,
    timezone: "UTC",
    batchSize: ORDER_EXPIRY_BATCH_SIZE,
  });
}
