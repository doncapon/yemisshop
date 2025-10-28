// api/src/routes/public.productOffers.ts
import { Router } from 'express';
import { fetchOffersByProducts } from '../services/offerList.service.js'; // the helper you already use

const router = Router();

/**
 * GET /api/products/:productId/supplier-offers
 * Public read-only list so Cart can compute availability without auth.
 */
router.get('/products/:productId/supplier-offers', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const active = req.query.active != null ? req.query.active === 'true' : undefined;
    const data = await fetchOffersByProducts({ productId, active });
    res.json({ data });
  } catch (e) { next(e); }
});

export default router;
