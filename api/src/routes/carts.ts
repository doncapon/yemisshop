// api/src/routes/cart.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";

const router = Router();

type SelectedOption = { attributeId: string; valueId: string };

// Helper: coerce number
const toNum = (n: any, d = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const applyMargin = (supplierPrice: number, marginPercent: number) => {
  const m = Math.max(0, Number(marginPercent) || 0);
  return round2(supplierPrice * (1 + m / 100));
};

// Helper: build "aid:vid" key
const pairKey = (aid?: string, vid?: string) =>
  `${String(aid || "").trim()}:${String(vid || "").trim()}`;

const lcFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

const MODELS = Prisma.dmmf.datamodel.models;

const modelByName = (name: string) => MODELS.find((m) => m.name === name);

const fieldMap = (modelName: string) => {
  const m = modelByName(modelName);
  return new Map((m?.fields ?? []).map((f) => [f.name, f]));
};

const hasField = (modelName: string, fieldName: string) => fieldMap(modelName).has(fieldName);

function findSettingsModelName(): string | null {
  // try common names first
  const preferred = ["Settings", "Setting", "AppSettings", "AppSetting", "PublicSettings"];
  for (const n of preferred) if (modelByName(n)) return n;

  // fallback: any model containing "setting"
  const any = MODELS.find((m) => m.name.toLowerCase().includes("setting"));
  return any?.name ?? null;
}

async function readMarginPercent(): Promise<number> {
  const settingsModel = findSettingsModelName();
  if (!settingsModel) return 0;

  const m = fieldMap(settingsModel);

  const select: any = {};
  if (m.has("marginPercent")) select.marginPercent = true;
  if (m.has("pricingMarkupPercent")) select.pricingMarkupPercent = true;
  if (m.has("markupPercent")) select.markupPercent = true;

  if (!Object.keys(select).length) return 0;

  try {
    const clientName = lcFirst(settingsModel);
    const row = await (prisma as any)[clientName]?.findFirst?.({ select });
    const margin =
      toNum(row?.marginPercent, NaN) ||
      toNum(row?.pricingMarkupPercent, NaN) ||
      toNum(row?.markupPercent, NaN) ||
      0;
    return Math.max(0, margin);
  } catch {
    return 0;
  }
}

type NormalizedOffer = {
  id: string;
  supplierId: string;
  productId: string;
  variantId: string | null;
  model: "BASE" | "VARIANT";
  isActive: boolean;
  inStock: boolean;
  availableQty: number;
  unitPrice: number | null; // supplier price
};

function pickBool(o: any, keys: string[], fallback: boolean) {
  for (const k of keys) {
    if (k in o) {
      const v = o[k];
      if (v === true) return true;
      if (v === false) return false;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["true", "1", "yes", "y", "on"].includes(s)) return true;
        if (["false", "0", "no", "n", "off", ""].includes(s)) return false;
      }
    }
  }
  return fallback;
}

function pickNum(o: any, keys: string[], fallback: number) {
  for (const k of keys) {
    if (k in o) {
      const v = Number(o[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return fallback;
}

function pickPrice(o: any): number | null {
  const raw =
    o?.unitPrice ??
    o?.basePrice ??
    o?.supplierPrice ??
    o?.unitCost ??
    o?.cost ??
    o?.price ??
    null;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isOfferLikeModel(m: (typeof MODELS)[number]) {
  const f = new Set((m.fields ?? []).map((x) => x.name));
  // must have these
  if (!f.has("productId")) return false;
  if (!f.has("supplierId")) return false;

  // must have some price-ish field
  const priceish = ["unitPrice", "basePrice", "supplierPrice", "unitCost", "cost", "price"].some((k) =>
    f.has(k)
  );
  if (!priceish) return false;

  return true;
}

function getOfferModelNames() {
  const offerModels = MODELS.filter(isOfferLikeModel);

  // split base-only models vs variant-capable models
  const unified = offerModels.filter((m) => (m.fields ?? []).some((f) => f.name === "variantId"));
  const baseOnly = offerModels.filter((m) => !(m.fields ?? []).some((f) => f.name === "variantId"));

  // Prefer the most “offer-looking” names if there are many
  const scoreName = (name: string) => {
    const n = name.toLowerCase();
    let s = 0;
    if (n.includes("offer")) s += 3;
    if (n.includes("supplier")) s += 2;
    if (n.includes("product")) s += 1;
    if (n.includes("variant")) s += 1;
    return s;
  };

  const bestUnified = unified.sort((a, b) => scoreName(b.name) - scoreName(a.name))[0]?.name ?? null;
  const bestBaseOnly = baseOnly.sort((a, b) => scoreName(b.name) - scoreName(a.name))[0]?.name ?? null;

  return { bestUnified, bestBaseOnly };
}

async function loadOffersForProduct(productId: string): Promise<NormalizedOffer[]> {
  const { bestUnified, bestBaseOnly } = getOfferModelNames();

  const out: NormalizedOffer[] = [];

  const pullFromModel = async (modelName: string) => {
    const fm = fieldMap(modelName);
    const select: any = {
      id: true,
      productId: true,
      supplierId: true,
    };
    if (fm.has("variantId")) select.variantId = true;

    // activity/stock fields (if present)
    if (fm.has("isActive")) select.isActive = true;
    if (fm.has("active")) select.active = true;
    if (fm.has("enabled")) select.enabled = true;

    if (fm.has("inStock")) select.inStock = true;
    if (fm.has("in_stock")) select.in_stock = true;
    if (fm.has("available")) select.available = true;

    // qty fields (if present)
    const qtyKeys = ["availableQty", "available", "qty", "stock", "available_quantity"];
    for (const k of qtyKeys) if (fm.has(k)) select[k] = true;

    // price fields (if present)
    const priceKeys = ["unitPrice", "basePrice", "supplierPrice", "unitCost", "cost", "price"];
    for (const k of priceKeys) if (fm.has(k)) select[k] = true;

    const clientName = lcFirst(modelName);
    const rows = await (prisma as any)[clientName]?.findMany?.({
      where: { productId },
      select,
    });

    const arr: any[] = Array.isArray(rows) ? rows : [];
    for (const r of arr) {
      const variantId = ("variantId" in r && r.variantId) ? String(r.variantId) : null;
      const model: "BASE" | "VARIANT" = variantId ? "VARIANT" : "BASE";

      const isActive = pickBool(r, ["isActive", "active", "enabled"], true);
      const inStock = pickBool(r, ["inStock", "in_stock", "available"], true);
      const availableQty = pickNum(r, ["availableQty", "available", "qty", "stock", "available_quantity"], 0);

      out.push({
        id: String(r.id),
        supplierId: String(r.supplierId),
        productId: String(r.productId),
        variantId,
        model,
        isActive,
        inStock,
        availableQty,
        unitPrice: pickPrice(r),
      });
    }
  };

  try {
    if (bestUnified) await pullFromModel(bestUnified);
  } catch {
    // ignore
  }

  try {
    if (bestBaseOnly) await pullFromModel(bestBaseOnly);
  } catch {
    // ignore
  }

  return out;
}

function cheapestOffer(params: {
  offers: NormalizedOffer[];
  kind: "BASE" | "VARIANT";
  variantId?: string | null;
  effectiveVariantQtyByOfferId?: Record<string, number>;
}) {
  const { offers, kind, variantId, effectiveVariantQtyByOfferId } = params;

  let best: { supplierPrice: number; supplierId: string; offerId: string } | null = null;

  for (const o of offers || []) {
    if (!o.isActive || !o.inStock) continue;

    const price = o.unitPrice != null ? Number(o.unitPrice) : NaN;
    if (!Number.isFinite(price) || price <= 0) continue;

    if (kind === "BASE") {
      if (o.model !== "BASE" || o.variantId) continue;
      const qty = Number(o.availableQty ?? 0) || 0;
      if (qty <= 0) continue;
    }

    if (kind === "VARIANT") {
      if (o.model !== "VARIANT") continue;
      if (!variantId) continue;
      if (String(o.variantId ?? "") !== String(variantId)) continue;

      // use effective qty if we computed it; else use raw
      const eff =
        effectiveVariantQtyByOfferId && o.id in effectiveVariantQtyByOfferId
          ? Number(effectiveVariantQtyByOfferId[o.id] ?? 0) || 0
          : Number(o.availableQty ?? 0) || 0;
      if (eff <= 0) continue;
    }

    if (!best || price < best.supplierPrice) {
      best = { supplierPrice: price, supplierId: o.supplierId, offerId: o.id };
    }
  }

  return best;
}

/**
 * POST /api/cart/items
 * Server will compute unitPrice (retail) from supplier offers + marginPercent when possible.
 */
router.post("/items", async (req, res) => {
  try {
    const {
      productId,
      variantId, // optional hint
      selectedOptions = [],
      quantity = 1,
      orderId,
      // client may send this, but we do NOT trust it; we compute server-side
      unitPriceClient,
    } = req.body as {
      productId: string;
      variantId?: string | null;
      selectedOptions?: SelectedOption[];
      quantity?: number;
      orderId?: string | null;
      unitPriceClient?: number | null;
    };

    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        // keep your existing variant loading for selection matching
        ProductVariant: {
          include: {
            options: {
              include: {
                attribute: true,
                value: true,
              },
            },
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: "Product not found" });

    // fallback retail from product table (legacy)
    const productRetailFallback = toNum((product as any).retailPrice ?? (product as any).price, 0);

    // Selected pairs
    const selectedPairs = new Set<string>(
      (Array.isArray(selectedOptions) ? selectedOptions : [])
        .filter((o): o is SelectedOption => !!o && !!o.attributeId && !!o.valueId)
        .map((o) => pairKey(o.attributeId, o.valueId))
    );

    // Find best match variant for selection
    const variants = (product as any).ProductVariant || [];
    const match =
      selectedPairs.size > 0
        ? variants.find((v: { options: any }) => {
            const vPairs = new Set<string>(
              (v.options || []).map((o: any) =>
                pairKey(o.attributeId || o.attribute?.id, o.valueId || o.value?.id)
              )
            );
            for (const p of selectedPairs) {
              if (!vPairs.has(p)) return false;
            }
            return true;
          })
        : null;

    const resolvedVariantId = (match?.id ?? variantId ?? null) as string | null;

    // Load margin + offers
    const marginPercent = await readMarginPercent();
    const offers = await loadOffersForProduct(productId);

    // ---- Compute effective variant stock per offer (baseQtyBySupplier gating) ----
    const baseQtyBySupplier: Record<string, number> = {};
    for (const o of offers) {
      if (o.model !== "BASE" || o.variantId) continue;
      if (!o.isActive || !o.inStock) continue;
      const qty = Number(o.availableQty ?? 0) || 0;
      if (qty <= 0) continue;
      baseQtyBySupplier[o.supplierId] = (baseQtyBySupplier[o.supplierId] ?? 0) + qty;
    }

    // effective qty per VARIANT offer id
    const effectiveVariantQtyByOfferId: Record<string, number> = {};
    for (const o of offers) {
      if (o.model !== "VARIANT" || !o.variantId) continue;
      if (!o.isActive || !o.inStock) continue;

      const baseQty = baseQtyBySupplier[o.supplierId] ?? 0;
      const vQtyRaw = Number(o.availableQty ?? 0) || 0;

      let effective = 0;
      if (vQtyRaw > 0 && baseQty > 0) effective = Math.min(baseQty, vQtyRaw);
      else if (vQtyRaw > 0) effective = vQtyRaw;
      else if (baseQty > 0) effective = baseQty;

      if (effective > 0) effectiveVariantQtyByOfferId[o.id] = effective;
    }

    // ---- Choose supplier offer + compute retail ----
    let chosen:
      | { supplierPrice: number; supplierId: string; offerId: string; source: string }
      | null = null;

    if (match && resolvedVariantId) {
      // Prefer exact variant offer (sellable), fallback to base
      const vBest = cheapestOffer({
        offers,
        kind: "VARIANT",
        variantId: resolvedVariantId,
        effectiveVariantQtyByOfferId,
      });

      const bBest = cheapestOffer({ offers, kind: "BASE" });

      if (vBest) chosen = { ...vBest, source: "VARIANT_OFFER" };
      else if (bBest) chosen = { ...bBest, source: "BASE_OFFER_FALLBACK" };
    } else {
      // Base mode (no variant selection): base offers only
      const bBest = cheapestOffer({ offers, kind: "BASE" });
      if (bBest) chosen = { ...bBest, source: "BASE_OFFER" };
    }

    // compute retail unit price
    let unitPrice = productRetailFallback;

    // variant fallback retail (legacy) if match exists and has retailPrice
    const variantRetailFallback =
      match && selectedPairs.size > 0
        ? toNum((match as any).retailPrice ?? (match as any).price, 0)
        : 0;

    const bestFallback = variantRetailFallback > 0 ? variantRetailFallback : productRetailFallback;

    if (chosen?.supplierPrice && chosen.supplierPrice > 0) {
      unitPrice = applyMargin(chosen.supplierPrice, marginPercent);
    } else if (bestFallback > 0) {
      unitPrice = bestFallback;
    } else if (unitPriceClient != null && Number(unitPriceClient) > 0) {
      // last resort: use client value ONLY if DB had no usable data
      unitPrice = Number(unitPriceClient);
    }

    const qty = Math.max(1, toNum(quantity, 1));
    const lineTotal = round2(unitPrice * qty);

    // If caller gave us a pending "cart order" id, persist; else return preview.
    if (!orderId) {
      return res.json({
        data: {
          productId: (product as any).id,
          variantId: resolvedVariantId,
          quantity: qty,
          unitPrice,
          lineTotal,
          selectedOptions,
          // helpful metadata for debugging / UI
          pricing: chosen
            ? {
                supplierId: chosen.supplierId,
                offerId: chosen.offerId,
                supplierPrice: chosen.supplierPrice,
                marginPercent,
                source: chosen.source,
              }
            : {
                supplierId: null,
                offerId: null,
                supplierPrice: null,
                marginPercent,
                source: "RETAIL_FALLBACK",
              },
        },
        note: "Preview only (no orderId provided). Pass orderId to persist.",
      });
    }

    // Verify order exists
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(400).json({ error: "orderId is invalid or not found" });
    }

    // Build order item data, adding supplier fields if your schema supports it
    const orderItemModel = modelByName("OrderItem");
    const orderItemFields = new Set((orderItemModel?.fields ?? []).map((f) => f.name));

    const data: any = {
      orderId,
      productId: (product as any).id,
      variantId: resolvedVariantId,
      title: (product as any).title,
      quantity: qty,
      unitPrice,
      lineTotal,
      selectedOptions, // JSON
      status: "PENDING",
    };

    // Try common supplier fields (only if they exist in schema)
    if (chosen?.supplierId) {
      if (orderItemFields.has("supplierId")) data.supplierId = chosen.supplierId;
      if (orderItemFields.has("offerId")) data.offerId = chosen.offerId;
      if (orderItemFields.has("supplierOfferId")) data.supplierOfferId = chosen.offerId;
      if (orderItemFields.has("supplierProductOfferId")) data.supplierProductOfferId = chosen.offerId;
      if (orderItemFields.has("supplierVariantOfferId")) data.supplierVariantOfferId = chosen.offerId;
    }

    const item = await prisma.orderItem.create({ data });

    return res.json({
      data: {
        ...item,
        unitPrice,
        pricing: chosen
          ? {
              supplierId: chosen.supplierId,
              offerId: chosen.offerId,
              supplierPrice: chosen.supplierPrice,
              marginPercent,
              source: chosen.source,
            }
          : {
              supplierId: null,
              offerId: null,
              supplierPrice: null,
              marginPercent,
              source: "RETAIL_FALLBACK",
            },
      },
      note: "Server price authoritative",
    });
  } catch (err: any) {
    console.error("POST /api/cart/items failed:", err);
    return res.status(500).json({ error: "Could not add item to cart" });
  }
});

export default router;
