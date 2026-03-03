import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { DeliveryServiceLevel, ShippingParcelClass } from "@prisma/client";

const router = Router();

const ItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qty: z.number().int().positive().default(1),
});

const AddressSchema = z.object({
  houseNumber: z.string().optional().default(""),
  streetName: z.string().optional().default(""),
  postCode: z.string().optional().default(""),
  town: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
  lga: z.string().nullable().optional(),
});

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1),
  shippingAddress: AddressSchema,
  serviceLevel: z
    .nativeEnum(DeliveryServiceLevel)
    .optional()
    .default(DeliveryServiceLevel.STANDARD),
});

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ceilInt = (n: number) => Math.ceil(Number.isFinite(n) ? n : 0);

function volumetricWeightGrams(
  lengthCm?: number | null,
  widthCm?: number | null,
  heightCm?: number | null,
  divisor = 5000
) {
  if (!lengthCm || !widthCm || !heightCm || divisor <= 0) return 0;
  const kg = (lengthCm * widthCm * heightCm) / divisor;
  return ceilInt(kg * 1000);
}

function normalizeState(s?: string | null) {
  return (s || "").trim().toLowerCase();
}

function normalizeLga(s?: string | null) {
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

router.post("/shipping-fee-local", requireAuth, async (req, res) => {
  try {
    const { items, shippingAddress, serviceLevel } = BodySchema.parse(req.body);

    // merge duplicate lines
    const mergedMap = new Map<
      string,
      { productId: string; variantId: string | null; qty: number }
    >();
    for (const it of items) {
      const key = `${it.productId}::${it.variantId || ""}`;
      const prev = mergedMap.get(key);
      if (prev) prev.qty += Math.max(1, it.qty);
      else
        mergedMap.set(key, {
          productId: it.productId,
          variantId: it.variantId ?? null,
          qty: Math.max(1, it.qty),
        });
    }
    const merged = [...mergedMap.values()];

    const productIds = [...new Set(merged.map((i) => i.productId))];
    const variantIds = [
      ...new Set(merged.map((i) => i.variantId).filter(Boolean) as string[]),
    ];

    // products with supplier + addresses
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
            pickupAddress: {
              select: { id: true, state: true, lga: true, town: true, city: true },
            },
            registeredAddress: {
              select: { id: true, state: true, lga: true, town: true, city: true },
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

    // validate
    for (const line of merged) {
      const p = productMap.get(line.productId);
      if (!p) {
        return res
          .status(400)
          .json({ error: `Product not found: ${line.productId}` });
      }
      if (!p.supplierId) {
        return res.status(400).json({
          error: `Product ${p.id} has no supplier; cannot compute shipping.`,
        });
      }
      if (line.variantId) {
        const v = variantMap.get(line.variantId);
        if (!v)
          return res
            .status(400)
            .json({ error: `Variant not found: ${line.variantId}` });
        if (v.productId !== line.productId) {
          return res.status(400).json({
            error: `Variant ${line.variantId} does not belong to product ${line.productId}`,
          });
        }
      }
    }

    // group by supplier
    const bySupplier = new Map<
      string,
      Array<{
        qty: number;
        product: (typeof products)[number];
        variant: (typeof variants)[number] | null;
      }>
    >();

    for (const line of merged) {
      const product = productMap.get(line.productId)!;
      const variant = line.variantId ? variantMap.get(line.variantId)! : null;

      // we validated above that supplierId is present; assert for TS
      const sid = product.supplierId as string;

      const arr = bySupplier.get(sid) || [];
      arr.push({ qty: line.qty, product, variant });
      bySupplier.set(sid, arr);
    }

    const zones = await prisma.shippingZone.findMany({
      where: { isActive: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    const dstState = normalizeState(shippingAddress.state);
    const dstLga = normalizeLga(shippingAddress.lga || shippingAddress.town || "");

    const supplierQuotes: any[] = [];
    let totalShippingFee = 0;

    for (const [supplierId, rows] of bySupplier.entries()) {
      const supplier = rows[0]!.product.supplier;

      if (!supplier) {
        supplierQuotes.push({
          supplierId,
          error: "Supplier record missing for product(s) in cart",
          totalFee: 0,
        });
      } else {
        const pickupAddress =
          supplier.pickupAddress ?? supplier.registeredAddress ?? null;

        if (!pickupAddress) {
          supplierQuotes.push({
            supplierId,
            error: "Supplier pickup/registered address missing",
            totalFee: 0,
          });
        } else {
          const lineSnapshots = rows.map(({ qty, product, variant }) => {
            const perUnitActual = Math.max(
              0,
              toNum(variant?.weightGrams ?? product.weightGrams ?? 0)
            );

            const lengthCm = toNum(variant?.lengthCm ?? product.lengthCm ?? 0);
            const widthCm = toNum(variant?.widthCm ?? product.widthCm ?? 0);
            const heightCm = toNum(variant?.heightCm ?? product.heightCm ?? 0);

            const perUnitVol = volumetricWeightGrams(
              lengthCm,
              widthCm,
              heightCm,
              5000
            );

            const isFragile = !!(
              variant?.isFragileOverride ?? product.isFragile ?? false
            );
            const isBulky = !!(
              variant?.isBulkyOverride ?? product.isBulky ?? false
            );
            const shippingClass =
              variant?.shippingClassOverride ?? product.shippingClass ?? null;

            return {
              productId: product.id,
              variantId: variant?.id ?? null,
              title: product.title,
              qty,
              freeShipping: product.freeShipping === true,

              actualWeightGrams: perUnitActual * qty,
              volumetricWeightGrams: perUnitVol * qty,
              chargeableWeightGrams: Math.max(perUnitActual, perUnitVol) * qty,

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

          const parcelClass =
            lineSnapshots.some(
              (x) => x.parcelClass === ShippingParcelClass.BULKY
            )
              ? ShippingParcelClass.BULKY
              : lineSnapshots.some(
                  (x) => x.parcelClass === ShippingParcelClass.FRAGILE
                )
              ? ShippingParcelClass.FRAGILE
              : ShippingParcelClass.STANDARD;

          // zone match
          let matchedZone: (typeof zones)[number] | null = null;

          for (const zone of zones) {
            const states = Array.isArray(zone.statesJson)
              ? (zone.statesJson as unknown[])
              : [];
            const lgas = Array.isArray(zone.lgasJson)
              ? (zone.lgasJson as unknown[])
              : [];

            const statesNorm = states.map((x) => String(x).toLowerCase().trim());
            const lgasNorm = lgas.map((x) => String(x).toLowerCase().trim());

            const stateMatch =
              statesNorm.length === 0 || statesNorm.includes(dstState);
            const lgaMatch = lgasNorm.length === 0 || lgasNorm.includes(dstLga);

            if (stateMatch && lgaMatch) {
              matchedZone = zone;
              break;
            }
          }

          if (!matchedZone) {
            supplierQuotes.push({
              supplierId,
              error: `No shipping zone for destination state=${shippingAddress.state}${
                dstLga ? ` lga=${dstLga}` : ""
              }`,
              totalFee: 0,
            });
          } else {
            const now = new Date();

            const rateCards = await prisma.shippingRateCard.findMany({
              where: {
                zoneId: matchedZone.id,
                isActive: true,
                serviceLevel,
                parcelClass,
                minWeightGrams: { lte: chargeableWeightGrams },
                OR: [
                  { maxWeightGrams: null },
                  { maxWeightGrams: { gt: chargeableWeightGrams } },
                ],
                AND: [
                  { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                  { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                ],
              },
              orderBy: [{ minWeightGrams: "desc" }],
            });

            const rate = rateCards[0];

            if (!rate) {
              supplierQuotes.push({
                supplierId,
                zoneCode: matchedZone.code,
                zoneName: matchedZone.name,
                error: `No rate card for ${serviceLevel}/${parcelClass}/${chargeableWeightGrams}g`,
                totalFee: 0,
              });
            } else {
              const chargeableKg = chargeableWeightGrams / 1000;

              const baseFee = toNum(rate.baseFee);
              const perKgFee = toNum(rate.perKgFee);
              const remoteSurcharge = toNum(rate.remoteSurcharge);
              const fuelSurcharge = toNum(rate.fuelSurcharge);
              const rateHandling = toNum(rate.handlingFee);
              const supplierHandling = toNum(supplier.handlingFee);

              const shippingFee =
                baseFee + (perKgFee > 0 ? perKgFee * chargeableKg : 0);
              const allFreeShipping = lineSnapshots.every((x) => x.freeShipping);

              const totalFeeRaw = allFreeShipping
                ? 0
                : shippingFee +
                  remoteSurcharge +
                  fuelSurcharge +
                  rateHandling +
                  supplierHandling;

              const totalFee = Math.max(0, totalFeeRaw);

              supplierQuotes.push({
                supplierId,
                zoneCode: matchedZone.code,
                zoneName: matchedZone.name,
                currency: rate.currency || "NGN",
                serviceLevel,
                etaMinDays: rate.etaMinDays ?? supplier.defaultLeadDays ?? null,
                etaMaxDays: rate.etaMaxDays ?? supplier.defaultLeadDays ?? null,
                weights: {
                  actualWeightGrams: totalActualWeightGrams,
                  volumetricWeightGrams: totalVolumetricWeightGrams,
                  chargeableWeightGrams,
                },
                breakdown: {
                  shippingFee: round2(allFreeShipping ? 0 : shippingFee),
                  remoteSurcharge: round2(
                    allFreeShipping ? 0 : remoteSurcharge
                  ),
                  fuelSurcharge: round2(allFreeShipping ? 0 : fuelSurcharge),
                  handlingFee: round2(
                    allFreeShipping ? 0 : rateHandling + supplierHandling
                  ),
                  insuranceFee: 0,
                  totalFee: round2(totalFee),
                },
                items: lineSnapshots.map((x) => ({
                  productId: x.productId,
                  variantId: x.variantId,
                  title: x.title,
                  qty: x.qty,
                })),
              });

              totalShippingFee += totalFee;
            }
          }
        }
      }
    }

    const hasAnySuccess = supplierQuotes.some((q) => !q.error);
    const hasErrors = supplierQuotes.some((q) => !!q.error);

    return res.json({
      currency: "NGN",
      shippingFee: round2(totalShippingFee),
      suppliers: supplierQuotes,
      partial: hasAnySuccess && hasErrors,
      error: hasAnySuccess
        ? null
        : "Could not compute shipping for any supplier.",
    });
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return res
        .status(400)
        .json({ error: "Invalid shipping quote payload", details: e.errors });
    }
    console.error("POST /api/checkout/shipping-fee-local failed:", e);
    return res.status(500).json({ error: "Failed to compute shipping fee" });
  }
});

export default router;