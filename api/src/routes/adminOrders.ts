// api/src/routes/adminOrders.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, requireSuperAdmin } from "../middleware/auth.js";
import { logOrderActivityTx } from "../services/activity.service.js";
import {
  notifySuppliersForOrder,
} from "../services/notify.js";
import { syncProductInStockCacheTx } from "../services/inventory.service.js";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";
import { ps, PAYSTACK_MODE, PAYSTACK_SECRET_KEY } from "../lib/paystack.js";
import { Prisma } from "@prisma/client";
import { notifyCustomerOrderCancelled, notifyCustomerOrderRefunded } from "../services/notifications.service.js";
import { requiredString } from "../lib/http.js";

export const TRIAL_MODE =
  String(process.env.TRIAL_MODE || "").toLowerCase() === "true" ||
  String(process.env.TRIAL_MODE || "") === "1";

const router = Router();

const dbg = (...args: any[]) => console.log("[adminOrders/refund]", ...args);
const secretPrefix = (k?: string) => (k ? k.slice(0, 10) : "");

const ACT = {
  STATUS_CHANGE: "STATUS_CHANGE",
} as const;

/* =========================================================
   Paystack helpers
========================================================= */

async function resolvePaystackTransactionId(referenceOrId: string) {
  const raw = String(referenceOrId || "").trim();

  dbg("resolvePaystackTransactionId: input=", raw);
  dbg("paystack mode=", PAYSTACK_MODE, "secretPrefix=", secretPrefix(PAYSTACK_SECRET_KEY));

  if (!raw) return null;

  // If it looks like a number, it's probably already a transaction id
  if (/^\d+$/.test(raw)) {
    dbg("input looks numeric; using txId=", raw);
    return Number(raw);
  }

  // Otherwise, verify by reference
  try {
    dbg("verifying transaction by reference:", raw);
    const verify = await ps.get(`/transaction/verify/${encodeURIComponent(raw)}`);

    const ok = verify.data?.status;
    const trx = verify.data?.data;

    dbg("verify response: status=", ok, "paystackTrxId=", trx?.id, "trxStatus=", trx?.status);
    dbg("verify gateway_response=", trx?.gateway_response);

    return trx?.id ?? null;
  } catch (e: any) {
    dbg("verify failed:", e?.response?.data || e?.message || e);
    return null;
  }
}

/* =========================================================
   OTP helpers
========================================================= */

export async function assertVerifiedOrderOtp(
  orderId: string,
  purpose: "CANCEL_ORDER" | "PAY_ORDER" | "REFUND_ORDER",
  token: string,
  actorId: string,
) {
  if (!token) throw new Error("Missing OTP token");

  const row = await prisma.orderOtpRequest.findFirst({
    where: {
      id: token,
      orderId,
      purpose,
      verifiedAt: { not: null },
    },
    select: { id: true, expiresAt: true, consumedAt: true, userId: true },
  });

  if (!row) throw new Error("Invalid or unverified OTP token");
  if (row.expiresAt <= new Date()) throw new Error("OTP token expired");
  if (row.consumedAt) throw new Error("OTP token already used");

  // ✅ binds this admin to their own token
  if (String(row.userId) !== String(actorId)) throw new Error("OTP token not valid for this user");

  await prisma.orderOtpRequest.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });
}

/* =========================================================
   GET /api/admin/orders/:orderId
========================================================= */
router.get("/:orderId", requireAdmin, async (req, res) => {
  const { orderId } = req.params as { orderId: string };

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { email: true } },
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            product: { select: { title: true } },
            variant: { select: { id: true, sku: true, imagesJson: true } },
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            provider: true,
            reference: true,
            amount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    const paidStatuses = new Set(["PAID", "VERIFIED", "SUCCESS", "SUCCESSFUL", "COMPLETED"]);
    const paidAmount = (order.payments || []).reduce((acc: number, p: any) => {
      const s = String(p?.status || "").toUpperCase();
      if (!paidStatuses.has(s)) return acc;
      const n = Number(String(p.amount ?? 0));
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);

    const dto = {
      id: order.id,
      status: order.status,
      total: order.total,
      tax: order.tax,
      subtotal: order.subtotal,
      serviceFeeTotal: (order as any).serviceFeeTotal, // keep if your Order has it
      serviceFee: (order as any).serviceFee,
      serviceFeeBase: (order as any).serviceFeeBase,
      serviceFeeComms: (order as any).serviceFeeComms,
      serviceFeeGateway: (order as any).serviceFeeGateway,
      createdAt: order.createdAt,

      userEmail: order.user?.email ?? null,

      paidAmount,

      items: (order.items || []).map((it: any) => ({
        id: it.id,
        productId: it.productId ?? null,
        title: it.title ?? it.product?.title ?? null,

        unitPrice: it.unitPrice,
        quantity: it.quantity,
        lineTotal: it.lineTotal,

        status: it.status ?? null,
        selectedOptions: it.selectedOptions ?? null,

        chosenSupplierUnitPrice: it.chosenSupplierUnitPrice ?? null,

        chosenSupplierId: it.chosenSupplierId ?? null,
        chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
        chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,

        product: it.product ? { title: it.product.title ?? null } : null,
        variant: it.variant
          ? {
              id: it.variant.id,
              sku: it.variant.sku ?? null,
              imagesJson: it.variant.imagesJson ?? [],
            }
          : null,
      })),

      payments: order.payments || [],
    };

    return res.json({ ok: true, order: dto });
  } catch (e: any) {
    console.error("Admin get order failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to load order" });
  }
});

/* =========================================================
   GET /api/admin/orders/:id/suppliers
========================================================= */
router.get("/:id/suppliers", requireSuperAdmin, async (req, res) => {
  const orderId = requiredString(req.params.id);

  const pos = await prisma.purchaseOrder.findMany({
    where: { orderId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          orderItem: {
            select: {
              id: true,
              title: true,
              quantity: true,
              chosenSupplierUnitPrice: true,
              unitPrice: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    data: pos.map((po: any) => ({
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      supplierName: po.supplier?.name ?? null,
      supplierAmount: Number(po.supplierAmount ?? 0),
      status: po.status,
      items: (po.items || []).map((x: any) => ({
        orderItemId: x.orderItem?.id,
        title: x.orderItem?.title,
        qty: x.orderItem?.quantity,
        supplierUnit: Number(x.orderItem?.chosenSupplierUnitPrice ?? 0),
        customerUnit: Number(x.orderItem?.unitPrice ?? 0),
      })),
    })),
  });
});

/* =========================================================
   POST /api/admin/orders/:orderId/cancel
========================================================= */
router.post("/:orderId/cancel", requireAdmin, async (req, res) => {
  const orderId = requiredString(req.params.orderId);
  const actorId = requiredString((req as any).user?.id ?? "");

  // ✅ OTP REQUIRED HERE
  try {
    const otpToken = String(req.headers["x-otp-token"] ?? req.body?.otpToken ?? "").trim();
    await assertVerifiedOrderOtp(orderId, "CANCEL_ORDER", otpToken, actorId);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "OTP verification required" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              variantId: true,
              quantity: true,
              chosenSupplierProductOfferId: true,
              chosenSupplierVariantOfferId: true,
            },
          },
          payments: { select: { status: true } },
        },
      });

      if (!order) throw new Error("Order not found");
      if (order.status === "CANCELED") return order;

      const hasPaid = (order.payments || []).some((p: any) => {
        const s = String(p.status || "").toUpperCase();
        return ["PAID", "SUCCESS", "SUCCESSFUL", "VERIFIED", "COMPLETED"].includes(s);
      });
      if (hasPaid || ["PAID", "COMPLETED"].includes(order.status)) {
        throw new Error("Cannot cancel an order that has been paid/completed.");
      }

      for (const it of order.items) {
        const qty = Number(it.quantity || 0);
        if (!qty || qty <= 0) continue;

        if (it.chosenSupplierVariantOfferId) {
          const updatedOffer = await tx.supplierVariantOffer.update({
            where: { id: it.chosenSupplierVariantOfferId },
            data: { availableQty: { increment: qty } },
            select: { id: true, availableQty: true, productId: true },
          });

          if (Number(updatedOffer.availableQty) > 0) {
            await tx.supplierVariantOffer.update({
              where: { id: updatedOffer.id },
              data: { inStock: true },
            });
          }

          if (updatedOffer.productId) {
            await recomputeProductStockTx(tx, String(updatedOffer.productId));
          }
        } else if (it.chosenSupplierProductOfferId) {
          const updatedOffer = await tx.supplierProductOffer.update({
            where: { id: it.chosenSupplierProductOfferId },
            data: { availableQty: { increment: qty } },
            select: { id: true, availableQty: true, productId: true },
          });

          if (Number(updatedOffer.availableQty) > 0) {
            await tx.supplierProductOffer.update({
              where: { id: updatedOffer.id },
              data: { inStock: true },
            });
          }

          if (updatedOffer.productId) {
            await recomputeProductStockTx(tx, String(updatedOffer.productId));
          }
        }

        if (it.productId) {
          await syncProductInStockCacheTx(tx, String(it.productId));
        }
      }

      const canceled = await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELED" },
      });

      await logOrderActivityTx(tx, orderId, ACT.STATUS_CHANGE as any, "Order canceled by admin");

      return canceled;
    });

    // 🔔 Customer notification: order cancelled
    try {
      await notifyCustomerOrderCancelled(orderId);
    } catch (e) {
      console.error("notifyCustomerOrderCancelled failed", e);
    }

    return res.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error("Admin cancel order failed:", e);
    const msg = e?.message || "Failed to cancel order";
    if (msg.includes("Cannot cancel") || msg.includes("Order not found") || msg.includes("OTP")) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

/* =========================================================
   POST /api/admin/orders/:orderId/refund
   - Creates Refund rows (one per PO) with status APPROVED
   - If trial/manual -> mark REFUNDED without Paystack call
   - If paystack -> resolve tx id and call /refund
========================================================= */
router.post("/:orderId/refund", requireAdmin, async (req, res) => {
  const orderId  = requiredString(req.params.orderId);
  const actorId = requiredString((req as any).user?.id ?? "");

  // ✅ OTP REQUIRED FOR REFUND
  try {
    const otpToken = String(req.get("x-otp-token") ?? req.body?.otpToken ?? "").trim();
    await assertVerifiedOrderOtp(orderId, "REFUND_ORDER", otpToken, actorId);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "OTP verification required" });
  }

  let createdRefunds: Array<{
    id: string;
    purchaseOrderId: string;
    supplierId: string | null;
    itemsAmount: Prisma.Decimal;
    meta: any;
  }> = [];

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            provider: true,
            channel: true,
            reference: true,
            amount: true,
            providerPayload: true,
            initPayload: true,
            paidAt: true,
            refundedAt: true,
          },
        },
        purchaseOrders: {
          select: {
            id: true,
            supplierId: true,
            supplierAmount: true,
            subtotal: true,
            platformFee: true,
            status: true,
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    const paidPayment = (order.payments || []).find((p: any) => {
      const s = String(p.status || "").toUpperCase();
      return ["PAID", "SUCCESS", "SUCCESSFUL", "VERIFIED", "COMPLETED"].includes(s);
    });

    if (!paidPayment) {
      return res.status(400).json({ error: "Cannot refund: order has no paid payment" });
    }

    // Safety: ensure we have POs (Refund requires purchaseOrderId)
    const pos = order.purchaseOrders || [];
    if (!pos.length) {
      return res.status(400).json({ error: "Cannot refund: order has no purchase orders" });
    }

    // ---- Determine if this is truly a Paystack payment you can refund via API ----
    const providerUpper = String(paidPayment.provider || "").toUpperCase();
    const channelLower = String(paidPayment.channel || "").toLowerCase();

    const initMode = String((paidPayment.initPayload as any)?.mode ?? "").toLowerCase();
    const providerMode = String((paidPayment.providerPayload as any)?.mode ?? "").toLowerCase();

    const initTrial =
      !!(paidPayment.initPayload as any)?.trial ||
      initMode === "trial";

    const payloadTrial =
      !!(paidPayment.providerPayload as any)?.trial ||
      providerMode === "trial";

    const isPaystack = providerUpper === "PAYSTACK" || channelLower === "paystack";

    const isTrialLike =
      TRIAL_MODE ||
      initTrial ||
      payloadTrial ||
      providerUpper === "TRIAL" ||
      channelLower === "trial" ||
      // if you used trial/manual verify path, provider might be null/unknown
      !isPaystack;


    // ---- Prevent double refunds ----
    const existingRefunds = await prisma.refund.findMany({
      where: { orderId },
      select: { id: true, status: true, purchaseOrderId: true },
    });

    const refundEvent = await prisma.paymentEvent.findFirst({
      where: { paymentId: paidPayment.id, type: { in: ["REFUND_INIT", "REFUND_SUCCESS"] } },
      select: { id: true },
    });

    const alreadyInitiated =
      existingRefunds.some((r: any) => {
        const st = String(r.status || "").toUpperCase();
        return ["APPROVED", "REFUNDED", "CLOSED"].includes(st);
      }) || !!refundEvent;

    if (alreadyInitiated) {
      return res.status(409).json({ error: "Refund already initiated for this order/payment" });
    }

    // ---- Create Refund rows (one per PO) ----
    createdRefunds = await prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: {
          paymentId: paidPayment.id,
          type: "REFUND_INIT",
          data: { actorId, orderId, reference: paidPayment.reference, provider: paidPayment.provider },
        },
      });

      dbg("refund requested: orderId=", orderId, "actorId=", actorId);
      dbg("paidPayment.id=", paidPayment.id);
      dbg("paidPayment.provider=", paidPayment.provider);
      dbg("paidPayment.channel=", paidPayment.channel);
      dbg("paidPayment.status=", paidPayment.status);
      dbg("paidPayment.reference=", paidPayment.reference);
      dbg("paystack mode=", PAYSTACK_MODE, "secretPrefix=", secretPrefix(PAYSTACK_SECRET_KEY));

      const refundRows: any[] = [];

      for (const po of pos) {
        // @@unique([purchaseOrderId]) guard
        const already = await tx.refund.findFirst({
          where: { purchaseOrderId: po.id },
          select: { id: true },
        });
        if (already) throw new Error(`Refund already exists for purchaseOrderId ${po.id}`);

        const itemsAmount = new Prisma.Decimal(
          po.subtotal != null
            ? String(po.subtotal)
            : po.supplierAmount != null
              ? String(po.supplierAmount)
              : "0",
        );

        // If your PO.platformFee represents platform fee for that PO, map it to serviceFeeBaseAmount
        const serviceFeeBaseAmount = new Prisma.Decimal(po.platformFee != null ? String(po.platformFee) : "0");

        const taxAmount = new Prisma.Decimal("0");
        const serviceFeeCommsAmount = new Prisma.Decimal("0");
        const serviceFeeGatewayAmount = new Prisma.Decimal("0");

        const totalAmount = itemsAmount
          .plus(taxAmount)
          .plus(serviceFeeBaseAmount)
          .plus(serviceFeeCommsAmount)
          .plus(serviceFeeGatewayAmount);

        const meta = {
          actorId,
          paymentId: paidPayment.id,
          paymentRef: paidPayment.reference,
          purchaseOrderStatus: po.status,
        };

        const now = new Date();

        const r = await tx.refund.create({
          data: {
            // required relations
            order: { connect: { id: orderId } },
            purchaseOrder: { connect: { id: po.id } },
            ...(po.supplierId ? { supplier: { connect: { id: po.supplierId } } } : {}),

            // ✅ this sets requestedByUserId internally (no scalar field needed in payload)
            requestedBy: { connect: { id: actorId } },

            status: "APPROVED" as any,

            itemsAmount,
            taxAmount,
            serviceFeeBaseAmount,
            serviceFeeCommsAmount,
            serviceFeeGatewayAmount,
            totalAmount,

            provider: isPaystack ? "PAYSTACK" : "TRIAL",
            providerStatus: "INITIATED",
            providerPayload: Prisma.JsonNull,
            providerReference: null,

            // admin metadata (optional, but you had it)
            requestedAt: now,
            adminResolvedAt: now,
            adminResolvedBy: { connect: { id: actorId } }, // ✅ sets adminResolvedById internally
            adminDecision: "APPROVE",
            adminNote: "Refund initiated by admin",

            meta,
            reason: null,
            faultParty: null,
          },
          select: {
            id: true,
            purchaseOrderId: true,
            supplierId: true,
            totalAmount: true,
            itemsAmount: true,
            meta: true,
          },
        });


        refundRows.push(r);
      }

      await logOrderActivityTx(
        tx,
        orderId,
        ACT.STATUS_CHANGE as any,
        "Refund initiated by admin (refund rows created)",
        { paymentId: paidPayment.id, reference: paidPayment.reference },
      );

      return refundRows;
    });

    // ---- Trial/manual refund: DB-only success ----
    if (isTrialLike) {
      const refundData = {
        mode: "trial",
        ok: true,
        orderId,
        paymentId: paidPayment.id,
        reference: paidPayment.reference,
        at: new Date().toISOString(),
        note: "Refund simulated (non-Paystack payment or trial/manual paid)",
      };

      await prisma.$transaction(async (tx) => {
        await tx.paymentEvent.create({
          data: { paymentId: paidPayment.id, type: "REFUND_SUCCESS", data: refundData },
        });

        for (const r of createdRefunds) {
          await tx.refund.update({
            where: { purchaseOrderId: r.purchaseOrderId },
            data: {
              status: "REFUNDED",
              providerStatus: "SUCCESS",
              processedAt: new Date(),
              paidAt: new Date(),
              providerPayload: refundData,
              providerReference: String(paidPayment.reference || "") || null,
              meta: { ...(r.meta || {}), trialRefund: refundData } as any,
            },
          });

          // debit supplier ledger (optional: depends on your accounting model)
          if (r.supplierId) {
            await tx.supplierLedgerEntry.create({
              data: {
                supplierId: r.supplierId,
                type: "REFUND_DEBIT",
                amount: r.itemsAmount as any,
                currency: "NGN",
                referenceType: "REFUND",
                referenceId: r.id,
                meta: {
                  orderId,
                  purchaseOrderId: r.purchaseOrderId,
                  paymentId: paidPayment.id,
                  paymentRef: paidPayment.reference,
                },
              },
            });
          }
        }

        await tx.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });

        await tx.payment.update({
          where: { id: paidPayment.id },
          data: { status: "REFUNDED", refundedAt: new Date() },
        });

        await logOrderActivityTx(tx, orderId, ACT.STATUS_CHANGE as any, "Refund completed (trial/manual)");
      });

      // 🔔 Notify customer that order has been refunded (trial/manual path)
      try {
        await notifyCustomerOrderRefunded(orderId, paidPayment.id);
      } catch (e) {
        console.error("notifyCustomerOrderRefunded failed (trial/manual)", e);
      }

      return res.json({
        ok: true,
        mode: "trial",
        message: "Refund simulated (non-Paystack payment)",
        paymentId: paidPayment.id,
        refunds: createdRefunds,
      });
    }

    // ---- Paystack refund ----
    dbg("attempting to resolve txId for reference=", paidPayment.reference);

    const txId = await resolvePaystackTransactionId(paidPayment.reference);
    dbg("resolved txId=", txId);

    if (!txId) {
      return res.status(400).json({
        error:
          "Paystack transaction not found for stored payment reference. " +
          "This usually means the payment was not actually processed on Paystack (trial/manual paid), " +
          "or you're using the wrong Paystack key mode (test vs live).",
        paymentReference: paidPayment.reference,
        provider: paidPayment.provider,
        channel: paidPayment.channel,
        paystackMode: PAYSTACK_MODE,
        secretPrefix: secretPrefix(PAYSTACK_SECRET_KEY),
      });
    }

    dbg("calling paystack refund with txId=", txId);

    let resp;
    try {
      resp = await ps.post("/refund", { transaction: txId });
    } catch (e: any) {
      const errPayload = e?.response?.data || { message: e?.message || "Refund failed" };

      dbg("paystack refund failed:", errPayload);

      // record provider failure but keep Refund.status = APPROVED so you can retry
      await prisma.$transaction(async (tx) => {
        await tx.paymentEvent.create({
          data: { paymentId: paidPayment.id, type: "REFUND_ERROR", data: errPayload },
        });

        for (const r of createdRefunds) {
          await tx.refund.update({
            where: { purchaseOrderId: r.purchaseOrderId },
            data: {
              providerStatus: "FAILED",
              providerPayload: errPayload,
              meta: { ...(r.meta || {}), paystackError: errPayload } as any,
            },
          });
        }
      });

      return res.status(400).json({
        error: errPayload?.message || "Refund failed",
        details: errPayload,
      });
    }

    const refundData = resp.data?.data ?? resp.data;
    dbg("paystack refund success: top-level status=", resp.data?.status, "data=", refundData);

    // Persist success + ledger debits
    await prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: { paymentId: paidPayment.id, type: "REFUND_SUCCESS", data: refundData },
      });

      for (const r of createdRefunds) {
        await tx.refund.update({
          where: { purchaseOrderId: r.purchaseOrderId },
          data: {
            status: "REFUNDED",
            providerStatus: "SUCCESS",
            processedAt: new Date(),
            paidAt: new Date(),
            providerPayload: refundData,
            providerReference: String(refundData?.reference || refundData?.id || "") || null,
            meta: { ...(r.meta || {}), paystack: refundData } as any,
          },
        });

        if (r.supplierId) {
          await tx.supplierLedgerEntry.create({
            data: {
              supplierId: r.supplierId,
              type: "REFUND_DEBIT",
              amount: r.itemsAmount as any,
              currency: "NGN",
              referenceType: "REFUND",
              referenceId: r.id,
              meta: {
                orderId,
                purchaseOrderId: r.purchaseOrderId,
                paymentId: paidPayment.id,
                paymentRef: paidPayment.reference,
              },
            },
          });
        }
      }

      await tx.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });

      await tx.payment.update({
        where: { id: paidPayment.id },
        data: { status: "REFUNDED", refundedAt: new Date() },
      });

      await logOrderActivityTx(tx, orderId, ACT.STATUS_CHANGE as any, "Refund completed (Paystack)");
    });

    // 🔔 Notify customer that order has been refunded (Paystack path)
    try {
      await notifyCustomerOrderRefunded(orderId, paidPayment.id);
    } catch (e) {
      console.error("notifyCustomerOrderRefunded failed (paystack)", e);
    }

    return res.json({
      ok: true,
      provider: "PAYSTACK",
      paymentId: paidPayment.id,
      reference: paidPayment.reference,
      refund: refundData,
      refunds: createdRefunds,
    });
  } catch (e: any) {
    console.error("Admin refund failed:", e?.response?.data || e);

    // If we created rows but failed later outside Paystack catch, attempt to mark them as FAILED for visibility
    try {
      const errPayload = e?.response?.data || { message: e?.message || "Refund failed" };
      if (createdRefunds?.length) {
        await prisma.$transaction(async (tx) => {
          // best effort event
          // (safe even if duplicates; if you have unique constraint on PaymentEvent you can ignore)
          await tx.paymentEvent
            .create({
              data: {
                paymentId: (createdRefunds as any)?.[0]?.meta?.paymentId || undefined,
                type: "REFUND_ERROR",
                data: errPayload,
              },
            })
            .catch(() => null);

          for (const r of createdRefunds) {
            await tx.refund.update({
              where: { purchaseOrderId: r.purchaseOrderId },
              data: {
                providerStatus: "FAILED",
                providerPayload: errPayload,
                meta: { ...(r.meta || {}), error: errPayload } as any,
              },
            });
          }
        });
      }
    } catch {
      // ignore
    }

    return res.status(400).json({
      error: e?.response?.data?.message || e?.message || "Refund failed",
    });
  }
});

/* =========================================================
   GET /api/admin/orders/:orderId/activities
========================================================= */
router.get("/:orderId/activities", requireAdmin, async (req, res, next) => {
  try {
    const orderId = requiredString(req.params.orderId);
    const items = await prisma.orderActivity.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: items });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   POST /api/admin/orders/:orderId/notify-suppliers
========================================================= */
router.post("/:orderId/notify-suppliers", requireAdmin, async (req, res) => {
  const { orderId } = req.params as { orderId: string };
  try {
    const result = await notifySuppliersForOrder(orderId);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Notify failed" });
  }
});

/* =========================================================
   GET /api/admin/orders/:orderId/notify-status
========================================================= */
router.get("/:orderId/notify-status", requireAdmin, async (req, res) => {
  const { orderId } = req.params as { orderId: string };
  const pos = await prisma.purchaseOrder.findMany({
    where: { orderId },
    select: { id: true, supplierId: true, whatsappMsgId: true, status: true },
  });
  return res.json({ data: pos });
});

export default router;
