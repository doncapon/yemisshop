import { prisma } from '../lib/prisma.js';
import { waSendText } from '../lib/whatsapp.js';
import { placeOnlineOrder, payOnlineOrder, getReceipt } from './supplierGateway.js';
import { pctOf, toMajor } from '../lib/money.js';

const DEFAULT_PHYSICAL_PAYOUT_PCT = 70; // %

export async function handlePaidOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { include: { supplier: true } } } },
      user: true
    }
  });
  if (!order) throw new Error('Order not found');

  // group items by supplier
  const bySupplier = new Map<string, any[]>();
  for (const it of order.items) {
    const sid = it.product.supplierId;
    if (!bySupplier.has(sid)) bySupplier.set(sid, []);
    bySupplier.get(sid)!.push(it);
  }

  const poIds: string[] = [];

  for (const [supplierId, items] of bySupplier.entries()) {
    const supplier = items[0].product.supplier;
    const effType = items[0].product.supplierTypeOverride ?? supplier.type; // PHYSICAL | ONLINE

    let subtotalMinor = 0;
    let platformFeeMinor = 0;
    let supplierAmountMinor = 0;
    let payoutPctInt = 0;

    // compute per-supplier money
    for (const it of items) {
      const line = it.unitPriceMinor * it.qty;

      if (effType === 'PHYSICAL') {
        const payPct = supplier.payoutPctInt ?? DEFAULT_PHYSICAL_PAYOUT_PCT;
        const supplierCut = pctOf(line, payPct);
        subtotalMinor += line;
        supplierAmountMinor += supplierCut;
        platformFeeMinor += line - supplierCut;
        payoutPctInt = payPct;
      } else {
        const commissionPctInt = it.product.commissionPctInt ?? 30; // default 30%
        const fee = pctOf(line, commissionPctInt);
        subtotalMinor += line;
        platformFeeMinor += fee;
        supplierAmountMinor += line - fee;
        payoutPctInt = 100 - commissionPctInt;
      }
    }

    // create PurchaseOrder (+ include items so we can reference POI ids)
    let po: any = await prisma.purchaseOrder.create({
      data: {
        orderId: order.id,
        supplierId,
        subtotalMinor,
        platformFeeMinor,
        supplierAmountMinor,
        payoutPctInt,
        items: { create: items.map((it: any) => ({ orderItemId: it.id })) }
      },
      include: { items: true }
    });

    let whatsappBodyExtra = '';

    // ONLINE: place + pay with supplier API, capture receipt
    if (effType === 'ONLINE') {
      let anyFail = false;
      const { apiBaseUrl, apiAuthType, apiKey } = supplier;

      for (const it of items) {
        const payload = {
          customer: {
            name: order.user.name ?? order.user.email,
            email: order.user.email,
            phone: order.user.phone,
            address: order.user.address
          },
          item: {
            sku: it.product.sku,
            title: it.product.title,
            qty: it.qty,
            unitPrice: Number(toMajor(it.unitPriceMinor))
          }
        };

        let placedRef: string | undefined;

        if (!apiBaseUrl) {
          anyFail = true;
          const poi = po.items.find((x: any) => x.orderItemId === it.id)!;
          await prisma.purchaseOrderItem.update({
            where: { id: poi.id },
            data: { externalStatus: 'FAILED', externalRef: 'NO_API_CONFIG' }
          });
        } else {
          // 1) Place
          const placed = await placeOnlineOrder(apiBaseUrl, apiAuthType as any, apiKey ?? undefined, payload);
          const placedData: any = placed.data ?? {};
          if (!placed.ok) {
            anyFail = true;
            const poi = po.items.find((x: any) => x.orderItemId === it.id)!;
            await prisma.purchaseOrderItem.update({
              where: { id: poi.id },
              data: { externalStatus: 'FAILED', externalRef: 'PLACE_FAILED' }
            });
            continue;
          }
          placedRef = placedData.id ?? placedData.orderId ?? placedData.reference;
          const poi = po.items.find((x: any) => x.orderItemId === it.id)!;
          await prisma.purchaseOrderItem.update({
            where: { id: poi.id },
            data: { externalStatus: 'PLACED', externalRef: placedRef }
          });

          // 2) Pay supplier
          const amountMajor = Number(toMajor(it.unitPriceMinor * it.qty));
          const paid = await payOnlineOrder(apiBaseUrl, apiAuthType as any, apiKey ?? undefined, placedRef!, amountMajor);
          if (!paid.ok) {
            anyFail = true;
            await prisma.purchaseOrderItem.update({ where: { id: poi.id }, data: { externalStatus: 'FAILED' } });
            continue;
          }
          await prisma.purchaseOrderItem.update({ where: { id: poi.id }, data: { externalStatus: 'PAID' } });

          // 3) Receipt
          const rec = await getReceipt(apiBaseUrl, apiAuthType as any, apiKey ?? undefined, placedRef!);
          if (rec.ok && rec.url) {
            await prisma.purchaseOrderItem.update({ where: { id: poi.id }, data: { receiptUrl: rec.url } });
          }
        }
      }

      if (anyFail) {
        po = await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'FAILED_PURCHASE' } });
      }

      const lines = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
      whatsappBodyExtra =
        '\nExternal purchase refs:\n' +
        lines
          .map((l: any) => `• ${l.orderItemId} — ${l.externalStatus ?? 'N/A'} ${l.externalRef ?? ''} ${l.receiptUrl ? `(${l.receiptUrl})` : ''}`)
          .join('\n');
    }

    // WhatsApp body
    const lineItems = items
      .map((it: any) => `• ${it.product.title} x${it.qty} @ ₦${toMajor(it.unitPriceMinor)}`)
      .join('\n');

    const body =
`PURCHASE ORDER #${po.id} (${effType})
Order #${order.id}

Customer:
- ${order.user.name ?? order.user.email}
- ${order.user.phone ?? '' }
- ${order.user.address ?? '' }

Items:
${lineItems}

Subtotal: ₦${toMajor(subtotalMinor)}
Platform fee: ₦${toMajor(platformFeeMinor)}
Supplier payout: ₦${toMajor(supplierAmountMinor)} (${payoutPctInt}%)
${whatsappBodyExtra}

Please fulfil and update status in your dashboard.`;

    try {
      if (supplier.whatsappPhone) {
        const msgId = await waSendText(supplier.whatsappPhone, body);
        await prisma.purchaseOrder.update({ where: { id: po.id }, data: { whatsappMsgId: msgId ?? undefined } });
      }
    } catch (err) {
      console.error('WhatsApp send failed:', err);
    }

    poIds.push(po.id);
  }

  return poIds;
}
