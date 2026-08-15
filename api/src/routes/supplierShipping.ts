import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import {
  DeliveryServiceLevel,
  SupplierShippingProfileMode,
  SupplierShippingCoverage,
  Prisma,
} from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Handling fee is a supplier-set surcharge added on top of the live GIGL
// rate at checkout — capped so it can't be used to quietly pad margin onto
// customers under the guise of a "handling" charge.
const MAX_SUPPLIER_HANDLING_FEE_NGN = Number(process.env.MAX_SUPPLIER_HANDLING_FEE_NGN || 2000);

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

// Suppliers only ever quote/ship through GIGL (or a future platform-owned
// fleet) — shippingProfileMode, fulfillmentMode, flat fees and rate cards
// are admin/platform-controlled concepts, never supplier self-service. The
// schema/quote-engine paths for those still exist (dormant) for a possible
// future platform-priced rate-card system, but suppliers can't reach them.
const SupplierSettingsSchema = z.object({
  shippingEnabled: z.coerce.boolean(),
  shippingCoverage: z.nativeEnum(SupplierShippingCoverage),
  defaultLeadDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  handlingFee: z.coerce
    .number()
    .min(0)
    .max(
      MAX_SUPPLIER_HANDLING_FEE_NGN,
      `Handling fee can't exceed ₦${MAX_SUPPLIER_HANDLING_FEE_NGN.toLocaleString()}.`
    )
    .nullable()
    .optional(),
  defaultServiceLevel: z.nativeEnum(DeliveryServiceLevel).nullable().optional(),
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
          shippingCoverage: true,
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
        shippingCoverage: body.shippingCoverage,
        defaultLeadDays: body.defaultLeadDays ?? null,
        handlingFee: asMoney(body.handlingFee),
        defaultServiceLevel: body.defaultServiceLevel ?? null,
        shippingProfileMode: SupplierShippingProfileMode.DEFAULT_PLATFORM,
      },
      select: {
        id: true,
        shippingEnabled: true,
        shippingCoverage: true,
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

export default router;