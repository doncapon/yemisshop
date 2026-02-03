// src/components/cart/pushMiniCartToast.tsx
import React from "react";
import { Link } from "react-router-dom";
import { useToast } from "../../components/ToastProvider"; // adjust path if yours differs

export type CartToastKey = { productId: string; variantId?: string | null };

export type CartRow = {
  productId: string;
  variantId?: string | null;
  title?: string;
  qty: number;

  unitPrice?: number;
  totalPrice?: number;

  // legacy fields you may already store
  price?: number;
  image?: string | null;
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const nnum = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

function toUnitPrice(r: CartRow): number {
  const up = nnum(r.unitPrice);
  if (Number.isFinite(up) && up > 0) return up;

  const legacy = nnum(r.price);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;

  const tp = nnum(r.totalPrice);
  const q = Math.max(0, Number(r.qty) || 0);
  if (Number.isFinite(tp) && tp > 0 && q > 0) return tp / q;

  return 0;
}

function toLineTotal(r: CartRow): number {
  const tp = nnum(r.totalPrice);
  if (Number.isFinite(tp) && tp >= 0) return tp;

  const q = Math.max(0, Number(r.qty) || 0);
  const up = toUnitPrice(r);
  return up * q;
}

function sameKey(a: CartToastKey | undefined, r: CartRow) {
  if (!a) return false;
  const av = a.variantId ?? null;
  const rv = r.variantId ?? null;
  return a.productId === r.productId && av === rv;
}

function normalizeCart(cartRaw: any[]): CartRow[] {
  const cart: CartRow[] = Array.isArray(cartRaw)
    ? cartRaw
        .filter(Boolean)
        .map((x: any) => ({
          productId: String(x.productId ?? ""),
          variantId: x.variantId ?? null,
          title: x.title ?? x.name ?? "",
          qty: Math.max(0, Math.floor(Number(x.qty) || 0)),
          unitPrice: Number.isFinite(Number(x.unitPrice)) ? Number(x.unitPrice) : undefined,
          totalPrice: Number.isFinite(Number(x.totalPrice)) ? Number(x.totalPrice) : undefined,
          price: Number.isFinite(Number(x.price)) ? Number(x.price) : undefined,
          image: x.image ?? null,
        }))
        .filter((x) => x.productId && x.qty > 0)
    : [];
  return cart;
}

function MiniCartToastBody({
  cartRaw,
  highlight,
  maxItems = 4,
  onClose,
}: {
  cartRaw: any[];
  highlight?: CartToastKey;
  maxItems?: number;
  onClose: () => void;
}) {
  const cart = normalizeCart(cartRaw);
  const subtotal = cart.reduce((s, r) => s + toLineTotal(r), 0);

  return (
    <div className="space-y-2">
      {/* Items */}
      <div className="space-y-2">
        {cart.slice(0, maxItems).map((r) => {
          const unit = toUnitPrice(r);
          const line = toLineTotal(r);
          const hi = sameKey(highlight, r);

          return (
            <div
              key={`${r.productId}:${r.variantId ?? "base"}`}
              className={`flex items-center gap-2 rounded-lg border p-2 ${
                hi ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white"
              }`}
            >
              {r.image ? (
                <img src={r.image} alt={r.title || "Item"} className="size-10 rounded-md object-cover border" />
              ) : (
                <div className="size-10 rounded-md border bg-zinc-50 grid place-items-center text-zinc-400 text-xs">—</div>
              )}

              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-900 truncate">{r.title || "Item"}</div>
                <div className="text-xs text-zinc-600">
                  {r.qty} × {ngn.format(unit)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm font-semibold text-zinc-900">{ngn.format(line)}</div>
                <div className="text-[11px] text-zinc-500">line</div>
              </div>
            </div>
          );
        })}

        {cart.length > maxItems && (
          <div className="text-xs text-zinc-600">+{cart.length - maxItems} more item(s) in cart</div>
        )}
      </div>

      {/* Subtotal + actions */}
      <div className="pt-2 border-t flex items-center justify-between gap-2">
        <div className="text-sm text-zinc-700">
          Subtotal: <span className="font-semibold text-zinc-900">{ngn.format(subtotal)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/cart"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-medium bg-white hover:bg-zinc-50"
          >
            View cart
          </Link>
          <Link
            to="/checkout"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold bg-zinc-900 text-white hover:opacity-90"
          >
            Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}

export function useMiniCartToast() {
  const { push, remove } = useToast();

  return React.useCallback(
    (cartRaw: any[], highlight?: CartToastKey, opts?: { title?: string; duration?: number; maxItems?: number }) => {
      let toastId = "";

      push({
        title: opts?.title ?? "Added to cart",
        duration: opts?.duration ?? 3500,
        message: (
          <MiniCartToastBody
            cartRaw={cartRaw}
            highlight={highlight}
            maxItems={opts?.maxItems ?? 4}
            onClose={() => toastId && remove(toastId)}
          />
        ),
      });

      // NOTE:
      // Your push() currently doesn’t return id. If you want close-on-link-click to remove the toast,
      // we can easily upgrade push() to return the created id.
      // For now, link click will still navigate and toast will auto-dismiss.
    },
    [push, remove]
  );
}
