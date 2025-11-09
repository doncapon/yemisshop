import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

/* ---------------- Types ---------------- */
type Brand = { id: string; name: string } | null;

type VariantOptionWire = {
  attribute?: { id: string; name: string; type?: string };
  attributeId?: string;
  value?: {
    id: string;
    name: string;
    code?: string | null;
    priceBump?: number | null;
  };
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

const truthy = (v: any, def = true) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|1|yes|y)$/i.test(v.trim());
  if (v == null) return def;
  return Boolean(v);
};

const availOfOffer = (o: any) => {
  const n = Number(
    o?.availableQty ?? o?.available ?? o?.qty ?? o?.stock ?? 0
  );
  return Number.isFinite(n) ? n : 0;
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

// Interpret bumps as "combo bump" for this variant.
// If multiple bumps are present, we take the last non-zero one.
// (Adjust to "first" if that matches your backend convention.)
function getComboBump(v: VariantWire): number {
  let bump = 0;
  for (const o of v.options || []) {
    const b = pickBump(o);
    if (b !== 0) bump = b;
  }
  return bump;
}


/* Cart helpers */
type CartItemLite = {
  productId: string;
  variantId: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions?: {
    attributeId: string;
    attribute: string;
    valueId?: string;
    value: string;
  }[];
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

const saveCartLS = (items: CartItemLite[]) =>
  localStorage.setItem(CART_KEY, JSON.stringify(items));

const sameLine = (
  a: CartItemLite,
  productId: string,
  variantId: string | null
) => a.productId === productId && (a.variantId ?? null) === (variantId ?? null);

const buildLabelMaps = (
  axes: Array<{
    id: string;
    name: string;
    values: Array<{ id: string; name: string }>;
  }>
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

      const variantsSrc = Array.isArray(p.variants)
        ? p.variants
        : p.ProductVariant ?? [];

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
            priceBump:
              o.priceBump ??
              o.bump ??
              o.priceDelta ??
              o.delta ??
              null,
          }))
          : [],
      }));

      const offersSrc =
        (Array.isArray(p.offers) && p.offers) ||
        (Array.isArray(p.supplierOffers) && p.supplierOffers) ||
        (Array.isArray(p.SupplierOffer) && p.SupplierOffer) ||
        [];

      const sellableVariantIds = new Set<string>();
      const stockByVariantId: Record<string, number> = {};

      for (const raw of offersSrc as any[]) {
        const vidRaw =
          raw.variantId ??
          raw.variant_id ??
          (typeof raw.variant === "string"
            ? raw.variant
            : raw.variant?.id);
        if (!vidRaw) continue;
        if (!truthy(raw.isActive, true)) continue;

        const available = availOfOffer(raw);
        if (available <= 0) continue;

        const vid = String(vidRaw);
        sellableVariantIds.add(vid);
        stockByVariantId[vid] =
          (stockByVariantId[vid] ?? 0) + available;
      }

      const filteredVariants =
        sellableVariantIds.size > 0
          ? variants.filter((v) => sellableVariantIds.has(v.id))
          : variants; // fallback so page isn't empty

      const product: ProductWire = {
        id: p.id,
        title: p.title,
        description: p.description,
        price: p.price != null ? Number(p.price) : null,
        inStock: p.inStock !== false,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        brand:
          p.brand ??
          (p.brandName ? { id: p.brandId, name: p.brandName } : null),
        variants: filteredVariants,
      };

      return { product, stockByVariantId };
    },
    staleTime: 60_000,
  });

  const product = productQ.data?.product;
  const stockByVariantId =
    productQ.data?.stockByVariantId ?? {};

  /* ---------------- Axes from sellable variants ---------------- */
  const axes = React.useMemo(() => {
    if (!product) return [];

    const names = new Map<string, string>();
    const valuesByAttr = new Map<string, Map<string, string>>();

    for (const v of product.variants || []) {
      for (const o of v.options || []) {
        const aId = String(o.attributeId ?? o.attribute?.id ?? "");
        const vId = String(
          o.valueId ?? o.attributeValueId ?? o.value?.id ?? ""
        );
        if (!aId || !vId) continue;

        if (!names.has(aId))
          names.set(aId, String(o.attribute?.name ?? "Attribute"));
        if (!valuesByAttr.has(aId)) valuesByAttr.set(aId, new Map());
        if (!valuesByAttr.get(aId)!.has(vId)) {
          valuesByAttr.get(aId)!.set(
            vId,
            String(o.value?.name ?? "Value")
          );
        }
      }
    }

    const out: {
      id: string;
      name: string;
      values: { id: string; name: string }[];
    }[] = [];

    for (const [attrId, vmap] of valuesByAttr.entries()) {
      out.push({
        id: attrId,
        name: names.get(attrId) || "Attribute",
        values: Array.from(vmap.entries()).map(([id, name]) => ({
          id,
          name,
        })),
      });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [product]);

  /* ---------------- Variant pair sets ---------------- */
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


  /* ---------------- Selection state ---------------- */
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
      const next: Record<string, string> = { ...prev };

      // If we already have a full valid selection, keep it
      const entries = Object.entries(next).filter(([, v]) => !!v);
      const hasAllAxes = axes.every((a) => !!next[a.id]);
      const stillValid =
        entries.length > 0 &&
        variantPairSets.some(({ set }) =>
          entries.every(([aid, vid]) => set.has(`${aid}:${vid}`))
        );
      if (hasAllAxes && stillValid) return next;

      if (initialVariant?.options?.length) {
        for (const axis of axes) {
          if (next[axis.id]) continue;
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
            if (vId) next[axis.id] = vId;
          }
        }
      }

      for (const axis of axes) {
        if (!next[axis.id]) next[axis.id] = "";
      }

      return next;
    });
  }, [product, axes, variantPairSets]);

  const comboAvailability = React.useMemo(() => {
    if (!variantPairSets.length) return 0;

    const picked = Object.entries(selected).filter(([, v]) => !!v);

    // No selection: total across all variants
    if (!picked.length) {
      let total = 0;
      for (const { v } of variantPairSets) {
        total += stockByVariantId[v.id] ?? 0;
      }
      return total;
    }

    const selectedPairs = picked.map(([aid, vid]) => `${aid}:${vid}`);

    let total = 0;
    for (const { v, set } of variantPairSets) {
      const matches = selectedPairs.every((p) => set.has(p));
      if (matches) {
        total += stockByVariantId[v.id] ?? 0;
      }
    }

    return total;
  }, [selected, variantPairSets, stockByVariantId]);

  const isSelectionCompatible = React.useCallback(
    (draft: Record<string, string>) => {
      const entries = Object.entries(draft).filter(([, v]) => !!v);
      if (!entries.length) return true;
      return variantPairSets.some(({ set }) =>
        entries.every(([aid, vid]) => set.has(`${aid}:${vid}`))
      );
    },
    [variantPairSets]
  );

  /* Filter values so only valid continuations are shown */
  const getFilteredValuesForAttribute = React.useCallback(
    (attrId: string) => {
      const axis = axes.find((a) => a.id === attrId);
      if (!axis) return [];

      const otherPairs = Object.entries(selected)
        .filter(([aid, vid]) => aid !== attrId && !!vid)
        .map(([aid, vid]) => `${aid}:${vid}`);

      if (!otherPairs.length) return axis.values;

      const possible = new Set<string>();

      for (const { set } of variantPairSets) {
        let ok = true;
        for (const p of otherPairs) {
          if (!set.has(p)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        for (const pair of set) {
          const [aid, vid] = pair.split(":");
          if (aid === attrId && vid) possible.add(vid);
        }
      }

      if (!possible.size) return [];

      return axis.values.filter((v) => possible.has(v.id));
    },
    [axes, selected, variantPairSets]
  );

  const selectionInfo = React.useMemo(() => {
    if (!product || !variantPairSets.length) {
      return {
        picked: [] as Array<[string, string]>,
        exact: [] as VariantWire[],
        supers: [] as { v: VariantWire; missingAttrIds: Set<string> }[],
        totalStockExact: 0,
        missingAxisIds: new Set<string>(),
      };
    }

    const picked = Object.entries(selected).filter(([, v]) => !!v);
    const pickedAttrIds = new Set(picked.map(([aid]) => aid));
    const selPairs = new Set(
      picked.map(([aid, vid]) => `${aid}:${vid}`)
    );

    // Special case: no selection.
    if (!picked.length) {
      // exact-empty = variants with no options at all (pure simple variants)
      const exactEmpty = variantPairSets
        .filter(({ set }) => set.size === 0)
        .map(({ v }) => v);

      let totalStockExact = 0;
      for (const v of exactEmpty) {
        totalStockExact += stockByVariantId[v.id] ?? 0;
      }

      return {
        picked,
        exact: exactEmpty,
        supers: [],
        totalStockExact,
        missingAxisIds: new Set<string>(),
      };
    }

    const exact: VariantWire[] = [];
    const supers: { v: VariantWire; missingAttrIds: Set<string> }[] = [];

    for (const { v, set } of variantPairSets) {
      // Check if current selection is subset of this variant’s pairs
      let isSuperset = true;
      for (const p of selPairs) {
        if (!set.has(p)) {
          isSuperset = false;
          break;
        }
      }
      if (!isSuperset) continue;

      if (set.size === selPairs.size) {
        // Selection matches this variant EXACTLY
        exact.push(v);
      } else {
        // Selection is a strict subset -> user still missing some attributes
        const missing = new Set<string>();
        for (const pair of set) {
          const [aid] = pair.split(":");
          if (!pickedAttrIds.has(aid)) {
            missing.add(aid);
          }
        }
        supers.push({ v, missingAttrIds: missing });
      }
    }

    let totalStockExact = 0;
    for (const v of exact) {
      totalStockExact += stockByVariantId[v.id] ?? 0;
    }

    // Union of all missing axes from supers (for hints)
    const missingAxisIds = new Set<string>();
    for (const s of supers) {
      s.missingAttrIds.forEach((id) => missingAxisIds.add(id));
    }

    return { picked, exact, supers, totalStockExact, missingAxisIds };
  }, [product, selected, variantPairSets, stockByVariantId]);

  /* ---------------- Pricing: base + cheapest bump among valid combos ---------------- */
  const computed = React.useMemo(() => {
    if (!product) {
      return {
        base: 0,
        bumpSum: 0,
        final: 0,
        matchedVariant: null as VariantWire | null,
      };
    }

    const variants = product.variants || [];

    // ---- Base price (unchanged logic) ----
    let base = toNum(product.price, NaN);

    if (!Number.isFinite(base) && variants.length) {
      let bestBase = Number.POSITIVE_INFINITY;
      for (const v of variants) {
        const vp = toNum(v.price, NaN);
        if (!Number.isFinite(vp)) continue;
        const comboBump = getComboBump(v);
        const candidate = vp - comboBump;
        if (candidate > 0 && candidate < bestBase) bestBase = candidate;
      }
      if (bestBase < Number.POSITIVE_INFINITY) base = bestBase;
    }

    if (!Number.isFinite(base) && variants.length) {
      let minV = Number.POSITIVE_INFINITY;
      for (const v of variants) {
        const vp = toNum(v.price, NaN);
        if (Number.isFinite(vp) && vp < minV) minV = vp;
      }
      if (minV < Number.POSITIVE_INFINITY) base = minV;
    }

    if (!Number.isFinite(base) || base < 0) base = 0;

    const { exact } = selectionInfo;

    // If we have one or more EXACT matching variants, use them.
    if (exact.length > 0) {
      let bestVariant: VariantWire | null = null;
      let bestFinal = Number.POSITIVE_INFINITY;
      let bestBump = 0;

      for (const v of exact) {
        const comboBump = getComboBump(v);
        let final: number;

        if (base > 0) {
          final = base + comboBump;
        } else {
          const vp = toNum(v.price, NaN);
          final = Number.isFinite(vp) ? vp : comboBump;
        }

        if (!Number.isFinite(final) || final <= 0) continue;

        if (final < bestFinal) {
          bestFinal = final;
          bestVariant = v;
          bestBump = comboBump > 0 ? comboBump : 0;
        }
      }

      if (bestVariant && Number.isFinite(bestFinal)) {
        return {
          base,
          bumpSum: bestBump,
          final: bestFinal,
          matchedVariant: bestVariant,
        };
      }
    }

    // No exact candidate (or could not price) -> show base only
    return {
      base,
      bumpSum: 0,
      final: base,
      matchedVariant: null,
    };
  }, [product, selectionInfo]);


  /* ---------------- Toast ---------------- */
  const [toast, setToast] = React.useState<{
    show: boolean;
    title: string;
    img?: string;
  } | null>(null);
  const hideToastRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  /* ---------------- Images / Zoom ---------------- */
  const images = React.useMemo(
    () =>
      product?.imagesJson?.length
        ? product.imagesJson!
        : ["/placeholder.svg"],
    [product]
  );

  const [mainIndex, setMainIndex] = React.useState(0);

  React.useEffect(() => {
    setMainIndex(0);
  }, [product?.id]);

  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused || images.length < 2) return;
    const idInt = setInterval(
      () => setMainIndex((i) => (i + 1) % images.length),
      4000
    );
    return () => clearInterval(idInt);
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
    const update = () =>
      setImgBox({ w: img.clientWidth, h: img.clientHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(img);
    return () => obs.disconnect();
  }, [mainIndex]);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setNaturalSize({
      w: img.naturalWidth,
      h: img.naturalHeight,
    });
    setImgBox({ w: img.clientWidth, h: img.clientHeight });
  }

  function onMouseMove(e: React.MouseEvent) {
    const img = mainImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(rect.width, e.clientX - rect.left)
    );
    const y = Math.max(
      0,
      Math.min(rect.height, e.clientY - rect.top)
    );
    setHoverPx({ x, y });
  }
  const hasBox = imgBox.w > 0 && imgBox.h > 0;

  // Ensure the zoomed image is at least big enough to cover the zoom pane:
  const requiredScaleToCover =
    hasBox
      ? Math.max(
        ZOOM_PANE.w / imgBox.w,
        ZOOM_PANE.h / imgBox.h
      )
      : 1;

  // Native-resolution-based max (for not over-zooming too hard based on real pixels)
  const maxScaleW =
    naturalSize.w > 0 && imgBox.w > 0
      ? naturalSize.w / imgBox.w
      : Infinity;
  const maxScaleH =
    naturalSize.h > 0 && imgBox.h > 0
      ? naturalSize.h / imgBox.h
      : Infinity;

  const MAX_NATIVE_SCALE = Math.max(1, Math.min(maxScaleW, maxScaleH));

  // Start with: don’t exceed your requested zoom or native capability
  let EFFECTIVE_ZOOM = Math.max(
    1,
    Math.min(ZOOM_REQUEST, MAX_NATIVE_SCALE)
  );

  // But: never let the zoomed image be smaller than the pane (fixes white edges).
  // If native is too small, we allow going a bit beyond native (slight blur > blank).
  if (hasBox) {
    const cover = Math.max(
      ZOOM_PANE.w / imgBox.w,
      ZOOM_PANE.h / imgBox.h
    );
    if (EFFECTIVE_ZOOM < cover) {
      EFFECTIVE_ZOOM = cover;
    }
  }

  const zoomImgWidth = (hasBox ? imgBox.w : 0) * EFFECTIVE_ZOOM;
  const zoomImgHeight = (hasBox ? imgBox.h : 0) * EFFECTIVE_ZOOM;

  // Mouse position as ratio over the main image
  const relX = hasBox ? hoverPx.x / imgBox.w : 0.5;
  const relY = hasBox ? hoverPx.y / imgBox.h : 0.5;

  // Max scroll inside zoom pane so we never expose background
  const maxOffsetX = Math.max(zoomImgWidth - ZOOM_PANE.w, 0);
  const maxOffsetY = Math.max(zoomImgHeight - ZOOM_PANE.h, 0);

  // Center the cursor point in the zoom pane, then clamp
  let offsetX = relX * zoomImgWidth - ZOOM_PANE.w / 2;
  let offsetY = relY * zoomImgHeight - ZOOM_PANE.h / 2;

  offsetX = Math.max(0, Math.min(offsetX, maxOffsetX));
  offsetY = Math.max(0, Math.min(offsetY, maxOffsetY));

  /* ---------------- Add to cart ---------------- */
  const handleAddToCart = React.useCallback(async () => {
    if (disableAddToCart) return;
    if (!product) return;

    const selectedOptionsWire = Object.entries(selected)
      .filter(([, v]) => !!v)
      .map(([attributeId, valueId]) => ({
        attributeId,
        valueId,
      }));

    const variantId = computed.matchedVariant?.id ?? null;

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

    const { attrNameById, valueNameByAttrId } =
      buildLabelMaps(axes);
    const selectedOptionsLabeled = selectedOptionsWire.map(
      ({ attributeId, valueId }) => ({
        attributeId,
        attribute: attrNameById.get(attributeId) ?? "",
        valueId,
        value: valueId
          ? valueNameByAttrId
            .get(attributeId)
            ?.get(valueId) ?? ""
          : "",
      })
    );

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
    const idx = cart.findIndex((c) =>
      sameLine(c, newLine.productId, newLine.variantId)
    );
    if (idx >= 0) {
      const unit = Number.isFinite(cart[idx].unitPrice)
        ? cart[idx].unitPrice
        : newLine.unitPrice;
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

    if (hideToastRef.current)
      window.clearTimeout(hideToastRef.current);
    hideToastRef.current = window.setTimeout(
      () =>
        setToast((t) =>
          t ? { ...t, show: false } : t
        ),
      3000
    );
  }, [
    product,
    selected,
    computed.final,
    computed.matchedVariant,
    axes,
    queryClient,
  ]);

  React.useEffect(
    () => () => {
      if (hideToastRef.current) {
        clearTimeout(hideToastRef.current);
        hideToastRef.current = null;
      }
    },
    []
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
          {String(
            (productQ.error as any)?.message ||
            "Unknown error"
          )}
        </div>
      </div>
    );
  }

  const priceLabel = NGN.format(computed.final);

  const hasVariantAxes = axes.length > 0;
  const {
    picked,
    exact,
    supers,
    totalStockExact,
    missingAxisIds,
  } = selectionInfo;

  let disableAddToCart = false;
  let helperNote: string | null = null;

  if (!hasVariantAxes || !variantPairSets.length) {
    // Simple product (no options)
    disableAddToCart = product.inStock === false;
  } else {
    if (!picked.length) {
      // User hasn't chosen anything; only allow if there's an exact empty-variant with stock
      if (!exact.length || totalStockExact <= 0) {
        disableAddToCart = true;
        helperNote =
          "Choose one of the available options to enable Add to cart.";
      }
    } else if (exact.length > 0) {
      // We have one or more exact matches
      if (totalStockExact <= 0) {
        disableAddToCart = true;
        helperNote =
          "This option is currently out of stock. Please try a different combination.";
      }
    } else if (supers.length > 0) {
      // Selection only appears as part of larger combos -> incomplete
      disableAddToCart = true;

      const missingNames = axes
        .filter((a) => missingAxisIds.has(a.id))
        .map((a) => a.name);

      if (missingNames.length) {
        helperNote = `This choice needs to be more specific. Please also select: ${missingNames.join(
          ", "
        )}.`;
      } else {
        helperNote =
          "This choice is incomplete. Please select the remaining options.";
      }
    } else {
      // No exact matches, no supers -> invalid combo
      disableAddToCart = true;
      helperNote =
        "This combination is not available. Try a different set of options.";
    }
  }

  return (
    <>
      {/* Toast */}
      {toast?.show && (
        <div
          className="fixed top-4 right-4 z-[60] w-[320px] rounded-xl border shadow-lg bg-white p-3"
          onMouseEnter={() => {
            if (hideToastRef.current)
              window.clearTimeout(hideToastRef.current);
          }}
          onMouseLeave={() => {
            hideToastRef.current = window.setTimeout(
              () =>
                setToast((t) =>
                  t
                    ? { ...t, show: false }
                    : t
                ),
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
              <div className="text-sm font-semibold">
                {toast.title}
              </div>
              <div className="text-xs text-zinc-600 truncate">
                {product.title}
              </div>
              <div className="mt-1 text-sm font-medium">
                {priceLabel}
              </div>
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
                    setToast((t) =>
                      t
                        ? { ...t, show: false }
                        : t
                    )
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
                onError={(e) =>
                (e.currentTarget.style.opacity =
                  "0.25")
                }
              />
            </div>

            {showZoom && hasBox && (
              <div
                className="hidden md:block absolute top-0 translate-x-3 rounded-xl border shadow bg-white overflow-hidden"
                style={{
                  left: "100%",
                  width: ZOOM_PANE.w,
                  height: ZOOM_PANE.h,
                }}
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
                    setMainIndex(
                      (i) =>
                        (i - 1 + images.length) %
                        images.length
                    )
                  }
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 hover:bg-white border shadow px-2 py-1"
                  aria-label="Previous image"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMainIndex(
                      (i) =>
                        (i + 1) %
                        images.length
                    )
                  }
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
                      className={`h-1.5 w-1.5 rounded-full cursor-pointer ${i === mainIndex
                        ? "bg-fuchsia-600"
                        : "bg-white/70 border"
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
                setMainIndex(
                  (i) =>
                    (i - 1 + images.length) %
                    images.length
                )
              }
              className="rounded-full border px-2 py-1 text-sm bg-white hover:bg-zinc-50"
              aria-label="Previous thumbnails"
            >
              ‹
            </button>

            <div className="flex gap-2">
              {visibleThumbs.map((u, i) => {
                const absoluteIndex =
                  thumbStart + i;
                const isActive =
                  absoluteIndex === mainIndex;
                return (
                  <img
                    key={`${u}:${absoluteIndex}`}
                    src={u}
                    alt={`thumb-${absoluteIndex}`}
                    onClick={() =>
                      setMainIndex(
                        absoluteIndex
                      )
                    }
                    className={`w-24 h-20 rounded-lg border object-cover select-none cursor-pointer ${isActive
                      ? "ring-2 ring-fuchsia-500 border-fuchsia-500"
                      : "hover:opacity-90"
                      }`}
                    onError={(e) =>
                    (e.currentTarget.style.opacity =
                      "0.25")
                    }
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={() =>
                setMainIndex(
                  (i) =>
                    (i + 1) %
                    images.length
                )
              }
              className="rounded-full border px-2 py-1 text-sm bg-white hover:bg-zinc-50"
              aria-label="Next thumbnails"
            >
              ›
            </button>
          </div>

          {images.length > 3 && (
            <div className="text-center text-xs text-zinc-600">
              {Math.min(
                thumbStart + 1,
                images.length
              )}
              -
              {Math.min(
                thumbStart + 3,
                images.length
              )}{" "}
              / {images.length}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">
              {product.title}
            </h1>
            {product.brand?.name && (
              <div className="text-sm text-zinc-600">
                {product.brand.name}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-zinc-50 border p-4">
            <div className="text-sm text-zinc-500">
              Current price
            </div>
            <div className="text-3xl font-bold">
              {priceLabel}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Base: {NGN.format(computed.base)}
              {computed.bumpSum > 0 && (
                <>
                  {" "}
                  • Selected combo: +
                  {NGN.format(computed.bumpSum)}
                </>
              )}
            </div>
          </div>

          {/* Variant selects */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-700">
                Choose options
              </div>

              <div className="flex items-center gap-2">
                <div className="text-[11px] text-zinc-600">
                  {selectionInfo.exact.length > 0 && selectionInfo.totalStockExact > 0
                    ? `Available: ${selectionInfo.totalStockExact}`
                    : axes.length
                      ? "Select a valid combination to see availability"
                      : ""}
                </div>

                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="px-2 py-1 text-[10px] rounded-lg border bg-white hover:bg-zinc-50"
                >
                  Clear options
                </button>
              </div>
            </div>


            {axes.length === 0 && (product.variants?.length ?? 0) > 0 && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No variant options were provided for the variants returned.
                Ensure your API includes <code>variants.options</code>.
              </div>
            )}


            {axes.map((a) => {
              const filteredValues = getFilteredValuesForAttribute(a.id);
              const current = selected[a.id] ?? "";
              const isValid = filteredValues.some((v) => v.id === current);
              const value = isValid ? current : "";

              return (
                <div key={a.id} className="grid gap-1">
                  <label className="text-xs font-medium text-zinc-700">
                    {a.name}
                  </label>
                  <select
                    className="border rounded-lg px-3 py-2 w-full bg-white"
                    value={value}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelected((prev) => {
                        const draft = { ...prev, [a.id]: val };
                        if (val === "" || isSelectionCompatible(draft)) {
                          return draft;
                        }
                        // invalid combo -> reset this axis only
                        return { ...prev, [a.id]: "" };
                      });
                    }}
                  >
                    <option value="">
                      {`No ${a.name.toLowerCase()}`}
                    </option>
                    {filteredValues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  {/* Helper notes */}
                  {helperNote && (
                    <div className="text-[11px] mt-1 px-2 py-1 rounded-md border bg-zinc-50 text-zinc-700">
                      {helperNote}
                    </div>
                  )}
                </div>
              );
            })}
          </div>


          {/* CTAs */}
          <div className="pt-2 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={disableAddToCart}
              className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 shadow-sm active:scale-[0.99] transition focus:outline-none focus:ring-4
                  ${disableAddToCart
                  ? "bg-zinc-300 text-zinc-600 cursor-not-allowed focus:ring-zinc-200"
                  : "bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white hover:shadow-md focus:ring-fuchsia-300/40"
                }`}
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
            <h2 className="text-base font-semibold mb-1">
              Description
            </h2>
            <p className="text-sm text-zinc-700 whitespace-pre-line">
              {product.description}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
