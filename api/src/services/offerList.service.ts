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

// Returns canonical offers (base + variants) for the given products
export async function fetchOffersByProducts(productIds: string[]) {
  const ids = (productIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];

  // Schema-aligned:
  // - SupplierProductOffer: basePrice (1:1 with Product)
  // - SupplierVariantOffer: unitPrice (1:1 with ProductVariant)
  // Supplier info comes via Product.supplierId / Product.supplier
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

      // get supplier via product
      product: {
        select: {
          supplierId: true,
          supplier: { select: { id: true, name: true } },
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

    // BASE row
    out.push({
      id: `base:${b.id}`,
      model: "PRODUCT_OFFER",

      productId: b.productId,
      supplierId,
      supplierName,

      variantId: null,
      variantSku: null,

      offerPrice: basePrice, // base offer uses basePrice

      currency: b.currency ?? "NGN",
      availableQty: b.availableQty ?? 0,
      leadDays: b.leadDays ?? null,
      isActive: !!b.isActive,
      inStock: !!b.inStock,
    });

    // VARIANT rows (unitPrice is the full variant price)
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

  return out;
}