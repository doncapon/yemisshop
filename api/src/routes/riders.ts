// api/src/routes/riders.ts
import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { sendRiderInviteEmail } from "../lib/email.js";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getAppUrl() {
  return (
    String(process.env.APP_URL || "").trim() ||
    String(process.env.PUBLIC_APP_URL || "").trim() ||
    "http://localhost:5173"
  ).replace(/\/+$/, "");
}

type SupplierCtx = { supplierId: string; supplierName?: string | null };

// Supplier context (admin can impersonate via supplierId)
async function resolveSupplierContext(req: any): Promise<SupplierCtx> {
  const role = req.user?.role;
  const userId = req.user?.id;
  if (!userId) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  // Admin picks supplierId
  if (isAdmin(role)) {
    const supplierId = String(req.query?.supplierId ?? req.body?.supplierId ?? "").trim();
    if (!supplierId) throw Object.assign(new Error("Missing supplierId"), { status: 400 });

    const s = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true },
    });

    if (!s?.id) throw Object.assign(new Error("Supplier not found"), { status: 404 });
    return { supplierId: s.id, supplierName: s.name ?? null };
  }

  // Supplier uses own supplier profile
  if (isSupplier(role)) {
    const supplier = await prisma.supplier.findFirst({
      where: { userId },
      select: { id: true, name: true },
    });
    if (!supplier?.id) throw Object.assign(new Error("Supplier profile not found"), { status: 403 });
    return { supplierId: supplier.id, supplierName: supplier.name ?? null };
  }

  throw Object.assign(new Error("Forbidden"), { status: 403 });
}

/**
 * GET /api/riders
 * Supplier/Admin: list riders for supplier
 */
router.get("/", requireAuth, async (req: any, res: Response) => {
  try {
    const ctx = await resolveSupplierContext(req);

    const riders = await prisma.supplierRider.findMany({
      where: { supplierId: ctx.supplierId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        supplierId: true,
        userId: true,
        name: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
          },
        },
      },
    });

    return res.json({ ok: true, data: riders });
  } catch (e: any) {
    const msg = e?.message || "Failed to list riders";
    const status = e?.status ? Number(e.status) : 500;
    return res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/riders/invite
 * Supplier/Admin creates or re-invites a rider.
 * Body: { email, firstName, lastName, phone?, name? } (+ supplierId for admin)
 * Returns: { inviteToken, expiresAt, acceptUrl, emailSent, emailId? }
 *
 * NOTE: stores invite in User.resetPasswordToken / resetPasswordExpiresAt (hash)
 * AND emails the rider the accept link (Resend; in dev it prints preview if missing key).
 */
router.post("/invite", requireAuth, async (req: any, res: Response) => {
  try {
    const ctx = await resolveSupplierContext(req);

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const firstName = String(req.body?.firstName ?? "").trim();
    const lastName = String(req.body?.lastName ?? "").trim();
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;
    const riderName = req.body?.name ? String(req.body.name).trim() : null;

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (!firstName) return res.status(400).json({ error: "firstName is required" });
    if (!lastName) return res.status(400).json({ error: "lastName is required" });

    const inviteToken = newToken();
    const inviteHash = sha256(inviteToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const out = await prisma.$transaction(async (tx: any) => {
      let user = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true, status: true },
      });

      if (!user) {
        const placeholderPwd = await bcrypt.hash(newToken(), 10);

        user = await tx.user.create({
          data: {
            email,
            password: placeholderPwd,
            role: "SUPPLIER_RIDER",
            firstName,
            lastName,
            phone,
            status: "PENDING",
            resetPasswordToken: inviteHash,
            resetPasswordExpiresAt: expiresAt,
          },
          select: { id: true, role: true, status: true },
        });
      } else {
        if (String(user.role) !== "SUPPLIER_RIDER") {
          throw Object.assign(new Error("Email already belongs to a non-rider account"), { status: 409 });
        }

        await tx.user.update({
          where: { id: user.id },
          data: {
            firstName,
            lastName,
            phone,
            status: "PENDING",
            resetPasswordToken: inviteHash,
            resetPasswordExpiresAt: expiresAt,
          },
        });
      }

      const existing = await tx.supplierRider.findFirst({
        where: { userId: user.id },
        select: { id: true, supplierId: true },
      });

      if (!existing) {
        await tx.supplierRider.create({
          data: {
            supplierId: ctx.supplierId,
            userId: user.id,
            isActive: true,
            name: riderName,
            phone,
          },
        });
      } else {
        if (String(existing.supplierId) !== String(ctx.supplierId)) {
          throw Object.assign(new Error("This rider is already linked to another supplier"), { status: 409 });
        }

        await tx.supplierRider.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            name: riderName ?? undefined,
            phone: phone ?? undefined,
          },
        });
      }

      return { userId: user.id };
    });

    const acceptUrl =
      `${getAppUrl()}/rider/accept?email=${encodeURIComponent(email)}&token=${encodeURIComponent(inviteToken)}`;

    // ✅ Send invite email (in sandbox your email.ts should force to lordshegz)
    let emailSent = false;
    let emailId: string | null = null;
    let emailError: string | null = null;

    try {
      const resp: any =
        await sendRiderInviteEmail(email, acceptUrl, {
          supplierName: ctx.supplierName ?? undefined,
          invitedName: `${firstName} ${lastName}`.trim(),
          intendedTo: email,
        });

      emailSent = true;
      emailId = resp?.id ? String(resp.id) : null;
    } catch (err: any) {
      emailSent = false;
      emailError = err?.message || String(err);
      console.error("[riders] sendRiderInviteEmail failed:", err);
    }

    return res.json({
      ok: true,
      data: {
        ...out,
        inviteToken, // remove later if you want
        expiresAt: expiresAt.toISOString(),
        acceptUrl,

        // ✅ debug
        emailSent,
        emailId,
        emailError,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Invite failed";
    const status = e?.status ? Number(e.status) : 500;
    return res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/riders/accept-invite
 * Body: { email, token, password, firstName?, lastName?, phone?, dateOfBirth? }
 * - sets password, verifies email, activates rider + supplierRider.isActive
 */
router.post("/accept-invite", async (req: any, res: Response) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const token = String(req.body?.token ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Valid email is required" });
    if (!token) return res.status(400).json({ error: "Missing token" });

    const hasMinLen = password.length >= 8;
    const hasLetter = /[A-Za-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return res.status(400).json({ error: "Password must be 8+ chars and include letter, number, special char" });
    }

    const firstName = req.body?.firstName ? String(req.body.firstName).trim() : undefined;
    const lastName = req.body?.lastName ? String(req.body.lastName).trim() : undefined;
    const phone = req.body?.phone ? String(req.body.phone).trim() : undefined;
    const dateOfBirth = req.body?.dateOfBirth ? new Date(String(req.body.dateOfBirth)) : undefined;

    const tokenHash = sha256(token);

    const out = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          role: true,
          resetPasswordToken: true,
          resetPasswordExpiresAt: true,
          emailVerifiedAt: true,
        },
      });

      if (!user) throw Object.assign(new Error("Invite not found"), { status: 404 });
      if (String(user.role) !== "SUPPLIER_RIDER") throw Object.assign(new Error("Invite is not for a rider account"), { status: 400 });

      const expired = user.resetPasswordExpiresAt ? user.resetPasswordExpiresAt.getTime() < Date.now() : true;
      const stored = user.resetPasswordToken ? String(user.resetPasswordToken) : "";

      if (!stored || expired) throw Object.assign(new Error("This invite has expired. Please request a new one."), { status: 400 });
      if (stored !== tokenHash) throw Object.assign(new Error("Invalid invite token"), { status: 400 });

      const pwdHash = await bcrypt.hash(password, 10);

      await tx.user.update({
        where: { id: user.id },
        data: {
          password: pwdHash,
          status: "ACTIVE",
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          resetPasswordToken: null,
          resetPasswordExpiresAt: null,
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          ...(phone ? { phone } : {}),
          ...(dateOfBirth && !Number.isNaN(+dateOfBirth) ? { dateOfBirth } : {}),
        },
      });

      const rider = await tx.supplierRider.findFirst({
        where: { userId: user.id },
        select: { id: true, isActive: true },
      });

      if (rider?.id && !rider.isActive) {
        await tx.supplierRider.update({ where: { id: rider.id }, data: { isActive: true } });
      }

      return { userId: user.id };
    });

    return res.json({ ok: true, data: out });
  } catch (e: any) {
    const msg = e?.message || "Accept invite failed";
    const status = e?.status ? Number(e.status) : 500;
    return res.status(status).json({ error: msg });
  }
});

/**
 * PATCH /api/riders/:riderId
 * Body: { isActive: boolean }
 */
router.patch("/:riderId", requireAuth, async (req: any, res: Response) => {
  try {
    const ctx = await resolveSupplierContext(req);

    const riderId = String(req.params?.riderId || "").trim();
    if (!riderId) return res.status(400).json({ error: "Missing riderId" });

    const isActive = req.body?.isActive;
    if (typeof isActive !== "boolean") return res.status(400).json({ error: "isActive must be boolean" });

    const rider = await prisma.supplierRider.findUnique({
      where: { id: riderId },
      select: { id: true, supplierId: true },
    });

    if (!rider) return res.status(404).json({ error: "Rider not found" });
    if (String(rider.supplierId) !== String(ctx.supplierId)) return res.status(403).json({ error: "Forbidden" });

    const updated = await prisma.supplierRider.update({
      where: { id: riderId },
      data: { isActive },
      select: { id: true, isActive: true, updatedAt: true },
    });

    return res.json({ ok: true, data: updated });
  } catch (e: any) {
    const msg = e?.message || "Failed to update rider";
    const status = e?.status ? Number(e.status) : 500;
    return res.status(status).json({ error: msg });
  }
});

export default router;
