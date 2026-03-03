// src/components/cart/MiniCartToast.tsx
import * as React from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ShoppingCart, X } from "lucide-react";

type ToastMode = "add" | "remove";

type ToastOpts = {
  title?: string;
  duration?: number; // ms
  maxItems?: number;
  mode?: ToastMode; // ✅ NEW
};

type MiniCartOption = { attribute?: string; value?: string };

export type MiniCartRow = {
  // ✅ optional cart item id so we can uniquely separate rows if needed
  id?: string;

  productId: string;
  variantId?: string | null;

  // ✅ supplier info so items from different suppliers never merge
  supplierId?: string | null;
  supplierName?: string | null;

  // ✅ base vs variant kind
  kind?: "BASE" | "VARIANT";

  // ✅ ensures different variant selections don’t collapse together
  optionsKey?: string | null;

  title?: string;
  qty: number;
  unitPrice?: number;
  totalPrice?: number;
  price?: number; // legacy
  image?: string | null;
  selectedOptions?: MiniCartOption[];
};

type ToastFocus = { productId: string; variantId?: string | null };

type ToastPayload = {
  /**
   * Full cart snapshot (e.g. server cart) – will be used as the base.
   */
  cart?: MiniCartRow[];
  /**
   * Additional rows (e.g. just-added items). These are *appended* to `cart`
   * when present so the toast shows server + new items.
   */
  items?: MiniCartRow[];
  /**
   * Alias / legacy shape – also appended.
   */
  rows?: MiniCartRow[];

  focus?: ToastFocus | null;
  opts?: ToastOpts;
};

const EVENT = "mini-cart-toast:v1";

/* ----------------------------------------------------------------------------
 * Public API: showMiniCartToast
 *
 * 1) Legacy usage (still works):
 *    showMiniCartToast(cartRows, { productId, variantId }, opts)
 *
 * 2) New usage (server + additions merged in the toast):
 *    showMiniCartToast({
 *      cart: serverCartRows,
 *      items: addedRows,   // or `rows`
 *      focus: { productId, variantId },
 *      opts: { ... },
 *    });
 * -------------------------------------------------------------------------- */
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
      ? {
          cart: arg1,
          focus: arg2 ?? undefined,
          opts: arg3,
        }
      : arg1;

    window.dispatchEvent(new CustomEvent<ToastPayload>(EVENT, { detail }));
  } catch {
    // never block add-to-cart
  }
}

function clampCart(cart: MiniCartRow[], maxItems: number) {
  const safe = Array.isArray(cart) ? cart : [];
  // show most-recent-ish: last items first
  const sliced = safe.slice(-Math.max(1, maxItems)).reverse();
  return sliced;
}

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

function money(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/* ----------------------------------------------------------------------------
 * Normalize event payload: merge server cart + added rows
 * -------------------------------------------------------------------------- */
function normalizePayload(d: ToastPayload | null | undefined) {
  const base: MiniCartRow[] = Array.isArray(d?.cart) ? d!.cart : [];
  const extras: MiniCartRow[] = [];

  if (Array.isArray(d?.items)) extras.push(...d!.items);
  if (Array.isArray(d?.rows)) extras.push(...d!.rows);

  const cart: MiniCartRow[] = [...base, ...extras];

  // If focus is missing, derive from the most recent cart row (last item)
  const last = cart.length ? cart[cart.length - 1] : null;

  const focus: ToastFocus | null =
    d?.focus && typeof d.focus === "object" && (d.focus as any).productId
      ? {
          productId: String((d.focus as any).productId),
          variantId: (d.focus as any).variantId ?? null,
        }
      : last?.productId
      ? {
          productId: String(last.productId),
          variantId: last.variantId ?? null,
        }
      : null;

  return { cart, focus, opts: d?.opts };
}

/* ----------------------------------------------------------------------------
 * Group cart rows by **productId + variantId + kind + supplierId + optionsKey (and id)**
 * so:
 * - Different suppliers never merge.
 * - Different variant selections (optionsKey) never merge.
 * -------------------------------------------------------------------------- */
function groupCart(cart: MiniCartRow[]): MiniCartRow[] {
  const map = new Map<
    string,
    MiniCartRow & {
      qty: number;
      _lastIndex: number;
    }
  >();

  cart.forEach((row, index) => {
    if (!row || !row.productId) return;

    const kind = row.kind ?? (row.variantId ? "VARIANT" : "BASE");

    // ✅ Build a highly specific key so “similar title” items but different suppliers
    // or different option combos do not collapse.
    const keyParts: string[] = [];

    if (row.id) keyParts.push(`id:${row.id}`);
    keyParts.push(`p:${row.productId}`);
    keyParts.push(`v:${row.variantId ?? "base"}`);
    keyParts.push(`k:${kind}`);
    keyParts.push(`s:${row.supplierId ?? ""}`);
    keyParts.push(`o:${row.optionsKey ?? ""}`);

    const key = keyParts.join("|");

    const rowQty = Math.max(1, Number(row.qty) || 0); // default to 1 if missing/0
    const rowUnit = money(row.unitPrice ?? row.price);

    const existing = map.get(key);
    if (existing) {
      // accumulate qty for the exact same line (same supplier/options combo)
      existing.qty += rowQty;

      // keep the most recent info for display
      if (row.title) existing.title = row.title;
      if (row.image) existing.image = row.image;
      if (Array.isArray(row.selectedOptions) && row.selectedOptions.length) {
        existing.selectedOptions = row.selectedOptions;
      }
      if (rowUnit) {
        existing.unitPrice = rowUnit;
        existing.price = rowUnit;
      }

      // also refresh supplier info if present
      if (row.supplierId) existing.supplierId = row.supplierId;
      if (row.supplierName) existing.supplierName = row.supplierName;
      if (row.kind) existing.kind = row.kind;
      if (row.optionsKey) existing.optionsKey = row.optionsKey;

      existing._lastIndex = index;
    } else {
      map.set(key, {
        ...row,
        qty: rowQty,
        unitPrice: row.unitPrice ?? row.price ?? rowUnit,
        price: row.price ?? row.unitPrice ?? rowUnit,
        kind,
        _lastIndex: index,
      });
    }
  });

  // Sort by last index so "most recently touched" items are last,
  // then clampCart() will pull them to the top.
  return Array.from(map.values())
    .sort((a, b) => a._lastIndex - b._lastIndex)
    .map(({ _lastIndex, ...rest }) => rest);
}

export default function MiniCartToastHost() {
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<{
    cart: MiniCartRow[];
    focus: ToastFocus | null;
    opts?: ToastOpts;
  } | null>(null);

  const timerRef = React.useRef<number | null>(null);

  const stopTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    stopTimer();
  }, [stopTimer]);

  React.useEffect(() => {
    const onToast = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const { cart, focus, opts } = normalizePayload(ce.detail as ToastPayload);

      // ✅ if merged cart is empty, close immediately
      if (!cart.length) {
        setOpen(false);
        setPayload(null);
        stopTimer();
        return;
      }

      setPayload({ cart, focus, opts });
      setOpen(true);

      stopTimer();
      const duration = Math.max(800, Number(opts?.duration ?? 5000));
      timerRef.current = window.setTimeout(() => setOpen(false), duration);
    };

    window.addEventListener(EVENT, onToast as any);
    return () => window.removeEventListener(EVENT, onToast as any);
  }, [stopTimer]);

  const node = React.useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.body;
  }, []);

  // ✅ Always call this hook, even when payload is null
  const groupedCart = React.useMemo(
    () => groupCart(payload?.cart || []),
    [payload?.cart]
  );

  // ✅ Guard AFTER all hooks
  if (!node || !payload) return null;

  const mode = payload.opts?.mode ?? "add";
  const title =
    payload.opts?.title ??
    (mode === "remove" ? "Removed from cart" : "Added to cart");

  const maxItems = Math.max(1, Number(payload.opts?.maxItems ?? 4));
  const items = clampCart(groupedCart, maxItems);

  // ✅ total quantity from grouped cart
  const totalQty = (groupedCart || []).reduce(
    (s, x) => s + Math.max(0, Number(x?.qty) || 0),
    0
  );

  const focusPid = payload.focus?.productId
    ? String(payload.focus.productId)
    : null;
  const focusVid =
    payload.focus?.variantId !== undefined
      ? String(payload.focus.variantId ?? null)
      : null;

  return createPortal(
    <div
      className="fixed right-4 top-4 z-[99999] pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={`pointer-events-auto w-[92vw] max-w-[420px] rounded-2xl border bg-white shadow-2xl overflow-hidden transition-all duration-200 ${
          open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        <div
          className={`p-4 border-b text-white ${
            mode === "remove"
              ? "bg-gradient-to-r from-zinc-800 to-zinc-700"
              : "bg-gradient-to-r from-fuchsia-600 to-pink-600"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} />
                <div className="font-semibold">{title}</div>
              </div>
              <div className="text-xs text-white/90 mt-1">
                Cart items: {totalQty}
              </div>
            </div>

            <button
              type="button"
              onClick={close}
              className="shrink-0 rounded-full bg-white/15 hover:bg-white/25 p-2"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-4">
          <div className="space-y-3">
            {items.map((it, idx) => {
              const img = it.image || "/placeholder.svg";
              const unit = money(it.unitPrice ?? it.price);
              const line = unit * Math.max(1, Number(it.qty) || 1);

              const isFocus =
                !!payload.focus &&
                String(it.productId) === String(payload.focus.productId) &&
                String(it.variantId ?? null) ===
                  String(payload.focus.variantId ?? null);

              return (
                <div
                  key={`${it.productId}:${it.variantId ?? "base"}:${it.supplierId ?? "nosupp"}:${it.optionsKey ?? "noop"}:${idx}`}
                  className={`flex gap-3 rounded-xl border p-3 ${
                    isFocus
                      ? "border-fuchsia-400 bg-fuchsia-50/50"
                      : "bg-white"
                  }`}
                >
                  <img
                    src={img}
                    alt={it.title || "Cart item"}
                    className="w-14 h-14 rounded-xl border object-cover"
                    onError={(e) => (e.currentTarget.style.opacity = "0.25")}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {it.title || "Item"}
                    </div>

                    {/* ✅ Supplier label so “same title, different supplier” is obvious */}
                    {(it.supplierName || it.supplierId) && (
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        Supplier:{" "}
                        <span className="font-medium">
                          {it.supplierName ?? it.supplierId}
                        </span>
                      </div>
                    )}

                    {Array.isArray(it.selectedOptions) &&
                      it.selectedOptions.length > 0 && (
                        <div className="text-[11px] text-zinc-600 mt-0.5 line-clamp-1">
                          {it.selectedOptions
                            .filter(Boolean)
                            .map(
                              (o) =>
                                `${o.attribute ?? ""}${
                                  o.value ? `: ${o.value}` : ""
                                }`
                            )
                            .filter((s) => s.trim())
                            .join(" • ")}
                        </div>
                      )}

                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-[11px] text-zinc-600">
                        Qty: {it.qty}
                      </div>
                      <div className="text-sm font-semibold">
                        {NGN.format(line)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={close}
              className="text-sm px-3 py-2 rounded-xl border bg-white hover:bg-zinc-50"
            >
              Continue shopping
            </button>

            <Link
              to="/cart"
              onClick={close}
              className="text-sm px-3 py-2 rounded-xl border bg-zinc-900 text-white hover:opacity-90"
            >
              View cart →
            </Link>
          </div>
        </div>
      </div>
    </div>,
    node
  );
}