// api/src/routes/supplierOffers.list.ts
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { fetchOffersByProducts } from '../services/offerList.service.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

function parseIds(q: any): string[] | undefined {
  const raw = q.productIds ?? q.productId ?? q.ids;
  if (!raw) return;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function flattenOffers(data: any): any[] {
  const raw = data?.data ?? data;

  const out: any[] = [];

  const pushOffer = (o: any, productId?: string) => {
    if (!o) return;
    // ensure productId exists on each row (ManageProducts needs it)
    const pid = o.productId ?? o.product?.id ?? productId;
    out.push({ ...o, productId: pid });
  };

  // Case A: already a flat array of offers
  if (Array.isArray(raw)) {
    for (const item of raw) {
      // Case B: array of grouped objects: [{ productId, baseOffers, variantOffers }, ...]
      if (item && (item.baseOffers || item.variantOffers)) {
        const pid = item.productId ?? item.product?.id;
        (item.baseOffers ?? []).forEach((o: any) => pushOffer(o, pid));
        (item.variantOffers ?? []).forEach((o: any) => pushOffer(o, pid));
      } else {
        pushOffer(item);
      }
    }
    return out.filter((x) => !!x?.productId);
  }

  // Case C: single grouped object: { baseOffers, variantOffers } or { data: { baseOffers... } }
  if (raw && typeof raw === "object") {
    const pid = (raw as any).productId ?? (raw as any).product?.id;
    if ((raw as any).baseOffers || (raw as any).variantOffers) {
      ((raw as any).baseOffers ?? []).forEach((o: any) => pushOffer(o, pid));
      ((raw as any).variantOffers ?? []).forEach((o: any) => pushOffer(o, pid));
      return out.filter((x) => !!x?.productId);
    }
  }

  return out;
}

function isTruthyNonEmpty(v: any) {
  return v != null && String(v).trim().length > 0;
}

function isSupplierPayoutReadyRow(s: any) {
  const enabled =
    s?.isPayoutEnabled === true ||
    s?.payoutEnabled === true ||
    s?.payoutsEnabled === true ||
    s?.isPayoutEnabled == null;

  const accNum =
    isTruthyNonEmpty(s?.accountNumber) || isTruthyNonEmpty(s?.bankAccountNumber) || s?.accountNumber == null;

  const accName =
    isTruthyNonEmpty(s?.accountName) || isTruthyNonEmpty(s?.bankAccountName) || s?.accountName == null;

  const bankCode =
    isTruthyNonEmpty(s?.bankCode) || isTruthyNonEmpty(s?.bankName) || s?.bankCode == null;

  const bankCountry =
    isTruthyNonEmpty(s?.bankCountry) || s?.bankCountry == null;

  return enabled && accNum && accName && bankCode && bankCountry;
}

async function getPayoutReadySupplierIdSet(supplierIds: string[]) {
  const uniq = Array.from(new Set(supplierIds.map(String).filter(Boolean)));
  if (!uniq.length) return new Set<string>();

  try {
    const rows = await prisma.supplier.findMany({
      where: { id: { in: uniq } },
      select: {
        id: true,
        isPayoutEnabled: true,
        payoutEnabled: true,
        payoutsEnabled: true,
        accountNumber: true,
        bankAccountNumber: true,
        accountName: true,
        bankAccountName: true,
        bankCode: true,
        bankName: true,
        bankCountry: true,
      } as any,
    });

    const ok = new Set<string>();
    for (const s of rows as any[]) {
      if (isSupplierPayoutReadyRow(s)) ok.add(String(s.id));
    }
    return ok;
  } catch {
    return new Set<string>(uniq);
  }
}

function filterFlatOffersByAllowedSuppliers(flat: any[], allowed: Set<string>) {
  return (flat || []).filter((o: any) => {
    const sid = String(o?.supplierId ?? o?.supplier?.id ?? "");
    if (!sid) return false;
    return allowed.has(sid);
  });
}

function filterFlatOffersByActive(flat: any[], active?: boolean) {
  if (active == null) return flat;
  return (flat || []).filter((o: any) => {
    const v = o?.isActive;
    if (typeof v === "boolean") return v === active;
    // if backend doesn’t send isActive, treat as active (don’t accidentally hide offers)
    return active === true;
  });
}

// Admin: /api/admin/supplier-offers?productIds=a,b,c
router.get('/admin/supplier-offers', requireAdmin, async (req, res, next) => {
  try {
    const ids = parseIds(req.query) ?? [];
    const active = req.query.active != null ? req.query.active === "true" : undefined;

    const data = await fetchOffersByProducts(ids);

    let flat = flattenOffers(data);
    flat = filterFlatOffersByActive(flat, active);

    res.json({ data: flat });
  } catch (e) {
    next(e);
  }
});

router.get('/admin/products/offers', requireAdmin, async (req, res, next) => {
  try {
    const ids = parseIds(req.query) ?? [];
    const active = req.query.active != null ? req.query.active === "true" : undefined;

    const data = await fetchOffersByProducts(ids);

    let flat = flattenOffers(data);
    flat = filterFlatOffersByActive(flat, active);

    res.json({ data: flat });
  } catch (e) {
    next(e);
  }
});

// Public/fallback: /api/supplier-offers?productIds=a,b,c
router.get('/supplier-offers', async (req, res, next) => {
  try {
    const ids = parseIds(req.query) ?? [];
    const active = req.query.active != null ? req.query.active === "true" : undefined;

    const data = await fetchOffersByProducts(ids);

    // ✅ flatten always
    let flat = flattenOffers(data);

    // ✅ active filter (public too)
    flat = filterFlatOffersByActive(flat, active);

    // ✅ filter payout-unready suppliers (public endpoint only)
    const supplierIds = flat.map((o: any) => String(o?.supplierId ?? '')).filter(Boolean);
    const allowedSupplierIds = await getPayoutReadySupplierIdSet(supplierIds);

    flat = filterFlatOffersByAllowedSuppliers(flat, allowedSupplierIds);

    res.json({ data: flat });
  } catch (e) {
    next(e);
  }
});

export default router;
