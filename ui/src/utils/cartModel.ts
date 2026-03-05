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
  optionsKey: string; // "" for BASE / quick-add
  qty: number;

  selectedOptions?: SelectedOption[];
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
};

/* ------------------------- Normalization helpers ------------------------- */

function toStr(v: any) {
  return String(v ?? "").trim();
}

function normVariantId(v: any): string | null {
  const s = toStr(v);
  return s ? s : null;
}

function normQty(v: any) {
  const n = Math.floor(Number(v) || 0);
  return Math.max(0, n);
}

function normKind(input: any, variantId: string | null): CartItemKind {
  const k = toStr(input).toUpperCase();
  if (k === "BASE" || k === "VARIANT") return k as CartItemKind;
  return variantId ? "VARIANT" : "BASE";
}

function normOptionsKey(raw: any): string {
  const s = toStr(raw);
  if (!s) return "";
  // make optionsKey stable: "a:b|c:d" sorted
  const parts = s
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return parts.join("|");
}

function normalizeLine(x: any): CartLine | null {
  const productId = toStr(x?.productId);
  if (!productId) return null;

  const vid = normVariantId(x?.variantId);
  const kind = normKind(x?.kind, vid);

  // IMPORTANT:
  // BASE must never carry variantId/optionsKey — this prevents collisions/mis-matches.
  const variantId = kind === "BASE" ? null : vid;
  const optionsKey = kind === "BASE" ? "" : normOptionsKey(x?.optionsKey);

  return {
    productId,
    variantId,
    kind,
    optionsKey,
    qty: normQty(x?.qty),

    selectedOptions: Array.isArray(x?.selectedOptions) ? x.selectedOptions : undefined,
    titleSnapshot: x?.titleSnapshot != null ? String(x.titleSnapshot) : null,
    imageSnapshot: x?.imageSnapshot != null ? String(x.imageSnapshot) : null,
    unitPriceCache:
      x?.unitPriceCache != null && Number.isFinite(Number(x.unitPriceCache))
        ? Number(x.unitPriceCache)
        : null,
  };
}

function sameIdentity(a: CartLine, b: CartLine) {
  return (
    toStr(a.productId) === toStr(b.productId) &&
    String(a.variantId ?? null) === String(b.variantId ?? null) &&
    toStr(a.kind).toUpperCase() === toStr(b.kind).toUpperCase() &&
    toStr(a.optionsKey) === toStr(b.optionsKey)
  );
}

/** Read local cart lines (always returns array). */
export function readCartLines(): CartLine[] {
  try {
    const raw: any = loadCartRaw();
    const arr: any[] = Array.isArray(raw) ? raw : [];

    // normalize + drop empty/invalid
    const normalized = arr
      .map(normalizeLine)
      .filter(Boolean) as CartLine[];

    // drop qty<=0
    const kept = normalized.filter((l) => (l.qty ?? 0) > 0);

    // de-dupe by identity (merge qty)
    const out: CartLine[] = [];
    for (const l of kept) {
      const idx = out.findIndex((x) => sameIdentity(x, l));
      if (idx >= 0) {
        out[idx] = {
          ...out[idx],
          // merge qty
          qty: normQty((out[idx].qty ?? 0) + (l.qty ?? 0)),
          // keep best snapshots
          titleSnapshot: out[idx].titleSnapshot || l.titleSnapshot || null,
          imageSnapshot: out[idx].imageSnapshot || l.imageSnapshot || null,
          unitPriceCache: out[idx].unitPriceCache ?? l.unitPriceCache ?? null,
          selectedOptions:
            (out[idx].selectedOptions?.length ? out[idx].selectedOptions : null) ||
            (l.selectedOptions?.length ? l.selectedOptions : undefined),
        };
      } else {
        out.push(l);
      }
    }

    // persist cleaned cart once so old bad shapes stop reappearing
    saveCartRaw(out as any);

    return out;
  } catch {
    return [];
  }
}

/** Write local cart lines (always normalizes and dispatches cart:updated via saveCartRaw). */
export function writeCartLines(lines: CartLine[]) {
  const safe = Array.isArray(lines) ? lines : [];
  const normalized = safe
    .map(normalizeLine)
    .filter(Boolean) as CartLine[];

  // drop qty<=0
  const kept = normalized.filter((l) => (l.qty ?? 0) > 0);

  saveCartRaw(kept as any);
}

/** Upsert/remove a line by (productId, variantId, kind, optionsKey). */
export function upsertCartLine(input: CartLine): CartLine[] {
  const rows = readCartLines();

  // Normalize incoming line SAME way as stored
  const normalized = normalizeLine(input);
  if (!normalized) return rows;

  const nextQty = normQty(normalized.qty);

  const idx = rows.findIndex((x) => sameIdentity(x, normalized));

  let next: CartLine[];
  if (nextQty <= 0) {
    next = idx >= 0 ? rows.filter((_, i) => i !== idx) : rows;
  } else if (idx >= 0) {
    next = rows.slice();
    next[idx] = {
      ...next[idx],
      ...normalized,
      qty: nextQty,
    };
  } else {
    next = rows.concat([{ ...normalized, qty: nextQty }]);
  }

  writeCartLines(next);
  return next;
}

/** Convert stored lines -> MiniCartToast rows (correct field names for toast). */
export function toMiniCartRows(lines: CartLine[]): MiniCartRow[] {
  const arr = Array.isArray(lines) ? lines : [];
  const normalized = arr.map(normalizeLine).filter(Boolean) as CartLine[];

  return normalized.map((x) => {
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

export function toCartPageItems(
  lines: CartLine[],
  resolveImageUrl?: (s?: string | null) => string | undefined
): CartPageItem[] {
  const arr = Array.isArray(lines) ? lines : [];
  const normalized = arr.map(normalizeLine).filter(Boolean) as CartLine[];

  return normalized.map((x) => {
    const qty = Math.max(1, Number(x.qty) || 1);
    const unit = Number.isFinite(Number(x.unitPriceCache)) ? Number(x.unitPriceCache) : 0;

    const imgRaw = x.imageSnapshot ?? null;
    const img = resolveImageUrl ? resolveImageUrl(imgRaw) : imgRaw || undefined;

    return {
      kind: x.kind, // already normalized
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

  // quick-add identity = BASE if no variantId, else VARIANT quick-add
  const kind: CartItemKind = vid ? "VARIANT" : "BASE";
  const optionsKey = "";

  const normalized = (lines || []).map(normalizeLine).filter(Boolean) as CartLine[];

  return normalized
    .filter((x) => {
      return (
        String(x.productId) === pid &&
        String(x.variantId ?? null) === String(vid ?? null) &&
        x.kind === kind &&
        String(x.optionsKey || "") === optionsKey
      );
    })
    .reduce((s, x) => s + Math.max(0, Number(x.qty) || 0), 0);
}