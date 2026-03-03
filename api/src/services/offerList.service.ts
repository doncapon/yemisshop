// api/src/services/offerList.service.ts
import { prisma } from "../lib/prisma.js";

const asNumber = (v: any, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export type OfferListRow = {
  id: string;
  productId: string;
  variantId: string | null;
  supplierId: string | null;
  availableQty: number;
  offerPrice: number;
  isActive: boolean;
  inStock: boolean;
  model: "PRODUCT_OFFER" | "VARIANT_OFFER";
};

export async function fetchOffersByProducts(productIds: string[]) {
  const ids = (productIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];

  // Option A:
  // - SupplierProductOffer is the single base offer per product
  // - SupplierVariantOffer is the single variant-level offer per variant
  // - Both belong to the product's canonical supplier via Product.supplierId
  const bases = await prisma.supplierProductOffer.findMany({
    where: { productId: { in: ids } },
    select: {
      id: true,
      productId: true,

      basePrice: true,
      currency: true,
      availableQty: true,
      inStock: true,
      isActive: true,
      leadDays: true,

      // supplier info now comes from the Product
      product: {
        select: {
          supplierId: true,
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },

      variantOffers: {
        select: {
          id: true,
          productId: true,
          variantId: true,

          unitPrice: true,
          currency: true,
          availableQty: true,
          inStock: true,
          isActive: true,
          leadDays: true,

          variant: { select: { id: true, sku: true } },
        },
      },
    },
  });

  const out: any[] = [];

  for (const b of bases) {
    const basePrice = asNumber(b.basePrice, 0);
    const supplierId = b.product?.supplierId ?? null;
    const supplierName = b.product?.supplier?.name ?? null;

    // BASE row (single platform/base offer for the product)
    out.push({
      id: `base:${b.id}`,
      model: "PRODUCT_OFFER",

      productId: b.productId,
      supplierId,
      supplierName,

      variantId: null,
      variantSku: null,

      offerPrice: basePrice,
      currency: b.currency ?? "NGN",
      availableQty: b.availableQty ?? 0,
      leadDays: b.leadDays ?? null,
      isActive: !!b.isActive,
      inStock: !!b.inStock,
    });

    // VARIANT rows: one per variant, still owned by the same product/supplier
    for (const v of b.variantOffers || []) {
      const unitPrice = asNumber(v.unitPrice, 0);

      out.push({
        id: `variant:${v.id}`,
        model: "VARIANT_OFFER",

        productId: v.productId ?? b.productId,
        supplierId,
        supplierName,

        variantId: v.variantId,
        variantSku: v.variant?.sku ?? null,

        offerPrice: unitPrice,
        currency: v.currency ?? b.currency ?? "NGN",
        availableQty: v.availableQty ?? 0,
        leadDays: v.leadDays ?? null,
        isActive: !!v.isActive,
        inStock: !!v.inStock,
      });
    }
  }

  return out as OfferListRow[];
}