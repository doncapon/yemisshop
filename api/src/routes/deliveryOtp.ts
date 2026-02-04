// api/src/routes/deliveryOtp.ts
import { Router, type Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { SupplierPaymentStatus } from "@prisma/client";
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

const OTP_TTL_HOURS = Number(process.env.DELIVERY_OTP_TTL_HOURS ?? 48);
const OTP_MAX_ATTEMPTS = Number(process.env.DELIVERY_OTP_MAX_ATTEMPTS ?? 5);
const OTP_LOCK_MINUTES = Number(process.env.DELIVERY_OTP_LOCK_MINUTES ?? 30);
const OTP_MIN_RESEND_SECONDS = Number(process.env.DELIVERY_OTP_MIN_RESEND_SECONDS ?? 60);

function now() {
  return new Date();
}

function toUpper(x: any) {
  return String(x ?? "").trim().toUpperCase();
}

function otpSecret() {
  return process.env.DELIVERY_OTP_SECRET || process.env.JWT_SECRET || "dev-secret";
}

function genOtp6() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

function hashOtp(poId: string, otp: string) {
  // per-PO hash, bound to server secret
  const h = crypto.createHash("sha256");
  h.update(`${poId}:${otp}:${otpSecret()}`);
  return h.digest("hex");
}

function normalizeE164(phone?: string | null) {
  if (!phone) return null;
  const p = phone.trim();
  if (!p) return null;
  if (p.startsWith("+")) return p;
  return p; // don't guess country code
}

// --- You already have these in your other file; keep single source of truth or inline ---
async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
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

async function releasePayoutForPOTx(tx: any, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, orderId: true, supplierId: true, status: true },
  });
  if (!po) throw new Error("PurchaseOrder not found");

  if (toUpper(po.status) !== "DELIVERED") {
    throw new Error("Cannot release payout unless PO is DELIVERED");
  }

  await assertSupplierPayoutReadyTx(tx, po.supplierId);

  const payment = await tx.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" as any },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!payment) throw new Error("No PAID payment found for this order");

  const alloc = await tx.supplierPaymentAllocation.findFirst({
    where: {
      paymentId: payment.id,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      status: SupplierPaymentStatus.PENDING,
    },
    select: { id: true, amount: true },
  });

  if (!alloc) return { ok: true, note: "No PENDING allocation found (already PAID/FAILED or missing)." };

  await tx.supplierPaymentAllocation.update({
    where: { id: alloc.id },
    data: { status: SupplierPaymentStatus.PAID, releasedAt: new Date() },
  });

  await tx.supplierLedgerEntry.create({
    data: {
      supplierId: po.supplierId,
      type: "CREDIT",
      amount: alloc.amount,
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

/**
 * CUSTOMER: POST /api/orders/:orderId/purchase-orders/:poId/request-delivery-otp
 * - Only the order owner can request OTP
 * - Only when PO is SHIPPED
 */
router.post(
  "/orders/:orderId/purchase-orders/:poId/request-delivery-otp",
  requireAuth,
  async (req: any, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const orderId = String(req.params.orderId);
      const poId = String(req.params.poId);

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: {
          id: true,
          orderId: true,
          supplierId: true,
          status: true,
          deliveryOtpIssuedAt: true,
          deliveredAt: true,
        },
      });

      if (!po || po.orderId !== orderId) return res.status(404).json({ error: "PurchaseOrder not found" });

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, userId: true, status: true, user: { select: { email: true, phone: true } } },
      });

      if (!order || order.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      const st = toUpper(po.status);
      if (st !== "SHIPPED") {
        return res.status(400).json({ error: "OTP can only be issued when the PO is SHIPPED" });
      }

      // rate limit re-issue
      const last = po.deliveryOtpIssuedAt ? new Date(po.deliveryOtpIssuedAt).getTime() : 0;
      if (last && Date.now() - last < OTP_MIN_RESEND_SECONDS * 1000) {
        return res.status(429).json({ error: "OTP requested too frequently. Try again shortly." });
      }

      const otp = genOtp6();
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + OTP_TTL_HOURS * 60 * 60 * 1000);

      await prisma.purchaseOrder.update({
        where: { id: poId },
        data: {
          deliveryOtpHash: hashOtp(poId, otp),
          deliveryOtpIssuedAt: issuedAt,
          deliveryOtpExpiresAt: expiresAt,
          deliveryOtpVerifiedAt: null,
          deliveryOtpAttempts: 0,
          deliveryOtpLockedUntil: null,
          deliveryOtpIssuedToUserId: userId,
        },
      });

      // ✅ Send OTP to customer via unified notifier
      const toEmail = order.user?.email ?? null;
      const toE164 = normalizeE164(order.user?.phone ?? null);

      try {
        await sendOrderOtpNotifications({
          userEmail: toEmail,
          userPhoneE164: toE164,
          code: otp,
          expiresMins: OTP_TTL_HOURS * 60, // convert hours to minutes for the message
          purposeLabel: "Confirm delivery",
          orderId,
          brand: "DaySpring",
        });
      } catch (err) {
        console.error("sendOrderOtpNotifications (deliveryOtp) failed:", err);
      }

      // Optional dev-only echo of the OTP
      const includeOtp = String(process.env.RETURN_DELIVERY_OTP_IN_RESPONSE ?? "") === "1";

      return res.json({
        ok: true,
        data: {
          purchaseOrderId: poId,
          expiresAt: expiresAt.toISOString(),
          ...(includeOtp ? { otp } : {}),
        },
      });
    } catch (e: any) {
      console.error("request-delivery-otp failed:", e);
      return res.status(500).json({ error: e?.message || "Failed to request delivery OTP" });
    }
  },
);

/**
 * CUSTOMER: GET /api/orders/:orderId/purchase-orders/:poId/delivery-otp
 * - Status only (never return OTP)
 */
router.get(
  "/orders/:orderId/purchase-orders/:poId/delivery-otp",
  requireAuth,
  async (req: any, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const orderId = String(req.params.orderId);
      const poId = String(req.params.poId);

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, userId: true },
      });
      if (!order || order.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: {
          id: true,
          orderId: true,
          status: true,
          deliveryOtpIssuedAt: true,
          deliveryOtpExpiresAt: true,
          deliveryOtpVerifiedAt: true,
        },
      });

      if (!po || po.orderId !== orderId) return res.status(404).json({ error: "PurchaseOrder not found" });

      return res.json({
        ok: true,
        data: {
          purchaseOrderId: poId,
          poStatus: po.status,
          issuedAt: po.deliveryOtpIssuedAt?.toISOString?.() ?? null,
          expiresAt: po.deliveryOtpExpiresAt?.toISOString?.() ?? null,
          verifiedAt: po.deliveryOtpVerifiedAt?.toISOString?.() ?? null,
        },
      });
    } catch (e: any) {
      console.error("delivery-otp status failed:", e);
      return res.status(500).json({ error: e?.message || "Failed to load OTP status" });
    }
  },
);

/**
 * SUPPLIER: POST /api/supplier/purchase-orders/:poId/confirm-delivery
 * Body: { otp: "123456" }
 * - Supplier enters OTP at delivery
 * - If valid: PO -> DELIVERED, released payout
 */
router.post(
  "/supplier/purchase-orders/:poId/confirm-delivery",
  requireAuth,
  async (req: any, res: Response) => {
    try {
      const role = req.user?.role;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isSupplier(role) && !isAdmin(role)) return res.status(403).json({ error: "Forbidden" });

      const poId = String(req.params.poId);
      const otp = String(req.body?.otp ?? "").trim();
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "otp must be a 6-digit code" });

      // resolve supplierId
      let supplierId: string | null = null;
      if (isAdmin(role) && req.body?.supplierId) supplierId = String(req.body.supplierId);
      else supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;

      if (!supplierId && !isAdmin(role)) return res.status(403).json({ error: "Supplier access required" });

      const result = await prisma.$transaction(async (tx: any) => {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          select: {
            id: true,
            orderId: true,
            supplierId: true,
            status: true,
            deliveredAt: true,
            deliveryOtpHash: true,
            deliveryOtpIssuedAt: true,
            deliveryOtpExpiresAt: true,
            deliveryOtpVerifiedAt: true,
            deliveryOtpAttempts: true,
            deliveryOtpLockedUntil: true,
          },
        });

        if (!po) throw new Error("PurchaseOrder not found");

        // supplier ownership check (admins can override)
        if (!isAdmin(role) && po.supplierId !== supplierId) throw new Error("Forbidden");

        const st = toUpper(po.status);
        if (st !== "SHIPPED") throw new Error("Cannot confirm delivery unless PO is SHIPPED");

        if (po.deliveryOtpVerifiedAt) {
          return { ok: true, note: "Already verified", purchaseOrderId: poId, orderId: po.orderId };
        }

        const lockedUntil = po.deliveryOtpLockedUntil ? new Date(po.deliveryOtpLockedUntil) : null;
        if (lockedUntil && lockedUntil.getTime() > Date.now()) {
          throw new Error("OTP is temporarily locked. Try again later.");
        }

        const expiresAt = po.deliveryOtpExpiresAt ? new Date(po.deliveryOtpExpiresAt) : null;
        if (!po.deliveryOtpHash || !expiresAt) {
          throw new Error("No active OTP for this PO. Ask customer to request OTP.");
        }
        if (expiresAt.getTime() < Date.now()) {
          throw new Error("OTP has expired. Ask customer to request a new OTP.");
        }

        const expected = po.deliveryOtpHash;
        const got = hashOtp(poId, otp);

        if (got !== expected) {
          const attempts = Number(po.deliveryOtpAttempts ?? 0) + 1;

          const patch: any = { deliveryOtpAttempts: attempts };
          if (attempts >= OTP_MAX_ATTEMPTS) {
            patch.deliveryOtpLockedUntil = new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000);
          }

          await tx.purchaseOrder.update({ where: { id: poId }, data: patch });

          throw new Error(attempts >= OTP_MAX_ATTEMPTS ? "OTP locked due to too many attempts" : "Invalid OTP");
        }

        // ✅ OTP correct: mark delivered, stamp, clear attempts/lock, then release payout
        const deliveredAt = now();

        await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            status: "DELIVERED",
            deliveredAt,
            deliveryOtpVerifiedAt: deliveredAt,
            deliveryOtpAttempts: 0,
            deliveryOtpLockedUntil: null,
            deliveredByUserId: String(userId),
            deliveredMetaJson: { method: "OTP", verifiedAt: deliveredAt.toISOString() },
          },
        });

        // release payout
        const payout = await releasePayoutForPOTx(tx, poId);

        return { ok: true, purchaseOrderId: poId, orderId: po.orderId, payout };
      });

      return res.json({ ok: true, data: result });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Failed to confirm delivery" });
    }
  },
);

export default router;
