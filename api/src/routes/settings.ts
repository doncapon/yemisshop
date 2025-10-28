// src/routes/settings.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

/* -------------------------------- helpers -------------------------------- */

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}
function toNumber(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function toTaxMode(v: any): 'INCLUDED' | 'ADDED' | 'NONE' {
  const s = String(v ?? '').toUpperCase();
  return s === 'ADDED' || s === 'NONE' ? (s as 'ADDED' | 'NONE') : 'INCLUDED';
}

/* -------------------------- PUBLIC endpoints FIRST ----------------------- */

/**
 * GET /api/settings/public  (no auth)
 * Returns a compact bundle used by checkout.
 */
router.get('/public', async (_req, res) => {
  try {
    // Base (flat) service fee (try several keys)
    const baseRaw =
      (await readSetting('baseServiceFeeNGN')) ??
      (await readSetting('serviceFeeBaseNGN')) ??
      (await readSetting('platformBaseFeeNGN')) ??
      (await readSetting('commsServiceFeeNGN')); // fallback to legacy key

    // Per-supplier unit fee
    const unitRaw =
      (await readSetting('commsUnitCostNGN')) ??
      (await readSetting('commsServiceFeeUnitNGN')) ??
      (await readSetting('commsUnitFeeNGN'));

    // Tax settings
    const modeRaw = await readSetting('taxMode');     // INCLUDED | ADDED | NONE
    const rateRaw = await readSetting('taxRatePct');  // e.g. "7.5"

    const baseServiceFeeNGN = toNumber(baseRaw, 0);
    const commsUnitCostNGN = toNumber(unitRaw, 0);
    const taxMode = toTaxMode(modeRaw);
    const taxRatePct = toNumber(rateRaw, 0);

    res.json({ baseServiceFeeNGN, commsUnitCostNGN, taxMode, taxRatePct });
  } catch (e) {
    console.error('GET /api/settings/public failed:', e);
    res.status(500).json({ error: 'Failed to load public settings' });
  }
});


// ---- CHECKOUT SERVICE FEE (no auth) ---------------------------------
/**
 * GET /api/settings/checkout/service-fee?productIds=a,b,c  OR  ?supplierIds=s1,s1,s2
 *
 * Returns:
 *  - unitFee: NGN per message (unit comms cost)
 *  - notificationsCount: number of “messages” to charge (multiplier)
 *  - suppliersCount: distinct suppliers for friendlier display (can differ)
 *  - serviceFee: unitFee * notificationsCount
 *
 * Notes:
 *  - If supplierIds are provided, we treat each ID as **one message** (duplicates count).
 *    Use this when you already know you’ll ping the same supplier multiple times.
 *  - If only productIds are provided, we infer **distinct suppliers** from Product / SupplierOffer
 *    and assume one message per supplier (best-effort estimate for checkout).
 *  - For a single product cart, we keep suppliersCount display as 1 (nicer UX).
 */
router.get('/checkout/service-fee', async (req, res) => {
  try {
    // 1) Resolve unit fee from settings (with fallbacks)
    const unitRaw =
      (await readSetting('commsUnitCostNGN')) ??
      (await readSetting('commsServiceFeeUnitNGN')) ??
      (await readSetting('commsUnitFeeNGN')) ??
      (await readSetting('commsServiceFeeNGN')); // final fallback

    const unitFee = toNumber(unitRaw, 0);

    // 2) Parse query params
    const supplierIdsParam = String(req.query.supplierIds ?? '').trim();
    const productIdsParam  = String(req.query.productIds  ?? '').trim();

    const pIds = productIdsParam
      ? productIdsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const sIds = supplierIdsParam
      ? supplierIdsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // We compute:
    // - notificationsCount = multiplier for fee (messages)
    // - suppliersCount     = friendly number for UI (distinct suppliers)
    let notificationsCount = 0;
    let suppliersCountDisplay = 0;

    if (sIds.length) {
      // Caller explicitly passed supplierIds -> treat EACH as one message
      notificationsCount = sIds.length;

      // Distinct suppliers for display
      const distinctSuppliers = new Set(sIds).size;
      suppliersCountDisplay = pIds.length === 1 ? 1 : Math.max(1, distinctSuppliers);
    } else if (pIds.length) {
      // We don't know multiple messages per supplier here, so estimate 1 per supplier
      const supplierSet = new Set<string>();

      // A) Product.supplierId
      try {
        const prods = await prisma.product.findMany({
          where: { id: { in: pIds } },
          select: { supplierId: true },
        });
        for (const p of prods) {
          const sid = (p as any).supplierId;
          if (sid) supplierSet.add(String(sid));
        }
      } catch {
        // tolerate schema differences
      }

      // B) Distinct SupplierOffer suppliers
      try {
        const offers = await prisma.supplierOffer.findMany({
          where: { productId: { in: pIds }, isActive: true },
          distinct: ['supplierId'],
          select: { supplierId: true },
        });
        for (const o of offers) {
          if (o.supplierId) supplierSet.add(String(o.supplierId));
        }
      } catch {
        // tolerate absence of model/table
      }

      const distinctSuppliers = supplierSet.size || pIds.length;

      // Messages estimate: at least 1 if there are products
      notificationsCount = Math.max(1, distinctSuppliers);

      // Friendlier display: single product -> show 1 supplier
      suppliersCountDisplay = pIds.length === 1 ? 1 : Math.max(1, distinctSuppliers);
    } else {
      // No inputs
      notificationsCount = 0;
      suppliersCountDisplay = 0;
    }

    const serviceFee = unitFee * notificationsCount;

    return res.json({
      unitFee,
      notificationsCount,     // use this for “₦X × N msgs”
      suppliersCount: suppliersCountDisplay,
      serviceFee,
    });
  } catch (e) {
    console.error('GET /api/settings/checkout/service-fee failed:', e);
    res.status(500).json({ error: 'Failed to compute service fee' });
  }
});


/* ------------------------------ ADMIN CRUD ------------------------------- */
/* NOTE: These come AFTER the public routes so /public isn't captured by /:id */

router.get('/', requireAuth, requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  return res.json(rows);
});

router.get('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const row = await prisma.setting.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  return res.json(row);
});

/**
 * POST /api/settings
 * Body: { key: string, value: string, isPublic?: boolean, meta?: any }
 */
router.post('/', requireAuth, requireSuperAdmin, async (req, res) => {
  const { key, value, isPublic = false, meta = null } = req.body ?? {};
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key is required' });
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });

  try {
    // Try with optional columns first…
    try {
      const row = await prisma.setting.create({ data: { key, value, isPublic, meta } as any });
      return res.status(201).json(row);
    } catch (e: any) {
      // …if the schema doesn’t have isPublic/meta yet, retry without them
      if (e?.code === 'P2022' || /Unknown argument .*isPublic|meta/i.test(String(e?.message))) {
        const row = await prisma.setting.create({ data: { key, value } as any });
        return res.status(201).json(row);
      }
      if (e?.code === 'P2002') return res.status(409).json({ error: 'Key already exists' });
      throw e;
    }
  } catch {
    return res.status(500).json({ error: 'Create failed' });
  }
});

/**
 * PATCH /api/settings/:id
 * Body: { value?: string, isPublic?: boolean, meta?: any }
 */
router.patch('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { value, isPublic, meta } = req.body ?? {};
  const data: Record<string, any> = {};
  if (typeof value === 'string') data.value = value;
  if (typeof isPublic === 'boolean') data.isPublic = isPublic;
  if (meta !== undefined) data.meta = meta;

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    try {
      const row = await prisma.setting.update({ where: { id: req.params.id }, data });
      return res.json(row);
    } catch (e: any) {
      // If schema lacks isPublic/meta, retry only with supported fields
      if (e?.code === 'P2022' || /Unknown argument .*isPublic|meta/i.test(String(e?.message))) {
        const fallback: Record<string, any> = {};
        if (typeof value === 'string') fallback.value = value;
        const row = await prisma.setting.update({ where: { id: req.params.id }, data: fallback });
        return res.json(row);
      }
      if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
      throw e;
    }
  } catch {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.delete('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await prisma.setting.delete({ where: { id: req.params.id } });
    return res.status(204).end();
  } catch (e: any) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Delete failed' });
  }
});

export default router;
