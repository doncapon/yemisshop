import {
  PrismaClient,
  DeliveryServiceLevel,
  ShippingParcelClass,
} from "@prisma/client";

const prisma = new PrismaClient();

type ZoneSeed = {
  code: string;
  name: string;
  states: string[];
  lgas?: string[];
  priority: number;
};

type PlatformRateSeed = {
  zoneCode: string;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  minWeightGrams: number;
  maxWeightGrams?: number | null;
  baseFee: number;
  perKgFee?: number | null;
  remoteSurcharge?: number | null;
  fuelSurcharge?: number | null;
  handlingFee?: number | null;
  etaMinDays?: number | null;
  etaMaxDays?: number | null;
};

type RouteRateSeed = {
  originZoneCode: string;
  destinationZoneCode: string;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  minWeightGrams: number;
  maxWeightGrams?: number | null;
  baseFee: number;
  perKgFee?: number | null;
  remoteSurcharge?: number | null;
  fuelSurcharge?: number | null;
  handlingFee?: number | null;
  etaMinDays?: number | null;
  etaMaxDays?: number | null;
};

const ZONES: ZoneSeed[] = [
  {
    code: "LAGOS_LOCAL",
    name: "Lagos (Local)",
    states: ["Lagos"],
    priority: 1,
  },
  {
    code: "SW_NEAR",
    name: "South West (Near Lagos)",
    states: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"],
    priority: 2,
  },
  {
    code: "SOUTH_SOUTH",
    name: "South South",
    states: ["Rivers", "Akwa Ibom", "Cross River", "Bayelsa", "Delta", "Edo"],
    priority: 3,
  },
  {
    code: "SE",
    name: "South East",
    states: ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
    priority: 4,
  },
  {
    code: "NC",
    name: "North Central",
    states: ["FCT", "Abuja", "Kogi", "Kwara", "Nasarawa", "Niger", "Benue", "Plateau"],
    priority: 5,
  },
  {
    code: "NORTH_FAR",
    name: "North (Far)",
    states: [
      "Kaduna",
      "Kano",
      "Katsina",
      "Jigawa",
      "Sokoto",
      "Kebbi",
      "Zamfara",
      "Bauchi",
      "Gombe",
      "Yobe",
      "Borno",
      "Adamawa",
      "Taraba",
    ],
    priority: 6,
  },
];

const SERVICE_LEVEL: DeliveryServiceLevel = DeliveryServiceLevel.STANDARD;

const WEIGHT_BANDS = [
  { minWeightGrams: 0, maxWeightGrams: 1000, band: "LIGHT" as const },
  { minWeightGrams: 1000, maxWeightGrams: 5000, band: "MEDIUM" as const },
  { minWeightGrams: 5000, maxWeightGrams: null, band: "HEAVY" as const },
];

const PARCEL_CLASSES: ShippingParcelClass[] = [
  ShippingParcelClass.STANDARD,
  ShippingParcelClass.FRAGILE,
  ShippingParcelClass.BULKY,
];

const zoneByCode = new Map(ZONES.map((z) => [z.code, z]));
const zonePriorityByCode = new Map(ZONES.map((z) => [z.code, z.priority]));

/* -------------------------------------------------------------------------- */
/*                                   helpers                                  */
/* -------------------------------------------------------------------------- */

function priorityOf(zoneCode: string): number {
  return zonePriorityByCode.get(zoneCode) ?? 999;
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function classMultiplier(parcelClass: ShippingParcelClass): number {
  switch (parcelClass) {
    case ShippingParcelClass.FRAGILE:
      return 1.18;
    case ShippingParcelClass.BULKY:
      return 1.32;
    default:
      return 1;
  }
}

function classHandlingFee(parcelClass: ShippingParcelClass, band: "LIGHT" | "MEDIUM" | "HEAVY"): number {
  if (parcelClass === ShippingParcelClass.FRAGILE) {
    if (band === "LIGHT") return 300;
    if (band === "MEDIUM") return 450;
    return 650;
  }

  if (parcelClass === ShippingParcelClass.BULKY) {
    if (band === "LIGHT") return 500;
    if (band === "MEDIUM") return 700;
    return 950;
  }

  if (band === "HEAVY") return 180;
  return 0;
}

function bandPerKgFee(band: "LIGHT" | "MEDIUM" | "HEAVY"): number | null {
  if (band === "LIGHT") return null;
  if (band === "MEDIUM") return 1;
  return 1;
}

function zoneBaseFee(destinationZoneCode: string, band: "LIGHT" | "MEDIUM" | "HEAVY"): number {
  const p = priorityOf(destinationZoneCode);

  // base by destination zone and band
  // tuned to stay close to the pricing direction you already started with
  if (band === "LIGHT") return 1800 + (p - 1) * 700;
  if (band === "MEDIUM") return 2200 + (p - 1) * 850;
  return 3000 + (p - 1) * 1000;
}

function zonePerKgFee(destinationZoneCode: string, band: "LIGHT" | "MEDIUM" | "HEAVY"): number | null {
  const p = priorityOf(destinationZoneCode);

  if (band === "LIGHT") return null;
  if (band === "MEDIUM") return 250 + (p - 1) * 55;
  return 350 + (p - 1) * 70;
}

function zoneFuelSurcharge(destinationZoneCode: string, band: "LIGHT" | "MEDIUM" | "HEAVY"): number {
  const p = priorityOf(destinationZoneCode);

  if (band === "LIGHT") return 150 + (p - 1) * 40;
  if (band === "MEDIUM") return 180 + (p - 1) * 40;
  return 220 + (p - 1) * 45;
}

function zoneRemoteSurcharge(destinationZoneCode: string, band: "LIGHT" | "MEDIUM" | "HEAVY"): number {
  const p = priorityOf(destinationZoneCode);
  if (p <= 2) return 0;
  if (band === "LIGHT") return 120 + (p - 3) * 70;
  if (band === "MEDIUM") return 160 + (p - 3) * 80;
  return 220 + (p - 3) * 95;
}

function zoneEta(destinationZoneCode: string, band: "LIGHT" | "MEDIUM" | "HEAVY") {
  const p = priorityOf(destinationZoneCode);
  const baseMin = p === 1 ? 1 : p <= 2 ? 2 : p <= 4 ? 3 : 4;
  const baseMax = p === 1 ? 2 : p <= 2 ? 4 : p <= 4 ? 6 : 8;

  if (band === "HEAVY") {
    return { etaMinDays: baseMin + 1, etaMaxDays: baseMax + 2 };
  }

  return { etaMinDays: baseMin, etaMaxDays: baseMax };
}

function buildPlatformRate(
  zoneCode: string,
  parcelClass: ShippingParcelClass,
  band: (typeof WEIGHT_BANDS)[number]
): PlatformRateSeed {
  const base = zoneBaseFee(zoneCode, band.band);
  const perKg = zonePerKgFee(zoneCode, band.band);
  const fuel = zoneFuelSurcharge(zoneCode, band.band);
  const remote = zoneRemoteSurcharge(zoneCode, band.band);
  const handling = classHandlingFee(parcelClass, band.band);
  const mult = classMultiplier(parcelClass);
  const eta = zoneEta(zoneCode, band.band);

  return {
    zoneCode,
    serviceLevel: SERVICE_LEVEL,
    parcelClass,
    minWeightGrams: band.minWeightGrams,
    maxWeightGrams: band.maxWeightGrams,
    baseFee: roundMoney(base * mult),
    perKgFee: perKg == null ? null : roundMoney(perKg * mult),
    remoteSurcharge: remote > 0 ? roundMoney(remote * (parcelClass === ShippingParcelClass.BULKY ? 1.1 : 1)) : null,
    fuelSurcharge: roundMoney(fuel * (parcelClass === ShippingParcelClass.BULKY ? 1.08 : 1)),
    handlingFee: handling > 0 ? handling : null,
    etaMinDays: eta.etaMinDays,
    etaMaxDays: eta.etaMaxDays,
  };
}

function routeDistanceFactor(originZoneCode: string, destinationZoneCode: string): number {
  const originP = priorityOf(originZoneCode);
  const destP = priorityOf(destinationZoneCode);

  if (originZoneCode === destinationZoneCode) return 0.92;

  const gap = Math.abs(originP - destP);

  if (gap === 0) return 1.0;
  if (gap === 1) return 1.05;
  if (gap === 2) return 1.12;
  if (gap === 3) return 1.2;
  return 1.3;
}

function routeFuelExtra(originZoneCode: string, destinationZoneCode: string): number {
  if (originZoneCode === destinationZoneCode) return 0;

  const gap = Math.abs(priorityOf(originZoneCode) - priorityOf(destinationZoneCode));
  return gap * 20;
}

function routeRemoteExtra(originZoneCode: string, destinationZoneCode: string): number {
  const destP = priorityOf(destinationZoneCode);
  const gap = Math.abs(priorityOf(originZoneCode) - destP);

  if (destP <= 2) return 0;
  return gap >= 2 ? 80 + (gap - 2) * 40 : 0;
}

function routeEta(
  originZoneCode: string,
  destinationZoneCode: string,
  band: "LIGHT" | "MEDIUM" | "HEAVY"
) {
  const dest = zoneEta(destinationZoneCode, band);
  const gap = Math.abs(priorityOf(originZoneCode) - priorityOf(destinationZoneCode));

  return {
    etaMinDays: dest.etaMinDays + (gap >= 3 ? 1 : 0),
    etaMaxDays: dest.etaMaxDays + (gap >= 2 ? 1 : 0),
  };
}

function buildRouteRate(
  originZoneCode: string,
  destinationZoneCode: string,
  parcelClass: ShippingParcelClass,
  band: (typeof WEIGHT_BANDS)[number]
): RouteRateSeed {
  const platform = buildPlatformRate(destinationZoneCode, parcelClass, band);
  const factor = routeDistanceFactor(originZoneCode, destinationZoneCode);
  const eta = routeEta(originZoneCode, destinationZoneCode, band.band);

  const baseFee = roundMoney(platform.baseFee * factor);
  const perKgFee =
    platform.perKgFee == null ? null : roundMoney(platform.perKgFee * factor);

  const fuelSurcharge = roundMoney((platform.fuelSurcharge ?? 0) + routeFuelExtra(originZoneCode, destinationZoneCode));
  const remoteBase = platform.remoteSurcharge ?? 0;
  const remoteSurcharge = roundMoney(remoteBase + routeRemoteExtra(originZoneCode, destinationZoneCode));

  return {
    originZoneCode,
    destinationZoneCode,
    serviceLevel: SERVICE_LEVEL,
    parcelClass,
    minWeightGrams: band.minWeightGrams,
    maxWeightGrams: band.maxWeightGrams,
    baseFee,
    perKgFee,
    remoteSurcharge: remoteSurcharge > 0 ? remoteSurcharge : null,
    fuelSurcharge,
    handlingFee: platform.handlingFee ?? null,
    etaMinDays: eta.etaMinDays,
    etaMaxDays: eta.etaMaxDays,
  };
}

/* -------------------------------------------------------------------------- */
/*                           generate full coverage                           */
/* -------------------------------------------------------------------------- */

const PLATFORM_ZONE_RATES: PlatformRateSeed[] = ZONES.flatMap((zone) =>
  PARCEL_CLASSES.flatMap((parcelClass) =>
    WEIGHT_BANDS.map((band) => buildPlatformRate(zone.code, parcelClass, band))
  )
);

const ROUTE_RATES: RouteRateSeed[] = ZONES.flatMap((origin) =>
  ZONES.flatMap((destination) =>
    PARCEL_CLASSES.flatMap((parcelClass) =>
      WEIGHT_BANDS.map((band) =>
        buildRouteRate(origin.code, destination.code, parcelClass, band)
      )
    )
  )
);

/* -------------------------------------------------------------------------- */
/*                                  seed ops                                  */
/* -------------------------------------------------------------------------- */

async function upsertZones() {
  for (const z of ZONES) {
    await prisma.shippingZone.upsert({
      where: { code: z.code },
      update: {
        name: z.name,
        country: "Nigeria",
        statesJson: z.states,
        lgasJson: z.lgas ?? [],
        isActive: true,
        priority: z.priority,
      },
      create: {
        code: z.code,
        name: z.name,
        country: "Nigeria",
        statesJson: z.states,
        lgasJson: z.lgas ?? [],
        isActive: true,
        priority: z.priority,
      },
    });
  }
}

async function replacePlatformZoneRates() {
  await prisma.shippingRateCard.deleteMany({
    where: { supplierId: null },
  });

  const zones = await prisma.shippingZone.findMany({
    select: { id: true, code: true },
  });
  const zoneIdByCode = new Map(zones.map((z) => [z.code, z.id]));

  for (const r of PLATFORM_ZONE_RATES) {
    const zoneId = zoneIdByCode.get(r.zoneCode);
    if (!zoneId) {
      throw new Error(`Missing shipping zone for code ${r.zoneCode}`);
    }

    await prisma.shippingRateCard.create({
      data: {
        supplierId: null,
        zoneId,
        serviceLevel: r.serviceLevel,
        parcelClass: r.parcelClass,
        minWeightGrams: r.minWeightGrams,
        maxWeightGrams: r.maxWeightGrams ?? null,
        baseFee: r.baseFee,
        perKgFee: r.perKgFee ?? null,
        remoteSurcharge: r.remoteSurcharge ?? null,
        fuelSurcharge: r.fuelSurcharge ?? null,
        handlingFee: r.handlingFee ?? null,
        currency: "NGN",
        etaMinDays: r.etaMinDays ?? null,
        etaMaxDays: r.etaMaxDays ?? null,
        isActive: true,
      },
    });
  }
}

async function replaceRouteRates() {
  await prisma.shippingRouteRateCard.deleteMany({});

  for (const r of ROUTE_RATES) {
    await prisma.shippingRouteRateCard.create({
      data: {
        originZoneCode: r.originZoneCode,
        destinationZoneCode: r.destinationZoneCode,
        serviceLevel: r.serviceLevel,
        parcelClass: r.parcelClass,
        minWeightGrams: r.minWeightGrams,
        maxWeightGrams: r.maxWeightGrams ?? null,
        baseFee: r.baseFee,
        perKgFee: r.perKgFee ?? null,
        remoteSurcharge: r.remoteSurcharge ?? null,
        fuelSurcharge: r.fuelSurcharge ?? null,
        handlingFee: r.handlingFee ?? null,
        etaMinDays: r.etaMinDays ?? null,
        etaMaxDays: r.etaMaxDays ?? null,
        isActive: true,
      },
    });
  }
}

async function main() {
  await upsertZones();
  await replacePlatformZoneRates();
  await replaceRouteRates();

  console.log(
    `✅ seed-shipping completed: ${ZONES.length} zones, ${PLATFORM_ZONE_RATES.length} platform cards, ${ROUTE_RATES.length} route cards`
  );
}

main()
  .catch((e) => {
    console.error("❌ seed-shipping failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });