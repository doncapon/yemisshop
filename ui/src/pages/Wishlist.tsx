// src/pages/Wishlist.tsx
import React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useLocation } from "react-router-dom";
import SiteLayout from "../layouts/SiteLayout";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

import { showMiniCartToast } from "../components/cart/MiniCartToast";
import { upsertCartLine, readCartLines, toMiniCartRows, qtyInCart } from "../utils/cartModel";

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
    images?: Array<{ url?: string; src?: string; image?: string }> | string[] | string | null;
    imagesJson?: string[] | string | null;
    variants?: Array<{ id: string } | null> | null;
    sku?: string | null;
  } | null;
};

type SupplierOfferLite = {
  id: string;
  supplierId?: string | null;
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number | null;
  basePrice?: number | null;
  unitPrice?: number | null;
};

type VariantLite = {
  id: string;
  inStock?: boolean | null;
  availableQty?: number | null;
  imagesJson?: string[];
  offers?: SupplierOfferLite[];
};

type CatalogProductLite = {
  id: string;
  title: string;
  retailPrice?: number | null;
  computedRetailPrice?: number | null;
  autoPrice?: number | null;
  displayBasePrice?: number | null;
  offersFrom?: number | null;
  availableQty?: number | null;
  inStock?: boolean | null;
  imagesJson?: string[];
  variants?: VariantLite[];
  supplierProductOffers?: SupplierOfferLite[];
  status?: string;
};

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

function getApiOrigin(): string {
  const base = String((api as any)?.defaults?.baseURL || "").trim();

  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL(base).origin;
    } catch {
      return window.location.origin;
    }
  }

  const env = (import.meta as any)?.env;
  const fromEnv = String(env?.VITE_API_URL || env?.VITE_API_ORIGIN || "").trim();

  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      //
    }
  }

  return window.location.origin;
}

const API_ORIGIN = getApiOrigin();

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

  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
    try {
      return resolveImageUrl(JSON.parse(s));
    } catch {
      //
    }
  }

  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;

  if (s.startsWith("/")) {
    if (s.startsWith("/uploads/") || s.startsWith("/api/uploads/")) return `${API_ORIGIN}${s}`;
    return `${window.location.origin}${s}`;
  }

  if (s.startsWith("uploads/") || s.startsWith("api/uploads/")) {
    return `${API_ORIGIN}/${s.replace(/^\/+/, "")}`;
  }

  return `${window.location.origin}/${s.replace(/^\/+/, "")}`;
}

function pickImageValue(input: any): string | null {
  const resolved = resolveImageUrl(input);
  return resolved ?? null;
}

function decToNumber(v: any): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeImages(val: any): string[] {
  if (!val) return [];

  const out: string[] = [];

  const pushOne = (input: any) => {
    if (input == null) return;

    if (Array.isArray(input)) {
      for (const item of input) pushOne(item);
      return;
    }

    if (typeof input === "object") {
      const candidate =
        input.url ??
        input.src ??
        input.image ??
        input.imageUrl ??
        input.absoluteUrl ??
        null;

      if (candidate != null) pushOne(candidate);
      return;
    }

    if (typeof input === "string") {
      const s = input.trim();
      if (!s) return;

      if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
        try {
          pushOne(JSON.parse(s));
          return;
        } catch {
          //
        }
      }

      const parts = s
        .split(/[\n,]/g)
        .map((t) => t.trim())
        .filter(Boolean);

      if (parts.length > 1) {
        for (const p of parts) pushOne(p);
        return;
      }

      out.push(s);
    }
  };

  pushOne(val);
  return out.filter(Boolean);
}

function offerStockOk(o?: SupplierOfferLite): boolean {
  if (!o || o.isActive === false) return false;

  const qty = o.availableQty;
  const hasQty = qty != null && Number.isFinite(Number(qty));
  const qtyOk = !hasQty ? true : Number(qty) > 0;

  return o.inStock === true || qtyOk;
}

function collectAllOffers(p: CatalogProductLite): SupplierOfferLite[] {
  const out: SupplierOfferLite[] = [];
  if (Array.isArray(p.supplierProductOffers)) out.push(...p.supplierProductOffers);
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      if (Array.isArray(v.offers)) out.push(...v.offers);
    }
  }
  return out;
}

function cheapestActiveBaseOfferPrice(p: CatalogProductLite): number | null {
  const offers = Array.isArray(p.supplierProductOffers) ? p.supplierProductOffers : [];
  let best: number | null = null;

  for (const o of offers) {
    if (!o || o.isActive === false || !offerStockOk(o)) continue;
    const raw = o.basePrice ?? o.unitPrice ?? null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (best == null || n < best) best = n;
  }

  return best;
}

function cheapestActiveVariantOfferPrice(p: CatalogProductLite): number | null {
  let best: number | null = null;

  const variants = Array.isArray(p.variants) ? p.variants : [];
  for (const v of variants) {
    const offers = Array.isArray(v.offers) ? v.offers : [];
    for (const o of offers) {
      if (!o || o.isActive === false || !offerStockOk(o)) continue;
      const raw = o.unitPrice ?? o.basePrice ?? null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (best == null || n < best) best = n;
    }
  }

  return best;
}

function cheapestActiveAnyOfferPrice(p: CatalogProductLite): number | null {
  const offers = collectAllOffers(p);
  let best: number | null = null;

  for (const o of offers) {
    if (!o || o.isActive === false || !offerStockOk(o)) continue;
    const raw = o.unitPrice ?? o.basePrice ?? null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (best == null || n < best) best = n;
  }

  return best;
}

function getDisplayRetailPrice(p: CatalogProductLite): number {
  const apiComputed = Number(p.computedRetailPrice);
  if (Number.isFinite(apiComputed) && apiComputed > 0) return apiComputed;

  const hasOptions = Array.isArray(p.variants) && p.variants.length > 0;

  if (hasOptions) {
    const baseRaw = cheapestActiveBaseOfferPrice(p);
    if (baseRaw != null) return baseRaw;

    const varRaw = cheapestActiveVariantOfferPrice(p);
    if (varRaw != null) return varRaw;
  } else {
    const anyRaw = cheapestActiveAnyOfferPrice(p);
    if (anyRaw != null) return anyRaw;
  }

  const raw =
    Number(p.offersFrom) > 0
      ? Number(p.offersFrom)
      : Number(p.retailPrice) > 0
      ? Number(p.retailPrice)
      : Number(p.autoPrice) > 0
      ? Number(p.autoPrice)
      : Number(p.displayBasePrice) > 0
      ? Number(p.displayBasePrice)
      : 0;

  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function getProductImageCandidates(p: CatalogProductLite): string[] {
  const out: string[] = [];

  const push = (val: any) => {
    const imgs = normalizeImages(val);
    for (const img of imgs) {
      const resolved = resolveImageUrl(img);
      if (resolved && !out.includes(resolved)) out.push(resolved);
    }
  };

  push(p.imagesJson);

  if (Array.isArray(p.variants)) {
    for (const v of p.variants) push(v.imagesJson);
  }

  return out;
}

async function fetchWishlist(): Promise<WishlistItem[]> {
  const { data } = await api.get("/api/favorites", AXIOS_COOKIE_CFG);

  if (data && Array.isArray((data as any).items)) return (data as any).items;
  if (data && Array.isArray((data as any).data)) return (data as any).data;
  if (Array.isArray(data)) return data as any;

  return [];
}

async function fetchCatalogProductsLite(): Promise<CatalogProductLite[]> {
  const { data } = await api.get("/api/products", {
    params: {
      include: "variants,offers",
      status: "LIVE",
      take: 200,
      page: 1,
    },
  });

  const raw: any[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.data)
    ? (data as any).data
    : [];

  return raw
    .filter((x) => x && x.id != null)
    .map((x) => {
      const variants: VariantLite[] = Array.isArray(x.variants)
        ? x.variants.map((v: any) => ({
            id: String(v.id),
            inStock: v.inStock === true,
            imagesJson: normalizeImages(v.imagesJson),
            availableQty: Number.isFinite(Number(v.availableQty)) ? Number(v.availableQty) : null,
            offers: Array.isArray(v.offers)
              ? v.offers.map((o: any) => ({
                  id: String(o.id),
                  supplierId: o.supplierId ?? o.supplier?.id ?? null,
                  isActive: o.isActive === true,
                  inStock: o.inStock === true,
                  availableQty: Number.isFinite(Number(o.availableQty))
                    ? Number(o.availableQty)
                    : null,
                  unitPrice: o.unitPrice != null ? decToNumber(o.unitPrice) : null,
                  basePrice: o.basePrice != null ? decToNumber(o.basePrice) : null,
                }))
              : [],
          }))
        : [];

      const baseSource =
        (Array.isArray((x as any).supplierProductOffers) && x.supplierProductOffers) ||
        (Array.isArray((x as any).supplierOffers) && (x as any).supplierOffers) ||
        [];

      const baseOffers: SupplierOfferLite[] = baseSource.map((o: any) => ({
        id: String(o.id),
        supplierId: o.supplierId ?? o.supplier?.id ?? null,
        isActive: o.isActive === true,
        inStock: o.inStock === true,
        availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
        basePrice: o.basePrice != null ? decToNumber(o.basePrice) : null,
        unitPrice: o.unitPrice != null ? decToNumber(o.unitPrice) : null,
      }));

      return {
        id: String(x.id),
        title: String(x.title ?? ""),
        retailPrice: x.retailPrice != null ? decToNumber(x.retailPrice) : null,
        computedRetailPrice:
          x.computedRetailPrice != null ? decToNumber(x.computedRetailPrice) : null,
        autoPrice: x.autoPrice != null ? decToNumber(x.autoPrice) : null,
        displayBasePrice: x.displayBasePrice != null ? decToNumber(x.displayBasePrice) : null,
        offersFrom: x.offersFrom != null ? decToNumber(x.offersFrom) : null,
        inStock: x.inStock === true,
        availableQty: Number.isFinite(Number(x.availableQty)) ? Number(x.availableQty) : null,
        imagesJson: normalizeImages(x.imagesJson),
        variants,
        supplierProductOffers: baseOffers,
        status: String(x.status ?? ""),
      } satisfies CatalogProductLite;
    });
}

async function setServerCartQty(input: {
  productId: string;
  variantId?: string | null;
  kind?: "BASE" | "VARIANT";
  qty: number;
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
}) {
  const { data } = await api.get("/api/cart", AXIOS_COOKIE_CFG);
  const items: any[] = Array.isArray((data as any)?.items) ? (data as any).items : [];

  const vid = input.variantId ?? null;
  const kind: "BASE" | "VARIANT" = input.kind ?? (vid ? "VARIANT" : "BASE");
  const optionsKey = "";

  const found = items.find(
    (x) =>
      String(x.productId) === String(input.productId) &&
      String(x.variantId ?? null) === String(vid) &&
      String(x.kind || "").toUpperCase() === kind &&
      String(x.optionsKey || "") === optionsKey
  );

  if (input.qty <= 0) {
    if (found?.id) {
      await api.delete(`/api/cart/items/${found.id}`, AXIOS_COOKIE_CFG);
    }
    return;
  }

  if (!found?.id) {
    await api.post(
      "/api/cart/items",
      {
        productId: input.productId,
        variantId: vid,
        kind,
        qty: input.qty,
        selectedOptions: [],
        optionsKey,
        titleSnapshot: input.titleSnapshot ?? null,
        imageSnapshot: input.imageSnapshot ?? null,
        unitPriceCache: input.unitPriceCache ?? null,
      },
      AXIOS_COOKIE_CFG
    );
    return;
  }

  await api.patch(
    `/api/cart/items/${found.id}`,
    {
      qty: input.qty,
      titleSnapshot: input.titleSnapshot ?? null,
      imageSnapshot: input.imageSnapshot ?? null,
      unitPriceCache: input.unitPriceCache ?? null,
    },
    AXIOS_COOKIE_CFG
  );
}

export default function Wishlist() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const isLoggedIn = !!useAuthStore.getState().user?.id;

  const fromHere = `${location.pathname}${location.search}`;

  const goToCatalogHard = React.useCallback(() => {
    window.location.assign("/");
  }, []);

  const goToProductWithBack = React.useCallback(
    (href: string) => {
      navigate(href, { state: { from: fromHere } });
    },
    [navigate, fromHere]
  );

  const q = useQuery({
    queryKey: ["favorites"],
    queryFn: fetchWishlist,
    placeholderData: () => {
      const cached = qc.getQueryData(["favorites"]) as WishlistItem[] | undefined;
      return cached;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: 1,
  });

  const catalogProductsQ = useQuery({
    queryKey: ["wishlist", "catalog-products-lite"],
    queryFn: fetchCatalogProductsLite,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const catalogProductMap = React.useMemo(() => {
    const map = new Map<string, CatalogProductLite>();
    const rows = Array.isArray(catalogProductsQ.data) ? catalogProductsQ.data : [];
    for (const p of rows) map.set(String(p.id), p);
    return map;
  }, [catalogProductsQ.data]);

  const rows = Array.isArray(q.data) ? q.data : [];
  const hasRows = rows.length > 0;

  const showInitialLoading = q.isLoading && !hasRows;
  const showEmpty = !q.isLoading && !q.isError && rows.length === 0;

  const toggleFavMut = useMutation({
    mutationFn: async (productId: string) => {
      await api.post("/api/favorites/toggle", { productId }, AXIOS_COOKIE_CFG);
      return productId;
    },
    onSuccess: (productId) => {
      qc.setQueryData<WishlistItem[]>(["favorites"], (prev) =>
        (prev ?? []).filter((it) => it.productId !== productId)
      );
    },
  });

  const addToCartMut = useMutation({
    mutationFn: async (item: WishlistItem) => {
      const p = item.product;
      if (!p) throw new Error("Product missing");

      const productId = p.id;
      const variantId = null;
      const optionsKey = "";

      const catalogProduct = catalogProductMap.get(String(productId));

      const priceRaw =
        catalogProduct != null
          ? getDisplayRetailPrice(catalogProduct)
          : (item as any).computedRetailPrice ?? p.retailPrice ?? 0;

      const unitPriceNum = Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : 0;

      const img =
        (catalogProduct ? pickImageValue(getProductImageCandidates(catalogProduct)) : null) ??
        pickImageValue(p.images ?? p.imagesJson ?? null);

      const existingLines = readCartLines();
      const existingQty = qtyInCart(existingLines, productId, null);
      const nextQty = existingQty + 1;

      if (isLoggedIn) {
        await setServerCartQty({
          productId,
          variantId,
          kind: "BASE",
          qty: nextQty,
          titleSnapshot: p.title ?? "",
          imageSnapshot: img ?? null,
          unitPriceCache: unitPriceNum,
        });
      }

      upsertCartLine({
        productId,
        variantId,
        kind: "BASE",
        optionsKey,
        qty: nextQty,
        selectedOptions: [],
        titleSnapshot: p.title ?? null,
        imageSnapshot: img ?? null,
        unitPriceCache: unitPriceNum,
      });

      window.dispatchEvent(new Event("cart:updated"));

      const linesAfter = readCartLines();
      const miniRows = toMiniCartRows(linesAfter);

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

        <div className="rounded-2xl border bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-zinc-900">
              Wishlist ({showInitialLoading ? "…" : rows.length})
            </div>

            {!showInitialLoading && !q.isError && hasRows && (
              <button
                type="button"
                onClick={() => {
                  void q.refetch();
                  void catalogProductsQ.refetch();
                }}
                className="text-xs px-3 py-1.5 rounded-full border bg-zinc-50 hover:bg-zinc-100 text-zinc-700"
              >
                Refresh
              </button>
            )}
          </div>

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
              <button
                type="button"
                onClick={goToCatalogHard}
                className="inline-flex mt-3 text-xs font-semibold px-4 py-2 rounded-full border bg-white hover:bg-zinc-50"
              >
                Browse products
              </button>
            </div>
          )}

          {!showInitialLoading && !q.isError && hasRows && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rows.map((it) => {
                const p = it.product;
                const title = p?.title || "Product";
                const href = p?.id ? `/products/${p.id}` : "#";

                const catalogProduct = catalogProductMap.get(String(it.productId));

                const img =
                  (catalogProduct ? pickImageValue(getProductImageCandidates(catalogProduct)) : null) ??
                  pickImageValue(p?.images ?? p?.imagesJson ?? null);

                const priceRaw =
                  catalogProduct != null
                    ? getDisplayRetailPrice(catalogProduct)
                    : (it as any).computedRetailPrice ?? p?.retailPrice ?? null;

                const price =
                  typeof priceRaw === "number" && Number.isFinite(priceRaw) ? priceRaw : null;

                const hasVariants =
                  Array.isArray(catalogProduct?.variants) && catalogProduct.variants.length > 0;

                const removing =
                  toggleFavMut.isPending && toggleFavMut.variables === it.productId;

                const adding =
                  addToCartMut.isPending && addToCartMut.variables?.id === it.id;

                return (
                  <div
                    key={it.id}
                    className="flex flex-col rounded-xl border bg-zinc-50 hover:bg-zinc-50/80 transition overflow-hidden shadow-sm"
                  >
                    <Link
                      to={href}
                      state={{ from: fromHere }}
                      className="block bg-zinc-100 overflow-hidden"
                    >
                      {img ? (
                        <img
                          src={img}
                          alt={title}
                          className="w-full h-[160px] object-cover"
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="w-full h-[160px] grid place-items-center text-[11px] text-zinc-500">
                          No image
                        </div>
                      )}
                    </Link>

                    <div className="flex flex-col p-2.5">
                      <Link
                        to={href}
                        state={{ from: fromHere }}
                        className="text-sm font-semibold text-zinc-900 line-clamp-2 hover:underline"
                      >
                        {title}
                      </Link>

                      {price !== null && (
                        <div className="mt-1 text-sm font-bold text-zinc-900">
                          {NGN.format(price)}
                        </div>
                      )}

                      {it.createdAt && (
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          Saved on{" "}
                          {new Date(it.createdAt).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      )}

                      <div className="mt-2 flex gap-2">
                        {hasVariants ? (
                          <button
                            type="button"
                            onClick={() => goToProductWithBack(href)}
                            className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-zinc-900 hover:bg-zinc-800"
                          >
                            Choose options
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addToCartMut.mutate(it)}
                            disabled={adding}
                            className={`flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white ${
                              adding
                                ? "bg-zinc-400 cursor-not-allowed"
                                : "bg-fuchsia-600 hover:bg-fuchsia-700"
                            }`}
                          >
                            {adding ? "Adding…" : "Add to cart"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleFavMut.mutate(it.productId)}
                          disabled={removing}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
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