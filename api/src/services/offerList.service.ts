// api/src/services/offerList.service.ts
import { prisma } from '../lib/prisma.js';

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
  model: 'PRODUCT_OFFER' | 'VARIANT_OFFER';
};

export async function fetchOffersByProducts(productIds: string[]) {
  const ids = (productIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];

  const bases = await prisma.supplierProductOffer.findMany({
    where: {
      productId: { in: ids },
    },
    select: {
      id: true,
      productId: true,
      supplierId: true,

      // ✅ real fields that exist
      basePrice: true,
      currency: true,
      availableQty: true,
      inStock: true,
      isActive: true,
      leadDays: true,

      supplier: { select: { id: true, name: true } },

      // ✅ variants live under the base in your schema
      variantOffers: {
        select: {
          id: true,
          productId: true,
          supplierId: true,
          variantId: true,

          priceBump: true,
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
    const basePrice = b.basePrice != null ? Number(b.basePrice) : 0;

    // BASE row
    out.push({
      id: `base:${b.id}`,
      kind: "BASE",
      productId: b.productId,
      supplierId: b.supplierId,
      supplierName: b.supplier?.name,

      variantId: null,
      variantSku: null,

      basePrice,
      priceBump: 0,
      offerPrice: basePrice, // ✅ computed

      currency: b.currency ?? "NGN",
      availableQty: b.availableQty ?? 0,
      leadDays: b.leadDays ?? null,
      isActive: !!b.isActive,
      inStock: !!b.inStock,
    });

    // VARIANT rows
    for (const v of b.variantOffers || []) {
      const bump = v.priceBump != null ? Number(v.priceBump) : 0;

      out.push({
        id: `variant:${v.id}`,
        kind: "VARIANT",
        productId: v.productId ?? b.productId,
        supplierId: v.supplierId ?? b.supplierId,
        supplierName: b.supplier?.name,

        variantId: v.variantId,
        variantSku: v.variant?.sku ?? null,

        basePrice,
        priceBump: bump,
        offerPrice: basePrice + bump, // ✅ computed

        currency: b.currency ?? "NGN",
        availableQty: v.availableQty ?? 0,
        leadDays: v.leadDays ?? null,
        isActive: !!v.isActive,
        inStock: !!v.inStock,
      });
    }
  }

  return out;
}

