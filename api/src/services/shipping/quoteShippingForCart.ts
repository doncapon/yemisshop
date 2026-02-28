// api/src/services/shipping/quoteShippingForCart.ts
import { PrismaClient, Prisma, DeliveryServiceLevel, ShippingParcelClass, ShippingQuoteStatus, ShippingRateSource } from "@prisma/client";

const prisma = new PrismaClient();

type QuoteShippingInput = {
  userId?: string | null;
  cartId: string;
  destinationAddressId: string;
  serviceLevel?: DeliveryServiceLevel; // default STANDARD
};

type QuoteShippingResult = {
  shippingQuoteId: string;
  supplierId: string;
  zoneCode: string | null;
  zoneName: string | null;
  serviceLevel: DeliveryServiceLevel;
  currency: string;
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
};

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
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
  // (L * W * H) / divisor gives kg in many carrier formulas, convert to grams
  const kg = (lengthCm * widthCm * heightCm) / divisor;
  return ceilInt(kg * 1000);
}

function normalizeState(s?: string | null): string {
  return (s || "").trim().toLowerCase();
}

function normalizeLga(s?: string | null): string {
  return (s || "").trim().toLowerCase();
}

function inferParcelClass(args: {
  isFragile: boolean;
  isBulky: boolean;
  shippingClass?: string | null;
}): ShippingParcelClass {
  const cls = (args.shippingClass || "").toUpperCase();
  if (args.isBulky || cls === "BULKY") return ShippingParcelClass.BULKY;
  if (args.isFragile || cls === "FRAGILE") return ShippingParcelClass.FRAGILE;
  return ShippingParcelClass.STANDARD;
}

export async function quoteShippingForCart(input: QuoteShippingInput): Promise<QuoteShippingResult> {
  const serviceLevel = input.serviceLevel ?? "STANDARD";

  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    include: {
      items: {
        include: {
          product: {
            include: {
              supplier: {
                include: {
                  pickupAddress: true,
                  registeredAddress: true,
                },
              },
            },
          },
          variant: true,
        },
      },
    },
  });

  if (!cart) throw new Error("Cart not found");
  if (!cart.items.length) throw new Error("Cart is empty");

  const destination = await prisma.address.findUnique({
    where: { id: input.destinationAddressId },
  });
  if (!destination) throw new Error("Destination address not found");

  // ✅ enforce one-supplier cart for this flow
  const supplierIds = Array.from(
    new Set(cart.items.map((i) => i.product.supplierId).filter(Boolean))
  );
  if (supplierIds.length !== 1) {
    throw new Error("This quote function supports one-supplier carts only");
  }
  const supplierId = supplierIds[0]!;

  const supplier = cart.items[0]!.product.supplier;
  const pickupAddress = supplier.pickupAddress ?? supplier.registeredAddress ?? null;
  if (!pickupAddress) {
    throw new Error("Supplier pickup/registered address missing");
  }

  // Build parcel lines
  const lineSnapshots = cart.items.map((line) => {
    const p = line.product;
    const v = line.variant;

    const qty = Math.max(1, line.qty);

    const weightGrams =
      (v?.weightGrams ?? p.weightGrams ?? line.product.weightGrams ?? 0) || 0;

    const lengthCm = toNum(v?.lengthCm ?? p.lengthCm ?? null) || 0;
    const widthCm  = toNum(v?.widthCm ?? p.widthCm ?? null) || 0;
    const heightCm = toNum(v?.heightCm ?? p.heightCm ?? null) || 0;

    const isFragile = v?.isFragileOverride ?? p.isFragile ?? false;
    const isBulky = v?.isBulkyOverride ?? p.isBulky ?? false;
    const shippingClass = v?.shippingClassOverride ?? p.shippingClass ?? null;

    const perUnitActual = Math.max(0, weightGrams);
    const perUnitVol = volumetricWeightGrams(lengthCm, widthCm, heightCm, 5000);
    const perUnitChargeable = Math.max(perUnitActual, perUnitVol);

    return {
      productId: line.productId ?? null,
      variantId: line.variantId ?? null,
      productTitle: line.titleSnapshot || p.title || null,
      sku: v?.sku || p.sku || null,
      qty,

      weightGrams: perUnitActual,
      lengthCm: lengthCm || null,
      widthCm: widthCm || null,
      heightCm: heightCm || null,

      actualWeightGrams: perUnitActual * qty,
      volumetricWeightGrams: perUnitVol * qty,
      chargeableWeightGrams: perUnitChargeable * qty,

      isFragile,
      isBulky,
      shippingClass,
      parcelClass: inferParcelClass({ isFragile, isBulky, shippingClass }),
    };
  });

  // Aggregate totals
  const totalActualWeightGrams = lineSnapshots.reduce((s, x) => s + x.actualWeightGrams, 0);
  const totalVolumetricWeightGrams = lineSnapshots.reduce((s, x) => s + x.volumetricWeightGrams, 0);
  const chargeableWeightGrams = Math.max(totalActualWeightGrams, totalVolumetricWeightGrams);

  // Determine overall parcel class (most restrictive wins)
  const parcelClass: ShippingParcelClass =
    lineSnapshots.some((x) => x.parcelClass === "BULKY")
      ? "BULKY"
      : lineSnapshots.some((x) => x.parcelClass === "FRAGILE")
      ? "FRAGILE"
      : "STANDARD";

  // Find zone by destination state/lga
  const zones = await prisma.shippingZone.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  const dstState = normalizeState(destination.state);
  const dstLga = normalizeLga(destination.lga);

  let matchedZone: (typeof zones)[number] | null = null;

  for (const zone of zones) {
    const states = Array.isArray(zone.statesJson) ? (zone.statesJson as unknown[]) : [];
    const lgas = Array.isArray(zone.lgasJson) ? (zone.lgasJson as unknown[]) : [];

    const statesNorm = states.map((x) => String(x).toLowerCase().trim());
    const lgasNorm = lgas.map((x) => String(x).toLowerCase().trim());

    const stateMatch = statesNorm.length === 0 || statesNorm.includes(dstState);
    const lgaMatch = lgasNorm.length === 0 || lgasNorm.includes(dstLga);

    if (stateMatch && lgaMatch) {
      matchedZone = zone;
      break;
    }
  }

  if (!matchedZone) {
    throw new Error(`No shipping zone configured for destination state=${destination.state ?? ""} lga=${destination.lga ?? ""}`);
  }

  // Find matching rate card
  const now = new Date();
  const rateCards = await prisma.shippingRateCard.findMany({
    where: {
      zoneId: matchedZone.id,
      isActive: true,
      serviceLevel,
      parcelClass,
      minWeightGrams: { lte: chargeableWeightGrams },
      OR: [{ maxWeightGrams: null }, { maxWeightGrams: { gt: chargeableWeightGrams } }],
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: [{ minWeightGrams: "desc" }],
  });

  const rate = rateCards[0];
  if (!rate) {
    throw new Error(
      `No shipping rate card found for zone=${matchedZone.code}, service=${serviceLevel}, parcelClass=${parcelClass}, weight=${chargeableWeightGrams}g`
    );
  }

  const chargeableKg = chargeableWeightGrams / 1000;

  const baseFee = toNum(rate.baseFee);
  const perKgFee = toNum(rate.perKgFee);
  const remoteSurcharge = toNum(rate.remoteSurcharge);
  const fuelSurcharge = toNum(rate.fuelSurcharge);
  const rateHandling = toNum(rate.handlingFee);
  const supplierHandling = toNum(supplier.handlingFee);

  // Base + perKg (perKg applies to full weight; if you want "after first kg" adjust here)
  const shippingFee = baseFee + (perKgFee > 0 ? perKgFee * chargeableKg : 0);

  // Optional product-level free shipping override (all lines must be freeShipping)
  const allFreeShipping = cart.items.every((line) => line.product.freeShipping === true);

  const totalFeeRaw =
    allFreeShipping
      ? 0
      : shippingFee + remoteSurcharge + fuelSurcharge + rateHandling + supplierHandling;

  const shippingFeeFinal = allFreeShipping ? 0 : shippingFee;
  const totalFee = Math.max(0, totalFeeRaw);

  // Create quote + quote items
  const quote = await prisma.shippingQuote.create({
    data: {
      userId: input.userId ?? cart.userId,
      supplierId,
      pickupAddressId: pickupAddress.id,
      destinationAddressId: destination.id,

      rateSource: ShippingRateSource.FALLBACK_ZONE,
      status: ShippingQuoteStatus.DRAFT,

      serviceLevel,
      zoneCode: matchedZone.code,
      zoneName: matchedZone.name,

      totalActualWeightGrams,
      totalVolumetricWeightGrams,
      chargeableWeightGrams,
      parcelCount: 1,

      currency: rate.currency || "NGN",
      shippingFee: new Prisma.Decimal(shippingFeeFinal.toFixed(2)),
      remoteSurcharge: new Prisma.Decimal((allFreeShipping ? 0 : remoteSurcharge).toFixed(2)),
      fuelSurcharge: new Prisma.Decimal((allFreeShipping ? 0 : fuelSurcharge).toFixed(2)),
      handlingFee: new Prisma.Decimal((allFreeShipping ? 0 : (rateHandling + supplierHandling)).toFixed(2)),
      insuranceFee: new Prisma.Decimal("0.00"),
      totalFee: new Prisma.Decimal(totalFee.toFixed(2)),

      etaMinDays: rate.etaMinDays ?? supplier.defaultLeadDays ?? null,
      etaMaxDays: rate.etaMaxDays ?? supplier.defaultLeadDays ?? null,

      pricingMetaJson: {
        zoneId: matchedZone.id,
        rateCardId: rate.id,
        parcelClass,
        baseFee,
        perKgFee,
        chargeableKg,
        supplierHandling,
        allFreeShipping,
      },

      items: {
        create: lineSnapshots.map((x) => ({
          productId: x.productId ?? undefined,
          variantId: x.variantId ?? undefined,
          productTitle: x.productTitle,
          sku: x.sku,
          qty: x.qty,

          weightGrams: x.weightGrams || null,
          lengthCm: x.lengthCm != null ? new Prisma.Decimal(x.lengthCm.toFixed(2)) : null,
          widthCm: x.widthCm != null ? new Prisma.Decimal(x.widthCm.toFixed(2)) : null,
          heightCm: x.heightCm != null ? new Prisma.Decimal(x.heightCm.toFixed(2)) : null,

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

  return {
    shippingQuoteId: quote.id,
    supplierId,
    zoneCode: quote.zoneCode ?? null,
    zoneName: quote.zoneName ?? null,
    serviceLevel: quote.serviceLevel,
    currency: quote.currency,
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
  };
}