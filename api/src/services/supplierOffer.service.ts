// src/modules/supplierOffer/supplierOffer.service.ts
import { prisma } from '../lib/prisma.js';
import { syncProductInStockCacheTx } from './inventory.service.js';

type UpdateOfferInput = {
  price?: number;               // legacy SupplierOffer.offerPrice
  currency?: string;
  isActive?: boolean;
  availableQty?: number;
  leadDays?: number | null;

  // optional: allow bump updates directly if caller is variant-aware
  priceBump?: number;           // supplierVariantOffer.priceBump
  basePrice?: number;           // supplierProductOffer.basePrice
};

type ParsedOfferId =
  | { model: "BASE"; id: string }
  | { model: "VARIANT"; id: string }
  | { model: "LEGACY"; id: string };

function parseOfferId(rawId: string): ParsedOfferId {
  const id = String(rawId ?? "").trim();
  if (id.startsWith("base:")) return { model: "BASE", id: id.slice("base:".length) };
  if (id.startsWith("variant:")) return { model: "VARIANT", id: id.slice("variant:".length) };
  return { model: "LEGACY", id };
}

function asFiniteNumber(v: any, fallback?: number): number | undefined {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computeInStockFromQty(qty: any): boolean | undefined {
  if (qty == null) return undefined;
  const q = Number(qty);
  if (!Number.isFinite(q)) return undefined;
  return q > 0;
}

/**
 * Updates an offer row by id.
 * Supports:
 * - id="base:xxx"   -> supplierProductOffer (basePrice)
 * - id="variant:yy" -> supplierVariantOffer (priceBump)
 * - id="zz"         -> legacy supplierOffer (offerPrice)
 *
 * Always syncs product in-stock cache after changes.
 */
export async function updateSupplierOffer(id: string, data: UpdateOfferInput) {
  const parsed = parseOfferId(id);

  return prisma.$transaction(async (tx: any) => {
    // ---- BASE OFFER (supplierProductOffer) ----
    if (parsed.model === "BASE") {
      const current = await tx.supplierProductOffer.findUnique({
        where: { id: parsed.id },
        select: { id: true, productId: true, availableQty: true },
      });
      if (!current) throw new Error("Offer not found");

      const nextQty =
        data.availableQty != null ? Math.trunc(asFiniteNumber(data.availableQty, current.availableQty)!) : undefined;

      const updated = await tx.supplierProductOffer.update({
        where: { id: parsed.id },
        data: {
          ...(data.basePrice != null
            ? { basePrice: asFiniteNumber(data.basePrice, 0) ?? 0 }
            : data.price != null
              ? { basePrice: asFiniteNumber(data.price, 0) ?? 0 } // allow old callers that send `price`
              : {}),

          ...(data.currency != null ? { currency: data.currency } : {}),
          ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
          ...(nextQty != null ? { availableQty: nextQty } : {}),
          ...(data.leadDays !== undefined ? { leadDays: data.leadDays } : {}),

          // keep inStock consistent with qty when qty is explicitly updated
          ...(nextQty != null ? { inStock: nextQty > 0 } : {}),
        },
        select: { id: true, productId: true, availableQty: true, inStock: true, isActive: true },
      });

      await syncProductInStockCacheTx(tx, updated.productId);

      // keep your external API stable: return original id format
      return { ...updated, id: `base:${updated.id}` };
    }

    // ---- VARIANT OFFER (supplierVariantOffer) ----
    if (parsed.model === "VARIANT") {
      const current = await tx.supplierVariantOffer.findUnique({
        where: { id: parsed.id },
        select: { id: true, productId: true, availableQty: true },
      });
      if (!current) throw new Error("Offer not found");

      const nextQty =
        data.availableQty != null ? Math.trunc(asFiniteNumber(data.availableQty, current.availableQty)!) : undefined;

      const updated = await tx.supplierVariantOffer.update({
        where: { id: parsed.id },
        data: {
          ...(data.priceBump != null
            ? { priceBump: asFiniteNumber(data.priceBump, 0) ?? 0 }
            : data.price != null
              ? { priceBump: asFiniteNumber(data.price, 0) ?? 0 } // allow old callers that send `price`
              : {}),

          ...(data.currency != null ? { currency: data.currency } : {}),
          ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
          ...(nextQty != null ? { availableQty: nextQty } : {}),
          ...(data.leadDays !== undefined ? { leadDays: data.leadDays } : {}),

          // keep inStock consistent with qty when qty is explicitly updated
          ...(nextQty != null ? { inStock: nextQty > 0 } : {}),
        },
        select: { id: true, productId: true, availableQty: true, inStock: true, isActive: true, variantId: true },
      });

      await syncProductInStockCacheTx(tx, updated.productId);

      return { ...updated, id: `variant:${updated.id}` };
    }

    // ---- LEGACY OFFER (supplierOffer) ----
    // Keep this for backwards compatibility while you migrate.
    const current = await tx.supplierOffer.findUnique({
      where: { id: parsed.id },
      select: { id: true, productId: true, availableQty: true },
    });
    if (!current) throw new Error("Offer not found");

    const nextQty =
      data.availableQty != null ? Math.trunc(asFiniteNumber(data.availableQty, current.availableQty)!) : undefined;

    const nextInStock = computeInStockFromQty(nextQty);

    const updated = await tx.supplierOffer.update({
      where: { id: parsed.id },
      data: {
        ...(data.price != null ? { offerPrice: asFiniteNumber(data.price, 0) ?? 0 } : {}),
        ...(data.currency != null ? { currency: data.currency } : {}),
        ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
        ...(nextQty != null ? { availableQty: nextQty } : {}),
        ...(data.leadDays !== undefined ? { leadDays: data.leadDays } : {}),
        ...(nextInStock != null ? { inStock: nextInStock } : {}),
      },
      select: { id: true, productId: true, availableQty: true, inStock: true, isActive: true },
    });

    await syncProductInStockCacheTx(tx, updated.productId);
    return updated;
  });
}

/**
 * Restock an offer by delta (positive or negative), with a "no negative qty" guard.
 * Supports base:/variant:/legacy ids.
 */
export async function restockSupplierOffer(id: string, delta: number) {
  const parsed = parseOfferId(id);
  if (!Number.isFinite(delta)) throw new Error("Invalid delta");

  return prisma.$transaction(async (tx: any) => {
    const d = Math.trunc(delta);

    // BASE
    if (parsed.model === "BASE") {
      const current = await tx.supplierProductOffer.findUnique({
        where: { id: parsed.id },
        select: { id: true, productId: true, availableQty: true },
      });
      if (!current) throw new Error("Offer not found");

      const nextQty = Number(current.availableQty ?? 0) + d;
      if (nextQty < 0) throw new Error("Resulting quantity would be negative");

      const updated = await tx.supplierProductOffer.update({
        where: { id: parsed.id },
        data: { availableQty: nextQty, inStock: nextQty > 0 },
        select: { id: true, productId: true, availableQty: true, inStock: true },
      });

      await syncProductInStockCacheTx(tx, updated.productId);
      return { ...updated, id: `base:${updated.id}` };
    }

    // VARIANT
    if (parsed.model === "VARIANT") {
      const current = await tx.supplierVariantOffer.findUnique({
        where: { id: parsed.id },
        select: { id: true, productId: true, availableQty: true },
      });
      if (!current) throw new Error("Offer not found");

      const nextQty = Number(current.availableQty ?? 0) + d;
      if (nextQty < 0) throw new Error("Resulting quantity would be negative");

      const updated = await tx.supplierVariantOffer.update({
        where: { id: parsed.id },
        data: { availableQty: nextQty, inStock: nextQty > 0 },
        select: { id: true, productId: true, availableQty: true, inStock: true, variantId: true },
      });

      await syncProductInStockCacheTx(tx, updated.productId);
      return { ...updated, id: `variant:${updated.id}` };
    }

    // LEGACY
    const current = await tx.supplierOffer.findUnique({
      where: { id: parsed.id },
      select: { id: true, productId: true, availableQty: true },
    });
    if (!current) throw new Error("Offer not found");

    const nextQty = Number(current.availableQty ?? 0) + d;
    if (nextQty < 0) throw new Error("Resulting quantity would be negative");

    const updated = await tx.supplierOffer.update({
      where: { id: parsed.id },
      data: { availableQty: nextQty, inStock: nextQty > 0 },
      select: { id: true, productId: true, availableQty: true, inStock: true },
    });

    await syncProductInStockCacheTx(tx, updated.productId);
    return updated;
  });
}
