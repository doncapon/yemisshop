import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { Prisma, SupplierPaymentStatus } from "@prisma/client";
import { assertVerifiedOrderOtp } from "./adminOrders.js";
import { sendOtpEmail } from "../lib/email.js";
import { sendWhatsAppOtp } from "../lib/sms.js";
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";
import crypto from "crypto";
import { PurchaseOrderStatus } from "@prisma/client";

// ✅ notifications helpers
import {
  notifyUser,
  notifyAdmins,
  notifySupplierBySupplierId,
} from "../services/notifications.service.js";

const router = Router();

// ✅ ADD this helper near the top (after router const is fine)
function normRole(role: any): string {
  return String(role ?? "").trim().toUpperCase();
}

// ✅ CHANGE these 3 helpers to use normalization
const isAdmin = (role?: string) => {
  const r = normRole(role);
  return r === "ADMIN" || r === "SUPER_ADMIN";
};
const isSupplier = (role?: string) => normRole(role) === "SUPPLIER";
const isRider = (role?: string) => normRole(role) === "SUPPLIER_RIDER";

/**
 * Supplier context:
 * - Admin can impersonate by ?supplierId=
 * - Supplier uses their own supplier record
 * - Rider derives supplierId via SupplierRider and also gets riderId
 */
type SupplierCtx =
  | {
      ok: true;
      supplierId: string;
      supplier: { id: string; name?: string | null; status?: any; userId?: string | null };
      impersonating: boolean;
      riderId?: string | null; // ✅ present for rider sessions
    }
  | { ok: false; status: number; error: string };

async function resolveSupplierContext(req: any): Promise<SupplierCtx> {
  const role = req.user?.role;
  const userId = req.user?.id;
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };

  // ADMIN/SUPER_ADMIN view-as supplier
  if (isAdmin(role)) {
    const supplierId = String(req.query?.supplierId ?? "").trim();
    if (!supplierId) {
      return { ok: false, status: 400, error: "Missing supplierId query param for admin view" };
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true },
    });

    if (!supplier) return { ok: false, status: 404, error: "Supplier not found" };

    return { ok: true, supplierId: supplier.id, supplier, impersonating: true, riderId: null };
  }

  // Supplier normal mode
  if (isSupplier(role)) {
    const supplier = await prisma.supplier.findFirst({
      where: { userId },
      select: { id: true, name: true, status: true, userId: true },
    });
    if (!supplier) return { ok: false, status: 403, error: "Supplier profile not found for this user" };

    return { ok: true, supplierId: supplier.id, supplier, impersonating: false, riderId: null };
  }

  // Rider mode (derive supplierId via SupplierRider)
  if (isRider(role)) {
    const rider = await prisma.supplierRider.findFirst({
      where: { userId, isActive: true },
      select: {
        id: true,
        supplierId: true,
        supplier: { select: { id: true, name: true, status: true, userId: true } },
      },
    });

    if (!rider?.supplier) return { ok: false, status: 403, error: "Rider profile not found / inactive" };

    return {
      ok: true,
      supplierId: rider.supplierId,
      supplier: rider.supplier,
      impersonating: false,
      riderId: rider.id, // ✅ important
    };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

function safeJsonParse(v: any) {
  try {
    if (typeof v === "string") return JSON.parse(v);
    return v ?? null;
  } catch {
    return null;
  }
}

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
}

function getRefundDelegate(tx: any) {
  // try common model names
  return tx.refund || tx.refundRequest || tx.orderRefund || tx.refunds || null;
}

async function ensureRefundRequestedForPOTx(
  tx: any,
  purchaseOrderId: string,
  opts?: { reason?: string; actorUserId?: string; mode?: string }
) {
  const Refund = getRefundDelegate(tx);
  if (!Refund) {
    throw new Error(
      "Refund model delegate not found on Prisma client. " +
        "Your Prisma model is not named 'refund'. Rename calls to your real model (e.g. refundRequest/orderRefund)."
    );
  }

  const existing = await Refund.findFirst({
    where: { purchaseOrderId },
    select: { id: true, status: true },
  });
  if (existing) return existing;

  const breakdown = await computeRefundForPurchaseOrderTx(tx, purchaseOrderId);

  const reason = String(opts?.reason ?? "").trim() || "SUPPLIER_CANCELED";
  const actorUserId = opts?.actorUserId ? String(opts.actorUserId) : null;
  const mode = opts?.mode ? String(opts.mode) : null;

  const created = await Refund.create({
    data: {
      orderId: breakdown.orderId,
      purchaseOrderId: breakdown.purchaseOrderId,
      supplierId: breakdown.supplierId,
      status: "REQUESTED",
      itemsAmount: breakdown.itemsSubtotal,
      taxAmount: breakdown.taxRefund,
      serviceFeeBaseAmount: breakdown.serviceBaseRefund,
      serviceFeeCommsAmount: breakdown.serviceCommsRefund,
      serviceFeeGatewayAmount: breakdown.serviceGatewayRefund,
      totalAmount: breakdown.totalRefund,

      reason,

      meta: {
        ...(breakdown as any),
        requestedBy: actorUserId,
        requestedMode: mode,
        requestedAt: new Date().toISOString(),
      },
    },
    select: { id: true, status: true },
  });

  return created;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const asNum = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * Settlement policy (can tweak later)
 * - Refund items always
 * - Refund tax pro-rata to canceled items subtotal
 * - Refund serviceFeeComms pro-rata to canceled units
 * - Refund base fee only if entire order gets canceled (optional) -> here we pro-rata
 * - Gateway fee default: NOT refunded (often non-refundable)
 */
async function computeRefundForPurchaseOrderTx(tx: any, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, orderId: true, supplierId: true },
  });
  if (!po) throw new Error("PurchaseOrder not found");

  // items in this PO
  const poItems = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: po.id },
    select: {
      orderItem: {
        select: { id: true, quantity: true, unitPrice: true, lineTotal: true },
      },
    },
  });

  const items = poItems.map((x: any) => x.orderItem).filter(Boolean);
  if (!items.length) {
    return {
      purchaseOrderId: po.id,
      orderId: po.orderId,
      supplierId: po.supplierId,
      itemsSubtotal: 0,
      units: 0,
      taxRefund: 0,
      serviceBaseRefund: 0,
      serviceCommsRefund: 0,
      serviceGatewayRefund: 0,
      totalRefund: 0,
    };
  }

  const order = await tx.order.findUnique({
    where: { id: po.orderId },
    select: {
      id: true,
      subtotal: true,
      tax: true,
      serviceFeeBase: true,
      serviceFeeComms: true,
      serviceFeeGateway: true,
      serviceFeeTotal: true,
    },
  });
  if (!order) throw new Error("Order not found");

  const itemsSubtotal = round2(
    items.reduce((s: number, it: any) => {
      const q = Math.max(0, asNum(it.quantity, 0));
      const unit = asNum(it.unitPrice, 0);
      const lt = it.lineTotal != null ? asNum(it.lineTotal, unit * q) : unit * q;
      return s + lt;
    }, 0)
  );

  const unitsCanceled = items.reduce((s: number, it: any) => s + Math.max(0, asNum(it.quantity, 0)), 0);

  // total units in order (for comms pro-rata)
  const allOrderItems = await tx.orderItem.findMany({
    where: { orderId: po.orderId },
    select: { quantity: true, unitPrice: true, lineTotal: true },
  });
  const totalUnits = allOrderItems.reduce((s: number, it: any) => s + Math.max(0, asNum(it.quantity, 0)), 0);

  const orderSubtotal = Math.max(0, asNum(order.subtotal, 0));
  const ratioByValue = orderSubtotal > 0 ? Math.min(1, itemsSubtotal / orderSubtotal) : 0;
  const ratioByUnits = totalUnits > 0 ? Math.min(1, unitsCanceled / totalUnits) : 0;

  const taxRefund = round2(Math.max(0, asNum(order.tax, 0) * ratioByValue));

  // policy: pro-rata base + comms by units; gateway = 0 default
  const serviceBaseRefund = round2(Math.max(0, asNum(order.serviceFeeBase, 0) * ratioByValue));
  const serviceCommsRefund = round2(Math.max(0, asNum(order.serviceFeeComms, 0) * ratioByUnits));
  const serviceGatewayRefund = 0;

  const totalRefund = round2(itemsSubtotal + taxRefund + serviceBaseRefund + serviceCommsRefund + serviceGatewayRefund);

  return {
    purchaseOrderId: po.id,
    orderId: po.orderId,
    supplierId: po.supplierId,
    itemsSubtotal,
    units: unitsCanceled,
    taxRefund,
    serviceBaseRefund,
    serviceCommsRefund,
    serviceGatewayRefund,
    totalRefund,
  };
}

function allocHeldStatus(): SupplierPaymentStatus {
  return SupplierPaymentStatus.PENDING;
}

async function releasePayoutForPOTx(tx: any, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, orderId: true, supplierId: true, supplierAmount: true, status: true },
  });
  if (!po) throw new Error("PurchaseOrder not found");

  if (String(po.status || "").toUpperCase() !== "DELIVERED") {
    throw new Error("Cannot release payout unless PO is DELIVERED");
  }

  // ✅ block payout unless supplier is payout-ready
  await assertSupplierPayoutReadyTx(tx, po.supplierId);

  const payment = await tx.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" as any },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!payment) throw new Error("No PAID payment found for this order");

  // ✅ Find the allocation that is still on-hold (PENDING)
  const alloc = await tx.supplierPaymentAllocation.findFirst({
    where: {
      paymentId: payment.id,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      status: allocHeldStatus(), // PENDING
    },
    select: { id: true, amount: true, status: true },
  });

  if (!alloc) {
    return { ok: true, note: "No PENDING allocation found (already PAID/FAILED or missing)." };
  }

  await tx.supplierPaymentAllocation.update({
    where: { id: alloc.id },
    data: {
      status: SupplierPaymentStatus.PAID,
      releasedAt: new Date(),
    },
  });

  await tx.supplierLedgerEntry.create({
    data: {
      supplierId: po.supplierId,
      type: "CREDIT",
      amount: alloc.amount, // keep Decimal
      currency: "NGN",
      referenceType: "PURCHASE_ORDER",
      referenceId: po.id,
      meta: { orderId: po.orderId, purchaseOrderId: po.id, allocationId: alloc.id },
    },
  });

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: { payoutStatus: "RELEASED", paidOutAt: new Date() },
  });

  return { ok: true };
}

async function assertSupplierPayoutReadyTx(tx: any, supplierId: string) {
  const s = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      isPayoutEnabled: true,
      accountNumber: true,
      accountName: true,
      bankCode: true,
      bankName: true,
      bankCountry: true,
      bankVerificationStatus: true,
    },
  });

  if (!s) throw new Error("Supplier not found");

  const enabled = s.isPayoutEnabled !== false;

  const accNum = !!(s.accountNumber ?? null);
  const accName = !!(s.accountName ?? null);
  const bank = !!(s.bankCode ?? s.bankName ?? null);
  const country = s.bankCountry == null ? true : !!s.bankCountry;

  const verified = s.bankVerificationStatus === "VERIFIED";
  if (!(enabled && verified && accNum && accName && bank && country)) {
    throw new Error("Supplier is not payout-ready (missing bank details or payouts disabled).");
  }
}

function toE164Maybe(raw?: string | null) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("+")) return s;
  if (s.startsWith("0") && s.length >= 10) return `+234${s.slice(1)}`;
  return s;
}

function hasScalarField(modelName: string, fieldName: string): boolean {
  try {
    const dmmf =
      (prisma as any)?._dmmf?.datamodel ??
      (prisma as any)?._baseDmmf?.datamodel ??
      (prisma as any)?._engine?.dmmf?.datamodel ??
      null;

    const model = dmmf?.models?.find((m: any) => m.name === modelName);
    if (!model) return false;

    return Boolean(model.fields?.some((f: any) => f.name === fieldName && f.kind === "scalar"));
  } catch {
    return false;
  }
}
/* =========================
   Rider delivery OTP helpers
========================= */

function sixDigitOtp() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function safeEqual(a: string, b: string) {
  try {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return a === b;
  }
}

function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function makeCodeHash(otp: string, salt: string) {
  // Simple + fast. If you want stronger, switch to pbkdf2.
  return sha256(`${otp}:${salt}`);
}

async function assertPoBelongsToSupplierTx(tx: any, purchaseOrderId: string, supplierId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, orderId: true, supplierId: true, status: true, riderId: true },
  });
  if (!po) throw new Error("PurchaseOrder not found");
  if (String(po.supplierId) !== String(supplierId)) throw new Error("Forbidden: PO does not belong to supplier");
  return po;
}

async function assertCanDeliverPoTx(tx: any, opts: { poId: string; supplierId: string; role?: string; userId: string }) {
  const po = await assertPoBelongsToSupplierTx(tx, opts.poId, opts.supplierId);

  if (isRider(opts.role)) {
    const rider = await tx.supplierRider.findFirst({
      where: { userId: opts.userId, supplierId: opts.supplierId, isActive: true },
      select: { id: true },
    });
    if (!rider) throw new Error("Rider profile not found / inactive");

    if (!po.riderId) throw new Error("This PO is not assigned to a rider yet");
    if (String(po.riderId) !== String(rider.id)) throw new Error("This PO is assigned to another rider");
  }

  return po;
}

async function bestEffortSendDeliveryOtp(opts: {
  orderId: string;
  purchaseOrderId: string;
  otp: string;
  email?: string | null;
  phone?: string | null;
}) {
  const report: {
    hasEmail: boolean;
    hasPhone: boolean;
    sent: boolean;
    channels: string[]; // succeeded
    attempted: string[];
    errors: string[];
  } = {
    hasEmail: !!opts.email,
    hasPhone: !!opts.phone,
    sent: false,
    channels: [],
    attempted: [],
    errors: [],
  };

  const recordErr = (label: string, e: any) => {
    const msg = `${label}: ${String(e?.message || e || "unknown error")}`;
    report.errors.push(msg);
    console.warn("[DELIVERY_OTP] send failed:", msg);
  };

  // Helpful audit log (so you can confirm it is the right recipient)
  console.log("[DELIVERY_OTP] sending to:", {
    orderId: opts.orderId,
    purchaseOrderId: opts.purchaseOrderId,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
  });

  const phoneE164 = toE164Maybe(opts.phone);

  // Track what notify already sent so we don’t duplicate
  let notifySentEmail = false;
  let notifySentWhatsapp = false;

  // 1) Unified notifier (preferred)
  try {
    if (typeof (sendOrderOtpNotifications as any) === "function") {
      report.attempted.push("NOTIFY_SERVICE");

      const notifyReport = await sendOrderOtpNotifications({
        brand: "DaySpring",
        purposeLabel: "Delivery OTP",
        expiresMins: 10,
        orderId: opts.orderId,
        purchaseOrderId: opts.purchaseOrderId,
        code: opts.otp,
        userEmail: opts.email ?? undefined,
        userPhoneE164: phoneE164 ?? undefined,
      } as any);

      if (Array.isArray((notifyReport as any)?.channels)) {
        if ((notifyReport as any).channels.includes("EMAIL")) {
          notifySentEmail = true;
          report.channels.push("EMAIL");
        }
        if ((notifyReport as any).channels.includes("WHATSAPP")) {
          notifySentWhatsapp = true;
          report.channels.push("WHATSAPP");
        }
      }

      const errs = (notifyReport as any)?.errors;
      if (Array.isArray(errs) && errs.length) report.errors.push(...errs.map((x: any) => `NOTIFY_SERVICE: ${x}`));
    }
  } catch (e) {
    recordErr("sendOrderOtpNotifications", e);
  }

  // 2) Email fallback (ONLY if notify didn’t send email)
  try {
    if (opts.email && !notifySentEmail) {
      report.attempted.push("EMAIL_FALLBACK");
      await (sendOtpEmail as any)(opts.email, opts.otp, "DELIVERY_OTP");
      report.channels.push("EMAIL");
    }
  } catch (e) {
    recordErr("sendOtpEmail", e);
  }

  // 3) WhatsApp fallback (ONLY if notify didn’t send whatsapp)
  try {
    if (phoneE164 && !notifySentWhatsapp) {
      report.attempted.push("WHATSAPP_FALLBACK");
      await (sendWhatsAppOtp as any)(phoneE164, opts.otp, "DELIVERY_OTP");
      report.channels.push("WHATSAPP");
    }
  } catch (e) {
    recordErr("sendWhatsAppOtp", e);
  }

  // ✅ sent = at least one channel succeeded
  report.sent = report.channels.length > 0;

  return report;
}

/**
 * GET /api/supplier/orders
 * ✅ SUPPLIER + ADMIN + SUPPLIER_RIDER
 * - rider sees only assigned POs in delivery mode (SHIPPED / OUT_FOR_DELIVERY)
 */
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const role = req.user?.role;
    const userId = String(req.user?.id || "");
    const isRiderSession = isRider(role);

    const viewRaw = String(req.query?.view ?? "").trim().toLowerCase();
    // Rider default view:
    const view: "active" | "delivered" | "all" =
      viewRaw === "delivered" || viewRaw === "all" || viewRaw === "active"
        ? (viewRaw as any)
        : (isRiderSession ? "active" : "all");

    // Build rider status filter
    const riderActiveStatuses = [PurchaseOrderStatus.SHIPPED, PurchaseOrderStatus.OUT_FOR_DELIVERY];
    const riderDeliveredStatuses = [PurchaseOrderStatus.DELIVERED];

    const riderStatuses =
      view === "delivered"
        ? riderDeliveredStatuses
        : view === "all"
        ? [...riderActiveStatuses, ...riderDeliveredStatuses]
        : riderActiveStatuses;

    // If your PurchaseOrder has deliveredByUserId, use it to ensure "jobs THEY marked as delivered"
    const poHasDeliveredBy = hasScalarField("PurchaseOrder", "deliveredByUserId");

    const supplierId = ctx.supplierId;

    // ✅ Rider restriction:
    const riderId = isRider(req.user?.role) ? String(ctx.riderId || "").trim() || null : null;
    if (isRider(req.user?.role) && !riderId) {
      return res.status(403).json({ error: "Rider profile not found / inactive" });
    }

    const includeRiderId = orderItemHasField("riderId");

    // 1) Pull all order items allocated to this supplier (chosenSupplierId)
    const rows = await prisma.orderItem.findMany({
      where: {
        chosenSupplierId: supplierId,
      },
      orderBy: [{ order: { createdAt: "desc" } }, { id: "asc" }],
      select: {
        id: true,
        orderId: true,
        productId: true,
        variantId: true,
        title: true,
        unitPrice: true,
        quantity: true,
        lineTotal: true,

        ...(includeRiderId ? { riderId: true } : {}),

        chosenSupplierId: true,
        chosenSupplierUnitPrice: true,
        selectedOptions: true,

        order: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            user: { select: { email: true } },
            shippingAddress: {
              select: {
                houseNumber: true,
                streetName: true,
                postCode: true,
                town: true,
                city: true,
                state: true,
                country: true,
              },
            },
          },
        },
      },
    });

    const orderIds = Array.from(new Set(rows.map((r: any) => String(r.orderId)).filter(Boolean)));

    if (!orderIds.length) {
      return res.json({ data: [] });
    }

    const pos = await prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        orderId: { in: orderIds },

        ...(riderId
          ? {
              riderId,
              status: { in: riderStatuses as any },

              ...(view !== "active" && poHasDeliveredBy ? { deliveredByUserId: userId } : {}),
            }
          : {}),
      },
      select: {
        id: true,
        orderId: true,
        status: true,
        riderId: true,

        supplierAmount: true,
        subtotal: true,
        payoutStatus: true,
        paidOutAt: true,

        ...(hasScalarField("PurchaseOrder", "deliveredAt") ? { deliveredAt: true } : {}),
        ...(poHasDeliveredBy ? { deliveredByUserId: true } : {}),

        refund: { select: { id: true, status: true } },
      },
    });

    if (!pos.length) {
      return res.json({ data: [] });
    }

    const allowedOrderIds = new Set(pos.map((p: any) => String(p.orderId)).filter(Boolean));
    const poIds = pos.map((p: any) => String(p.id)).filter(Boolean);

    // 3) Delivery OTP verified timestamps per PO
    const verifiedByPoId: Record<string, string> = {};
    if (poIds.length) {
      const verifiedRows = await prisma.purchaseOrderDeliveryOtp.findMany({
        where: { purchaseOrderId: { in: poIds }, verifiedAt: { not: null } },
        orderBy: [{ verifiedAt: "desc" }],
        select: { purchaseOrderId: true, verifiedAt: true },
      });

      for (const r of verifiedRows) {
        const k = String(r.purchaseOrderId);
        if (!verifiedByPoId[k] && r.verifiedAt) {
          verifiedByPoId[k] = r.verifiedAt.toISOString();
        }
      }
    }

    // 4) Index PO by orderId
    const poByOrder: Record<string, any> = {};
    for (const po of pos as any[]) {
      const oid = String(po.orderId);
      poByOrder[oid] = {
        id: po.id,
        status: String(po.status || "CREATED"),
        supplierAmount: po.supplierAmount != null ? Number(po.supplierAmount) : null,
        subtotal: po.subtotal != null ? Number(po.subtotal) : null,
        payoutStatus: po.payoutStatus ?? null,
        paidOutAt: po.paidOutAt?.toISOString?.() ?? po.paidOutAt ?? null,

        refundId: po.refund?.id ?? null,
        refundStatus: po.refund?.status ?? null,

        riderId: po.riderId ?? null,

        deliveredAt: (po as any).deliveredAt?.toISOString?.() ?? (po as any).deliveredAt ?? null,
        deliveredByUserId: (po as any).deliveredByUserId ?? null,

        deliveryOtpVerifiedAt: verifiedByPoId[String(po.id)] ?? null,
      };
    }

    // 5) Group order items by orderId -> API payload
    const grouped: Record<string, any> = {};
    for (const r of rows as any[]) {
      const oid = String(r.orderId);

      if (!allowedOrderIds.has(oid)) continue;

      if (!grouped[oid]) {
        const riderView = isRider(req.user?.role);

        grouped[oid] = {
          id: r.order?.id ?? oid,
          status: r.order?.status ?? "CREATED",
          createdAt: (r.order as any)?.createdAt?.toISOString?.() ?? r.order?.createdAt ?? null,
          customerEmail: riderView ? null : r.order?.user?.email ?? null,
          shippingAddress: r.order?.shippingAddress ?? null,

          purchaseOrderId: poByOrder[oid]?.id ?? null,
          supplierStatus: poByOrder[oid]?.status ?? "CREATED",

          ...(riderView
            ? {}
            : {
                supplierAmount: poByOrder[oid]?.supplierAmount ?? null,
                poSubtotal: poByOrder[oid]?.subtotal ?? null,
                payoutStatus: poByOrder[oid]?.payoutStatus ?? null,
                paidOutAt: poByOrder[oid]?.paidOutAt ?? null,
                refundId: poByOrder[oid]?.refundId ?? null,
                refundStatus: poByOrder[oid]?.refundStatus ?? null,
              }),

          riderId: poByOrder[oid]?.riderId ?? null,
          deliveryOtpVerifiedAt: poByOrder[oid]?.deliveryOtpVerifiedAt ?? null,

          items: [],
        };
      }

      grouped[oid].items.push({
        id: r.id,
        productId: r.productId,
        variantId: r.variantId ?? null,
        title: r.title ?? "—",
        unitPrice: Number(r.unitPrice ?? 0),
        quantity: Number(r.quantity ?? 1),
        lineTotal: Number(r.lineTotal ?? Number(r.unitPrice ?? 0) * Number(r.quantity ?? 1)),
        chosenSupplierUnitPrice: r.chosenSupplierUnitPrice != null ? Number(r.chosenSupplierUnitPrice) : null,
        selectedOptions: safeJsonParse(r.selectedOptions),
      });
    }

    return res.json({ data: Object.values(grouped) });
  } catch (e: any) {
    console.error("GET /api/supplier/orders failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch supplier orders" });
  }
});

/**
 * POST /api/supplier/orders/purchase-orders/:poId/delivery-otp/request
 * ✅ SUPPLIER + SUPPLIER_RIDER can request the delivery OTP (sent to customer)
 */
router.post("/purchase-orders/:poId/delivery-otp/request", requireAuth, async (req: any, res) => {
  try {
    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const poId = String(req.params?.poId || "").trim();
    const userId = String(req.user?.id || "").trim();
    if (!poId) return res.status(400).json({ error: "Missing poId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const out = await prisma.$transaction(async (tx: any) => {
      const po = await assertCanDeliverPoTx(tx, {
        poId,
        supplierId: ctx.supplierId,
        role: req.user?.role,
        userId,
      });

      const poStatus = String(po.status || "").toUpperCase();
      const allowed = new Set(["SHIPPED", "OUT_FOR_DELIVERY"]);
      if (!allowed.has(poStatus)) {
        throw new Error("Delivery OTP can only be requested when PO is SHIPPED / OUT_FOR_DELIVERY");
      }

      const userSelect: any = { email: true };
      if (hasScalarField("User", "phone")) userSelect.phone = true;

      const order = await tx.order.findUnique({
        where: { id: po.orderId },
        select: {
          id: true,
          userId: true,
          user: { select: userSelect },
          shippingAddress: hasScalarField("ShippingAddress", "phone") ? { select: { phone: true } } : undefined,
        },
      });

      const email = order?.user?.email ?? null;
      const phone = (order?.shippingAddress as any)?.phone ?? (order?.user as any)?.phone ?? null;

      const otp = sixDigitOtp();
      const salt = newSalt();
      const codeHash = makeCodeHash(otp, salt);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const existing = await tx.purchaseOrderDeliveryOtp.findFirst({
        where: { purchaseOrderId: po.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (existing?.id) {
        await tx.purchaseOrderDeliveryOtp.update({
          where: { id: existing.id },
          data: {
            codeHash,
            salt,
            expiresAt,
            verifiedAt: null,
            consumedAt: null,
            attempts: 0,
            lockedUntil: null,
            deliveredAt: null,
            deliveredByUserId: null,
          },
        });
      } else {
        await tx.purchaseOrderDeliveryOtp.create({
          data: {
            purchaseOrderId: po.id,
            orderId: po.orderId,
            customerId: order?.userId ?? null,
            codeHash,
            salt,
            expiresAt,
            attempts: 0,
          },
        });
      }

      const sendReport = await bestEffortSendDeliveryOtp({
        orderId: po.orderId,
        purchaseOrderId: po.id,
        otp,
        email,
        phone,
      });

      if (!sendReport.hasEmail && !sendReport.hasPhone) {
        throw new Error("Customer has no email/phone to send delivery OTP.");
      }

      return {
        expiresAt: expiresAt.toISOString(),
        sendReport,
        ...(process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
      };
    });

    return res.json({ ok: true, data: out });
  } catch (e: any) {
    console.error("POST /purchase-orders/:poId/delivery-otp/request failed:", e);
    return res.status(400).json({ error: e?.message || "Failed to request delivery OTP" });
  }
});

/**
 * POST /api/supplier/orders/purchase-orders/:poId/delivery-otp/verify
 * ✅ SUPPLIER + SUPPLIER_RIDER can verify OTP
 * - marks PO as DELIVERED
 * - releases payout
 */
router.post("/purchase-orders/:poId/delivery-otp/verify", requireAuth, async (req: any, res) => {
  try {
    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const poId = String(req.params?.poId || "").trim();
    const userId = String(req.user?.id || "").trim();
    if (!poId) return res.status(400).json({ error: "Missing poId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const rawOtp = String(req.body?.otp ?? req.body?.code ?? "").trim();
    if (!/^\d{6}$/.test(rawOtp)) return res.status(400).json({ error: "OTP must be 6 digits" });

    const result = await prisma.$transaction(async (tx: any) => {
      const po = await assertCanDeliverPoTx(tx, {
        poId,
        supplierId: ctx.supplierId,
        role: req.user?.role,
        userId,
      });

      const poStatus = String(po.status || "").toUpperCase();
      if (poStatus === "CANCELED") throw new Error("Cannot verify delivery OTP for a CANCELED PO");
      if (poStatus === "DELIVERED") return { poAlreadyDelivered: true };

      const row = await tx.purchaseOrderDeliveryOtp.findFirst({
        where: {
          purchaseOrderId: po.id,
          verifiedAt: null,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, codeHash: true, salt: true, attempts: true, lockedUntil: true },
      });

      if (!row) throw new Error("This OTP has expired. Please request a new one.");

      const attempt = Number(row.attempts ?? 0);
      const expected = String(row.codeHash || "");
      const salt = String(row.salt || "");
      const actual = makeCodeHash(rawOtp, salt);

      if (!safeEqual(expected, actual)) {
        const nextAttempts = attempt + 1;
        const lockAfter = 5;
        const lockMinutes = 10;

        await tx.purchaseOrderDeliveryOtp.update({
          where: { id: row.id },
          data: {
            attempts: nextAttempts,
            lockedUntil: nextAttempts >= lockAfter ? new Date(Date.now() + lockMinutes * 60 * 1000) : row.lockedUntil,
          },
        });

        throw new Error(nextAttempts >= lockAfter ? "Too many attempts. OTP locked. Please request a new one." : "Invalid OTP");
      }

      await tx.purchaseOrderDeliveryOtp.update({
        where: { id: row.id },
        data: {
          verifiedAt: new Date(),
          consumedAt: new Date(),
          deliveredAt: new Date(),
          deliveredByUserId: userId,
        },
      });

      const updatedPo = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          deliveredByUserId: userId,
          deliveredMetaJson: {
            byRole: req.user?.role,
            byUserId: userId,
            riderId: po.riderId ?? null,
            verifiedAt: new Date().toISOString(),
          },
        },
      });

      await assertSupplierPayoutReadyTx(tx, updatedPo.supplierId);
      const payout = await releasePayoutForPOTx(tx, updatedPo.id);

      // ✅ Notifications: customer, supplier, admins on delivery
      try {
        const orderRow = await tx.order.findUnique({
          where: { id: updatedPo.orderId },
          select: { id: true, userId: true },
        });

        const orderId = orderRow?.id ?? updatedPo.orderId;
        const shopperId = orderRow?.userId ? String(orderRow.userId) : null;
        const supplierIdStr = String(updatedPo.supplierId);

        if (shopperId) {
          await notifyUser(
            shopperId,
            {
              type: "ORDER_DELIVERED" as any,
              title: "Order delivered",
              body: `Your delivery for order ${orderId} is complete.`,
              data: {
                orderId,
                purchaseOrderId: updatedPo.id,
              },
            },
            tx
          );
        }

        await notifySupplierBySupplierId(
          supplierIdStr,
          {
            type: "PURCHASE_ORDER_DELIVERED_SUPPLIER" as any,
            title: "Order delivered",
            body: `Purchase order ${updatedPo.id} for order ${orderId} has been delivered. Payout has been released (or queued).`,
            data: {
              orderId,
              purchaseOrderId: updatedPo.id,
            },
          },
          tx
        );

        await notifyAdmins(
          {
            type: "PURCHASE_ORDER_DELIVERED_ADMIN" as any,
            title: "Purchase order delivered",
            body: `Purchase order ${updatedPo.id} for order ${orderId} was marked delivered and payout released.`,
            data: {
              orderId,
              purchaseOrderId: updatedPo.id,
            },
          },
          tx
        );
      } catch (notifyErr) {
        console.error("Failed to send delivery notifications:", notifyErr);
      }

      try {
        const all = await tx.purchaseOrder.findMany({
          where: { orderId: updatedPo.orderId },
          select: { status: true },
        });
        const allDelivered =
          all.length > 0 && all.every((x: any) => String(x.status || "").toUpperCase() === "DELIVERED");
        if (allDelivered) {
          await tx.order.update({ where: { id: updatedPo.orderId }, data: { status: "DELIVERED" } });
        }
      } catch {}

      return { po: updatedPo, payout };
    });

    return res.json({ ok: true, data: result });
  } catch (e: any) {
    console.error("POST /purchase-orders/:poId/delivery-otp/verify failed:", e);
    return res.status(400).json({ error: e?.message || "Failed to verify delivery OTP" });
  }
});

/**
 * PATCH /api/supplier/orders/:orderId/status
 * (kept as your major; only minor guard notes + notifications)
 */
router.patch("/:orderId/status", requireAuth, async (req: any, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const { orderId } = req.params;

    if (isAdmin(role)) {
      return res.status(403).json({ error: "Read-only supplier view. Use admin order endpoints to modify." });
    }
    if (isRider(role)) {
      return res.status(403).json({ error: "Riders cannot update fulfillment steps. Use delivery OTP verification only." });
    }

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!isSupplier(role) && !isAdmin(role)) return res.status(403).json({ error: "Forbidden" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.body?.supplierId) supplierId = String(req.body.supplierId);
    else {
      const s = await getSupplierForUser(userId);
      supplierId = s?.id ?? null;
    }
    if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

    const statusRaw = String(req.body?.status ?? "").trim().toUpperCase();
    if (!statusRaw) return res.status(400).json({ error: "status is required" });

    const normalizedNext = statusRaw === "CANCELLED" ? "CANCELED" : statusRaw;

    const ALLOWED = new Set([
      "CREATED",
      "PENDING",
      "CONFIRMED",
      "PACKED",
      "SHIPPED",
      "DELIVERED",
      "CANCELED",
      "OUT_FOR_DELIVERY",
      "FUNDED",
      "PROCESSING",
    ]);

    if (!ALLOWED.has(normalizedNext)) {
      return res.status(400).json({
        error: `Invalid status '${normalizedNext}'. Allowed: ${Array.from(ALLOWED).join(", ")}`,
      });
    }

    const FLOW = ["PENDING", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"] as const;

    const toFlowBase = (s: string) => {
      const x = String(s || "").toUpperCase().trim();
      if (x === "CANCELLED") return "CANCELED";
      if (["CREATED", "FUNDED", "PROCESSING"].includes(x)) return "PENDING";
      if (x === "OUT_FOR_DELIVERY") return "SHIPPED";
      return x;
    };

    const canTransition = (curRaw: string, nextRaw: string) => {
      const cur = toFlowBase(curRaw);
      const next = toFlowBase(nextRaw);

      if (cur === "DELIVERED" || cur === "CANCELED") return next === cur;

      if (next === "CANCELED") return ["PENDING", "CONFIRMED", "PACKED"].includes(cur);

      const curIdx = FLOW.indexOf(cur as any);
      const nextIdx = FLOW.indexOf(next as any);

      if (curIdx < 0 || nextIdx < 0) return false;

      return nextIdx === curIdx || nextIdx === curIdx + 1;
    };

    const cancelRequiresOtp = (curBase: string) => {
      const cur = toFlowBase(curBase);
      return cur === "CONFIRMED" || cur === "PACKED";
    };

    const result = await prisma.$transaction(async (tx: any) => {
      const now = new Date();

      const statusStamp: any = {};
      if (normalizedNext === "CONFIRMED") statusStamp.confirmedAt = now;
      if (normalizedNext === "PACKED") statusStamp.packedAt = now;
      if (normalizedNext === "SHIPPED") statusStamp.shippedAt = now;
      if (normalizedNext === "DELIVERED") statusStamp.deliveredAt = now;
      if (normalizedNext === "CANCELED") statusStamp.canceledAt = now;

      let po = await tx.purchaseOrder.findFirst({
        where: { orderId, supplierId },
        select: { id: true, orderId: true, supplierId: true, status: true },
      });

      const currentStatus = po?.status ?? "PENDING";
      const curBase = toFlowBase(String(currentStatus));

      if (!canTransition(String(currentStatus), normalizedNext)) {
        throw new Error(`Invalid transition: ${currentStatus} → ${normalizedNext}`);
      }

      if (normalizedNext === "DELIVERED" && isSupplier(role)) {
        throw new Error(
          "Delivery must be confirmed with OTP. Use POST /api/supplier/orders/purchase-orders/:poId/delivery-otp/verify"
        );
      }

      if (normalizedNext === "CANCELED" && isSupplier(role) && cancelRequiresOtp(curBase)) {
        const otpToken = String(req.headers["x-otp-token"] ?? req.body?.otpToken ?? "").trim();
        if (!otpToken) throw new Error("Missing OTP token");

        await assertVerifiedOrderOtp(orderId, "CANCEL_ORDER" as any, otpToken, String(userId));

        const reason = String(req.body?.reason ?? "").trim();
        if (!reason) throw new Error("Cancel reason is required when canceling after confirmation");
      }

      if (!po) {
        const items = await tx.orderItem.findMany({
          where: { orderId, chosenSupplierId: supplierId },
          select: { quantity: true, lineTotal: true, unitPrice: true, chosenSupplierUnitPrice: true },
        });

        const subtotal = items.reduce((s: number, it: any) => {
          const q = Math.max(0, asNum(it.quantity, 0));
          const unit = asNum(it.unitPrice, 0);
          const lt = it.lineTotal != null ? asNum(it.lineTotal, unit * q) : unit * q;
          return s + lt;
        }, 0);

        const supplierAmount = items.reduce((s: number, it: any) => {
          const q = Math.max(0, asNum(it.quantity, 0));
          return s + asNum(it.chosenSupplierUnitPrice, 0) * q;
        }, 0);

        const platformFee = Math.max(0, subtotal - supplierAmount);

        po = await tx.purchaseOrder.create({
          data: {
            orderId,
            supplierId,
            status: normalizedNext,
            subtotal: round2(subtotal),
            supplierAmount: round2(supplierAmount),
            platformFee: round2(platformFee),
            payoutStatus: "PENDING",
            ...statusStamp,
          },
          select: { id: true, orderId: true, supplierId: true, status: true },
        });
      } else {
        po = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: normalizedNext, ...statusStamp },
          select: { id: true, orderId: true, supplierId: true, status: true },
        });
      }

      const orderRow = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, userId: true },
      });
      const orderIdStr = orderRow?.id ?? orderId;
      const shopperId = orderRow?.userId ? String(orderRow.userId) : null;
      const supplierIdStr = String(supplierId);

      if (normalizedNext === "CANCELED") {
        const base = toFlowBase(curBase);

        if (isSupplier(role) && base === "PENDING") {
          try {
            if (shopperId) {
              await notifyUser(
                shopperId,
                {
                  type: "PURCHASE_ORDER_CANCELED" as any,
                  title: "Items canceled",
                  body: `Some items in your order ${orderIdStr} were canceled by the supplier before processing.`,
                  data: {
                    orderId: orderIdStr,
                    purchaseOrderId: po.id,
                    supplierId: supplierIdStr,
                  },
                },
                tx
              );
            }

            await notifyAdmins(
              {
                type: "PURCHASE_ORDER_CANCELED_ADMIN" as any,
                title: "Purchase order canceled (pending stage)",
                body: `Purchase order ${po.id} for order ${orderIdStr} was canceled at PENDING stage by supplier.`,
                data: {
                  orderId: orderIdStr,
                  purchaseOrderId: po.id,
                  supplierId: supplierIdStr,
                },
              },
              tx
            );
          } catch (notifyErr) {
            console.error("Failed to send supplier-cancel (pending) notifications:", notifyErr);
          }

          return {
            po,
            refund: null,
            payout: null,
            note: "Canceled at PENDING (no OTP). Refund not auto-requested; admin/reroute flow should decide.",
          };
        }

        const refundReason = String(req.body?.reason ?? "").trim() || "SUPPLIER_CANCELED";

        const refund = await ensureRefundRequestedForPOTx(tx, po.id, {
          reason: refundReason,
          actorUserId: String(userId),
          mode: "SUPPLIER_CANCEL_AFTER_CONFIRM",
        });

        try {
          if (shopperId) {
            await notifyUser(
              shopperId,
              {
                type: "PURCHASE_ORDER_CANCELED_REFUND_REQUESTED" as any,
                title: "Items canceled & refund requested",
                body: `Some items in your order ${orderIdStr} were canceled by the supplier. A refund has been requested and will be reviewed.`,
                data: {
                  orderId: orderIdStr,
                  purchaseOrderId: po.id,
                  supplierId: supplierIdStr,
                  refundId: refund.id,
                },
              },
              tx
            );
          }

          await notifyAdmins(
            {
              type: "PURCHASE_ORDER_CANCELED_REFUND_ADMIN" as any,
              title: "Purchase order canceled & refund requested",
              body: `Purchase order ${po.id} for order ${orderIdStr} was canceled after confirmation. A refund request (${refund.id}) was created.`,
              data: {
                orderId: orderIdStr,
                purchaseOrderId: po.id,
                supplierId: supplierIdStr,
                refundId: refund.id,
              },
            },
            tx
          );
        } catch (notifyErr) {
          console.error("Failed to send supplier-cancel (refund) notifications:", notifyErr);
        }

        return { po, refund, payout: null };
      }

      if (normalizedNext === "DELIVERED") {
        await assertSupplierPayoutReadyTx(tx, supplierId);
        const payout = await releasePayoutForPOTx(tx, po.id);

        try {
          if (shopperId) {
            await notifyUser(
              shopperId,
              {
                type: "ORDER_DELIVERED" as any,
                title: "Order delivered",
                body: `Your items for order ${orderIdStr} have been delivered.`,
                data: {
                  orderId: orderIdStr,
                  purchaseOrderId: po.id,
                },
              },
              tx
            );
          }

          await notifySupplierBySupplierId(
            supplierIdStr,
            {
              type: "PURCHASE_ORDER_DELIVERED_SUPPLIER" as any,
              title: "Order delivered",
              body: `Purchase order ${po.id} for order ${orderIdStr} has been marked delivered. Payout has been released (or queued).`,
              data: {
                orderId: orderIdStr,
                purchaseOrderId: po.id,
              },
            },
            tx
          );

          await notifyAdmins(
            {
              type: "PURCHASE_ORDER_DELIVERED_ADMIN" as any,
              title: "Purchase order delivered",
              body: `Purchase order ${po.id} for order ${orderIdStr} was marked delivered (via status patch).`,
              data: {
                orderId: orderIdStr,
                purchaseOrderId: po.id,
              },
            },
            tx
          );
        } catch (notifyErr) {
          console.error("Failed to send delivered (patch) notifications:", notifyErr);
        }

        return { po, refund: null, payout };
      }

      // ✅ intermediate statuses (CONFIRMED, PACKED, SHIPPED, OUT_FOR_DELIVERY, etc.)
      try {
        if (shopperId) {
          const friendly = normalizedNext.replace(/_/g, " ").toLowerCase();
          await notifyUser(
            shopperId,
            {
              type: "PURCHASE_ORDER_STATUS_UPDATED" as any,
              title: "Order update",
              body: `Status for part of your order ${orderIdStr} is now ${friendly}.`,
              data: {
                orderId: orderIdStr,
                purchaseOrderId: po.id,
                status: normalizedNext,
              },
            },
            tx
          );
        }

        await notifySupplierBySupplierId(
          supplierIdStr,
          {
            type: "PURCHASE_ORDER_STATUS_UPDATED_SUPPLIER" as any,
            title: "Purchase order updated",
            body: `Status for purchase order ${po.id} (order ${orderIdStr}) is now ${normalizedNext}.`,
            data: {
              orderId: orderIdStr,
              purchaseOrderId: po.id,
              status: normalizedNext,
            },
          },
          tx
        );

        await notifyAdmins(
          {
            type: "PURCHASE_ORDER_STATUS_UPDATED_ADMIN" as any,
            title: "Purchase order status updated",
            body: `Purchase order ${po.id} for order ${orderIdStr} is now ${normalizedNext}.`,
            data: {
              orderId: orderIdStr,
              purchaseOrderId: po.id,
              status: normalizedNext,
            },
          },
          tx
        );
      } catch (notifyErr) {
        console.error("Failed to send intermediate status notifications:", notifyErr);
      }

      return { po, refund: null, payout: null };
    });

    return res.json({ ok: true, data: result });
  } catch (e: any) {
    console.error("PATCH /api/supplier/orders/:orderId/status failed:", e);
    const msg = e?.message || "Failed to update supplier status";

    const m = String(msg).toLowerCase();
    if (
      m.includes("invalid transition") ||
      m.includes("otp") ||
      m.includes("reason is required") ||
      m.includes("delivery must be confirmed")
    ) {
      return res.status(400).json({ error: msg });
    }

    if (e?.status) return res.status(Number(e.status)).json({ error: msg });

    return res.status(500).json({ error: msg });
  }
});

function orderItemHasField(field: string) {
  const model = (Prisma as any)?.dmmf?.datamodel?.models?.find((m: any) => m.name === "OrderItem");
  if (!model) return false;
  return (model.fields || []).some((f: any) => f.name === field);
}

/**
 * PATCH /api/supplier/orders/purchase-orders/:poId/assign-rider
 * Supplier/Admin assigns a rider to a PO. riderId can be null to unassign.
 * ✅ When assigned, PO status becomes OUT_FOR_DELIVERY.
 * ✅ When unassigned (riderId=null) and status was OUT_FOR_DELIVERY, revert back to SHIPPED.
 */
router.patch("/purchase-orders/:poId/assign-rider", requireAuth, async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (!isSupplier(role) && !isAdmin(role)) {
      return res.status(403).json({ error: "Only supplier/admin can assign riders" });
    }

    const ctx = await resolveSupplierContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const poId = String(req.params?.poId || "").trim();
    const riderIdRaw = req.body?.riderId;
    const riderId = riderIdRaw == null || riderIdRaw === "" ? null : String(riderIdRaw);

    if (!poId) return res.status(400).json({ error: "Missing poId" });

    const out = await prisma.$transaction(async (tx: any) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        select: { id: true, supplierId: true, status: true, riderId: true, orderId: true },
      });
      if (!po) throw new Error("PurchaseOrder not found");
      if (String(po.supplierId) !== String(ctx.supplierId)) throw new Error("Forbidden");

      const st = String(po.status || "").toUpperCase();
      if (st === "DELIVERED" || st === "CANCELED") throw new Error("Cannot re/assign rider for DELIVERED/CANCELED PO");

      if (riderId) {
        const rider = await tx.supplierRider.findUnique({
          where: { id: riderId },
          select: { id: true, supplierId: true, isActive: true, userId: true },
        });
        if (!rider) throw new Error("Rider not found");
        if (!rider.isActive) throw new Error("Rider is inactive");
        if (String(rider.supplierId) !== String(ctx.supplierId)) throw new Error("Rider does not belong to this supplier");

        let nextStatus: string | undefined = "OUT_FOR_DELIVERY";

        const updated = await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            riderId,
            status: nextStatus,
          },
          select: { id: true, riderId: true, status: true, orderId: true, supplierId: true },
        });

        // ✅ Notifications on rider assignment
        try {
          const orderRow = await tx.order.findUnique({
            where: { id: updated.orderId },
            select: { id: true, userId: true },
          });

          const orderIdStr = orderRow?.id ?? updated.orderId;
          const shopperId = orderRow?.userId ? String(orderRow.userId) : null;

          if (rider.userId) {
            await notifyUser(
              String(rider.userId),
              {
                type: "RIDER_ASSIGNED" as any,
                title: "New delivery assigned",
                body: `You have been assigned to deliver purchase order ${updated.id} for order ${orderIdStr}.`,
                data: {
                  orderId: orderIdStr,
                  purchaseOrderId: updated.id,
                },
              },
              tx
            );
          }

          if (shopperId) {
            await notifyUser(
              shopperId,
              {
                type: "ORDER_OUT_FOR_DELIVERY" as any,
                title: "Order out for delivery",
                body: `Your order ${orderIdStr} is now out for delivery.`,
                data: {
                  orderId: orderIdStr,
                  purchaseOrderId: updated.id,
                },
              },
              tx
            );
          }

          await notifyAdmins(
            {
              type: "PURCHASE_ORDER_RIDER_ASSIGNED_ADMIN" as any,
              title: "Rider assigned",
              body: `Rider was assigned to purchase order ${updated.id} for order ${orderIdStr}.`,
              data: {
                orderId: orderIdStr,
                purchaseOrderId: updated.id,
                riderId: rider.id,
              },
            },
            tx
          );
        } catch (notifyErr) {
          console.error("Failed to send rider assignment notifications:", notifyErr);
        }

        return updated;
      } else {
        let nextStatus: string | undefined = undefined;
        if (!riderId && st === "OUT_FOR_DELIVERY") nextStatus = "SHIPPED";

        const updated = await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            riderId: null,
            ...(nextStatus ? { status: nextStatus } : {}),
          },
          select: { id: true, riderId: true, status: true },
        });

        return updated;
      }
    });

    return res.json({ ok: true, data: out });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to assign rider" });
  }
});

export default router;
