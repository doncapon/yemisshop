import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { toMinor } from '../lib/money.js';

const router = Router();

const orderSchema = z.object({
  items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })),
  shipping: z.coerce.number().nonnegative().default(0),
  tax: z.coerce.number().nonnegative().default(0)
});

router.post('/', auth(), requireRole('SHOPPER', 'ADMIN'), async (req: any, res) => {
  const { items, shipping, tax } = orderSchema.parse(req.body);

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i: any) => i.productId) } },
    include: { supplier: true }
  });
  if (products.length !== items.length) {
    return res.status(400).json({ error: 'Invalid product(s)' });
  }

  // stock check
  for (const it of items) {
    const p = products.find((p: any) => p.id === it.productId)!;
    if (p.stock < it.qty) {
      return res.status(409).json({ error: `Insufficient stock for ${p.title}` });
    }
  }

  // totals in minor units
  const subtotalMinor = items.reduce((sum: number, it: any) => {
    const p = products.find((p: any) => p.id === it.productId)!;
    return sum + p.priceMinor * it.qty;
  }, 0);
  const shippingMinor = toMinor(shipping);
  const taxMinor = toMinor(tax);
  const totalMinor = subtotalMinor + shippingMinor + taxMinor;

  const order = await prisma.$transaction(async (tx: any) => {
    // decrement stock per item
    for (const it of items) {
      await tx.product.update({
        where: { id: it.productId },
        data: { stock: { decrement: it.qty } }
      });
    }

    return tx.order.create({
      data: {
        userId: req.user!.id,
        totalMinor,
        taxMinor,
        shippingMinor,
        items: {
          create: items.map((it: any) => {
            const p = products.find((p: any) => p.id === it.productId)!;
            return {
              productId: p.id,
              supplierId: p.supplierId,
              qty: it.qty,
              unitPriceMinor: p.priceMinor
            };
          })
        }
      },
      include: { items: true }
    });
  });

  res.status(201).json(order);
});

export default router;
