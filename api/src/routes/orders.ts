// src/routes/orders.ts
import { Router, type NextFunction, type Response, type Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { authMiddleware } from '../lib/authMiddleware.js';
import type { Decimal } from '@prisma/client/runtime/library';

type AuthedRequest = Request & {
  user?: { id: string; email?: string; role?: string };
};

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

type ProductRow = {
  id: string;
  supplierId: string;
  // Prisma can return Decimal|number|string depending on driver/config;
  // accept a union and normalize with Number(...) when using.
  price: Decimal | number | string;
};

router.post(
  '/',
  authMiddleware,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { items, tax, shipping } = CreateOrderSchema.parse(req.body);
      if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
      if (items.length === 0) return res.status(400).json({ error: 'No items' });

      // Fetch needed product fields
      const products: ProductRow[] = await prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) } },
        select: { id: true, supplierId: true, price: true },
      });

      // Fast lookup
      const prodById = new Map<string, ProductRow>(products.map((p) => [p.id, p]));

      // Totals (major units)
      let subtotal = 0;
      for (const it of items) {
        const p = prodById.get(it.productId);
        if (!p) return res.status(400).json({ error: `Unknown product: ${it.productId}` });
        const priceNum = Number(p.price as any);
        subtotal += priceNum * it.qty;
      }
      const total = subtotal + tax + shipping;

      // Create order + items
      const created = await prisma.order.create({
        data: {
          user: { connect: { id: req.user.id } },
          status: 'PENDING',
          total,    // Prisma will coerce number -> Decimal
          tax,
          shipping,
          items: {
            create: items.map((it) => {
              const p = prodById.get(it.productId)!;
              return {
                product: { connect: { id: p.id } },
                supplierRel: { connect: { id: p.supplierId } },
                qty: it.qty,
                // snapshot product price exactly; Prisma accepts Decimal|number|string
                unitPrice: p.price as any,
              };
            }),
          },
        },
        include: {
          items: { include: { product: { include: { supplier: true } } } },
        },
      });

      res.json({
        ...created,
        computedTotals: { subtotal, tax, shipping, total },
      });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
