// routes/adminReports.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
const r = Router();

r.get('/products', requireAuth, requireAdmin, async (req, res) => {
  const bucket = String(req.query.bucket || '');

  // --- re-use the same definitions you used for counts ---
  const variantAwareAvailable = {
    OR: [{ inStock: true }, { variants: { some: { inStock: true } } }],
  } as const;
  const anyOffer = {
    OR: [
      { supplierOffers: { some: {} } },
      { variants: { some: { offers: { some: {} } } } },
    ],
  } as const;
  const anyActiveOffer = {
    OR: [
      { supplierOffers: { some: { isActive: true, inStock: true } } },
      { variants: { some: { offers: { some: { isActive: true, inStock: true } } } } },
    ],
  } as const;

  let where: any = {};
  if (bucket === 'published') where = { status: 'PUBLISHED' };
  if (bucket === 'live') where = { status: 'PUBLISHED', AND: [variantAwareAvailable, anyActiveOffer] };
  if (bucket === 'published-available') where = { status: 'PUBLISHED', ...variantAwareAvailable };
  if (bucket === 'published-with-offer') where = { status: 'PUBLISHED', ...anyOffer };
  if (bucket === 'published-no-offer') where = { status: 'PUBLISHED', AND: [{ supplierOffers: { none: {} } }, { variants: { none: { offers: { some: {} } } } }] };
  if (bucket === 'published-with-active-offer') where = { status: 'PUBLISHED', ...anyActiveOffer };
  if (bucket === 'with-variants') where = { variants: { some: {} } };
  if (bucket === 'simple') where = { variants: { none: {} } };

  const rows = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      inStock: true,
      _count: {
        select: {
          variants: true,
          supplierOffers: true,
        },
      },
      variants: {
        select: {
          _count: { select: { offers: true } },
        },
      },
    },
  });

  const data = rows.map((p: { id: any; title: any; status: any; inStock: any; _count: { variants: any; supplierOffers: any; }; variants: any; }) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    inStock: p.inStock,
    variantCount: p._count.variants,
    offerCount: p._count.supplierOffers + (p.variants || []).reduce((n: any, v: { _count: { offers: any; }; }) => n + (v._count?.offers || 0), 0),
    // no heavy join needed; "activeOfferCount" is optional unless you add a dedicated count query
  }));

  res.json({ data });
});

export default r;
