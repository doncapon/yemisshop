import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

/* ---------------- Types ---------------- */
type Brand = { id: string; name: string } | null;

type VariantOptionWire = {
  attribute?: { id: string; name: string; type?: string };
  attributeId?: string;
  value?: { id: string; name: string; code?: string | null; priceBump?: number | null };
  valueId?: string;
  attributeValueId?: string;
  priceBump?: number | null;
  bump?: number | null;
  priceDelta?: number | null;
  delta?: number | null;
};

type VariantWire = {
  id: string;
  sku?: string | null;
  price?: number | null;
  inStock?: boolean;
  imagesJson?: string[];
  options?: VariantOptionWire[];
};

type ProductWire = {
  id: string;
  title: string;
  description?: string;
  price: number | null;
  inStock?: boolean;
  imagesJson?: string[];
  brand?: Brand;
  variants?: VariantWire[];
};

/* ---------------- Helpers ---------------- */
const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const toNum = (n: any, d = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
};

function idOfOption(o: VariantOptionWire) {
  const a = o.attributeId ?? o.attribute?.id ?? "";
  const v = o.valueId ?? o.attributeValueId ?? o.value?.id ?? "";
  return { a: String(a), v: String(v) };
}

function pickBump(o: VariantOptionWire) {
  const fromOption = o.priceBump ?? o.bump ?? o.priceDelta ?? o.delta ?? null;
  const fromValue = o.value?.priceBump ?? null;
  const bump = fromOption != null ? fromOption : fromValue;
  return toNum(bump, 0);
}

// Build map: attributeId -> valueId -> bump (fallback)
function buildBumpMap(variants: VariantWire[]) {
  const map: Record<string, Record<string, number>> = {};
  for (const v of variants || []) {
    for (const o of v.options || []) {
      const { a, v: val } = idOfOption(o);
      if (!a || !val) continue;
      const bump = pickBump(o);
      if (!map[a]) map[a] = {};
      if (map[a][val] == null) map[a][val] = bump;
    }
  }
  return map;
}

// Sum bumps from a specific variant for current selected
function sumBumpsFromVariant(variant: VariantWire, selected: Record<string, string>) {
  let sum = 0;
  for (const o of variant.options || []) {
    const aid = String(o.attributeId ?? o.attribute?.id ?? "");
    const vid = String(o.valueId ?? o.attributeValueId ?? o.value?.id ?? "");
    if (!aid || !vid) continue;
    if (selected[aid] !== vid) continue;
    sum += pickBump(o);
  }
  return sum;
}

type CartItemLite = {
  productId: string;
  variantId: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions?: { attributeId: string; attribute: string; valueId?: string; value: string }[];
  image?: string;
};

const CART_KEY = "cart";
const loadCartLS = (): CartItemLite[] => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const saveCartLS = (items: CartItemLite[]) => localStorage.setItem(CART_KEY, JSON.stringify(items));

const sameLine = (a: CartItemLite, productId: string, variantId: string | null) =>
  a.productId === productId && (a.variantId ?? null) === (variantId ?? null);

const buildLabelMaps = (
  axes: Array<{ id: string; name: string; values: Array<{ id: string; name: string }> }>
) => {
  const attrNameById = new Map<string, string>();
  const valueNameByAttrId = new Map<string, Map<string, string>>();
  for (const a of axes) {
    attrNameById.set(a.id, a.name);
    const map = new Map<string, string>();
    for (const v of a.values) map.set(v.id, v.name);
    valueNameByAttrId.set(a.id, map);
  }
  return { attrNameById, valueNameByAttrId };
};

/* ---------------- Component ---------------- */
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const productQ = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}`, {
        params: { include: "brand,variants,attributes,offers" },
      });
      const p = data?.data ?? data ?? {};

      const variantsSrc = Array.isArray(p.variants) ? p.variants : p.ProductVariant ?? [];
      const variants: VariantWire[] = variantsSrc.map((v: any) => ({
        id: v.id,
        sku: v.sku ?? null,
        price: v.price != null ? Number(v.price) : null,
        inStock: v.inStock !== false,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        options: Array.isArray(v.options)
          ? v.options.map((o: any) => ({
              attributeId: o.attributeId ?? o.attribute?.id,
              attribute: o.attribute
                ? {
                    id: o.attribute.id,
                    name: o.attribute.name,
                    type: o.attribute.type,
                  }
                : undefined,
              valueId: o.valueId ?? o.attributeValueId ?? o.value?.id,
              attributeValueId: o.attributeValueId,
              value: o.value
                ? {
                    id: o.value.id,
                    name: o.value.name,
                    code: o.value.code ?? null,
                    priceBump: o.value.priceBump ?? null,
                  }
                : undefined,
              priceBump: o.priceBump ?? o.bump ?? o.priceDelta ?? o.delta ?? null,
            }))
          : [],
      }));

      const product: ProductWire = {
        id: p.id,
        title: p.title,
        description: p.description,
        price: p.price != null ? Number(p.price) : 0,
        inStock: p.inStock !== false,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        brand: p.brand ?? (p.brandName ? { id: p.brandId, name: p.brandName } : null),
        variants,
      };

      return product;
    },
    staleTime: 60_000,
  });

  const product = productQ.data;

  // Axes from all variants
  const axes = React.useMemo(() => {
    if (!product)
      return [] as Array<{
        id: string;
        name: string;
        values: Array<{ id: string; name: string }>;
      }>;

    const names = new Map<string, string>();
    const valuesByAttr = new Map<string, Map<string, string>>();

    for (const v of product.variants || []) {
      for (const o of v.options || []) {
        const aId = String(o.attributeId ?? o.attribute?.id ?? "");
        const vId = String(o.valueId ?? o.attributeValueId ?? o.value?.id ?? "");
        if (!aId || !vId) continue;

        if (!names.has(aId)) names.set(aId, String(o.attribute?.name ?? "Attribute"));
        if (!valuesByAttr.has(aId)) valuesByAttr.set(aId, new Map());
        if (!valuesByAttr.get(aId)!.has(vId)) {
          valuesByAttr.get(aId)!.set(vId, String(o.value?.name ?? "Value"));
        }
      }
    }

    const out: Array<{
      id: string;
      name: string;
      values: Array<{ id: string; name: string }>;
    }> = [];

    for (const [attrId, vmap] of valuesByAttr.entries()) {
      out.push({
        id: attrId,
        name: names.get(attrId) || "Attribute",
        values: Array.from(vmap.entries()).map(([id, name]) => ({ id, name })),
      });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [product]);

  // Selection state (defaults from a real variant)
  const [selected, setSelected] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!product || !axes.length) {
      setSelected({});
      return;
    }

    const variants = product.variants || [];
    const initialVariant =
      variants.find((v) => v.inStock !== false) || variants[0];

    setSelected((prev) => {
      // If user already has a full valid selection, keep it
      const hasAll = axes.every((a) => !!prev[a.id]);
      if (hasAll) return prev;

      const next: Record<string, string> = { ...prev };

      if (initialVariant && Array.isArray(initialVariant.options)) {
        for (const axis of axes) {
          if (next[axis.id]) continue; // don't override existing
          const match = initialVariant.options.find((o) => {
            const aId = String(o.attributeId ?? o.attribute?.id ?? "");
            return aId === axis.id;
          });
          if (match) {
            const vId = String(
              match.valueId ??
                match.attributeValueId ??
                match.value?.id ??
                ""
            );
            if (vId) {
              next[axis.id] = vId;
            }
          }
        }
      }

      // Ensure all axes exist; fallback to ""
      for (const axis of axes) {
        if (!next[axis.id]) next[axis.id] = "";
      }

      return next;
    });
  }, [axes, product]);

  const bumpMap = React.useMemo(
    () => buildBumpMap(product?.variants || []),
    [product]
  );

  // Variant pair sets for matching
  const variantPairSets = React.useMemo(() => {
    const arr: { v: VariantWire; set: Set<string> }[] = [];
    for (const v of product?.variants || []) {
      const s = new Set<string>();
      for (const o of v.options || []) {
        const { a, v: val } = idOfOption(o);
        if (!a || !val) continue;
        s.add(`${a}:${val}`);
      }
      arr.push({ v, set: s });
    }
    return arr;
  }, [product]);

  // Dependent option filtering
  const getFilteredValuesForAttribute = React.useCallback(
    (attrId: string) => {
      const axis = axes.find((a) => a.id === attrId);
      if (!axis) return [];

      const otherPairs = Object.entries(selected)
        .filter(([aid, vid]) => aid !== attrId && !!vid)
        .map(([aid, vid]) => `${aid}:${vid}`);

      if (!otherPairs.length) return axis.values;

      const possibleValueIds = new Set<string>();

      for (const { v, set } of variantPairSets) {
        let ok = true;
        for (const p of otherPairs) {
          if (!set.has(p)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        for (const o of v.options || []) {
          const { a, v: val } = idOfOption(o);
          if (a === attrId && val) {
            possibleValueIds.add(val);
          }
        }
      }

      if (!possibleValueIds.size) {
        // impossible combo → allow all to let user recover
        return axis.values;
      }

      return axis.values.filter((v) => possibleValueIds.has(v.id));
    },
    [axes, selected, variantPairSets]
  );

  const selectedPairs = React.useMemo(
    () =>
      Object.entries(selected)
        .filter(([, v]) => !!v)
        .map(([aid, vid]) => `${aid}:${vid}`),
    [selected]
  );

  const compatibleVariants = React.useMemo(() => {
    if (!selectedPairs.length) return product?.variants || [];
    return variantPairSets
      .filter(({ set }) => selectedPairs.every((p) => set.has(p)))
      .map(({ v }) => v) as VariantWire[];
  }, [variantPairSets, selectedPairs, product]);

  // Price computation
  const computed = React.useMemo(() => {
    if (!product) {
      return {
        base: 0,
        bumpSum: 0,
        final: 0,
        source: "base" as "base" | "bumps" | "variant",
        matchedVariant: null as VariantWire | null,
      };
    }

    // base price (fallback to min variant)
    let base = product.price != null ? toNum(product.price, 0) : NaN;
    if (!Number.isFinite(base)) {
      const vs = (product.variants || [])
        .map((v) => toNum(v.price, NaN))
        .filter((n) => Number.isFinite(n));
      const minV = vs.length ? Math.min(...vs) : NaN;
      base = Number.isFinite(minV) ? minV : 0;
    }

    const pickedCount = Object.values(selected).filter(Boolean).length;
    if (pickedCount === 0) {
      return { base, bumpSum: 0, final: base, source: "base", matchedVariant: null };
    }

    // Unique compatible variant
    if (compatibleVariants.length === 1) {
      const only = compatibleVariants[0];
      if (only?.price != null) {
        return {
          base,
          bumpSum: 0,
          final: toNum(only.price, base),
          source: "variant",
          matchedVariant: only,
        };
      }
      const vBumps = sumBumpsFromVariant(only, selected);
      return {
        base,
        bumpSum: vBumps,
        final: base + vBumps,
        source: "variant",
        matchedVariant: only,
      };
    }

    // Multiple variants: base + bumps from bumpMap
    let bumpSum = 0;
    for (const [aid, vid] of Object.entries(selected)) {
      if (!vid) continue;
      const perAttr = bumpMap[aid];
      if (!perAttr) continue;
      bumpSum += toNum(perAttr[vid], 0);
    }
    return {
      base,
      bumpSum,
      final: base + bumpSum,
      source: "bumps",
      matchedVariant: null,
    };
  }, [product, selected, bumpMap, compatibleVariants]);

  /* ---------------- Add to cart + toast ---------------- */
  const [toast, setToast] = React.useState<{ show: boolean; title: string; img?: string } | null>(
    null
  );
  const hideToastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddToCart = React.useCallback(async () => {
    if (!product) return;

    const selectedOptionsWire = Object.entries(selected)
      .filter(([, v]) => !!v)
      .map(([attributeId, valueId]) => ({ attributeId, valueId }));

    const variantId = computed.matchedVariant?.id ?? null;

    // server cart
    try {
      await api.post("/api/cart/items", {
        productId: product.id,
        variantId,
        quantity: 1,
        selectedOptions: selectedOptionsWire,
        unitPriceClient: computed.final,
      });
    } catch {
      // ignore; still update local
    } finally {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
    }

    // local cart
    const { attrNameById, valueNameByAttrId } = buildLabelMaps(axes);
    const selectedOptionsLabeled = selectedOptionsWire.map(({ attributeId, valueId }) => ({
      attributeId,
      attribute: attrNameById.get(attributeId) ?? "",
      valueId,
      value: valueId ? valueNameByAttrId.get(attributeId)?.get(valueId) ?? "" : "",
    }));

    const newLine: CartItemLite = {
      productId: product.id,
      variantId,
      title: product.title ?? "",
      qty: 1,
      unitPrice: Number(computed.final) || 0,
      totalPrice: Number(computed.final) || 0,
      selectedOptions: selectedOptionsLabeled,
      image: (product.imagesJson || [])[0],
    };

    const cart = loadCartLS();
    const idx = cart.findIndex((c) => sameLine(c, newLine.productId, newLine.variantId));
    if (idx >= 0) {
      const unit = Number.isFinite(cart[idx].unitPrice) ? cart[idx].unitPrice : newLine.unitPrice;
      const nextQty = cart[idx].qty + 1;
      cart[idx] = {
        ...cart[idx],
        qty: nextQty,
        unitPrice: unit,
        totalPrice: unit * nextQty,
      };
    } else {
      cart.push(newLine);
    }
    saveCartLS(cart);

    setToast({
      show: true,
      title: "Added to cart",
      img: (product.imagesJson || [])[0],
    });

    if (hideToastRef.current) window.clearTimeout(hideToastRef.current);
    hideToastRef.current = window.setTimeout(
      () => setToast((t) => (t ? { ...t, show: false } : t)),
      3000
    );
  }, [product, selected, computed.final, computed.matchedVariant, axes, queryClient]);

  React.useEffect(
    () => () => {
      if (hideToastRef.current) {
        clearTimeout(hideToastRef.current);
        hideToastRef.current = null;
      }
    },
    []
  );

  /* ---------------- IMAGES / ZOOM ---------------- */
  const images = React.useMemo(
    () => (product?.imagesJson?.length ? product.imagesJson : ["/placeholder.svg"]),
    [product]
  );

  const [mainIndex, setMainIndex] = React.useState(0);
  React.useEffect(() => setMainIndex(0), [product?.id]);

  const [paused, setPaused] = React.useState(false);
  React.useEffect(() => {
    if (paused || images.length < 2) return;
    const id = setInterval(() => setMainIndex((i) => (i + 1) % images.length), 4000);
    return () => clearInterval(id);
  }, [paused, images.length]);

  const [thumbStart, setThumbStart] = React.useState(0);
  const maxThumbStart = Math.max(images.length - 3, 0);
  React.useEffect(() => {
    if (mainIndex < thumbStart) setThumbStart(mainIndex);
    else if (mainIndex > thumbStart + 2)
      setThumbStart(Math.min(mainIndex - 2, maxThumbStart));
  }, [mainIndex, thumbStart, maxThumbStart]);

  const visibleThumbs = images.slice(thumbStart, thumbStart + 3);

  const mainImgRef = React.useRef<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = React.useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = React.useState({ w: 0, h: 0 });
  const [hoverPx, setHoverPx] = React.useState({ x: 0, y: 0 });
  const [showZoom, setShowZoom] = React.useState(false);

  const ZOOM_REQUEST = 2.5;
  const ZOOM_PANE = { w: 360, h: 360 };

  React.useLayoutEffect(() => {
    const img = mainImgRef.current;
    if (!img) return;
    const update = () => setImgBox({ w: img.clientWidth, h: img.clientHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(img);
    return () => obs.disconnect();
  }, [mainIndex]);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setImgBox({ w: img.clientWidth, h: img.clientHeight });
  }

  function onMouseMove(e: React.MouseEvent) {
    const img = mainImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setHoverPx({ x, y });
  }

  const maxScaleW = naturalSize.w > 0 && imgBox.w > 0 ? naturalSize.w / imgBox.w : 1;
  const maxScaleH = naturalSize.h > 0 && imgBox.h > 0 ? naturalSize.h / imgBox.h : 1;
  const MAX_NATIVE_SCALE = Math.max(1, Math.min(maxScaleW || 1, maxScaleH || 1));
  const EFFECTIVE_ZOOM = Math.max(1, Math.min(ZOOM_REQUEST, MAX_NATIVE_SCALE));

  const zoomImgWidth = imgBox.w * EFFECTIVE_ZOOM;
  const zoomImgHeight = imgBox.h * EFFECTIVE_ZOOM;
  const offsetX = Math.max(
    Math.min(hoverPx.x * EFFECTIVE_ZOOM - ZOOM_PANE.w / 2, zoomImgWidth - ZOOM_PANE.w),
    0
  );
  const offsetY = Math.max(
    Math.min(hoverPx.y * EFFECTIVE_ZOOM - ZOOM_PANE.h / 2, zoomImgHeight - ZOOM_PANE.h),
    0
  );

  /* ---------------- Render ---------------- */
  if (productQ.isLoading) {
    return <div className="p-6">Loading product…</div>;
  }

  if (productQ.isError || !product) {
    return (
      <div className="p-6 text-rose-600">
        Could not load product.
        <div className="text-xs opacity-70 mt-1">
          {String((productQ.error as any)?.message || "Unknown error")}
        </div>
      </div>
    );
  }

  const priceLabel = NGN.format(computed.final);

  return (
    <>
      {/* Toast */}
      {toast?.show && (
        <div
          className="fixed top-4 right-4 z-[60] w-[320px] rounded-xl border shadow-lg bg-white p-3"
          onMouseEnter={() => {
            if (hideToastRef.current) window.clearTimeout(hideToastRef.current);
          }}
          onMouseLeave={() => {
            hideToastRef.current = window.setTimeout(
              () => setToast((t) => (t ? { ...t, show: false } : t)),
              1500
            );
          }}
        >
          <div className="flex gap-3">
            <img
              src={toast.img || "/placeholder.svg"}
              alt="item"
              className="w-14 h-14 rounded-md border object-cover"
            />
            <div className="flex-1">
              <div className="text-sm font-semibold">{toast.title}</div>
              <div className="text-xs text-zinc-600 truncate">{product.title}</div>
              <div className="mt-1 text-sm font-medium">{priceLabel}</div>
              <div className="mt-2 flex gap-2">
                <button
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white text-xs"
                  onClick={() => navigate("/cart")}
                >
                  View cart
                </button>
                <button
                  className="px-3 py-1.5 rounded-lg border text-xs hover:bg-zinc-50"
                  onClick={() =>
                    setToast((t) => (t ? { ...t, show: false } : t))
                  }
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Images */}
        <div className="space-y-3">
          <div
            className="relative mx-auto"
            style={{ maxWidth: "90%" }}
            onMouseEnter={() => {
              setShowZoom(true);
              setPaused(true);
            }}
            onMouseLeave={() => {
              setShowZoom(false);
              setPaused(false);
            }}
            onMouseMove={onMouseMove}
          >
            <div
              className="rounded-2xl overflow-hidden bg-zinc-100 border"
              style={{ aspectRatio: "1 / 1" }}
            >
              <img
                ref={mainImgRef}
                src={images[mainIndex]}
                alt={product.title}
                className="w-full h-full object-cover cursor-zoom-in"
                onLoad={handleImageLoad}
                onError={(e) => (e.currentTarget.style.opacity = "0.25")}
              />
            </div>

            {showZoom && (
              <div
                className="hidden md:block absolute top-0 translate-x-3 rounded-xl border shadow bg-white overflow-hidden"
                style={{ left: "100%", width: ZOOM_PANE.w, height: ZOOM_PANE.h }}
              >
                <img
                  src={images[mainIndex]}
                  alt="zoom"
                  draggable={false}
                  style={{
                    position: "absolute",
                    width: `${zoomImgWidth}px`,
                    height: `${zoomImgHeight}px`,
                    transform: `translate(${-offsetX}px, ${-offsetY}px)`,
                  }}
                />
              </div>
            )}

            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setMainIndex((i) => (i - 1 + images.length) % images.length)
                  }
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 hover:bg-white border shadow px-2 py-1"
                  aria-label="Previous image"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setMainIndex((i) => (i + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 hover:bg-white border shadow px-2 py-1"
                  aria-label="Next image"
                >
                  ›
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {images.map((_, i) => (
                    <span
                      key={i}
                      onClick={() => setMainIndex(i)}
                      className={`h-1.5 w-1.5 rounded-full cursor-pointer ${
                        i === mainIndex ? "bg-fuchsia-600" : "bg-white/70 border"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Thumbnails */}
          <div
            className="flex items-center justify-center gap-2"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <button
              type="button"
              onClick={() =>
                setMainIndex((i) => (i - 1 + images.length) % images.length)
              }
              className="rounded-full border px-2 py-1 text-sm bg-white hover:bg-zinc-50"
              aria-label="Previous thumbnails"
            >
              ‹
            </button>

            <div className="flex gap-2">
              {visibleThumbs.map((u, i) => {
                const absoluteIndex = thumbStart + i;
                const isActive = absoluteIndex === mainIndex;
                return (
                  <img
                    key={`${u}:${absoluteIndex}`}
                    src={u}
                    alt={`thumb-${absoluteIndex}`}
                    onClick={() => setMainIndex(absoluteIndex)}
                    className={`w-24 h-20 rounded-lg border object-cover select-none cursor-pointer ${
                      isActive
                        ? "ring-2 ring-fuchsia-500 border-fuchsia-500"
                        : "hover:opacity-90"
                    }`}
                    onError={(e) => (e.currentTarget.style.opacity = "0.25")}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={() =>
                setMainIndex((i) => (i + 1) % images.length)
              }
              className="rounded-full border px-2 py-1 text-sm bg-white hover:bg-zinc-50"
              aria-label="Next thumbnails"
            >
              ›
            </button>
          </div>

          {images.length > 3 && (
            <div className="text-center text-xs text-zinc-600">
              {Math.min(thumbStart + 1, images.length)}-
              {Math.min(thumbStart + 3, images.length)} / {images.length}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">{product.title}</h1>
            {product.brand?.name && (
              <div className="text-sm text-zinc-600">{product.brand.name}</div>
            )}
          </div>

          <div className="rounded-2xl bg-zinc-50 border p-4">
            <div className="text-sm text-zinc-500">Current price</div>
            <div className="text-3xl font-bold">{priceLabel}</div>
            <div className="text-xs text-zinc-500 mt-1">
              {computed.source === "base" && <>Base: {NGN.format(computed.base)}</>}
              {computed.source === "variant" && <>Derived from matching variant</>}
              {computed.source === "bumps" && (
                <>
                  Base + selected bumps: {NGN.format(computed.base)} +{" "}
                  {NGN.format(computed.bumpSum)}
                </>
              )}
            </div>
          </div>

          {/* Variant selects (dependent values) */}
          <div className="space-y-3">
            {axes.length === 0 && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No variant options were provided. Ensure your API includes{" "}
                <code>variants.options</code>.
              </div>
            )}

            {axes.map((a) => {
              const filteredValues = getFilteredValuesForAttribute(a.id);

              // Keep selected value visible even if now invalid, so user can change
              const hasSelected =
                selected[a.id] &&
                filteredValues.some((v) => v.id === selected[a.id]);
              const valuesToRender =
                hasSelected || !selected[a.id]
                  ? filteredValues
                  : [
                      ...filteredValues,
                      ...a.values.filter((v) => v.id === selected[a.id]),
                    ];

              return (
                <div key={a.id} className="grid gap-1">
                  <label className="text-xs font-medium text-zinc-700">
                    {a.name}
                  </label>
                  <select
                    className="border rounded-lg px-3 py-2 w-full bg-white"
                    value={selected[a.id] ?? ""}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        [a.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">
                      {`No ${a.name.toLowerCase()}`}
                    </option>
                    {valuesToRender.map((v) => {
                      const bump = bumpMap?.[a.id]?.[v.id];
                      const label =
                        bump && bump !== 0
                          ? `${v.name} (${bump > 0 ? "+" : ""}${NGN.format(
                              bump
                            )})`
                          : v.name;
                      return (
                        <option key={v.id} value={v.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );
            })}
          </div>

          {/* CTAs */}
          <div className="pt-2 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleAddToCart}
              className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white shadow-sm hover:shadow-md active:scale-[0.99] transition focus:outline-none focus:ring-4 focus:ring-fuchsia-300/40"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              Add to cart — {priceLabel}
            </button>

            <button
              type="button"
              onClick={() => navigate("/cart")}
              className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 border bg-white text-zinc-900 hover:bg-zinc-50 active:scale-[0.99] transition focus:outline-none focus:ring-4 focus:ring-zinc-300/40"
            >
              Go to Cart
            </button>
          </div>

          {/* Description */}
          <div className="pt-2">
            <h2 className="text-base font-semibold mb-1">Description</h2>
            <p className="text-sm text-zinc-700 whitespace-pre-line">
              {product.description}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
