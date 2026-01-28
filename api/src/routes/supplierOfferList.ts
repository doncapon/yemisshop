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
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
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
    const pid = raw.productId ?? raw.product?.id;
    if (raw.baseOffers || raw.variantOffers) {
      (raw.baseOffers ?? []).forEach((o: any) => pushOffer(o, pid));
      (raw.variantOffers ?? []).forEach((o: any) => pushOffer(o, pid));
      return out.filter((x) => !!x?.productId);
    }
  }

  return out;
}

function isTruthyNonEmpty(v: any) {
  return v != null && String(v).trim().length > 0;
}

function isSupplierPayoutReadyRow(s: any) {
  // tolerate different schema field names
  const enabled =
    s?.isPayoutEnabled === true ||
    s?.payoutEnabled === true ||
    s?.payoutsEnabled === true ||
    s?.isPayoutEnabled == null; // if no flag exists, don't block

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

  // Try selecting common fields; if your schema differs, we still won’t crash the route.
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
    // Ultra-safe fallback: if select fields don't exist, do NOT block purchasing here.
    // (Better enforcement should be in the service layer.)
    const ok = new Set<string>(uniq);
    return ok;
  }
}

function filterOfferPayloadBySupplierIds(raw: unknown, allowed: Set<string>): unknown {
  if (raw == null) return raw;

  // array case
  if (Array.isArray(raw)) {
    return raw
      .map((item) => filterOfferPayloadBySupplierIds(item, allowed))
      .filter((x) => x != null);
  }

  // object case
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    // grouped payload: { baseOffers, variantOffers, ... }
    if ("baseOffers" in obj || "variantOffers" in obj) {
      const baseOffers = Array.isArray(obj.baseOffers) ? obj.baseOffers : [];
      const variantOffers = Array.isArray(obj.variantOffers) ? obj.variantOffers : [];

      const filterBySupplier = (o: unknown) => {
        if (!o || typeof o !== "object") return false;
        const sid = String((o as any).supplierId ?? "");
        return allowed.has(sid);
      };

      return {
        ...obj,
        baseOffers: baseOffers.filter(filterBySupplier),
        variantOffers: variantOffers.filter(filterBySupplier),
      };
    }

    // single offer row: { supplierId, ... }
    if ("supplierId" in obj) {
      const sid = String((obj as any).supplierId ?? "");
      return allowed.has(sid) ? raw : null;
    }

    // unknown object shape: leave untouched
    return raw;
  }

  // primitives: leave untouched
  return raw;
}

// Admin: /api/admin/supplier-offers?productIds=a,b,c
router.get('/admin/supplier-offers', requireAdmin, async (req, res, next) => {
  try {
    const ids = parseIds(req.query) ?? [];
    const active = req.query.active != null ? req.query.active === "true" : undefined;

    const data = await fetchOffersByProducts(ids); // ✅ matches string[]

    const flat = flattenOffers(data);

    res.json({ data: flat });
  } catch (e) { next(e); }
});

router.get('/admin/products/offers', requireAdmin, async (req, res, next) => {
  try {
    const ids = parseIds(req.query) ?? [];
    const active = req.query.active != null ? req.query.active === "true" : undefined;

    const data = await fetchOffersByProducts(ids); // ✅ matches string[]

    const flat = flattenOffers(data);

    res.json({ data: flat });
  } catch (e) { next(e); }
});

function unwrapDataPayload(input: unknown): unknown {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object" && "data" in input) {
    return (input as any).data;
  }
  return input;
}

// Public/fallback: /api/supplier-offers?productIds=a,b,c
// Public/fallback: /api/supplier-offers?productIds=a,b,c
router.get('/supplier-offers', async (req, res, next) => {
  try {
    const ids = parseIds(req.query) ?? [];
    const active = req.query.active != null ? req.query.active === "true" : undefined;

    const data = await fetchOffersByProducts(ids); // ✅ matches string[]

    // ✅ filter payout-unready suppliers (public endpoint only)
    const flat = flattenOffers(data);
    const supplierIds = flat.map((o: any) => String(o?.supplierId ?? '')).filter(Boolean);
    const allowedSupplierIds = await getPayoutReadySupplierIdSet(supplierIds);


    const payload = unwrapDataPayload(data);
    const filteredPayload = filterOfferPayloadBySupplierIds(payload, allowedSupplierIds);

    res.json({ data: filteredPayload });
  } catch (e) { next(e); }
});


export default router;
