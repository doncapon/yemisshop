// src/routes/orders.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authMiddleware } from '../lib/authMiddleware.js';
import { requireRole } from '../lib/requireRole.js';

const router = Router();

/* ----------------------------- Validation ----------------------------- */

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
  homeAddress: AddressSchema.optional(),      // present if user is editing/adding home
  shippingAddress: AddressSchema.optional(),  // present if not sameAsHome
});

const MineQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.string().optional(), // comma list e.g. "PENDING,PAID"
  from: z.string().datetime().optional(),    // ISO
  to: z.string().datetime().optional(),      // ISO
  sortBy: z.enum(['createdAt', 'total', 'status']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

type ProductRow = {
  id: string;
  supplierId: string;
  price: Prisma.Decimal; // exact DB type
};

/* -------------------------------- Routes ------------------------------ */

/**
 * CREATE ORDER
 */
router.post(
  '/',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { items, tax, shipping, sameAsHome, homeAddress, shippingAddress } =
        CreateOrderSchema.parse(req.body);

      if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
      if (items.length === 0) return res.status(400).json({ error: 'No items' });

      // Fetch products to compute totals and validate
      const products = await prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) } },
        select: { id: true, supplierId: true, price: true },
      });

      const prodById = new Map<string, ProductRow>(products.map((p: { id: any; }) => [p.id, p]));
      let subtotal = 0;
      for (const it of items) {
        const p = prodById.get(it.productId);
        if (!p) return res.status(400).json({ error: `Unknown product: ${it.productId}` });
        subtotal += Number(p.price) * it.qty;
      }
      const total = subtotal + tax + shipping;

      // Transaction: ensure addresses and create order
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // 1) User with existing address refs
        const user = await tx.user.findUnique({
          where: { id: req.user!.id },
          select: { id: true, addressId: true, shippingAddressId: true },
        });
        if (!user) throw new Error('User not found');

        // 2) Home address upsert
        let homeAddressId = user.addressId || null;
        if (homeAddress && !user.addressId) {
          const createdHome = await tx.address.create({ data: homeAddress });
          await tx.user.update({ where: { id: user.id }, data: { addressId: createdHome.id } });
          homeAddressId = createdHome.id;
        } else if (homeAddress && user.addressId) {
          await tx.address.update({ where: { id: user.addressId }, data: homeAddress });
          homeAddressId = user.addressId;
        }

        // 3) Shipping address
        let shippingAddressId = user.shippingAddressId || null;
        if (sameAsHome) {
          if (!homeAddressId) throw new Error('Home address required when shipping is same as home.');
          shippingAddressId = homeAddressId;
        } else {
          if (shippingAddress) {
            if (!user.shippingAddressId) {
              const createdShip = await tx.address.create({ data: shippingAddress });
              await tx.user.update({
                where: { id: user.id },
                data: { shippingAddressId: createdShip.id },
              });
              shippingAddressId = createdShip.id;
            } else {
              await tx.address.update({
                where: { id: user.shippingAddressId },
                data: shippingAddress, // ✅ pass the address fields directly
              });
              shippingAddressId = user.shippingAddressId;
            }
          } else if (!user.shippingAddressId) {
            throw new Error('Shipping address is required if not same as home.');
          }
        }

        if (!shippingAddressId) throw new Error('Could not determine shipping address.');

        // 4) Create order + items
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
                const pr = prodById.get(it.productId)!;
                return {
                  product: { connect: { id: pr.id } },
                  supplierRel: { connect: { id: pr.supplierId } },
                  qty: it.qty,
                  unitPrice: pr.price,
                };
              }),
            },
          },
          include: {
            items: { include: { product: { select: { id: true, title: true, imagesJson: true } } } },
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
  },
);

/**
 * GET MY ORDERS (paginated/filterable/sortable)
 * Query params:
 *   page, pageSize, status=CSV, from, to, sortBy=createdAt|total|status, sortDir=asc|desc
 */
router.get(
  '/mine',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });

      const q = MineQuerySchema.parse(req.query);
      const skip = (q.page - 1) * q.pageSize;
      const take = q.pageSize;

      // Build where
      const where: Prisma.OrderWhereInput = {
        userId: req.user.id,
      };

      if (q.status) {
        const statuses = q.status
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        if (statuses.length > 0) {
          where.status = { in: statuses as any };
        }
      }

      if (q.from || q.to) {
        where.createdAt = {};
        if (q.from) (where.createdAt as any).gte = new Date(q.from);
        if (q.to) (where.createdAt as any).lte = new Date(q.to);
      }

      // Build orderBy
      let orderBy: Prisma.OrderOrderByWithRelationInput = { createdAt: q.sortDir };
      if (q.sortBy === 'total') orderBy = { total: q.sortDir };
      if (q.sortBy === 'status') orderBy = { status: q.sortDir };

      const [totalItems, data] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          orderBy,
          skip,
          take,
          include: {
            items: {
              include: {
                product: { select: { id: true, title: true, imagesJson: true } },
              },
            },
            payments: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                reference: true,
                amount: true,
                status: true,
                channel: true,
                createdAt: true,
              },
            },
            shippingAddress: true,
          },
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalItems / q.pageSize));

      res.json({
        page: q.page,
        pageSize: q.pageSize,
        totalItems,
        totalPages,
        sortBy: q.sortBy,
        sortDir: q.sortDir,
        data,
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET SINGLE ORDER (owner-only)
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, title: true, imagesJson: true } },
          },
        },
        payments: true,
        user: { select: { id: true, email: true } },
        shippingAddress: true,
      },
    });
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

    res.json(order);
  } catch (e) {
    next(e);
  }
});

/**
 * CANCEL ORDER (owner-only)
 * Allowed only when status is PENDING or PARTIAL, and no successful payment exists.
 */
router.post('/:id/cancel', authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

    // If already terminal or fully paid, disallow
    if (order.status === 'PAID' || order.status === 'CANCELED' || order.status === 'FAILED') {
      return res.status(400).json({ error: `Cannot cancel order in status ${order.status}` });
    }

    // If any PAID payment exists, disallow
    const hasPaid = order.payments?.some((p: { status: string; }) => p.status === 'PAID');
    if (hasPaid) return res.status(400).json({ error: 'Order already has a successful payment' });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELED' },
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});


//------------- ADMIN GetOrders
const AdminQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),            // "PENDING,PAID"
  from: z.string().datetime().optional(),   // ISO
  to: z.string().datetime().optional(),     // ISO
  userId: z.string().optional(),            // filter by a specific user
  email: z.string().email().optional(),     // or by user email
  sortBy: z.enum(['createdAt', 'total', 'status']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  includeUser: z.coerce.boolean().optional().default(false),
});

/** ADMIN: list all orders */
router.get(
  '/',
  authMiddleware,
  requireRole('ADMIN'),
  async (req, res, next) => {
    try {
      const q = AdminQuerySchema.parse(req.query);
      const skip = (q.page - 1) * q.pageSize;
      const take = q.pageSize;

      // Build base where
      const where: Prisma.OrderWhereInput = {};

      if (q.status) {
        const statuses = q.status.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (statuses.length) where.status = { in: statuses as any };
      }

      if (q.from || q.to) {
        where.createdAt = {};
        if (q.from) (where.createdAt as any).gte = new Date(q.from);
        if (q.to) (where.createdAt as any).lte = new Date(q.to);
      }

      // Filter by user
      if (q.userId) {
        where.userId = q.userId;
      } else if (q.email) {
        // look up user by email once
        const user = await prisma.user.findUnique({ where: { email: q.email }, select: { id: true } });
        // If no user found by that email, return empty set
        if (!user) return res.json({ page: q.page, pageSize: q.pageSize, totalItems: 0, totalPages: 1, data: [] });
        where.userId = user.id;
      }

      // Sorting
      let orderBy: Prisma.OrderOrderByWithRelationInput = { createdAt: q.sortDir };
      if (q.sortBy === 'total') orderBy = { total: q.sortDir };
      if (q.sortBy === 'status') orderBy = { status: q.sortDir };

      const [totalItems, data] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          orderBy,
          skip,
          take,
          include: {
            items: {
              include: {
                product: { select: { id: true, title: true, imagesJson: true } },
              },
            },
            payments: {
              orderBy: { createdAt: 'desc' },
              select: { id: true, reference: true, amount: true, status: true, channel: true, createdAt: true },
            },
            shippingAddress: true,
            ...(q.includeUser ? { user: { select: { id: true, email: true, firstName: true, lastName: true } } } : {}),
          },
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalItems / q.pageSize));

      res.json({
        page: q.page,
        pageSize: q.pageSize,
        totalItems,
        totalPages,
        sortBy: q.sortBy,
        sortDir: q.sortDir,
        data,
      });
    } catch (e) {
      next(e);
    }
  }
);


export default router;
