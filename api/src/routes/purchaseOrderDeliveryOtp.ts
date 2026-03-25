// src/routes/purchaseOrderDeliveryOtp.ts
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";
import { SupplierPaymentStatus } from "@prisma/client";

const router = Router();

const OTP_LEN = 6;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MINS = 30;
const OTP_RESEND_COOLDOWN_SECS = 60;

function now() {
  return new Date();
}

function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}

function genOtp6() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(OTP_LEN, "0");
}

function hashOtp(code: string, salt: string) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function isAdminRole(role?: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

function isSupplierRole(role?: string) {
  return role === "SUPPLIER";
}

async function resolveActorSupplierId(actor: any): Promise<string | null> {
  if (actor?.supplierId) return String(actor.supplierId);

  if (!actor?.id) return null;

  const s = await prisma.supplier.findFirst({
    where: { userId: actor.id },
    select: { id: true },
  });

  return s?.id ?? null;
}

async function canAccessPo(actor: any, poSupplierId: string) {
  if (isAdminRole(actor?.role)) return { ok: true };

  if (!isSupplierRole(actor?.role)) {
    return { ok: false, reason: "not_supplier_role" };
  }

  const sid = await resolveActorSupplierId(actor);
  if (!sid) return { ok: false, reason: "missing_supplierId" };

  if (String(sid) !== String(poSupplierId)) {
    return { ok: false, reason: "supplier_mismatch" };
  }

  return { ok: true };
}

/**
 * REQUEST OTP
 */
router.post("/purchase-orders/:poId/delivery-otp/request", requireAuth, async (req: Request, res: Response) => {
  try {
    const poId = String(req.params.poId);
    const actor = (req as any).user;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, status: true, supplierId: true, orderId: true },
    });

    if (!po) return res.status(404).json({ error: "PO not found" });

    const access = await canAccessPo(actor, po.supplierId);
    if (!access.ok) return res.status(403).json(access);

    const status = String(po.status).toUpperCase();
    if (!["SHIPPED", "OUT_FOR_DELIVERY"].includes(status)) {
      return res.status(400).json({ error: "Not deliverable" });
    }

    // existing OTP
    const existing = await prisma.purchaseOrderDeliveryOtp.findFirst({
      where: { purchaseOrderId: poId },
      orderBy: { createdAt: "desc" },
    });

    // 🚫 DO NOT create new OTP if one is active
    if (existing && !existing.verifiedAt && !existing.consumedAt) {
      return res.json({
        ok: true,
        data: {
          alreadyActive: true,
          message: "OTP already sent and still active.",
        },
      });
    }

    const otp = genOtp6();
    const salt = newSalt();

    await prisma.purchaseOrderDeliveryOtp.create({
      data: {
        purchaseOrderId: po.id,
        orderId: po.orderId,
        codeHash: hashOtp(otp, salt),
        salt,
        attempts: 0,
      } as any,
    });

    await sendOrderOtpNotifications({
      orderId: po.orderId,
      purchaseOrderId: po.id,
      code: otp,
    } as any);

    return res.json({
      ok: true,
      ...(process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
    });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

/**
 * VERIFY OTP
 */
router.post("/purchase-orders/:poId/delivery-otp/verify", requireAuth, async (req: Request, res: Response) => {
  try {
    const poId = String(req.params.poId);
    const actor = (req as any).user;

    const code = String(req.body?.code ?? "").replace(/\D/g, "").slice(0, 6);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, status: true, supplierId: true, orderId: true },
    });

    if (!po) return res.status(404).json({ error: "PO not found" });

    const access = await canAccessPo(actor, po.supplierId);
    if (!access.ok) return res.status(403).json(access);

    const otpRow = await prisma.purchaseOrderDeliveryOtp.findFirst({
      where: { purchaseOrderId: poId },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRow) return res.status(404).json({ error: "OTP not requested" });

    const t = now();

    if (!otpRow.verifiedAt) {
      if (otpRow.lockedUntil && otpRow.lockedUntil > t) {
        return res.status(429).json({ error: "Locked" });
      }

      const attempted = hashOtp(code, otpRow.salt);
      const ok = attempted === otpRow.codeHash;

      if (!ok) {
        const attempts = (otpRow.attempts ?? 0) + 1;

        await prisma.purchaseOrderDeliveryOtp.update({
          where: { id: otpRow.id },
          data: {
            attempts,
            lockedUntil: attempts >= OTP_MAX_ATTEMPTS ? addMinutes(t, OTP_LOCK_MINS) : null,
          },
        });

        return res.status(400).json({ error: "Incorrect OTP" });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderDeliveryOtp.update({
        where: { id: otpRow.id },
        data: {
          verifiedAt: t,
          consumedAt: t, // ✅ THIS is your "expiry"
        },
      });

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: "DELIVERED",
          deliveredAt: t,
          deliveredByUserId: actor?.id,
        },
      });

      await tx.supplierPaymentAllocation.updateMany({
        where: { purchaseOrderId: poId },
        data: { status: SupplierPaymentStatus.APPROVED },
      });
    });

    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

export default router;