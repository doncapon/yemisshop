import { Prisma, type PrismaClient } from "@prisma/client";

function toDecimal(n: any) {
  return new Prisma.Decimal(String(n ?? 0));
}

/**
 * Creates a ledger DEBIT for supplier to "pay back" refunded value.
 * Use this when the supplier has already been paid (allocation PAID),
 * or if you want to always debit supplier for SUPPLIER_FAULT.
 */
export async function createSupplierRefundDebitTx(
  tx: PrismaClient,
  args: {
    supplierId: string;
    orderId: string;
    purchaseOrderId: string;
    refundId: string;
    amount: Prisma.Decimal | string | number;
    meta?: any;
  }
) {
  const amount = toDecimal(args.amount);

  if (amount.lte(0)) return null;

  return tx.supplierLedgerEntry.create({
    data: {
      supplierId: args.supplierId,
      type: "DEBIT", // or SupplierLedgerType.DEBIT if you add enum
      amount,
      currency: "NGN",
      referenceType: "REFUND",
      referenceId: args.refundId,
      meta: {
        orderId: args.orderId,
        purchaseOrderId: args.purchaseOrderId,
        ...args.meta,
      },
    },
  });
}

/**
 * Use allocations as truth for supplier amounts per PO.
 * This returns supplier debit plan grouped by PO.
 */
export async function computeSupplierRefundDebitsForOrder(
  tx: PrismaClient,
  orderId: string
) {
  const allocs = await tx.supplierPaymentAllocation.findMany({
    where: {
      orderId,
      status: "PAID", // only debit suppliers who were already paid out
    },
    select: {
      supplierId: true,
      purchaseOrderId: true,
      amount: true,
      paymentId: true,
    },
  });

  // group by supplierId+purchaseOrderId
  const groups = new Map<string, { supplierId: string; purchaseOrderId: string; amount: Prisma.Decimal; paymentIds: Set<string> }>();

  for (const a of allocs) {
    if (!a.purchaseOrderId) continue;
    const key = `${a.supplierId}::${a.purchaseOrderId}`;
    const cur = groups.get(key) ?? {
      supplierId: String(a.supplierId),
      purchaseOrderId: String(a.purchaseOrderId),
      amount: new Prisma.Decimal("0"),
      paymentIds: new Set<string>(),
    };
    cur.amount = cur.amount.add(a.amount ?? new Prisma.Decimal("0"));
    if (a.paymentId) cur.paymentIds.add(String(a.paymentId));
    groups.set(key, cur);
  }

  return Array.from(groups.values()).map((g) => ({
    supplierId: g.supplierId,
    purchaseOrderId: g.purchaseOrderId,
    amount: g.amount,
    paymentIds: Array.from(g.paymentIds),
  }));
}
