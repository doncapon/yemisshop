import {
  Prisma,
  PrismaClient,
  DeliveryServiceLevel,
  ShippingParcelClass,
  ShippingQuoteStatus,
  ShippingRateSource,
  SupplierShippingProfileMode,
  SupplierFulfillmentMode,
} from "@prisma/client";

const prisma = new PrismaClient();

export type QuoteCheckoutItemInput = {
  productId: string;
  variantId?: string | null;
  qty: number;
};

export type QuoteShippingInput = {
  userId?: string | null;
  items: QuoteCheckoutItemInput[];
  destinationAddressId?: string | null;
  destinationAddress?: {
    houseNumber?: string;
    streetName?: string;
    postCode?: string;
    town?: string;
    city?: string;
    state?: string;
    country?: string;
    lga?: string | null;
  } | null;
  serviceLevel?: DeliveryServiceLevel;
};

export type SupplierShippingQuoteResult = {
  supplierId: string;
  zoneCode: string | null;
  zoneName: string | null;
  originZoneCode: string | null;
  destinationZoneCode: string | null;
  serviceLevel: DeliveryServiceLevel;
  currency: string;
  rateSource: ShippingRateSource | "MANUAL_QUOTE";
  shippingQuoteId?: string;
  totals: {
    shippingFee: number;
    remoteSurcharge: number;
    fuelSurcharge: number;
    handlingFee: number;
    insuranceFee: number;
    totalFee: number;
  };
  weights: {
    actualWeightGrams: number;
    volumetricWeightGrams: number;
    chargeableWeightGrams: number;
  };
  eta: {
    minDays: number | null;
    maxDays: number | null;
  };
  items: Array<{
    productId: string | null;
    variantId: string | null;
    title: string | null;
    qty: number;
    weightGrams: number;
    actualWeightGrams: number;
    volumetricWeightGrams: number;
    chargeableWeightGrams: number;
    isFragile: boolean;
    isBulky: boolean;
    shippingClass: string | null;
  }>;
  error?: string | null;
};

export type QuoteShippingResult = {
  currency: string;
  shippingFee: number;
  suppliers: SupplierShippingQuoteResult[];
  partial: boolean;
  error: string | null;
};

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function ceilInt(n: number): number {
  return Math.ceil(Number.isFinite(n) ? n : 0);
}

function volumetricWeightGrams(
  lengthCm?: number | null,
  widthCm?: number | null,
  heightCm?: number | null,
  divisor = 5000
): number {
  if (!lengthCm || !widthCm || !heightCm || divisor <= 0) return 0;
  const kg = (lengthCm * widthCm * heightCm) / divisor;
  return ceilInt(kg * 1000);
}

function normalizeText(s?: string | null): string {
  return (s || "").trim().toLowerCase();
}

function inferParcelClass(args: {
  isFragile?: boolean;
  isBulky?: boolean;
  shippingClass?: string | null;
}): ShippingParcelClass {
  const cls = String(args.shippingClass || "").toUpperCase();
  if (args.isBulky || cls === "BULKY") return ShippingParcelClass.BULKY;
  if (args.isFragile || cls === "FRAGILE") return ShippingParcelClass.FRAGILE;
  return ShippingParcelClass.STANDARD;
}

async function resolveDestinationAddress(input: QuoteShippingInput) {
  if (input.destinationAddressId) {
    const address = await prisma.address.findUnique({
      where: { id: input.destinationAddressId },
    });
    if (!address) throw new Error("Destination address not found");
    return address;
  }

  if (!input.destinationAddress) {
    throw new Error("Destination address is required");
  }

  return {
    id: null,
    houseNumber: input.destinationAddress.houseNumber ?? "",
    streetName: input.destinationAddress.streetName ?? "",
    postCode: input.destinationAddress.postCode ?? "",
    town: input.destinationAddress.town ?? "",
    city: input.destinationAddress.city ?? "",
    state: input.destinationAddress.state ?? "",
    country: input.destinationAddress.country ?? "Nigeria",
    lga: input.destinationAddress.lga ?? null,
  };
}

async function findZoneByAddress(address: {
  state?: string | null;
  lga?: string | null;
  city?: string | null;
  town?: string | null;
}) {
  const zones = await prisma.shippingZone.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  const dstState = normalizeText(address.state);
  const dstLga = normalizeText(address.lga || address.city || address.town);

  for (const zone of zones) {
    const states = Array.isArray(zone.statesJson) ? zone.statesJson : [];
    const lgas = Array.isArray(zone.lgasJson) ? zone.lgasJson : [];

    const statesNorm = states.map((x) => normalizeText(String(x)));
    const lgasNorm = lgas.map((x) => normalizeText(String(x)));

    const stateMatch = statesNorm.length === 0 || statesNorm.includes(dstState);
    const lgaMatch = lgasNorm.length === 0 || lgasNorm.includes(dstLga);

    if (stateMatch && lgaMatch) return zone;
  }

  return null;
}

type LoadedLine = {
  qty: number;
  product: {
    id: string;
    title: string;
    supplierId: string | null;
    freeShipping: boolean;
    weightGrams: number | null;
    lengthCm: Prisma.Decimal | null;
    widthCm: Prisma.Decimal | null;
    heightCm: Prisma.Decimal | null;
    isFragile: boolean;
    isBulky: boolean;
    shippingClass: string | null;
    supplier: {
      id: string;
      handlingFee: Prisma.Decimal | null;
      defaultLeadDays: number | null;
      defaultServiceLevel: DeliveryServiceLevel | null;
      shippingProfileMode: SupplierShippingProfileMode;
      pickupAddress: {
        id: string;
        state: string | null;
        lga: string | null;
        town: string | null;
        city: string | null;
      } | null;
      registeredAddress: {
        id: string;
        state: string | null;
        lga: string | null;
        town: string | null;
        city: string | null;
      } | null;
      shippingProfile: {
        id: string;
        originZoneCode: string | null;
        fulfillmentMode: SupplierFulfillmentMode;
        preferredCarrier: string | null;
        localFlatFee: Prisma.Decimal | null;
        nearbyFlatFee: Prisma.Decimal | null;
        nationwideBaseFee: Prisma.Decimal | null;
        defaultHandlingFee: Prisma.Decimal | null;
        isActive: boolean;
      } | null;
    } | null;
  };
  variant: {
    id: string;
    productId: string;
    weightGrams: number | null;
    lengthCm: Prisma.Decimal | null;
    widthCm: Prisma.Decimal | null;
    heightCm: Prisma.Decimal | null;
    isFragileOverride: boolean | null;
    isBulkyOverride: boolean | null;
    shippingClassOverride: string | null;
  } | null;
};

export async function quoteShippingForCheckout(
  input: QuoteShippingInput
): Promise<QuoteShippingResult> {
  const serviceLevel = input.serviceLevel ?? DeliveryServiceLevel.STANDARD;

  if (!input.items?.length) {
    throw new Error("No items provided");
  }

  const mergedMap = new Map<
    string,
    { productId: string; variantId: string | null; qty: number }
  >();

  for (const it of input.items) {
    const qty = Math.max(1, Number(it.qty) || 1);
    const key = `${it.productId}::${it.variantId || ""}`;
    const prev = mergedMap.get(key);
    if (prev) prev.qty += qty;
    else {
      mergedMap.set(key, {
        productId: it.productId,
        variantId: it.variantId ?? null,
        qty,
      });
    }
  }

  const merged = [...mergedMap.values()];

  const productIds = [...new Set(merged.map((i) => i.productId))];
  const variantIds = [
    ...new Set(merged.map((i) => i.variantId).filter(Boolean) as string[]),
  ];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      title: true,
      supplierId: true,
      freeShipping: true,
      weightGrams: true,
      lengthCm: true,
      widthCm: true,
      heightCm: true,
      isFragile: true,
      isBulky: true,
      shippingClass: true,
      supplier: {
        select: {
          id: true,
          handlingFee: true,
          defaultLeadDays: true,
          defaultServiceLevel: true,
          shippingProfileMode: true,
          pickupAddress: {
            select: {
              id: true,
              state: true,
              lga: true,
              town: true,
              city: true,
            },
          },
          registeredAddress: {
            select: {
              id: true,
              state: true,
              lga: true,
              town: true,
              city: true,
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
            },
          },
        },
      },
    },
  });

  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          productId: true,
          weightGrams: true,
          lengthCm: true,
          widthCm: true,
          heightCm: true,
          isFragileOverride: true,
          isBulkyOverride: true,
          shippingClassOverride: true,
        },
      })
    : [];

  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  for (const line of merged) {
    const p = productMap.get(line.productId);
    if (!p) throw new Error(`Product not found: ${line.productId}`);
    if (!p.supplierId) {
      throw new Error(`Product ${p.id} has no supplier; cannot compute shipping.`);
    }
    if (line.variantId) {
      const v = variantMap.get(line.variantId);
      if (!v) throw new Error(`Variant not found: ${line.variantId}`);
      if (v.productId !== line.productId) {
        throw new Error(
          `Variant ${line.variantId} does not belong to product ${line.productId}`
        );
      }
    }
  }

  const destination = await resolveDestinationAddress(input);
  const destinationZone = await findZoneByAddress(destination);

  const bySupplier = new Map<string, LoadedLine[]>();

  for (const line of merged) {
    const product = productMap.get(line.productId)!;
    const variant = line.variantId ? variantMap.get(line.variantId)! : null;
    const supplierId = product.supplierId as string;

    const arr = bySupplier.get(supplierId) || [];
    arr.push({
      qty: line.qty,
      product,
      variant,
    });
    bySupplier.set(supplierId, arr);
  }

  const supplierQuotes: SupplierShippingQuoteResult[] = [];
  let totalShippingFee = 0;

  for (const [supplierId, rows] of bySupplier.entries()) {
    const supplier = rows[0]!.product.supplier;

    if (!supplier) {
      supplierQuotes.push({
        supplierId,
        zoneCode: destinationZone?.code ?? null,
        zoneName: destinationZone?.name ?? null,
        originZoneCode: null,
        destinationZoneCode: destinationZone?.code ?? null,
        serviceLevel,
        currency: "NGN",
        rateSource: ShippingRateSource.MANUAL,
        totals: {
          shippingFee: 0,
          remoteSurcharge: 0,
          fuelSurcharge: 0,
          handlingFee: 0,
          insuranceFee: 0,
          totalFee: 0,
        },
        weights: {
          actualWeightGrams: 0,
          volumetricWeightGrams: 0,
          chargeableWeightGrams: 0,
        },
        eta: { minDays: null, maxDays: null },
        items: [],
        error: "Supplier record missing for product(s) in cart",
      });
      continue;
    }

    const pickupAddress = supplier.pickupAddress ?? supplier.registeredAddress ?? null;

    if (!pickupAddress) {
      supplierQuotes.push({
        supplierId,
        zoneCode: destinationZone?.code ?? null,
        zoneName: destinationZone?.name ?? null,
        originZoneCode: supplier.shippingProfile?.originZoneCode ?? null,
        destinationZoneCode: destinationZone?.code ?? null,
        serviceLevel,
        currency: "NGN",
        rateSource: ShippingRateSource.MANUAL,
        totals: {
          shippingFee: 0,
          remoteSurcharge: 0,
          fuelSurcharge: 0,
          handlingFee: 0,
          insuranceFee: 0,
          totalFee: 0,
        },
        weights: {
          actualWeightGrams: 0,
          volumetricWeightGrams: 0,
          chargeableWeightGrams: 0,
        },
        eta: { minDays: null, maxDays: null },
        items: [],
        error: "Supplier pickup/registered address missing",
      });
      continue;
    }

    const originZone =
      supplier.shippingProfile?.originZoneCode
        ? await prisma.shippingZone.findUnique({
            where: { code: supplier.shippingProfile.originZoneCode },
          })
        : await findZoneByAddress(pickupAddress);

    const lineSnapshots = rows.map(({ qty, product, variant }) => {
      const perUnitActual = Math.max(
        0,
        toNum(variant?.weightGrams ?? product.weightGrams ?? 0)
      );

      const lengthCm = toNum(variant?.lengthCm ?? product.lengthCm ?? 0);
      const widthCm = toNum(variant?.widthCm ?? product.widthCm ?? 0);
      const heightCm = toNum(variant?.heightCm ?? product.heightCm ?? 0);

      const perUnitVol = volumetricWeightGrams(lengthCm, widthCm, heightCm, 5000);

      const isFragile = !!(variant?.isFragileOverride ?? product.isFragile ?? false);
      const isBulky = !!(variant?.isBulkyOverride ?? product.isBulky ?? false);
      const shippingClass =
        variant?.shippingClassOverride ?? product.shippingClass ?? null;

      return {
        productId: product.id,
        variantId: variant?.id ?? null,
        title: product.title,
        qty,
        freeShipping: product.freeShipping === true,
        weightGrams: perUnitActual,
        actualWeightGrams: perUnitActual * qty,
        volumetricWeightGrams: perUnitVol * qty,
        chargeableWeightGrams: Math.max(perUnitActual, perUnitVol) * qty,
        isFragile,
        isBulky,
        shippingClass,
        parcelClass: inferParcelClass({ isFragile, isBulky, shippingClass }),
      };
    });

    const totalActualWeightGrams = lineSnapshots.reduce(
      (s, x) => s + x.actualWeightGrams,
      0
    );
    const totalVolumetricWeightGrams = lineSnapshots.reduce(
      (s, x) => s + x.volumetricWeightGrams,
      0
    );
    const chargeableWeightGrams = Math.max(
      totalActualWeightGrams,
      totalVolumetricWeightGrams
    );

    const parcelClass = lineSnapshots.some(
      (x) => x.parcelClass === ShippingParcelClass.BULKY
    )
      ? ShippingParcelClass.BULKY
      : lineSnapshots.some((x) => x.parcelClass === ShippingParcelClass.FRAGILE)
      ? ShippingParcelClass.FRAGILE
      : ShippingParcelClass.STANDARD;

    const allFreeShipping = lineSnapshots.every((x) => x.freeShipping);

    if (supplier.shippingProfileMode === "MANUAL_QUOTE") {
      supplierQuotes.push({
        supplierId,
        zoneCode: destinationZone?.code ?? null,
        zoneName: destinationZone?.name ?? null,
        originZoneCode: originZone?.code ?? null,
        destinationZoneCode: destinationZone?.code ?? null,
        serviceLevel,
        currency: "NGN",
        rateSource: "MANUAL_QUOTE",
        totals: {
          shippingFee: 0,
          remoteSurcharge: 0,
          fuelSurcharge: 0,
          handlingFee: 0,
          insuranceFee: 0,
          totalFee: 0,
        },
        weights: {
          actualWeightGrams: totalActualWeightGrams,
          volumetricWeightGrams: totalVolumetricWeightGrams,
          chargeableWeightGrams,
        },
        eta: {
          minDays: supplier.defaultLeadDays ?? null,
          maxDays: supplier.defaultLeadDays ?? null,
        },
        items: lineSnapshots.map((x) => ({
          productId: x.productId,
          variantId: x.variantId,
          title: x.title,
          qty: x.qty,
          weightGrams: x.weightGrams,
          actualWeightGrams: x.actualWeightGrams,
          volumetricWeightGrams: x.volumetricWeightGrams,
          chargeableWeightGrams: x.chargeableWeightGrams,
          isFragile: x.isFragile,
          isBulky: x.isBulky,
          shippingClass: x.shippingClass,
        })),
        error: "Shipping for this supplier is quoted manually after order review.",
      });
      continue;
    }

    let shippingFee = 0;
    let remoteSurcharge = 0;
    let fuelSurcharge = 0;
    let handlingFee = 0;
    let etaMinDays: number | null = supplier.defaultLeadDays ?? null;
    let etaMaxDays: number | null = supplier.defaultLeadDays ?? null;
    let rateSource: ShippingRateSource = ShippingRateSource.FALLBACK_ZONE;
    let pricingMeta: Record<string, unknown> = {};

    const chargeableKg = chargeableWeightGrams / 1000;

    const useSupplierOverride =
      supplier.shippingProfileMode === "SUPPLIER_OVERRIDDEN" &&
      supplier.shippingProfile?.isActive;

    let routeRate: {
      id: string;
      baseFee: Prisma.Decimal;
      perKgFee: Prisma.Decimal | null;
      remoteSurcharge: Prisma.Decimal | null;
      fuelSurcharge: Prisma.Decimal | null;
      handlingFee: Prisma.Decimal | null;
      etaMinDays: number | null;
      etaMaxDays: number | null;
    } | null = null;

    if (originZone?.code && destinationZone?.code) {
      routeRate = await prisma.shippingRouteRateCard.findFirst({
        where: {
          originZoneCode: originZone.code,
          destinationZoneCode: destinationZone.code,
          serviceLevel,
          parcelClass,
          isActive: true,
          minWeightGrams: { lte: chargeableWeightGrams },
          OR: [
            { maxWeightGrams: null },
            { maxWeightGrams: { gt: chargeableWeightGrams } },
          ],
        },
        orderBy: [{ minWeightGrams: "desc" }],
      });
    }

    if (routeRate) {
      shippingFee =
        toNum(routeRate.baseFee) +
        (toNum(routeRate.perKgFee) > 0 ? toNum(routeRate.perKgFee) * chargeableKg : 0);
      remoteSurcharge = toNum(routeRate.remoteSurcharge);
      fuelSurcharge = toNum(routeRate.fuelSurcharge);
      handlingFee = toNum(routeRate.handlingFee);
      etaMinDays = routeRate.etaMinDays ?? etaMinDays;
      etaMaxDays = routeRate.etaMaxDays ?? etaMaxDays;
      rateSource = ShippingRateSource.FALLBACK_ZONE;

      pricingMeta = {
        mode: "route_rate",
        originZoneCode: originZone?.code,
        destinationZoneCode: destinationZone?.code,
        routeRateId: routeRate.id,
      };
    } else if (useSupplierOverride && destinationZone) {
      const supplierZoneRate = await prisma.shippingRateCard.findFirst({
        where: {
          supplierId,
          zoneId: destinationZone.id,
          serviceLevel,
          parcelClass,
          isActive: true,
          minWeightGrams: { lte: chargeableWeightGrams },
          OR: [
            { maxWeightGrams: null },
            { maxWeightGrams: { gt: chargeableWeightGrams } },
          ],
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
          ],
        },
        orderBy: [{ minWeightGrams: "desc" }],
      });

      if (supplierZoneRate) {
        shippingFee =
          toNum(supplierZoneRate.baseFee) +
          (toNum(supplierZoneRate.perKgFee) > 0
            ? toNum(supplierZoneRate.perKgFee) * chargeableKg
            : 0);
        remoteSurcharge = toNum(supplierZoneRate.remoteSurcharge);
        fuelSurcharge = toNum(supplierZoneRate.fuelSurcharge);
        handlingFee = toNum(supplierZoneRate.handlingFee);
        etaMinDays = supplierZoneRate.etaMinDays ?? etaMinDays;
        etaMaxDays = supplierZoneRate.etaMaxDays ?? etaMaxDays;
        rateSource = ShippingRateSource.MANUAL;

        pricingMeta = {
          mode: "supplier_zone_override",
          supplierRateCardId: supplierZoneRate.id,
          destinationZoneCode: destinationZone.code,
        };
      } else {
        const profile = supplier.shippingProfile;
        if (profile) {
          const sameZone =
            originZone?.code &&
            destinationZone?.code &&
            originZone.code === destinationZone.code;

          const nearbyZones = new Set(["LAGOS_LOCAL", "SW_NEAR"]);
          const nearby =
            originZone?.code &&
            destinationZone?.code &&
            nearbyZones.has(originZone.code) &&
            nearbyZones.has(destinationZone.code) &&
            originZone.code !== destinationZone.code;

          if (sameZone && profile.localFlatFee != null) {
            shippingFee = toNum(profile.localFlatFee);
          } else if (nearby && profile.nearbyFlatFee != null) {
            shippingFee = toNum(profile.nearbyFlatFee);
          } else if (profile.nationwideBaseFee != null) {
            shippingFee = toNum(profile.nationwideBaseFee);
          }

          handlingFee = toNum(profile.defaultHandlingFee ?? supplier.handlingFee);

          pricingMeta = {
            mode: "supplier_profile_flat",
            originZoneCode: originZone?.code ?? null,
            destinationZoneCode: destinationZone?.code ?? null,
          };
        }
      }
    } else if (destinationZone) {
      const defaultZoneRate = await prisma.shippingRateCard.findFirst({
        where: {
          supplierId: null,
          zoneId: destinationZone.id,
          serviceLevel,
          parcelClass,
          isActive: true,
          minWeightGrams: { lte: chargeableWeightGrams },
          OR: [
            { maxWeightGrams: null },
            { maxWeightGrams: { gt: chargeableWeightGrams } },
          ],
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
          ],
        },
        orderBy: [{ minWeightGrams: "desc" }],
      });

      if (defaultZoneRate) {
        shippingFee =
          toNum(defaultZoneRate.baseFee) +
          (toNum(defaultZoneRate.perKgFee) > 0
            ? toNum(defaultZoneRate.perKgFee) * chargeableKg
            : 0);
        remoteSurcharge = toNum(defaultZoneRate.remoteSurcharge);
        fuelSurcharge = toNum(defaultZoneRate.fuelSurcharge);
        handlingFee = toNum(defaultZoneRate.handlingFee) + toNum(supplier.handlingFee);
        etaMinDays = defaultZoneRate.etaMinDays ?? etaMinDays;
        etaMaxDays = defaultZoneRate.etaMaxDays ?? etaMaxDays;
        rateSource = ShippingRateSource.FALLBACK_ZONE;

        pricingMeta = {
          mode: "default_zone_rate",
          zoneRateCardId: defaultZoneRate.id,
          destinationZoneCode: destinationZone.code,
        };
      }
    }

    if (allFreeShipping) {
      shippingFee = 0;
      remoteSurcharge = 0;
      fuelSurcharge = 0;
      handlingFee = 0;
      pricingMeta.allFreeShipping = true;
    }

    const totalFee = Math.max(
      0,
      shippingFee + remoteSurcharge + fuelSurcharge + handlingFee
    );

    if (!destinationZone && totalFee <= 0) {
      supplierQuotes.push({
        supplierId,
        zoneCode: null,
        zoneName: null,
        originZoneCode: originZone?.code ?? null,
        destinationZoneCode: null,
        serviceLevel,
        currency: "NGN",
        rateSource: ShippingRateSource.MANUAL,
        totals: {
          shippingFee: 0,
          remoteSurcharge: 0,
          fuelSurcharge: 0,
          handlingFee: 0,
          insuranceFee: 0,
          totalFee: 0,
        },
        weights: {
          actualWeightGrams: totalActualWeightGrams,
          volumetricWeightGrams: totalVolumetricWeightGrams,
          chargeableWeightGrams,
        },
        eta: { minDays: etaMinDays, maxDays: etaMaxDays },
        items: lineSnapshots.map((x) => ({
          productId: x.productId,
          variantId: x.variantId,
          title: x.title,
          qty: x.qty,
          weightGrams: x.weightGrams,
          actualWeightGrams: x.actualWeightGrams,
          volumetricWeightGrams: x.volumetricWeightGrams,
          chargeableWeightGrams: x.chargeableWeightGrams,
          isFragile: x.isFragile,
          isBulky: x.isBulky,
          shippingClass: x.shippingClass,
        })),
        error: "No shipping zone configured for destination.",
      });
      continue;
    }

    const destinationAddressId =
      input.destinationAddressId && typeof destination.id === "string"
        ? destination.id
        : null;

    const quote = await prisma.shippingQuote.create({
      data: {
        userId: input.userId ?? null,
        supplierId,
        pickupAddressId: pickupAddress.id,
        destinationAddressId,
        rateSource,
        status: ShippingQuoteStatus.DRAFT,
        serviceLevel,
        zoneCode: destinationZone?.code ?? null,
        zoneName: destinationZone?.name ?? null,
        totalActualWeightGrams,
        totalVolumetricWeightGrams,
        chargeableWeightGrams,
        parcelCount: 1,
        currency: "NGN",
        shippingFee: new Prisma.Decimal(round2(shippingFee).toFixed(2)),
        remoteSurcharge: new Prisma.Decimal(round2(remoteSurcharge).toFixed(2)),
        fuelSurcharge: new Prisma.Decimal(round2(fuelSurcharge).toFixed(2)),
        handlingFee: new Prisma.Decimal(round2(handlingFee).toFixed(2)),
        insuranceFee: new Prisma.Decimal("0.00"),
        totalFee: new Prisma.Decimal(round2(totalFee).toFixed(2)),
        etaMinDays,
        etaMaxDays,
        pricingMetaJson: {
          ...pricingMeta,
          parcelClass,
          serviceLevel,
          chargeableWeightGrams,
        },
        items: {
          create: lineSnapshots.map((x) => ({
            productId: x.productId ?? undefined,
            variantId: x.variantId ?? undefined,
            productTitle: x.title,
            qty: x.qty,
            weightGrams: x.weightGrams || null,
            actualWeightGrams: x.actualWeightGrams,
            volumetricWeightGrams: x.volumetricWeightGrams,
            chargeableWeightGrams: x.chargeableWeightGrams,
            isFragile: x.isFragile,
            isBulky: x.isBulky,
            shippingClass: x.shippingClass,
          })),
        },
      },
      include: { items: true },
    });

    supplierQuotes.push({
      supplierId,
      zoneCode: quote.zoneCode ?? null,
      zoneName: quote.zoneName ?? null,
      originZoneCode: originZone?.code ?? null,
      destinationZoneCode: destinationZone?.code ?? null,
      serviceLevel: quote.serviceLevel,
      currency: quote.currency,
      rateSource,
      shippingQuoteId: quote.id,
      totals: {
        shippingFee: toNum(quote.shippingFee),
        remoteSurcharge: toNum(quote.remoteSurcharge),
        fuelSurcharge: toNum(quote.fuelSurcharge),
        handlingFee: toNum(quote.handlingFee),
        insuranceFee: toNum(quote.insuranceFee),
        totalFee: toNum(quote.totalFee),
      },
      weights: {
        actualWeightGrams: quote.totalActualWeightGrams ?? 0,
        volumetricWeightGrams: quote.totalVolumetricWeightGrams ?? 0,
        chargeableWeightGrams: quote.chargeableWeightGrams ?? 0,
      },
      eta: {
        minDays: quote.etaMinDays ?? null,
        maxDays: quote.etaMaxDays ?? null,
      },
      items: quote.items.map((i) => ({
        productId: i.productId ?? null,
        variantId: i.variantId ?? null,
        title: i.productTitle ?? null,
        qty: i.qty,
        weightGrams: i.weightGrams ?? 0,
        actualWeightGrams: i.actualWeightGrams ?? 0,
        volumetricWeightGrams: i.volumetricWeightGrams ?? 0,
        chargeableWeightGrams: i.chargeableWeightGrams ?? 0,
        isFragile: i.isFragile,
        isBulky: i.isBulky,
        shippingClass: i.shippingClass ?? null,
      })),
      error: null,
    });

    totalShippingFee += totalFee;
  }

  const hasAnySuccess = supplierQuotes.some((q) => !q.error);
  const hasErrors = supplierQuotes.some((q) => !!q.error);

  return {
    currency: "NGN",
    shippingFee: round2(totalShippingFee),
    suppliers: supplierQuotes,
    partial: hasAnySuccess && hasErrors,
    error: hasAnySuccess
      ? null
      : "Could not compute shipping for any supplier.",
  };
}