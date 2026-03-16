// api/src/routes/adminShipping.ts
import { Router } from "express";
import { z } from "zod";
import { Prisma, DeliveryServiceLevel, ShippingParcelClass, SupplierFulfillmentMode, SupplierShippingProfileMode } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, requireSuperAdmin);

const dec = (v: unknown) => new Prisma.Decimal(Number(v ?? 0));

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const bool = (v: unknown, d = false) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(s)) return true;
    if (["false", "0", "no", "n", "off"].includes(s)) return false;
  }
  return d;
};

function assertWeightBand(minWeightGrams: number, maxWeightGrams?: number | null) {
  if (minWeightGrams < 0) {
    throw new Error("minWeightGrams must be 0 or greater.");
  }
  if (maxWeightGrams != null && maxWeightGrams <= minWeightGrams) {
    throw new Error("maxWeightGrams must be greater than minWeightGrams.");
  }
}

function normalizeNullableString(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function asJsonArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
}

async function assertZoneExistsById(zoneId: string) {
  const zone = await prisma.shippingZone.findUnique({
    where: { id: zoneId },
    select: { id: true },
  });
  if (!zone) throw new Error("Zone not found.");
}

async function assertZoneExistsByCode(code: string) {
  const zone = await prisma.shippingZone.findUnique({
    where: { code },
    select: { code: true },
  });
  if (!zone) throw new Error(`Zone code ${code} not found.`);
}

async function assertNoOverlappingPlatformZoneRate(args: {
  excludeId?: string;
  zoneId: string;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  minWeightGrams: number;
  maxWeightGrams?: number | null;
}) {
  const rows = await prisma.shippingRateCard.findMany({
    where: {
      supplierId: null,
      zoneId: args.zoneId,
      serviceLevel: args.serviceLevel,
      parcelClass: args.parcelClass,
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
    },
    select: {
      id: true,
      minWeightGrams: true,
      maxWeightGrams: true,
    },
  });

  const aMin = args.minWeightGrams;
  const aMax = args.maxWeightGrams ?? Number.POSITIVE_INFINITY;

  for (const r of rows) {
    const bMin = Number(r.minWeightGrams ?? 0);
    const bMax = r.maxWeightGrams == null ? Number.POSITIVE_INFINITY : Number(r.maxWeightGrams);

    const overlaps = aMin < bMax && bMin < aMax;
    if (overlaps) {
      throw new Error("Overlapping platform zone rate weight band exists.");
    }
  }
}

async function assertNoOverlappingRouteRate(args: {
  excludeId?: string;
  originZoneCode: string;
  destinationZoneCode: string;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  minWeightGrams: number;
  maxWeightGrams?: number | null;
}) {
  const rows = await prisma.shippingRouteRateCard.findMany({
    where: {
      originZoneCode: args.originZoneCode,
      destinationZoneCode: args.destinationZoneCode,
      serviceLevel: args.serviceLevel,
      parcelClass: args.parcelClass,
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
    },
    select: {
      id: true,
      minWeightGrams: true,
      maxWeightGrams: true,
    },
  });

  const aMin = args.minWeightGrams;
  const aMax = args.maxWeightGrams ?? Number.POSITIVE_INFINITY;

  for (const r of rows) {
    const bMin = Number(r.minWeightGrams ?? 0);
    const bMax = r.maxWeightGrams == null ? Number.POSITIVE_INFINITY : Number(r.maxWeightGrams);

    const overlaps = aMin < bMax && bMin < aMax;
    if (overlaps) {
      throw new Error("Overlapping route rate weight band exists.");
    }
  }
}

/* ----------------------------- Schemas ----------------------------- */

const ZoneSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  country: z.string().min(1).default("Nigeria"),
  statesJson: z.array(z.string()).default([]),
  lgasJson: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

const PlatformRateSchema = z.object({
  zoneId: z.string().min(1),
  serviceLevel: z.nativeEnum(DeliveryServiceLevel),
  parcelClass: z.nativeEnum(ShippingParcelClass),
  minWeightGrams: z.number().int().min(0),
  maxWeightGrams: z.number().int().positive().nullable().optional(),
  volumetricDivisor: z.number().int().positive().nullable().optional(),
  maxLengthCm: z.number().nullable().optional(),
  maxWidthCm: z.number().nullable().optional(),
  maxHeightCm: z.number().nullable().optional(),
  baseFee: z.number().min(0),
  perKgFee: z.number().min(0).nullable().optional(),
  remoteSurcharge: z.number().min(0).nullable().optional(),
  fuelSurcharge: z.number().min(0).nullable().optional(),
  handlingFee: z.number().min(0).nullable().optional(),
  currency: z.string().min(1).default("NGN"),
  etaMinDays: z.number().int().min(0).nullable().optional(),
  etaMaxDays: z.number().int().min(0).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

const RouteRateSchema = z.object({
  originZoneCode: z.string().min(1),
  destinationZoneCode: z.string().min(1),
  serviceLevel: z.nativeEnum(DeliveryServiceLevel),
  parcelClass: z.nativeEnum(ShippingParcelClass),
  minWeightGrams: z.number().int().min(0),
  maxWeightGrams: z.number().int().positive().nullable().optional(),
  baseFee: z.number().min(0),
  perKgFee: z.number().min(0).nullable().optional(),
  remoteSurcharge: z.number().min(0).nullable().optional(),
  fuelSurcharge: z.number().min(0).nullable().optional(),
  handlingFee: z.number().min(0).nullable().optional(),
  etaMinDays: z.number().int().min(0).nullable().optional(),
  etaMaxDays: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().default(true),
});

const SupplierProfileSchema = z.object({
  shippingProfileMode: z.nativeEnum(SupplierShippingProfileMode),
  defaultServiceLevel: z.nativeEnum(DeliveryServiceLevel).nullable().optional(),
  originZoneCode: z.string().nullable().optional(),
  fulfillmentMode: z.nativeEnum(SupplierFulfillmentMode).nullable().optional(),
  preferredCarrier: z.string().nullable().optional(),
  localFlatFee: z.number().min(0).nullable().optional(),
  nearbyFlatFee: z.number().min(0).nullable().optional(),
  nationwideBaseFee: z.number().min(0).nullable().optional(),
  defaultHandlingFee: z.number().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});

/* ----------------------------- Zones ----------------------------- */

router.get("/zones", async (_req, res) => {
  try {
    const rows = await prisma.shippingZone.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return res.json({ data: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch zones" });
  }
});

router.post("/zones", async (req, res) => {
  try {
    const body = ZoneSchema.parse(req.body);

    const row = await prisma.shippingZone.create({
      data: {
        code: body.code.trim(),
        name: body.name.trim(),
        country: body.country.trim(),
        statesJson: body.statesJson,
        lgasJson: body.lgasJson,
        priority: body.priority,
        isActive: body.isActive,
      },
    });

    return res.status(201).json({ data: row });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to create zone" });
  }
});

router.patch("/zones/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = ZoneSchema.partial().parse(req.body);

    const row = await prisma.shippingZone.update({
      where: { id },
      data: {
        ...(body.code != null ? { code: body.code.trim() } : {}),
        ...(body.name != null ? { name: body.name.trim() } : {}),
        ...(body.country != null ? { country: body.country.trim() } : {}),
        ...(body.statesJson != null ? { statesJson: body.statesJson } : {}),
        ...(body.lgasJson != null ? { lgasJson: body.lgasJson } : {}),
        ...(body.priority != null ? { priority: body.priority } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {}),
      },
    });

    return res.json({ data: row });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to update zone" });
  }
});

router.delete("/zones/:id", async (req, res) => {
  try {
    const id = String(req.params.id);

    const linkedPlatformRates = await prisma.shippingRateCard.count({
      where: { zoneId: id },
    });

    if (linkedPlatformRates > 0) {
      return res.status(400).json({
        error: "Cannot delete zone because shipping rate cards still reference it.",
      });
    }

    await prisma.shippingZone.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to delete zone" });
  }
});

/* ----------------------------- Platform zone rates ----------------------------- */

router.get("/platform-rates", async (_req, res) => {
  try {
    const rows = await prisma.shippingRateCard.findMany({
      where: { supplierId: null },
      orderBy: [
        { zone: { priority: "asc" } },
        { serviceLevel: "asc" },
        { parcelClass: "asc" },
        { minWeightGrams: "asc" },
      ],
      include: {
        zone: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return res.json({ data: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch platform rates" });
  }
});

router.post("/platform-rates", async (req, res) => {
  try {
    const body = PlatformRateSchema.parse(req.body);

    assertWeightBand(body.minWeightGrams, body.maxWeightGrams ?? null);
    await assertZoneExistsById(body.zoneId);
    await assertNoOverlappingPlatformZoneRate({
      zoneId: body.zoneId,
      serviceLevel: body.serviceLevel,
      parcelClass: body.parcelClass,
      minWeightGrams: body.minWeightGrams,
      maxWeightGrams: body.maxWeightGrams ?? null,
    });

    const row = await prisma.shippingRateCard.create({
      data: {
        supplierId: null,
        zoneId: body.zoneId,
        serviceLevel: body.serviceLevel,
        parcelClass: body.parcelClass,
        minWeightGrams: body.minWeightGrams,
        maxWeightGrams: body.maxWeightGrams ?? null,
        volumetricDivisor: body.volumetricDivisor ?? null,
        maxLengthCm: body.maxLengthCm != null ? dec(body.maxLengthCm) : null,
        maxWidthCm: body.maxWidthCm != null ? dec(body.maxWidthCm) : null,
        maxHeightCm: body.maxHeightCm != null ? dec(body.maxHeightCm) : null,
        baseFee: dec(body.baseFee),
        perKgFee: body.perKgFee != null ? dec(body.perKgFee) : null,
        remoteSurcharge: body.remoteSurcharge != null ? dec(body.remoteSurcharge) : null,
        fuelSurcharge: body.fuelSurcharge != null ? dec(body.fuelSurcharge) : null,
        handlingFee: body.handlingFee != null ? dec(body.handlingFee) : null,
        currency: body.currency,
        etaMinDays: body.etaMinDays ?? null,
        etaMaxDays: body.etaMaxDays ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        isActive: body.isActive,
      },
      include: {
        zone: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return res.status(201).json({ data: row });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to create platform rate" });
  }
});

router.patch("/platform-rates/:id", async (req, res) => {
  try {
    const id = String(req.params.id);

    const existing = await prisma.shippingRateCard.findUnique({
      where: { id },
      select: {
        id: true,
        zoneId: true,
        serviceLevel: true,
        parcelClass: true,
        minWeightGrams: true,
        maxWeightGrams: true,
      },
    });
    if (!existing) return res.status(404).json({ error: "Rate not found" });

    const body = PlatformRateSchema.partial().parse(req.body);

    const zoneId = body.zoneId ?? existing.zoneId;
    const serviceLevel = body.serviceLevel ?? existing.serviceLevel;
    const parcelClass = body.parcelClass ?? existing.parcelClass;
    const minWeightGrams = body.minWeightGrams ?? existing.minWeightGrams;
    const maxWeightGrams =
      body.maxWeightGrams !== undefined ? body.maxWeightGrams : existing.maxWeightGrams;

    assertWeightBand(minWeightGrams, maxWeightGrams ?? null);
    await assertZoneExistsById(zoneId);
    await assertNoOverlappingPlatformZoneRate({
      excludeId: id,
      zoneId,
      serviceLevel,
      parcelClass,
      minWeightGrams,
      maxWeightGrams: maxWeightGrams ?? null,
    });

    const row = await prisma.shippingRateCard.update({
      where: { id },
      data: {
        ...(body.zoneId != null ? { zoneId: body.zoneId } : {}),
        ...(body.serviceLevel != null ? { serviceLevel: body.serviceLevel } : {}),
        ...(body.parcelClass != null ? { parcelClass: body.parcelClass } : {}),
        ...(body.minWeightGrams != null ? { minWeightGrams: body.minWeightGrams } : {}),
        ...(body.maxWeightGrams !== undefined ? { maxWeightGrams: body.maxWeightGrams ?? null } : {}),
        ...(body.volumetricDivisor !== undefined ? { volumetricDivisor: body.volumetricDivisor ?? null } : {}),
        ...(body.maxLengthCm !== undefined ? { maxLengthCm: body.maxLengthCm != null ? dec(body.maxLengthCm) : null } : {}),
        ...(body.maxWidthCm !== undefined ? { maxWidthCm: body.maxWidthCm != null ? dec(body.maxWidthCm) : null } : {}),
        ...(body.maxHeightCm !== undefined ? { maxHeightCm: body.maxHeightCm != null ? dec(body.maxHeightCm) : null } : {}),
        ...(body.baseFee != null ? { baseFee: dec(body.baseFee) } : {}),
        ...(body.perKgFee !== undefined ? { perKgFee: body.perKgFee != null ? dec(body.perKgFee) : null } : {}),
        ...(body.remoteSurcharge !== undefined ? { remoteSurcharge: body.remoteSurcharge != null ? dec(body.remoteSurcharge) : null } : {}),
        ...(body.fuelSurcharge !== undefined ? { fuelSurcharge: body.fuelSurcharge != null ? dec(body.fuelSurcharge) : null } : {}),
        ...(body.handlingFee !== undefined ? { handlingFee: body.handlingFee != null ? dec(body.handlingFee) : null } : {}),
        ...(body.currency != null ? { currency: body.currency } : {}),
        ...(body.etaMinDays !== undefined ? { etaMinDays: body.etaMinDays ?? null } : {}),
        ...(body.etaMaxDays !== undefined ? { etaMaxDays: body.etaMaxDays ?? null } : {}),
        ...(body.startsAt !== undefined ? { startsAt: body.startsAt ? new Date(body.startsAt) : null } : {}),
        ...(body.endsAt !== undefined ? { endsAt: body.endsAt ? new Date(body.endsAt) : null } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {}),
      },
      include: {
        zone: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return res.json({ data: row });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to update platform rate" });
  }
});

router.delete("/platform-rates/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.shippingRateCard.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to delete platform rate" });
  }
});

/* ----------------------------- Route rates ----------------------------- */

router.get("/route-rates", async (_req, res) => {
  try {
    const rows = await prisma.shippingRouteRateCard.findMany({
      orderBy: [
        { originZoneCode: "asc" },
        { destinationZoneCode: "asc" },
        { serviceLevel: "asc" },
        { parcelClass: "asc" },
        { minWeightGrams: "asc" },
      ],
    });

    return res.json({ data: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch route rates" });
  }
});

router.post("/route-rates", async (req, res) => {
  try {
    const body = RouteRateSchema.parse(req.body);

    assertWeightBand(body.minWeightGrams, body.maxWeightGrams ?? null);
    await assertZoneExistsByCode(body.originZoneCode);
    await assertZoneExistsByCode(body.destinationZoneCode);

    await assertNoOverlappingRouteRate({
      originZoneCode: body.originZoneCode,
      destinationZoneCode: body.destinationZoneCode,
      serviceLevel: body.serviceLevel,
      parcelClass: body.parcelClass,
      minWeightGrams: body.minWeightGrams,
      maxWeightGrams: body.maxWeightGrams ?? null,
    });

    const row = await prisma.shippingRouteRateCard.create({
      data: {
        originZoneCode: body.originZoneCode,
        destinationZoneCode: body.destinationZoneCode,
        serviceLevel: body.serviceLevel,
        parcelClass: body.parcelClass,
        minWeightGrams: body.minWeightGrams,
        maxWeightGrams: body.maxWeightGrams ?? null,
        baseFee: dec(body.baseFee),
        perKgFee: body.perKgFee != null ? dec(body.perKgFee) : null,
        remoteSurcharge: body.remoteSurcharge != null ? dec(body.remoteSurcharge) : null,
        fuelSurcharge: body.fuelSurcharge != null ? dec(body.fuelSurcharge) : null,
        handlingFee: body.handlingFee != null ? dec(body.handlingFee) : null,
        etaMinDays: body.etaMinDays ?? null,
        etaMaxDays: body.etaMaxDays ?? null,
        isActive: body.isActive,
      },
    });

    return res.status(201).json({ data: row });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to create route rate" });
  }
});

router.patch("/route-rates/:id", async (req, res) => {
  try {
    const id = String(req.params.id);

    const existing = await prisma.shippingRouteRateCard.findUnique({
      where: { id },
      select: {
        id: true,
        originZoneCode: true,
        destinationZoneCode: true,
        serviceLevel: true,
        parcelClass: true,
        minWeightGrams: true,
        maxWeightGrams: true,
      },
    });
    if (!existing) return res.status(404).json({ error: "Route rate not found" });

    const body = RouteRateSchema.partial().parse(req.body);

    const originZoneCode = body.originZoneCode ?? existing.originZoneCode;
    const destinationZoneCode = body.destinationZoneCode ?? existing.destinationZoneCode;
    const serviceLevel = body.serviceLevel ?? existing.serviceLevel;
    const parcelClass = body.parcelClass ?? existing.parcelClass;
    const minWeightGrams = body.minWeightGrams ?? existing.minWeightGrams;
    const maxWeightGrams =
      body.maxWeightGrams !== undefined ? body.maxWeightGrams : existing.maxWeightGrams;

    assertWeightBand(minWeightGrams, maxWeightGrams ?? null);
    await assertZoneExistsByCode(originZoneCode);
    await assertZoneExistsByCode(destinationZoneCode);
    await assertNoOverlappingRouteRate({
      excludeId: id,
      originZoneCode,
      destinationZoneCode,
      serviceLevel,
      parcelClass,
      minWeightGrams,
      maxWeightGrams: maxWeightGrams ?? null,
    });

    const row = await prisma.shippingRouteRateCard.update({
      where: { id },
      data: {
        ...(body.originZoneCode != null ? { originZoneCode: body.originZoneCode } : {}),
        ...(body.destinationZoneCode != null ? { destinationZoneCode: body.destinationZoneCode } : {}),
        ...(body.serviceLevel != null ? { serviceLevel: body.serviceLevel } : {}),
        ...(body.parcelClass != null ? { parcelClass: body.parcelClass } : {}),
        ...(body.minWeightGrams != null ? { minWeightGrams: body.minWeightGrams } : {}),
        ...(body.maxWeightGrams !== undefined ? { maxWeightGrams: body.maxWeightGrams ?? null } : {}),
        ...(body.baseFee != null ? { baseFee: dec(body.baseFee) } : {}),
        ...(body.perKgFee !== undefined ? { perKgFee: body.perKgFee != null ? dec(body.perKgFee) : null } : {}),
        ...(body.remoteSurcharge !== undefined ? { remoteSurcharge: body.remoteSurcharge != null ? dec(body.remoteSurcharge) : null } : {}),
        ...(body.fuelSurcharge !== undefined ? { fuelSurcharge: body.fuelSurcharge != null ? dec(body.fuelSurcharge) : null } : {}),
        ...(body.handlingFee !== undefined ? { handlingFee: body.handlingFee != null ? dec(body.handlingFee) : null } : {}),
        ...(body.etaMinDays !== undefined ? { etaMinDays: body.etaMinDays ?? null } : {}),
        ...(body.etaMaxDays !== undefined ? { etaMaxDays: body.etaMaxDays ?? null } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {}),
      },
    });

    return res.json({ data: row });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to update route rate" });
  }
});

router.delete("/route-rates/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.shippingRouteRateCard.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to delete route rate" });
  }
});

/* ----------------------------- Supplier profiles ----------------------------- */

router.get("/supplier-profiles", async (_req, res) => {
  try {
    const rows = await prisma.supplier.findMany({
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        shippingProfileMode: true,
        defaultServiceLevel: true,
        handlingFee: true,
        shippingProfile: true,
      },
    });

    return res.json({ data: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch supplier profiles" });
  }
});

router.patch("/suppliers/:supplierId/profile", async (req, res) => {
  try {
    const supplierId = String(req.params.supplierId);
    const body = SupplierProfileSchema.parse(req.body);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, shippingProfile: { select: { id: true } } },
    });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });

    if (body.originZoneCode) {
      await assertZoneExistsByCode(body.originZoneCode);
    }

    await prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          shippingProfileMode: body.shippingProfileMode,
          ...(body.defaultServiceLevel !== undefined
            ? { defaultServiceLevel: body.defaultServiceLevel }
            : {}),
        },
      });

      const shouldWriteProfile =
        body.originZoneCode !== undefined ||
        body.fulfillmentMode !== undefined ||
        body.preferredCarrier !== undefined ||
        body.localFlatFee !== undefined ||
        body.nearbyFlatFee !== undefined ||
        body.nationwideBaseFee !== undefined ||
        body.defaultHandlingFee !== undefined ||
        body.isActive !== undefined;

      if (shouldWriteProfile) {
        if (supplier.shippingProfile?.id) {
          await tx.supplierShippingProfile.update({
            where: { supplierId },
            data: {
              ...(body.originZoneCode !== undefined ? { originZoneCode: normalizeNullableString(body.originZoneCode) } : {}),
              ...(body.fulfillmentMode !== undefined ? { fulfillmentMode: body.fulfillmentMode ?? SupplierFulfillmentMode.SUPPLIER_SELF_SHIP } : {}),
              ...(body.preferredCarrier !== undefined ? { preferredCarrier: normalizeNullableString(body.preferredCarrier) } : {}),
              ...(body.localFlatFee !== undefined ? { localFlatFee: body.localFlatFee != null ? dec(body.localFlatFee) : null } : {}),
              ...(body.nearbyFlatFee !== undefined ? { nearbyFlatFee: body.nearbyFlatFee != null ? dec(body.nearbyFlatFee) : null } : {}),
              ...(body.nationwideBaseFee !== undefined ? { nationwideBaseFee: body.nationwideBaseFee != null ? dec(body.nationwideBaseFee) : null } : {}),
              ...(body.defaultHandlingFee !== undefined ? { defaultHandlingFee: body.defaultHandlingFee != null ? dec(body.defaultHandlingFee) : null } : {}),
              ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            },
          });
        } else {
          await tx.supplierShippingProfile.create({
            data: {
              supplierId,
              originZoneCode: normalizeNullableString(body.originZoneCode),
              fulfillmentMode: body.fulfillmentMode ?? SupplierFulfillmentMode.SUPPLIER_SELF_SHIP,
              preferredCarrier: normalizeNullableString(body.preferredCarrier),
              localFlatFee: body.localFlatFee != null ? dec(body.localFlatFee) : null,
              nearbyFlatFee: body.nearbyFlatFee != null ? dec(body.nearbyFlatFee) : null,
              nationwideBaseFee: body.nationwideBaseFee != null ? dec(body.nationwideBaseFee) : null,
              defaultHandlingFee: body.defaultHandlingFee != null ? dec(body.defaultHandlingFee) : null,
              isActive: body.isActive ?? true,
            },
          });
        }
      }
    });

    const updated = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        status: true,
        shippingProfileMode: true,
        defaultServiceLevel: true,
        handlingFee: true,
        shippingProfile: true,
      },
    });

    return res.json({ data: updated });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to update supplier profile" });
  }
});

export default router;