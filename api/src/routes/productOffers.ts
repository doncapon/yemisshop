// api/src/routes/publicProductOffers.ts
import { Router } from 'express';
import { fetchOffersByProducts } from '../services/offerList.service.js';

const router = Router();

/**
 * GET /api/products/:productId/supplier-offers
 * Public read-only list so Cart/Catalog can compute availability without auth.
 *
 * Query:
 *  - active=true|false (optional)
 */
router.get('/products/:productId/supplier-offers', async (req, res, next) => {
  try {
    const productId = String(req.params.productId || '').trim();
    if (!productId) return res.status(400).json({ error: 'productId is required' });

    const activeParam = req.query.active;
    const active =
      activeParam == null ? undefined : String(activeParam).toLowerCase() === 'true';

    // ✅ fetchOffersByProducts expects string[] (NOT an object)
    const result: any = await fetchOffersByProducts([productId]);

    // Normalize: helper might return a map keyed by productId OR a flat array
    let offers: any[] = [];
    if (Array.isArray(result)) {
      offers = result;
    } else if (result && typeof result === 'object') {
      offers = Array.isArray(result[productId]) ? result[productId] : [];
    }

    // Optional filter if requested
    if (active !== undefined) {
      offers = offers.filter((o) => (o?.isActive === true) === active);
    }

    res.json({ data: offers });
  } catch (e) {
    next(e);
  }
});

export default router;
