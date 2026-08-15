import {
  Prisma,
  PrismaClient,
  DeliveryServiceLevel,
  ShippingParcelClass,
  ShippingQuoteStatus,
  ShippingRateSource,
  SupplierShippingProfileMode,
  SupplierFulfillmentMode,
  SupplierShippingCoverage,
} from "@prisma/client";
import { getGiglShippingPrice, isGiglEnabled } from "./giglProvider.js";

const prisma = new PrismaClient();

export type QuoteCheckoutItemInput = {
  productId: string;
  variantId?: string | null;
  qty: number;
  // Pins this line to a specific supplier's offer (e.g. the customer swapped
  // away from the auto-picked/cheapest supplier to one shipping from
  // closer). When omitted, falls back to the product's primary supplier.
  offerId?: string | null;
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
  /**
   * Only present when serviceLevel === PICKUP_POINT.
   * "gigl_hub"          — customer picks up at a GIG Logistics service centre
   * "supplier_premises" — customer picks up at the supplier's own address
   */
  pickupType?: "gigl_hub" | "supplier_premises" | null;
  /** City/town-level name of the resolved pickup hub — only set when pickupType === "gigl_hub". */
  pickupHubName?: string | null;
  /** State the supplier ships from (pickup address, falling back to registered address). */
  originState?: string | null;
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
  // True for errors that mean this order genuinely cannot ship as-is (e.g.
  // the supplier has shipping turned off) — the checkout flow must hard-stop
  // rather than just show a soft "partial" warning. Left false/undefined for
  // intentionally-soft cases like MANUAL_QUOTE, where proceeding without a
  // price is the deliberate design.
  blockCheckout?: boolean;
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

// GIGL's /price response carries no delivery-time estimate at all (confirmed
// live — its full response schema has no ETA field of any kind), so this is
// a rough, honestly-labeled estimate based on same-state vs interstate
// distance, not real carrier data. Pickup skips the last-mile leg (parcel
// just needs to reach the hub, not the customer's door), so it shaves a day
// off each end versus door delivery.
function estimateDeliveryEtaDays(
  originState: string | null | undefined,
  destinationState: string | null | undefined,
  isPickup = false
): { min: number; max: number } {
  const sameState =
    !!originState && !!destinationState && normalizeText(originState) === normalizeText(destinationState);
  if (isPickup) {
    return sameState ? { min: 1, max: 2 } : { min: 2, max: 5 };
  }
  return sameState ? { min: 1, max: 3 } : { min: 3, max: 7 };
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

type SupplierShippingRecord = {
  id: string;
  name: string;
  shippingEnabled: boolean;
  shippingCoverage: SupplierShippingCoverage;
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
};

const SUPPLIER_SHIPPING_SELECT = {
  id: true,
  name: true,
  shippingEnabled: true,
  shippingCoverage: true,
  handlingFee: true,
  defaultLeadDays: true,
  defaultServiceLevel: true,
  shippingProfileMode: true,
  pickupAddress: {
    select: { id: true, state: true, lga: true, town: true, city: true },
  },
  registeredAddress: {
    select: { id: true, state: true, lga: true, town: true, city: true },
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
} as const;

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
    supplier: SupplierShippingRecord | null;
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

type PriceBreakdown = {
  shippingFee: number;
  remoteSurcharge: number;
  fuelSurcharge: number;
  handlingFee: number;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  rateSource: ShippingRateSource;
  pricingMeta: Record<string, unknown>;
};

function makeEmptyQuote(args: {
  supplierId: string;
  destinationZoneCode?: string | null;
  destinationZoneName?: string | null;
  originZoneCode?: string | null;
  serviceLevel: DeliveryServiceLevel;
  totalActualWeightGrams?: number;
  totalVolumetricWeightGrams?: number;
  chargeableWeightGrams?: number;
  items?: SupplierShippingQuoteResult["items"];
  error: string;
  blockCheckout?: boolean;
}): SupplierShippingQuoteResult {
  return {
    supplierId: args.supplierId,
    zoneCode: args.destinationZoneCode ?? null,
    zoneName: args.destinationZoneName ?? null,
    originZoneCode: args.originZoneCode ?? null,
    destinationZoneCode: args.destinationZoneCode ?? null,
    serviceLevel: args.serviceLevel,
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
      actualWeightGrams: args.totalActualWeightGrams ?? 0,
      volumetricWeightGrams: args.totalVolumetricWeightGrams ?? 0,
      chargeableWeightGrams: args.chargeableWeightGrams ?? 0,
    },
    eta: { minDays: null, maxDays: null },
    items: args.items ?? [],
    error: args.error,
    blockCheckout: args.blockCheckout ?? false,
  };
}

async function findPlatformRouteRate(args: {
  originZoneCode?: string | null;
  destinationZoneCode?: string | null;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  chargeableWeightGrams: number;
}) {
  const { originZoneCode, destinationZoneCode, serviceLevel, parcelClass, chargeableWeightGrams } = args;
  if (!originZoneCode || !destinationZoneCode) return null;

  return prisma.shippingRouteRateCard.findFirst({
    where: {
      originZoneCode,
      destinationZoneCode,
      serviceLevel,
      parcelClass,
      isActive: true,
      minWeightGrams: { lte: chargeableWeightGrams },
      OR: [{ maxWeightGrams: null }, { maxWeightGrams: { gt: chargeableWeightGrams } }],
    },
    orderBy: [{ minWeightGrams: "desc" }],
  });
}

async function findSupplierZoneRate(args: {
  supplierId: string;
  zoneId?: string | null;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  chargeableWeightGrams: number;
}) {
  const { supplierId, zoneId, serviceLevel, parcelClass, chargeableWeightGrams } = args;
  if (!zoneId) return null;

  return prisma.shippingRateCard.findFirst({
    where: {
      supplierId,
      zoneId,
      serviceLevel,
      parcelClass,
      isActive: true,
      minWeightGrams: { lte: chargeableWeightGrams },
      OR: [{ maxWeightGrams: null }, { maxWeightGrams: { gt: chargeableWeightGrams } }],
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
      ],
    },
    orderBy: [{ minWeightGrams: "desc" }],
  });
}

async function findDefaultZoneRate(args: {
  zoneId?: string | null;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  chargeableWeightGrams: number;
}) {
  const { zoneId, serviceLevel, parcelClass, chargeableWeightGrams } = args;
  if (!zoneId) return null;

  return prisma.shippingRateCard.findFirst({
    where: {
      supplierId: null,
      zoneId,
      serviceLevel,
      parcelClass,
      isActive: true,
      minWeightGrams: { lte: chargeableWeightGrams },
      OR: [{ maxWeightGrams: null }, { maxWeightGrams: { gt: chargeableWeightGrams } }],
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
      ],
    },
    orderBy: [{ minWeightGrams: "desc" }],
  });
}

function shouldUseSupplierHandlingFee(
  fulfillmentMode?: SupplierFulfillmentMode | null
): boolean {
  return (
    fulfillmentMode === SupplierFulfillmentMode.SUPPLIER_SELF_SHIP ||
    fulfillmentMode === SupplierFulfillmentMode.COURIER_DROPOFF ||
    fulfillmentMode === SupplierFulfillmentMode.MANUAL_QUOTE
  );
}

function priceFromRouteRate(args: {
  routeRate: {
    id: string;
    baseFee: Prisma.Decimal;
    perKgFee: Prisma.Decimal | null;
    remoteSurcharge: Prisma.Decimal | null;
    fuelSurcharge: Prisma.Decimal | null;
    handlingFee: Prisma.Decimal | null;
    etaMinDays: number | null;
    etaMaxDays: number | null;
  };
  chargeableKg: number;
  originZoneCode?: string | null;
  destinationZoneCode?: string | null;
}): PriceBreakdown {
  const { routeRate, chargeableKg, originZoneCode, destinationZoneCode } = args;
  return {
    shippingFee:
      toNum(routeRate.baseFee) +
      (toNum(routeRate.perKgFee) > 0 ? toNum(routeRate.perKgFee) * chargeableKg : 0),
    remoteSurcharge: toNum(routeRate.remoteSurcharge),
    fuelSurcharge: toNum(routeRate.fuelSurcharge),
    handlingFee: toNum(routeRate.handlingFee),
    etaMinDays: routeRate.etaMinDays ?? null,
    etaMaxDays: routeRate.etaMaxDays ?? null,
    rateSource: ShippingRateSource.FALLBACK_ZONE,
    pricingMeta: {
      mode: "platform_route_rate",
      originZoneCode: originZoneCode ?? null,
      destinationZoneCode: destinationZoneCode ?? null,
      routeRateId: routeRate.id,
    },
  };
}

function priceFromSupplierZoneRate(args: {
  supplierZoneRate: {
    id: string;
    baseFee: Prisma.Decimal;
    perKgFee: Prisma.Decimal | null;
    remoteSurcharge: Prisma.Decimal | null;
    fuelSurcharge: Prisma.Decimal | null;
    handlingFee: Prisma.Decimal | null;
    etaMinDays: number | null;
    etaMaxDays: number | null;
  };
  chargeableKg: number;
  destinationZoneCode?: string | null;
}): PriceBreakdown {
  const { supplierZoneRate, chargeableKg, destinationZoneCode } = args;
  return {
    shippingFee:
      toNum(supplierZoneRate.baseFee) +
      (toNum(supplierZoneRate.perKgFee) > 0
        ? toNum(supplierZoneRate.perKgFee) * chargeableKg
        : 0),
    remoteSurcharge: toNum(supplierZoneRate.remoteSurcharge),
    fuelSurcharge: toNum(supplierZoneRate.fuelSurcharge),
    handlingFee: toNum(supplierZoneRate.handlingFee),
    etaMinDays: supplierZoneRate.etaMinDays ?? null,
    etaMaxDays: supplierZoneRate.etaMaxDays ?? null,
    rateSource: ShippingRateSource.MANUAL,
    pricingMeta: {
      mode: "supplier_zone_override",
      destinationZoneCode: destinationZoneCode ?? null,
      supplierRateCardId: supplierZoneRate.id,
    },
  };
}

function priceFromSupplierProfileFlat(args: {
  profile: {
    localFlatFee: Prisma.Decimal | null;
    nearbyFlatFee: Prisma.Decimal | null;
    nationwideBaseFee: Prisma.Decimal | null;
    defaultHandlingFee: Prisma.Decimal | null;
    fulfillmentMode: SupplierFulfillmentMode;
  } | null;
  supplierHandlingFee?: Prisma.Decimal | null;
  originZoneCode?: string | null;
  destinationZoneCode?: string | null;
  defaultLeadDays?: number | null;
}): PriceBreakdown | null {
  const { profile, supplierHandlingFee, originZoneCode, destinationZoneCode, defaultLeadDays } = args;
  if (!profile) return null;

  let shippingFee = 0;

  const sameZone =
    !!originZoneCode && !!destinationZoneCode && originZoneCode === destinationZoneCode;

  const nearbyZones = new Set(["LAGOS_LOCAL", "SW_NEAR"]);
  const nearby =
    !!originZoneCode &&
    !!destinationZoneCode &&
    nearbyZones.has(originZoneCode) &&
    nearbyZones.has(destinationZoneCode) &&
    originZoneCode !== destinationZoneCode;

  if (sameZone && profile.localFlatFee != null) {
    shippingFee = toNum(profile.localFlatFee);
  } else if (nearby && profile.nearbyFlatFee != null) {
    shippingFee = toNum(profile.nearbyFlatFee);
  } else if (profile.nationwideBaseFee != null) {
    shippingFee = toNum(profile.nationwideBaseFee);
  }

  if (shippingFee <= 0) return null;

  return {
    shippingFee,
    remoteSurcharge: 0,
    fuelSurcharge: 0,
    handlingFee: shouldUseSupplierHandlingFee(profile.fulfillmentMode)
      ? toNum(profile.defaultHandlingFee ?? supplierHandlingFee)
      : 0,
    etaMinDays: defaultLeadDays ?? null,
    etaMaxDays: defaultLeadDays ?? null,
    rateSource: ShippingRateSource.MANUAL,
    pricingMeta: {
      mode: "supplier_profile_flat",
      originZoneCode: originZoneCode ?? null,
      destinationZoneCode: destinationZoneCode ?? null,
      fulfillmentMode: profile.fulfillmentMode,
    },
  };
}

function addOptionalSupplierHandling(args: {
  base: PriceBreakdown;
  supplierHandlingFee?: Prisma.Decimal | null;
  fulfillmentMode?: SupplierFulfillmentMode | null;
  includeOnlyWhenZero?: boolean;
}): PriceBreakdown {
  const { base, supplierHandlingFee, fulfillmentMode, includeOnlyWhenZero } = args;

  if (!shouldUseSupplierHandlingFee(fulfillmentMode)) return base;

  const fee = toNum(supplierHandlingFee);
  if (fee <= 0) return base;
  if (includeOnlyWhenZero && base.handlingFee > 0) return base;

  return {
    ...base,
    handlingFee: round2(base.handlingFee + fee),
    pricingMeta: {
      ...base.pricingMeta,
      supplierHandlingFeeAdded: fee,
    },
  };
}

export async function quoteShippingForCheckout(
  input: QuoteShippingInput
): Promise<QuoteShippingResult> {
  const serviceLevel = input.serviceLevel ?? DeliveryServiceLevel.STANDARD;

  if (!input.items?.length) {
    throw new Error("No items provided");
  }

  const mergedMap = new Map<
    string,
    { productId: string; variantId: string | null; qty: number; offerId: string | null }
  >();

  for (const it of input.items) {
    const qty = Math.max(1, Number(it.qty) || 1);
    const offerId = it.offerId ? String(it.offerId) : null;
    // offerId is part of the merge key: two lines of the same product pinned
    // to different suppliers' offers must not be collapsed into one.
    const key = `${it.productId}::${it.variantId || ""}::${offerId || ""}`;
    const prev = mergedMap.get(key);
    if (prev) prev.qty += qty;
    else {
      mergedMap.set(key, {
        productId: it.productId,
        variantId: it.variantId ?? null,
        qty,
        offerId,
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
      supplier: { select: SUPPLIER_SHIPPING_SELECT },
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

  // Resolve any pinned offerIds to their actual supplier — a swap means the
  // line ships from that offer's supplier, not the product's primary one.
  const offerIds = [...new Set(merged.map((l) => l.offerId).filter(Boolean) as string[])];

  const offerSupplierMap = new Map<string, SupplierShippingRecord>();

  if (offerIds.length) {
    const [variantOffers, baseOffers] = await Promise.all([
      prisma.supplierVariantOffer.findMany({
        where: { id: { in: offerIds } },
        select: { id: true, supplier: { select: SUPPLIER_SHIPPING_SELECT } },
      }),
      prisma.supplierProductOffer.findMany({
        where: { id: { in: offerIds } },
        select: { id: true, supplier: { select: SUPPLIER_SHIPPING_SELECT } },
      }),
    ]);

    for (const o of variantOffers) {
      if (o.supplier) offerSupplierMap.set(o.id, o.supplier as SupplierShippingRecord);
    }
    for (const o of baseOffers) {
      // A variant-offer match takes priority (mirrors fetchOneOfferByIdTx's
      // lookup order in orders.ts — variant offers are checked first).
      if (o.supplier && !offerSupplierMap.has(o.id)) {
        offerSupplierMap.set(o.id, o.supplier as SupplierShippingRecord);
      }
    }
  }

  for (const line of merged) {
    const p = productMap.get(line.productId);
    if (!p) throw new Error(`Product not found: ${line.productId}`);
    const resolvedSupplierId = (line.offerId && offerSupplierMap.get(line.offerId)?.id) || p.supplierId;
    if (!resolvedSupplierId) {
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
  const supplierRecordMap = new Map<string, SupplierShippingRecord | null>();

  for (const line of merged) {
    const product = productMap.get(line.productId)!;
    const variant = line.variantId ? variantMap.get(line.variantId)! : null;
    const pinnedSupplier = line.offerId ? offerSupplierMap.get(line.offerId) ?? null : null;
    const supplierId = pinnedSupplier?.id || (product.supplierId as string);

    if (!supplierRecordMap.has(supplierId)) {
      supplierRecordMap.set(supplierId, pinnedSupplier ?? product.supplier ?? null);
    }

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
    const supplier = supplierRecordMap.get(supplierId) ?? null;

    if (!supplier) {
      supplierQuotes.push(
        makeEmptyQuote({
          supplierId,
          destinationZoneCode: destinationZone?.code ?? null,
          destinationZoneName: destinationZone?.name ?? null,
          serviceLevel,
          error: "Supplier record missing for product(s) in cart",
        })
      );
      continue;
    }

    if (!supplier.shippingEnabled) {
      supplierQuotes.push(
        makeEmptyQuote({
          supplierId,
          destinationZoneCode: destinationZone?.code ?? null,
          destinationZoneName: destinationZone?.name ?? null,
          serviceLevel,
          error: `${supplier.name || "This supplier"} isn't accepting new orders right now. Please remove their item(s) from your cart to continue.`,
          blockCheckout: true,
        })
      );
      continue;
    }

    const pickupAddress = supplier.pickupAddress ?? supplier.registeredAddress ?? null;

    if (!pickupAddress) {
      supplierQuotes.push(
        makeEmptyQuote({
          supplierId,
          destinationZoneCode: destinationZone?.code ?? null,
          destinationZoneName: destinationZone?.name ?? null,
          originZoneCode: supplier.shippingProfile?.originZoneCode ?? null,
          serviceLevel,
          error: "Supplier pickup/registered address missing",
        })
      );
      continue;
    }

    const originZone =
      supplier.shippingProfile?.originZoneCode
        ? await prisma.shippingZone.findUnique({
            where: { code: supplier.shippingProfile.originZoneCode },
          })
        : await findZoneByAddress(pickupAddress);

    // ── Supplier coverage enforcement ───────────────────────────────────────
    // How far this supplier is willing to have their goods picked up and
    // shipped — purely a supplier preference, not a carrier limitation
    // (GIGL delivers nationwide regardless). LOCAL = same state as their
    // pickup address; REGIONAL = same shipping zone (e.g. all of South
    // West); NATIONWIDE = no restriction.
    if (supplier.shippingCoverage === SupplierShippingCoverage.LOCAL) {
      const sameState =
        normalizeText(pickupAddress.state) === normalizeText(destination.state);
      if (!sameState) {
        supplierQuotes.push(
          makeEmptyQuote({
            supplierId,
            destinationZoneCode: destinationZone?.code ?? null,
            destinationZoneName: destinationZone?.name ?? null,
            originZoneCode: originZone?.code ?? null,
            serviceLevel,
            error: "This supplier only delivers within their own state.",
          })
        );
        continue;
      }
    } else if (supplier.shippingCoverage === SupplierShippingCoverage.REGIONAL) {
      const sameZone =
        !!originZone && !!destinationZone && originZone.code === destinationZone.code;
      if (!sameZone) {
        supplierQuotes.push(
          makeEmptyQuote({
            supplierId,
            destinationZoneCode: destinationZone?.code ?? null,
            destinationZoneName: destinationZone?.name ?? null,
            originZoneCode: originZone?.code ?? null,
            serviceLevel,
            error: "This supplier only delivers within their region.",
          })
        );
        continue;
      }
    }

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

    const quoteItems: SupplierShippingQuoteResult["items"] = lineSnapshots.map((x) => ({
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
    }));

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
    const chargeableKg = chargeableWeightGrams / 1000;

    const profileMode = supplier.shippingProfileMode;
    const profile = supplier.shippingProfile?.isActive ? supplier.shippingProfile : null;
    const fulfillmentMode = profile?.fulfillmentMode ?? null;

    if (profileMode === SupplierShippingProfileMode.MANUAL_QUOTE) {
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
        items: quoteItems,
        error: "Shipping for this supplier is quoted manually after order review.",
      });
      continue;
    }

    let chosen: PriceBreakdown | null = null;

    // ── Pickup availability enforcement ─────────────────────────────────────
    // PICKUP_POINT only exists via the logistics provider's own hub network
    // (GIGL) — suppliers never have customers show up at their premises, so
    // there's no supplier-side opt-in/fallback here anymore.
    if (serviceLevel === DeliveryServiceLevel.PICKUP_POINT && !isGiglEnabled()) {
      supplierQuotes.push(
        makeEmptyQuote({
          supplierId,
          destinationZoneCode: destinationZone?.code ?? null,
          destinationZoneName: destinationZone?.name ?? null,
          originZoneCode: originZone?.code ?? null,
          serviceLevel,
          totalActualWeightGrams,
          totalVolumetricWeightGrams,
          chargeableWeightGrams,
          items: quoteItems,
          error: "Pickup point delivery isn't available for this order yet.",
        })
      );
      continue;
    }

    // Determine pickupType for PICKUP_POINT orders
    const pickupType: SupplierShippingQuoteResult["pickupType"] =
      serviceLevel === DeliveryServiceLevel.PICKUP_POINT
        ? isGiglEnabled()
          ? "gigl_hub"
          : "supplier_premises"
        : null;

    // ── GIGL live rate ──────────────────────────────────────────────────────
    // Runs first when SHIPPING_PROVIDER=gigl. If GIGL is disabled, not
    // configured, or throws, chosen stays null and the existing internal
    // zone-based hierarchy below takes over automatically.
    if (isGiglEnabled() && !allFreeShipping) {
      console.log("[GIGL] attempting live rate", {
        originState: pickupAddress.state,
        destinationState: destination.state,
        weightKg: chargeableKg,
        parcelClass,
      });
      try {
        const giglResult = await getGiglShippingPrice({
          originState: pickupAddress.state ?? "",
          originLga: pickupAddress.lga ?? null,
          destinationState: destination.state ?? "",
          destinationLga: destination.lga ?? null,
          weightKg: chargeableKg,
          parcelClass,
          itemDescription: lineSnapshots[0]?.title ?? null,
        });

        console.log("[GIGL] live rate success", {
          totalFee: giglResult.totalFee,
          baseRate: giglResult.baseRate,
          carrierRef: giglResult.carrierRef,
        });

        const eta = estimateDeliveryEtaDays(
          pickupAddress.state,
          destination.state,
          serviceLevel === DeliveryServiceLevel.PICKUP_POINT
        );

        chosen = {
          shippingFee: giglResult.baseRate,
          remoteSurcharge: 0,
          fuelSurcharge: 0,
          // No supplier-set handling surcharge on top of the live GIGL
          // rate — suppliers price packing/handling into their base price.
          handlingFee: 0,
          etaMinDays: eta.min,
          etaMaxDays: eta.max,
          rateSource: ShippingRateSource.LIVE_CARRIER,
          pricingMeta: {
            mode: "gigl_live",
            carrierRef: giglResult.carrierRef,
            giglTotalFee: giglResult.totalFee,
            giglVat: giglResult.vatAmount,
            originState: pickupAddress.state ?? null,
            destinationState: destination.state ?? null,
            pickupHubName: giglResult.receiverStationName,
          },
        };
      } catch (e: any) {
        const axiosDetail = e?.response?.data ?? null;
        console.error("[GIGL] quote failed — falling back to internal rates", {
          message: e?.message,
          status: e?.response?.status,
          responseData: axiosDetail,
          url: e?.config?.url,
        });
        // chosen stays null → internal hierarchy below runs as normal
      }
    }
    // ── end GIGL ────────────────────────────────────────────────────────────

    // Internal zone-based hierarchy — only runs when GIGL didn't produce a rate
    if (!chosen) {
      if (profileMode === SupplierShippingProfileMode.SUPPLIER_OVERRIDDEN) {
        const supplierZoneRate =
          destinationZone &&
          (await findSupplierZoneRate({
            supplierId,
            zoneId: destinationZone.id,
            serviceLevel,
            parcelClass,
            chargeableWeightGrams,
          }));

        if (supplierZoneRate) {
          chosen = priceFromSupplierZoneRate({
            supplierZoneRate,
            chargeableKg,
            destinationZoneCode: destinationZone?.code ?? null,
          });
        }

        if (!chosen) {
          chosen = priceFromSupplierProfileFlat({
            profile,
            supplierHandlingFee: supplier.handlingFee,
            originZoneCode: originZone?.code ?? null,
            destinationZoneCode: destinationZone?.code ?? null,
            defaultLeadDays: supplier.defaultLeadDays ?? null,
          });
        }

        if (!chosen) {
          const routeRate = await findPlatformRouteRate({
            originZoneCode: originZone?.code ?? null,
            destinationZoneCode: destinationZone?.code ?? null,
            serviceLevel,
            parcelClass,
            chargeableWeightGrams,
          });

          if (routeRate) {
            chosen = addOptionalSupplierHandling({
              base: priceFromRouteRate({
                routeRate,
                chargeableKg,
                originZoneCode: originZone?.code ?? null,
                destinationZoneCode: destinationZone?.code ?? null,
              }),
              supplierHandlingFee: supplier.handlingFee,
              fulfillmentMode,
              includeOnlyWhenZero: true,
            });
          }
        }

        if (!chosen) {
          const defaultZoneRate =
            destinationZone &&
            (await findDefaultZoneRate({
              zoneId: destinationZone.id,
              serviceLevel,
              parcelClass,
              chargeableWeightGrams,
            }));

          if (defaultZoneRate) {
            chosen = addOptionalSupplierHandling({
              base: {
                shippingFee:
                  toNum(defaultZoneRate.baseFee) +
                  (toNum(defaultZoneRate.perKgFee) > 0
                    ? toNum(defaultZoneRate.perKgFee) * chargeableKg
                    : 0),
                remoteSurcharge: toNum(defaultZoneRate.remoteSurcharge),
                fuelSurcharge: toNum(defaultZoneRate.fuelSurcharge),
                handlingFee: toNum(defaultZoneRate.handlingFee),
                etaMinDays: defaultZoneRate.etaMinDays ?? supplier.defaultLeadDays ?? null,
                etaMaxDays: defaultZoneRate.etaMaxDays ?? supplier.defaultLeadDays ?? null,
                rateSource: ShippingRateSource.FALLBACK_ZONE,
                pricingMeta: {
                  mode: "default_zone_rate_fallback",
                  zoneRateCardId: defaultZoneRate.id,
                  destinationZoneCode: destinationZone?.code ?? null,
                },
              },
              supplierHandlingFee: supplier.handlingFee,
              fulfillmentMode,
              includeOnlyWhenZero: true,
            });
          }
        }
      } else {
        const routeRate = await findPlatformRouteRate({
          originZoneCode: originZone?.code ?? null,
          destinationZoneCode: destinationZone?.code ?? null,
          serviceLevel,
          parcelClass,
          chargeableWeightGrams,
        });

        if (routeRate) {
          chosen = addOptionalSupplierHandling({
            base: priceFromRouteRate({
              routeRate,
              chargeableKg,
              originZoneCode: originZone?.code ?? null,
              destinationZoneCode: destinationZone?.code ?? null,
            }),
            supplierHandlingFee: supplier.handlingFee,
            fulfillmentMode,
            includeOnlyWhenZero: true,
          });
        }

        if (!chosen) {
          const defaultZoneRate =
            destinationZone &&
            (await findDefaultZoneRate({
              zoneId: destinationZone.id,
              serviceLevel,
              parcelClass,
              chargeableWeightGrams,
            }));

          if (defaultZoneRate) {
            chosen = addOptionalSupplierHandling({
              base: {
                shippingFee:
                  toNum(defaultZoneRate.baseFee) +
                  (toNum(defaultZoneRate.perKgFee) > 0
                    ? toNum(defaultZoneRate.perKgFee) * chargeableKg
                    : 0),
                remoteSurcharge: toNum(defaultZoneRate.remoteSurcharge),
                fuelSurcharge: toNum(defaultZoneRate.fuelSurcharge),
                handlingFee: toNum(defaultZoneRate.handlingFee),
                etaMinDays: defaultZoneRate.etaMinDays ?? supplier.defaultLeadDays ?? null,
                etaMaxDays: defaultZoneRate.etaMaxDays ?? supplier.defaultLeadDays ?? null,
                rateSource: ShippingRateSource.FALLBACK_ZONE,
                pricingMeta: {
                  mode: "default_zone_rate",
                  zoneRateCardId: defaultZoneRate.id,
                  destinationZoneCode: destinationZone?.code ?? null,
                },
              },
              supplierHandlingFee: supplier.handlingFee,
              fulfillmentMode,
              includeOnlyWhenZero: true,
            });
          }
        }

        if (!chosen && profile) {
          chosen = priceFromSupplierProfileFlat({
            profile,
            supplierHandlingFee: supplier.handlingFee,
            originZoneCode: originZone?.code ?? null,
            destinationZoneCode: destinationZone?.code ?? null,
            defaultLeadDays: supplier.defaultLeadDays ?? null,
          });
        }
      }
    }

    if (allFreeShipping) {
      chosen = {
        shippingFee: 0,
        remoteSurcharge: 0,
        fuelSurcharge: 0,
        handlingFee: 0,
        etaMinDays: chosen?.etaMinDays ?? supplier.defaultLeadDays ?? null,
        etaMaxDays: chosen?.etaMaxDays ?? supplier.defaultLeadDays ?? null,
        rateSource: chosen?.rateSource ?? ShippingRateSource.FALLBACK_ZONE,
        pricingMeta: {
          ...(chosen?.pricingMeta ?? {}),
          allFreeShipping: true,
        },
      };
    }

    const totalFee = round2(
      Math.max(
        0,
        (chosen?.shippingFee ?? 0) +
          (chosen?.remoteSurcharge ?? 0) +
          (chosen?.fuelSurcharge ?? 0) +
          (chosen?.handlingFee ?? 0)
      )
    );

    if (!chosen || (!destinationZone && totalFee <= 0)) {
      supplierQuotes.push(
        makeEmptyQuote({
          supplierId,
          destinationZoneCode: destinationZone?.code ?? null,
          destinationZoneName: destinationZone?.name ?? null,
          originZoneCode: originZone?.code ?? null,
          serviceLevel,
          totalActualWeightGrams,
          totalVolumetricWeightGrams,
          chargeableWeightGrams,
          items: quoteItems,
          error: !destinationZone
            ? "No shipping zone configured for destination."
            : "No matching shipping configuration found for supplier.",
        })
      );
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
        rateSource: chosen.rateSource,
        status: ShippingQuoteStatus.DRAFT,
        serviceLevel,
        zoneCode: destinationZone?.code ?? null,
        zoneName: destinationZone?.name ?? null,
        totalActualWeightGrams,
        totalVolumetricWeightGrams,
        chargeableWeightGrams,
        parcelCount: 1,
        currency: "NGN",
        shippingFee: new Prisma.Decimal(round2(chosen.shippingFee).toFixed(2)),
        remoteSurcharge: new Prisma.Decimal(round2(chosen.remoteSurcharge).toFixed(2)),
        fuelSurcharge: new Prisma.Decimal(round2(chosen.fuelSurcharge).toFixed(2)),
        handlingFee: new Prisma.Decimal(round2(chosen.handlingFee).toFixed(2)),
        insuranceFee: new Prisma.Decimal("0.00"),
        totalFee: new Prisma.Decimal(totalFee.toFixed(2)),
        etaMinDays: chosen.etaMinDays,
        etaMaxDays: chosen.etaMaxDays,
        pricingMetaJson: {
          ...chosen.pricingMeta,
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
      rateSource: chosen.rateSource,
      shippingQuoteId: quote.id,
      pickupType,
      pickupHubName:
        pickupType === "gigl_hub" ? (chosen.pricingMeta?.pickupHubName as string | null) ?? null : null,
      originState: pickupAddress.state ?? null,
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
  const blockingQuotes = supplierQuotes.filter((q) => q.error && q.blockCheckout);

  // Some quote failures (missing rates, manual-quote suppliers) are fine to
  // proceed past — the customer just sees a "partial" warning. A
  // blockCheckout failure (e.g. a supplier with shipping turned off) means
  // the cart genuinely cannot be fulfilled as-is, so it must hard-stop
  // checkout regardless of whether other suppliers in the cart succeeded.
  const blockingError = blockingQuotes.length
    ? blockingQuotes.map((q) => q.error).join(" ")
    : null;

  return {
    currency: "NGN",
    shippingFee: round2(totalShippingFee),
    suppliers: supplierQuotes,
    partial: hasAnySuccess && hasErrors,
    error:
      blockingError ??
      (hasAnySuccess ? null : "Could not compute shipping for any supplier."),
  };
}