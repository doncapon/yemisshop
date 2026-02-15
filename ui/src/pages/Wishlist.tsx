// src/pages/Wishlist.tsx
import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import SiteLayout from "../layouts/SiteLayout";
import api from "../api/client";

type WishlistItem = {
  id: string;
  productId: string;
  createdAt?: string;
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

async function fetchWishlist(): Promise<WishlistItem[]> {
  const { data } = await api.get("/api/favorites", AXIOS_COOKIE_CFG);

  if (data && Array.isArray((data as any).items)) return (data as any).items;
  if (data && Array.isArray((data as any).data)) return (data as any).data;
  if (Array.isArray(data)) return data as any;

  return [];
}

export default function Wishlist() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["favorites"],
    queryFn: fetchWishlist,

    // ✅ KEY FIX: only use placeholder if we already have cached rows
    // (DON’T force [] here, or you’ll render empty state instantly)
    placeholderData: () => {
      const cached = qc.getQueryData(["favorites"]) as WishlistItem[] | undefined;
      return cached;
    },

    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const rows = Array.isArray(q.data) ? q.data : [];
  const hasRows = rows.length > 0;

  // ✅ show empty only after first fetch finishes (and no error)
  const showInitialLoading = q.isLoading && !hasRows;
  const showEmpty = !q.isLoading && !q.isError && rows.length === 0;

  return (
    <SiteLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-900">Wishlist</h1>

              {/* ✅ If we already have items, show a subtle refresh state */}
              {hasRows && q.isFetching && (
                <span className="text-[11px] px-2 py-1 rounded-full border bg-white text-zinc-600">
                  Updating…
                </span>
              )}
            </div>

            <p className="text-sm text-zinc-600">Items you’ve saved for later.</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-zinc-50 text-sm font-semibold text-zinc-900">
            Items ({showInitialLoading ? "…" : rows.length})
          </div>

          {showInitialLoading && (
            <div className="p-4 text-sm text-zinc-600">Loading…</div>
          )}

          {!showInitialLoading && q.isError && (
            <div className="p-4 text-sm text-rose-700 bg-rose-50">
              Couldn’t load wishlist. Make sure you’re logged in.
            </div>
          )}

          {showEmpty && (
            <div className="p-4 text-sm text-zinc-600">No items yet.</div>
          )}

          <div className="divide-y">
            {rows.map((it) => {
              const p = it.product;
              const title = p?.title || "Product";
              const href = p?.id ? `/product/${p.id}` : "#";

              const img =
                Array.isArray(p?.images)
                  ? typeof p?.images?.[0] === "string"
                    ? (p?.images?.[0] as string)
                    : (p?.images?.[0] as any)?.url
                  : null;
              const price = (it as any).computedRetailPrice ?? p?.retailPrice ?? null;

              return (
                <div key={it.id} className="p-4 flex gap-3">
                  <div className="w-16 h-16 rounded-xl border bg-zinc-50 overflow-hidden shrink-0">
                    {img ? (
                      <img src={img} alt={title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-[11px] text-zinc-500">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link to={href} className="text-sm font-semibold text-zinc-900 hover:underline line-clamp-2">
                      {title}
                    </Link>

                    {typeof price === "number" && (
                      <div className="mt-1 text-xs text-zinc-600">
                        ₦{price.toLocaleString()}
                      </div>
                    )}

                  </div>

                  <div className="shrink-0 flex items-center">
                    <Link
                      to={href}
                      className="text-xs font-semibold rounded-xl border bg-white px-3 py-2 hover:bg-zinc-50"
                    >
                      View
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
