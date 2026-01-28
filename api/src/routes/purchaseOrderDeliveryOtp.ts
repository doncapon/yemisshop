// src/routes/purchaseOrderDeliveryOtp.ts
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";
import { SupplierPaymentStatus } from "@prisma/client";

const router = Router();

const OTP_LEN = 6;
const OTP_EXPIRES_SECS = 600; // 10 mins
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MINS = 30;
const OTP_RESEND_COOLDOWN_SECS = 60;

function now() {
    return new Date();
}
function addSeconds(d: Date, secs: number) {
    return new Date(d.getTime() + secs * 1000);
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
function normalizeE164(phone?: string | null) {
    if (!phone) return null;
    const p = phone.trim();
    if (!p) return null;
    if (p.startsWith("+")) return p;
    return p;
}

function isAdminRole(role?: string) {
    return role === "ADMIN" || role === "SUPER_ADMIN";
}
function isSupplierRole(role?: string) {
    return role === "SUPPLIER";
}

async function resolveActorSupplierId(actor: any): Promise<string | null> {
    const fromSession = actor?.supplierId ? String(actor.supplierId) : null;
    if (fromSession) return fromSession;

    const userId = actor?.id ? String(actor.id) : null;
    if (!userId) return null;

    // Option 1 (most common): Supplier has userId
    const s = await prisma.supplier.findFirst({
        where: { userId },
        select: { id: true },
    });
    if (s?.id) return String(s.id);

    // Option 2 (if you have supplier staff join table, adjust name/fields):
    // const staff = await prisma.supplierUser.findFirst({
    //   where: { userId },
    //   select: { supplierId: true },
    // });
    // if (staff?.supplierId) return String(staff.supplierId);

    return null;
}


async function canAccessPo(actor: any, poSupplierId: string) {
    if (isAdminRole(actor?.role)) return { ok: true as const };

    if (!isSupplierRole(actor?.role)) {
        return { ok: false as const, reason: "not_supplier_role" };
    }

    const actorSupplierId = await resolveActorSupplierId(actor);
    if (!actorSupplierId) {
        return { ok: false as const, reason: "missing_supplierId_on_actor" };
    }

    if (String(actorSupplierId) !== String(poSupplierId)) {
        return { ok: false as const, reason: "supplier_mismatch" };
    }

    return { ok: true as const };
}

/**
 * POST /api/orders/purchase-orders/:poId/delivery-otp/request
 * - Supplier/admin requests delivery OTP
 * - Customer receives code (email/SMS/WhatsApp via sendOrderOtpNotifications)
 */
router.post(
    "/purchase-orders/:poId/delivery-otp/request",
    requireAuth,
    async (req: Request, res: Response) => {
        const poId = String(req.params.poId);
        const actor = (req as any).user;

        const po = await prisma.purchaseOrder.findUnique({
            where: { id: poId },
            select: {
                id: true,
                status: true,
                supplierId: true,
                orderId: true,
                order: {
                    select: {
                        id: true,
                        userId: true,
                        user: { select: { email: true, phone: true } },
                    },
                },
            },
        });
        if (!po) return res.status(404).json({ error: "Purchase order not found" });

        const access = await canAccessPo(actor, po.supplierId);
        if (!access.ok) {
            return res.status(403).json({ error: "Forbidden", reason: access.reason });
        }


        // Only allow when shipped/out for delivery (adjust statuses to your flow)
        const poStatus = String(po.status || "").toUpperCase();
        if (!["SHIPPED", "OUT_FOR_DELIVERY"].includes(poStatus)) {
            return res.status(400).json({
                error: "Delivery OTP can only be requested when PO is SHIPPED / OUT_FOR_DELIVERY",
            });
        }

        // Cooldown per PO to prevent spamming
        const last = await prisma.purchaseOrderDeliveryOtp.findFirst({
            where: { purchaseOrderId: poId },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        });

        const t = now();
        if (last?.createdAt) {
            const nextAllowed = addSeconds(last.createdAt, OTP_RESEND_COOLDOWN_SECS);
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
        const expiresAt = addSeconds(t, OTP_EXPIRES_SECS);

        const row = await prisma.purchaseOrderDeliveryOtp.create({
            data: {
                purchaseOrderId: poId,
                orderId: po.orderId,
                customerId: po.order.userId,
                salt,
                codeHash,
                expiresAt,
            },
            select: { id: true, expiresAt: true },
        });

        // Notify customer best-effort
        const toEmail = po.order.user?.email ?? null;
        const toE164 = normalizeE164(po.order.user?.phone ?? null);

        try {
            await sendOrderOtpNotifications({
                userEmail: toEmail,
                userPhoneE164: toE164,
                code,
                expiresMins: Math.ceil(OTP_EXPIRES_SECS / 60),
                purposeLabel: "Confirm delivery",
                orderId: po.orderId,
                brand: "DaySpring",
            });
        } catch (e) {
            console.error("sendOrderOtpNotifications failed:", e);
        }

        const channelHint =
            toE164 && toE164.length >= 4
                ? `sms/whatsapp to ***${toE164.slice(-4)}`
                : toEmail
                    ? `email to ${String(toEmail).replace(/(^.).+(@.*$)/, "$1***$2")}`
                    : null;

        return res.json({
            ok: true,
            requestId: row.id,
            expiresAt: row.expiresAt,
            expiresInSec: OTP_EXPIRES_SECS,
            channelHint,
        });
    }
);

/**
 * POST /api/orders/purchase-orders/:poId/delivery-otp/verify
 * body: { code: "123456" }
 *
 * - Supplier/admin verifies the OTP at delivery
 * - Marks PO delivered
 * - Releases the supplier allocation for payout (status change)
 * - Logs DELIVERY_CONFIRMED on latest PAID payment
 */
router.post(
    "/purchase-orders/:poId/delivery-otp/verify",
    requireAuth,
    async (req: Request, res: Response) => {
        const poId = String(req.params.poId);
        const actor = (req as any).user;

        const code = String(req.body?.code ?? "").replace(/\D/g, "").slice(0, 6);
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Invalid OTP format" });

        const po = await prisma.purchaseOrder.findUnique({
            where: { id: poId },
            select: {
                id: true,
                status: true,
                supplierId: true,
                orderId: true,
            },
        });
        if (!po) return res.status(404).json({ error: "Purchase order not found" });
        
        const access = await canAccessPo(actor, po.supplierId);
        if (!access.ok) {
            return res.status(403).json({ error: "Forbidden", reason: access.reason });
        }


        const poStatus = String(po.status || "").toUpperCase();

        // If already delivered, be idempotent
        if (["DELIVERED", "COMPLETED"].includes(poStatus)) {
            return res.json({ ok: true, alreadyDelivered: true });
        }

        if (!["SHIPPED", "OUT_FOR_DELIVERY"].includes(poStatus)) {
            return res.status(400).json({ error: "PO is not in a deliverable state" });
        }

        const otpRow = await prisma.purchaseOrderDeliveryOtp.findFirst({
            where: { purchaseOrderId: poId },
            orderBy: { createdAt: "desc" },
        });
        if (!otpRow) return res.status(404).json({ error: "OTP not requested" });

        const t = now();

        // Idempotent: if already verified, just ensure PO delivered + allocations released
        // (but don’t re-check hash)
        if (!otpRow.verifiedAt) {
            if (otpRow.lockedUntil && otpRow.lockedUntil > t) {
                return res.status(429).json({ error: "OTP locked", lockedUntil: otpRow.lockedUntil });
            }
            if (otpRow.expiresAt <= t) return res.status(400).json({ error: "OTP expired" });

            const attemptedHash = hashOtp(code, otpRow.salt);
            const a = Buffer.from(attemptedHash, "hex");
            const b = Buffer.from(otpRow.codeHash, "hex");
            const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

            if (!ok) {
                const nextAttempts = (otpRow.attempts ?? 0) + 1;
                const lockedUntil = nextAttempts >= OTP_MAX_ATTEMPTS ? addMinutes(t, OTP_LOCK_MINS) : null;

                await prisma.purchaseOrderDeliveryOtp.update({
                    where: { id: otpRow.id },
                    data: { attempts: nextAttempts, lockedUntil },
                });

                return res.status(400).json({ error: "Incorrect OTP", attempts: nextAttempts, lockedUntil });
            }
        }

        // ✅ OTP OK (or already verified) → deliver + release allocation
        await prisma.$transaction(async (tx: any) => {
            // mark otp verified/consumed once
            if (!otpRow.verifiedAt) {
                await tx.purchaseOrderDeliveryOtp.update({
                    where: { id: otpRow.id },
                    data: { verifiedAt: t, consumedAt: t, attempts: 0, lockedUntil: null },
                });
            } else if (!otpRow.consumedAt) {
                await tx.purchaseOrderDeliveryOtp.update({
                    where: { id: otpRow.id },
                    data: { consumedAt: t },
                });
            }

            // mark PO delivered
            // NOTE: these fields must exist in your schema, otherwise remove them
            await tx.purchaseOrder.update({
                where: { id: poId },
                data: {
                    status: "DELIVERED",
                    deliveredAt: t,
                    deliveredByUserId: actor?.id ?? null,
                },
            });

            // Release allocation (your payout job/transfer flow can now pick it up)
            // If you store paymentId on allocation, we update all for this PO (safe).
            await tx.supplierPaymentAllocation.updateMany({
                where: { purchaseOrderId: poId },
                data: {
                    // change to your "released" status if different
                    status: SupplierPaymentStatus.APPROVED,
                },
            });

            // log against latest paid payment (optional but useful)
            const latestPaidPayment = await tx.payment.findFirst({
                where: { orderId: po.orderId, status: "PAID" },
                orderBy: { createdAt: "desc" },
                select: { id: true },
            });

            if (latestPaidPayment?.id) {
                await tx.paymentEvent.create({
                    data: {
                        paymentId: latestPaidPayment.id,
                        type: "DELIVERY_CONFIRMED",
                        data: { poId, verifiedBy: actor?.id ?? null },
                    },
                });
            }
        });

        return res.json({ ok: true });
    }
);

export default router;
