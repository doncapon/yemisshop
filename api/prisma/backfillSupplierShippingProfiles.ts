import { PrismaClient, Prisma, DeliveryServiceLevel } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeText(s?: string | null): string {
  return (s || "").trim().toLowerCase();
}

async function findZoneCodeFromAddress(address: {
  state?: string | null;
  lga?: string | null;
  city?: string | null;
  town?: string | null;
}): Promise<string | null> {
  const zones = await prisma.shippingZone.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  const state = normalizeText(address.state);
  const lga = normalizeText(address.lga || address.city || address.town);

  for (const zone of zones) {
    const states = Array.isArray(zone.statesJson) ? zone.statesJson : [];
    const lgas = Array.isArray(zone.lgasJson) ? zone.lgasJson : [];

    const statesNorm = states.map((x) => normalizeText(String(x)));
    const lgasNorm = lgas.map((x) => normalizeText(String(x)));

    const stateMatch = statesNorm.length === 0 || statesNorm.includes(state);
    const lgaMatch = lgasNorm.length === 0 || lgasNorm.includes(lga);

    if (stateMatch && lgaMatch) return zone.code;
  }

  return null;
}

async function main() {
  const suppliers = await prisma.supplier.findMany({
    include: {
      pickupAddress: true,
      registeredAddress: true,
      shippingProfile: true,
    },
  });

  let created = 0;
  let updated = 0;

  for (const supplier of suppliers) {
    const sourceAddress = supplier.pickupAddress ?? supplier.registeredAddress ?? null;
    const originZoneCode = sourceAddress
      ? await findZoneCodeFromAddress(sourceAddress)
      : null;

    const defaultHandlingFee = supplier.handlingFee
      ? new Prisma.Decimal(supplier.handlingFee)
      : null;

    if (!supplier.shippingProfile) {
      await prisma.supplierShippingProfile.create({
        data: {
          supplierId: supplier.id,
          originZoneCode,
          fulfillmentMode: "SUPPLIER_SELF_SHIP",
          defaultHandlingFee,
          isActive: true,
        },
      });
      created++;
    } else {
      await prisma.supplierShippingProfile.update({
        where: { supplierId: supplier.id },
        data: {
          originZoneCode: supplier.shippingProfile.originZoneCode ?? originZoneCode,
          defaultHandlingFee:
            supplier.shippingProfile.defaultHandlingFee ?? defaultHandlingFee,
          isActive: supplier.shippingProfile.isActive ?? true,
        },
      });
      updated++;
    }

    await prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        defaultServiceLevel: supplier.defaultServiceLevel ?? DeliveryServiceLevel.STANDARD,
        shippingProfileMode: supplier.shippingProfileMode ?? "DEFAULT_PLATFORM",
      },
    });
  }

  console.log(`✅ Supplier shipping profiles backfilled. Created=${created}, Updated=${updated}`);
}

main()
  .catch((e) => {
    console.error("❌ backfillSupplierShippingProfiles failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });