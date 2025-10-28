// src/modules/supplierOffer/supplierOffer.service.ts
import { prisma } from '../lib/prisma.js';
import { syncProductInStockCacheTx } from './inventory.service.js';

export async function updateSupplierOffer(id: string, data: {
  price?: number; currency?: string; isActive?: boolean;
  availableQty?: number; leadDays?: number | null;
}) {
  return prisma.$transaction(async (tx: any) => {
    const current = await tx.supplierOffer.findUnique({
      where: { id }, select: { id: true, productId: true }
    });
    if (!current) throw new Error('Offer not found');

    const updated = await tx.supplierOffer.update({
      where: { id },
      data,
      select: { id: true, productId: true, availableQty: true }
    });

    await syncProductInStockCacheTx(tx, updated.productId);
    return updated;
  });
}

export async function restockSupplierOffer(id: string, delta: number) {
  if (!Number.isFinite(delta)) throw new Error('Invalid delta');
  return prisma.$transaction(async (tx: any) => {
    const current = await tx.supplierOffer.findUnique({
      where: { id }, select: { id: true, productId: true, availableQty: true }
    });
    if (!current) throw new Error('Offer not found');

    const nextQty = current.availableQty + Math.trunc(delta);
    if (nextQty < 0) throw new Error('Resulting quantity would be negative');

    const updated = await tx.supplierOffer.update({
      where: { id },
      data: { availableQty: nextQty },
      select: { id: true, productId: true, availableQty: true }
    });

    await syncProductInStockCacheTx(tx, updated.productId);
    return updated;
  });
}
