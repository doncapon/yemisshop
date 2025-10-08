import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authMiddleware } from '../lib/authMiddleware.js';

const router = Router();

const AddressSchema = z.object({
  houseNumber: z.string().min(1),
  streetName: z.string().min(1),
  postCode: z.string().optional().nullable(),
  town: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
});

const CreateOrderSchema = z.object({
  items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })),
  tax: z.number().nonnegative().default(0),
  shipping: z.number().nonnegative().default(0),
  sameAsHome: z.boolean().default(true),
  homeAddress: AddressSchema.optional(),           // present if user is editing/adding home
  shippingAddress: AddressSchema.optional(),       // present if not sameAsHome and adding/editing
});

type ProductRow = {
  id: string;
  supplierId: string;
  price: Prisma.Decimal; // exact DB type
};

router.post(
  '/',
  authMiddleware, // ensure req.user is set
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { items, tax, shipping, sameAsHome, homeAddress, shippingAddress } =
        CreateOrderSchema.parse(req.body);

      if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
      if (items.length === 0) return res.status(400).json({ error: 'No items' });

      // Fetch products to compute totals and validate supplier/product
      const products = await prisma.product.findMany({
        where: { id: { in: items.map(i => i.productId) } },
        select: { id: true, supplierId: true, price: true },
      });
      const prodById = new Map<string, ProductRow>(
        products.map((p: { id: any; }) => [p.id, p])
      );
      let subtotal = 0;
      for (const it of items) {
        const p = prodById.get(it.productId);
        if (!p) return res.status(400).json({ error: `Unknown product: ${it.productId}` });
        subtotal += Number(p.price) * it.qty;
      }
      const total = subtotal + tax + shipping;

      // Run everything in a single transaction
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // 1) Load user (to know existing addresses)
        const user = await tx.user.findUnique({
          where: { id: req.user!.id },
          select: { id: true, addressId: true, shippingAddressId: true },
        });
        if (!user) throw new Error('User not found');

        // 2) Ensure we have a home address id (if provided / missing)
        let homeAddressId = user.addressId || null;
        if (homeAddress && (!user.addressId)) {
          const createdHome = await tx.address.create({ data: homeAddress });
          await tx.user.update({
            where: { id: user.id },
            data: { addressId: createdHome.id },
          });
          homeAddressId = createdHome.id;
        } else if (homeAddress && user.addressId) {
          // If you want to update existing home address when form is shown:
          await tx.address.update({
            where: { id: user.addressId },
            data: homeAddress,
          });
          homeAddressId = user.addressId;
        }

        // 3) Determine shipping address id
        let shippingAddressId = user.shippingAddressId || null;
        if (sameAsHome) {
          // Use home address as shipping
          if (!homeAddressId) {
            // If user never had home and didn’t send it, error out
            throw new Error('Home address required when shipping is same as home.');
          }
          shippingAddressId = homeAddressId;
          // You may choose NOT to overwrite user's shippingAddressId with home; most people keep it separate.
        } else {
          // Not same as home → need a shipping address
          if (shippingAddress) {
            if (!user.shippingAddressId) {
              const createdShip = await tx.address.create({ data: shippingAddress });
              await tx.user.update({
                where: { id: user.id },
                data: { shippingAddressId: createdShip.id },
              });
              shippingAddressId = createdShip.id;
            } else {
              // Update existing shipping
              await tx.address.update({
                where: { id: user.shippingAddressId },
                data: shippingAddress,
              });
              shippingAddressId = user.shippingAddressId;
            }
          } else if (!user.shippingAddressId) {
            throw new Error('Shipping address is required if not same as home.');
          }
        }

        if (!shippingAddressId) {
          throw new Error('Could not determine shipping address.');
        }

        // 4) Create order + items (connect shippingAddress)
        const order = await tx.order.create({
          data: {
            user: { connect: { id: user.id } },
            status: 'PENDING',
            total,
            tax,
            shipping,
            shippingAddress: { connect: { id: shippingAddressId } },
            items: {
              create: items.map((it) => {
                const pr = prodById.get(it.productId);
                if (!pr) {
                  // Extra safety, though you already validated earlier
                  throw new Error(`Unknown product: ${it.productId}`);
                }
                return {
                  product: { connect: { id: pr.id } },
                  supplierRel: { connect: { id: pr.supplierId } },
                  qty: it.qty,
                  unitPrice: pr.price, // Prisma.Decimal → matches schema
                };
              }),
            },

          },
          include: {
            items: { include: { product: { include: { supplier: true } } } },
            shippingAddress: true,
          },
        });

        return order;
      });

      res.json({
        ...created,
        computedTotals: { subtotal, tax, shipping, total },
      });
    } catch (e: any) {
      if (e?.message === 'User not found' || e?.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next(e);
    }
  }
);


router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id;
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, payments: true, user: { select: { email: true } } },
    });
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

    res.json(order);
  } catch (e) { next(e); }
});

export default router;
