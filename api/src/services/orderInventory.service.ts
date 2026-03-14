// api/src/services/orderInventory.service.ts
import { recomputeProductStockTx } from "./stockRecalc.service.js";
import { syncProductInStockCacheTx } from "./inventory.service.js";

const asNum = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function poStatusUpper(v: any) {
  return String(v ?? "").toUpperCase();
}

export async function hasSuccessfulPaymentForOrderTx(tx: any, orderId: string): Promise<boolean> {
  const payments = await tx.payment.findMany({
    where: { orderId },
    select: { status: true },
  });

  return payments.some((p: any) => {
    const s = String(p.status || "").toUpperCase();
    return s === "PAID";
  });
}

export async function restoreOrderItemStockTx(tx: any, orderItemId: string) {
  const it = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      productId: true,
      quantity: true,
      chosenSupplierProductOfferId: true,
      chosenSupplierVariantOfferId: true,
    },
  });

  if (!it) return;

  const qty = Math.max(0, asNum(it.quantity, 0));
  if (qty <= 0) return;

  if (it.chosenSupplierVariantOfferId) {
    const updatedOffer = await tx.supplierVariantOffer.update({
      where: { id: it.chosenSupplierVariantOfferId },
      data: { availableQty: { increment: qty } },
      select: { id: true, availableQty: true, productId: true },
    });

    if (asNum(updatedOffer.availableQty, 0) > 0) {
      await tx.supplierVariantOffer.update({
        where: { id: updatedOffer.id },
        data: { inStock: true },
      });
    }

    if (updatedOffer.productId) {
      await recomputeProductStockTx(tx, String(updatedOffer.productId));
    }
  } else if (it.chosenSupplierProductOfferId) {
    const updatedOffer = await tx.supplierProductOffer.update({
      where: { id: it.chosenSupplierProductOfferId },
      data: { availableQty: { increment: qty } },
      select: { id: true, availableQty: true, productId: true },
    });

    if (asNum(updatedOffer.availableQty, 0) > 0) {
      await tx.supplierProductOffer.update({
        where: { id: updatedOffer.id },
        data: { inStock: true },
      });
    }

    if (updatedOffer.productId) {
      await recomputeProductStockTx(tx, String(updatedOffer.productId));
    }
  }

  if (it.productId) {
    await syncProductInStockCacheTx(tx, String(it.productId));
  }
}

export async function restoreOrderInventoryTx(tx: any, orderId: string) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { id: true },
  });

  for (const it of items) {
    await restoreOrderItemStockTx(tx, String(it.id));
  }
}

export async function restorePurchaseOrderInventoryTx(tx: any, purchaseOrderId: string) {
  const poItems = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: { orderItemId: true },
  });

  for (const row of poItems) {
    await restoreOrderItemStockTx(tx, String(row.orderItemId));
  }
}

export function canAutoRestoreForRefund(poStatus: any): boolean {
  const s = poStatusUpper(poStatus);

  // Only auto-restock when the goods were not yet in the physical outbound flow.
  // If already shipped/delivered, money refund != inventory return.
  return !["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"].includes(s);
}

export async function markPendingPaymentsCanceledTx(
  tx: any,
  orderId: string,
  reason: string
) {
  const pending = await tx.payment.findMany({
    where: {
      orderId,
      status: "PENDING",
    },
    select: { id: true, reference: true },
  });

  for (const p of pending) {
    await tx.payment.update({
      where: { id: p.id },
      data: {
        status: "CANCELED",
      } as any,
    });

    await tx.paymentEvent.create({
      data: {
        paymentId: p.id,
        type: "PAYMENT_CANCELED",
        data: {
          reason,
          reference: p.reference,
          orderId,
        },
      },
    });
  }
}