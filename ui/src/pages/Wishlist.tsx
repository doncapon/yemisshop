// src/pages/Wishlist.tsx
import React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import SiteLayout from "../layouts/SiteLayout";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

import { showMiniCartToast } from "../components/cart/MiniCartToast";
import { upsertCartLine, readCartLines, toMiniCartRows } from "../utils/cartModel";

type WishlistItem = {
  id: string;
  productId: string;
  createdAt?: string;
  computedRetailPrice?: number | null;
  product?: {
    id: string;
    title: string;
    slug?: string | null;
    retailPrice?: number | null;
    images?: Array<{ url: string }> | string[] | null;
    sku?: string | null;
  } | null;
};

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

async function fetchWishlist(): Promise<WishlistItem[]> {
  const { data } = await api.get("/api/favorites", AXIOS_COOKIE_CFG);

  if (data && Array.isArray((data as any).items)) return (data as any).items;
  if (data && Array.isArray((data as any).data)) return (data as any).data;
  if (Array.isArray(data)) return data as any;

  return [];
}

export default function Wishlist() {
  const qc = useQueryClient();
  const isLoggedIn = !!useAuthStore.getState().user?.id;

  const q = useQuery({
    queryKey: ["favorites"],
    queryFn: fetchWishlist,

    // Use cached rows as placeholder, but always refetch when we land here
    placeholderData: () => {
      const cached = qc.getQueryData(["favorites"]) as WishlistItem[] | undefined;
      return cached;
    },

    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: 1,
  });

  const rows = Array.isArray(q.data) ? q.data : [];
  const hasRows = rows.length > 0;

  const showInitialLoading = q.isLoading && !hasRows;
  const showEmpty = !q.isLoading && !q.isError && rows.length === 0;

  /* ---------------- Mutations ---------------- */

  // Remove/toggle favourite
  const toggleFavMut = useMutation({
    mutationFn: async (productId: string) => {
      await api.post(
        "/api/favorites/toggle",
        { productId },
        AXIOS_COOKIE_CFG
      );
      return productId;
    },
    onSuccess: (productId) => {
      qc.setQueryData<WishlistItem[]>(["favorites"], (prev) =>
        (prev ?? []).filter((it) => it.productId !== productId)
      );
    },
  });

  // Add to cart (base product only from wishlist)
  const addToCartMut = useMutation({
    mutationFn: async (item: WishlistItem) => {
      const p = item.product;
      if (!p) throw new Error("Product missing");

      const productId = p.id;
      const variantId = null;
      const optionsKey = "";

      const priceRaw =
        (item as any).computedRetailPrice ??
        p.retailPrice ??
        0;

      const unitPriceNum = Number.isFinite(Number(priceRaw))
        ? Number(priceRaw)
        : 0;

      const img =
        Array.isArray(p.images)
          ? typeof p.images[0] === "string"
            ? (p.images[0] as string)
            : (p.images[0] as any)?.url
          : null;

      if (isLoggedIn) {
        // Server cart write
        await api.post(
          "/api/cart/items",
          {
            productId,
            variantId,
            kind: "BASE",
            qty: 1,
            selectedOptions: [],
            optionsKey,
            titleSnapshot: p.title ?? "",
            imageSnapshot: img ?? null,
            unitPriceCache: unitPriceNum,
          },
          AXIOS_COOKIE_CFG
        );
      }

      // Local mirror (for navbar badge / guest cart)
      upsertCartLine({
        productId,
        variantId,
        kind: "BASE",
        optionsKey,
        qty: 1,
        selectedOptions: [],
        titleSnapshot: p.title ?? null,
        imageSnapshot: img ?? null,
        unitPriceCache: unitPriceNum,
      });

      window.dispatchEvent(new Event("cart:updated"));

      // 🔥 Mini-cart toast: show the FULL cart (local mirror),
      // not just the one item we added
      const lines = readCartLines();
      const miniRows = toMiniCartRows(lines);

      showMiniCartToast(
        miniRows,
        { productId, variantId: null },
        { title: "Added to cart", duration: 3000, maxItems: 4, mode: "add" }
      );
    },
  });

  return (
    <SiteLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Wishlist</h1>

              {hasRows && q.isFetching && (
                <span className="text-[11px] px-2 py-1 rounded-full border bg-white text-zinc-600">
                  Updating…
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-600">
              Save items you like and add them to your cart when you’re ready.
            </p>
          </div>

          {hasRows && (
            <div className="text-xs text-zinc-500 text-right">
              Items: <span className="font-semibold">{rows.length}</span>
            </div>
          )}
        </div>

        {/* Container card */}
        <div className="rounded-2xl border bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-zinc-900">
              Wishlist ({showInitialLoading ? "…" : rows.length})
            </div>

            {!showInitialLoading && !q.isError && hasRows && (
              <button
                type="button"
                onClick={() => q.refetch()}
                className="text-xs px-3 py-1.5 rounded-full border bg-zinc-50 hover:bg-zinc-100 text-zinc-700"
              >
                Refresh
              </button>
            )}
          </div>

          {/* States */}
          {showInitialLoading && (
            <div className="py-8 text-sm text-zinc-600 text-center">
              Loading your wishlist…
            </div>
          )}

          {!showInitialLoading && q.isError && (
            <div className="py-4 text-sm text-rose-700 bg-rose-50 rounded-xl px-3">
              Couldn’t load wishlist. Make sure you’re logged in.
            </div>
          )}

          {showEmpty && (
            <div className="py-10 text-center text-sm text-zinc-600">
              <p>Your wishlist is empty.</p>
              <Link
                to="/"
                className="inline-flex mt-3 text-xs font-semibold px-4 py-2 rounded-full border bg-white hover:bg-zinc-50"
              >
                Browse products
              </Link>
            </div>
          )}

          {/* Grid of items */}
          {!showInitialLoading && !q.isError && hasRows && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((it) => {
                const p = it.product;
                const title = p?.title || "Product";
                const href = p?.id ? `/product/${p.id}` : "#";

                const img =
                  Array.isArray(p?.images)
                    ? typeof p.images[0] === "string"
                      ? (p.images[0] as string)
                      : (p.images[0] as any)?.url
                    : null;

                const priceRaw =
                  (it as any).computedRetailPrice ??
                  p?.retailPrice ??
                  null;
                const price =
                  typeof priceRaw === "number" && Number.isFinite(priceRaw)
                    ? priceRaw
                    : null;

                const removing =
                  toggleFavMut.isPending &&
                  toggleFavMut.variables === it.productId;

                const adding =
                  addToCartMut.isPending &&
                  addToCartMut.variables?.id === it.id;

                return (
                  <div
                    key={it.id}
                    className="flex flex-col rounded-2xl border bg-zinc-50/60 hover:bg-zinc-50 transition shadow-[0_6px_18px_rgba(15,23,42,0.04)] overflow-hidden"
                  >
                    <Link to={href} className="block bg-zinc-100" style={{ aspectRatio: "4 / 3" }}>
                      {img ? (
                        <img
                          src={img}
                          alt={title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-[11px] text-zinc-500">
                          No image
                        </div>
                      )}
                    </Link>

                    <div className="flex-1 flex flex-col p-3">
                      <Link
                        to={href}
                        className="text-sm font-semibold text-zinc-900 hover:underline line-clamp-2"
                      >
                        {title}
                      </Link>

                      {price !== null && (
                        <div className="mt-1 text-sm font-bold text-zinc-900">
                          {NGN.format(price)}
                        </div>
                      )}

                      {it.createdAt && (
                        <div className="mt-1 text-[11px] text-zinc-500">
                          Saved on{" "}
                          {new Date(it.createdAt).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      )}

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => addToCartMut.mutate(it)}
                          disabled={adding}
                          className={`flex-1 text-xs font-semibold px-3 py-2 rounded-xl text-white ${
                            adding
                              ? "bg-zinc-400 cursor-not-allowed"
                              : "bg-fuchsia-600 hover:bg-fuchsia-700"
                          }`}
                        >
                          {adding ? "Adding…" : "Add to cart"}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleFavMut.mutate(it.productId)}
                          disabled={removing}
                          className={`text-xs font-semibold px-3 py-2 rounded-xl border ${
                            removing
                              ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                              : "bg-white text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {removing ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}