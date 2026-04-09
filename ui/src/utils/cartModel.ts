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
  supplierId?: string | null;
  offerId?: string;
  kind: CartItemKind;
  optionsKey: string; // "" for BASE / quick-add
  qty: number;

  selectedOptions?: SelectedOption[];
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
  /** True when the item was quick-added from a variant product and still needs options chosen. */
  needsOptions?: boolean;
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

  // Support legacy JSON-ish keys as well as pipe keys.
  // Final output is always stable pipe format: "attribute:value|attribute:value"
  try {
    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      const parsed = JSON.parse(s);

      const options = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.options)
          ? parsed.options
          : [];

      const parts = options
        .map((o: any) => {
          const attribute = toStr(
            o?.attribute ??
            o?.attributeName ??
            o?.name ??
            o?.key ??
            o?.attributeId
          );
          const value = toStr(
            o?.value ??
            o?.valueName ??
            o?.option ??
            o?.text ??
            o?.valueId
          );
          return attribute || value ? `${attribute}:${value}` : "";
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.localeCompare(b));

      return parts.join("|");
    }
  } catch {
    // fall through to pipe parser
  }

  const parts = s
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return parts.join("|");
}

function normalizeSelectedOptions(raw: any): SelectedOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const out = raw
    .map((o: any) => ({
      attributeId: o?.attributeId != null ? String(o.attributeId) : undefined,
      attribute: o?.attribute != null ? String(o.attribute) : undefined,
      valueId: o?.valueId != null ? String(o.valueId) : undefined,
      value: o?.value != null ? String(o.value) : undefined,
    }))
    .filter((o) => o.attributeId || o.attribute || o.valueId || o.value);

  return out.length ? out : undefined;
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
    supplierId: x?.supplierId != null ? toStr(x.supplierId) || null : undefined,
    offerId: x?.offerId != null ? toStr(x.offerId) || undefined : undefined,
    kind,
    optionsKey,
    qty: normQty(x?.qty),

    selectedOptions: normalizeSelectedOptions(x?.selectedOptions),
    titleSnapshot: x?.titleSnapshot != null ? String(x.titleSnapshot) : null,
    imageSnapshot: x?.imageSnapshot != null ? String(x.imageSnapshot) : null,
    unitPriceCache:
      x?.unitPriceCache != null && Number.isFinite(Number(x.unitPriceCache))
        ? Number(x.unitPriceCache)
        : null,
    needsOptions: x?.needsOptions === true ? true : undefined,
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

function stableStringify(value: any): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

function chooseSnapshotString(nextValue: any, prevValue: any): string | null {
  const nextStr = nextValue != null ? String(nextValue).trim() : "";
  if (nextStr) return nextStr;

  const prevStr = prevValue != null ? String(prevValue).trim() : "";
  return prevStr || null;
}

function chooseSnapshotNumber(nextValue: any, prevValue: any): number | null {
  const nextNum = Number(nextValue);
  if (Number.isFinite(nextNum) && nextNum > 0) return nextNum;

  const prevNum = Number(prevValue);
  if (Number.isFinite(prevNum) && prevNum > 0) return prevNum;

  return null;
}

function dedupeNormalizedLines(lines: CartLine[]): CartLine[] {
  const kept = lines.filter((l) => (l.qty ?? 0) > 0);

  const out: CartLine[] = [];
  for (const l of kept) {
    const idx = out.findIndex((x) => sameIdentity(x, l));
    if (idx >= 0) {
      out[idx] = {
        ...out[idx],
        supplierId: out[idx].supplierId ?? l.supplierId ?? undefined,
        offerId: out[idx].offerId ?? l.offerId ?? undefined,
        qty: normQty((out[idx].qty ?? 0) + (l.qty ?? 0)),
        titleSnapshot: out[idx].titleSnapshot || l.titleSnapshot || null,
        imageSnapshot: out[idx].imageSnapshot || l.imageSnapshot || null,
        unitPriceCache: out[idx].unitPriceCache ?? l.unitPriceCache ?? null,
        selectedOptions:
          (out[idx].selectedOptions?.length ? out[idx].selectedOptions : null) ||
          (l.selectedOptions?.length ? l.selectedOptions : undefined),
        needsOptions: out[idx].needsOptions ?? l.needsOptions,
      };
    } else {
      out.push(l);
    }
  }

  return out;
}

function normalizeCartArray(raw: any): CartLine[] {
  const arr: any[] = Array.isArray(raw) ? raw : [];
  const normalized = arr.map(normalizeLine).filter(Boolean) as CartLine[];
  return dedupeNormalizedLines(normalized);
}

/** Read local cart lines (always returns array). */
export function readCartLines(): CartLine[] {
  try {
    const raw = loadCartRaw();
    return normalizeCartArray(raw);
  } catch {
    return [];
  }
}

/** Write local cart lines (always normalizes and dispatches cart:updated via saveCartRaw). */
export function writeCartLines(lines: CartLine[]) {
  const next = normalizeCartArray(Array.isArray(lines) ? lines : []);
  const prev = normalizeCartArray(loadCartRaw());

  // Critical guard: do not re-save identical cart data.
  if (stableStringify(prev) === stableStringify(next)) {
    return;
  }

  saveCartRaw(next as any);
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
    const prev = rows[idx];

    next = rows.slice();
    next[idx] = {
      ...prev,
      ...normalized,

      qty: nextQty,

      // Preserve snapshots if incoming update does not provide them
      titleSnapshot: chooseSnapshotString(
        normalized.titleSnapshot,
        prev.titleSnapshot
      ),
      imageSnapshot: chooseSnapshotString(
        normalized.imageSnapshot,
        prev.imageSnapshot
      ),
      unitPriceCache: chooseSnapshotNumber(
        normalized.unitPriceCache,
        prev.unitPriceCache
      ),

      // Preserve selected options if incoming update is empty
      selectedOptions:
        (normalized.selectedOptions?.length
          ? normalized.selectedOptions
          : undefined) ??
        prev.selectedOptions,

      // Preserve supplier/offer if the incoming line does not specify them
      supplierId: normalized.supplierId ?? prev.supplierId ?? undefined,
      offerId: normalized.offerId ?? prev.offerId ?? undefined,
      needsOptions: normalized.needsOptions ?? prev.needsOptions,
    };
  } else {
    next = rows.concat([
      {
        ...normalized,
        qty: nextQty,
      },
    ]);
  }

  writeCartLines(next);
  return readCartLines();
}

/** Convert stored lines -> MiniCartToast rows (correct field names for toast). */
export function toMiniCartRows(lines: CartLine[]): MiniCartRow[] {
  const arr = Array.isArray(lines) ? lines : [];
  const normalized = normalizeCartArray(arr);

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
  needsOptions?: boolean;
};

export function toCartPageItems(
  lines: CartLine[],
  resolveImageUrl?: (s?: string | null) => string | undefined
): CartPageItem[] {
  const arr = Array.isArray(lines) ? lines : [];
  const normalized = normalizeCartArray(arr);

  return normalized.map((x) => {
    const qty = Math.max(1, Number(x.qty) || 1);
    const unit = Number.isFinite(Number(x.unitPriceCache)) ? Number(x.unitPriceCache) : 0;

    const imgRaw = x.imageSnapshot ?? null;
    const img = resolveImageUrl ? resolveImageUrl(imgRaw) : imgRaw || undefined;

    return {
      kind: x.kind,
      productId: String(x.productId),
      variantId: x.variantId == null ? null : String(x.variantId),
      title: String(x.titleSnapshot ?? ""),
      qty,
      unitPrice: unit,
      totalPrice: unit * qty,
      selectedOptions: Array.isArray(x.selectedOptions) ? x.selectedOptions : [],
      image: img,
      needsOptions: x.needsOptions === true ? true : undefined,
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

  const normalized = normalizeCartArray(lines || []);

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