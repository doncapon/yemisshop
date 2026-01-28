// src/routes/purchaseOrders.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import crypto from "crypto";
import { Prisma } from "@prisma/client";

// If you created the orchestrator:
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";
// OR if not, you can swap to direct:
// import { sendWhatsAppOtp } from "../lib/sms.js";
// import { sendOtpEmail } from "../lib/email.js";

const router = Router();

const PurchaseOrderStatus = z.enum([
  "CREATED",
  "PLACED",
  "PAID",
  "DISPATCHED",
  "DELIVERED",
  "CANCELLED",
]);

/* ---------------- Role helpers ---------------- */

const isAdminRole = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

/* ---------------- Delivery OTP config ---------------- */

const OTP_LEN = 6;
const OTP_EXPIRES_MINS = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MINS = 30;
const OTP_RESEND_COOLDOWN_SECS = 60;

function now() {
  return new Date();
}
function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}
function addSeconds(d: Date, secs: number) {
  return new Date(d.getTime() + secs * 1000);
}
function genOtp6() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LEN, "0");
}
function hashOtp(code: string, salt: string) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

// E.164 normalization (basic). If you already store E.164, keep it.
function normalizeE164(phone?: string | null) {
  if (!phone) return null;
  const p = phone.trim();
  if (!p) return null;
  if (p.startsWith("+")) return p;
  return p; // safest: do not guess country prefix
}

function supplierAllocHoldStatus(): any {
  const E = (Prisma as any).SupplierPaymentStatus;
  if (!E) return "PENDING";
  return (
    E.HELD ??
    E.ON_HOLD ??
    E.HOLD ??
    E.PENDING ??
    E.CREATED ??
    Object.values(E)[0]
  );
}

/* ---------------- Authz helpers ---------------- */

/**
 * Allow:
 * - Admin/Super admin
 * - Supplier "owner user" if your Supplier model has a link (common field names checked)
 *
 * If your DB uses a different field for supplier-user link, add it here.
 */
function canActOnPO(req: any, po: any): boolean {
  const role = String(req?.user?.role ?? "");
  if (isAdminRole(role)) return true;

  const actorId = String(req?.user?.id ?? "");
  if (!actorId) return false;

  const s = po?.supplier ?? null;
  const supplierUserId =
    s?.userId ??
    s?.ownerUserId ??
    s?.linkedUserId ??
    s?.createdByUserId ??
    null;

  return supplierUserId ? String(supplierUserId) === actorId : false;
}

/* =========================================================
   GET /api/purchase-orders (admins)
   (kept exactly as your original shape)
========================================================= */

router.get("/", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        supplier: true,
        items: { include: { orderItem: { include: { product: true } } } },
      },
    });
    res.json(pos);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   POST /api/purchase-orders/:poId/delivery-otp/request
   - Issues an OTP to the ORDER's customer for delivery confirmation
   - Only allowed when PO is in a shipped/dispatched state
========================================================= */

router.post(
  "/:poId/delivery-otp/request",
  requireAuth,
  async (req: Request, res: Response) => {
    const poId = String(req.params.poId);
    const actorId = (req as any).user?.id;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        order: { include: { user: true } },
        supplier: true,
      },
    });

    if (!po) return res.status(404).json({ error: "Purchase order not found" });

    // Authz: admin OR supplier owner (if linked)
    if (!canActOnPO(req as any, po)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Status gate: your enum has DISPATCHED; some systems use SHIPPED too
    const allowed = new Set(["DISPATCHED", "SHIPPED"]);
    const st = String((po as any).status ?? "");
    if (!allowed.has(st)) {
      return res.status(400).json({
        error: "OTP can only be issued when purchase order is DISPATCHED/SHIPPED",
        status: st,
      });
    }

    const t = now();

    // If locked, block
    if ((po as any).deliveryOtpLockedUntil && (po as any).deliveryOtpLockedUntil > t) {
      return res.status(429).json({
        error: "OTP requests temporarily locked",
        lockedUntil: (po as any).deliveryOtpLockedUntil,
      });
    }

    // Cooldown to avoid spam
    if ((po as any).deliveryOtpIssuedAt) {
      const nextAllowed = addSeconds((po as any).deliveryOtpIssuedAt, OTP_RESEND_COOLDOWN_SECS);
      if (nextAllowed > t) {
        return res.status(429).json({
          error: "Please wait before requesting another OTP",
          retryAt: nextAllowed,
        });
      }
    }

    const code = genOtp6();
    const salt = crypto.randomUUID();
    const codeHash = hashOtp(code, salt);
    const expiresAt = addMinutes(t, OTP_EXPIRES_MINS);

    // Store salt + metadata inside deliveredMetaJson (so OTP is never stored in plain form)
    const prevMeta = ((po as any).deliveredMetaJson ?? {}) as any;
    const meta = {
      ...prevMeta,
      deliveryOtp: {
        ...(prevMeta?.deliveryOtp ?? {}),
        salt,
        issuedByUserId: actorId ?? null,
        channel: "WHATSAPP+EMAIL",
      },
    };

    const updated = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        deliveryOtpHash: codeHash,
        deliveryOtpIssuedAt: t,
        deliveryOtpExpiresAt: expiresAt,
        deliveryOtpAttempts: 0,
        deliveryOtpVerifiedAt: null,
        deliveryOtpLockedUntil: null,
        deliveryOtpIssuedToUserId: (po as any).order?.userId ?? null,
        deliveredMetaJson: meta,
      } as any,
      include: { order: { include: { user: true } } },
    });

    const user = (updated as any).order?.user;
    const toE164 = normalizeE164(user?.phone ?? null);
    const toEmail = user?.email ?? null;

    // Send comms (don’t fail the request if comms fail)
    let notifyResult: any = null;
    try {
      notifyResult = await sendOrderOtpNotifications({
        userEmail: toEmail,
        userPhoneE164: toE164,
        code,
        expiresMins: OTP_EXPIRES_MINS,
        purposeLabel: "Delivery confirmation",
        orderId: (updated as any).orderId,
        brand: "DaySpring",
      });

      // If you prefer direct calls:
      // const whatsapp = toE164 ? await sendWhatsAppOtp(toE164, code, { expiresMins: OTP_EXPIRES_MINS, purposeLabel: "Delivery confirmation" }) : null;
      // const email = toEmail ? await sendOtpEmail(toEmail, code, { expiresMins: OTP_EXPIRES_MINS, purposeLabel: "Delivery confirmation", orderId: (updated as any).orderId }) : null;
      // notifyResult = { whatsapp, email };
    } catch (e: any) {
      notifyResult = { ok: false, error: e?.message || "Notify failed" };
    }

    return res.json({
      ok: true,
      purchaseOrderId: poId,
      expiresAt,
      notify: notifyResult,
    });
  }
);

/* =========================================================
   POST /api/purchase-orders/:poId/delivery-otp/verify
   - Customer (or admin/supplier) verifies OTP to mark PO delivered
========================================================= */

router.post(
  "/:poId/delivery-otp/verify",
  requireAuth,
  async (req: Request, res: Response) => {
    const poId = String(req.params.poId);
    const actorId = (req as any).user?.id;

    const code = String((req as any).body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Invalid code format" });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { order: { include: { user: true } }, supplier: true },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });

    // Authz:
    // - Admin
    // - Supplier owner (if linked)
    // - OR the actual customer user (order.userId)
    const role = String((req as any).user?.role ?? "");
    const actor = String((req as any).user?.id ?? "");
    const isAdmin = isAdminRole(role);
    const isSupplierActor = canActOnPO(req as any, po);
    const isCustomer = actor && String((po as any).order?.userId ?? "") === actor;

    if (!isAdmin && !isSupplierActor && !isCustomer) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const t = now();

    if (!(po as any).deliveryOtpHash || !(po as any).deliveryOtpExpiresAt) {
      return res.status(400).json({ error: "No OTP issued for this purchase order" });
    }

    if ((po as any).deliveryOtpVerifiedAt) {
      return res.status(200).json({
        ok: true,
        alreadyVerified: true,
        verifiedAt: (po as any).deliveryOtpVerifiedAt,
      });
    }

    if ((po as any).deliveryOtpLockedUntil && (po as any).deliveryOtpLockedUntil > t) {
      return res.status(429).json({
        error: "OTP verification temporarily locked",
        lockedUntil: (po as any).deliveryOtpLockedUntil,
      });
    }

    if ((po as any).deliveryOtpExpiresAt <= t) {
      return res.status(400).json({ error: "OTP expired" });
    }

    const salt = ((po as any).deliveredMetaJson as any)?.deliveryOtp?.salt ?? null;
    if (!salt) {
      return res.status(500).json({ error: "OTP salt missing; cannot verify" });
    }

    const attemptedHash = hashOtp(code, salt);

    // timingSafeEqual needs equal-length buffers. sha256 hex is fixed-length; still be safe.
    const a = Buffer.from(attemptedHash, "hex");
    const b = Buffer.from(String((po as any).deliveryOtpHash), "hex");
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!ok) {
      const nextAttempts = Number((po as any).deliveryOtpAttempts || 0) + 1;

      let lockedUntil: Date | null = null;
      if (nextAttempts >= OTP_MAX_ATTEMPTS) {
        lockedUntil = addMinutes(t, OTP_LOCK_MINS);
      }

      await prisma.purchaseOrder.update({
        where: { id: poId },
        data: {
          deliveryOtpAttempts: nextAttempts,
          deliveryOtpLockedUntil: lockedUntil,
        } as any,
      });

      return res.status(400).json({
        error: "Incorrect OTP",
        attempts: nextAttempts,
        lockedUntil,
      });
    }

    // Correct OTP: mark delivered
    const prevMeta = (((po as any).deliveredMetaJson ?? {}) as any) || {};
    const updated = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: "DELIVERED",
        deliveredAt: t,
        deliveryOtpVerifiedAt: t,
        deliveredByUserId: actorId ?? null,
        deliveredMetaJson: {
          ...prevMeta,
          deliveryOtp: {
            ...(prevMeta?.deliveryOtp ?? {}),
            verifiedAt: t.toISOString(),
            verifiedByUserId: actorId ?? null,
          },
        },
      } as any,
    });

    return res.json({ ok: true, purchaseOrder: updated });
  }
);

export default router;
