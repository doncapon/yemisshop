// api/src/routes/profile.ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { Prisma } from "@prisma/client";
import { issueOtp, verifyOtp } from "../lib/otp.js";

const router = Router();

const addressSchema = z.object({
  houseNumber: z.string().optional().default(""),
  streetName: z.string().optional().default(""),
  postCode: z.string().optional().default(""),
  town: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
  lga: z.string().optional().default(""),
});

const savedShippingAddressSchema = z.object({
  label: z.string().optional().default(""),
  recipientName: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  whatsappPhone: z.string().optional().default(""),
  houseNumber: z.string().optional().default(""),
  streetName: z.string().optional().default(""),
  postCode: z.string().optional().default(""),
  town: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
  lga: z.string().optional().default(""),
  landmark: z.string().optional().default(""),
  directionsNote: z.string().optional().default(""),
  isDefault: z.boolean().optional().default(false),
});

const updateSavedShippingAddressSchema = savedShippingAddressSchema.partial();

function cleanString(v: string | undefined) {
  const s = String(v ?? "").trim();
  return s;
}

function toNullIfBlank(v: string | undefined) {
  const s = cleanString(v);
  return s ? s : null;
}

function mapSavedShippingAddress(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label ?? "",
    recipientName: row.recipientName ?? "",
    phone: row.phone ?? "",
    whatsappPhone: row.whatsappPhone ?? "",
    houseNumber: row.houseNumber ?? "",
    streetName: row.streetName ?? "",
    postCode: row.postCode ?? "",
    town: row.town ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    country: row.country ?? "",
    lga: row.lga ?? "",
    landmark: row.landmark ?? "",
    directionsNote: row.directionsNote ?? "",
    isDefault: !!row.isDefault,
    isActive: !!row.isActive,
    phoneVerifiedAt: row.phoneVerifiedAt ?? null,
    phoneVerifiedBy: row.phoneVerifiedBy ?? null,
    verificationMeta: row.verificationMeta ?? Prisma.JsonNull,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * GET /api/profile/me
 * Returns:
 * - address: legacy primary/home address
 * - shippingAddress: resolved default saved shipping address (for old checkout UI compatibility)
 * - shippingAddresses: all active saved shipping addresses
 * - defaultShippingAddressId
 */
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        middleName: true,
        lastName: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        dateOfBirth: true,
        defaultShippingAddressId: true,
        address: {
          select: {
            id: true,
            houseNumber: true,
            streetName: true,
            postCode: true,
            town: true,
            city: true,
            state: true,
            country: true,
            lga: true,
          },
        },
        defaultShippingAddress: {
          select: {
            id: true,
            label: true,
            recipientName: true,
            phone: true,
            whatsappPhone: true,
            houseNumber: true,
            streetName: true,
            postCode: true,
            town: true,
            city: true,
            state: true,
            country: true,
            lga: true,
            landmark: true,
            directionsNote: true,
            isDefault: true,
            isActive: true,
            phoneVerifiedAt: true,
            phoneVerifiedBy: true,
            verificationMeta: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        shippingAddresses: {
          where: { isActive: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            label: true,
            recipientName: true,
            phone: true,
            whatsappPhone: true,
            houseNumber: true,
            streetName: true,
            postCode: true,
            town: true,
            city: true,
            state: true,
            country: true,
            lga: true,
            landmark: true,
            directionsNote: true,
            isDefault: true,
            isActive: true,
            phoneVerifiedAt: true,
            phoneVerifiedBy: true,
            verificationMeta: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        createdAt: true,
      },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    const defaultShippingAddress =
      user.defaultShippingAddress ??
      user.shippingAddresses.find((x) => x.isDefault) ??
      user.shippingAddresses[0] ??
      null;

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      phone: user.phone,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
      dateOfBirth: user.dateOfBirth,
      createdAt: user.createdAt,
      address: user.address,
      shippingAddress: defaultShippingAddress
        ? {
            id: defaultShippingAddress.id,
            houseNumber: defaultShippingAddress.houseNumber ?? "",
            streetName: defaultShippingAddress.streetName ?? "",
            postCode: defaultShippingAddress.postCode ?? "",
            town: defaultShippingAddress.town ?? "",
            city: defaultShippingAddress.city ?? "",
            state: defaultShippingAddress.state ?? "",
            country: defaultShippingAddress.country ?? "",
            lga: defaultShippingAddress.lga ?? "",
            recipientName: defaultShippingAddress.recipientName ?? "",
            phone: defaultShippingAddress.phone ?? "",
            whatsappPhone: defaultShippingAddress.whatsappPhone ?? "",
            label: defaultShippingAddress.label ?? "",
            landmark: defaultShippingAddress.landmark ?? "",
            directionsNote: defaultShippingAddress.directionsNote ?? "",
            isDefault: !!defaultShippingAddress.isDefault,
          }
        : null,
      defaultShippingAddressId: user.defaultShippingAddressId ?? defaultShippingAddress?.id ?? null,
      shippingAddresses: user.shippingAddresses.map(mapSavedShippingAddress),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/profile/shipping-addresses/:id/request-phone-otp
 * Sends OTP for saved shipping address verification.
 * Prefers whatsappPhone if present, otherwise falls back to phone.
 * Uses the shared OTP service, which can still route through Termii.
 */
router.post("/shipping-addresses/:id/request-phone-otp", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    const existing = await prisma.userShippingAddress.findFirst({
      where: { id, userId, isActive: true },
      select: {
        id: true,
        phone: true,
        whatsappPhone: true,
        phoneVerifiedAt: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Shipping address not found" });
    }

    if (existing.phoneVerifiedAt) {
      return res.json({
        ok: true,
        alreadyVerified: true,
        message: "This delivery phone is already verified.",
      });
    }

    const whatsappPhone = cleanString(existing.whatsappPhone ?? undefined);
    const phone = cleanString(existing.phone ?? undefined);
    const hasWhatsapp = !!whatsappPhone;
    const targetPhone = hasWhatsapp ? whatsappPhone : phone;

    if (!targetPhone) {
      return res.status(400).json({
        error: "This saved address does not have a valid phone or WhatsApp number.",
      });
    }

    const result = await issueOtp({
      identifier: `shipping-address:${id}`,
      userId,
      phone: targetPhone,
      channelPref: hasWhatsapp ? "whatsapp" : "sms",
    });

    if (!result.ok) {
      return res.status(400).json({
        error: result.error || "Could not send OTP.",
      });
    }

    return res.json({
      ok: true,
      message: "OTP sent successfully.",
      channel: hasWhatsapp ? "whatsapp" : "sms",
      maskedPhone: targetPhone.slice(-4).padStart(targetPhone.length, "*"),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/profile/address
 * Save HOME address and attach to user.addressId
 */
router.post("/address", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const data = addressSchema.parse(req.body);

    const saved = await prisma.$transaction(async (tx) => {
      const addr = await tx.address.create({
        data: {
          houseNumber: toNullIfBlank(data.houseNumber),
          streetName: toNullIfBlank(data.streetName),
          postCode: toNullIfBlank(data.postCode),
          town: toNullIfBlank(data.town),
          city: cleanString(data.city),
          state: cleanString(data.state),
          country: cleanString(data.country) || "Nigeria",
          lga: toNullIfBlank(data.lga),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { addressId: addr.id },
      });

      return addr;
    });

    res.json(saved);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/profile/shipping
 * Legacy compatibility endpoint:
 * creates a saved shipping address and makes it the default.
 */
router.post("/shipping", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const data = savedShippingAddressSchema.parse({
      ...req.body,
      phone: req.body?.phone ?? "",
      whatsappPhone: req.body?.whatsappPhone ?? "",
      isDefault: true,
    });

    const saved = await prisma.$transaction(async (tx) => {
      await tx.userShippingAddress.updateMany({
        where: { userId },
        data: { isDefault: false },
      });

      const row = await tx.userShippingAddress.create({
        data: {
          userId,
          label: toNullIfBlank(data.label),
          recipientName: toNullIfBlank(data.recipientName),
          phone: cleanString(data.phone),
          whatsappPhone: toNullIfBlank(data.whatsappPhone),
          houseNumber: toNullIfBlank(data.houseNumber),
          streetName: toNullIfBlank(data.streetName),
          postCode: toNullIfBlank(data.postCode),
          town: toNullIfBlank(data.town),
          city: cleanString(data.city),
          state: cleanString(data.state),
          country: cleanString(data.country) || "Nigeria",
          lga: toNullIfBlank(data.lga),
          landmark: toNullIfBlank(data.landmark),
          directionsNote: toNullIfBlank(data.directionsNote),
          isDefault: true,
          isActive: true,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { defaultShippingAddressId: row.id },
      });

      return row;
    });

    res.json(mapSavedShippingAddress(saved));
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/profile/shipping-addresses
 */
router.get("/shipping-addresses", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const rows = await prisma.userShippingAddress.findMany({
      where: {
        userId,
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    res.json({
      data: rows.map(mapSavedShippingAddress),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/profile/shipping-addresses
 * Create saved shipping address
 */
router.post("/shipping-addresses", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const data = savedShippingAddressSchema.parse(req.body);

    const saved = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          phone: true,
          phoneVerifiedAt: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      const incomingPhone = cleanString(data.phone);
      const userPhone = cleanString(user.phone ?? "");

      const shouldAutoVerify =
        !!incomingPhone &&
        !!userPhone &&
        incomingPhone === userPhone &&
        !!user.phoneVerifiedAt;

      if (data.isDefault) {
        await tx.userShippingAddress.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }

      const row = await tx.userShippingAddress.create({
        data: {
          userId,
          label: toNullIfBlank(data.label),
          recipientName: toNullIfBlank(data.recipientName),
          phone: incomingPhone,
          whatsappPhone: toNullIfBlank(data.whatsappPhone),
          houseNumber: toNullIfBlank(data.houseNumber),
          streetName: toNullIfBlank(data.streetName),
          postCode: toNullIfBlank(data.postCode),
          town: toNullIfBlank(data.town),
          city: cleanString(data.city),
          state: cleanString(data.state),
          country: cleanString(data.country) || "Nigeria",
          lga: toNullIfBlank(data.lga),
          landmark: toNullIfBlank(data.landmark),
          directionsNote: toNullIfBlank(data.directionsNote),
          isDefault: !!data.isDefault,
          isActive: true,
          phoneVerifiedAt: shouldAutoVerify ? user.phoneVerifiedAt : null,
          phoneVerifiedBy: shouldAutoVerify ? "PROFILE_PHONE_MATCH" : null,
          verificationMeta: shouldAutoVerify
            ? {
                source: "PROFILE_PHONE_MATCH",
                matchedUserPhone: incomingPhone,
              }
            : Prisma.JsonNull,
        },
      });

      if (data.isDefault) {
        await tx.user.update({
          where: { id: userId },
          data: { defaultShippingAddressId: row.id },
        });
      }

      return row;
    });

    res.json({ data: mapSavedShippingAddress(saved) });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/profile/shipping-addresses/:id
 */
router.patch("/shipping-addresses/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const data = updateSavedShippingAddressSchema.parse(req.body);

    const existing = await prisma.userShippingAddress.findFirst({
      where: { id, userId, isActive: true },
      select: {
        id: true,
        phone: true,
        phoneVerifiedAt: true,
        phoneVerifiedBy: true,
        verificationMeta: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Shipping address not found" });
    }

    const saved = await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.userShippingAddress.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }

      const nextPhone =
        data.phone !== undefined ? cleanString(data.phone) : cleanString(existing.phone);

      const prevPhone = cleanString(existing.phone);
      const phoneChanged = nextPhone !== prevPhone;

      const row = await tx.userShippingAddress.update({
        where: { id },
        data: {
          ...(data.label !== undefined ? { label: toNullIfBlank(data.label) } : {}),
          ...(data.recipientName !== undefined
            ? { recipientName: toNullIfBlank(data.recipientName) }
            : {}),
          ...(data.phone !== undefined ? { phone: nextPhone } : {}),
          ...(data.whatsappPhone !== undefined
            ? { whatsappPhone: toNullIfBlank(data.whatsappPhone) }
            : {}),
          ...(data.houseNumber !== undefined
            ? { houseNumber: toNullIfBlank(data.houseNumber) }
            : {}),
          ...(data.streetName !== undefined
            ? { streetName: toNullIfBlank(data.streetName) }
            : {}),
          ...(data.postCode !== undefined
            ? { postCode: toNullIfBlank(data.postCode) }
            : {}),
          ...(data.town !== undefined ? { town: toNullIfBlank(data.town) } : {}),
          ...(data.city !== undefined ? { city: cleanString(data.city) } : {}),
          ...(data.state !== undefined ? { state: cleanString(data.state) } : {}),
          ...(data.country !== undefined
            ? { country: cleanString(data.country) || "Nigeria" }
            : {}),
          ...(data.lga !== undefined ? { lga: toNullIfBlank(data.lga) } : {}),
          ...(data.landmark !== undefined
            ? { landmark: toNullIfBlank(data.landmark) }
            : {}),
          ...(data.directionsNote !== undefined
            ? { directionsNote: toNullIfBlank(data.directionsNote) }
            : {}),
          ...(data.isDefault !== undefined ? { isDefault: !!data.isDefault } : {}),
          ...(phoneChanged
            ? {
                phoneVerifiedAt: null,
                phoneVerifiedBy: null,
                verificationMeta: Prisma.JsonNull,
              }
            : {}),
        },
      });

      if (data.isDefault === true) {
        await tx.user.update({
          where: { id: userId },
          data: { defaultShippingAddressId: row.id },
        });
      }

      return row;
    });

    res.json({ data: mapSavedShippingAddress(saved) });
  } catch (e) {
    next(e);
  }
});

router.post("/shipping-addresses/:id/verify-phone", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const rawCode = String(req.body?.otp ?? req.body?.code ?? "").trim();

    if (!/^\d{6}$/.test(rawCode)) {
      return res.status(400).json({ error: "OTP must be 6 digits." });
    }

    const existing = await prisma.userShippingAddress.findFirst({
      where: { id, userId, isActive: true },
      select: {
        id: true,
        phone: true,
        whatsappPhone: true,
        phoneVerifiedAt: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Shipping address not found" });
    }

    if (existing.phoneVerifiedAt) {
      const fullRow = await prisma.userShippingAddress.findFirst({
        where: { id, userId, isActive: true },
      });

      return res.json({
        ok: true,
        alreadyVerified: true,
        data: mapSavedShippingAddress(fullRow),
      });
    }

    const out = await verifyOtp({
      identifier: `shipping-address:${id}`,
      code: rawCode,
    });

    if (!out.ok) {
      return res.status(400).json({
        error: out.error || "Invalid OTP. Please try again.",
      });
    }

    const now = new Date();

    const row = await prisma.userShippingAddress.update({
      where: { id },
      data: {
        phoneVerifiedAt: now,
        phoneVerifiedBy: "CHECKOUT_DELIVERY_OTP",
        verificationMeta: {
          source: "CHECKOUT_DELIVERY_OTP",
          verifiedPhone: existing.phone ?? null,
          verifiedWhatsappPhone: existing.whatsappPhone ?? null,
          verifiedAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return res.json({
      ok: true,
      data: mapSavedShippingAddress(row),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/profile/shipping-addresses/:id/default
 */
router.post("/shipping-addresses/:id/default", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    const existing = await prisma.userShippingAddress.findFirst({
      where: { id, userId, isActive: true },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Shipping address not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userShippingAddress.updateMany({
        where: { userId },
        data: { isDefault: false },
      });

      await tx.userShippingAddress.update({
        where: { id },
        data: { isDefault: true },
      });

      await tx.user.update({
        where: { id: userId },
        data: { defaultShippingAddressId: id },
      });
    });

    res.json({ ok: true, defaultShippingAddressId: id });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/profile/shipping-addresses/:id
 * soft delete
 */
router.delete("/shipping-addresses/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    const existing = await prisma.userShippingAddress.findFirst({
      where: { id, userId, isActive: true },
      select: { id: true, isDefault: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Shipping address not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userShippingAddress.update({
        where: { id },
        data: {
          isActive: false,
          isDefault: false,
        },
      });

      if (existing.isDefault) {
        const fallback = await tx.userShippingAddress.findFirst({
          where: {
            userId,
            isActive: true,
            id: { not: id },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        if (fallback?.id) {
          await tx.userShippingAddress.update({
            where: { id: fallback.id },
            data: { isDefault: true },
          });

          await tx.user.update({
            where: { id: userId },
            data: { defaultShippingAddressId: fallback.id },
          });
        } else {
          await tx.user.update({
            where: { id: userId },
            data: { defaultShippingAddressId: null },
          });
        }
      }
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

function normalizePhoneToE164(input: unknown, defaultCountryCode = "234"): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d+]/g, "");

  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  if (/^00\d{8,15}$/.test(cleaned)) return `+${cleaned.slice(2)}`;
  if (/^0\d{7,14}$/.test(cleaned)) return `+${defaultCountryCode}${cleaned.slice(1)}`;
  if (/^\d{8,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

export default router;