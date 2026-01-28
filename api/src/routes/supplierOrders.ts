import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { Prisma } from "@prisma/client";
import { SupplierPaymentStatus } from "@prisma/client";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
}

function safeJsonParse(v: any) {
  try {
    if (typeof v === "string") return JSON.parse(v);
    return v ?? null;
  } catch {
    return null;
  }
}

function getRefundDelegate(tx: any) {
  // try common model names
  return (
    tx.refund ||
    tx.refundRequest ||
    tx.orderRefund ||
    tx.refunds ||
    null
  );
}

/**
 * Returns the runtime Prisma enum object if available (Prisma.SupplierPaymentStatus)
 * otherwise null (e.g. during weird build/dev states).
 */
function getSupplierPaymentStatusEnum(): any | null {
  return (Prisma as any)?.SupplierPaymentStatus ?? null;
}

/** Small helper to pick the first enum value that exists. */
function pickEnumValue(E: any | null, candidates: string[], fallback: string) {
  if (!E) return fallback;
  for (const c of candidates) {
    if (E[c] != null) return E[c];
  }
  return fallback;
}

/**
 * HOLD/ESCROW statuses we consider "not yet paid out".
 * We intentionally include PENDING because your model defaults to PENDING
 * and your UI currently shows PENDING for new allocations.
 */
function allocHeldStatuses(): string[] {
  const E = getSupplierPaymentStatusEnum();

  // If Prisma enum exists, use it; otherwise fall back to strings.
  const list = [
    // common “held” names across iterations
    E?.HELD,
    E?.ON_HOLD,
    E?.HOLD,
    E?.PENDING,
    E?.CREATED,
    E?.FUNDED,
  ]
    .filter(Boolean)
    .map((x: any) => String(x));

  // fallback (works even if enum object is missing)
  const fallback = ["PENDING", "HELD", "ON_HOLD", "HOLD", "CREATED", "FUNDED"];

  // unique, preserve order
  const out: string[] = [];
  for (const v of (list.length ? list : fallback)) {
    if (!out.includes(v)) out.push(v);
  }
  return out;
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

async function ensureRefundRequestedForPOTx(tx: any, purchaseOrderId: string) {
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
      reason: "SUPPLIER_CANCELED",
      meta: breakdown,
    },
    select: { id: true, status: true },
  });

  return created;
}

function allocHeldStatus(): SupplierPaymentStatus {
  return SupplierPaymentStatus.PENDING;
}

function allocReleasedStatus(): SupplierPaymentStatus {
  return SupplierPaymentStatus.PAID;
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

  // ✅ Find the allocation that is still on-hold
  // (with your enum, "held" is simply PENDING)
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

  // ✅ Now valid because you added releasedAt DateTime?
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
      isPayoutEnabled: true,      // ✅ exists
      accountNumber: true,
      accountName: true,
      bankCode: true,
      bankName: true,
      bankCountry: true,
      bankVerificationStatus: true, // optional but useful; exists in your schema list
    },
  });

  if (!s) throw new Error("Supplier not found");

  // treat null/undefined as enabled unless explicitly false
  const enabled = s.isPayoutEnabled !== false;

  const accNum = !!(s.accountNumber ?? null);
  const accName = !!(s.accountName ?? null);
  const bank = !!(s.bankCode ?? s.bankName ?? null);
  const country = s.bankCountry == null ? true : !!s.bankCountry;

  // if you want to enforce VERIFIED too:
  const verified = s.bankVerificationStatus === "VERIFIED";
  if (!(enabled && verified && accNum && accName && bank && country)) {
    throw new Error("Supplier is not payout-ready (missing bank details or payouts disabled).");
  }
}

/**
 * GET /api/supplier/orders
 */
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query.supplierId) supplierId = String(req.query.supplierId);
    else if (isSupplier(role)) {
      const s = await getSupplierForUser(userId);
      supplierId = s?.id ?? null;
    }

    if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

    const rows = await prisma.orderItem.findMany({
      where: { chosenSupplierId: supplierId },
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

    const orderIds = Array.from(new Set(rows.map((r: any) => r.orderId)));

    const pos = await prisma.purchaseOrder.findMany({
      where: { supplierId, orderId: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        status: true,
        supplierAmount: true,
        subtotal: true,
        payoutStatus: true,
        paidOutAt: true,
      },
    });

    const poByOrder: Record<string, any> = {};
    for (const po of pos) {
      poByOrder[String(po.orderId)] = {
        id: po.id,
        status: String(po.status || "CREATED"),
        supplierAmount: po.supplierAmount != null ? Number(po.supplierAmount) : null,
        subtotal: po.subtotal != null ? Number(po.subtotal) : null,
        payoutStatus: po.payoutStatus ?? null,
        paidOutAt: po.paidOutAt?.toISOString?.() ?? po.paidOutAt ?? null,
      };
    }

    const grouped: Record<string, any> = {};
    for (const r of rows) {
      const oid = String(r.orderId);

      if (!grouped[oid]) {
        grouped[oid] = {
          id: r.order?.id ?? oid,
          status: r.order?.status ?? "CREATED",
          createdAt: (r.order as any)?.createdAt?.toISOString?.() ?? r.order?.createdAt ?? null,
          customerEmail: r.order?.user?.email ?? null,
          shippingAddress: r.order?.shippingAddress ?? null,

          purchaseOrderId: poByOrder[oid]?.id ?? null,
          supplierStatus: poByOrder[oid]?.status ?? "CREATED",

          supplierAmount: poByOrder[oid]?.supplierAmount ?? null,
          poSubtotal: poByOrder[oid]?.subtotal ?? null,
          payoutStatus: poByOrder[oid]?.payoutStatus ?? null,
          paidOutAt: poByOrder[oid]?.paidOutAt ?? null,

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
        lineTotal: Number(r.lineTotal ?? (Number(r.unitPrice ?? 0) * Number(r.quantity ?? 1))),
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
 * PATCH /api/supplier/orders/:orderId/status
 * - Updates supplier status on purchaseOrder
 * - If DELIVERED => release payout (alloc HELD -> RELEASED)
 * - If CANCELED => create refund request
 */
router.patch("/:orderId/status", requireAuth, async (req: any, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const { orderId } = req.params;

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

    const normalized = statusRaw === "CANCELLED" ? "CANCELED" : statusRaw;

    const ALLOWED = new Set([
      "CREATED",
      "PENDING",
      "CONFIRMED",
      "PACKED",
      "SHIPPED",
      "DELIVERED",
      "CANCELED",
    ]);
    if (!ALLOWED.has(normalized)) {
      return res.status(400).json({
        error: `Invalid status '${normalized}'. Allowed: ${Array.from(ALLOWED).join(", ")}`,
      });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // helper: stamp lifecycle timestamps for this transition
      const now = new Date();
      const statusStamp: any = {};
      if (normalized === "CONFIRMED") statusStamp.confirmedAt = now;
      if (normalized === "PACKED") statusStamp.packedAt = now;
      if (normalized === "SHIPPED") statusStamp.shippedAt = now;
      if (normalized === "DELIVERED") statusStamp.deliveredAt = now;
      if (normalized === "CANCELED") statusStamp.canceledAt = now;

      let po = await tx.purchaseOrder.findFirst({
        where: { orderId, supplierId },
        select: { id: true, orderId: true, supplierId: true, status: true },
      });

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

        const created = await tx.purchaseOrder.create({
          data: {
            orderId,
            supplierId,
            status: normalized,
            subtotal: round2(subtotal),
            supplierAmount: round2(supplierAmount),
            platformFee: round2(platformFee),
            payoutStatus: "PENDING",

            // ✅ NEW: stamp timestamps if creating directly into a later status
            ...statusStamp,
          },
          select: { id: true, orderId: true, supplierId: true, status: true },
        });

        po = created;
      } else {
        po = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: normalized,

            // ✅ NEW: stamp timestamps for transition
            ...statusStamp,
          },
          select: { id: true, orderId: true, supplierId: true, status: true },
        });
      }

      if (normalized === "CANCELED") {
        const refund = await ensureRefundRequestedForPOTx(tx, po.id);
        return { po, refund, payout: null };
      }

      if (normalized === "DELIVERED") {
        // ✅ confirm payout readiness before releasing funds
        await assertSupplierPayoutReadyTx(tx, supplierId);
        const payout = await releasePayoutForPOTx(tx, po.id);
        return { po, refund: null, payout };
      }

      return { po, refund: null, payout: null };
    });

    return res.json({ ok: true, data: result });
  } catch (e: any) {
    console.error("PATCH /api/supplier/orders/:orderId/status failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to update supplier status" });
  }
});



export default router;
