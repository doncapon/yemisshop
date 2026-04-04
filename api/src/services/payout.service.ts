// api/src/services/payout.service.ts
import { prisma } from "../lib/prisma.js";
import { ps } from "../lib/paystack.js";
import { SupplierPaymentStatus } from "@prisma/client";
import { sendMail } from "../lib/email.js";
import { sendOtpWhatsappViaTermii } from "../lib/termii.js";

const isTrue = (v?: string | null) =>
  ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());

const TRIAL_MODE = isTrue(process.env.PAYMENTS_TRIAL_MODE);

function round2(n: number) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function asNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function grossPayoutAmountFromPO(
  po?:
    | {
        supplierAmount?: number | string | null | { toString(): string };
        shippingFeeChargedToCustomer?: number | string | null | { toString(): string };
      }
    | null
) {
  return round2(
    Number(po?.supplierAmount ?? 0) + Number(po?.shippingFeeChargedToCustomer ?? 0)
  );
}

function formatMoney(amount: number | null | undefined, currency = "NGN") {
  const value = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${currency} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
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

    return Boolean(
      model.fields?.some((f: any) => f.name === fieldName && f.kind === "scalar")
    );
  } catch {
    return false;
  }
}

async function lookupBankCode(bankCodeOrName?: string | null) {
  return (bankCodeOrName || "").trim();
}

async function assertNoOpenRefund(purchaseOrderId: string) {
  const open = await prisma.refund.findFirst({
    where: {
      purchaseOrderId,
      status: {
        in: [
          "REQUESTED",
          "SUPPLIER_REVIEW",
          "DISPUTED",
          "APPROVED",
          "PROCESSING",
        ] as any,
      },
    },
    select: { id: true, status: true },
  });

  if (open) {
    const err: any = new Error(`Payout blocked: refund is ${open.status}`);
    err.status = 409;
    throw err;
  }
}

async function getVerifiedDeliveryOtpAt(
  purchaseOrderId: string
): Promise<Date | null> {
  try {
    const otpRow = await prisma.purchaseOrderDeliveryOtp.findFirst({
      where: {
        purchaseOrderId,
        verifiedAt: { not: null },
      },
      orderBy: { verifiedAt: "desc" },
      select: { verifiedAt: true },
    });

    if (otpRow?.verifiedAt) return otpRow.verifiedAt;
  } catch {
    // fallback below
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { deliveryOtpVerifiedAt: true },
  });

  return po?.deliveryOtpVerifiedAt ?? null;
}

async function getSupplierNotificationContacts(supplierId: string) {
  const supplierSelect: Record<string, any> = {
    id: true,
    name: true,
    userId: true,
  };

  if (hasScalarField("Supplier", "contactEmail")) supplierSelect.contactEmail = true;
  if (hasScalarField("Supplier", "email")) supplierSelect.email = true;
  if (hasScalarField("Supplier", "contactPhone")) supplierSelect.contactPhone = true;
  if (hasScalarField("Supplier", "phone")) supplierSelect.phone = true;

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: supplierSelect as any,
  });

  if (!supplier) return null;

  let userEmail: string | null = null;
  let userPhone: string | null = null;

  if ((supplier as any).userId) {
    const userSelect: Record<string, any> = { id: true };
    if (hasScalarField("User", "email")) userSelect.email = true;
    if (hasScalarField("User", "phone")) userSelect.phone = true;

    const user = await prisma.user.findUnique({
      where: { id: String((supplier as any).userId) },
      select: userSelect as any,
    });

    userEmail = (user as any)?.email ?? null;
    userPhone = (user as any)?.phone ?? null;
  }

  return {
    supplierId: String((supplier as any).id),
    supplierName: String((supplier as any).name ?? "").trim() || "Supplier",
    email:
      String(
        (supplier as any).contactEmail ??
          (supplier as any).email ??
          userEmail ??
          ""
      ).trim() || null,
    phone:
      String(
        (supplier as any).contactPhone ??
          (supplier as any).phone ??
          userPhone ??
          ""
      ).trim() || null,
  };
}

async function sendSupplierPayoutReleasedNotifications(args: {
  purchaseOrderId: string;
  orderId: string;
  supplierId: string;
  amount: number;
  currency?: string | null;
}) {
  try {
    const contacts = await getSupplierNotificationContacts(args.supplierId);
    if (!contacts) {
      console.warn("[payout-notify] supplier contacts not found", {
        supplierId: args.supplierId,
        purchaseOrderId: args.purchaseOrderId,
      });
      return;
    }

    const currency = String(args.currency ?? "NGN").trim() || "NGN";
    const amountText = formatMoney(args.amount, currency);

    if (contacts.email) {
      await sendMail({
        to: contacts.email,
        subject: `Payout released for PO ${args.purchaseOrderId}`,
        html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
            <h2 style="margin:0 0 8px 0">Supplier payout released</h2>
            <p>Hello ${contacts.supplierName},</p>
            <p>Your payout has been released successfully.</p>
            <div style="margin:16px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa">
              <p style="margin:0 0 6px 0"><strong>Order ID:</strong> ${args.orderId}</p>
              <p style="margin:0 0 6px 0"><strong>Purchase Order ID:</strong> ${args.purchaseOrderId}</p>
              <p style="margin:0 0 6px 0"><strong>Amount:</strong> ${amountText}</p>
              <p style="margin:0"><strong>Status:</strong> RELEASED</p>
            </div>
            <p>Thank you,<br/>DaySpring</p>
          </div>
        `,
        text: [
          "Supplier payout released",
          "",
          `Hello ${contacts.supplierName},`,
          "",
          "Your payout has been released successfully.",
          "",
          `Order ID: ${args.orderId}`,
          `Purchase Order ID: ${args.purchaseOrderId}`,
          `Amount: ${amountText}`,
          "Status: RELEASED",
          "",
          "Thank you,",
          "DaySpring",
        ].join("\n"),
      });

      console.log("[payout-notify] email sent", {
        supplierId: args.supplierId,
        purchaseOrderId: args.purchaseOrderId,
        to: contacts.email,
        amount: args.amount,
      });
    } else {
      console.warn("[payout-notify] no supplier email found", {
        supplierId: args.supplierId,
        purchaseOrderId: args.purchaseOrderId,
      });
    }

    if (contacts.phone) {
      const phone = toE164Maybe(contacts.phone);
      if (phone) {
        await sendOtpWhatsappViaTermii({
          to: phone,
          code: "",
          brand: "DaySpring",
          expiresMinutes: 10,
          purposeLabel: `Payout released for ${args.purchaseOrderId} (${amountText})`,
        });

        console.log("[payout-notify] whatsapp sent", {
          supplierId: args.supplierId,
          purchaseOrderId: args.purchaseOrderId,
          to: phone,
          amount: args.amount,
        });
      }
    }
  } catch (e: any) {
    console.error("[payout-notify] failed", {
      supplierId: args.supplierId,
      purchaseOrderId: args.purchaseOrderId,
      message: e?.message,
    });
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

  if (s.paystackRecipientCode) {
    return { supplier: s, recipientCode: s.paystackRecipientCode };
  }

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
 * Idempotent + guarded + updates PO + allocation.
 * Final payout amount = supplierAmount + shippingFeeChargedToCustomer
 */
export async function paySupplierForPurchaseOrder(
  purchaseOrderId: string,
  actor?: { id?: string; role?: string }
) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      shippingFeeChargedToCustomer: true,
      status: true,
      payoutStatus: true,
      deliveredAt: true,
      deliveryOtpVerifiedAt: true,
      paidOutAt: true,
    },
  });

  if (!po) {
    const err: any = new Error("Purchase order not found");
    err.status = 404;
    throw err;
  }

  if (String(po.status).toUpperCase() !== "DELIVERED") {
    const err: any = new Error("Payout not allowed until PO is DELIVERED");
    err.status = 409;
    throw err;
  }

  const verifiedOtpAt =
    (await getVerifiedDeliveryOtpAt(po.id)) ?? po.deliveryOtpVerifiedAt ?? null;

  if (!verifiedOtpAt) {
    const err: any = new Error("Payout not allowed until delivery OTP is verified");
    err.status = 409;
    throw err;
  }

  await assertNoOpenRefund(po.id);

  const amount = grossPayoutAmountFromPO(po);

  if (!(amount > 0)) {
    return {
      ok: true,
      skipped: true,
      reason: "amount<=0",
      purchaseOrderId: po.id,
      amount,
    };
  }

  if (String(po.payoutStatus ?? "").toUpperCase() === "RELEASED") {
    await sendSupplierPayoutReleasedNotifications({
      purchaseOrderId: po.id,
      orderId: String(po.orderId),
      supplierId: String(po.supplierId),
      amount,
      currency: "NGN",
    });

    return {
      ok: true,
      already: true,
      purchaseOrderId: po.id,
      amount,
    };
  }

  const pay = await prisma.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" as any },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const paymentId = pay?.id;
  if (!paymentId) {
    const err: any = new Error("No PAID payment found for this order");
    err.status = 409;
    throw err;
  }

  const already = await prisma.paymentEvent.findFirst({
    where: {
      paymentId,
      type: "TRANSFER_INIT",
      data: { path: ["purchaseOrderId"], equals: po.id },
    },
    select: { id: true },
  });

  if (already) {
    const releasedAt = po.paidOutAt ?? new Date();

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          payoutStatus: "RELEASED" as any,
          paidOutAt: releasedAt,
        },
      });

      await tx.supplierPaymentAllocation.updateMany({
        where: { purchaseOrderId: po.id, paymentId },
        data: {
          amount,
          status: SupplierPaymentStatus.PAID,
          releasedAt,
        },
      });
    });

    await sendSupplierPayoutReleasedNotifications({
      purchaseOrderId: po.id,
      orderId: String(po.orderId),
      supplierId: String(po.supplierId),
      amount,
      currency: "NGN",
    });

    return {
      ok: true,
      already: true,
      purchaseOrderId: po.id,
      amount,
    };
  }

  const { recipientCode } = await ensureSupplierRecipientCode(po.supplierId);

  if (TRIAL_MODE) {
    const releasedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: {
          paymentId,
          type: "TRANSFER_SKIPPED",
          data: {
            purchaseOrderId: po.id,
            supplierId: po.supplierId,
            supplierAmount: round2(asNum(po.supplierAmount, 0)),
            shippingFeeChargedToCustomer: round2(
              asNum(po.shippingFeeChargedToCustomer, 0)
            ),
            amount,
            reason: "TRIAL_MODE",
            actor,
          },
        },
      });

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          payoutStatus: "RELEASED" as any,
          paidOutAt: releasedAt,
        },
      });

      await tx.supplierPaymentAllocation.updateMany({
        where: { purchaseOrderId: po.id, paymentId },
        data: {
          amount,
          status: SupplierPaymentStatus.PAID,
          releasedAt,
        },
      });
    });

    await sendSupplierPayoutReleasedNotifications({
      purchaseOrderId: po.id,
      orderId: String(po.orderId),
      supplierId: String(po.supplierId),
      amount,
      currency: "NGN",
    });

    return {
      ok: true,
      trial: true,
      purchaseOrderId: po.id,
      amount,
    };
  }

  const tr = await ps.post("/transfer", {
    source: "balance",
    amount: Math.round(amount * 100),
    recipient: recipientCode,
    reason: `PO ${po.id} payout for order ${po.orderId}`,
  });

  const releasedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.paymentEvent.create({
      data: {
        paymentId,
        type: "TRANSFER_INIT",
        data: {
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          supplierAmount: round2(asNum(po.supplierAmount, 0)),
          shippingFeeChargedToCustomer: round2(
            asNum(po.shippingFeeChargedToCustomer, 0)
          ),
          amount,
          transfer: tr.data?.data,
          actor,
        },
      },
    });

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        payoutStatus: "RELEASED" as any,
        paidOutAt: releasedAt,
      },
    });

    await tx.supplierPaymentAllocation.updateMany({
      where: { purchaseOrderId: po.id, paymentId },
      data: {
        amount,
        status: SupplierPaymentStatus.PAID,
        releasedAt,
      },
    });
  });

  await sendSupplierPayoutReleasedNotifications({
    purchaseOrderId: po.id,
    orderId: String(po.orderId),
    supplierId: String(po.supplierId),
    amount,
    currency: "NGN",
  });

  return {
    ok: true,
    purchaseOrderId: po.id,
    amount,
  };
}