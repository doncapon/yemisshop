// api/src/services/offerList.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export function mapOffer(o: any) {
  return {
    id: o.id,
    productId: o.productId,
    variantId: o.variantId,
    supplierId: o.supplierId,
    supplierName: o.supplier?.name,
    price: Number(o.price),
    currency: o.currency,
    availableQty: o.availableQty,
    leadDays: o.leadDays,
    isActive: o.isActive,
    variantSku: o.variant?.sku,
  };
}

export async function fetchOffersByProducts(params: {
  productIds?: string[];
  productId?: string;
  active?: boolean;
}) {
  const where: Prisma.SupplierOfferWhereInput = {
    ...(params.productIds?.length ? { productId: { in: params.productIds } } : {}),
    ...(params.productId ? { productId: params.productId } : {}),
    ...(typeof params.active === 'boolean' ? { isActive: params.active } : {}),
  };

  const rows = await prisma.supplierOffer.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    include: {
      supplier: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true } },
    },
  });

  return rows.map(mapOffer);
}
