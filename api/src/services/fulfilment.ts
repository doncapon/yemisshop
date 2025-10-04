// src/services/fulfilment.ts
import { prisma } from '../lib/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';
import { waSendText } from '../lib/whatsapp.js';
import {
  callSupplierPlaceOrder,
  callSupplierPay,
  callSupplierReceipt,
  type SupplierResponse,
} from './supplierGateway.js';

const DEFAULT_PHYSICAL_PAYOUT = 70; // percent

// ---------- helpers ----------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Pull a supplier reference from a response payload (id | orderId | reference). */
function extractSupplierRef(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const candidates = ['id', 'orderId', 'reference'] as const;
  for (const k of candidates) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** Pull a receipt URL from a response payload (url | link). */
function extractReceiptUrl(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const candidates = ['url', 'link'] as const;
  for (const k of candidates) {
    const v = data[k];
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }
  return undefined;
}

// ---------- main ----------
export async function handlePaidOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { include: { supplier: true } } } },
      user: true,
    },
  });
  if (!order) return;

  // Group order items by supplier
  type Item = (typeof order.items)[number];
  const bySupplier = new Map<string, Item[]>();
  for (const it of order.items) {
    const arr = bySupplier.get(it.supplierId) ?? [];
    arr.push(it);
    bySupplier.set(it.supplierId, arr);
  }

  // Process per-supplier
  for (const [supplierId, items] of bySupplier) {
    const supplier = items[0].product.supplier;

    // ---- Money math (Decimal) ----
    const subtotal = items.reduce<Decimal>((sum, it) => {
      const unit = new Decimal(it.unitPrice.toString());
      const line = unit.mul(it.qty);
      return sum.plus(line) as Decimal;
    }, new Decimal(0));

    let platformFee = new Decimal(0);
    let supplierAmount = new Decimal(0);
    const payoutPct = supplier.payoutPctInt ?? DEFAULT_PHYSICAL_PAYOUT;

    if (supplier.type === 'PHYSICAL') {
      supplierAmount = subtotal.mul(payoutPct);
      platformFee = subtotal.minus(supplierAmount);
    } else {
      // ONLINE: commission per product (default 30%)
      const totalPlatform = items.reduce<Decimal>((sum, it) => {
        const commPct = new Decimal(it.product.commissionPctInt ?? 30);
        const unit = new Decimal(it.unitPrice.toString());
        const line = unit.mul(it.qty);
        const fee = line.mul(commPct);
        return sum.plus(fee) as Decimal;
      }, new Decimal(0));
      platformFee = totalPlatform;
      supplierAmount = subtotal.minus(platformFee);
    }

    // ---- Create Purchase Order ----
    const po = await prisma.purchaseOrder.create({
      data: {
        orderId: order.id,
        supplierId,
        subtotal: subtotal.toNumber(),
        platformFee: platformFee.toNumber(),
        supplierAmount: supplierAmount.toNumber(),
        payoutPctInt: payoutPct,
        status: 'CREATED',
        items: { create: items.map((it) => ({ orderItemId: it.id })) },
      },
      include: { items: true },
    });

    // Fast lookup: orderItemId -> purchaseOrderItem (avoid .find() callbacks)
    type PoItem = (typeof po.items)[number];
    const poItemByOrderItemId = new Map<string, PoItem>();
    for (const i of po.items as PoItem[]) {
      poItemByOrderItemId.set(i.orderItemId, i);
    }

    if (supplier.type === 'PHYSICAL') {
      // ---- PHYSICAL: WhatsApp notification (payout summary) ----
      const lineItems = items
        .map(
          (it) =>
            `• ${it.product.title} x${it.qty} @ ₦${new Decimal(
              it.unitPrice.toString(),
            )
              .toNumber()
              .toFixed(2)}`,
        )
        .join('\n');

      const body =
        `New Order PO#${po.id}\n` +
        `Customer: ${order.user.name || order.user.email}\n` +
        `Address: ${order.user.address || 'N/A'}\n` +
        `Items:\n${lineItems}\n` +
        `Subtotal: ₦${subtotal.toFixed(2)}\n` +
        `Payout (${payoutPct}%): ₦${supplierAmount.toFixed(2)}\n`;

      if (supplier.whatsappPhone) {
        const msgId = await waSendText(supplier.whatsappPhone, body);
        if (msgId) {
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { whatsappMsgId: msgId },
          });
        }
      }
    } else {
      // ---- ONLINE: place -> pay -> receipt (per item) ----
      for (const it of items) {
        // place
        const placed: SupplierResponse<unknown> = await callSupplierPlaceOrder(
          supplier,
          {
            productId: it.productId,
            qty: it.qty,
            price: new Decimal(it.unitPrice.toString()).toNumber(),
          },
        );
        const placedRef = extractSupplierRef(placed.data);

        if (placed.ok && placedRef) {
          const poi = poItemByOrderItemId.get(it.id);
          if (poi) {
            await prisma.purchaseOrderItem.update({
              where: { id: poi.id },
              data: { externalRef: placedRef, externalStatus: 'PLACED' },
            });
          }
        }

        // pay
        const amount = new Decimal(it.unitPrice.toString())
          .mul(it.qty)
          .toNumber();
        const paid: SupplierResponse<unknown> = await callSupplierPay(
          supplier,
          { reference: placedRef, amount },
        );

        if (paid.ok) {
          const poi = poItemByOrderItemId.get(it.id);
          if (poi) {
            await prisma.purchaseOrderItem.update({
              where: { id: poi.id },
              data: { externalStatus: 'PAID' },
            });
          }
        }

        // receipt
        const receipt: SupplierResponse<unknown> = await callSupplierReceipt(
          supplier,
          { reference: placedRef },
        );
        const receiptUrl = extractReceiptUrl(receipt.data);

        if (receipt.ok && receiptUrl) {
          const poi = poItemByOrderItemId.get(it.id);
          if (poi) {
            await prisma.purchaseOrderItem.update({
              where: { id: poi.id },
              data: { receiptUrl },
            });
          }
        }
      }

      // WhatsApp summary including receipt links
      const lines = await prisma.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      });

      type PurchaseOrderItemRow = (typeof lines)[number];
      const lineText = lines
        .map((l: PurchaseOrderItemRow) => {
          const status = l.externalStatus ?? 'N/A';
          const ref = l.externalRef ?? '';
          const receipt = l.receiptUrl ? `(${l.receiptUrl})` : '';
          return `• ${l.orderItemId} — ${status} ${ref} ${receipt}`;
        })
        .join('\n');

      const msg =
        `ONLINE Order PO#${po.id}\n` +
        `Customer: ${order.user.name || order.user.email}\n` +
        `Address: ${order.user.address || 'N/A'}\n` +
        `${lineText}\n` +
        `Subtotal: ₦${subtotal.toFixed(2)} | Platform Fee: ₦${platformFee.toFixed(
          2,
        )} | Supplier: ₦${supplierAmount.toFixed(2)}`;

      if (supplier.whatsappPhone) {
        const msgId = await waSendText(supplier.whatsappPhone, msg);
        if (msgId) {
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { whatsappMsgId: msgId },
          });
        }
      }
    }
  }
}
