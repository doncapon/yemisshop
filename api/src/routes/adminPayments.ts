// src/routes/admin.payments.ts
import { Router, Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

const prisma = new PrismaClient();
export const adminPaymentsRouter = Router();

const toNum = (v: any) =>
  v == null ? null : typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v);

/** Core handler (used by both /admin/payments and /payments/admin) */
async function listPayments(req: Request, res: Response) {
  const q = String(req.query.q || '').trim();
  const statusParam = String(req.query.status || '').trim().toUpperCase();
  const includeItems = ['1', 'true', 'yes'].includes(String(req.query.includeItems || '').toLowerCase());
  const limitRaw = Number(req.query.limit);
  const take = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50;

  const where: Prisma.PaymentWhereInput = {};

  // Optional status filter: PENDING | PAID | FAILED | CANCELED | REFUNDED | REQUIRES_ACTION
  if (statusParam) {
    where.status = statusParam as any;
  }

  // Text search across reference, provider, channel, order.id, user.email, item titles / product titles
  if (q) {
    where.OR = [
      { reference: { contains: q, mode: 'insensitive' } },
      { provider: { contains: q, mode: 'insensitive' } },
      { channel: { contains: q, mode: 'insensitive' } },
      { order: { is: { id: { contains: q, mode: 'insensitive' } } } },
      { order: { is: { user: { is: { email: { contains: q, mode: 'insensitive' } } } } } },
      {
        order: {
          is: {
            items: {
              some: {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { product: { is: { title: { contains: q, mode: 'insensitive' } } } },
                ],
              },
            },
          },
        },
      },
    ];
  }

  const include = {
    order: {
      select: {
        id: true,
        user: { select: { email: true } },
        ...(includeItems
          ? {
              items: {
                select: {
                  id: true,
                  title: true,
                  unitPrice: true,
                  quantity: true,
                  lineTotal: true,
                  status: true,
                  selectedOptions: true,
                  product: { select: { title: true } },
                  // only if you added the variant relation in schema:
                  variant: { select: { id: true, sku: true, imagesJson: true } },
                },
              },
            }
          : {}),
      },
    },
  } as const;

  const rows = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include,
  });

  // Normalize to UI shape (AdminPayment[])
  const data = rows.map((p) => {
    const order = p.order as any;
    const userEmail = order?.user?.email || null;
    const items = includeItems
      ? (order?.items || []).map((it: any) => ({
          id: it.id,
          title: it.title,
          unitPrice: toNum(it.unitPrice),
          quantity: Number(it.quantity ?? 0),
          lineTotal: it.lineTotal != null ? toNum(it.lineTotal) : null,
          status: it.status || null,
          product: it.product ? { title: it.product.title } : null,
          variant: it.variant
            ? { id: it.variant.id, sku: it.variant.sku, imagesJson: it.variant.imagesJson || [] }
            : null,
          selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : [],
        }))
      : undefined;

    return {
      id: p.id,
      status: p.status,
      provider: p.provider,
      channel: p.channel,
      reference: p.reference,
      amount: toNum(p.amount), // Prisma.Decimal -> number
      createdAt: p.createdAt,
      orderId: p.orderId,
      userEmail,
      ...(includeItems ? { items } : {}),
    };
  });

  return res.json({ data });
}

/** Primary route */
adminPaymentsRouter.get('/admin/payments',requireAuth, requireSuperAdmin, listPayments);
/** Back-compat alias to satisfy your try/catch fallback path */
adminPaymentsRouter.get('/payments/admin',requireAuth, requireSuperAdmin, listPayments);

export default adminPaymentsRouter;
