// api/src/routes/adminSupplierOffers.ts
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {prisma} from '../lib/prisma.js'

const router = express.Router();

// POST /api/admin/suppliers/:supplierId/offers
router.post('/suppliers/:supplierId/offers', requireAuth, async (req, res) => {
  const me = req.user!;
  if (!['ADMIN', 'SUPER_ADMIN'].includes(me.role)) return res.status(403).json({ error: 'Forbidden' });

  const { supplierId } = req.params;
  const { productId, variantId = null, price } = req.body || {};
  if (!productId || price == null) return res.status(400).json({ error: 'productId and price required' });

  const data = await prisma.supplierOffer.upsert({
    where: {
      supplierId_productId_variantId: { supplierId, productId, variantId },
    },
    create: { supplierId, productId, variantId, price },
    update: { price },
  });

  res.json({ ok: true, data });
});

export default router;
