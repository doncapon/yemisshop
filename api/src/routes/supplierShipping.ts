import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import {
  DeliveryServiceLevel,
  ShippingParcelClass,
  SupplierFulfillmentMode,
  SupplierShippingProfileMode,
  Prisma,
} from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function asMoney(v: unknown): Prisma.Decimal | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(n.toFixed(2));
}

async function requireSupplierContext(req: Request) {
  const userId = String((req as any).user?.id ?? "").trim();
  if (!userId) throw new Error("Unauthorized");

  const supplier = await prisma.supplier.findFirst({
    where: {
      userId,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      shippingProfile: { select: { id: true } },
    },
  });

  if (!supplier) {
    const err: any = new Error("Supplier account not found");
    err.status = 404;
    throw err;
  }

  return supplier;
}

const SupplierSettingsSchema = z.object({
  shippingEnabled: z.coerce.boolean(),
  shipsNationwide: z.coerce.boolean(),
  supportsDoorDelivery: z.coerce.boolean(),
  supportsPickupPoint: z.coerce.boolean(),
  defaultLeadDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  handlingFee: z.coerce.number().min(0).nullable().optional(),
  defaultServiceLevel: z.nativeEnum(DeliveryServiceLevel).nullable().optional(),
  shippingProfileMode: z.nativeEnum(SupplierShippingProfileMode),
});

const ProfileSchema = z.object({
  originZoneCode: z.string().trim().nullable().optional(),
  fulfillmentMode: z.nativeEnum(SupplierFulfillmentMode),
  preferredCarrier: z.string().trim().max(120).nullable().optional(),
  localFlatFee: z.coerce.number().min(0).nullable().optional(),
  nearbyFlatFee: z.coerce.number().min(0).nullable().optional(),
  nationwideBaseFee: z.coerce.number().min(0).nullable().optional(),
  defaultHandlingFee: z.coerce.number().min(0).nullable().optional(),
  isActive: z.coerce.boolean(),
});

const RateCardSchema = z.object({
  zoneId: z.string().min(1),
  serviceLevel: z.nativeEnum(DeliveryServiceLevel),
  parcelClass: z.nativeEnum(ShippingParcelClass),
  minWeightGrams: z.coerce.number().int().min(0),
  maxWeightGrams: z.coerce.number().int().positive().nullable().optional(),
  volumetricDivisor: z.coerce.number().int().positive().nullable().optional(),
  maxLengthCm: z.coerce.number().min(0).nullable().optional(),
  maxWidthCm: z.coerce.number().min(0).nullable().optional(),
  maxHeightCm: z.coerce.number().min(0).nullable().optional(),
  baseFee: z.coerce.number().min(0),
  perKgFee: z.coerce.number().min(0).nullable().optional(),
  remoteSurcharge: z.coerce.number().min(0).nullable().optional(),
  fuelSurcharge: z.coerce.number().min(0).nullable().optional(),
  handlingFee: z.coerce.number().min(0).nullable().optional(),
  etaMinDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  etaMaxDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  isActive: z.coerce.boolean().default(true),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

router.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);

    const [fullSupplier, zones, rateCards] = await Promise.all([
      prisma.supplier.findUnique({
        where: { id: supplier.id },
        select: {
          id: true,
          name: true,
          shippingEnabled: true,
          shipsNationwide: true,
          supportsDoorDelivery: true,
          supportsPickupPoint: true,
          defaultLeadDays: true,
          handlingFee: true,
          defaultServiceLevel: true,
          shippingProfileMode: true,
          pickupAddressId: true,
          registeredAddressId: true,
          pickupAddress: {
            select: {
              id: true,
              state: true,
              lga: true,
              town: true,
              city: true,
              country: true,
            },
          },
          registeredAddress: {
            select: {
              id: true,
              state: true,
              lga: true,
              town: true,
              city: true,
              country: true,
            },
          },
          shippingProfile: {
            select: {
              id: true,
              originZoneCode: true,
              fulfillmentMode: true,
              preferredCarrier: true,
              localFlatFee: true,
              nearbyFlatFee: true,
              nationwideBaseFee: true,
              defaultHandlingFee: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
      prisma.shippingZone.findMany({
        where: { isActive: true },
        orderBy: [{ priority: "asc" }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          country: true,
          priority: true,
          statesJson: true,
          lgasJson: true,
          isActive: true,
        },
      }),
      prisma.shippingRateCard.findMany({
        where: { supplierId: supplier.id },
        orderBy: [
          { zone: { priority: "asc" } },
          { serviceLevel: "asc" },
          { parcelClass: "asc" },
          { minWeightGrams: "asc" },
        ],
        include: {
          zone: {
            select: {
              id: true,
              code: true,
              name: true,
              country: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      supplier: fullSupplier,
      zones,
      rateCards: rateCards.map((r) => ({
        id: r.id,
        supplierId: r.supplierId,
        zoneId: r.zoneId,
        zone: r.zone,
        serviceLevel: r.serviceLevel,
        parcelClass: r.parcelClass,
        minWeightGrams: r.minWeightGrams,
        maxWeightGrams: r.maxWeightGrams,
        volumetricDivisor: r.volumetricDivisor,
        maxLengthCm: r.maxLengthCm ? Number(r.maxLengthCm) : null,
        maxWidthCm: r.maxWidthCm ? Number(r.maxWidthCm) : null,
        maxHeightCm: r.maxHeightCm ? Number(r.maxHeightCm) : null,
        baseFee: Number(r.baseFee),
        perKgFee: r.perKgFee ? Number(r.perKgFee) : null,
        remoteSurcharge: r.remoteSurcharge ? Number(r.remoteSurcharge) : null,
        fuelSurcharge: r.fuelSurcharge ? Number(r.fuelSurcharge) : null,
        handlingFee: r.handlingFee ? Number(r.handlingFee) : null,
        currency: r.currency,
        etaMinDays: r.etaMinDays,
        etaMaxDays: r.etaMaxDays,
        isActive: r.isActive,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  })
);

router.put(
  "/me/settings",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);
    const body = SupplierSettingsSchema.parse(req.body);

    const updated = await prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        shippingEnabled: body.shippingEnabled,
        shipsNationwide: body.shipsNationwide,
        supportsDoorDelivery: body.supportsDoorDelivery,
        supportsPickupPoint: body.supportsPickupPoint,
        defaultLeadDays: body.defaultLeadDays ?? null,
        handlingFee: asMoney(body.handlingFee),
        defaultServiceLevel: body.defaultServiceLevel ?? null,
        shippingProfileMode: body.shippingProfileMode,
      },
      select: {
        id: true,
        shippingEnabled: true,
        shipsNationwide: true,
        supportsDoorDelivery: true,
        supportsPickupPoint: true,
        defaultLeadDays: true,
        handlingFee: true,
        defaultServiceLevel: true,
        shippingProfileMode: true,
      },
    });

    return res.json({
      ok: true,
      supplier: {
        ...updated,
        handlingFee: updated.handlingFee ? Number(updated.handlingFee) : null,
      },
    });
  })
);

router.put(
  "/me/profile",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);
    const body = ProfileSchema.parse(req.body);

    if (body.originZoneCode) {
      const zone = await prisma.shippingZone.findUnique({
        where: { code: body.originZoneCode },
        select: { id: true },
      });
      if (!zone) {
        return res.status(400).json({ error: "Selected origin zone was not found." });
      }
    }

    const upserted = await prisma.supplierShippingProfile.upsert({
      where: { supplierId: supplier.id },
      update: {
        originZoneCode: body.originZoneCode ?? null,
        fulfillmentMode: body.fulfillmentMode,
        preferredCarrier: body.preferredCarrier || null,
        localFlatFee: asMoney(body.localFlatFee),
        nearbyFlatFee: asMoney(body.nearbyFlatFee),
        nationwideBaseFee: asMoney(body.nationwideBaseFee),
        defaultHandlingFee: asMoney(body.defaultHandlingFee),
        isActive: body.isActive,
      },
      create: {
        supplierId: supplier.id,
        originZoneCode: body.originZoneCode ?? null,
        fulfillmentMode: body.fulfillmentMode,
        preferredCarrier: body.preferredCarrier || null,
        localFlatFee: asMoney(body.localFlatFee),
        nearbyFlatFee: asMoney(body.nearbyFlatFee),
        nationwideBaseFee: asMoney(body.nationwideBaseFee),
        defaultHandlingFee: asMoney(body.defaultHandlingFee),
        isActive: body.isActive,
      },
      select: {
        id: true,
        supplierId: true,
        originZoneCode: true,
        fulfillmentMode: true,
        preferredCarrier: true,
        localFlatFee: true,
        nearbyFlatFee: true,
        nationwideBaseFee: true,
        defaultHandlingFee: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      profile: {
        ...upserted,
        localFlatFee: upserted.localFlatFee ? Number(upserted.localFlatFee) : null,
        nearbyFlatFee: upserted.nearbyFlatFee ? Number(upserted.nearbyFlatFee) : null,
        nationwideBaseFee: upserted.nationwideBaseFee ? Number(upserted.nationwideBaseFee) : null,
        defaultHandlingFee: upserted.defaultHandlingFee
          ? Number(upserted.defaultHandlingFee)
          : null,
      },
    });
  })
);

router.post(
  "/me/rate-cards",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);
    const body = RateCardSchema.parse(req.body);

    const zone = await prisma.shippingZone.findUnique({
      where: { id: body.zoneId },
      select: { id: true, code: true, name: true, isActive: true },
    });

    if (!zone || !zone.isActive) {
      return res.status(400).json({ error: "Selected zone is invalid or inactive." });
    }

    if (
      body.maxWeightGrams != null &&
      body.maxWeightGrams <= body.minWeightGrams
    ) {
      return res.status(400).json({
        error: "maxWeightGrams must be greater than minWeightGrams.",
      });
    }

    if (
      body.etaMinDays != null &&
      body.etaMaxDays != null &&
      body.etaMaxDays < body.etaMinDays
    ) {
      return res.status(400).json({
        error: "etaMaxDays cannot be lower than etaMinDays.",
      });
    }

    const created = await prisma.shippingRateCard.create({
      data: {
        supplierId: supplier.id,
        zoneId: body.zoneId,
        serviceLevel: body.serviceLevel,
        parcelClass: body.parcelClass,
        minWeightGrams: body.minWeightGrams,
        maxWeightGrams: body.maxWeightGrams ?? null,
        volumetricDivisor: body.volumetricDivisor ?? null,
        maxLengthCm: asMoney(body.maxLengthCm),
        maxWidthCm: asMoney(body.maxWidthCm),
        maxHeightCm: asMoney(body.maxHeightCm),
        baseFee: new Prisma.Decimal(Number(body.baseFee).toFixed(2)),
        perKgFee: asMoney(body.perKgFee),
        remoteSurcharge: asMoney(body.remoteSurcharge),
        fuelSurcharge: asMoney(body.fuelSurcharge),
        handlingFee: asMoney(body.handlingFee),
        etaMinDays: body.etaMinDays ?? null,
        etaMaxDays: body.etaMaxDays ?? null,
        isActive: body.isActive,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      },
      include: {
        zone: {
          select: {
            id: true,
            code: true,
            name: true,
            country: true,
          },
        },
      },
    });

    return res.status(201).json({
      ok: true,
      rateCard: {
        id: created.id,
        supplierId: created.supplierId,
        zoneId: created.zoneId,
        zone: created.zone,
        serviceLevel: created.serviceLevel,
        parcelClass: created.parcelClass,
        minWeightGrams: created.minWeightGrams,
        maxWeightGrams: created.maxWeightGrams,
        volumetricDivisor: created.volumetricDivisor,
        maxLengthCm: created.maxLengthCm ? Number(created.maxLengthCm) : null,
        maxWidthCm: created.maxWidthCm ? Number(created.maxWidthCm) : null,
        maxHeightCm: created.maxHeightCm ? Number(created.maxHeightCm) : null,
        baseFee: Number(created.baseFee),
        perKgFee: created.perKgFee ? Number(created.perKgFee) : null,
        remoteSurcharge: created.remoteSurcharge ? Number(created.remoteSurcharge) : null,
        fuelSurcharge: created.fuelSurcharge ? Number(created.fuelSurcharge) : null,
        handlingFee: created.handlingFee ? Number(created.handlingFee) : null,
        currency: created.currency,
        etaMinDays: created.etaMinDays,
        etaMaxDays: created.etaMaxDays,
        isActive: created.isActive,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  })
);

router.put(
  "/me/rate-cards/:id",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);
    const id = String(req.params.id || "").trim();
    const body = RateCardSchema.parse(req.body);

    const existing = await prisma.shippingRateCard.findFirst({
      where: { id, supplierId: supplier.id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Rate card not found." });
    }

    const zone = await prisma.shippingZone.findUnique({
      where: { id: body.zoneId },
      select: { id: true, isActive: true },
    });

    if (!zone || !zone.isActive) {
      return res.status(400).json({ error: "Selected zone is invalid or inactive." });
    }

    if (
      body.maxWeightGrams != null &&
      body.maxWeightGrams <= body.minWeightGrams
    ) {
      return res.status(400).json({
        error: "maxWeightGrams must be greater than minWeightGrams.",
      });
    }

    if (
      body.etaMinDays != null &&
      body.etaMaxDays != null &&
      body.etaMaxDays < body.etaMinDays
    ) {
      return res.status(400).json({
        error: "etaMaxDays cannot be lower than etaMinDays.",
      });
    }

    const updated = await prisma.shippingRateCard.update({
      where: { id },
      data: {
        zoneId: body.zoneId,
        serviceLevel: body.serviceLevel,
        parcelClass: body.parcelClass,
        minWeightGrams: body.minWeightGrams,
        maxWeightGrams: body.maxWeightGrams ?? null,
        volumetricDivisor: body.volumetricDivisor ?? null,
        maxLengthCm: asMoney(body.maxLengthCm),
        maxWidthCm: asMoney(body.maxWidthCm),
        maxHeightCm: asMoney(body.maxHeightCm),
        baseFee: new Prisma.Decimal(Number(body.baseFee).toFixed(2)),
        perKgFee: asMoney(body.perKgFee),
        remoteSurcharge: asMoney(body.remoteSurcharge),
        fuelSurcharge: asMoney(body.fuelSurcharge),
        handlingFee: asMoney(body.handlingFee),
        etaMinDays: body.etaMinDays ?? null,
        etaMaxDays: body.etaMaxDays ?? null,
        isActive: body.isActive,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      },
      include: {
        zone: {
          select: {
            id: true,
            code: true,
            name: true,
            country: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      rateCard: {
        id: updated.id,
        supplierId: updated.supplierId,
        zoneId: updated.zoneId,
        zone: updated.zone,
        serviceLevel: updated.serviceLevel,
        parcelClass: updated.parcelClass,
        minWeightGrams: updated.minWeightGrams,
        maxWeightGrams: updated.maxWeightGrams,
        volumetricDivisor: updated.volumetricDivisor,
        maxLengthCm: updated.maxLengthCm ? Number(updated.maxLengthCm) : null,
        maxWidthCm: updated.maxWidthCm ? Number(updated.maxWidthCm) : null,
        maxHeightCm: updated.maxHeightCm ? Number(updated.maxHeightCm) : null,
        baseFee: Number(updated.baseFee),
        perKgFee: updated.perKgFee ? Number(updated.perKgFee) : null,
        remoteSurcharge: updated.remoteSurcharge ? Number(updated.remoteSurcharge) : null,
        fuelSurcharge: updated.fuelSurcharge ? Number(updated.fuelSurcharge) : null,
        handlingFee: updated.handlingFee ? Number(updated.handlingFee) : null,
        currency: updated.currency,
        etaMinDays: updated.etaMinDays,
        etaMaxDays: updated.etaMaxDays,
        isActive: updated.isActive,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  })
);

router.delete(
  "/me/rate-cards/:id",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);
    const id = String(req.params.id || "").trim();

    const existing = await prisma.shippingRateCard.findFirst({
      where: { id, supplierId: supplier.id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Rate card not found." });
    }

    await prisma.shippingRateCard.delete({
      where: { id },
    });

    return res.json({ ok: true });
  })
);

export default router;