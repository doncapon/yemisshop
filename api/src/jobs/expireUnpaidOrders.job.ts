// api/src/jobs/expireUnpaidOrders.job.ts
import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { logOrderActivityTx } from "../services/activity.service.js";
import {
  hasSuccessfulPaymentForOrderTx,
  markPendingPaymentsCanceledTx,
  restoreOrderInventoryTx,
} from "../services/orderInventory.service.js";

const ORDER_PENDING_TTL_MIN = Number(process.env.ORDER_PENDING_TTL_MIN ?? 60);
const ORDER_EXPIRY_CRON = process.env.ORDER_EXPIRY_CRON || "*/10 * * * *";
const ORDER_EXPIRY_ENABLED =
  String(process.env.ORDER_EXPIRY_ENABLED ?? "true").toLowerCase() === "true";

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
    take: 200,
    orderBy: { createdAt: "asc" },
  });

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
        },
        {
          isolationLevel: "Serializable" as any,
          maxWait: 10_000,
          timeout: 30_000,
        }
      );
    } catch (e) {
      console.error("[expire-unpaid-orders] failed", { orderId: row.id, error: e });
    }
  }
}

export function registerExpireUnpaidOrdersJob() {
  if (!ORDER_EXPIRY_ENABLED) {
    console.log("[cron] unpaid order expiry scheduler disabled");
    return;
  }

  cron.schedule(
    ORDER_EXPIRY_CRON,
    async () => {
      try {
        await expireUnpaidOrdersOnce();
      } catch (e) {
        console.error("[cron] unpaid order expiry failed", e);
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
  });
}