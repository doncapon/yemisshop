// api/src/services/payout.service.ts
import { prisma } from "../lib/prisma.js";
import { ps } from "../lib/paystack.js"; // your axios instance for Paystack
import { SupplierPaymentStatus } from "@prisma/client";

const isTrue = (v?: string | null) =>
  ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());

const TRIAL_MODE = isTrue(process.env.PAYMENTS_TRIAL_MODE);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function lookupBankCode(bankCodeOrName?: string | null) {
  return (bankCodeOrName || "").trim();
}

async function assertNoOpenRefund(purchaseOrderId: string) {
  const open = await prisma.refund.findFirst({
    where: {
      purchaseOrderId,
      status: { in: ["REQUESTED", "SUPPLIER_REVIEW", "DISPUTED", "APPROVED", "PROCESSING"] as any },
    },
    select: { id: true, status: true },
  });
  if (open) {
    const err: any = new Error(`Payout blocked: refund is ${open.status}`);
    err.status = 409;
    throw err;
  }
}

async function ensureSupplierRecipientCode(supplierId: string) {
  const s = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      name: true,
      paystackRecipientCode: true,
      bankName: true,
      bankCode: true,
      bankCountry: true,
      accountNumber: true,
      accountName: true,
      isPayoutEnabled: true,
      bankVerificationStatus: true,
    },
  });
  if (!s) {
    const err: any = new Error("Supplier not found");
    err.status = 404;
    throw err;
  }

  const payoutOk =
    s.isPayoutEnabled === true &&
    s.bankVerificationStatus === "VERIFIED" &&
    !!s.bankCode &&
    !!s.bankCountry &&
    !!s.accountNumber &&
    !!s.accountName;

  if (!payoutOk) {
    const err: any = new Error("Supplier not payout-ready or bank not verified");
    err.status = 409;
    throw err;
  }

  if (s.paystackRecipientCode) return { supplier: s, recipientCode: s.paystackRecipientCode };

  const bank_code = await lookupBankCode(s.bankCode ?? s.bankName);

  const r = await ps.post("/transferrecipient", {
    type: "nuban",
    name: s.accountName || s.name || "Supplier",
    account_number: s.accountNumber,
    bank_code,
    currency: "NGN",
  });

  const recipientCode = r.data?.data?.recipient_code || null;
  if (!recipientCode) {
    const err: any = new Error("Could not create Paystack recipient");
    err.status = 502;
    throw err;
  }

  await prisma.supplier.update({
    where: { id: s.id },
    data: { paystackRecipientCode: recipientCode },
  });

  return { supplier: s, recipientCode };
}

/**
 * ✅ This is your function, but now it is actually used by routes.
 * Idempotent + guarded + updates PO + allocation.
 */
export async function paySupplierForPurchaseOrder(purchaseOrderId: string, actor?: { id?: string; role?: string }) {
  // 1) Load PO
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      status: true,
      payoutStatus: true,
      deliveredAt: true,
      deliveryOtpVerifiedAt: true, // you have this legacy field; keep using it
      paidOutAt: true,
    },
  });

  if (!po) {
    const err: any = new Error("Purchase order not found");
    err.status = 404;
    throw err;
  }

  // 2) Eligibility rules (adjust if you want)
  if (po.status !== "DELIVERED") {
    const err: any = new Error("Payout not allowed until PO is DELIVERED");
    err.status = 409;
    throw err;
  }
  if (!po.deliveryOtpVerifiedAt) {
    const err: any = new Error("Payout not allowed until delivery OTP is verified");
    err.status = 409;
    throw err;
  }
  if (po.payoutStatus === "RELEASED") {
    return { ok: true, already: true, purchaseOrderId: po.id };
  }

  await assertNoOpenRefund(po.id);

  // 3) Find latest PAID payment for order (for logging PaymentEvent)
  const pay = await prisma.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const paymentId = pay?.id;
  if (!paymentId) {
    const err: any = new Error("No PAID payment found for this order");
    err.status = 409;
    throw err;
  }

  const amount = round2(Number(po.supplierAmount ?? 0));
  if (!(amount > 0)) return { ok: true, skipped: true, reason: "amount<=0" };

  // 4) Idempotency: if a transfer init exists for this PO, don't do again
  const already = await prisma.paymentEvent.findFirst({
    where: {
      paymentId,
      type: "TRANSFER_INIT",
      data: { path: ["purchaseOrderId"], equals: po.id },
    },
    select: { id: true },
  });
  if (already) {
    // Make sure statuses are correct even if transfer init exists
    await prisma.$transaction(async (tx: { purchaseOrder: { update: (arg0: { where: { id: any; }; data: { payoutStatus: string; paidOutAt: any; }; }) => any; }; supplierPaymentAllocation: { updateMany: (arg0: { where: { purchaseOrderId: any; paymentId: any; }; data: { status: "PAID"; releasedAt: Date; }; }) => any; }; }) => {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { payoutStatus: "RELEASED", paidOutAt: po.paidOutAt ?? new Date() },
      });
      await tx.supplierPaymentAllocation.updateMany({
        where: { purchaseOrderId: po.id, paymentId },
        data: { status: SupplierPaymentStatus.PAID, releasedAt: new Date() },
      });
    });
    return { ok: true, already: true, purchaseOrderId: po.id };
  }

  // 5) Supplier must be payout-ready
  const { recipientCode } = await ensureSupplierRecipientCode(po.supplierId);

  // 6) Trial-mode = don't actually transfer, but mark as released so UI works
  if (TRIAL_MODE) {
    await prisma.$transaction(async (tx: { paymentEvent: { create: (arg0: { data: { paymentId: any; type: string; data: { purchaseOrderId: any; supplierId: any; reason: string; amount: number; actor: { id?: string; role?: string; } | undefined; }; }; }) => any; }; purchaseOrder: { update: (arg0: { where: { id: any; }; data: { payoutStatus: string; paidOutAt: Date; }; }) => any; }; supplierPaymentAllocation: { updateMany: (arg0: { where: { purchaseOrderId: any; paymentId: any; }; data: { status: "PAID"; releasedAt: Date; }; }) => any; }; }) => {
      await tx.paymentEvent.create({
        data: {
          paymentId,
          type: "TRANSFER_SKIPPED",
          data: { purchaseOrderId: po.id, supplierId: po.supplierId, reason: "TRIAL_MODE", amount, actor },
        },
      });

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { payoutStatus: "RELEASED", paidOutAt: new Date() },
      });

      await tx.supplierPaymentAllocation.updateMany({
        where: { purchaseOrderId: po.id, paymentId },
        data: { status: SupplierPaymentStatus.PAID, releasedAt: new Date() },
      });
    });

    return { ok: true, trial: true, purchaseOrderId: po.id };
  }

  // 7) Real transfer
  const tr = await ps.post("/transfer", {
    source: "balance",
    amount: Math.round(amount * 100),
    recipient: recipientCode,
    reason: `PO ${po.id} payout for order ${po.orderId}`,
  });

  // 8) Persist logs + status updates
  await prisma.$transaction(async (tx: { paymentEvent: { create: (arg0: { data: { paymentId: any; type: string; data: { purchaseOrderId: any; supplierId: any; amount: number; transfer: any; actor: { id?: string; role?: string; } | undefined; }; }; }) => any; }; purchaseOrder: { update: (arg0: { where: { id: any; }; data: { payoutStatus: string; paidOutAt: Date; }; }) => any; }; supplierPaymentAllocation: { updateMany: (arg0: { where: { purchaseOrderId: any; paymentId: any; }; data: { status: "PAID"; releasedAt: Date; }; }) => any; }; }) => {
    await tx.paymentEvent.create({
      data: {
        paymentId,
        type: "TRANSFER_INIT",
        data: { purchaseOrderId: po.id, supplierId: po.supplierId, amount, transfer: tr.data?.data, actor },
      },
    });

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { payoutStatus: "RELEASED", paidOutAt: new Date() },
    });

    await tx.supplierPaymentAllocation.updateMany({
      where: { purchaseOrderId: po.id, paymentId },
      data: { status: SupplierPaymentStatus.PAID, releasedAt: new Date() },
    });
  });

  return { ok: true, purchaseOrderId: po.id, amount };
}
