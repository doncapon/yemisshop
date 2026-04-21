// src/pages/Cart.tsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";
import { useAuthStore } from "../store/auth";
import { readCartLines, writeCartLines, toCartPageItems } from "../utils/cartModel";

/* ---------------- Types ---------------- */

type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartItem = {
  id?: string;
  sourceIds?: string[];
  kind?: "BASE" | "VARIANT";
  productId: string;
  variantId?: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions?: SelectedOption[];
  image?: string;
  /** True when the item was quick-added from a variant product and still needs options chosen. */
  needsOptions?: boolean;
};

type ServerCartItem = {
  id: string;
  productId: string;
  variantId?: string | null;
  kind?: "BASE" | "VARIANT";
  qty: number;
  selectedOptions?: any;
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: any;
};

type ServerCartNormalizationResult = {
  items: CartItem[];
  duplicateIdsToDelete: string[];
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const API_ORIGIN =
  String((import.meta as any)?.env?.VITE_API_URL || (import.meta as any)?.env?.API_URL || "")
    .trim()
    .replace(/\/+$/, "") || "https://api.dayspringhouse.com";

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

/* ---------------- Helpers ---------------- */

function resolveImageUrl(input?: any): string | undefined {
  if (input == null) return undefined;

  if (Array.isArray(input)) {
    for (const item of input) {
      const resolved = resolveImageUrl(item);
      if (resolved) return resolved;
    }
    return undefined;
  }

  if (typeof input === "object") {
    const candidate =
      input.url ??
      input.src ??
      input.image ??
      input.imageUrl ??
      input.absoluteUrl ??
      null;

    return candidate ? resolveImageUrl(candidate) : undefined;
  }

  const s = String(input ?? "").trim();
  if (!s) return undefined;

  if (
    (s.startsWith("[") && s.endsWith("]")) ||
    (s.startsWith("{") && s.endsWith("}"))
  ) {
    try {
      const parsed = JSON.parse(s);
      return resolveImageUrl(parsed);
    } catch {
      //
    }
  }

  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;

  if (s.startsWith("/")) {
    if (s.startsWith("/uploads/") || s.startsWith("/api/uploads/")) {
      return `${API_ORIGIN}${s}`;
    }
    return `${window.location.origin}${s}`;
  }

  if (s.startsWith("uploads/") || s.startsWith("api/uploads/")) {
    return `${API_ORIGIN}/${s.replace(/^\/+/, "")}`;
  }

  return `${window.location.origin}/${s.replace(/^\/+/, "")}`;
}

function asMoney(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeSelectedOptions(raw: any): SelectedOption[] {
  const arr = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((o: any) => ({
      attributeId: String(o.attributeId ?? ""),
      attribute: String(o.attribute ?? ""),
      valueId: o.valueId ? String(o.valueId) : undefined,
      value: String(o.value ?? ""),
    }))
    .filter((o: any) => o.attributeId || o.attribute || o.valueId || o.value);

  arr.sort((a, b) => {
    const aKey = `${a.attributeId}:${a.valueId ?? a.value}`;
    const bKey = `${b.attributeId}:${b.valueId ?? b.value}`;
    return aKey.localeCompare(bKey);
  });

  return arr;
}

function optionsKey(sel?: SelectedOption[]) {
  const s = (sel ?? []).filter(Boolean);
  if (!s.length) return "";
  return s.map((o) => `${o.attributeId}=${o.valueId ?? o.value}`).join("|");
}

function lineKeyFor(item: Pick<CartItem, "productId" | "variantId" | "selectedOptions" | "kind">) {
  const pid = String(item.productId);
  const vid = item.variantId == null ? null : String(item.variantId);
  const sel = normalizeSelectedOptions(item.selectedOptions);

  const kind: "BASE" | "VARIANT" =
    item.kind === "BASE" || item.kind === "VARIANT"
      ? item.kind
      : item.variantId
        ? "VARIANT"
        : "BASE";

  if (kind === "VARIANT") {
    if (vid) return `${pid}::v:${vid}`;
    return sel.length ? `${pid}::o:${optionsKey(sel)}` : `${pid}::v:unknown`;
  }

  return `${pid}::base`;
}

function sameLine(a: CartItem, b: Pick<CartItem, "productId" | "variantId" | "selectedOptions" | "kind">) {
  return lineKeyFor(a) === lineKeyFor(b);
}

function isCodeLike(raw: string | undefined | null): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (/^cmm[0-9a-z]{5,}$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;
  return false;
}

function isBaseLine(it: CartItem) {
  if (it.variantId) return false;
  if (it.kind === "VARIANT") return false;
  return true;
}

function sameCartItems(a: CartItem[], b: CartItem[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (!y) return false;

    if (lineKeyFor(x) !== lineKeyFor(y)) return false;
    if (String(x.title ?? "") !== String(y.title ?? "")) return false;
    if (String(x.image ?? "") !== String(y.image ?? "")) return false;
    if (Math.max(1, Number(x.qty) || 1) !== Math.max(1, Number(y.qty) || 1)) return false;
    if (asMoney(x.unitPrice, 0) !== asMoney(y.unitPrice, 0)) return false;
    if (asMoney(x.totalPrice, 0) !== asMoney(y.totalPrice, 0)) return false;

    const xs = normalizeSelectedOptions(x.selectedOptions);
    const ys = normalizeSelectedOptions(y.selectedOptions);
    if (xs.length !== ys.length) return false;

    for (let j = 0; j < xs.length; j += 1) {
      if (
        xs[j].attributeId !== ys[j].attributeId ||
        xs[j].attribute !== ys[j].attribute ||
        String(xs[j].valueId ?? "") !== String(ys[j].valueId ?? "") ||
        xs[j].value !== ys[j].value
      ) {
        return false;
      }
    }
  }

  return true;
}

function cartSignature(items: CartItem[]) {
  return items
    .map((x) => {
      const sel = normalizeSelectedOptions(x.selectedOptions)
        .map((o) => `${o.attributeId}:${o.valueId ?? ""}:${o.value}`)
        .join(",");
      return [
        lineKeyFor(x),
        Math.max(0, Number(x.qty) || 0),
        Number.isFinite(Number(x.unitPrice)) ? Number(x.unitPrice) : 0,
        String(x.title ?? ""),
        String(x.image ?? ""),
        sel,
      ].join("::");
    })
    .join("||");
}

function normalizeCartItemLike(item: any): CartItem | null {
  const productId = String(item?.productId ?? "").trim();
  if (!productId) return null;

  const kind: "BASE" | "VARIANT" =
    item?.kind === "BASE" || item?.kind === "VARIANT"
      ? item.kind
      : item?.variantId
        ? "VARIANT"
        : "BASE";

  const qty = Math.max(1, Number(item?.qty) || 1);

  const unit =
    asMoney(item?.unitPrice, NaN) > 0
      ? asMoney(item.unitPrice, 0)
      : asMoney(item?.unitPriceCache, NaN) > 0
        ? asMoney(item.unitPriceCache, 0)
        : qty > 0
          ? asMoney(item?.totalPrice, 0) / qty
          : 0;

  const safeUnit = Number.isFinite(unit) && unit >= 0 ? unit : 0;

  return {
    id: item?.id != null ? String(item.id) : undefined,
    sourceIds: Array.isArray(item?.sourceIds)
      ? item.sourceIds.map(String).filter(Boolean)
      : item?.id != null
        ? [String(item.id)]
        : [],
    kind,
    productId,
    variantId: item?.variantId == null ? null : String(item.variantId),
    title: String(item?.title ?? item?.titleSnapshot ?? ""),
    qty,
    unitPrice: safeUnit,
    totalPrice: round2(safeUnit * qty),
    selectedOptions: normalizeSelectedOptions(item?.selectedOptions),
    image: resolveImageUrl(item?.image ?? item?.imageSnapshot),
    needsOptions: item?.needsOptions === true ? true : undefined,
  };
}

function mergeCartItemsByLine(items: CartItem[]): CartItem[] {
  const map = new Map<string, CartItem>();

  for (const raw of items) {
    const item = normalizeCartItemLike(raw);
    if (!item) continue;

    const key = lineKeyFor(item);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        ...item,
        sourceIds: Array.from(new Set((item.sourceIds ?? []).map(String).filter(Boolean))),
      });
      continue;
    }

    const existingQty = Math.max(1, Number(existing.qty) || 1);
    const nextQty = Math.max(1, Number(item.qty) || 1);

    const chosenUnit =
      asMoney(existing.unitPrice, 0) > 0
        ? asMoney(existing.unitPrice, 0)
        : asMoney(item.unitPrice, 0);

    const canonicalQty = Math.max(existingQty, nextQty);

    const merged: CartItem = {
      ...existing,
      id: existing.id || item.id,
      sourceIds: Array.from(
        new Set(
          [
            ...(existing.sourceIds ?? []),
            ...(item.sourceIds ?? []),
            ...(item.id ? [String(item.id)] : []),
          ]
            .map(String)
            .filter(Boolean)
        )
      ),
      title: String(existing.title || item.title || ""),
      image: existing.image || item.image,
      qty: canonicalQty,
      unitPrice: chosenUnit,
      totalPrice: round2(chosenUnit * canonicalQty),
      selectedOptions:
        (existing.selectedOptions?.length ? existing.selectedOptions : item.selectedOptions) ?? [],
    };

    map.set(key, merged);
  }

  return Array.from(map.values());
}

function cartItemsToStorageLines(items: CartItem[]) {
  return mergeCartItemsByLine(items)
    .map((it) => ({
      productId: String(it.productId),
      variantId: it.variantId == null ? null : String(it.variantId),
      kind: (it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE") as "BASE" | "VARIANT",
      optionsKey: "",
      qty: Math.max(0, Math.floor(Number(it.qty) || 0)),
      selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : [],
      titleSnapshot: it.title ?? null,
      imageSnapshot: it.image ?? null,
      unitPriceCache: Number.isFinite(Number(it.unitPrice)) ? Number(it.unitPrice) : 0,
      needsOptions: it.needsOptions === true ? true : undefined,
    }))
    .filter((x) => x.qty > 0);
}

function readLocalCartCanonical(): CartItem[] {
  try {
    const raw = toCartPageItems(readCartLines(), resolveImageUrl) as any as CartItem[];
    return mergeCartItemsByLine(raw);
  } catch {
    return [];
  }
}

function writeLocalCartCanonical(items: CartItem[]) {
  writeCartLines(cartItemsToStorageLines(items) as any);
}

function normalizeServerCartRows(items: ServerCartItem[]): ServerCartNormalizationResult {
  const groups = new Map<
    string,
    {
      canonical: CartItem;
      allIds: string[];
      duplicateIdsToDelete: string[];
    }
  >();

  for (const raw of items) {
    const normalized = normalizeCartItemLike({
      id: String(raw.id),
      sourceIds: [String(raw.id)],
      kind: raw.kind === "BASE" || raw.kind === "VARIANT" ? raw.kind : raw.variantId ? "VARIANT" : "BASE",
      productId: raw.productId,
      variantId: raw.variantId == null ? null : String(raw.variantId),
      title: raw.titleSnapshot ?? "",
      qty: Math.max(1, Number(raw.qty) || 1),
      unitPrice: Number(raw.unitPriceCache) || 0,
      totalPrice: (Number(raw.unitPriceCache) || 0) * Math.max(1, Number(raw.qty) || 1),
      selectedOptions: raw.selectedOptions,
      image: raw.imageSnapshot,
    });

    if (!normalized) continue;

    const key = lineKeyFor(normalized);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        canonical: {
          ...normalized,
          sourceIds: [String(raw.id)],
        },
        allIds: [String(raw.id)],
        duplicateIdsToDelete: [],
      });
      continue;
    }

    const existingQty = Math.max(1, Number(existing.canonical.qty) || 1);
    const nextQty = Math.max(1, Number(normalized.qty) || 1);

    existing.allIds.push(String(raw.id));
    existing.duplicateIdsToDelete.push(String(raw.id));

    existing.canonical = {
      ...existing.canonical,
      id: existing.canonical.id || normalized.id,
      sourceIds: Array.from(
        new Set([...(existing.canonical.sourceIds ?? []), String(raw.id)].filter(Boolean))
      ),
      title: String(existing.canonical.title || normalized.title || ""),
      image: existing.canonical.image || normalized.image,
      qty: Math.max(existingQty, nextQty),
      unitPrice:
        asMoney(existing.canonical.unitPrice, 0) > 0
          ? asMoney(existing.canonical.unitPrice, 0)
          : asMoney(normalized.unitPrice, 0),
      totalPrice: round2(
        (
          asMoney(existing.canonical.unitPrice, 0) > 0
            ? asMoney(existing.canonical.unitPrice, 0)
            : asMoney(normalized.unitPrice, 0)
        ) * Math.max(existingQty, nextQty)
      ),
      selectedOptions:
        (existing.canonical.selectedOptions?.length
          ? existing.canonical.selectedOptions
          : normalized.selectedOptions) ?? [],
    };
  }

  const resultItems = Array.from(groups.values()).map((g) => g.canonical);
  const duplicateIdsToDelete = Array.from(
    new Set(
      Array.from(groups.values())
        .flatMap((g) => g.duplicateIdsToDelete)
        .filter(Boolean)
    )
  );

  return {
    items: mergeCartItemsByLine(resultItems),
    duplicateIdsToDelete,
  };
}

/* ---------------- Server cart helpers ---------------- */

async function fetchServerCart(): Promise<ServerCartNormalizationResult> {
  const { data } = await api.get("/api/cart", AXIOS_COOKIE_CFG);
  const items: ServerCartItem[] = Array.isArray((data as any)?.items) ? (data as any).items : [];
  return normalizeServerCartRows(items);
}

async function deleteDuplicateServerCartRows(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.map(String).filter(Boolean)));
  if (!uniqueIds.length) return;

  await Promise.all(
    uniqueIds.map((id) => api.delete(`/api/cart/items/${id}`, AXIOS_COOKIE_CFG))
  );
}

async function serverSetQty(item: CartItem, qty: number) {
  const ids = Array.from(
    new Set(
      (item.sourceIds?.length ? item.sourceIds : item.id ? [item.id] : [])
        .map(String)
        .filter(Boolean)
    )
  );
  if (!ids.length) return;

  const next = Math.max(0, Math.floor(Number(qty) || 0));

  if (next <= 0) {
    await Promise.all(ids.map((id) => api.delete(`/api/cart/items/${id}`, AXIOS_COOKIE_CFG)));
    return;
  }

  const [keepId, ...extraIds] = ids;

  await api.patch(`/api/cart/items/${keepId}`, { qty: next }, AXIOS_COOKIE_CFG);

  if (extraIds.length) {
    await Promise.all(extraIds.map((id) => api.delete(`/api/cart/items/${id}`, AXIOS_COOKIE_CFG)));
  }
}

/* =========================================================
   Component
========================================================= */

export default function Cart() {
  const navigate = useNavigate();
  const authHydrated = useAuthStore((s) => s.hydrated);
  const storeUser = useAuthStore((s) => s.user);
  const isAuthed = !!storeUser?.id;

  const [cart, setCart] = useState<CartItem[]>([]);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [qtyNote, setQtyNote] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  // productIds confirmed to have variants (fetched lazily for BASE items)
  const [variantProductIds, setVariantProductIds] = useState<Set<string>>(new Set());
  // default option labels for the first variant of each variant product
  const [defaultVariantOptions, setDefaultVariantOptions] = useState<Map<string, string[]>>(new Map());
  // count of variants with availableQty > 0 (or unknown) per productId
  const [variantAvailableCount, setVariantAvailableCount] = useState<Map<string, number>>(new Map());

  const isMountedRef = useRef(true);
  const activeRequestIdRef = useRef(0);
  const lastMirroredServerSigRef = useRef("");
  const lastPersistedGuestSigRef = useRef("");
  const focusedQtyKeyRef = useRef<string | null>(null);
  const qtyNoteTimersRef = useRef<Record<string, number>>({});

  const safeSetCart = useCallback((next: CartItem[]) => {
    const dedupedNext = mergeCartItemsByLine(next);
    setCart((prev) => (sameCartItems(prev, dedupedNext) ? prev : dedupedNext));
  }, []);

  const clearAllNotes = useCallback(() => {
    for (const id of Object.values(qtyNoteTimersRef.current)) {
      clearTimeout(id);
    }
    qtyNoteTimersRef.current = {};
    setQtyNote({});
  }, []);

  const clearQtyNote = useCallback((key: string) => {
    if (qtyNoteTimersRef.current[key]) {
      clearTimeout(qtyNoteTimersRef.current[key]);
      delete qtyNoteTimersRef.current[key];
    }
    setQtyNote((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const showQtyNote = useCallback(
    (key: string, message: string) => {
      if (qtyNoteTimersRef.current[key]) {
        clearTimeout(qtyNoteTimersRef.current[key]);
      }

      setQtyNote((prev) => ({ ...prev, [key]: message }));

      qtyNoteTimersRef.current[key] = window.setTimeout(() => {
        clearQtyNote(key);
      }, 2200);
    },
    [clearQtyNote]
  );

  const mirrorAuthedCartToLocal = useCallback((items: CartItem[]) => {
    const deduped = mergeCartItemsByLine(items);
    const sig = cartSignature(deduped);
    if (lastMirroredServerSigRef.current === sig) return;

    lastMirroredServerSigRef.current = sig;
    writeLocalCartCanonical(deduped);
  }, []);

  const persistGuestCart = useCallback((items: CartItem[]) => {
    const deduped = mergeCartItemsByLine(items);
    const sig = cartSignature(deduped);
    if (lastPersistedGuestSigRef.current === sig) return;

    lastPersistedGuestSigRef.current = sig;
    writeLocalCartCanonical(deduped);
  }, []);

  const loadCart = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current;

    const localItems = readLocalCartCanonical();

    if (!authHydrated) return;

    if (isAuthed) {
      try {
        const serverResult = await fetchServerCart();
        if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

        if (serverResult.duplicateIdsToDelete.length) {
          try {
            await deleteDuplicateServerCartRows(serverResult.duplicateIdsToDelete);
          } catch {
            //
          }
        }

        if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

        safeSetCart(serverResult.items);
        mirrorAuthedCartToLocal(serverResult.items);
        setHydrated(true);
        return;
      } catch {
        if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

        safeSetCart(localItems);
        writeLocalCartCanonical(localItems);
        setHydrated(true);
        return;
      }
    }

    if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;
    safeSetCart(localItems);
    writeLocalCartCanonical(localItems);
    setHydrated(true);
  }, [authHydrated, isAuthed, mirrorAuthedCartToLocal, safeSetCart]);

  useEffect(() => {
    const onAuthReset = () => {
      activeRequestIdRef.current += 1;
      focusedQtyKeyRef.current = null;
      clearAllNotes();

      try {
        writeCartLines([] as any);
      } catch {
        //
      }

      safeSetCart([]);
      setQtyDraft({});
      setExpanded({});
      setHydrated(true);
    };

    window.addEventListener("auth:logout", onAuthReset as EventListener);
    window.addEventListener("auth:expired", onAuthReset as EventListener);

    return () => {
      window.removeEventListener("auth:logout", onAuthReset as EventListener);
      window.removeEventListener("auth:expired", onAuthReset as EventListener);
    };
  }, [clearAllNotes, safeSetCart]);

  useEffect(() => {
    isMountedRef.current = true;

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;

      activeRequestIdRef.current += 1;
      focusedQtyKeyRef.current = null;
      clearAllNotes();
      void loadCart();
    };

    const onPageHide = () => {
      activeRequestIdRef.current += 1;
      focusedQtyKeyRef.current = null;
      clearAllNotes();
    };

    const onCartUpdated = () => {
      void loadCart();
    };

    window.addEventListener("pageshow", onPageShow as EventListener);
    window.addEventListener("pagehide", onPageHide as EventListener);
    window.addEventListener("cart:updated", onCartUpdated);

    return () => {
      isMountedRef.current = false;
      activeRequestIdRef.current += 1;
      focusedQtyKeyRef.current = null;
      clearAllNotes();

      window.removeEventListener("pageshow", onPageShow as EventListener);
      window.removeEventListener("pagehide", onPageHide as EventListener);
      window.removeEventListener("cart:updated", onCartUpdated);
    };
  }, [clearAllNotes, loadCart]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadCart();
      } catch {
        if (!cancelled && isMountedRef.current) {
          const fallback = readLocalCartCanonical();
          safeSetCart(fallback);
          writeLocalCartCanonical(fallback);
          setHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadCart, safeSetCart]);

  useEffect(() => {
    setQtyDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      const focusedKey = focusedQtyKeyRef.current;

      for (const it of cart) {
        const key = lineKeyFor(it);
        if (focusedKey === key) continue;

        const cartQty = String(Math.max(1, Number(it.qty) || 1));
        if (next[key] !== cartQty) {
          next[key] = cartQty;
          changed = true;
        }
      }

      for (const key of Object.keys(next)) {
        if (!cart.some((it) => lineKeyFor(it) === key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [cart]);

  const setLocalQtyState = useCallback((target: CartItem, qty: number) => {
    setCart((prev) =>
      mergeCartItemsByLine(
        prev.map((it) => {
          if (!sameLine(it, target)) return it;

          const nextQty = Math.max(1, Math.floor(Number(qty) || 1));
          const unit =
            Number.isFinite(Number(it.unitPrice)) && Number(it.unitPrice) > 0
              ? Number(it.unitPrice)
              : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);

          const safeUnit = Number.isFinite(unit) && unit > 0 ? unit : 0;

          return {
            ...it,
            qty: nextQty,
            unitPrice: safeUnit,
            totalPrice: round2(safeUnit * nextQty),
          };
        })
      )
    );
  }, []);

  const commitQty = useCallback(
    async (target: CartItem, rawQty: number, sourceKey?: string) => {
      const nextQty = Math.max(1, Math.floor(Number(rawQty) || 1));

      setLocalQtyState(target, nextQty);

      if (!isAuthed) {
        setCart((prev) => {
          const nextCart = mergeCartItemsByLine(
            prev.map((it) => {
              if (!sameLine(it, target)) return it;

              const unit =
                Number.isFinite(Number(it.unitPrice)) && Number(it.unitPrice) > 0
                  ? Number(it.unitPrice)
                  : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);

              const safeUnit = Number.isFinite(unit) && unit > 0 ? unit : 0;

              return {
                ...it,
                qty: nextQty,
                unitPrice: safeUnit,
                totalPrice: round2(safeUnit * nextQty),
              };
            })
          );

          persistGuestCart(nextCart);
          return nextCart;
        });

        window.dispatchEvent(new Event("cart:updated"));

        if (sourceKey) setQtyDraft((prev) => ({ ...prev, [sourceKey]: String(nextQty) }));
        return;
      }

      const requestId = ++activeRequestIdRef.current;

      try {
        await serverSetQty(target, nextQty);
        if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

        setCart((prev) => {
          const mirrored = mergeCartItemsByLine(
            prev.map((it) => {
              if (!sameLine(it, target)) return it;

              const unit =
                Number.isFinite(Number(it.unitPrice)) && Number(it.unitPrice) > 0
                  ? Number(it.unitPrice)
                  : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);

              const safeUnit = Number.isFinite(unit) && unit > 0 ? unit : 0;

              return {
                ...it,
                qty: nextQty,
                unitPrice: safeUnit,
                totalPrice: round2(safeUnit * nextQty),
              };
            })
          );

          mirrorAuthedCartToLocal(mirrored);
          return mirrored;
        });

        window.dispatchEvent(new Event("cart:updated"));

        if (sourceKey) setQtyDraft((prev) => ({ ...prev, [sourceKey]: String(nextQty) }));
      } catch {
        if (isMountedRef.current && requestId === activeRequestIdRef.current) {
          showQtyNote(sourceKey ?? lineKeyFor(target), "Could not update quantity. Restoring cart.");
          await loadCart().catch(() => { });
        }
      }
    },
    [isAuthed, loadCart, mirrorAuthedCartToLocal, persistGuestCart, setLocalQtyState, showQtyNote]
  );

  const remove = useCallback(
    async (target: CartItem) => {
      const next = mergeCartItemsByLine(cart.filter((it) => !sameLine(it, target)));
      safeSetCart(next);

      setQtyDraft((prev) => {
        const key = lineKeyFor(target);
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });

      if (!isAuthed) {
        persistGuestCart(next);
        window.dispatchEvent(new Event("cart:updated"));
        return;
      }

      const requestId = ++activeRequestIdRef.current;

      try {
        await serverSetQty(target, 0);
        if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

        mirrorAuthedCartToLocal(next);
        window.dispatchEvent(new Event("cart:updated"));
      } catch {
        if (isMountedRef.current && requestId === activeRequestIdRef.current) {
          await loadCart().catch(() => { });
        }
      }
    },
    [cart, isAuthed, loadCart, mirrorAuthedCartToLocal, persistGuestCart, safeSetCart]
  );

  const visibleCart = useMemo(() => mergeCartItemsByLine(cart), [cart]);

  // Fetch variant info for all cart items to determine available variant count and
  // show "Choose options" for BASE items after server round-trips lose needsOptions flag.
  useEffect(() => {
    const needsCheck = [
      ...new Set(
        visibleCart
          .map((it) => it.productId)
          .filter((pid) => !variantAvailableCount.has(pid))
      ),
    ];
    if (!needsCheck.length) return;

    let cancelled = false;
    Promise.all(
      needsCheck.map((pid) =>
        api
          .get(`/api/products/${pid}`, { params: { include: "variants" } })
          .then(({ data }) => {
            const p = (data as any)?.data ?? data ?? {};
            const variants = Array.isArray(p.variants) ? p.variants : [];

            // Mirror availableNow: check variant offers first, fall back to variant-level stock.
            const availCount = variants.filter((v: any) => {
              if (Array.isArray(v.offers) && v.offers.length > 0)
                return v.offers.some(
                  (o: any) => o?.isActive !== false && (o?.inStock === true || Number(o?.availableQty) > 0)
                );
              return v.inStock === true || Number(v.availableQty) > 0;
            }).length;

            if (!variants.length) return { pid, pills: [] as string[], availCount: 0, isVariantProduct: false };

            // Capture the first variant's option labels for default display on BASE items
            const firstVariant = variants[0];
            const opts = Array.isArray(firstVariant?.options) ? firstVariant.options : [];
            const pills = opts
              .map((o: any) => {
                const attr = o?.attribute?.name || (o?.attribute && !isCodeLike(String(o.attribute)) ? String(o.attribute) : "") || "";
                const val = o?.value?.name || (o?.value?.code && !isCodeLike(String(o.value.code)) ? String(o.value.code) : "") || (o?.value && !isCodeLike(String(o.value)) ? String(o.value) : "") || "";
                if (!attr && !val) return null;
                return attr && val ? `${attr}: ${val}` : attr || val;
              })
              .filter(Boolean) as string[];

            return { pid, pills, availCount, isVariantProduct: true };
          })
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const found = results.filter(
        (r): r is { pid: string; pills: string[]; availCount: number; isVariantProduct: boolean } => r !== null
      );
      if (found.length) {
        setVariantProductIds((prev) => {
          const next = new Set(prev);
          // Always track variant products regardless of current stock — so BASE items from
          // variant products keep their variant identity even when all combos are sold out.
          found.forEach(({ pid, isVariantProduct }) => { if (isVariantProduct) next.add(pid); });
          return next;
        });
        setDefaultVariantOptions((prev) => {
          const next = new Map(prev);
          found.forEach(({ pid, pills }) => {
            if (pills.length) next.set(pid, pills);
          });
          return next;
        });
        setVariantAvailableCount((prev) => {
          const next = new Map(prev);
          found.forEach(({ pid, availCount }) => next.set(pid, availCount));
          return next;
        });
      }
    });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCart]);

  const total = useMemo(() => {
    return visibleCart.reduce((sum, it) => {
      const qty = Math.max(1, Number(it.qty) || 1);
      const cachedUnit =
        asMoney(it.unitPrice, 0) > 0
          ? asMoney(it.unitPrice, 0)
          : qty > 0
            ? asMoney(it.totalPrice, 0) / qty
            : 0;
      return sum + round2(Math.max(0, cachedUnit) * qty);
    }, 0);
  }, [visibleCart]);

  const tap = "touch-manipulation [-webkit-tap-highlight-color:transparent]";

  if (!hydrated) {
    return (
      <SiteLayout>
        <div className="min-h-[60vh] grid place-items-center px-4 text-ink-soft">Loading cart…</div>
      </SiteLayout>
    );
  }

  if (visibleCart.length === 0) {
    return (
      <SiteLayout>
        <div className="min-h-[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden grid place-items-center px-4">
          <div className="pointer-events-none -z-10 absolute -top-24 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
          <div className="pointer-events-none -z-10 absolute -bottom-28 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

          <div className="max-w-md w-full text-center relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Your cart is empty
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">Let’s find something you’ll love</h1>
            <p className="mt-1 text-ink-soft">Browse our catalogue and add items to your cart. They’ll show up here for checkout.</p>
            <Link
              to="/"
              className={`${tap} mt-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-5 py-3 font-semibold shadow-sm hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary-200 transition`}
            >
              Go shopping
            </Link>
          </div>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden isolate">
        <div className="pointer-events-none -z-10 absolute -top-28 -left-24 size-96 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none -z-10 absolute -bottom-32 -right-28 size-[28rem] rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

        <div className="relative z-10 max-w-[980px] lg:max-w-[980px] xl:max-w-[980px] mx-auto px-3 sm:px-4 md:px-6 py-5 sm:py-8 max-[360px]:px-2 max-[360px]:py-4">
          <div className="mb-4 sm:mb-6 text-center md:text-left">
            <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Review &amp; edit
            </span>

            <h1 className="mt-3 text-[26px] sm:text-3xl font-extrabold tracking-tight text-ink max-[360px]:text-[22px]">
              Your cart
            </h1>

            <p className="text-sm max-[360px]:text-[12px] text-ink-soft">
              Prices shown are based on the saved cart snapshot. Final checks happen at checkout.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4 sm:gap-6">
            <section className="space-y-3 sm:space-y-4">
              {visibleCart.map((it) => {
                const key = lineKeyFor(it);
                const currentQty = Math.max(1, Number(it.qty) || 1);

                const cachedUnit =
                  asMoney(it.unitPrice, 0) > 0
                    ? asMoney(it.unitPrice, 0)
                    : currentQty > 0
                      ? asMoney(it.totalPrice, 0) / currentQty
                      : 0;

                const displayUnit = Math.max(0, cachedUnit);
                const displayLineTotal = round2(displayUnit * currentQty);
                const kindLabel = it.variantId
                  ? "Variant"
                  : it.selectedOptions?.length
                    ? "Configured"
                    : isBaseLine(it)
                      ? "Base"
                      : "Item";
                const draft = qtyDraft[key];
                const inputValue = draft ?? String(currentQty);
                const displayOptions = normalizeSelectedOptions(it.selectedOptions);
                const isExpanded = !!expanded[key];
                const INLINE_LIMIT = 3;

                const isVariantItem = !!it.variantId || it.kind === "VARIANT";
                // true for configured variants AND for base items from variant products
                const isVariantProduct =
                  isVariantItem ||
                  it.needsOptions === true ||
                  variantProductIds.has(it.productId);

                const optionPills = displayOptions
                  .map((o) => {
                    const attr = o.attribute && !isCodeLike(o.attribute)
                      ? o.attribute
                      : o.attributeId && !isCodeLike(o.attributeId)
                        ? o.attributeId
                        : o.attribute || o.attributeId || null;

                    const val = o.value && !isCodeLike(o.value)
                      ? o.value
                      : o.valueId && !isCodeLike(o.valueId)
                        ? o.valueId
                        : o.value || o.valueId || null;

                    if (!attr && !val) return null;
                    return attr && val ? `${attr}: ${val}` : attr || val;
                  })
                  .filter((s): s is string => !!s);
                const commitDraft = () => {
                  const raw = qtyDraft[key];
                  const parsed = raw === "" || raw == null ? 1 : Math.floor(Number(raw));
                  const desired = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
                  void commitQty(it, desired, key);
                };

                const inc = () => {
                  const raw = qtyDraft[key];
                  const base =
                    raw == null || raw === ""
                      ? currentQty
                      : Math.max(1, Math.floor(Number(raw) || currentQty));
                  const desired = base + 1;
                  setQtyDraft((prev) => ({ ...prev, [key]: String(desired) }));
                  void commitQty(it, desired, key);
                };

                const dec = () => {
                  const raw = qtyDraft[key];
                  const base =
                    raw == null || raw === ""
                      ? currentQty
                      : Math.max(1, Math.floor(Number(raw) || currentQty));
                  const desired = Math.max(1, base - 1);
                  setQtyDraft((prev) => ({ ...prev, [key]: String(desired) }));
                  void commitQty(it, desired, key);
                };

                const unitText = displayUnit > 0 ? ngn.format(displayUnit) : "—";

                return (
                  <article
                    key={key}
                    className="group rounded-2xl border border-white/60 bg-white/75 backdrop-blur shadow-[0_6px_30px_rgba(0,0,0,0.06)] p-3 sm:p-5 max-[360px]:p-3 overflow-hidden relative z-10"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                      <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 max-[360px]:w-14 max-[360px]:h-14 rounded-xl border overflow-hidden bg-white self-start relative">
                        {resolveImageUrl(it.image) ? (
                          <img
                            src={resolveImageUrl(it.image)}
                            alt={it.title || "Cart item"}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const box = e.currentTarget.parentElement;
                              if (box) {
                                box.innerHTML = `<div class="w-full h-full grid place-items-center text-[11px] text-slate-500">No image</div>`;
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-[11px] text-ink-soft">
                            No image
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-semibold text-ink text-[14px] sm:text-base leading-snug truncate" title={it.title}>
                              {it.title || "Item"}
                            </h3>

                            <button
                              type="button"
                              className={`${tap} shrink-0 whitespace-nowrap text-[12px] sm:text-sm text-rose-600 hover:underline rounded-lg px-2 py-1 hover:bg-rose-500/10 transition`}
                              onClick={() => void remove(it)}
                              aria-label={`Remove ${it.title}`}
                              title="Remove item"
                            >
                              Remove
                            </button>
                          </div>

                          {(() => {
                            // For variant products with no user-chosen options, show the default (first) variant's pills
                            const defaultPills = isVariantProduct && optionPills.length === 0
                              ? (defaultVariantOptions.get(it.productId) ?? [])
                              : [];
                            const activePills = optionPills.length > 0 ? optionPills : defaultPills;
                            const isDefaultBase = isVariantProduct && optionPills.length === 0;

                            return (
                              <>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {/* Badge */}
                                  {!isVariantProduct ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-200 bg-white text-ink-soft font-medium">
                                      {kindLabel}
                                    </span>
                                  ) : isDefaultBase ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-200 bg-white text-ink-soft font-medium">
                                      Base
                                    </span>
                                  ) : (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 font-medium">
                                      {kindLabel === "Base" ? "Variant" : kindLabel}
                                    </span>
                                  )}

                                  {/* Inline option pills */}
                                  {activePills.slice(0, INLINE_LIMIT).map((label, i) => (
                                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                                      {label}
                                    </span>
                                  ))}

                                  {/* "+N more" toggle */}
                                  {activePills.length > INLINE_LIMIT && (
                                    <button
                                      type="button"
                                      className={`${tap} text-[10px] px-2 py-0.5 rounded-full border border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-100 transition`}
                                      onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                                    >
                                      {isExpanded ? "less" : `+${activePills.length - INLINE_LIMIT} more`}
                                    </button>
                                  )}
                                </div>

                                {/* Overflow options (> INLINE_LIMIT) */}
                                {isExpanded && activePills.length > INLINE_LIMIT && (
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {activePills.slice(INLINE_LIMIT).map((label, i) => (
                                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Choose / change options — only when 2+ variants have stock */}
                                {isVariantProduct && (variantAvailableCount.get(it.productId) ?? 2) > 1 && (
                                  <div className="mt-2">
                                    <button
                                      type="button"
                                      className={`${tap} text-[11px] hover:underline underline-offset-2 text-fuchsia-700 hover:text-fuchsia-900`}
                                      onClick={() =>
                                        navigate(`/products/${it.productId}`, {
                                          state: {
                                            editCartLine: {
                                              variantId: it.variantId ?? null,
                                              kind: it.kind ?? "BASE",
                                              selectedOptions: it.selectedOptions ?? [],
                                              needsOptions: !isVariantItem,
                                              qty: currentQty,
                                              id: it.id,
                                              sourceIds: it.sourceIds ?? [],
                                            },
                                          },
                                        })
                                      }
                                    >
                                      Choose a different option →
                                    </button>
                                  </div>
                                )}
                              </>
                            );
                          })()}

                          <div className="mt-2 grid grid-cols-1 gap-1 text-[12px] max-[360px]:text-[11px] sm:text-xs text-ink-soft">
                            <div>
                              Unit: <span className="font-medium text-ink">{unitText}</span>
                            </div>
                          </div>

                        </div>

                        {qtyNote[key] ? <div className="mt-2 text-[12px] font-semibold text-rose-700">{qtyNote[key]}</div> : null}

                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex items-center justify-between sm:justify-start gap-3">
                            <div className="flex items-center rounded-xl border border-border bg-white overflow-hidden shadow-sm">
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                className={`${tap} px-3 py-2 max-[360px]:px-2 max-[360px]:py-1.5 hover:bg-black/5 transition`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={dec}
                              >
                                −
                              </button>

                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={inputValue}
                                onFocus={() => {
                                  focusedQtyKeyRef.current = key;
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;

                                  if (v === "") {
                                    setQtyDraft((prev) => ({ ...prev, [key]: "" }));
                                    return;
                                  }

                                  if (!/^\d+$/.test(v)) return;
                                  setQtyDraft((prev) => ({ ...prev, [key]: v }));
                                }}
                                onBlur={() => {
                                  focusedQtyKeyRef.current = null;
                                  commitDraft();
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    (e.currentTarget as HTMLInputElement).blur();
                                  }
                                  if (e.key === "Escape") {
                                    setQtyDraft((prev) => ({ ...prev, [key]: String(currentQty) }));
                                    (e.currentTarget as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-[64px] text-center outline-none px-2 py-2 max-[360px]:py-1.5 bg-white tabular-nums font-medium leading-[1] text-[14px]"
                                aria-label="Quantity"
                              />

                              <button
                                type="button"
                                aria-label="Increase quantity"
                                className={`${tap} px-3 py-2 max-[360px]:px-2 max-[360px]:py-1.5 hover:bg-black/5 transition`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={inc}
                              >
                                +
                              </button>
                            </div>

                            <div className="text-xs max-[360px]:text-[11px] text-ink-soft leading-tight">
                              <div>Qty</div>
                            </div>
                          </div>

                          <div className="sm:ml-auto rounded-xl border bg-white/70 px-3 py-2 text-right min-w-[140px] max-[360px]:min-w-[0]">
                            <div className="text-[11px] text-ink-soft">Line total</div>
                            <div className="text-[18px] sm:text-lg font-semibold tracking-tight break-words">
                              {ngn.format(displayLineTotal)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>

            <aside className="lg:sticky lg:top-6 cart-summary-stable">
              <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-4 sm:p-5 max-[360px]:p-3 shadow-[0_6px_30px_rgba(0,0,0,0.06)] overflow-hidden">
                <h2 className="text-lg max-[360px]:text-base font-semibold text-ink">Order summary</h2>

                <div className="mt-4 grid gap-3 text-[13px] max-[360px]:text-[12px] sm:text-sm">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                    <span className="text-ink-soft leading-tight">Items</span>
                    <span className="font-semibold text-ink whitespace-nowrap text-right">{visibleCart.length}</span>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                    <span className="text-ink-soft leading-tight">Subtotal</span>
                    <span className="font-semibold text-ink whitespace-nowrap text-right">{ngn.format(total)}</span>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                    <span className="text-ink-soft leading-tight">Shipping</span>
                    <span className="font-semibold text-ink text-right leading-tight">
                      Calculated
                      <br />
                      at checkout
                    </span>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-white/50">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-semibold text-ink">Total</span>
                    <span className="text-[26px] sm:text-2xl max-[360px]:text-[22px] font-extrabold tracking-tight text-ink break-words">
                      {ngn.format(total)}
                    </span>
                  </div>

                  <Link
                    to="/checkout"
                    onClick={() => {
                      try {
                        sessionStorage.removeItem("payment:init");
                        sessionStorage.removeItem("paystack:return");
                        sessionStorage.removeItem("paystack:return:v1");
                        sessionStorage.removeItem("paystack:exit");
                        sessionStorage.removeItem("paystack:exit:v1");
                      } catch {
                        //
                      }
                    }}
                    className={`${tap} mt-4 w-full inline-flex items-center justify-center rounded-xl px-4 py-3 max-[360px]:py-2.5 font-semibold shadow-sm transition bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary-200`}
                  >
                    <span className="sm:hidden">Checkout</span>
                    <span className="hidden sm:inline">Proceed to checkout</span>
                  </Link>
                  <Link
                    to="/"
                    className={`${tap} mt-3 w-full inline-flex items-center justify-center rounded-xl border border-border bg-white px-4 py-3 max-[360px]:py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition`}
                  >
                    Continue shopping
                  </Link>

                  <p className="mt-3 text-[11px] text-ink-soft">Final stock and pricing checks happen at checkout.</p>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-ink-soft text-center">
                Taxes &amp; shipping are shown at checkout. You can update addresses there.
              </p>
            </aside>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}