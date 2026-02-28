import { PrismaClient, DeliveryServiceLevel, ShippingParcelClass } from "@prisma/client";

const prisma = new PrismaClient();

type ZoneSeed = {
  code: string;
  name: string;
  states: string[];
  priority?: number;
};

type RateSeed = {
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

const ZONES: ZoneSeed[] = [
  { code: "LAGOS_LOCAL", name: "Lagos (Local)", states: ["Lagos"], priority: 1 },
  { code: "SW_NEAR", name: "South West (Near Lagos)", states: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"], priority: 2 },
  { code: "SOUTH_SOUTH", name: "South South", states: ["Rivers", "Akwa Ibom", "Cross River", "Bayelsa", "Delta", "Edo"], priority: 3 },
  { code: "SE", name: "South East", states: ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"], priority: 4 },
  { code: "NC", name: "North Central", states: ["FCT", "Abuja", "Kogi", "Kwara", "Nasarawa", "Niger", "Benue", "Plateau"], priority: 5 },
  {
    code: "NORTH_FAR",
    name: "North (Far)",
    states: ["Kaduna", "Kano", "Katsina", "Jigawa", "Sokoto", "Kebbi", "Zamfara", "Bauchi", "Gombe", "Yobe", "Borno", "Adamawa", "Taraba"],
    priority: 6,
  },
];

/**
 * ✅ Reduced shipping pricing
 * - STANDARD: ~30–40% down
 * - EXPRESS: reduced but still premium
 * - FRAGILE/BULKY: reduced but premium
 */
const RATES: RateSeed[] = [
  // =========================
  // LAGOS_LOCAL - STANDARD
  // =========================
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 1500, // was 2500
    perKgFee: 0,
    fuelSurcharge: 120, // was 200
    etaMinDays: 1,
    etaMaxDays: 2,
  },
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 1750, // was 2800
    perKgFee: 220, // was 350
    fuelSurcharge: 140, // was 250
    etaMinDays: 1,
    etaMaxDays: 2,
  },
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 5000,
    maxWeightGrams: null,
    baseFee: 2500, // was 4200
    perKgFee: 320, // was 500
    fuelSurcharge: 160, // was 300
    etaMinDays: 1,
    etaMaxDays: 3,
  },

  // LAGOS_LOCAL - EXPRESS
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "EXPRESS",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 2300, // was 3500
    perKgFee: 0,
    fuelSurcharge: 180, // was 300
    etaMinDays: 0,
    etaMaxDays: 1,
  },
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "EXPRESS",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 2600, // was 4000
    perKgFee: 280, // was 450
    fuelSurcharge: 200, // was 350
    etaMinDays: 0,
    etaMaxDays: 1,
  },

  // =========================
  // SW_NEAR - STANDARD
  // =========================
  {
    zoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 2200, // was 3500
    perKgFee: 0,
    fuelSurcharge: 150, // was 250
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    zoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 2600, // was 4200
    perKgFee: 280, // was 450
    fuelSurcharge: 170, // was 300
    etaMinDays: 2,
    etaMaxDays: 4,
  },

  // =========================
  // SOUTH_SOUTH - STANDARD
  // =========================
  {
    zoneCode: "SOUTH_SOUTH",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 3200, // was 5000
    perKgFee: 0,
    fuelSurcharge: 220, // was 400
    remoteSurcharge: 180, // was 300
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    zoneCode: "SOUTH_SOUTH",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 3600, // was 5800
    perKgFee: 380, // was 600
    fuelSurcharge: 240, // was 450
    remoteSurcharge: 220, // was 400
    etaMinDays: 3,
    etaMaxDays: 6,
  },

  // =========================
  // SE - STANDARD
  // =========================
  {
    zoneCode: "SE",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 3000, // was 4800
    perKgFee: 0,
    fuelSurcharge: 190, // was 350
    etaMinDays: 3,
    etaMaxDays: 5,
  },
  {
    zoneCode: "SE",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 3400, // was 5600
    perKgFee: 350, // was 550
    fuelSurcharge: 210, // was 400
    etaMinDays: 3,
    etaMaxDays: 5,
  },

  // =========================
  // NC - STANDARD
  // =========================
  {
    zoneCode: "NC",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 3500, // was 5500
    perKgFee: 0,
    fuelSurcharge: 240, // was 450
    etaMinDays: 3,
    etaMaxDays: 6,
  },
  {
    zoneCode: "NC",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 4100, // was 6500
    perKgFee: 420, // was 650
    fuelSurcharge: 260, // was 500
    etaMinDays: 3,
    etaMaxDays: 6,
  },

  // =========================
  // NORTH_FAR - STANDARD
  // =========================
  {
    zoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: 1000,
    baseFee: 4200, // was 6500
    perKgFee: 0,
    fuelSurcharge: 280, // was 500
    remoteSurcharge: 280, // was 500
    etaMinDays: 4,
    etaMaxDays: 8,
  },
  {
    zoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 1000,
    maxWeightGrams: 5000,
    baseFee: 4900, // was 7500
    perKgFee: 520, // was 800
    fuelSurcharge: 320, // was 600
    remoteSurcharge: 320, // was 600
    etaMinDays: 4,
    etaMaxDays: 8,
  },

  // =========================
  // FRAGILE overrides (reduced)
  // =========================
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "FRAGILE",
    minWeightGrams: 0,
    maxWeightGrams: 5000,
    baseFee: 2200, // was 3500
    perKgFee: 320, // was 500
    handlingFee: 280, // was 500
    fuelSurcharge: 160, // was 250
    etaMinDays: 1,
    etaMaxDays: 3,
  },
  {
    zoneCode: "SW_NEAR",
    serviceLevel: "STANDARD",
    parcelClass: "FRAGILE",
    minWeightGrams: 0,
    maxWeightGrams: 5000,
    baseFee: 3200, // was 5000
    perKgFee: 420, // was 650
    handlingFee: 350, // was 600
    fuelSurcharge: 220, // was 350
    etaMinDays: 2,
    etaMaxDays: 5,
  },

  // =========================
  // BULKY overrides (reduced)
  // =========================
  {
    zoneCode: "LAGOS_LOCAL",
    serviceLevel: "STANDARD",
    parcelClass: "BULKY",
    minWeightGrams: 0,
    maxWeightGrams: null,
    baseFee: 3200, // was 5000
    perKgFee: 560, // was 850
    handlingFee: 650, // was 1000
    fuelSurcharge: 260, // was 400
    etaMinDays: 2,
    etaMaxDays: 4,
  },
  {
    zoneCode: "NORTH_FAR",
    serviceLevel: "STANDARD",
    parcelClass: "BULKY",
    minWeightGrams: 0,
    maxWeightGrams: null,
    baseFee: 6200, // was 9000
    perKgFee: 820, // was 1200
    handlingFee: 900, // was 1500
    fuelSurcharge: 420, // was 700
    remoteSurcharge: 420, // was 700
    etaMinDays: 5,
    etaMaxDays: 10,
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
        isActive: true,
        priority: z.priority ?? 0,
      },
      create: {
        code: z.code,
        name: z.name,
        country: "Nigeria",
        statesJson: z.states,
        isActive: true,
        priority: z.priority ?? 0,
      },
    });
  }
}

async function replaceRates() {
  // safest for seed refresh during development
  await prisma.shippingRateCard.deleteMany({});

  const zones = await prisma.shippingZone.findMany({
    select: { id: true, code: true },
  });
  const zoneIdByCode = new Map(zones.map((z) => [z.code, z.id]));

  for (const r of RATES) {
    const zoneId = zoneIdByCode.get(r.zoneCode);
    if (!zoneId) throw new Error(`Missing zone for code ${r.zoneCode}`);

    await prisma.shippingRateCard.create({
      data: {
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

async function main() {
  await upsertZones();
  await replaceRates();
  console.log("✅ Shipping zones and rate cards seeded (reduced prices).");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });