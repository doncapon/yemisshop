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

  // Schema-aligned:
  // - SupplierProductOffer: basePrice
  // - SupplierVariantOffer: unitPrice (full unit price; no priceBump concept)
  const bases = await prisma.supplierProductOffer.findMany({
    where: { productId: { in: ids } },
    select: {
      id: true,
      productId: true,
      supplierId: true,

      basePrice: true,
      currency: true,
      availableQty: true,
      inStock: true,
      isActive: true,
      leadDays: true,

      supplier: { select: { id: true, name: true } },

      variantOffers: {
        select: {
          id: true,
          productId: true,
          supplierId: true,
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

    // BASE row
    out.push({
      id: `base:${b.id}`,
      model: "PRODUCT_OFFER",

      productId: b.productId,
      supplierId: b.supplierId,
      supplierName: b.supplier?.name,

      variantId: null,
      variantSku: null,

      offerPrice: basePrice, // ✅ base offer uses basePrice

      currency: b.currency ?? "NGN",
      availableQty: b.availableQty ?? 0,
      leadDays: b.leadDays ?? null,
      isActive: !!b.isActive,
      inStock: !!b.inStock,
    });

    // VARIANT rows (no bumps; unitPrice is already the full price)
    for (const v of b.variantOffers || []) {
      const unitPrice = asNumber(v.unitPrice, 0);

      out.push({
        id: `variant:${v.id}`,
        model: "VARIANT_OFFER",

        productId: v.productId ?? b.productId,
        supplierId: v.supplierId ?? b.supplierId,
        supplierName: b.supplier?.name,

        variantId: v.variantId,
        variantSku: v.variant?.sku ?? null,

        offerPrice: unitPrice, // ✅ variant offer uses unitPrice (full unit price)

        currency: v.currency ?? b.currency ?? "NGN",
        availableQty: v.availableQty ?? 0,
        leadDays: v.leadDays ?? null,
        isActive: !!v.isActive,
        inStock: !!v.inStock,
      });
    }
  }

  return out;
}
