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
  inStock?: boolean;
  imagesJson?: string[];
  options?: VariantOption[];
};

type Product = {
  id: string;
  title: string;
  description: string;
  inStock: boolean;
  price: number; // base price
  imagesJson?: string[];
  brand?: { id: string; name: string } | null;
  brandName?: string | null;

  // Rich attributes (for spec table)
  attributeValues?: Array<{ id: string; attribute: Attr; value: AttrVal }>;
  attributeTexts?: Array<{ id: string; attribute: Attr; value: string }>;

  // Variants
  variants?: Variant[];
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/* ---------------- Helpers ---------------- */
function getBrandName(p?: Product | null) {
  if (!p) return '';
  return (p.brand?.name || p.brandName || '').trim();
}

function priceOf(p: Product, v?: Variant | null) {
  const candidate = v?.price ?? p.price;
  return Number.isFinite(Number(candidate)) ? Number(candidate) : 0;
}

function imagesOf(p: Product, v?: Variant | null) {
  const fromVariant = v?.imagesJson && v.imagesJson.length > 0 ? v.imagesJson : null;
  return fromVariant || p.imagesJson || [];
}

function isVariantAvailable(v?: Variant | null) {
  if (!v) return false;
  return v.inStock !== false; // default truthy
}

function hasAnyVariant(p: Product) {
  return Array.isArray(p.variants) && p.variants.length > 0;
}

/**
 * Build axes data structure from variants:
 * - axes: [{ attribute, values: [{value, present, available}] }]
 * - order axes by attribute name asc for stability
 */
function buildAxes(variants: Variant[]) {
  type AxisValue = { value: AttrVal; present: boolean; available: boolean };
  type Axis = { attribute: Attr; values: AxisValue[] };

  const map = new Map<string, Axis>();

  for (const v of variants) {
    for (const opt of v.options || []) {
      const aId = opt.attribute.id;
      const axis = map.get(aId) || {
        attribute: opt.attribute,
        values: [],
      };
      // ensure value in axis.values (present=true, we'll compute available later)
      if (!axis.values.find((x) => x.value.id === opt.value.id)) {
        axis.values.push({ value: opt.value, present: true, available: true });
      }
      map.set(aId, axis);
    }
  }

  // deduplicate & sort axis values by name
  const axes = Array.from(map.values()).map((ax) => ({
    ...ax,
    values: ax.values.sort((a, b) => a.value.name.localeCompare(b.value.name, undefined, { sensitivity: 'base' })),
  }));

  // sort axes by attribute name
  axes.sort((a, b) => a.attribute.name.localeCompare(b.attribute.name, undefined, { sensitivity: 'base' }));
  return axes;
}

/** Given a selection { [attributeId]: valueId }, find the matching variant */
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

/** Recompute availability for each axis value, constrained by current selections */
function computeAvailability(
  variants: Variant[],
  axes: ReturnType<typeof buildAxes>,
  selection: Record<string, string>
) {
  return axes.map((ax) => {
    const otherSelections = { ...selection };
    delete otherSelections[ax.attribute.id];

    const nextValues = ax.values.map((val) => {
      const ok = variants.some((v) => {
        if (v.inStock === false) return false;
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
    queryFn: async () => (await api.get(`/api/products/${id}?include=brand,variants,attributes`)).data as Product,
    enabled: !!id,
    staleTime: 30_000,
  });

  // My favorites
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

  // selection map: attributeId -> valueId
  const [selection, setSelection] = useState<Record<string, string>>({});

  // seed selection with first available values (only once when data/axes arrive)
  useEffect(() => {
    if (!data || axes.length === 0) return;

    let nextSel: Record<string, string> = {};
    let availAxes = computeAvailability(data.variants || [], axes, nextSel);
    for (const ax of availAxes) {
      const firstAvail = ax.values.find((v) => v.available) || ax.values[0];
      if (firstAvail) {
        nextSel = { ...nextSel, [ax.attribute.id]: firstAvail.value.id };
        availAxes = computeAvailability(data.variants || [], axes, nextSel);
      }
    }
    setSelection(nextSel);
  }, [data, axes]);

  const availability = useMemo(() => {
    if (!data || axes.length === 0) return axes;
    return computeAvailability(data.variants || [], axes, selection);
  }, [data, axes, selection]);

  const matchedVariant = useMemo(() => {
    if (!data || axes.length === 0) return undefined;
    return findVariant(data.variants || [], selection);
  }, [data, selection, axes.length]);

  const available = useMemo(() => {
    if (!data) return false;
    if (axes.length === 0) return data.inStock !== false;
    return matchedVariant ? isVariantAvailable(matchedVariant) : false;
  }, [data, matchedVariant, axes.length]);

  const price = useMemo(() => {
    if (!data) return 0;
    return priceOf(data, matchedVariant);
  }, [data, matchedVariant]);

  const images = useMemo(() => {
    if (!data) return [];
    return imagesOf(data, matchedVariant);
  }, [data, matchedVariant]);

  /* ---------- Add to cart ---------- */
  const addToCart = () => {
    if (!data) return;

    // If variants exist, ensure we have a fully matched variant
    if (axes.length > 0 && !matchedVariant) {
      toast.push({ title: 'Select options', message: 'Please choose all required options.', duration: 3500 });
      return;
    }
    if (!available) {
      toast.push({ title: 'Unavailable', message: 'That combination is not in stock.', duration: 3500 });
      return;
    }

    // Build a rich selectedOptions[] for checkout display
    const selectedOptions =
      axes.length > 0
        ? axes.map((ax) => {
            const valId = selection[ax.attribute.id];
            const v = ax.values.find((x) => x.value.id === valId)?.value;
            return {
              attributeId: ax.attribute.id,
              attribute: ax.attribute.name,
              valueId: v?.id,
              value: v?.name || '',
            };
          })
        : [];

    try {
      const raw = localStorage.getItem('cart');
      const cart: Array<{
        productId: string;
        variantId?: string | null;
        title: string;
        qty: number;
        unitPrice: number;
        totalPrice: number;
        price: number; // legacy mirror
        selectedOptions?: Array<{ attributeId: string; attribute: string; valueId?: string; value: string }>;
        image?: string;
      }> = raw ? JSON.parse(raw) : [];

      const variantId = matchedVariant?.id ?? null;
      const unit = price; // resolved unit price (variant or product)
      const img = images?.[0];

      const keyMatch = (x: any) =>
        x.productId === data.id && (variantId ? x.variantId === variantId : !x.variantId);

      const idx = cart.findIndex(keyMatch);

      if (idx >= 0) {
        const newQty = Math.max(1, Number(cart[idx].qty) || 1) + 1;
        cart[idx] = {
          ...cart[idx],
          qty: newQty,
          unitPrice: unit,
          totalPrice: unit * newQty,
          price: unit, // legacy
          title: data.title,
          selectedOptions,
          image: img || cart[idx].image,
        };
      } else {
        cart.push({
          productId: data.id,
          variantId,
          title: data.title,
          qty: 1,
          unitPrice: unit,
          totalPrice: unit,
          price: unit, // legacy
          selectedOptions,
          image: img,
        });
      }

      localStorage.setItem('cart', JSON.stringify(cart));

      const summary =
        selectedOptions.length > 0
          ? ` (${selectedOptions.map((o) => `${o.attribute}: ${o.value}`).join(', ')})`
          : '';

      toast.push({
        title: 'Added to cart',
        message: `${data.title}${summary} added to your cart.`,
        duration: 4500,
      });
    } catch {
      toast.push({ title: 'Cart', message: 'Could not add to cart.', duration: 3500 });
    }
  };

  /* ---------- UI ---------- */

  // Loading state
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

  // Error state
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

  return (
    <div className="relative bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft rounded-2xl p-4 md:p-6 overflow-hidden">
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -top-20 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

      <div className="relative grid md:grid-cols-2 gap-6">
        {/* LEFT: image */}
        <div className="w-full">
          <ImageCarousel images={images} title={p.title} />
        </div>

        {/* RIGHT: details */}
        <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-5 md:p-6 shadow-[0_6px_30px_rgba(0,0,0,0.06)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
                <span className={`inline-block size-1.5 rounded-full ${available ? 'bg-white/90' : 'bg-black/50'}`} />
                {available ? 'In stock' : 'May be out of stock'}
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
                toggleFav.mutate({ productId: p.id });
              }}
              title={fav ? 'Remove from wishlist' : 'Add to wishlist'}
            >
              <span className="text-xl">{fav ? '♥' : '♡'}</span>
            </button>
          </div>

          {/* Price */}
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink">{ngn.format(price)}</p>
          {hasAnyVariant(p) && (
            <div className="text-xs text-ink-soft mt-0.5">
              {p.variants && p.variants.length > 0
                ? `Variants: ${p.variants.length} option${p.variants.length > 1 ? 's' : ''}`
                : null}
            </div>
          )}

          {/* Variant pickers */}
          {axes.length > 0 && (
            <div className="mt-5 space-y-4">
              {availability.map((ax) => {
                const current = selection[ax.attribute.id];
                return (
                  <div key={ax.attribute.id}>
                    <div className="text-sm font-semibold text-ink mb-2">
                      {ax.attribute.name}{' '}
                      {current && (
                        <span className="text-ink-soft font-normal">
                          • {ax.values.find((v) => v.value.id === current)?.value.name}
                        </span>
                      )}
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
                            onClick={() =>
                              setSelection((s) => ({
                                ...s,
                                [ax.attribute.id]: v.value.id,
                              }))
                            }
                            title={v.value.name}
                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition
                              ${checked ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white hover:bg-black/5'}
                              ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            {isColor ? (
                              <>
                                <span
                                  className="inline-block w-4 h-4 rounded-full border"
                                  style={{ background: v.value.code || '#ccc' }}
                                />
                                <span>{v.value.name}</span>
                              </>
                            ) : (
                              <span>{v.value.name}</span>
                            )}
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

          {/* Specs (attribute values + texts) */}
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
                ${available ? 'bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200' : 'bg-zinc-200 text-zinc-500 cursor-not-allowed'}`}
              onClick={addToCart}
              disabled={!available}
            >
              Add to cart
            </button>

            <Link
              to="/cart"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-5 py-3 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition"
            >
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
  autoAdvanceMs = 4000, // set to 0 to disable auto-advance entirely
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

  // rAF smoothing refs (for buttery cursor tracking)
  const frameRef = useRef<number | null>(null);
  const targetPosRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });
  const currentPosRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

  // tuning knobs
  const ZOOM = 2.8;          // magnification
  const PANE_REM = 28;       // zoom pane size (in rem)
  const GAP_PX = 16;         // gap between image and zoom pane

  /* ---------- Auto-advance (pauses while hovering/zooming) ---------- */
  useEffect(() => {
    if (autoAdvanceMs <= 0) return;
    if (paused || images.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), autoAdvanceMs);
    return () => clearInterval(t);
  }, [paused, images.length, autoAdvanceMs]);

  /* ---------- Touch swipe (mobile) ---------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let moved = false;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      moved = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      if (Math.abs(dx) > 10) moved = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!moved) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (dx < -30) setIdx((i) => (i + 1) % images.length);
      if (dx > 30) setIdx((i) => (i - 1 + images.length) % images.length);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [images.length]);

  const goPrev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setIdx((i) => (i + 1) % images.length);

  /* ---------- Keep zoom pane synced with current slide ---------- */
  useEffect(() => {
    const pane = zoomPaneRef.current;
    if (!pane) return;
    pane.style.backgroundImage = `url(${images[idx]})`;
    pane.style.backgroundRepeat = 'no-repeat';
    pane.style.backgroundSize = `${ZOOM * 100}%`;
  }, [idx, images]);

  /* ---------- Position zoom pane to the right of the image ---------- */
  const positionPane = () => {
    const pane = zoomPaneRef.current;
    const container = containerRef.current;
    if (!pane || !container) return;

    const rect = container.getBoundingClientRect();
    const paneSizePx = PANE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);

    let left = rect.right + GAP_PX;
    let top = rect.top + (rect.height - paneSizePx) / 2;

    // clamp inside viewport
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
    positionPane();
    const onWin = () => positionPane();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, { passive: true });
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin);
    };
  }, [zooming]);

  /* ---------- rAF loop to smoothly follow cursor ---------- */
  useEffect(() => {
    const pane = zoomPaneRef.current;
    if (!pane) return;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const animate = () => {
      const cur = currentPosRef.current;
      const tgt = targetPosRef.current;
      const SMOOTH = 0.2; // lower = smoother/slower
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

  /* ---------- Mouse tracking (sets the target for rAF) ---------- */
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
        {/* Slides (carousel stays put while zooming) */}
        <div
          className="h-full w-full flex transition-transform duration-500"
          style={{ transform: `translateX(-${idx * 100}%)` }}
        >
          {images.map((src, i) => (
            <div key={src + i} className="min-w-full h-full grid place-items-center bg-white relative">
              {/* invisible tracking layer */}
              <div
                ref={i === idx ? imgAreaRef : null}
                className="absolute inset-0"
                onMouseEnter={() => { setZooming(true); positionPane(); }}
                onMouseLeave={() => setZooming(false)}
                onMouseMove={onMouseMove}
              />
              <img
                src={src}
                alt={`${title} – image ${i + 1}`}
                className="max-h-full max-w-full object-contain pointer-events-none select-none"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {/* Prev / Next controls */}
        {images.length > 1 && (
          <>
            <button
              aria-label="Previous image"
              onClick={goPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              ‹
            </button>
            <button
              aria-label="Next image"
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white w-9 h-9 grid place-items-center hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              ›
            </button>
          </>
        )}

        {/* Dots */}
        {images.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`h-2.5 w-2.5 rounded-full transition ${idx === i ? 'bg-primary-500 scale-110' : 'bg-black/30 hover:bg-black/50'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={'thumb-' + i}
              onClick={() => setIdx(i)}
              className={`h-16 w-16 rounded-lg border overflow-hidden shrink-0 focus:outline-none ${idx === i ? 'ring-2 ring-primary-400' : 'opacity-80 hover:opacity-100'}`}
            >
              <img src={src} alt={`Thumbnail ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Fixed zoom pane */}
      <div
        ref={zoomPaneRef}
        aria-hidden={!zooming}
        className={`hidden md:block fixed z-40 rounded-xl border bg-white/90 backdrop-blur shadow-xl overflow-hidden transition
                    ${zooming ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
        style={{
          backgroundPosition: '50% 50%',
          backgroundSize: `${ZOOM * 100}%`,
        }}
      />
    </div>
  );
}
