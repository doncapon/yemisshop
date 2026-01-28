// src/routes/admin.activities.ts
import { Router } from 'express';
import { Prisma } from '@prisma/client'
import {prisma} from '../lib/prisma.js'
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';

const r = Router();

const ListSchema = z.object({
  q: z.string().optional(),
  type: z.string().optional(),          // e.g. PAYMENT_PAID
  orderId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
});

// GET /api/admin/order-activities
r.get('/', requireAdmin, async (req, res, next) => {
  try {
    const p = ListSchema.parse(req.query);
    const where: Prisma.OrderActivityWhereInput = {};

    if (p.orderId) where.orderId = p.orderId;
    if (p.type) where.type = p.type;

    if (p.from || p.to) {
      where.createdAt = {
        gte: p.from ? new Date(p.from) : undefined,
        lte: p.to ? new Date(p.to) : undefined,
      };
    }

    if (p.q) {
      const q = p.q.trim();
      where.OR = [
        { message: { contains: q, mode: 'insensitive' } },
        { type: { contains: q, mode: 'insensitive' } },
        { orderId: { contains: q, mode: 'insensitive' } },
      ];
    }

    const skip = (p.page - 1) * p.pageSize;

    const [items, total] = await Promise.all([
      prisma.orderActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: p.pageSize,
        include: {
          order: {
            select: { id: true, status: true, total: true, createdAt: true, userId: true },
          },
        },
      }),
      prisma.orderActivity.count({ where }),
    ]);

    res.json({
      data: items,
      page: p.page,
      pageSize: p.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
    });
  } catch (e) { next(e); }
});



export default r;
