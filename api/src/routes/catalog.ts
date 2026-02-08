// api/src/routes/catalog.ts
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

/* ------------------------- Prisma schema introspection ------------------------- */

const MODELS = new Map(
  (Prisma.dmmf.datamodel.models ?? []).map((m) => [m.name, m])
);

const hasModel = (name: string) => MODELS.has(name);

const modelFields = (name: string) =>
  new Set((MODELS.get(name)?.fields ?? []).map((f) => f.name));

const hasField = (modelName: string, field: string) => modelFields(modelName).has(field);

const relationField = (modelName: string, relName: string) => {
  const m = MODELS.get(modelName);
  if (!m) return null;
  const f = (m.fields ?? []).find((x) => x.name === relName);
  return f && f.kind === "object" ? f : null;
};

/* ------------------------- Helpers: coercion ------------------------- */

const asInt = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

const asMoney = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const pickFirstNumber = (obj: any, keys: string[], d = 0) => {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const n = Number((obj as any)[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return d;
};

const pickFirstBool = (obj: any, keys: string[], d = true) => {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = (obj as any)[k];
      if (typeof v === "boolean") return v;
    }
  }
  return d;
};

/* ------------------------- Offer unification ------------------------- */

type OfferLike = {
  id: string;
  productId: string;
  variantId: string | null;
  supplierId: string;
  supplierName?: string | null;
  unitPrice: number;
  availableQty: number;
  isActive: boolean;
  inStock: boolean;
};

const PRICE_KEYS = ["unitPrice", "supplierPrice", "price", "unit_price", "basePrice", "retailPrice"];
const QTY_KEYS = ["availableQty", "available", "qty", "stock", "available_quantity"];
const ACTIVE_KEYS = ["isActive", "active", "enabled"];
const INSTOCK_KEYS = ["inStock", "in_stock", "availableNow"];

function mapOfferRow(row: any, modelName: string): OfferLike {
  const id = String(row?.id ?? "");
  const productId = String(row?.productId ?? row?.product_id ?? "");
  const variantId = row?.variantId == null ? null : String(row.variantId);
  const supplierId = String(row?.supplierId ?? row?.supplier_id ?? "");
  const supplierName =
    row?.supplier?.name ?? row?.supplierName ?? row?.supplier_name ?? null;

  const unitPrice = pickFirstNumber(row, PRICE_KEYS, 0);
  const availableQty = Math.max(0, asInt(pickFirstNumber(row, QTY_KEYS, 0), 0));

  const isActive = pickFirstBool(row, ACTIVE_KEYS, true);
  const inStock = pickFirstBool(row, INSTOCK_KEYS, true);

  return {
    id,
    productId,
    variantId,
    supplierId,
    supplierName,
    unitPrice: asMoney(unitPrice, 0),
    availableQty,
    isActive,
    inStock,
  };
}

function availKeyFor(productId: string, variantId: string | null) {
  return `${productId}::${variantId ?? "null"}`;
}

/* ------------------------- Data loaders ------------------------- */

async function loadOffersForPairs(pairs: Array<{ productId: string; variantId: string | null }>) {
  // prefer unified model if present
  if (hasModel("SupplierOffer")) {
    return loadFromUnifiedSupplierOffer(pairs);
  }

  // otherwise, try split models
  const productOffers = hasModel("SupplierProductOffer")
    ? await loadFromSupplierProductOffer(pairs)
    : [];
  const variantOffers = hasModel("SupplierVariantOffer")
    ? await loadFromSupplierVariantOffer(pairs)
    : [];

  return [...productOffers, ...variantOffers];
}

async function loadFromUnifiedSupplierOffer(
  pairs: Array<{ productId: string; variantId: string | null }>
): Promise<OfferLike[]> {
  const model = "SupplierOffer";
  const client: any = (prisma as any).supplierOffer;
  if (!client) return [];

  const pids = Array.from(new Set(pairs.map((p) => p.productId)));

  const includeSupplier = !!relationField(model, "supplier");

  // NOTE: variantId filtering:
  // Prisma supports OR with variantId: null / in: [].
  const vids = Array.from(new Set(pairs.map((p) => p.variantId).filter((v): v is string => !!v)));
  const wantNull = pairs.some((p) => p.variantId == null);

  const or: any[] = [];
  if (wantNull && hasField(model, "variantId")) or.push({ variantId: null });
  if (vids.length && hasField(model, "variantId")) or.push({ variantId: { in: vids } });
  if (!hasField(model, "variantId")) {
    // if no variantId field exists, we can only treat all offers as "base"
    // keep OR empty
  }

  const where: any = {
    ...(hasField(model, "productId") ? { productId: { in: pids } } : {}),
    ...(or.length ? { OR: or } : {}),
    ...(hasField(model, "isActive") ? { isActive: true } : {}),
  };

  // try to filter only positive availability if field exists
  if (hasField(model, "availableQty")) where.availableQty = { gt: 0 };
  else if (hasField(model, "qty")) where.qty = { gt: 0 };
  else if (hasField(model, "available")) where.available = { gt: 0 };
  else if (hasField(model, "stock")) where.stock = { gt: 0 };

  const rows = await client.findMany({
    where,
    include: includeSupplier ? { supplier: { select: { id: true, name: true } } } : undefined,
  });

  return (rows ?? []).map((r: any) => mapOfferRow(r, model));
}

async function loadFromSupplierProductOffer(
  pairs: Array<{ productId: string; variantId: string | null }>
): Promise<OfferLike[]> {
  const model = "SupplierProductOffer";
  const client: any = (prisma as any).supplierProductOffer;
  if (!client) return [];

  const pids = Array.from(new Set(pairs.map((p) => p.productId)));

  const includeSupplier = !!relationField(model, "supplier");

  const where: any = {
    ...(hasField(model, "productId") ? { productId: { in: pids } } : {}),
    ...(hasField(model, "isActive") ? { isActive: true } : {}),
  };

  if (hasField(model, "availableQty")) where.availableQty = { gt: 0 };
  else if (hasField(model, "qty")) where.qty = { gt: 0 };
  else if (hasField(model, "available")) where.available = { gt: 0 };
  else if (hasField(model, "stock")) where.stock = { gt: 0 };

  const rows = await client.findMany({
    where,
    include: includeSupplier ? { supplier: { select: { id: true, name: true } } } : undefined,
  });

  // normalize as variantId = null
  return (rows ?? []).map((r: any) => {
    const mapped = mapOfferRow(r, model);
    return { ...mapped, variantId: null };
  });
}

async function loadFromSupplierVariantOffer(
  pairs: Array<{ productId: string; variantId: string | null }>
): Promise<OfferLike[]> {
  const model = "SupplierVariantOffer";
  const client: any = (prisma as any).supplierVariantOffer;
  if (!client) return [];

  const pids = Array.from(new Set(pairs.map((p) => p.productId)));
  const vids = Array.from(
    new Set(pairs.map((p) => p.variantId).filter((v): v is string => !!v))
  );
  if (!vids.length) return [];

  const includeSupplier = !!relationField(model, "supplier");

  const where: any = {
    ...(hasField(model, "productId") ? { productId: { in: pids } } : {}),
    ...(hasField(model, "variantId") ? { variantId: { in: vids } } : {}),
    ...(hasField(model, "isActive") ? { isActive: true } : {}),
  };

  if (hasField(model, "availableQty")) where.availableQty = { gt: 0 };
  else if (hasField(model, "qty")) where.qty = { gt: 0 };
  else if (hasField(model, "available")) where.available = { gt: 0 };
  else if (hasField(model, "stock")) where.stock = { gt: 0 };

  const rows = await client.findMany({
    where,
    include: includeSupplier ? { supplier: { select: { id: true, name: true } } } : undefined,
  });

  return (rows ?? []).map((r: any) => mapOfferRow(r, model));
}

/* ------------------------- Availability endpoint ------------------------- */
/**
 * GET /api/catalog/availability?items=pid:vid,pid:&includeBase=1
 * Returns array rows: { productId, variantId, totalAvailable, cheapestSupplierUnit }
 */
router.get("/availability", async (req, res) => {
  const itemsRaw = String(req.query.items ?? "").trim();
  const includeBase = String(req.query.includeBase ?? "") === "1";

  if (!itemsRaw) {
    return res.json({ data: [] });
  }

  const pairs = itemsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [pid, vidRaw] = s.split(":");
      const productId = String(pid ?? "").trim();
      const variantId = vidRaw == null || String(vidRaw).trim() === "" ? null : String(vidRaw).trim();
      return { productId, variantId };
    })
    .filter((p) => !!p.productId);

  if (!pairs.length) return res.json({ data: [] });

  // if includeBase=1, make sure base pool is requested too
  const finalPairs = includeBase
    ? [
        ...pairs,
        ...pairs
          .filter((p) => p.variantId != null)
          .map((p) => ({ productId: p.productId, variantId: null })),
      ]
    : pairs;

  const uniq: Array<{ productId: string; variantId: string | null }> = [];
  const seen = new Set<string>();
  for (const p of finalPairs) {
    const k = availKeyFor(p.productId, p.variantId);
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(p);
    }
  }

  const offers = await loadOffersForPairs(uniq);

  // bucket by requested pair only (don’t accidentally add other variant offers)
  const want = new Set(uniq.map((p) => availKeyFor(p.productId, p.variantId)));

  const grouped: Record<string, OfferLike[]> = {};
  for (const o of offers) {
    const k = availKeyFor(o.productId, o.variantId);
    if (!want.has(k)) continue;
    if (!o.isActive || !o.inStock) continue;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(o);
  }

  const out = uniq.map((p) => {
    const k = availKeyFor(p.productId, p.variantId);
    const rows = grouped[k] ?? [];

    const totalAvailable = rows.reduce((s, r) => s + Math.max(0, r.availableQty), 0);

    const priced = rows
      .filter((r) => r.availableQty > 0 && r.unitPrice > 0)
      .sort((a, b) => a.unitPrice - b.unitPrice);

    const cheapestSupplierUnit = priced.length ? priced[0].unitPrice : null;

    return {
      productId: p.productId,
      variantId: p.variantId,
      totalAvailable,
      cheapestSupplierUnit,
    };
  });

  return res.json({ data: out });
});

/* ------------------------- Quote endpoint ------------------------- */
/**
 * POST /api/catalog/quote
 * body: { items: [{ key, kind, productId, variantId, qty }] }
 *
 * Allocates quantity across suppliers by cheapest unit price, respecting availableQty.
 */
const QuoteBody = z.object({
  items: z.array(
    z.object({
      key: z.string().min(1),
      kind: z.enum(["BASE", "VARIANT"]).optional(),
      productId: z.string().min(1),
      variantId: z.string().nullable().optional(),
      qty: z.number().int().positive(),
    })
  ),
});

router.post("/quote", async (req, res) => {
  const body = QuoteBody.parse(req.body);

  const requested = body.items.map((it) => ({
    key: it.key,
    kind: it.kind ?? (it.variantId ? "VARIANT" : "BASE"),
    productId: String(it.productId),
    variantId: it.kind === "BASE" ? null : it.variantId ?? null,
    qty: Math.max(1, asInt(it.qty, 1)),
  }));

  // load offers for just the exact pairs needed
  const pairs = requested.map((r) => ({ productId: r.productId, variantId: r.variantId }));
  const uniq: Array<{ productId: string; variantId: string | null }> = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const k = availKeyFor(p.productId, p.variantId);
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(p);
    }
  }

  const offers = await loadOffersForPairs(uniq);

  const byPair: Record<string, OfferLike[]> = {};
  for (const o of offers) {
    const k = availKeyFor(o.productId, o.variantId);
    if (!o.isActive || !o.inStock) continue;
    if (o.availableQty <= 0) continue;
    if (o.unitPrice < 0) continue;
    if (!byPair[k]) byPair[k] = [];
    byPair[k].push(o);
  }

  // sort cheapest first per pair
  for (const k of Object.keys(byPair)) {
    byPair[k].sort((a, b) => a.unitPrice - b.unitPrice);
  }

  const lines: any[] = [];
  let subtotal = 0;

  for (const r of requested) {
    const pairKey = availKeyFor(r.productId, r.variantId);
    const pool = (byPair[pairKey] ?? []).map((x) => ({ ...x })); // copy for safe mutation

    let remaining = r.qty;
    const allocations: any[] = [];

    for (const o of pool) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.max(0, o.availableQty));
      if (take <= 0) continue;

      allocations.push({
        supplierId: o.supplierId,
        supplierName: o.supplierName ?? null,
        qty: take,
        unitPrice: o.unitPrice,
        offerId: o.id,
        lineTotal: take * o.unitPrice,
      });

      remaining -= take;
      o.availableQty -= take;
    }

    const qtyPriced = r.qty - remaining;
    const lineTotal = allocations.reduce((s, a) => s + asMoney(a.lineTotal, 0), 0);

    const units = allocations.map((a) => asMoney(a.unitPrice, NaN)).filter((n) => Number.isFinite(n));
    const minUnit = units.length ? Math.min(...(units as number[])) : 0;
    const maxUnit = units.length ? Math.max(...(units as number[])) : 0;
    const averageUnit = r.qty > 0 ? lineTotal / r.qty : 0;

    subtotal += lineTotal;

    lines.push({
      key: r.key,
      productId: r.productId,
      variantId: r.variantId,
      kind: r.kind,
      qtyRequested: r.qty,
      qtyPriced,
      allocations,
      lineTotal,
      minUnit,
      maxUnit,
      averageUnit,
      currency: "NGN",
      warnings: qtyPriced < r.qty ? ["Some units could not be priced/allocated."] : undefined,
    });
  }

  // return array form (Cart normalizer supports array or map)
  return res.json({
    data: {
      currency: "NGN",
      subtotal,
      lines,
    },
  });
});

export default router;
