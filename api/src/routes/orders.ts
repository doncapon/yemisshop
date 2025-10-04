// src/routes/orders.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { authMiddleware, AuthedRequest } from '../lib/authMiddleware.js';
import type { Prisma } from '@prisma/client';


const router = Router();

const CreateOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      qty: z.number().int().positive(),
    })
  ),
  tax: z.number().nonnegative().default(0),
  shipping: z.number().nonnegative().default(0),
});
type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

type ProductRow = Prisma.ProductGetPayload<{
  select: { id: true; price: true; supplierId: true };
}>;

router.post('/', authMiddleware, async (req: AuthedRequest, res, next) => {
  try {
    const { items, tax, shipping }: CreateOrderInput = CreateOrderSchema.parse(req.body);
    if (items.length === 0) return res.status(400).json({ error: 'No items' });

    const products: ProductRow[] = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      select: { id: true, price: true, supplierId: true },
    });

    const prodById = new Map<string, ProductRow>(products.map((p) => [p.id, p]));

// Compute totals in major units (numbers are fine; Prisma will cast to Decimal)
let subtotal = 0;
for (const it of items) {
  const p = prodById.get(it.productId);
  if (!p) return res.status(400).json({ error: `Unknown product: ${it.productId}` });
  subtotal += Number(p.price) * it.qty;
}
const total = subtotal + tax + shipping;

const order = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
  const created = await tx.order.create({
    data: {
      user: { connect: { id: req.user!.id } },
      status: 'PENDING',
      total,            // Prisma Decimal column (number/string/Decimal all OK)
      tax,
      shipping,
      items: {
        create: items.map((it): Prisma.OrderItemCreateWithoutOrderInput => {
          const p = prodById.get(it.productId)!;
          return {
            qty: it.qty,
            unitPrice: p.price,                 // ✅ Decimal from Product
            product: { connect: { id: p.id } }, // relation (checked create)
            // If your relation is named `supplier` use that; if it's `supplierRel`, keep as is:
            supplierRel: { connect: { id: p.supplierId } },
            // supplierRel: { connect: { id: p.supplierId } }, // ← use this instead if that’s your field name
          };
        }),
      },
    },
    include: {
      items: { include: { product: { include: { supplier: true } } } },
      // purchaseOrders: { include: { items: true, supplier: true } }, // add if you create POs synchronously
    },
  });
  return created;
});

// Respond with computed totals for UI convenience
res.json({
  ...order,
  computedTotals: { subtotal, tax, shipping, total },
});

  } catch (e) {
    next(e);
  }
});

export default router;
