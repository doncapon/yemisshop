// src/utils/cartModel.ts
import { loadCartRaw, saveCartRaw } from "./cartStorage";
import type { MiniCartRow } from "../components/cart/MiniCartToast";

/** The canonical stored line shape (what we keep in localStorage). */
export type CartItemKind = "BASE" | "VARIANT";

export type SelectedOption = {
  attributeId?: string;
  attribute?: string;
  valueId?: string;
  value?: string;
};

export type CartLine = {
  productId: string;
  variantId?: string | null;

  kind: CartItemKind;
  optionsKey: string; // "" for quick-add
  qty: number;

  selectedOptions?: SelectedOption[];
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
};

/** Read local cart lines (always returns array). */
export function readCartLines(): CartLine[] {
  try {
    const raw: any = loadCartRaw();
    return Array.isArray(raw) ? (raw as CartLine[]) : [];
  } catch {
    return [];
  }
}

/** Write local cart lines (always normalizes and dispatches cart:updated via saveCartRaw). */
export function writeCartLines(lines: CartLine[]) {
  const safe = Array.isArray(lines) ? lines : [];
  saveCartRaw(safe as any);
}

/** Upsert/remove a line by (productId, variantId, kind, optionsKey). */
export function upsertCartLine(input: CartLine): CartLine[] {
  const rows = readCartLines();

  const pid = String(input.productId);
  const vid = input.variantId == null ? null : String(input.variantId);
  const kind: CartItemKind = input.kind ?? (vid ? "VARIANT" : "BASE");
  const optionsKey = String(input.optionsKey ?? "");

  const idx = rows.findIndex(
    (x) =>
      String(x.productId) === pid &&
      String(x.variantId ?? null) === String(vid) &&
      String((x.kind ?? (x.variantId ? "VARIANT" : "BASE")).toUpperCase()) === kind &&
      String(x.optionsKey ?? "") === optionsKey
  );

  const nextQty = Math.max(0, Math.floor(Number(input.qty) || 0));

  let next: CartLine[];
  if (nextQty <= 0) {
    next = idx >= 0 ? rows.filter((_, i) => i !== idx) : rows;
  } else if (idx >= 0) {
    next = rows.slice();
    next[idx] = {
      ...next[idx],
      ...input,
      productId: pid,
      variantId: vid,
      kind,
      optionsKey,
      qty: nextQty,
    };
  } else {
    next = rows.concat([
      {
        ...input,
        productId: pid,
        variantId: vid,
        kind,
        optionsKey,
        qty: nextQty,
      },
    ]);
  }

  writeCartLines(next);
  return next;
}

/** Convert stored lines -> MiniCartToast rows (correct field names for toast). */
export function toMiniCartRows(lines: CartLine[]): MiniCartRow[] {
  const arr = Array.isArray(lines) ? lines : [];
  return arr.map((x) => {
    const qty = Math.max(0, Number(x.qty) || 0);
    const unit = Number.isFinite(Number(x.unitPriceCache)) ? Number(x.unitPriceCache) : 0;

    return {
      productId: String(x.productId),
      variantId: x.variantId ?? null,
      title: x.titleSnapshot ?? undefined,
      qty,
      unitPrice: unit,
      totalPrice: unit * qty,
      image: x.imageSnapshot ?? null,
      selectedOptions: Array.isArray(x.selectedOptions)
        ? x.selectedOptions.map((o: any) => ({ attribute: o?.attribute, value: o?.value }))
        : [],
    };
  });
}

/** Convert stored lines -> Cart page items (minimal fields; Cart page can compute totals). */
export type CartPageItem = {
  kind: CartItemKind;
  productId: string;
  variantId?: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions?: any[];
  image?: string;
};

export function toCartPageItems(lines: CartLine[], resolveImageUrl?: (s?: string | null) => string | undefined): CartPageItem[] {
  const arr = Array.isArray(lines) ? lines : [];
  return arr.map((x) => {
    const qty = Math.max(1, Number(x.qty) || 1);
    const unit = Number.isFinite(Number(x.unitPriceCache)) ? Number(x.unitPriceCache) : 0;

    const imgRaw = x.imageSnapshot ?? null;
    const img = resolveImageUrl ? resolveImageUrl(imgRaw) : (imgRaw || undefined);

    return {
      kind: x.kind === "VARIANT" || x.variantId ? "VARIANT" : "BASE",
      productId: String(x.productId),
      variantId: x.variantId == null ? null : String(x.variantId),
      title: String(x.titleSnapshot ?? ""),
      qty,
      unitPrice: unit,
      totalPrice: unit * qty,
      selectedOptions: Array.isArray(x.selectedOptions) ? x.selectedOptions : [],
      image: img,
    };
  });
}

/** Shared qty-in-cart for quick-add lines (optionsKey=""). */
export function qtyInCart(lines: CartLine[], productId: string, variantId: string | null): number {
  const pid = String(productId);
  const vid = variantId == null ? null : String(variantId);
  const kind: CartItemKind = vid ? "VARIANT" : "BASE";
  const optionsKey = "";

  return (lines || [])
    .filter((x) => {
      const xp = String(x.productId);
      const xv = x.variantId == null ? null : String(x.variantId);
      const xk = (x.kind || (xv ? "VARIANT" : "BASE")) as CartItemKind;
      const ok = String(x.optionsKey || "") === optionsKey;

      return xp === pid && String(xv ?? null) === String(vid ?? null) && xk === kind && ok;
    })
    .reduce((s, x) => s + Math.max(0, Number(x.qty) || 0), 0);
}