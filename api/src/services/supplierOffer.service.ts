// src/modules/supplierOffer/supplierOffer.service.ts
import { prisma } from "../lib/prisma.js";
import { syncProductInStockCacheTx } from "./inventory.service.js";

type UpdateOfferInput = {
  /**
   * Back-compat: some callers still send `price`.
   * - BASE: mapped to SupplierProductOffer.basePrice
   * - VARIANT: mapped to SupplierVariantOffer.unitPrice
   * - LEGACY (if your old table still exists): mapped to supplierOffer.offerPrice
   */
  price?: number;

  currency?: string;
  isActive?: boolean;
  availableQty?: number;
  leadDays?: number | null;

  // explicit base price (preferred for base offers)
  basePrice?: number;

  // explicit variant price (preferred for variant offers)
  variantPrice?: number;
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
 * - id="base:xxx"   -> SupplierProductOffer (basePrice)
 * - id="variant:yy" -> SupplierVariantOffer (unitPrice)
 * - id="zz"         -> legacy supplierOffer (offerPrice) if you still have it
 *
 * Always syncs product in-stock cache after changes.
 */
export async function updateSupplierOffer(id: string, data: UpdateOfferInput) {
  const parsed = parseOfferId(id);

  return prisma.$transaction(async (tx: any) => {
    // ---- BASE OFFER (SupplierProductOffer) ----
    if (parsed.model === "BASE") {
      const current = await tx.supplierProductOffer.findUnique({
        where: { id: parsed.id },
        select: { id: true, productId: true, availableQty: true },
      });
      if (!current) throw new Error("Offer not found");

      const nextQty =
        data.availableQty != null
          ? Math.trunc(asFiniteNumber(data.availableQty, current.availableQty)!)
          : undefined;

      const incomingBasePrice =
        data.basePrice != null ? data.basePrice : data.price != null ? data.price : undefined;

      const updated = await tx.supplierProductOffer.update({
        where: { id: parsed.id },
        data: {
          ...(incomingBasePrice != null
            ? { basePrice: asFiniteNumber(incomingBasePrice, 0) ?? 0 }
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
      return { ...updated, id: `base:${updated.id}` };
    }

    // ---- VARIANT OFFER (SupplierVariantOffer) ----
    if (parsed.model === "VARIANT") {
      const current = await tx.supplierVariantOffer.findUnique({
        where: { id: parsed.id },
        select: { id: true, productId: true, availableQty: true },
      });
      if (!current) throw new Error("Offer not found");

      const nextQty =
        data.availableQty != null
          ? Math.trunc(asFiniteNumber(data.availableQty, current.availableQty)!)
          : undefined;

      const incomingVariantPrice =
        data.variantPrice != null ? data.variantPrice : data.price != null ? data.price : undefined;

      const updated = await tx.supplierVariantOffer.update({
        where: { id: parsed.id },
        data: {
          ...(incomingVariantPrice != null
            ? { unitPrice: asFiniteNumber(incomingVariantPrice, 0) ?? 0 }
            : {}),

          ...(data.currency != null ? { currency: data.currency } : {}),
          ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
          ...(nextQty != null ? { availableQty: nextQty } : {}),
          ...(data.leadDays !== undefined ? { leadDays: data.leadDays } : {}),

          // keep inStock consistent with qty when qty is explicitly updated
          ...(nextQty != null ? { inStock: nextQty > 0 } : {}),
        },
        select: {
          id: true,
          productId: true,
          availableQty: true,
          inStock: true,
          isActive: true,
          variantId: true,
        },
      });

      await syncProductInStockCacheTx(tx, updated.productId);
      return { ...updated, id: `variant:${updated.id}` };
    }

    // ---- LEGACY OFFER (supplierOffer) ----
    // Keep this only if you still have the legacy table in your DB.
    const current = await tx.supplierOffer.findUnique({
      where: { id: parsed.id },
      select: { id: true, productId: true, availableQty: true },
    });
    if (!current) throw new Error("Offer not found");

    const nextQty =
      data.availableQty != null
        ? Math.trunc(asFiniteNumber(data.availableQty, current.availableQty)!)
        : undefined;

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
