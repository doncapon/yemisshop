// src/modules/inventory/inventory.service.ts
import { prisma } from '../lib/prisma.js';

/** Pure derive (no DB writes) */
export async function deriveProductInStock(productId: string): Promise<boolean> {
  const { _sum } = await prisma.supplierOffer.aggregate({
    where: { productId, isActive: true },
    _sum: { availableQty: true },
  });
  const total = _sum.availableQty ?? 0;
  return total > 0;
}

/** Transaction variant for use inside $transaction */
export async function deriveProductInStockTx(tx: typeof prisma, productId: string): Promise<boolean> {
  const { _sum } = await tx.supplierOffer.aggregate({
    where: { productId, isActive: true },
    _sum: { availableQty: true },
  });
  const total = _sum.availableQty ?? 0;
  return total > 0;
}

/**
 * Optional cache-write to Product.inStock for fast filtering.
 * (Keeps your existing column but treats it as a cache.)
 */
export async function syncProductInStockCache(productId: string) {
  const derived = await deriveProductInStock(productId);
  await prisma.product.update({ where: { id: productId }, data: { inStock: derived } });
}

/** Tx variant */
export async function syncProductInStockCacheTx(tx: typeof prisma, productId: string) {
  const derived = await deriveProductInStockTx(tx, productId);
  await tx.product.update({ where: { id: productId }, data: { inStock: derived } });
}
