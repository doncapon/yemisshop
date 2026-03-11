// src/components/cart/MiniCartToast.tsx
import * as React from "react";
import { createPortal } from "react-dom";
import { useLocation  } from "react-router-dom";
import { ShoppingCart, X } from "lucide-react";
import api from "../../api/client";
import { readCartLines, upsertCartLine, toMiniCartRows } from "../../utils/cartModel";

type ToastMode = "add" | "remove";

type ToastOpts = {
  title?: string;
  duration?: number;
  maxItems?: number;
  mode?: ToastMode;
};

type MiniCartOption = { attribute?: string; value?: string };

export type MiniCartRow = {
  id?: string;
  productId: string;
  variantId?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  kind?: "BASE" | "VARIANT";
  optionsKey?: string | null;
  title?: string;
  qty: number;
  unitPrice?: number;
  totalPrice?: number;
  price?: number;
  image?: string | null;
  selectedOptions?: MiniCartOption[];
};

type ToastFocus = { productId: string; variantId?: string | null };

type ToastPayload = {
  cart?: MiniCartRow[];
  items?: MiniCartRow[];
  rows?: MiniCartRow[];
  focus?: ToastFocus | null;
  opts?: ToastOpts;
  preserveOrder?: boolean;
};

const EVENT = "mini-cart-toast:v1";

/* ---------------- showMiniCartToast ---------------- */

export function showMiniCartToast(payload: ToastPayload): void;
export function showMiniCartToast(
  cart: MiniCartRow[],
  focus?: ToastFocus | null,
  opts?: ToastOpts
): void;
export function showMiniCartToast(
  arg1: MiniCartRow[] | ToastPayload,
  arg2?: ToastFocus | null,
  arg3?: ToastOpts
): void {
  try {
    const detail: ToastPayload = Array.isArray(arg1)
      ? { cart: arg1, focus: arg2 ?? undefined, opts: arg3 }
      : arg1;

    window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  } catch {
    // noop
  }
}

/* ---------------- helpers ---------------- */

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
});

function money(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function str(v: unknown) {
  return String(v ?? "").trim();
}

function normKind(row: MiniCartRow): "BASE" | "VARIANT" {
  const k = str(row.kind).toUpperCase();
  if (k === "BASE" || k === "VARIANT") return k;
  return row.variantId ? "VARIANT" : "BASE";
}

function normVariantId(row: MiniCartRow) {
  const vid = str(row.variantId);
  return vid ? vid : null;
}

function normOptionsKey(row: MiniCartRow) {
  const ok = str(row.optionsKey);
  return ok || "";
}

function cartKey(row: MiniCartRow) {
  const kind = normKind(row);
  const vid = kind === "BASE" ? null : normVariantId(row);
  const ok = kind === "BASE" ? "" : normOptionsKey(row);
  return [str(row.productId), kind, String(vid ?? "base"), ok].join("|");
}

const availKeyFor = (productId: string, variantId?: string | null) =>
  `${String(productId)}::${variantId ?? "null"}`;

/* ---------------- normalize payload ---------------- */

function normalizePayload(d: ToastPayload | null | undefined) {
  const base: MiniCartRow[] = Array.isArray(d?.cart) ? d.cart : [];
  const extras: MiniCartRow[] = [];

  if (Array.isArray(d?.items)) extras.push(...d.items);
  if (Array.isArray(d?.rows)) extras.push(...d.rows);

  const cart: MiniCartRow[] = [...base, ...extras];
  const last = cart.length ? cart[cart.length - 1] : null;

  const focus: ToastFocus | null = d?.focus?.productId
    ? {
      productId: String(d.focus.productId),
      variantId: d.focus.variantId ?? null,
    }
    : last
      ? {
        productId: String(last.productId),
        variantId: last.variantId ?? null,
      }
      : null;

  return { cart, focus, opts: d?.opts, preserveOrder: !!d?.preserveOrder };
}

function isSameFocus(row: MiniCartRow, focus?: ToastFocus | null) {
  if (!focus?.productId) return false;

  const rowKind = normKind(row);
  const rowVariantId = rowKind === "BASE" ? null : normVariantId(row);
  const focusVariantId = focus.variantId ?? null;

  return (
    str(row.productId) === str(focus.productId) &&
    String(rowVariantId ?? null) === String(focusVariantId ?? null)
  );
}

function groupCart(
  cart: MiniCartRow[],
  focus?: ToastFocus | null,
  preserveOrder = false
): MiniCartRow[] {
  const map = new Map<string, MiniCartRow & { _lastIndex: number }>();

  cart.forEach((row, index) => {
    const key = cartKey(row);
    const existing = map.get(key);

    if (existing) {
      existing.qty += row.qty;
      existing._lastIndex = index;
      existing.title = existing.title || row.title;
      existing.image = existing.image || row.image;
      existing.unitPrice = existing.unitPrice ?? row.unitPrice;
      existing.price = existing.price ?? row.price;
      existing.kind = existing.kind || row.kind;
      existing.optionsKey = existing.optionsKey || row.optionsKey;
      existing.variantId = existing.variantId ?? row.variantId ?? null;
      existing.selectedOptions = existing.selectedOptions?.length
        ? existing.selectedOptions
        : row.selectedOptions;
    } else {
      map.set(key, { ...row, _lastIndex: index });
    }
  });

  return Array.from(map.values())
    .sort((a, b) => {
      if (!preserveOrder) {
        const aFocused = isSameFocus(a, focus) ? 1 : 0;
        const bFocused = isSameFocus(b, focus) ? 1 : 0;
        if (aFocused !== bFocused) return bFocused - aFocused;
      }
      return b._lastIndex - a._lastIndex;
    })
    .map(({ _lastIndex, ...rest }) => rest);
}

/* ---------------- Availability (toast) ---------------- */

type Availability = { totalAvailable: number; cheapestSupplierUnit?: number | null };

type ProductPools = {
  hasVariantSpecific: boolean;
  genericTotal: number;
  productTotal: number;
  perVariantTotals: Record<string, number>;
};

type AvailabilityPayload = {
  lines: Record<string, Availability>;
  products: Record<string, ProductPools>;
};

async function fetchAvailabilityForRows(
  rows: MiniCartRow[]
): Promise<AvailabilityPayload> {
  if (!rows.length) return { lines: {}, products: {} };

  const uniqPairs: { productId: string; variantId: string | null }[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const pid = str(r.productId);
    if (!pid) continue;

    const kind = normKind(r);
    const vid = kind === "VARIANT" ? normVariantId(r) : null;
    const k = availKeyFor(pid, vid);

    if (seen.has(k)) continue;
    seen.add(k);

    uniqPairs.push({ productId: pid, variantId: vid });
  }

  const itemsParam = uniqPairs
    .map((p) => `${p.productId}:${p.variantId ?? ""}`)
    .join(",");

  const attempts = [
    `/api/catalog/availability?items=${encodeURIComponent(itemsParam)}&includeBase=1`,
    `/api/products/availability?items=${encodeURIComponent(itemsParam)}&includeBase=1`,
    `/api/supplier-offers/availability?items=${encodeURIComponent(itemsParam)}&includeBase=1`,
  ];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url);

      const arr = Array.isArray((data as any)?.data)
        ? (data as any).data
        : Array.isArray(data)
          ? data
          : [];

      const lines: Record<string, Availability> = {};
      const byProduct: Record<
        string,
        { generic: number; perVariant: Record<string, number> }
      > = {};

      for (const r of arr as any[]) {
        const pid = str(r?.productId);
        if (!pid) continue;

        const vid = r?.variantId == null ? null : str(r.variantId);
        const avail = Math.max(0, Number(r?.totalAvailable) || 0);

        lines[availKeyFor(pid, vid)] = {
          totalAvailable: avail,
          cheapestSupplierUnit: Number.isFinite(Number(r?.cheapestSupplierUnit))
            ? Number(r.cheapestSupplierUnit)
            : null,
        };

        if (!byProduct[pid]) {
          byProduct[pid] = { generic: 0, perVariant: {} };
        }

        if (vid == null) {
          byProduct[pid].generic += avail;
        } else {
          byProduct[pid].perVariant[vid] =
            (byProduct[pid].perVariant[vid] || 0) + avail;
        }
      }

      const products: Record<string, ProductPools> = {};
      for (const [pid, agg] of Object.entries(byProduct)) {
        const hasVariantSpecific = Object.keys(agg.perVariant).length > 0;
        const variantSum = Object.values(agg.perVariant).reduce((s, n) => s + n, 0);
        const productTotal = agg.generic + variantSum;

        products[pid] = {
          hasVariantSpecific,
          genericTotal: agg.generic,
          productTotal,
          perVariantTotals: agg.perVariant,
        };
      }

      return { lines, products };
    } catch {
      // try next endpoint
    }
  }

  return { lines: {}, products: {} };
}

/* ---------------- pool-aware caps ---------------- */

function poolKeyForRow(
  row: MiniCartRow,
  pools?: AvailabilityPayload["products"]
) {
  const pid = str(row.productId);
  const kind = normKind(row);
  const vid = kind === "VARIANT" ? normVariantId(row) : null;

  const pool = pools?.[pid];

  if (
    vid &&
    pool?.perVariantTotals &&
    Object.prototype.hasOwnProperty.call(pool.perVariantTotals, vid)
  ) {
    return `p:${pid}:v:${vid}`;
  }

  if (!vid) {
    if (pool?.hasVariantSpecific) return `p:${pid}:generic`;
    return `p:${pid}:product`;
  }

  return `p:${pid}:generic`;
}

function poolTotalForRow(row: MiniCartRow, avail?: AvailabilityPayload | null) {
  const pid = str(row.productId);
  const kind = normKind(row);
  const vid = kind === "VARIANT" ? normVariantId(row) : null;

  const pool = avail?.products?.[pid];
  if (!pool) return undefined;

  if (vid && Object.prototype.hasOwnProperty.call(pool.perVariantTotals || {}, vid)) {
    return Math.max(0, Math.floor(Number(pool.perVariantTotals[vid]) || 0));
  }

  if (!vid) {
    if (pool.hasVariantSpecific) {
      return Math.max(0, Math.floor(Number(pool.genericTotal) || 0));
    }
    return Math.max(0, Math.floor(Number(pool.productTotal) || 0));
  }

  return Math.max(0, Math.floor(Number(pool.genericTotal) || 0));
}

function reconcileRowsToPools(rows: MiniCartRow[], avail?: AvailabilityPayload | null) {
  if (!avail) return { rows, changed: false, changedKeys: [] as string[] };

  const remaining = new Map<string, number>();
  const out: MiniCartRow[] = [];
  let changed = false;
  const changedKeys: string[] = [];

  for (const r of rows) {
    const pk = poolKeyForRow(r, avail.products);
    const total = poolTotalForRow(r, avail);

    if (total == null || !Number.isFinite(total)) {
      out.push(r);
      continue;
    }

    if (!remaining.has(pk)) {
      remaining.set(pk, Math.max(0, Math.floor(total)));
    }

    const rem = remaining.get(pk)!;
    const want = Math.max(0, Math.floor(Number(r.qty) || 0));
    const next = Math.min(want, rem);

    if (next !== want) {
      changed = true;
      changedKeys.push(cartKey(r));
    }

    remaining.set(pk, Math.max(0, rem - next));
    out.push({ ...r, qty: next });
  }

  return { rows: out, changed, changedKeys };
}

/* ---------------- Qty editor ---------------- */

function MiniCartQtyEditor({
  row,
  maxQty,
  onChange,
  onCorrected,
}: {
  row: MiniCartRow;
  maxQty?: number;
  onChange: (nextQty: number) => void;
  onCorrected?: (msg: string) => void;
}) {
  const [value, setValue] = React.useState(row.qty);
  const debounceRef = React.useRef<number | null>(null);

  const clamp = React.useCallback(
    (n: number) => {
      const v = Math.max(0, Math.floor(Number(n) || 0));
      if (maxQty == null || !Number.isFinite(maxQty)) return v;
      return Math.min(v, Math.max(0, Math.floor(maxQty)));
    },
    [maxQty]
  );

  const update = React.useCallback(
    (next: number) => {
      const raw = Math.max(0, Math.floor(Number(next) || 0));
      const v = clamp(next);

      if (maxQty != null && Number.isFinite(maxQty) && raw > Math.floor(maxQty)) {
        onCorrected?.(
          `Qty corrected to max available (${Math.max(0, Math.floor(maxQty))}).`
        );
      }

      setValue(v);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        onChange(v);
      }, 200);
    },
    [clamp, maxQty, onChange, onCorrected]
  );

  React.useEffect(() => {
    setValue(row.qty);
  }, [row.qty]);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const canInc = maxQty == null ? true : value < Math.max(0, Math.floor(maxQty));
  const canDec = value > 0;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={!canDec}
        onClick={() => update(value - 1)}
        className={`w-7 h-7 rounded-full border bg-white hover:bg-zinc-50 ${!canDec ? "opacity-50 cursor-not-allowed" : ""
          }`}
      >
        −
      </button>

      <input
        type="number"
        value={value}
        min={0}
        max={maxQty}
        onChange={(e) => update(Number(e.target.value))}
        className="w-12 h-7 text-center text-xs border rounded-lg"
      />

      <button
        type="button"
        disabled={!canInc}
        onClick={() => update(value + 1)}
        className={`w-7 h-7 rounded-full border bg-white hover:bg-zinc-50 ${!canInc ? "opacity-50 cursor-not-allowed" : ""
          }`}
      >
        +
      </button>
    </div>
  );
}

/* ---------------- Toast host ---------------- */

export default function MiniCartToastHost() {
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<{
    cart: MiniCartRow[];
    focus: ToastFocus | null;
    opts?: ToastOpts;
    preserveOrder?: boolean;
  } | null>(null);

  const [avail, setAvail] = React.useState<AvailabilityPayload | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const timerRef = React.useRef<number | null>(null);
  const noticeTimerRef = React.useRef<number | null>(null);
  const didReconcileRef = React.useRef<string>("");

  const location = useLocation();

  const stopTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = React.useCallback(
    (duration = 5000) => {
      stopTimer();
      timerRef.current = window.setTimeout(() => setOpen(false), duration);
    },
    [stopTimer]
  );

  const showNotice = React.useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2200);
  }, []);

  const closeToast = React.useCallback(
    (immediate = false) => {
      stopTimer();

      if (immediate) {
        setOpen(false);
        setPayload(null);
        setNotice(null);
        setAvail(null);
        didReconcileRef.current = "";
        return;
      }

      setOpen(false);

      window.setTimeout(() => {
        setPayload(null);
        setNotice(null);
        setAvail(null);
        didReconcileRef.current = "";
      }, 220);
    },
    [stopTimer]
  );

  const goToCart = React.useCallback((e?: React.MouseEvent) => {
  e?.preventDefault();
  e?.stopPropagation();
  stopTimer();
  setOpen(false);

  window.setTimeout(() => {
    window.location.assign("/cart");
  }, 0);
}, [stopTimer]);

const goToCatalog = React.useCallback((e?: React.MouseEvent) => {
  e?.preventDefault();
  e?.stopPropagation();
  stopTimer();
  setOpen(false);

  window.setTimeout(() => {
    window.location.assign("/");
  }, 0);
}, [stopTimer]);

  React.useEffect(() => {
    setOpen(false);
    setPayload(null);
    setNotice(null);
    setAvail(null);
    didReconcileRef.current = "";
    stopTimer();
  }, [location.pathname, stopTimer]);

  React.useEffect(() => {
    const onToast = (e: Event) => {
      const custom = e as CustomEvent<ToastPayload>;
      const { cart, focus, opts, preserveOrder } = normalizePayload(custom.detail);
      if (!cart.length) return;

      setPayload({ cart, focus, opts, preserveOrder });
      setOpen(true);
      startTimer(opts?.duration ?? 5000);
    };

    window.addEventListener(EVENT, onToast as EventListener);
    return () => {
      window.removeEventListener(EVENT, onToast as EventListener);
    };
  }, [startTimer]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const cartForCalc = payload?.cart ?? [];

  const groupedCart = React.useMemo(() => {
    return groupCart(
      cartForCalc,
      payload?.focus ?? null,
      !!payload?.preserveOrder
    );
  }, [
    cartForCalc,
    payload?.focus?.productId,
    payload?.focus?.variantId,
    payload?.preserveOrder,
  ]);

  const availabilitySignature = React.useMemo(() => {
    return groupedCart.map(cartKey).join(",");
  }, [groupedCart]);

  React.useEffect(() => {
    if (!open || !payload || groupedCart.length === 0) {
      setAvail(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const a = await fetchAvailabilityForRows(groupedCart);
        if (!cancelled) setAvail(a);
      } catch {
        if (!cancelled) setAvail({ lines: {}, products: {} });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, payload, availabilitySignature, groupedCart]);

  React.useEffect(() => {
    if (!open || !payload || !avail) return;

    const sig = `${groupedCart
      .map((r) => `${cartKey(r)}=${r.qty}`)
      .join(",")}|${Object.keys(avail.products || {}).length}`;

    if (didReconcileRef.current === sig) return;

    const { rows: reconciled, changed } = reconcileRowsToPools(groupedCart, avail);

    if (!changed) {
      didReconcileRef.current = sig;
      return;
    }

    for (const r of reconciled) {
      const unit = money(r.unitPrice ?? r.price);

      upsertCartLine({
        productId: String(r.productId),
        variantId: normKind(r) === "BASE" ? null : normVariantId(r),
        kind: normKind(r),
        optionsKey: normKind(r) === "BASE" ? "" : normOptionsKey(r),
        qty: Math.max(0, Math.floor(Number(r.qty) || 0)),
        titleSnapshot: r.title ?? null,
        imageSnapshot: r.image ?? null,
        unitPriceCache: unit,
        selectedOptions: Array.isArray(r.selectedOptions)
          ? r.selectedOptions.map((o) => ({
            attribute: o.attribute,
            value: o.value,
          }))
          : [],
      } as any);
    }

    const rows = toMiniCartRows(readCartLines());
    setPayload((p) => (p ? { ...p, cart: rows } : p));
    window.dispatchEvent(new Event("cart:updated"));
    showNotice("Some quantities exceeded stock and were corrected.");

    didReconcileRef.current = sig;
  }, [open, payload, avail, groupedCart, showNotice]);

  const items = React.useMemo(() => {
    const max = payload?.opts?.maxItems ?? 999;
    return groupedCart.slice(0, max);
  }, [groupedCart, payload?.opts?.maxItems]);

  const maxMap = React.useMemo(() => {
    if (!avail) return new Map<string, number | undefined>();

    const remaining = new Map<string, number>();
    const out = new Map<string, number | undefined>();

    for (const r of items) {
      const pk = poolKeyForRow(r, avail.products);
      const total = poolTotalForRow(r, avail);

      if (total == null || !Number.isFinite(Number(total))) {
        out.set(cartKey(r), undefined);
        continue;
      }

      if (!remaining.has(pk)) {
        remaining.set(pk, Math.max(0, Math.floor(Number(total))));
      }

      const rem = remaining.get(pk)!;
      out.set(cartKey(r), Math.max(0, rem));

      const used = Math.max(0, Math.floor(Number(r.qty) || 0));
      remaining.set(pk, Math.max(0, rem - used));
    }

    return out;
  }, [avail, items]);

  if (!payload) return null;

  return createPortal(
    <div className="fixed right-4 top-4 z-[99999] pointer-events-none">
      <div
        onMouseEnter={stopTimer}
        onMouseLeave={() => {
          stopTimer();
          timerRef.current = window.setTimeout(() => {
            closeToast();
          }, 300);
        }}
        className={`w-[92vw] max-w-[420px] rounded-2xl border bg-white shadow-2xl overflow-hidden transition-all ${open
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-3 pointer-events-none"
          }`}
      >
        <div className="p-4 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white">
          <div className="flex justify-between items-center">
            <div className="flex gap-2 items-center">
              <ShoppingCart size={18} />
              <span>{payload.opts?.title ?? "Added to cart"}</span>
            </div>
            <button type="button" onClick={() => closeToast()}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-4">
          <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-3">
            {notice ? (
              <div className="mt-2 text-[12px] font-semibold text-white bg-rose-600/80 rounded-lg px-2 py-1">
                {notice}
              </div>
            ) : null}

            {items.map((it) => {
              const unit = money(it.unitPrice ?? it.price);
              const line = unit * it.qty;
              const stableKey = cartKey(it);
              const maxQty = maxMap.get(stableKey);

              return (
                <div key={stableKey} className="flex gap-3 border rounded-xl p-3">
                  <img
                    src={it.image || "/placeholder.svg"}
                    className="w-14 h-14 rounded-xl object-cover border"
                    alt={it.title || "Cart item"}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{it.title}</div>

                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <MiniCartQtyEditor
                          row={it}
                          maxQty={maxQty}
                          onCorrected={(msg) => showNotice(msg)}
                          onChange={(nextQty) => {
                            try {
                              const safeMax =
                                maxQty == null || !Number.isFinite(Number(maxQty))
                                  ? undefined
                                  : Math.max(0, Math.floor(Number(maxQty)));

                              const finalQty =
                                safeMax == null
                                  ? nextQty
                                  : Math.min(Math.max(0, nextQty), safeMax);

                              if (safeMax != null && nextQty > safeMax) {
                                showNotice(`Qty corrected to max available (${safeMax}).`);
                              }

                              upsertCartLine({
                                productId: String(it.productId),
                                variantId:
                                  normKind(it) === "BASE" ? null : normVariantId(it),
                                kind: normKind(it),
                                optionsKey:
                                  normKind(it) === "BASE" ? "" : normOptionsKey(it),
                                qty: finalQty,
                                titleSnapshot: it.title ?? null,
                                imageSnapshot: it.image ?? null,
                                unitPriceCache: unit,
                                selectedOptions: Array.isArray(it.selectedOptions)
                                  ? it.selectedOptions.map((o) => ({
                                    attribute: o.attribute,
                                    value: o.value,
                                  }))
                                  : [],
                              } as any);

                              const rows = toMiniCartRows(readCartLines());

                              showMiniCartToast({
                                cart: rows,
                                focus: {
                                  productId: it.productId,
                                  variantId: it.variantId ?? null,
                                },
                                opts: payload.opts,
                                preserveOrder: true,
                              });

                              window.dispatchEvent(new Event("cart:updated"));
                            } catch {
                              // noop
                            }
                          }}
                        />

                        {typeof maxQty === "number" && Number.isFinite(maxQty) ? (
                          <div className="text-[10px] text-zinc-500">
                            Max:{" "}
                            <span className="font-semibold text-zinc-700">
                              {Math.max(0, Math.floor(maxQty))}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <div className="text-sm font-semibold whitespace-nowrap">
                        {NGN.format(line)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center">
            <button
              type="button"
              onClick={goToCatalog}
              className="text-sm px-3 py-2 border rounded-xl bg-white hover:bg-zinc-50 pointer-events-auto"
            >
              Continue shopping
            </button>

            <button
              type="button"
              onClick={goToCart}
              className="ml-auto text-sm px-3 py-2 rounded-xl bg-zinc-900 text-white pointer-events-auto"
            >
              View cart →
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}