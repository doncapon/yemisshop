import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * SuppliersOfferManager.tsx
 *
 * ✅ Uses ONLY these endpoints (no fallbacks):
 *   GET    /api/admin/products/:productId/supplier-offers
 *   POST   /api/admin/products/:productId/supplier-offers
 *   PATCH  /api/admin/supplier-offers/:id         (id is base:<id> | variant:<id>)
 *   DELETE /api/admin/supplier-offers/:id         (id is base:<id> | variant:<id>)
 *
 * ✅ Uses ONLY fields that exist in your schema/routes unified DTO:
 *   id, kind, productId, supplierId, supplierName,
 *   variantId, variantSku,
 *   basePrice, priceBump, offerPrice,
 *   currency, availableQty, leadDays, isActive, inStock
 */

type Supplier = {
  id: string;
  name: string;
  status?: string;
};

type Variant = {
  id: string;
  sku?: string | null;
  label?: string;
};


type ProductResp = {
  data: {
    id: string;
    title?: string;
    sku?: string;
    retailPrice?: number | null; // backend may return retailPrice
    price?: number | null; // some product endpoints still return price alias; we don't rely on it
    variants?: Array<{ id: string; sku: string; label?: string }>;
    ProductVariant?: Array<{ id: string; sku: string; label?: string }>;
    productVariants?: Array<{ id: string; sku: string; label?: string }>;
  };
};

type OfferKind = "BASE" | "VARIANT";

type OfferApi = {
  id: string; // "base:..." or "variant:..."
  kind: OfferKind;

  productId: string;

  supplierId: string;
  supplierName?: string;

  variantId: string | null;
  variantSku?: string | null;

  basePrice: number; // BASE: basePrice, VARIANT: basePrice for supplier (provided by API)
  priceBump: number; // VARIANT only (0 for BASE)

  offerPrice: number; // computed by backend (basePrice + priceBump)

  currency?: string;
  availableQty: number;
  leadDays: number | null;
  isActive: boolean;
  inStock: boolean;
};

type OffersResp = { data: OfferApi[] };
type SuppliersResp = { data: Supplier[] };

type Row = {
  rowKey: string; // stable UI key
  offerId: string | null; // API id "base:..." | "variant:..." or null for new

  supplierId: string;
  variantId: string | null;

  kind: OfferKind;

  basePrice: number;
  priceBump: number;

  availableQty: number;
  isActive: boolean;
  inStock: boolean;
  leadDays: number | "" | null;
};

type Props = {
  productId: string;

  variants?: Variant[];
  suppliers?: Supplier[];
  token?: string | null;
  readOnly?: boolean;

  fixedSupplierId?: string | null;
  defaultUnitCost?: number;
  onSaved?: () => void;
};

type VariantItem =
  | { kind: "BASE"; label: string }
  | { kind: "VARIANT"; v: Variant; label: string };

function VariantComboBox({
  disabled,
  valueVariantId,
  items,
  onSelectBase,
  onSelectVariant,
  placeholder = "Search variant…",
}: {
  disabled: boolean;
  valueVariantId: string | null;
  items: VariantItem[];
  onSelectBase: () => void;
  onSelectVariant: (variantId: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const selectedLabel = useMemo(() => {
    if (!valueVariantId) {
      const base = items.find((x) => x.kind === "BASE");
      return base?.label ?? "— None (base offer) —";
    }
    const found = items.find((x) => x.kind === "VARIANT" && x.v.id === valueVariantId) as
      | Extract<VariantItem, { kind: "VARIANT" }>
      | undefined;
    return found?.label ?? "";
  }, [items, valueVariantId]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((x) => x.label.toLowerCase().includes(needle));
  }, [items, q]);

  const shown = filtered;

  function choose(item: VariantItem) {
    if (item.kind === "BASE") onSelectBase();
    else onSelectVariant(item.v.id);
    setOpen(false);
  }

  return (
    <div className="relative w-full min-w-[720px]">
      <button
        type="button"
        className={`w-full rounded-xl border px-3 py-2 text-left ${disabled ? "bg-slate-100 border-slate-200 text-slate-500" : "bg-white border-slate-300"
          }`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? "Select supplier first" : selectedLabel}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="whitespace-normal break-words leading-snug">
            {selectedLabel || "— Select —"}
          </span>
          <span className="text-slate-400">▾</span>
        </div>
      </button>

      {open && !disabled ? (
        <div className="absolute z-30 mt-2 w-[min(92vw,1400px)] max-w-none overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              placeholder={placeholder}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, shown.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const item = shown[active];
                  if (item) choose(item);
                }
              }}
            />
            <div className="mt-2 text-xs text-slate-400">
              Showing {shown.length} / {filtered.length}
            </div>
          </div>

          <div className="max-h-[320px] overflow-auto">
            {shown.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">No matches</div>
            ) : (
              shown.map((item, idx) => (
                <button
                  key={item.kind === "BASE" ? "BASE" : item.v.id}
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${idx === active ? "bg-slate-50" : ""
                    }`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(item)}
                >
                  <div className="whitespace-normal break-words leading-snug">{item.label}</div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isLikelyJwt(s: string) {
  return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s);
}

function tryExtractTokenFromJsonString(raw: string): string | null {
  try {
    const obj = JSON.parse(raw);
    const candidates = [
      obj?.token,
      obj?.accessToken,
      obj?.access_token,
      obj?.authToken,
      obj?.jwt,
      obj?.state?.token,
      obj?.data?.token,
      obj?.data?.accessToken,
      obj?.user?.token,
      obj?.user?.accessToken,
    ].filter(Boolean);

    for (const c of candidates) {
      const s = String(c).trim();
      if (s && isLikelyJwt(s)) return s;
    }
  } catch { }
  return null;
}

function scanStorageForJwt(storage: Storage): string | null {
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k) continue;
    const v = storage.getItem(k);
    if (!v) continue;

    const trimmed = v.trim();
    if (isLikelyJwt(trimmed)) return trimmed;

    const fromJson = tryExtractTokenFromJsonString(trimmed);
    if (fromJson) return fromJson;
  }
  return null;
}

function getAuthTokenFromStorage(): string | null {
  const keys = ["access_token", "accessToken", "token", "authToken", "jwt", "auth", "user", "session"];

  for (const k of keys) {
    const v = localStorage.getItem(k) ?? sessionStorage.getItem(k);
    if (!v) continue;

    const trimmed = v.trim();
    if (isLikelyJwt(trimmed)) return trimmed;

    const fromJson = tryExtractTokenFromJsonString(trimmed);
    if (fromJson) return fromJson;
  }

  return scanStorageForJwt(localStorage) ?? scanStorageForJwt(sessionStorage);
}

async function apiFetchJson<T>(
  path: string,
  opts: RequestInit & { signal?: AbortSignal } = {},
  token?: string | null
): Promise<T> {
  const t = token ?? getAuthTokenFromStorage();

  const headers = new Headers(opts.headers || {});
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && opts.body) headers.set("Content-Type", "application/json");
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const res = await fetch(path, { ...opts, headers, credentials: "include" });

  if (res.status === 401) throw new Error("Unauthorized");

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const msg = body?.error || body?.message || `Request failed (${res.status}) for ${path}`;
    const err = new Error(msg) as any;
    err.status = res.status;
    throw err;
  }

  return body as T;
}

function formatNgn(n: number | null | undefined) {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(n);
  } catch {
    return `₦${Number(n).toFixed(2)}`;
  }
}

function comboKey(supplierId: string, variantId: string | null) {
  return `${supplierId}::${variantId ?? "__BASE__"}`;
}

function safeNum(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function extractVariantsFromProduct(p: any): Variant[] {
  const list =
    (Array.isArray(p?.variants) && p.variants) ||
    (Array.isArray(p?.ProductVariant) && p.ProductVariant) ||
    (Array.isArray(p?.productVariants) && p.productVariants) ||
    [];

  return list
    .map((v: any) => ({
      id: String(v.id),
      sku: v.sku != null ? String(v.sku) : null,
      label: v.label != null ? String(v.label) : undefined,
    }))
    .filter((v: Variant) => !!v.id); // ✅ sku is optional in schema
}


function variantDisplay(productSku: string, v: Variant) {
  const prefix = productSku ? `${productSku}-` : "";
  const skuOrFallback = (v.sku && v.sku.trim()) ? v.sku.trim() : v.id.slice(-6); // ✅ fallback
  const skuPart = `${prefix}${skuOrFallback}`;
  return v.label ? `${skuPart} — ${v.label}` : skuPart;
}


function makeBaseOfferMap(offers: OfferApi[]) {
  const m = new Map<string, OfferApi>();
  for (const o of offers) {
    if (o.kind === "BASE") m.set(o.supplierId, o);
  }
  return m;
}

export default function SuppliersOfferManager({
  productId,
  variants: variantsProp,
  suppliers: suppliersProp,
  token,
  readOnly,
  fixedSupplierId,
  defaultUnitCost,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const [productTitle, setProductTitle] = useState<string>("");
  const [productSku, setProductSku] = useState<string>("");

  const [variants, setVariants] = useState<Variant[]>(variantsProp ?? []);
  const [suppliers, setSuppliers] = useState<Supplier[]>(suppliersProp ?? []);

  const [offersLoaded, setOffersLoaded] = useState<OfferApi[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  const [isEditingOffers, setIsEditingOffers] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setVariants(variantsProp ?? []), [variantsProp]);
  useEffect(() => setSuppliers(suppliersProp ?? []), [suppliersProp]);

  const canEdit = !readOnly && isEditingOffers;

  // ✅ Allowed variants for THIS product only
  const allowedVariantIds = useMemo(() => {
    return new Set((variants ?? []).map((v) => String(v.id)));
  }, [variants]);

  const variantsById = useMemo(() => {
    const m = new Map<string, Variant>();
    for (const v of variants) m.set(v.id, v);
    return m;
  }, [variants]);

  const suppliersById = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  const offersByCombo = useMemo(() => {
    const m = new Map<string, OfferApi>();
    for (const o of offersLoaded) {
      if (!o.supplierId) continue;
      const vid = (o.variantId ?? null) as string | null;
      m.set(comboKey(o.supplierId, vid), o);
    }
    return m;
  }, [offersLoaded]);

  const baseOfferBySupplier = useMemo(() => makeBaseOfferMap(offersLoaded), [offersLoaded]);

  const basePriceBySupplierFromRows = useMemo(() => {
    const m = new Map<string, number>();
    // 1) BASE rows
    for (const r of rows) {
      const sid = fixedSupplierId ?? r.supplierId;
      if (!sid) continue;
      if (r.variantId != null) continue;
      const bp = safeNum(r.basePrice, 0);
      if (bp > 0) m.set(sid, bp);
    }
    // 2) fallback: any row
    for (const r of rows) {
      const sid = fixedSupplierId ?? r.supplierId;
      if (!sid) continue;
      if (m.has(sid)) continue;
      const bp = safeNum(r.basePrice, 0);
      if (bp > 0) m.set(sid, bp);
    }
    return m;
  }, [rows, fixedSupplierId]);

  const baseRowCountBySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const sid = fixedSupplierId ?? r.supplierId;
      if (!sid) continue;
      if (r.variantId != null) continue;
      m.set(sid, (m.get(sid) ?? 0) + 1);
    }
    return m;
  }, [rows, fixedSupplierId]);

  function hasOtherBaseRow(supplierId: string, rowKey: string) {
    if (!supplierId) return false;
    const count = baseRowCountBySupplier.get(supplierId) ?? 0;
    if (count === 0) return false;

    const selfIsBase = rows.some((r) => r.rowKey === rowKey && r.variantId == null);
    return selfIsBase ? count > 1 : count > 0;
  }

  const usedVariantIdsBySupplier = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const sid = fixedSupplierId ?? r.supplierId;
      if (!sid) continue;
      if (!r.variantId) continue;
      const set = m.get(sid) ?? new Set<string>();
      set.add(r.variantId);
      m.set(sid, set);
    }
    return m;
  }, [rows, fixedSupplierId]);

  const baseQtyBySupplierFromRows = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const sid = fixedSupplierId ?? r.supplierId;
      if (!sid) continue;
      if (r.variantId != null) continue; // base only
      m.set(sid, Math.max(0, Math.trunc(Number(r.availableQty) || 0)));
    }
    return m;
  }, [rows, fixedSupplierId]);


  function isVariantUsedElsewhere(sid: string, variantId: string, rowKey: string) {
    if (!sid || !variantId) return false;
    return rows.some((r) => {
      const rsid = fixedSupplierId ?? r.supplierId;
      return r.rowKey !== rowKey && rsid === sid && r.variantId === variantId;
    });
  }

  const normalizeId = (x: any): string | null => {
    if (x == null) return null;
    const s = String(x).trim();
    return s ? s : null;
  };

  const sanitizeVariantId = (raw: any): string | null => {
    const vid = normalizeId(raw);
    if (!vid) return null; // base offer
    // if variants not loaded yet, be permissive
    if (allowedVariantIds.size === 0) return vid;
    return allowedVariantIds.has(vid) ? vid : null;
  };

  function defaultBasePriceForSupplier(supplierId: string) {
    const base = baseOfferBySupplier.get(supplierId);
    const bp = base?.basePrice != null ? safeNum(base.basePrice, 0) : 0;
    if (bp > 0) return bp;

    const du = defaultUnitCost != null ? safeNum(defaultUnitCost, 0) : 0;
    if (du > 0) return du;

    return 0;
  }

  function effectiveBasePriceForRow(r: Row) {
    const supplierId = fixedSupplierId ?? r.supplierId;
    if (!supplierId) return 0;

    const liveBase = basePriceBySupplierFromRows.get(supplierId);
    if (liveBase != null && liveBase > 0) return liveBase;

    if (r.kind === "BASE") {
      const self = safeNum(r.basePrice, 0);
      return self > 0 ? self : defaultBasePriceForSupplier(supplierId);
    }

    return defaultBasePriceForSupplier(supplierId);
  }

  function offerToRow(o: OfferApi, baseMap: Map<string, OfferApi>): Row {
    const rawVid = normalizeId(o.variantId); // keep raw offer variantId
    const isVariant = o.kind === "VARIANT" && !!rawVid;

    let basePrice = safeNum(o.basePrice, 0);
    let priceBump = isVariant ? safeNum(o.priceBump, 0) : 0;

    // If variant row somehow missed basePrice, take supplier base row (still schema-derived)
    if (isVariant && basePrice <= 0) {
      const base = baseMap.get(o.supplierId);
      basePrice = base?.basePrice != null ? safeNum(base.basePrice, 0) : 0;
    }

    return {
      rowKey: o.id,
      offerId: o.id,
      supplierId: o.supplierId,
      variantId: isVariant ? rawVid : null,
      kind: isVariant ? "VARIANT" : "BASE",
      basePrice,
      priceBump: isVariant ? priceBump : 0,
      availableQty: safeNum(o.availableQty, 0),
      isActive: !!o.isActive,
      inStock: !!o.inStock,
      leadDays: o.leadDays ?? "",
    };
  }


  function snapRowToCombo(rowKey: string, supplierId: string, variantId: string | null) {
    // ✅ Prevent selecting a variant that isn't this product's
    if (variantId && allowedVariantIds.size > 0 && !allowedVariantIds.has(String(variantId))) {
      setError("Selected variant does not belong to this product.");
      variantId = null; // force base
    }

    const existing = supplierId ? offersByCombo.get(comboKey(supplierId, variantId)) : undefined;

    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;

        if (existing) {
          const hydrated = offerToRow(existing, baseOfferBySupplier);
          return { ...r, ...hydrated, rowKey: r.rowKey }; // keep stable key
        }

        const kind: OfferKind = variantId ? "VARIANT" : "BASE";
        const basePrice = supplierId ? defaultBasePriceForSupplier(supplierId) : 0;

        return {
          ...r,
          offerId: null,
          supplierId,
          variantId,
          kind,
          basePrice,
          priceBump: kind === "VARIANT" ? 0 : 0,
          availableQty: 0,
          isActive: true,
          inStock: true,
          leadDays: "",
        };
      })
    );
  }

  async function load() {
    if (!productId) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError("");

    try {
      // product (variants + sku for labels)
      const productPromise =
        !productSku || !variantsProp || variantsProp.length === 0
          ? apiFetchJson<ProductResp>(
            `/api/admin/products/${productId}?include=variants`,
            { signal: ac.signal },
            token
          )
          : Promise.resolve(null as any);

      // suppliers (optional)
      const suppliersPromise =
        !suppliersProp || suppliersProp.length === 0
          ? apiFetchJson<SuppliersResp>(`/api/admin/suppliers`, { signal: ac.signal }, token)
          : Promise.resolve({ data: suppliersProp ?? [] } as SuppliersResp);

      // ✅ ONLY endpoint for offers list
      const offersPromise = apiFetchJson<OffersResp>(
        `/api/admin/products/${productId}/supplier-offers`,
        { signal: ac.signal },
        token
      );

      const [p, s, o] = await Promise.all([productPromise, suppliersPromise, offersPromise]);

      if (p?.data) {
        setProductTitle(p.data.title || "");
        setProductSku(p.data.sku || "");
        setVariants(extractVariantsFromProduct(p.data));
      }

      if (s?.data) setSuppliers(Array.isArray(s.data) ? s.data : []);

      const offersRaw = Array.isArray(o?.data) ? o.data : [];

      // keep only this product
      const filteredOffers = offersRaw.filter((of) => String(of.productId) === String(productId));

      // ✅ seed variants from PRODUCT + OFFERS (critical)
      const productVariants = p?.data ? extractVariantsFromProduct(p.data) : [];
      const seededFromOffers: Variant[] = filteredOffers
        .filter((x) => x.kind === "VARIANT" && x.variantId)
        .map((x) => ({
          id: String(x.variantId),
          sku: x.variantSku != null ? String(x.variantSku) : null,
        }));

      const mergedVariants = (() => {
        const m = new Map<string, Variant>();
        for (const v of productVariants) m.set(v.id, v);
        for (const v of seededFromOffers) {
          if (!m.has(v.id)) m.set(v.id, v);
        }
        return Array.from(m.values());
      })();

      setVariants(mergedVariants);

      setOffersLoaded(filteredOffers);

      const baseMap = makeBaseOfferMap(filteredOffers);
      const nextRows = filteredOffers
        .filter((x) => x?.id && x?.supplierId)
        .map((x) => offerToRow(x, baseMap));

      setRows(nextRows);

    } catch (e: any) {
      if (e?.name === "AbortError" || String(e?.message || "").toLowerCase().includes("aborted")) return;
      setError(e?.message || "Failed to load supplier offers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setIsEditingOffers(false);
  }, [productId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  function addRow() {
    const rowKey = `new-${Math.random().toString(16).slice(2)}`;
    const startSupplierId = fixedSupplierId ?? "";

    setRows((prev) => [
      ...prev,
      {
        rowKey,
        offerId: null,
        supplierId: startSupplierId,
        variantId: null,
        kind: "BASE",
        basePrice: startSupplierId ? defaultBasePriceForSupplier(startSupplierId) : 0,
        priceBump: 0,
        availableQty: 0,
        isActive: true,
        inStock: true,
        leadDays: "",
      },
    ]);
  }

  async function deleteRow(row: Row) {
    if (!canEdit) return;

    if (!row.offerId) {
      setRows((prev) => prev.filter((r) => r.rowKey !== row.rowKey));
      return;
    }

    const supplierName = suppliersById.get(row.supplierId)?.name || row.supplierId;
    const variantSku = row.variantId ? variantsById.get(row.variantId)?.sku : null;

    const ok = window.confirm(
      `Delete this supplier offer?\n\nSupplier: ${supplierName}\nVariant: ${variantSku ?? "Base"}`
    );
    if (!ok) return;

    setSaving(true);
    setError("");

    try {
      await apiFetchJson(`/api/admin/supplier-offers/${row.offerId}`, { method: "DELETE" }, token);
      await load();
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Delete failed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    if (!canEdit) return;

    setSaving(true);
    setError("");

    try {
      const supplierName = (sid: string) => suppliersById.get(sid)?.name ?? sid;

      const baseRows = rows.filter((r) => r.variantId == null);
      const variantRows = rows.filter((r) => r.variantId != null);

      const getExistingId = (sid: string, variantId: string | null) => {
        const existing = offersByCombo.get(comboKey(sid, variantId));
        return existing?.id ?? null;
      };

      const upsertOffer = async (existingId: string | null, payload: any) => {
        if (!existingId) {
          await apiFetchJson(
            `/api/admin/products/${productId}/supplier-offers`,
            { method: "POST", body: JSON.stringify(payload) },
            token
          );
          return;
        }

        await apiFetchJson(
          `/api/admin/supplier-offers/${existingId}`,
          { method: "PATCH", body: JSON.stringify(payload) },
          token
        );
      };

      // Build basePriceBySupplier from current UI rows
      const basePriceBySupplier = new Map<string, number>();

      for (const br of baseRows) {
        const sid = fixedSupplierId ?? br.supplierId;
        if (!sid) continue;
        const bp = safeNum(br.basePrice, 0);
        if (bp > 0) basePriceBySupplier.set(sid, bp);
      }

      for (const r of rows) {
        const sid = fixedSupplierId ?? r.supplierId;
        if (!sid) continue;
        if (basePriceBySupplier.has(sid)) continue;
        const bp = safeNum(r.basePrice, 0);
        if (bp > 0) basePriceBySupplier.set(sid, bp);
      }

      // Validate variant rows
      for (const vr of variantRows) {
        const sid = fixedSupplierId ?? vr.supplierId;

        if (!sid) throw new Error("Each row must have a supplier selected.");
        if (!vr.variantId) throw new Error("Each VARIANT row must have a variant selected.");

        if (vr.variantId && allowedVariantIds.size > 0 && !allowedVariantIds.has(String(vr.variantId))) {
          throw new Error("One or more rows have a variant that does not belong to this product.");
        }

        const bp = basePriceBySupplier.get(sid) ?? 0;
        const hasLoadedBase = baseOfferBySupplier.get(sid)?.basePrice != null;

        if (bp <= 0 && !hasLoadedBase) {
          throw new Error(`Supplier "${supplierName(sid)}" needs a BASE price before adding variant offers.`);
        }
      }

      // Ensure base exists for each supplier referenced
      const suppliersNeedingBase = new Set<string>();
      for (const r of rows) {
        const sid = fixedSupplierId ?? r.supplierId;
        if (sid) suppliersNeedingBase.add(sid);
      }

      // 1) Upsert base per supplier
      for (const sid of suppliersNeedingBase) {
        const bp = basePriceBySupplier.get(sid) ?? safeNum(baseOfferBySupplier.get(sid)?.basePrice, 0);
        if (bp <= 0) continue;

        const uiBase = baseRows.find((b) => (fixedSupplierId ?? b.supplierId) === sid) ?? null;

        const qty = uiBase ? Math.max(0, Math.trunc(Number(uiBase.availableQty) || 0)) : 0;
        const isActive = uiBase ? !!uiBase.isActive : true;
        const inStock = isActive && qty > 0;

        const payload = {
          supplierId: sid,
          variantId: null,
          basePrice: Math.max(0, safeNum(bp, 0)),
          availableQty: qty,
          isActive,
          inStock,
          leadDays: uiBase?.leadDays === "" || uiBase?.leadDays == null ? null : Math.max(0, Math.trunc(Number(uiBase.leadDays) || 0)),
        };

        const existingId = uiBase?.offerId ?? getExistingId(sid, null);
        await upsertOffer(existingId, payload);
      }

      // 2) Upsert variants
      for (const r of variantRows) {
        const sid = fixedSupplierId ?? r.supplierId;
        if (!sid) throw new Error("Each row must have a supplier selected.");
        if (!r.variantId) throw new Error("Each VARIANT row must have a variant selected.");

        const qty = Math.max(0, Math.trunc(Number(r.availableQty) || 0));
        const isActive = !!r.isActive;
        const inStock = isActive && qty > 0;

        const bump = Math.max(0, safeNum(r.priceBump, 0));
        if (bump < 0) throw new Error("Variant price bump cannot be negative.");

        const payload = {
          supplierId: sid,
          variantId: r.variantId,
          priceBump: bump,
          availableQty: qty,
          isActive,
          inStock,
          leadDays: r.leadDays === "" || r.leadDays == null ? null : Math.max(0, Math.trunc(Number(r.leadDays) || 0)),
        };

        const existingId = r.offerId ?? getExistingId(sid, r.variantId);
        await upsertOffer(existingId, payload);
      }

      await load();
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Supplier offers</div>
          <div className="text-sm text-slate-500">
            Link supplier offers to this product and its variants.
            {productTitle ? <span className="ml-2 text-slate-400">({productTitle})</span> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={() => setIsEditingOffers((v) => !v)}
              className={`rounded-xl px-3 py-2 text-sm border ${isEditingOffers
                ? "bg-amber-600 text-white border-amber-600 hover:bg-amber-700"
                : "bg-white border-slate-300 hover:bg-slate-50"
                }`}
              disabled={loading || saving}
            >
              {isEditingOffers ? "Lock offers" : "Edit offers"}
            </button>
          )}

          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            disabled={loading || saving}
          >
            Refresh offers
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-[1500px] w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left font-semibold w-[260px]">Supplier</th>
              <th className="px-3 py-2 text-left font-semibold w-[900px]">Variant</th>
              <th className="px-3 py-2 text-left font-semibold">Base price</th>
              <th className="px-3 py-2 text-left font-semibold">Bump</th>
              <th className="px-3 py-2 text-left font-semibold">Total cost</th>
              <th className="px-3 py-2 text-left font-semibold">Available</th>
              <th className="px-3 py-2 text-left font-semibold">Active</th>
              <th className="px-3 py-2 text-left font-semibold">Lead (days)</th>
              <th className="px-3 py-2 text-left font-semibold">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={9}>
                  {loading ? "Loading..." : "No supplier offers yet. Click Add row to create one."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const supplierIdShown = fixedSupplierId ?? r.supplierId;
                const supplierOk = !!supplierIdShown;

                const baseEff = r.variantId == null ? safeNum(r.basePrice, 0) : effectiveBasePriceForRow(r);
                const bump = r.variantId != null ? safeNum(r.priceBump, 0) : 0;
                const totalCost = r.variantId != null ? baseEff + bump : baseEff;

                const disableBump = saving || !canEdit || r.variantId == null || !supplierOk || baseEff <= 0;

                const baseDisabled = !!supplierIdShown && hasOtherBaseRow(supplierIdShown, r.rowKey);

                const usedSet = supplierIdShown ? usedVariantIdsBySupplier.get(supplierIdShown) : undefined;
                const usedOther = new Set<string>();
                if (usedSet) {
                  for (const id of usedSet) {
                    if (id !== r.variantId) usedOther.add(id);
                  }
                }

                const variantChoices = variants.filter((v) => {
                  if (!supplierIdShown) return true;
                  if (r.variantId === v.id) return true;
                  return !usedOther.has(v.id);
                });

                const items: VariantItem[] = [
                  ...(baseDisabled ? [] : [{ kind: "BASE" as const, label: "— None (base offer) —" }]),
                  ...variantChoices.map((v) => ({
                    kind: "VARIANT" as const,
                    v,
                    label: variantDisplay(productSku, v),
                  })),
                ];

                return (
                  <tr key={r.rowKey} className="border-t border-slate-200">
                    {/* Supplier */}
                    <td className="px-3 py-2">
                      <select
                        className="w-[260px] rounded-xl border border-slate-300 px-3 py-2"
                        value={supplierIdShown}
                        onChange={(e) => {
                          const sid = e.target.value;
                          const currentVid = r.variantId;

                          const nextVid =
                            sid && currentVid && isVariantUsedElsewhere(sid, currentVid, r.rowKey) ? null : currentVid;

                          snapRowToCombo(r.rowKey, sid, nextVid);
                        }}
                        disabled={saving || !canEdit || !!fixedSupplierId}
                      >
                        <option value="">— Select supplier —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Variant */}
                    <td className="px-3 py-2 w-[900px] min-w-[720px]">
                      <VariantComboBox
                        disabled={saving || !canEdit || !supplierIdShown}
                        valueVariantId={r.variantId}
                        items={items}
                        onSelectBase={() => {
                          const sid = fixedSupplierId ?? r.supplierId;
                          if (!sid) return;

                          if (hasOtherBaseRow(sid, r.rowKey)) {
                            setError("This supplier already has a BASE offer row. You can’t add another base row.");
                            return;
                          }
                          snapRowToCombo(r.rowKey, sid, null);
                        }}
                        onSelectVariant={(vid) => {
                          const sid = fixedSupplierId ?? r.supplierId;
                          if (!sid) return;

                          if (isVariantUsedElsewhere(sid, vid, r.rowKey)) {
                            setError("This variant combo is already used for this supplier.");
                            return;
                          }

                          snapRowToCombo(r.rowKey, sid, vid);
                        }}
                      />

                      {!supplierIdShown ? (
                        <div className="mt-1 text-xs text-amber-600">Select supplier first</div>
                      ) : null}

                      {baseDisabled ? (
                        <div className="mt-1 text-[11px] text-slate-400">Base offer already exists for this supplier.</div>
                      ) : null}
                    </td>

                    {/* Base price */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        className="w-[150px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-right"
                        value={baseEff}
                        onChange={(e) => {
                          const sid = fixedSupplierId ?? r.supplierId;
                          if (!sid) return;

                          const next = e.target.value === "" ? 0 : safeNum(e.target.value, 0);

                          setRows((prev) =>
                            prev.map((x) => {
                              const xsid = fixedSupplierId ?? x.supplierId;
                              if (xsid !== sid) return x;
                              return { ...x, basePrice: Math.max(0, next) };
                            })
                          );
                        }}
                        disabled={saving || !canEdit || !supplierOk}
                      />
                      <div className="mt-1 text-xs text-slate-500">{formatNgn(baseEff)}</div>
                    </td>

                    {/* Bump */}
                    <td className="px-3 py-2">
                      {r.variantId != null ? (
                        <>
                          <input
                            type="number"
                            className="w-[120px] rounded-xl border border-slate-300 px-3 py-2 text-right"
                            value={bump}
                            onChange={(e) => {
                              const next = e.target.value === "" ? 0 : safeNum(e.target.value, 0);

                              setRows((prev) =>
                                prev.map((x) =>
                                  x.rowKey === r.rowKey ? { ...x, priceBump: Math.max(0, next) } : x
                                )
                              );
                            }}
                            disabled={disableBump}
                          />
                          <div className="mt-1 text-xs text-slate-500">{formatNgn(bump)}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Total */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        className="w-[150px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-slate-700"
                        value={totalCost}
                        disabled
                      />
                      <div className="mt-1 text-xs text-slate-500">{formatNgn(totalCost)}</div>
                    </td>

                    {/* Qty */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="w-[120px] rounded-xl border border-slate-300 px-3 py-2 text-right"
                        value={r.availableQty ?? 0}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = raw === "" ? 0 : safeNum(raw, 0);
                          const v = Math.max(0, Math.trunc(Number(n) || 0));

                          setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, availableQty: v } : x)));
                        }}
                        onBlur={() => {
                          const v = Math.max(0, Math.trunc(Number(r.availableQty) || 0));
                          if (v !== r.availableQty) {
                            setRows((prev) =>
                              prev.map((x) => (x.rowKey === r.rowKey ? { ...x, availableQty: v } : x))
                            );
                          }
                        }}
                        disabled={saving || !canEdit}
                      />
                    </td>

                    {/* Active */}
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.isActive}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) => (x.rowKey === r.rowKey ? { ...x, isActive: e.target.checked } : x))
                          )
                        }
                        disabled={saving || !canEdit}
                      />
                    </td>

                    {/* Lead days */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        className="w-[120px] rounded-xl border border-slate-300 px-3 py-2 text-right"
                        value={r.leadDays ?? ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? "" : safeNum(e.target.value, 0);
                          setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, leadDays: v } : x)));
                        }}
                        disabled={saving || !canEdit}
                      />
                    </td>

                    {/* Actions */}
                    {canEdit && (
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => deleteRow(r)}
                          className="rounded-xl border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                          disabled={saving || !canEdit}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
 {canEdit && (
      <div className="mt-4 flex items-center justify-between gap-3">
       
          <button
            type="button"
            onClick={addRow}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            disabled={loading || saving || !canEdit}
          >
            Add row
          </button>
        <button
          type="button"
          onClick={saveAll}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          disabled={loading || saving || rows.length === 0 || !canEdit}
        >
          {saving ? "Saving..." : "Save all changes"}
        </button>
      </div>
        )}

    </div>
  );
}
