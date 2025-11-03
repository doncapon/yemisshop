// src/pages/ProductDetail.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useToast } from '../components/ToastProvider';
import { useAuthStore } from '../store/auth';

/* ---------------- Types (tolerant to optional richer payloads) ---------------- */
type Attr = { id: string; name: string; type?: string | null };
type AttrVal = { id: string; name: string; code?: string | null };

type VariantOption = {
  attribute: Attr;
  value: AttrVal;
};

type Variant = {
  id: string;
  sku?: string | null;
  price?: number | null; // nullable => falls back to product price
  inStock?: boolean | null;
  imagesJson?: string[];
  options?: VariantOption[];
};

type Product = {
  id: string;
  title: string;
  description: string;
  inStock: boolean | null;
  price: number | null; // base price
  imagesJson?: string[];
  brand?: { id: string; name: string } | null;
  brandName?: string | null;
  attributeValues?: Array<{ id: string; attribute: Attr; value: AttrVal }>;
  attributeTexts?: Array<{ id: string; attribute: Attr; value: string }>;
  variants?: Variant[];
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/* ---------------- Helpers ---------------- */
const safeNum = (n: any, fallback = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
};
const gtZero = (n: any) => Number.isFinite(Number(n)) && Number(n) > 0;

function getBrandName(p?: Product | null) {
  if (!p) return '';
  return (p.brand?.name || p.brandName || '').trim();
}

function priceOf(p: Product, v?: Variant | null) {
  const candidate = v?.price ?? p.price;
  return gtZero(candidate) ? Number(candidate) : 0;
}

function imagesOf(p: Product, v?: Variant | null) {
  const fromVariant = v?.imagesJson && v.imagesJson.length > 0 ? v.imagesJson : null;
  return fromVariant || p.imagesJson || [];
}

function isVariantAvailable(v?: Variant | null) {
  if (!v) return false;
  return v.inStock !== false && gtZero(v.price ?? 0);
}

function hasAnyVariant(p: Product) {
  return Array.isArray(p.variants) && p.variants.length > 0;
}

function variantSellable(v?: Variant | null, fallbackBasePrice?: number | null): boolean {
  if (!v) return false;
  const unit = gtZero(v.price) ? Number(v.price) : gtZero(fallbackBasePrice) ? Number(fallbackBasePrice) : 0;
  return v.inStock !== false && unit > 0;
}

function productBaseSellable(p: Product): boolean {
  return p.inStock !== false && gtZero(p.price);
}

function productSellable(p: Product): boolean {
  if (!hasAnyVariant(p)) return productBaseSellable(p);
  const basePrice = gtZero(p.price) ? Number(p.price) : null;
  return (p.variants ?? []).some((v) => variantSellable(v, basePrice));
}

function firstSellableVariant(p: Product): Variant | null {
  if (!hasAnyVariant(p)) return null;
  const basePrice = gtZero(p.price) ? Number(p.price) : null;
  return (p.variants ?? []).find((v) => variantSellable(v, basePrice)) ?? null;
}

function buildAxes(variants: Variant[]) {
  type AxisValue = { value: AttrVal; present: boolean; available: boolean };
  type Axis = { attribute: Attr; values: AxisValue[] };
  const map = new Map<string, Axis>();

  for (const v of variants) {
    for (const opt of v.options || []) {
      const aId = opt.attribute.id;
      const axis = map.get(aId) || { attribute: opt.attribute, values: [] };
      if (!axis.values.find((x) => x.value.id === opt.value.id)) {
        axis.values.push({ value: opt.value, present: true, available: true });
      }
      map.set(aId, axis);
    }
  }

  const axes = Array.from(map.values()).map((ax) => ({
    ...ax,
    values: ax.values.sort((a, b) => a.value.name.localeCompare(b.value.name, undefined, { sensitivity: 'base' })),
  }));
  axes.sort((a, b) => a.attribute.name.localeCompare(b.attribute.name, undefined, { sensitivity: 'base' }));
  return axes;
}

function findVariant(variants: Variant[], selection: Record<string, string>) {
  return variants.find((v) => {
    const opts = v.options || [];
    for (const [attrId, valId] of Object.entries(selection)) {
      const hit = opts.find((o) => o.attribute.id === attrId && o.value.id === valId);
      if (!hit) return false;
    }
    return true;
  });
}

function computeAvailability(
  product: Product,
  variants: Variant[],
  axes: ReturnType<typeof buildAxes>,
  selection: Record<string, string>
) {
  const basePrice = gtZero(product.price) ? Number(product.price) : null;
  return axes.map((ax) => {
    const otherSelections = { ...selection };
    delete otherSelections[ax.attribute.id];

    const nextValues = ax.values.map((val) => {
      const ok = variants.some((v) => {
        if (v.inStock === false) return false;
        const unit = gtZero(v.price) ? Number(v.price) : gtZero(basePrice) ? Number(basePrice) : 0;
        if (unit <= 0) return false;

        const opts = v.options || [];
        for (const [attrId, valId] of Object.entries(otherSelections)) {
          if (!opts.find((o) => o.attribute.id === attrId && o.value.id === valId)) return false;
        }
        if (!opts.find((o) => o.attribute.id === ax.attribute.id && o.value.id === val.value.id)) return false;
        return true;
      });
      return { ...val, available: ok };
    });

    return { ...ax, values: nextValues };
  });
}

function minMaxVariantPrice(p: Product) {
  if (!Array.isArray(p.variants) || p.variants.length === 0) {
    return { min: safeNum(p.price, 0), max: safeNum(p.price, 0) };
  }
  const base = gtZero(p.price) ? Number(p.price) : null;
  const prices = p.variants
    .map((v) => (gtZero(v.price) ? Number(v.price) : gtZero(base) ? base! : NaN))
    .filter((n) => Number.isFinite(n) && n > 0) as number[];
  if (prices.length === 0) {
    const only = gtZero(p.price) ? Number(p.price) : 0;
    return { min: only, max: only };
  }
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/* ===== Availability helpers ===== */
type SingleAvailability = {
  totalAvailable: number;
  cheapestSupplierUnit?: number | null;
};

const numLike = (...cands: any[]) => {
  for (const c of cands) {
    const v = Number(c);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
};

async function fetchSingleAvailability(productId: string, variantId: string | null): Promise<SingleAvailability | null> {
  const itemsParam = `${productId}:${variantId ?? ''}`;

  const tryPerProductSum = async () => {
    const perProductCandidates = [
      `/api/supplier-offers?productId=${encodeURIComponent(productId)}`,
      `/api/admin/supplier-offers?productId=${encodeURIComponent(productId)}`,
      `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
    ];
    for (const url of perProductCandidates) {
      try {
        const { data } = await api.get(url);
        const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
        if (!Array.isArray(arr)) continue;

        const getVid = (o: any) => o?.variantId ?? o?.productVariantId ?? o?.variant_id ?? o?.variant?.id ?? null;

        const filtered = arr.filter((o: any) => {
          if (o?.isActive === false) return false;
          const offerVid = getVid(o);
          if (variantId == null) return offerVid == null;
          return offerVid === variantId || offerVid == null;
        });

        let total = 0;
        let cheapest: number | null = null;
        for (const o of filtered) {
          const qty = Math.max(0, Number(o?.availableQty ?? o?.available ?? o?.qty ?? o?.stock ?? 0) || 0);
          total += qty;
          const c = Number(o?.price ?? o?.unitPrice ?? o?.unit_price);
          if (Number.isFinite(c)) cheapest = cheapest == null ? c : Math.min(cheapest, c);
        }
        return { totalAvailable: total, cheapestSupplierUnit: cheapest };
      } catch {}
    }
    return null;
  };

  const bulkCandidates = [
    `/api/catalog/availability?items=${encodeURIComponent(itemsParam)}`,
    `/api/products/availability?items=${encodeURIComponent(itemsParam)}`,
    `/api/supplier-offers/availability?items=${encodeURIComponent(itemsParam)}`,
  ];

  for (const url of bulkCandidates) {
    try {
      const { data } = await api.get(url);
      const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      if (Array.isArray(arr) && arr.length > 0) {
        const row = arr[0];
        const total = Number(row?.totalAvailable ?? row?.available ?? row?.availableQty ?? row?.qty ?? row?.total ?? row?.sum ?? 0) || 0;
        let cheapest = Number(row?.cheapestSupplierUnit ?? row?.cheapest ?? row?.minPrice ?? row?.min);

        if (variantId && total === 0) {
          const merged = await tryPerProductSum();
          if (merged) return merged;
        }

        return {
          totalAvailable: Math.max(0, total),
          cheapestSupplierUnit: Number.isFinite(cheapest) ? cheapest : null,
        };
      }
    } catch {}
  }

  return await tryPerProductSum();
}

/** product-wide total availability = sum of ALL active offers’ availableQty */
async function fetchProductTotalAvailability(productId: string): Promise<number | null> {
  const candidates = [
    `/api/supplier-offers?productId=${encodeURIComponent(productId)}`,
    `/api/admin/supplier-offers?productId=${encodeURIComponent(productId)}`,
    `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
  ];
  for (const url of candidates) {
    try {
      const { data } = await api.get(url);
      const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      if (Array.isArray(arr)) {
        return arr
          .filter((o: any) => o?.isActive !== false)
          .reduce((sum, o) => sum + Math.max(0, Number(o?.availableQty ?? o?.available ?? o?.qty ?? o?.stock ?? 0) || 0), 0);
      }
    } catch {}
  }
  return null;
}

/* ---- Cart helpers (localStorage) ---- */
function readCart(): Array<{ productId: string; variantId?: string | null; qty: number }> {
  try {
    const raw = localStorage.getItem('cart');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function qtyInCart(productId: string, variantId: string | null): number {
  const cart = readCart();
  return cart
    .filter((x) => x.productId === productId && (variantId ? x.variantId === variantId : !x.variantId))
    .reduce((s, x) => s + Math.max(0, Number(x.qty) || 0), 0);
}

/* ======================= */
/* Product Detail Component */
/* ======================= */
export default function ProductDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { token } = useAuthStore();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['product', id, { include: 'brand,variants,attributes' }],
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get(`/api/products/${id}?include=brand,variants,attributes`);
      const payload = res.data;
      const raw = payload?.data ?? payload;

      if (!raw || !raw.id) {
        const e = new Error('Product not found');
        (e as any).status = 404;
        throw e;
      }

      const rawVariants: any[] = Array.isArray(raw.ProductVariant)
        ? raw.ProductVariant
        : Array.isArray(raw.variants)
        ? raw.variants
        : [];

      const variants: Variant[] = rawVariants.map((v: any) => ({
        id: String(v.id),
        sku: v.sku ?? null,
        price: v.price != null ? Number(v.price) : null,
        inStock: v.inStock ?? null,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        options: Array.isArray(v.options)
          ? v.options.map((o: any) => ({
              attribute: {
                id: String(o?.attribute?.id ?? ''),
                name: String(o?.attribute?.name ?? ''),
                type: o?.attribute?.type ?? null,
              },
              value: {
                id: String(o?.value?.id ?? ''),
                name: String(o?.value?.name ?? ''),
                code: o?.value?.code ?? null,
              },
            }))
          : undefined,
      }));

      const attributeValues =
        Array.isArray(raw.attributeOptions)
          ? raw.attributeOptions.map((x: any, idx: number) => ({
              id: String(x?.id ?? `val-${idx}`),
              attribute: { id: String(x?.attribute?.id ?? ''), name: String(x?.attribute?.name ?? ''), type: x?.attribute?.type ?? null },
              value: { id: String(x?.value?.id ?? ''), name: String(x?.value?.name ?? ''), code: x?.value?.code ?? null },
            }))
          : undefined;

      const attributeTexts =
        Array.isArray(raw.ProductAttributeText)
          ? raw.ProductAttributeText.map((x: any, idx: number) => ({
              id: String(x?.id ?? `txt-${idx}`),
              attribute: { id: String(x?.attribute?.id ?? ''), name: String(x?.attribute?.name ?? ''), type: x?.attribute?.type ?? null },
              value: String(x?.value ?? ''),
            }))
          : undefined;

      const product: Product = {
        id: String(raw.id),
        title: String(raw.title ?? ''),
        description: String(raw.description ?? ''),
        inStock: raw.inStock ?? null,
        price: raw.price != null ? Number(raw.price) : null,
        imagesJson: Array.isArray(raw.imagesJson) ? raw.imagesJson : [],
        brand: raw.brand ? { id: String(raw.brand.id), name: String(raw.brand.name) } : null,
        brandName: raw.brandName ?? raw.brand?.name ?? null,
        variants,
        attributeValues,
        attributeTexts,
      };

      return product;
    },
  });

  const { data: totalAvail, isLoading: totalAvailLoading } = useQuery({
    queryKey: ['product', 'availability-total', id],
    enabled: !!id,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const pid = String(id);
      const sum = await fetchProductTotalAvailability(pid);
      return typeof sum === 'number' ? Math.max(0, sum) : null;
    },
  });

  const favQuery = useQuery({
    queryKey: ['favorites', 'mine'],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<{ productIds: string[] }>('/api/favorites/mine', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return new Set(data.productIds);
    },
    initialData: new Set<string>(),
  });

  const toggleFav = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const { data } = await api.post<{ favorited: boolean }>(
        '/api/favorites/toggle',
        { productId },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
      return { productId, favorited: data.favorited };
    },
    onMutate: async ({ productId }) => {
      const key = ['favorites', 'mine'] as const;
      const prev = qc.getQueryData<Set<string>>(key);
      if (prev) {
        const next = new Set(prev);
        next.has(productId) ? next.delete(productId) : next.add(productId);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['favorites', 'mine'], ctx.prev);
      toast.push({ title: 'Wishlist', message: 'Could not update wishlist. Please try again.', duration: 3500 });
    },
    onSuccess: ({ favorited }) => {
      toast.push({
        title: 'Wishlist',
        message: favorited ? 'Added to wishlist.' : 'Removed from wishlist.',
        duration: 2500,
      });
    },
  });

  /* ---------- Variant selection state ---------- */
  const axes = useMemo(() => buildAxes(data?.variants || []), [data?.variants]);
  const [selection, setSelection] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data || axes.length === 0) return;
    let nextSel: Record<string, string> = {};
    let availAxes = computeAvailability(data, data.variants || [], axes, nextSel);
    for (const ax of availAxes) {
      const firstAvail = ax.values.find((v) => v.available) || ax.values[0];
      if (firstAvail) {
        nextSel = { ...nextSel, [ax.attribute.id]: firstAvail.value.id };
        availAxes = computeAvailability(data, data.variants || [], axes, nextSel);
      }
    }
    setSelection(nextSel);
  }, [data, axes]);

  const availability = useMemo(() => {
    if (!data || axes.length === 0) return axes;
    return computeAvailability(data, data.variants || [], axes, selection);
  }, [data, axes, selection]);

  const autoVariant = useMemo(() => {
    if (!data) return null;
    if (axes.length > 0) return null;
    return firstSellableVariant(data);
  }, [data, axes.length]);

  const matchedVariant = useMemo(() => {
    if (!data) return undefined;
    if (axes.length === 0) return autoVariant ?? undefined;
    return findVariant(data.variants || [], selection);
  }, [data, selection, axes.length, autoVariant]);

  /* ---------- Single-pair availability ---------- */
  const variantIdForAvailability = useMemo(() => {
    if (!data) return null;
    return matchedVariant?.id ?? (hasAnyVariant(data) ? null : null);
  }, [data, matchedVariant]);

  const { data: singleAvail, isLoading: availLoading } = useQuery({
    queryKey: ['product', 'availability', id, variantIdForAvailability],
    enabled: !!data,
    staleTime: 15000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (data && axes.length > 0 && !matchedVariant) return null;
      const pid = String(id);
      const vid = matchedVariant?.id ?? null;
      return await fetchSingleAvailability(pid, vid);
    },
  });

  const availabilityKnownZero = !!singleAvail && singleAvail.totalAvailable === 0;

  /* ---------- Stock remaining vs cart ---------- */
  const maxAvailable = useMemo<number | null>(() => {
    if (matchedVariant && singleAvail) return Math.max(0, Number(singleAvail.totalAvailable || 0));
    if (!matchedVariant && typeof totalAvail === 'number') return Math.max(0, Number(totalAvail));
    return null;
  }, [matchedVariant, singleAvail, totalAvail]);

  const inCartQty = useMemo(() => {
    if (!data) return 0;
    const vid = matchedVariant?.id ?? null;
    return qtyInCart(data.id, vid);
  }, [data, matchedVariant]);

  const remainingQty = useMemo<number | null>(() => {
    if (maxAvailable == null) return null;
    return Math.max(0, maxAvailable - inCartQty);
  }, [maxAvailable, inCartQty]);

  const canSellBase = useMemo(() => {
    if (!data) return false;
    if (axes.length > 0) return productSellable(data);
    return productSellable(data);
  }, [data, axes.length]);

  const canSell = useMemo(() => {
    if (!canSellBase || availabilityKnownZero) return false;
    if (remainingQty === null) return true; // unknown availability => allow (we still hard-cap in addToCart)
    return remainingQty > 0;
  }, [canSellBase, availabilityKnownZero, remainingQty]);

  const availablePill = useMemo(() => {
    if (!data) return false;
    if (availabilityKnownZero) return false;
    if (matchedVariant) return isVariantAvailable(matchedVariant);
    return productSellable(data);
  }, [data, matchedVariant, availabilityKnownZero]);

  const effectivePrice = useMemo(() => (data ? priceOf(data, matchedVariant ?? undefined) : 0), [data, matchedVariant]);
  const effectiveImages = useMemo(() => (data ? imagesOf(data, matchedVariant ?? undefined) : []), [data, matchedVariant]);
  const { min, max } = useMemo(() => (data ? minMaxVariantPrice(data) : { min: 0, max: 0 }), [data]);
  const variantSku = matchedVariant?.sku ?? null;
  const isVariantPriceDifferent = useMemo(() => {
    if (!data) return false;
    const pv = safeNum(data.price, 0);
    const cv = safeNum(effectivePrice, 0);
    return pv !== 0 && cv !== pv;
  }, [data, effectivePrice]);

  /* ---------- Add to cart (hard-cap with fresh cart read) ---------- */
  const [adding, setAdding] = useState(false);

  const addToCart = () => {
    if (adding) return; // ignore rapid bursts
    if (!data) return;

    // existing validations...
    if (axes.length > 0) {
      if (!matchedVariant) {
        toast.push({ title: 'Select options', message: 'Please choose all required options.', duration: 3500 });
        return;
      }
      if (!isVariantAvailable(matchedVariant)) {
        toast.push({ title: 'Unavailable', message: 'That combination is not in stock.', duration: 3500 });
        return;
      }
    } else {
      if (hasAnyVariant(data)) {
        if (!matchedVariant || !isVariantAvailable(matchedVariant)) {
          toast.push({ title: 'Unavailable', message: 'This item is not currently available.', duration: 3500 });
          return;
        }
      } else {
        if (data.inStock === false || !gtZero(data.price)) {
          toast.push({ title: 'Unavailable', message: 'This product is out of stock.', duration: 3500 });
          return;
        }
      }
    }
    if (availabilityKnownZero) {
      toast.push({ title: 'Out of stock', message: 'This item is currently unavailable.', duration: 3500 });
      return;
    }

    const unit = effectivePrice;
    if (!gtZero(unit)) {
      toast.push({ title: 'Unavailable', message: 'This item has no valid price.', duration: 3500 });
      return;
    }

    // ----- Fresh read from localStorage to avoid stale memo during rapid clicks
    const vid = matchedVariant?.id ?? null;
    const currentInCart = qtyInCart(data.id, vid);
    const cap = maxAvailable == null ? 0 : Math.max(0, maxAvailable - currentInCart);

    if (cap <= 0) {
      toast.push({ title: 'Stock limit', message: 'No more units available to add.', duration: 3500 });
      return;
    }

    const selectedOptions =
      axes.length > 0
        ? availability.map((ax) => {
            const valId = selection[ax.attribute.id];
            const v = ax.values.find((x) => x.value.id === valId)?.value;
            return { attributeId: ax.attribute.id, attribute: ax.attribute.name, valueId: v?.id, value: v?.name || '' };
          })
        : [];

    setAdding(true);
    try {
      const raw = localStorage.getItem('cart');
      const cart: Array<{
        productId: string;
        variantId?: string | null;
        title: string;
        qty: number;
        unitPrice: number;
        totalPrice: number;
        price: number;
        selectedOptions?: Array<{ attributeId: string; attribute: string; valueId?: string; value: string }>;
        image?: string;
      }> = raw ? JSON.parse(raw) : [];

      const image = effectiveImages?.[0];
      const keyMatch = (x: any) => x.productId === data.id && (vid ? x.variantId === vid : !x.variantId);
      const idx = cart.findIndex(keyMatch);

      if (idx >= 0) {
        const current = Math.max(1, Number(cart[idx].qty) || 1);
        const newQty = Math.min(current + 1, current + cap);
        if (newQty === current) {
          toast.push({ title: 'Stock limit', message: `Only ${cap} more available.`, duration: 3500 });
          setAdding(false);
          return;
        }
        cart[idx] = {
          ...cart[idx],
          qty: newQty,
          unitPrice: unit,
          totalPrice: unit * newQty,
          price: unit,
          title: data.title,
          selectedOptions,
          image: image || cart[idx].image,
        };
      } else {
        const firstQty = Math.min(1, cap);
        if (firstQty <= 0) {
          toast.push({ title: 'Stock limit', message: 'No more units available to add.', duration: 3500 });
          setAdding(false);
          return;
        }
        cart.push({
          productId: data.id,
          variantId: vid,
          title: data.title,
          qty: firstQty,
          unitPrice: unit,
          totalPrice: unit * firstQty,
          price: unit,
          selectedOptions,
          image,
        });
      }

      localStorage.setItem('cart', JSON.stringify(cart));

      const summary =
        selectedOptions.length > 0 ? ` (${selectedOptions.map((o) => `${o.attribute}: ${o.value}`).join(', ')})` : '';
      toast.push({ title: 'Added to cart', message: `${data.title}${summary} added to your cart.`, duration: 4500 });
    } catch {
      toast.push({ title: 'Cart', message: 'Could not add to cart.', duration: 3500 });
    } finally {
      setAdding(false);
    }
  };

  /* ---------- UI ---------- */

  if (isLoading) {
    return (
      <div className="relative bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft overflow-hidden rounded-2xl p-4 md:p-6">
        <div className="grid md:grid-cols-2 gap-6 animate-pulse">
          <div className="aspect-square md:aspect-[4/3] rounded-2xl bg-white/60 border" />
          <div className="space-y-4">
            <div className="h-8 w-3/4 rounded bg-white/70" />
            <div className="h-6 w-1/3 rounded bg-white/70" />
            <div className="h-24 w-full rounded bg-white/60" />
            <div className="h-11 w-48 rounded bg-white/80" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[40vh] grid place-items-center bg-hero-radial bg-bg-soft rounded-2xl">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full bg-danger/10 text-danger px-3 py-1 text-[11px] font-semibold border border-danger/20">
            Couldn’t load product
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Please try again</h2>
          <p className="text-ink-soft">Check your connection or go back to the catalogue.</p>
          <Link to="/" className="mt-4 inline-flex items-center rounded-xl border px-4 py-2 hover:bg-black/5">
            Back to products
          </Link>
        </div>
      </div>
    );
  }

  const p = data;
  const fav = !!favQuery.data?.has(p.id);
  const brand = getBrandName(p);

  const availabilityLine = (() => {
    if (availLoading || totalAvailLoading) return 'Checking availability…';
    if (matchedVariant && singleAvail) {
      const total = singleAvail.totalAvailable || 0;
      if (total <= 0) return 'Out of stock';
      const current = qtyInCart(p.id, matchedVariant.id);
      const rem = Math.max(0, total - current);
      return `Max you can buy now: ${total}${current ? ` • In cart: ${current} • Remaining: ${rem}` : ''}`;
    }
    if (!matchedVariant && typeof totalAvail === 'number') {
      const current = qtyInCart(p.id, null);
      const total = totalAvail;
      const rem = Math.max(0, total - current);
      return `Total available: ${total}${current ? ` • In cart: ${current} • Remaining: ${rem}` : ''}`;
    }
    return '';
  })();

  return (
    <div className="relative bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft rounded-2xl p-4 md:p-6 overflow-hidden">
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -top-20 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

      <div className="relative grid md:grid-cols-2 gap-6">
        {/* LEFT: image */}
        <div className="w-full">
          <ImageCarousel images={effectiveImages} title={p.title} />
        </div>

        {/* RIGHT: details */}
        <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-5 md:p-6 shadow-[0_6px_30px_rgba(0,0,0,0.06)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
                <span className={`inline-block size-1.5 rounded-full ${availablePill ? 'bg-white/90' : 'bg-black/50'}`} />
                {availabilityKnownZero ? 'Out of stock' : availablePill ? 'In stock' : 'May be out of stock'}
              </div>
              <h1 className="mt-3 text-2xl md:text-3xl font-extrabold tracking-tight text-ink">{p.title}</h1>
              {brand && <div className="text-sm text-ink-soft mt-1">{brand}</div>}
            </div>

            <button
              aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
              className={`shrink-0 grid place-items-center w-11 h-11 rounded-full border transition
                          ${fav ? 'bg-red-100 text-red-600 border-red-200' : 'bg-white text-ink-soft hover:text-red-600 hover:border-red-300'}`}
              onClick={() => {
                if (!token) {
                  toast.push({ title: 'Login required', message: 'Please login to use wishlist.', duration: 3500 });
                  return;
                }
                // optimistic mutation already toggles UI
                // server call dispatched here
                toggleFav.mutate({ productId: p.id });
              }}
              title={fav ? 'Remove from wishlist' : 'Add to wishlist'}
            >
              <span className="text-xl">{fav ? '♥' : '♡'}</span>
            </button>
          </div>

          {/* Price */}
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tracking-tight text-ink">
              {ngn.format(effectivePrice)}
            </span>
            {isVariantPriceDifferent && (
              <span className="text-sm text-ink-soft line-through">
                {ngn.format(safeNum(p.price, 0))}
              </span>
            )}
          </div>

          {/* Availability helper */}
          <div className="text-xs text-ink-soft mt-1 min-h-[1rem]">
            {availabilityLine}
          </div>

          {/* Range helper */}
          {hasAnyVariant(p) && (
            <div className="text-xs text-ink-soft mt-0.5">
              {min === max ? `Variants: ${p.variants?.length ?? 0}` : `From ${ngn.format(min)} to ${ngn.format(max)} • Variants: ${p.variants?.length ?? 0}`}
            </div>
          )}

          {/* Variant SKU */}
          {variantSku && <div className="text-xs text-ink-soft mt-0.5">SKU: {variantSku}</div>}

          {/* Variant pickers */}
          {axes.length > 0 && (
            <div className="mt-5 space-y-4">
              {availability.map((ax) => {
                const current = selection[ax.attribute.id];
                return (
                  <div key={ax.attribute.id}>
                    <div className="text-sm font-semibold text-ink mb-2">
                      {ax.attribute.name}{' '}
                      {current && <span className="text-ink-soft font-normal">• {ax.values.find((v) => v.value.id === current)?.value.name}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {ax.values.map((v) => {
                        const checked = current === v.value.id;
                        const disabled = !v.available;
                        const isColor = /color/i.test(ax.attribute.name) && v.value.code;
                        return (
                          <button
                            key={v.value.id}
                            disabled={disabled}
                            onClick={() => setSelection((s) => ({ ...s, [ax.attribute.id]: v.value.id }))}
                            title={v.value.name}
                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition
                              ${checked ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white hover:bg-black/5'}
                              ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            {isColor ? (
                              <>
                                <span className="inline-block w-4 h-4 rounded-full border" style={{ background: v.value.code || '#ccc' }} />
                                <span>{v.value.name}</span>
                              </>
                            ) : <span>{v.value.name}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Description */}
          <div className="mt-5">
            <h2 className="font-semibold text-ink">Description</h2>
            <p className="mt-1 text-ink-soft leading-relaxed">{p.description}</p>
          </div>

          {/* Specs */}
          {(p.attributeValues?.length || p.attributeTexts?.length) ? (
            <div className="mt-6">
              <h3 className="font-semibold text-ink mb-2">Specifications</h3>
              <div className="rounded-xl border bg-white">
                <table className="w-full text-sm">
                  <tbody>
                    {(p.attributeValues || []).map((av) => (
                      <tr key={`val-${av.id}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2 w-1/3 text-ink font-medium">{av.attribute?.name}</td>
                        <td className="px-3 py-2 text-ink-soft">{av.value?.name}</td>
                      </tr>
                    ))}
                    {(p.attributeTexts || []).map((at) => (
                      <tr key={`txt-${at.id}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2 w-1/3 text-ink font-medium">{at.attribute?.name}</td>
                        <td className="px-3 py-2 text-ink-soft">{at.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Actions */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold shadow-sm
                ${canSell && !adding ? 'bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200' : 'bg-zinc-200 text-zinc-500 cursor-not-allowed'}`}
              onClick={addToCart}
              disabled={!canSell || adding}
              title={
                !canSell
                  ? (availabilityKnownZero || remainingQty === 0 ? 'Out of stock' : 'Unavailable')
                  : (adding ? 'Adding…' : 'Add to cart')
              }
            >
              {adding ? 'Adding…' : 'Add to cart'}
            </button>

            <Link to="/cart" className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-5 py-3 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition">
              Go to cart
            </Link>

            <Link to="/catalog" className="inline-flex items-center gap-2 text-primary-700 hover:underline">
              Back to catalogue
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================== */
/* Inline Carousel Comp. */
/* ===================== */
function ImageCarousel({
  images,
  title,
  autoAdvanceMs = 4000,
}: {
  images: string[];
  title: string;
  autoAdvanceMs?: number;
}) {
  if (!images || images.length === 0) {
    return (
      <div className="w-full max-w-2xl aspect-square md:aspect-[4/3] rounded-2xl border overflow-hidden grid place-items-center text-sm text-ink-soft bg-white/70 backdrop-blur">
        No images
      </div>
    );
  }

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [zooming, setZooming] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgAreaRef = useRef<HTMLDivElement | null>(null);
  const zoomPaneRef = useRef<HTMLDivElement | null>(null);

  const frameRef = useRef<number | null>(null);
  const targetPosRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });
  const currentPosRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

  const ZOOM = 2.8;
  const PANE_REM = 28;
  const GAP_PX = 16;

  useEffect(() => {
    if (autoAdvanceMs <= 0) return;
    if (paused || images.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), autoAdvanceMs);
    return () => clearInterval(t);
  }, [paused, images.length, autoAdvanceMs]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let moved = false;

    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0].clientX; moved = false; };
    const onTouchMove = (e: TouchEvent) => { const dx = e.touches[0].clientX - startX; if (Math.abs(dx) > 10) moved = true; };
    const onTouchEnd = (e: TouchEvent) => {
      if (!moved) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (dx < -30) setIdx((i) => (i + 1) % images.length);
      if (dx > 30) setIdx((i) => (i - 1 + images.length) % images.length);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [images.length]);

  const goPrev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setIdx((i) => (i + 1) % images.length);

  useEffect(() => {
    const pane = zoomPaneRef.current;
    if (!pane) return;
    pane.style.backgroundImage = `url(${images[idx]})`;
    pane.style.backgroundRepeat = 'no-repeat';
    pane.style.backgroundSize = `${ZOOM * 100}%`;
  }, [idx, images]);

  const positionPane = () => {
    const pane = zoomPaneRef.current;
    const container = containerRef.current;
    if (!pane || !container) return;

    const rect = container.getBoundingClientRect();
    const paneSizePx = PANE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);

    let left = rect.right + GAP_PX;
    let top = rect.top + (rect.height - paneSizePx) / 2;

    const margin = 8;
    left = Math.min(Math.max(margin, left), window.innerWidth - paneSizePx - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - paneSizePx - margin);

    pane.style.left = `${left}px`;
    pane.style.top = `${top}px`;
    pane.style.width = `${paneSizePx}px`;
    pane.style.height = `${paneSizePx}px`;
  };

  useEffect(() => {
    if (!zooming) return;
    const onWin = () => positionPane();
    positionPane();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, { passive: true });
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin);
    };
  }, [zooming]);

  useEffect(() => {
    const pane = zoomPaneRef.current;
    if (!pane) return;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const animate = () => {
      const cur = currentPosRef.current;
      const tgt = targetPosRef.current;
      const SMOOTH = 0.2;
      const nx = lerp(cur.x, tgt.x, SMOOTH);
      const ny = lerp(cur.y, tgt.y, SMOOTH);
      currentPosRef.current = { x: nx, y: ny };
      pane.style.backgroundPosition = `${nx}% ${ny}%`;
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  const onMouseMove = (e: React.MouseEvent) => {
    const el = imgAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    targetPosRef.current = { x: clamp(x), y: clamp(y) };
  };

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative w-full max-w-2xl aspect-square md:aspect-[4/3] rounded-2xl border overflow-hidden bg-white shadow-[0_6px_30px_rgba(0,0,0,0.06)]"
        onMouseEnter={() => { setPaused(true); }}
        onMouseLeave={() => { setPaused(false); setZooming(false); }}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        aria-roledescription="carousel"
      >
        <div className="h-full w-full flex transition-transform duration-500" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {images.map((src, i) => (
            <div key={src + i} className="min-w-full h-full bg-white relative overflow-hidden">
              <div
                ref={i === idx ? imgAreaRef : null}
                className="absolute inset-0"
                onMouseEnter={() => { setZooming(true); positionPane(); }}
                onMouseLeave={() => setZooming(false)}
                onMouseMove={onMouseMove}
              />
              <img src={src} alt={`${title} – image ${i + 1}`} className="h-full w-full object-cover block m-0 p-0 pointer-events-none select-none" draggable={false} />
            </div>
          ))}
        </div>

        {images.length > 1 && (
          <>
            <button aria-label="Previous image" onClick={goPrev} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70">‹</button>
            <button aria-label="Next image" onClick={goNext} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70">›</button>
          </>
        )}

        {images.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2">
            {images.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} aria-label={`Go to slide ${i + 1}`} className={`h-2.5 w-2.5 rounded-full transition ${idx === i ? 'bg-primary-500 scale-110' : 'bg-black/30 hover:bg-black/50'}`} />
            ))}
          </div>
        )}
      </div>

      <div
        ref={zoomPaneRef}
        aria-hidden={!zooming}
        className={`hidden md:block fixed z-40 rounded-xl border bg-white/90 backdrop-blur shadow-xl overflow-hidden transition ${zooming ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
        style={{ backgroundPosition: '50% 50%', backgroundSize: `${2.8 * 100}%` }}
      />
    </div>
  );
}
