// api/src/routes/admin.ts
import express, { Router } from 'express';
import { requireAuth, requireAdmin , requireSuperAdmin} from '../middleware/auth.js';
import { z } from 'zod';


import {
  getOverview,
  findUsers,
  suspendUser,
  reactivateUser,
  
  markPaymentPaid,
  markPaymentRefunded,

  listPayments as listPaymentsSvc,
  opsSnapshot as opsSnapshotSvc
} from '../services/admin.service.js';
import { toCsv } from '../lib/csv.js';
import { startOfDay, subDays } from 'date-fns';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { requiredString } from '../lib/http.js';

const r = Router();
r.use(requireAuth, requireAdmin);

/* Overview */
r.get('/overview', async (_req, res) => {
  res.json(await getOverview());
});

/* Users & roles */
r.get('/users', async (req, res) => {
  const q = String(req.query.q || '');
  res.json({ data: await findUsers(q) });
});

r.post('/users/:userId/deactivate',  requireSuperAdmin, async (req, res) => {
  res.json(await suspendUser(requiredString(req.params.userId)));
});

r.post('/users/:userId/reactivate',  requireSuperAdmin, async (req, res) => {
  res.json(await reactivateUser(requiredString(req.params.userId)));
});

/**
 * POST /api/admin/users/:id/role
 * Body: { role: "SHOPPER" | "ADMIN" | "SUPER_ADMIN" }
 * Auth: SUPER_ADMIN only
 * Behavior: allows promoting/demoting ANY user (including SUPER_ADMIN and self).
 */
const SetRoleSchema = z.object({
  role: z.enum(['SHOPPER', 'ADMIN', 'SUPER_ADMIN']),
});

const wrap = (
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>
): express.RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

r.post(
  '/users/:id/role',
  requireAdmin, requireAuth,
  wrap(async (req, res) => {
    const me = (req as any).user as { id: string; role?: string } | undefined;
    if (!me || me.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const targetId = requiredString(req.params.id || '').trim();
    if (!targetId) return res.status(400).json({ error: 'Missing user id' });

    const { role } = SetRoleSchema.parse({
      role: String(req.body?.role || '').toUpperCase(),
    });

    const existing = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true },
    });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: { role },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });

    return res.json({ ok: true, user: updated });
  })
);

/* Transactions */
r.get('/payments', async (req, res) => {
  const q = String(req.query.q || '');
  res.json({ data: await listPaymentsSvc(q) });
});
r.post('/payments/:paymentId/verify',  requireSuperAdmin, async (req, res) => {
  res.json(await markPaymentPaid(requiredString(req.params.paymentId)));
});
r.post('/payments/:paymentId/refund', requireSuperAdmin, async (req, res) => {
  res.json(await markPaymentRefunded(requiredString(req.params.paymentId)));
});

/* Ops */
r.get('/ops/snapshot', async (_req, res) => {
  res.json(opsSnapshotSvc());
});

/* Marketing */
r.post('/marketing/announce', async (req, res) => {
  const { message } = req.body || {};
  if (!String(message || '').trim()) return res.status(400).json({ error: 'Message required' });
  // TODO: enqueue/email broadcast; for now return ok
  res.json({ ok: true });
});
// r.post('/marketing/coupons', async (req, res) => {
//   const { code, pct, maxUses } = req.body || {};
//   if (!code || !pct) return res.status(400).json({ error: 'code & pct required' });
//   try {
//     res.json(await createCouponSvc({ code, pct: Number(pct), maxUses: Number(maxUses) }));
//   } catch (e: any) {
//     res.status(400).json({ error: e?.message || 'Failed to create coupon' });
//   }
// });

/* Analytics export (CSV) */
r.get('/analytics/export', requireSuperAdmin, async (_req, res) => {
  const since = subDays(new Date(), 29);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: startOfDay(since) } },
    select: { id: true, createdAt: true },
  });
  const payments = await prisma.payment.findMany({
    where: { createdAt: { gte: startOfDay(since) }, status: 'PAID' },
    select: { id: true, createdAt: true, amount: true },
  });

  const bucket: Record<string, { date: string; orders: number; revenue: number }> = {};
  for (let i = 0; i < 30; i++) {
    const d = startOfDay(subDays(new Date(), i));
    const key = d.toISOString().slice(0, 10);
    bucket[key] = { date: key, orders: 0, revenue: 0 };
  }
  for (const o of orders) {
    const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
    if (bucket[key]) bucket[key].orders += 1;
  }
  for (const p of payments) {
    const key = startOfDay(p.createdAt).toISOString().slice(0, 10);
    if (bucket[key]) bucket[key].revenue += Number(p.amount) || 0;
  }
  const rows = Object.values(bucket).sort((a, b) => a.date.localeCompare(b.date));
  const csv = toCsv(['date', 'orders', 'revenue'], rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="analytics-report.csv"');
  res.send(csv);
});


/* ---------------- Catalog: per-product attributes & variants ---------------- */

// zod helpers
const IdSchema = z.string().min(1, 'id is required');

const UpdateVariantSchema = z.object({
  sku: z.string().min(1).optional(),
  unitPrice: z.number().nullable().optional(), // null to clear price override
  inStock: z.boolean().optional(),
  imagesJson: z.array(z.string().url()).optional(),
  options: z
    .array(
      z.object({
        attributeId: z.string().min(1),
        valueId: z.string().min(1),
      })
    )
    .optional(), // if present, we replace all options
});

/** --------- Attributes (select values) --------- */
// PUT /api/admin/variants/:variantId
r.put(
  '/variants/:variantId',
  wrap(async (req, res) => {
    const variantId = IdSchema.parse(req.params.variantId);
    const payload = UpdateVariantSchema.parse(req.body ?? {});

    // If options provided, validate them
    if (payload.options) {
      for (const opt of payload.options) {
        const val = await prisma.attributeValue.findUnique({
          where: { id: opt.valueId },
          select: { id: true, attributeId: true },
        });
        if (!val) return res.status(404).json({ error: `Attribute value not found: ${opt.valueId}` });
        if (val.attributeId !== opt.attributeId) {
          return res
            .status(400)
            .json({ error: `valueId ${opt.valueId} does not belong to attributeId ${opt.attributeId}` });
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const data: any = {};
      if (payload.sku !== undefined) data.sku = payload.sku;
      if (payload.unitPrice !== undefined) data.price = payload.unitPrice === null ? null : new Prisma.Decimal(payload.unitPrice);
      if (payload.inStock !== undefined) data.inStock = payload.inStock;
      if (payload.imagesJson !== undefined) data.imagesJson = payload.imagesJson;

      await tx.productVariant.update({ where: { id: variantId }, data });

      if (payload.options) {
        await tx.productVariantOption.deleteMany({ where: { variantId } });
        if (payload.options.length) {
          await tx.productVariantOption.createMany({
            data: payload.options.map((o: { attributeId: any; valueId: any; }) => ({
              variantId,
              attributeId: o.attributeId,
              valueId: o.valueId,
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.productVariant.findUnique({
        where: { id: variantId },
        include: { options: { include: { attribute: true, value: true } } },
      });
    });

    res.json({ ok: true, data: updated });
  })
);

// DELETE /api/admin/variants/:variantId
r.delete(
  '/variants/:variantId',
  wrap(async (req, res) => {
    const variantId = IdSchema.parse(req.params.variantId);

    await prisma.$transaction([
      prisma.productVariantOption.deleteMany({ where: { variantId } }),
      prisma.productVariant.delete({ where: { id: variantId } }),
    ]);

    res.json({ ok: true });
  })
);

export default r;


