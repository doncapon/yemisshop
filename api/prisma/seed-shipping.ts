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
  priority?: number;
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

const PLATFORM_ZONE_RATES: PlatformRateSeed[] = [
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 1800,
    perKgFee: null,
    fuelSurcharge: 150,
    etaMinDays: 1,
    etaMaxDays: 2,
  },
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 2200,
    perKgFee: 250,
    fuelSurcharge: 180,
    etaMinDays: 1,
    etaMaxDays: 2,
  },
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 5000,
    maxWeightGrams: null,
    baseFee: 3000,
    perKgFee: 350,
    fuelSurcharge: 220,
    etaMinDays: 1,
    etaMaxDays: 3,
  },
  {
    zoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 2600,
    perKgFee: null,
    fuelSurcharge: 180,
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    zoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 3000,
    perKgFee: 300,
    fuelSurcharge: 220,
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    zoneCode: "SOUTH_SOUTH",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 3800,
    perKgFee: null,
    fuelSurcharge: 250,
    remoteSurcharge: 250,
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    zoneCode: "SOUTH_SOUTH",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 4300,
    perKgFee: 420,
    fuelSurcharge: 280,
    remoteSurcharge: 250,
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    zoneCode: "SE",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 3600,
    perKgFee: null,
    fuelSurcharge: 230,
    etaMinDays: 3,
    etaMaxDays: 5,
  },
  {
    zoneCode: "SE",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 4100,
    perKgFee: 380,
    fuelSurcharge: 260,
    etaMinDays: 3,
    etaMaxDays: 5,
  },
  {
    zoneCode: "NC",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 4200,
    perKgFee: null,
    fuelSurcharge: 280,
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    zoneCode: "NC",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 4800,
    perKgFee: 450,
    fuelSurcharge: 300,
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    zoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 5200,
    perKgFee: null,
    fuelSurcharge: 350,
    remoteSurcharge: 400,
    etaMinDays: 4,
    etaMaxDays: 8,
  },
  {
    zoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 5900,
    perKgFee: 550,
    fuelSurcharge: 380,
    remoteSurcharge: 420,
    etaMinDays: 4,
    etaMaxDays: 8,
  },
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "FRAGILE",
    minWeightGrams: 0,
    maxWeightGrams: 5000,
    baseFee: 2400,
    perKgFee: 300,
    fuelSurcharge: 180,
    handlingFee: 300,
    etaMinDays: 1,
    etaMaxDays: 3,
  },
  {
    zoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "FRAGILE",
    minWeightGrams: 0,
    maxWeightGrams: 5000,
    baseFee: 3400,
    perKgFee: 400,
    fuelSurcharge: 240,
    handlingFee: 350,
    etaMinDays: 2,
    etaMaxDays: 5,
  },
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "BULKY",
    minWeightGrams: 0,
    maxWeightGrams: null,
    baseFee: 3500,
    perKgFee: 600,
    fuelSurcharge: 280,
    handlingFee: 650,
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    zoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "BULKY",
    minWeightGrams: 0,
    maxWeightGrams: null,
    baseFee: 7200,
    perKgFee: 850,
    fuelSurcharge: 450,
    remoteSurcharge: 450,
    handlingFee: 900,
    etaMinDays: 5,
    etaMaxDays: 10,
  },
];

const ROUTE_RATES: RouteRateSeed[] = [
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 1800,
    perKgFee: null,
    fuelSurcharge: 150,
    etaMinDays: 1,
    etaMaxDays: 2,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 2200,
    perKgFee: 250,
    fuelSurcharge: 180,
    etaMinDays: 1,
    etaMaxDays: 2,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 2600,
    fuelSurcharge: 180,
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 3000,
    perKgFee: 300,
    fuelSurcharge: 220,
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    originZoneCode: "SW_NEAR",
    destinationZoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 2500,
    fuelSurcharge: 180,
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "SOUTH_SOUTH",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 3800,
    fuelSurcharge: 250,
    remoteSurcharge: 250,
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "SOUTH_SOUTH",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 4300,
    perKgFee: 420,
    fuelSurcharge: 280,
    remoteSurcharge: 250,
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "SE",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 3600,
    fuelSurcharge: 230,
    etaMinDays: 3,
    etaMaxDays: 5,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "NC",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 4200,
    fuelSurcharge: 280,
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 5200,
    fuelSurcharge: 350,
    remoteSurcharge: 400,
    etaMinDays: 4,
    etaMaxDays: 8,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "BULKY",
    minWeightGrams: 0,
    maxWeightGrams: null,
    baseFee: 7200,
    perKgFee: 850,
    fuelSurcharge: 450,
    remoteSurcharge: 450,
    handlingFee: 900,
    etaMinDays: 5,
    etaMaxDays: 10,
  },
  {
    originZoneCode: "LAGOS_LOCAL",
    destinationZoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "FRAGILE",
    minWeightGrams: 0,
    maxWeightGrams: 5000,
    baseFee: 2400,
    perKgFee: 300,
    fuelSurcharge: 180,
    handlingFee: 300,
    etaMinDays: 1,
    etaMaxDays: 3,
  },
];

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
        priority: z.priority ?? 0,
      },
      create: {
        code: z.code,
        name: z.name,
        country: "Nigeria",
        statesJson: z.states,
        lgasJson: z.lgas ?? [],
        isActive: true,
        priority: z.priority ?? 0,
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

  console.log("✅ seed-shipping completed: zones + platform zone rates + route rates");
}

main()
  .catch((e) => {
    console.error("❌ seed-shipping failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });