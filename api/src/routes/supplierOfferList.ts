// api/src/routes/supplierOffers.list.ts
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { fetchOffersByProducts } from '../services/offerList.service.js';

const router = Router();

function parseIds(q: any): string[] | undefined {
  const raw = q.productIds ?? q.productId ?? q.ids;
  if (!raw) return;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

// Admin: /api/admin/supplier-offers?productIds=a,b,c
router.get('/admin/supplier-offers', requireAdmin, async (req, res, next) => {
  try {
    const ids = parseIds(req.query);
    const active = req.query.active != null ? req.query.active === 'true' : undefined;
    const data = await fetchOffersByProducts({ productIds: ids, active });
    res.json({ data });
  } catch (e) { next(e); }
});

// Admin alias: /api/admin/products/offers?productIds=a,b,c
router.get('/admin/products/offers', requireAdmin, async (req, res, next) => {
  try {
    const ids = parseIds(req.query);
    const active = req.query.active != null ? req.query.active === 'true' : undefined;
    const data = await fetchOffersByProducts({ productIds: ids, active });
    res.json({ data });
  } catch (e) { next(e); }
});

// Public/fallback: /api/supplier-offers?productIds=a,b,c
router.get('/supplier-offers', async (req, res, next) => {
  try {
    const ids = parseIds(req.query);
    const active = req.query.active != null ? req.query.active === 'true' : undefined;
    const data = await fetchOffersByProducts({ productIds: ids, active });
    res.json({ data });
  } catch (e) { next(e); }
});

export default router;
