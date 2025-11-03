// api/src/lib/splits.ts
import { prisma } from '../lib/prisma.js';

/**
 * Computes a Paystack "split" plan from an order's items, based on
 * supplier COGS (chosenSupplierUnitPrice × quantity).
 *
 * Returns { parts: [{ supplierId, subaccount, amount }], totalPartsAmount }
 * or null if no valid parts/subaccounts.
 */
export async function computePaystackSplitForOrder(orderId: string) {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { chosenSupplierId: true, chosenSupplierUnitPrice: true, quantity: true },
  });

  const agg = new Map<string, number>();
  for (const it of items) {
    if (!it.chosenSupplierId) continue;
    const qty = Math.max(1, Number(it.quantity || 0));
    const cost = Number(it.chosenSupplierUnitPrice || 0) * qty;
    agg.set(it.chosenSupplierId, (agg.get(it.chosenSupplierId) || 0) + cost);
  }

  if (agg.size === 0) return null;

  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: Array.from(agg.keys()) } },
    select: { id: true, paystackSubaccountCode: true },
  });

  const parts = suppliers
    .filter((s: { paystackSubaccountCode: any; }) => !!s.paystackSubaccountCode)
    .map((s: { id: string; paystackSubaccountCode: any; }) => ({ supplierId: s.id, subaccount: s.paystackSubaccountCode!, amount: agg.get(s.id)! }))
    .filter((p: { amount: number; }) => p.amount > 0);

  if (parts.length === 0) return null;

  const totalPartsAmount = parts.reduce((s: any, p: { amount: any; }) => s + p.amount, 0);
  return { parts, totalPartsAmount };
}
