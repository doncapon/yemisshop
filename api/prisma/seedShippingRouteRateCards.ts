import {
    PrismaClient,
    DeliveryServiceLevel,
    ShippingParcelClass,
} from "@prisma/client";

const prisma = new PrismaClient();

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

const ROUTES: RouteRateSeed[] = [
    // LOCAL
    {
        originZoneCode: "LAGOS_LOCAL",
        destinationZoneCode: "LAGOS_LOCAL",
        serviceLevel: "STANDARD",
        parcelClass: "STANDARD",
        minWeightGrams: 0,
        maxWeightGrams: 1000,
        baseFee: 1800,
        perKgFee: 0,
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

    // LAGOS -> SW_NEAR
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

    // SW_NEAR -> LAGOS
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

    // LAGOS -> SOUTH_SOUTH
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

    // LAGOS -> SE
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

    // LAGOS -> NC
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

    // LAGOS -> NORTH_FAR
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

    // LOCAL FRAGILE
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

async function main() {
    for (const row of ROUTES) {
        await prisma.shippingRouteRateCard.upsert({
            where: {
                shipping_route_rate_unique: {
                    originZoneCode: row.originZoneCode,
                    destinationZoneCode: row.destinationZoneCode,
                    serviceLevel: row.serviceLevel,
                    parcelClass: row.parcelClass,
                    minWeightGrams: row.minWeightGrams,
                    maxWeightGrams: row.maxWeightGrams ?? 0,
                },
            },
            update: {
                baseFee: row.baseFee,
                perKgFee: row.perKgFee ?? null,
                remoteSurcharge: row.remoteSurcharge ?? null,
                fuelSurcharge: row.fuelSurcharge ?? null,
                handlingFee: row.handlingFee ?? null,
                etaMinDays: row.etaMinDays ?? null,
                etaMaxDays: row.etaMaxDays ?? null,
                isActive: true,
            },
            create: {
                originZoneCode: row.originZoneCode,
                destinationZoneCode: row.destinationZoneCode,
                serviceLevel: row.serviceLevel,
                parcelClass: row.parcelClass,
                minWeightGrams: row.minWeightGrams,
                maxWeightGrams: row.maxWeightGrams ?? null,
                baseFee: row.baseFee,
                perKgFee: row.perKgFee ?? null,
                remoteSurcharge: row.remoteSurcharge ?? null,
                fuelSurcharge: row.fuelSurcharge ?? null,
                handlingFee: row.handlingFee ?? null,
                etaMinDays: row.etaMinDays ?? null,
                etaMaxDays: row.etaMaxDays ?? null,
                isActive: true,
            },
        });
    }

    console.log("✅ Shipping route rate cards seeded.");
}

main()
    .catch((e) => {
        console.error("❌ seedShippingRouteRateCards failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });