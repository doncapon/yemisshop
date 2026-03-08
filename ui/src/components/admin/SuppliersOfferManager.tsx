import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * SuppliersOfferManager.tsx (schema-aligned)
 *
 * ✅ Cookie auth (NO bearer tokens): credentials: "include"
 *
 * ✅ Uses ONLY these endpoints (no fallbacks):
 * - GET    /api/admin/products/:productId/supplier-offers
 * - POST   /api/admin/products/:productId/supplier-offers
 * - PATCH  /api/admin/supplier-offers/:id
 * - DELETE /api/admin/supplier-offers/:id
 *
 * ✅ One price field in API payloads ONLY: `price`
 *   - BASE row:     price -> SupplierProductOffer.basePrice
 *   - VARIANT row:  price -> SupplierVariantOffer.unitPrice
 *
 * ✅ YOUR SCHEMA reality:
 * - Product has ONE supplierId (required)
 * - SupplierProductOffer has NO supplierId
 * - SupplierVariantOffer has NO supplierId
 *
 * 👉 Therefore:
 * - NO supplier dropdown in UI
 * - supplier is derived from the Product's supplier (read-only display)
 * - Payloads OMIT supplierId (server should infer from product.supplierId)
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

type OfferKind = "BASE" | "VARIANT";

type OfferApi = {
  id: string; // "base:..." or "variant:..."
  kind?: OfferKind;

  productId: string;

  // NOTE: these may still come back from legacy DTOs; we ignore for saving
  supplierId?: string;
  supplierName?: string;

  variantId: string | null;
  variantSku?: string | null;

  basePrice?: number | null;
  unitPrice?: number | null;

  currency?: string;
  availableQty?: number;
  leadDays?: number | null;
  isActive?: boolean;
  inStock?: boolean;

  // NEW: backend tells us if this offer has ever been used in orders
  hasOrders?: boolean;
};

type Row = {
  rowKey: string;

  /** current backend offer id (null for unsaved) */
  offerId: string | null;

  /**
   * If user changes combo to a NEW combo, we remember old offerId here.
   * ✅ We DO NOT auto delete on Save (deletes may be blocked after orders).
   */
  deleteOfferId: string | null;

  variantId: string | null;
  kind: OfferKind;

  /** editable price; BASE uses basePrice, VARIANT uses unitPrice (full) */
  unitPrice: number;

  availableQty: number;
  isActive: boolean;

  // display-only / derived
  inStock: boolean;

  leadDays: number | "" | null;

  // NEW: true if this row has been used in orders (structurally locked)
  hasOrders: boolean;

  // NEW: UI-only flags
  isBlank?: boolean; // "— Blank —" placeholder selected
  isNew?: boolean; // never successfully saved yet
};

type Props = {
  productId: string;

  variants?: Variant[];
  refreshKey: number;
  // kept for compatibility; ignored
  suppliers?: Supplier[];
  token?: string | null;

  readOnly?: boolean;

  // fixedSupplierId now ignored (supplier comes from product)
  fixedSupplierId?: string | null;

  defaultUnitCost?: number; // kept for compatibility; not used to auto-fill
  onSaved?: () => void;
};

/* ------------------------------ UI Combobox ------------------------------ */

type VariantItem =
  | { kind: "BLANK"; label: string }
  | { kind: "BASE"; label: string }
  | { kind: "VARIANT"; v: Variant; label: string };

function VariantComboBox({
  disabled,
  valueVariantId,
  items,
  onSelectBase,
  onSelectVariant,
  onSelectBlank,
  placeholder = "Select base or variant…",
  isBlank,
  hasError,
  isOpen,
  onRequestOpen,
  onRequestClose,
}: {
  disabled: boolean;
  valueVariantId: string | null;
  items: VariantItem[];
  onSelectBase: () => void;
  onSelectVariant: (variantId: string) => void;
  onSelectBlank: () => void;
  placeholder?: string;
  /** When true, show placeholder instead of a "selected" label */
  isBlank: boolean;
  /** When true, draw the combobox with an error (red) border */
  hasError?: boolean;
  /** Controlled open state so only one dropdown is open at a time */
  isOpen: boolean;
  onRequestOpen: () => void;
  onRequestClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const selectedKey = valueVariantId
    ? `VARIANT:${valueVariantId}`
    : isBlank
      ? "UNSET"
      : "BASE";

  const selectedLabel = useMemo(() => {
    if (isBlank) return placeholder || "— Select —";

    if (!valueVariantId) {
      const base = items.find((x) => x.kind === "BASE");
      return base?.label ?? "— None (base offer) —";
    }
    const found = items.find(
      (x) => x.kind === "VARIANT" && x.v.id === valueVariantId
    ) as Extract<VariantItem, { kind: "VARIANT" }> | undefined;

    return found?.label ?? "— Select —";
  }, [items, valueVariantId, isBlank, placeholder]);


  // Close when clicking outside
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClick(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) {
        onRequestClose();
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onRequestClose]);

  useEffect(() => {
    if (!isOpen) {
      setQ("");
      setActive(0);
    }
  }, [isOpen]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((x) => x.label.toLowerCase().includes(needle));
  }, [items, q]);

  function choose(item: VariantItem) {
    if (item.kind === "BLANK") onSelectBlank();
    else if (item.kind === "BASE") onSelectBase();
    else onSelectVariant(item.v.id);

    onRequestClose();
  }

  return (
    <div className="relative w-full min-w-[720px]">
      {/* CLOSED BUTTON */}
      <button
        type="button"
        className={`w-full rounded-xl border px-3 py-2 text-left ${disabled
          ? "bg-slate-100 border-slate-200 text-slate-500"
          : hasError
            ? "bg-white border-red-500 ring-1 ring-red-300"
            : "bg-white border-slate-300"
          }`}
        onClick={() => {
          if (disabled) return;
          if (isOpen) onRequestClose();
          else onRequestOpen();
        }}
        disabled={disabled}
        title={disabled ? "Locked" : selectedLabel}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="whitespace-normal break-words leading-snug">
            {selectedLabel || "— Select —"}
          </span>
          <span className="text-slate-400">▾</span>
        </div>
      </button>

      {/* DROPDOWN */}
      {isOpen && !disabled ? (
        <div
          ref={boxRef}
          className="absolute z-30 mt-2 w-full max-w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-lg"
        >
          <div className="p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              placeholder={placeholder}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              onKeyDown={(e) => {
                if (e.key === "Escape") onRequestClose();
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
              Showing {shown.length}
            </div>
          </div>

          <div className="max-h-[320px] overflow-auto bg-slate-900">
            {shown.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-400">
                No matches
              </div>
            ) : (
              shown.map((item, idx) => {
                const isSelected =
                  (item.kind === "BASE" && selectedKey === "BASE") ||
                  (item.kind === "VARIANT" &&
                    selectedKey === `VARIANT:${item.v.id}`) ||
                  (item.kind === "BLANK" && selectedKey === "UNSET");

                return (
                  <button
                    key={
                      item.kind === "BASE"
                        ? "BASE"
                        : item.kind === "BLANK"
                          ? "BLANK"
                          : item.v.id
                    }
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm transition
                      ${idx === active
                        ? "bg-slate-800 text-slate-100"
                        : "bg-slate-900 text-slate-300"
                      }
                      hover:bg-slate-800 hover:text-slate-100`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(item)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="whitespace-normal break-words leading-snug">
                        {item.label}
                      </div>

                      {isSelected ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-200">
                          Selected
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Cookie fetch helper ------------------------------ */

async function apiFetchJson<T>(
  path: string,
  opts: RequestInit & { signal?: AbortSignal } = {}
): Promise<T> {
  const headers = new Headers(opts.headers || {});
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && opts.body)
    headers.set("Content-Type", "application/json");

  const res = await fetch(path, { ...opts, headers, credentials: "include" });

  if (res.status === 401) throw new Error("Unauthorized");

  const isJson = (res.headers.get("content-type") || "").includes(
    "application/json"
  );
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const msg =
      body?.error ||
      body?.message ||
      `Request failed (${res.status}) for ${path}`;
    const err = new Error(msg) as any;
    err.status = res.status;
    throw err;
  }

  return body as T;
}

/* ------------------------------ Data helpers ------------------------------ */

function unwrap<T = any>(payload: any): T {
  const a = payload?.data;
  if (a == null) return payload as T;
  const b = a?.data;
  if (b == null) return a as T;
  const c = b?.data;
  if (c == null) return b as T;
  return c as T;
}

function formatNgn(n: number | null | undefined) {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(n);
  } catch {
    return `₦${Number(n).toFixed(2)}`;
  }
}

function safeNum(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeId(x: any): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  return s ? s : null;
}

function extractVariantsFromProduct(p: any): Variant[] {
  const root = unwrap<any>(p);

  const candidates: any[] =
    (Array.isArray(root?.variants) && root.variants) ||
    (Array.isArray(root?.ProductVariant) && root.ProductVariant) ||
    (Array.isArray(root?.productVariants) && root.productVariants) ||
    (Array.isArray(root?.productVariant) && root.productVariant) ||
    (Array.isArray(root?.ProductVariants) && root.ProductVariants) ||
    (Array.isArray(root?.variants?.data) && root.variants.data) ||
    (Array.isArray(root?.ProductVariant?.data) && root.ProductVariant.data) ||
    (Array.isArray(root?.productVariants?.data) && root.productVariants.data) ||
    [];

  return candidates
    .map((v: any) => ({
      id: String(v.id),
      sku: v.sku != null ? String(v.sku) : null,
      label: v.label != null ? String(v.label) : undefined,
    }))
    .filter((v: Variant) => !!v.id);
}

function variantDisplay(_productSku: string, v: Variant) {
  const normalize = (s: string) => s.replace(/\s*\/\s*/g, " - ");

  // If variant has a human label, use it — but fix slashes
  const cleanLabel = (v.label || "").trim();
  if (cleanLabel) return normalize(cleanLabel);

  // If label missing, use last SKU segment — also fix slashes
  const raw = (v.sku || "").trim();
  if (raw) {
    const last = raw.split("-").pop() || raw;
    return normalize(last.trim());
  }

  // fallback
  return v.id ? v.id.slice(-6) : "Variant";
}

function deriveKindFromOffer(o: OfferApi): OfferKind {
  if (o.kind === "BASE" || o.kind === "VARIANT") return o.kind;
  const vid = normalizeId(o.variantId);
  if (vid) return "VARIANT";
  const id = String(o.id || "");
  if (id.startsWith("variant:")) return "VARIANT";
  return "BASE";
}

function deriveInStock(isActive: boolean, availableQty: number) {
  return !!isActive && Math.max(0, Math.trunc(Number(availableQty) || 0)) > 0;
}

/* -------------------------------- Component -------------------------------- */

export default function SuppliersOfferManager({
  productId,
  variants: variantsProp,
  // suppliers/token ignored (schema: supplier is Product.supplierId)
  suppliers: _suppliersIgnored,
  token: _tokenIgnored,
  readOnly,
  refreshKey,
  fixedSupplierId: _fixedSupplierIdIgnored,
  defaultUnitCost: _defaultUnitCostIgnored,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const [productTitle, setProductTitle] = useState<string>("");
  const [productSku, setProductSku] = useState<string>("");

  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierName, setSupplierName] = useState<string>("");

  const [variants, setVariants] = useState<Variant[]>(variantsProp ?? []);
  const [offersLoaded, setOffersLoaded] = useState<OfferApi[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  const [isEditingOffers, setIsEditingOffers] = useState(false);

  // 🔑 Which row's combobox is currently open (to ensure only one at a time)
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setVariants(variantsProp ?? []), [variantsProp]);

  const canEdit = !readOnly && isEditingOffers;

  const allowedVariantIds = useMemo(
    () => new Set((variants ?? []).map((v) => String(v.id))),
    [variants]
  );

  const variantsById = useMemo(() => {
    const m = new Map<string, Variant>();
    for (const v of variants) m.set(v.id, v);
    return m;
  }, [variants]);

  const sanitizeVariantId = (raw: any): string | null => {
    const vid = normalizeId(raw);
    if (!vid) return null;
    if (allowedVariantIds.size === 0) return vid;
    return allowedVariantIds.has(vid) ? vid : null;
  };

  function hasOtherBaseRow(rowKey: string) {
    return rows.some(
      (r) =>
        r.rowKey !== rowKey &&
        !r.isBlank &&
        r.variantId == null
    );
  }


  function getRowComboError(row: Row): string | null {
    // blank / not chosen yet
    if (row.isBlank) {
      return "Pick a base offer or a variant.";
    }

    // duplicate base
    if (row.variantId == null && hasOtherBaseRow(row.rowKey)) {
      return "BASE offer already exists.";
    }

    // invalid/missing variant
    if (row.variantId != null) {
      const vid = sanitizeVariantId(row.variantId);
      if (!vid) return "Selected variant is invalid for this product.";

      if (isVariantUsedElsewhere(vid, row.rowKey)) {
        return "This variant already has an offer row.";
      }
    }

    return null;
  }


  function isVariantUsedElsewhere(variantId: string, rowKey: string) {
    if (!variantId) return false;
    return rows.some(
      (r) => r.rowKey !== rowKey && !r.isBlank && r.variantId === variantId
    );
  }

  function offerToRow(raw: OfferApi): Row {
    const o: OfferApi = { ...raw, kind: deriveKindFromOffer(raw) };
    const rawVid = normalizeId(o.variantId);
    const isVariant = o.kind === "VARIANT" && !!rawVid;

    const price = isVariant ? safeNum(o.unitPrice, 0) : safeNum(o.basePrice, 0);
    const qty = Math.max(0, Math.trunc(Number(o.availableQty ?? 0) || 0));
    const isActive = !!o.isActive;

    return {
      rowKey: o.id,
      offerId: o.id,
      deleteOfferId: null,
      variantId: isVariant ? rawVid : null,
      kind: isVariant ? "VARIANT" : "BASE",
      unitPrice: Math.max(0, safeNum(price, 0)),
      availableQty: qty,
      isActive,
      inStock: deriveInStock(isActive, qty),
      leadDays: o.leadDays ?? "",
      hasOrders: !!o.hasOrders,
      isBlank: false,
      isNew: false,
    };
  }

  function snapRowToVariant(rowKey: string, variantId: string | null) {
    if (variantId && allowedVariantIds.size > 0 && !allowedVariantIds.has(String(variantId))) {
      setError("Selected variant does not belong to this product.");
      variantId = null;
    }

    // if backend already has this offer combo, hydrate from offersLoaded
    const existing = offersLoaded.find((o) => {
      const k = deriveKindFromOffer(o);
      const vid = normalizeId(o.variantId);
      return k === (variantId ? "VARIANT" : "BASE") && (variantId ? vid === variantId : !vid);
    });

    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;

        const sameVariant = (r.variantId ?? null) === (variantId ?? null);
        if (sameVariant && !r.isBlank) return r;

        if (existing) {
          const hydrated = offerToRow(existing);
          return {
            ...r,
            ...hydrated,
            rowKey: r.rowKey,
            deleteOfferId: r.deleteOfferId ?? null,
            isNew: false,
            isBlank: false,
          };
        }

        const nextKind: OfferKind = variantId ? "VARIANT" : "BASE";

        const keptQty = Math.max(0, Math.trunc(Number(r.availableQty ?? 0) || 0));
        const keptIsActive = !!r.isActive;
        const keptPrice = Math.max(0, safeNum(r.unitPrice, 0));
        const keptLead = r.leadDays ?? "";

        return {
          ...r,
          deleteOfferId: r.deleteOfferId ?? null,
          offerId: r.offerId,
          variantId,
          kind: nextKind,
          unitPrice: keptPrice,
          availableQty: keptQty,
          isActive: keptIsActive,
          inStock: deriveInStock(keptIsActive, keptQty),
          leadDays: keptLead,
          isBlank: false,
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
      // ✅ need supplier info from product
      const productPromise = apiFetchJson<any>(
        `/api/admin/products/${encodeURIComponent(
          productId
        )}?include=variants,ProductVariant,productVariants,supplier`,
        { signal: ac.signal }
      );

      const offersPromise = apiFetchJson<any>(
        `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
        { signal: ac.signal }
      );

      const [pRaw, oRaw] = await Promise.all([productPromise, offersPromise]);

      const p = pRaw ? unwrap<any>(pRaw) : null;
      const o = unwrap<any>(oRaw);

      if (p) {
        setProductTitle(p?.title || "");
        setProductSku(p?.sku || "");

        // schema: product.supplierId required
        const sid = String(p?.supplierId || p?.supplier?.id || "").trim();
        setSupplierId(sid);
        setSupplierName(String(p?.supplier?.name || "").trim());
      }

      const offersArr: OfferApi[] = Array.isArray(o)
        ? o
        : Array.isArray(o?.data)
          ? o.data
          : [];
      const filteredOffers = (offersArr || [])
        .filter((of) => String(of?.productId) === String(productId))
        .map((of) => ({ ...of, kind: deriveKindFromOffer(of) }));

      // If API returns variant offers for variants not included, merge them in
      const productVariants = p ? extractVariantsFromProduct(p) : [];
      const seededFromOffers: Variant[] = filteredOffers
        .filter((x) => deriveKindFromOffer(x) === "VARIANT" && x.variantId)
        .map((x) => ({
          id: String(x.variantId),
          sku: x.variantSku != null ? String(x.variantSku) : null,
          label: undefined, // offers don't know about human labels
        }));

      // ✅ Merge into existing variants, keeping any labels that already exist
      setVariants((prev) => {
        const m = new Map<string, Variant>();

        // 1) Start with what we already had (from ManageProducts props)
        for (const v of prev || []) {
          m.set(v.id, { ...v });
        }

        // 2) Merge product variants from backend (fill sku, don't clobber label)
        for (const v of productVariants) {
          const existing = m.get(v.id);
          if (existing) {
            m.set(v.id, {
              ...existing,
              sku: v.sku ?? existing.sku,
              label: existing.label || v.label,
            });
          } else {
            m.set(v.id, v);
          }
        }

        // 3) Merge any extra variants we discover via offers
        for (const v of seededFromOffers) {
          const existing = m.get(v.id);
          if (existing) {
            m.set(v.id, {
              ...existing,
              sku: v.sku ?? existing.sku,
              label: existing.label || v.label,
            });
          } else {
            m.set(v.id, v);
          }
        }

        return Array.from(m.values());
      });

      setOffersLoaded(filteredOffers);

      const backendRows = filteredOffers
        .filter((x) => x?.id)
        .map((x) => offerToRow(x));

      // Preserve current UI order
      setRows((prev) => {
        const byId = new Map<string, Row>();
        const byKindVid = new Map<string, Row>();
        for (const br of backendRows) {
          if (br.offerId) byId.set(br.offerId, br);
          byKindVid.set(
            `${br.kind}::${br.variantId ?? "__BASE__"}`,
            br
          );
        }

        const usedIds = new Set<string>();
        const usedKeys = new Set<string>();

        const merged: Row[] = prev.map((r) => {
          const matchById = r.offerId ? byId.get(r.offerId) : undefined;
          const key = `${r.kind}::${r.variantId ?? "__BASE__"}`;
          const matchByKey = !matchById ? byKindVid.get(key) : undefined;
          const match = matchById ?? matchByKey;

          if (!match) return r;

          if (match.offerId) usedIds.add(match.offerId);
          usedKeys.add(`${match.kind}::${match.variantId ?? "__BASE__"}`);

          return {
            ...r,
            offerId: match.offerId,
            variantId: match.variantId,
            kind: match.kind,
            unitPrice: match.unitPrice,
            availableQty: match.availableQty,
            isActive: match.isActive,
            inStock: match.inStock,
            leadDays: match.leadDays,
            hasOrders: match.hasOrders,
            deleteOfferId: r.deleteOfferId ?? null,
            rowKey: r.rowKey,
            isBlank: false,
            isNew: false,
          };
        });

        const tail: Row[] = [];
        for (const br of backendRows) {
          const idOk = br.offerId ? !usedIds.has(br.offerId) : true;
          const key = `${br.kind}::${br.variantId ?? "__BASE__"}`;
          const keyOk = !usedKeys.has(key);
          if (idOk && keyOk) tail.push(br);
        }

        return [...merged, ...tail];
      });
    } catch (e: any) {
      if (
        e?.name === "AbortError" ||
        String(e?.message || "").toLowerCase().includes("aborted")
      )
        return;
      setError(e?.message || "Failed to load supplier offers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  useEffect(() => {
    setIsEditingOffers(false);
    setOpenRowKey(null);
  }, [productId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // Close any open dropdown when we start/stop editing or during save/load
  useEffect(() => {
    if (loading || saving || !isEditingOffers) {
      setOpenRowKey(null);
    }
  }, [loading, saving, isEditingOffers]);

  function addRow() {
    const rowKey = `new-${Math.random().toString(16).slice(2)}`;

    const startQty = 0;
    const startIsActive = true;

    const newRow: Row = {
      rowKey,
      offerId: null,
      deleteOfferId: null,
      variantId: null,
      kind: "BASE",
      unitPrice: 0,
      availableQty: startQty,
      isActive: startIsActive,
      inStock: deriveInStock(startIsActive, startQty),
      leadDays: "",
      hasOrders: false,
      isBlank: true,
      isNew: true,
    };

    setRows((prev) => [newRow, ...prev]);
    setOpenRowKey(rowKey);
  }

  async function deleteRow(row: Row) {
    if (!canEdit) return;

    if (!row.offerId) {
      setRows((prev) => prev.filter((r) => r.rowKey !== row.rowKey));
      return;
    }

    const variantSku = row.variantId
      ? variantsById.get(row.variantId)?.sku
      : null;

    const ok = window.confirm(
      `Delete this offer?\n\nSupplier: ${supplierName || supplierId || "—"
      }\nVariant: ${variantSku ?? "Base"}`
    );
    if (!ok) return;

    setSaving(true);
    setError("");

    try {
      await apiFetchJson(
        `/api/admin/supplier-offers/${encodeURIComponent(row.offerId)}`,
        { method: "DELETE" }
      );
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
      const blankRow = rows.find((r) => r.isBlank);
      if (blankRow) {
        throw new Error("Each row must pick base or a variant before saving.");
      }

      const replacing = rows.find((r) => !!r.deleteOfferId);
      if (replacing) {
        throw new Error(
          "Offers cannot be auto-deleted/replaced here. " +
          "Undo the variant change (select the original), or create a new row and leave the old one unchanged."
        );
      }

      const patchOffer = async (offerId: string, payload: any) => {
        return apiFetchJson<any>(
          `/api/admin/supplier-offers/${encodeURIComponent(offerId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
          }
        );
      };

      const postOffer = async (payload: any) => {
        return apiFetchJson<any>(
          `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        );
      };

      const setOfferId = (rowKey: string, newOfferId: string | null) => {
        setRows((prev) =>
          prev.map((r) =>
            r.rowKey === rowKey
              ? {
                ...r,
                offerId: newOfferId,
                deleteOfferId: null,
                isNew: newOfferId ? false : r.isNew,
                isBlank: false,
              }
              : r
          )
        );
      };

      for (const r of rows) {
        const comboError = getRowComboError(r);
        if (comboError) throw new Error(comboError);

        const qty = Math.max(0, Math.trunc(Number(r.availableQty) || 0));
        const isActive = !!r.isActive;
        const price = Math.max(0, safeNum(r.unitPrice, 0));

        if (price <= 0) {
          throw new Error("Price must be greater than 0.");
        }

        const leadDays =
          r.leadDays === "" || r.leadDays == null
            ? null
            : Math.max(0, Math.trunc(Number(r.leadDays) || 0));

        const variantId = r.variantId ? String(r.variantId).trim() : null;
        const offerId = r.offerId ? String(r.offerId) : null;

        const isExistingBase = !!offerId && offerId.startsWith("base:");
        const isExistingVariant = !!offerId && offerId.startsWith("variant:");

        // ---------------- BASE ROW ----------------
        if (variantId == null) {
          if (offerId) {
            const payload: any = {
              kind: "BASE" as const,
              price,
              currency: "NGN",
              availableQty: qty,
              isActive,
              leadDays,
            };

            // convert variant -> base
            if (isExistingVariant) {
              payload.variantId = null;
            }

            const res = await patchOffer(offerId, payload);

            const convertedTo =
              res && typeof res === "object" && "to" in res && (res as any).to
                ? String((res as any).to)
                : null;

            setOfferId(r.rowKey, convertedTo ?? offerId);
          } else {
            const out = await postOffer({
              kind: "BASE" as const,
              variantId: null,
              price,
              currency: "NGN",
              availableQty: qty,
              isActive,
              leadDays,
            });

            const dto = unwrap<any>(out);
            const createdId: string | null =
              (dto?.data?.id ? String(dto.data.id) : null) ??
              (dto?.id ? String(dto.id) : null);

            setOfferId(r.rowKey, createdId);
          }

          continue;
        }

        // ---------------- VARIANT ROW ----------------
        if (offerId) {
          const payload: any = {
            kind: "VARIANT" as const,
            variantId,
            price,
            currency: "NGN",
            availableQty: qty,
            isActive,
            leadDays,
          };

          // base -> variant conversion
          if (isExistingBase) {
            payload.variantId = variantId;
          }

          const res = await patchOffer(offerId, payload);

          const convertedTo =
            res && typeof res === "object" && "to" in res && (res as any).to
              ? String((res as any).to)
              : null;

          setOfferId(r.rowKey, convertedTo ?? offerId);
        } else {
          const out = await postOffer({
            kind: "VARIANT" as const,
            variantId,
            price,
            currency: "NGN",
            availableQty: qty,
            isActive,
            leadDays,
          });

          const dto = unwrap<any>(out);
          const createdId: string | null =
            (dto?.data?.id ? String(dto.data.id) : null) ??
            (dto?.id ? String(dto.id) : null);

          setOfferId(r.rowKey, createdId);
        }
      }

      await load();
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Save failed.");
    } finally {
      setSaving(false);
      setOpenRowKey(null);
    }
  }

  const saveDisabledReason = useMemo(() => {
    if (!canEdit) return "Not in edit mode";
    if (saving || loading) return "Busy";
    if (rows.length === 0) return "No rows";
    if (!supplierId) return "Product has no supplier";

    if (rows.some((r) => r.isBlank)) return "Each row must pick base or variant";

    for (const r of rows) {
      if (r.variantId != null) {
        const vid = sanitizeVariantId(r.variantId);
        if (!vid) return "Variant is required";
      }

      const p = safeNum(r.unitPrice, 0);
      if (p <= 0) return "Price must be greater than 0";
    }

    // only one BASE row
    const baseRows = rows.filter((r) => !r.isBlank && r.variantId == null).length;
    if (baseRows > 1) return "Only one BASE offer is allowed for this product";

    // no duplicate variants
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.variantId || r.isBlank) continue;
      if (seen.has(r.variantId)) return "Duplicate variant rows";
      seen.add(r.variantId);
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, canEdit, saving, loading, supplierId]);

  const saveButtonDisabled = !!saveDisabledReason;

  useEffect(() => {
    setRows((prev) =>
      prev.map((r) => {
        const qty = Math.max(0, Math.trunc(Number(r.availableQty) || 0));
        const nextInStock = deriveInStock(!!r.isActive, qty);
        if (r.inStock === nextInStock && r.availableQty === qty) return r;
        return { ...r, availableQty: qty, inStock: nextInStock };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.rowKey}:${r.availableQty}:${r.isActive}`).join("|")]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Supplier offers</div>
          <div className="text-sm text-slate-500">
            Offers for this product’s single supplier.
            {productTitle ? (
              <span className="ml-2 text-slate-400">({productTitle})</span>
            ) : null}
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-slate-500">Supplier</div>
              <input
                value={supplierName || supplierId || "—"}
                readOnly
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
            </div>
            <div>
              <div className="text-xs text-slate-500">Product SKU</div>
              <input
                value={productSku || "—"}
                readOnly
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
            </div>
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
        <table className="min-w-[1300px] w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left font-semibold w-[900px]">
                Variant
              </th>
              <th className="px-3 py-2 text-left font-semibold">Price</th>
              <th className="px-3 py-2 text-left font-semibold">Available</th>
              <th className="px-3 py-2 text-left font-semibold">Active</th>
              <th className="px-3 py-2 text-left font-semibold">Lead (days)</th>
              <th className="px-3 py-2 text-left font-semibold">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={6}>
                  {loading
                    ? "Loading..."
                    : "No offers yet. Click Add row to create one."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isCurrentBaseRow = !r.isBlank && r.variantId == null;
                const baseExistsElsewhere = rows.some(
                  (x) => x.rowKey !== r.rowKey && !x.isBlank && x.variantId == null
                );

                const variantChoices = variants.filter((v) => {
                  if (r.variantId === v.id) return true;
                  return !isVariantUsedElsewhere(v.id, r.rowKey);
                });

                const items: VariantItem[] = [
                  {
                    kind: "BLANK" as const,
                    label: "— Blank (free / temporary) —",
                  },
                  ...(!baseExistsElsewhere || isCurrentBaseRow
                    ? [
                      {
                        kind: "BASE" as const,
                        label: "— None (base offer) —",
                      },
                    ]
                    : []),
                  ...variantChoices.map((v) => ({
                    kind: "VARIANT" as const,
                    v,
                    label: variantDisplay(productSku, v),
                  })),
                ];

                const priceNum = safeNum(r.unitPrice, 0);
                const priceInputValue: string = priceNum <= 0 ? "" : String(priceNum);

                const comboError =
                  r.isBlank
                    ? "Pick a base offer or a variant."
                    : r.variantId == null
                      ? baseExistsElsewhere && !isCurrentBaseRow
                        ? "BASE offer already exists."
                        : null
                      : !sanitizeVariantId(r.variantId)
                        ? "Selected variant is invalid for this product."
                        : isVariantUsedElsewhere(r.variantId, r.rowKey)
                          ? "This variant already has an offer row."
                          : null;

                const comboHasError = canEdit && !!comboError;

                return (
                  <tr key={r.rowKey} className="border-t border-slate-200">
                    {/* Variant */}
                    <td className="px-3 py-2 w-[900px] min-w-[720px]">
                      <VariantComboBox
                        disabled={saving || !canEdit || r.hasOrders}
                        valueVariantId={r.variantId}
                        items={items}
                        onSelectBase={() => {
                          if (r.variantId == null && !r.isBlank) return;

                          if (baseExistsElsewhere && !isCurrentBaseRow) {
                            setError("A BASE offer already exists. You can’t add another base row.");
                            return;
                          }

                          snapRowToVariant(r.rowKey, null);
                        }}
                        onSelectVariant={(vid) => {
                          if (r.variantId === vid && !r.isBlank) return;

                          if (isVariantUsedElsewhere(vid, r.rowKey)) {
                            setError("This variant already has an offer row.");
                            return;
                          }

                          snapRowToVariant(r.rowKey, vid);
                        }}
                        onSelectBlank={() => {
                          if (!canEdit) return;
                          setRows((prev) =>
                            prev.map((x) =>
                              x.rowKey === r.rowKey
                                ? {
                                  ...x,
                                  isBlank: true,
                                  variantId: null,
                                }
                                : x
                            )
                          );
                        }}
                        placeholder="Select base or variant…"
                        isBlank={!!r.isBlank}
                        hasError={comboHasError}
                        isOpen={openRowKey === r.rowKey}
                        onRequestOpen={() => setOpenRowKey(r.rowKey)}
                        onRequestClose={() => {
                          if (openRowKey === r.rowKey) setOpenRowKey(null);
                        }}
                      />

                      {comboError ? (
                        <div className="mt-1 text-[11px] text-red-600">
                          {comboError}
                        </div>
                      ) : null}

                      {r.hasOrders ? (
                        <div className="mt-1 text-[11px] text-amber-700">
                          This offer has existing orders. Variant selection is locked.
                        </div>
                      ) : null}

                      {canEdit && r.deleteOfferId ? (
                        <div className="mt-1 text-[11px] text-amber-600">
                          Replacement pending (cannot auto-delete after orders)
                        </div>
                      ) : null}
                    </td>

                    {/* Price */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        className="w-[180px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-right"
                        value={priceInputValue}
                        placeholder="—"
                        onChange={(e) => {
                          const raw = e.target.value;
                          const next = raw === "" ? 0 : safeNum(raw, 0);

                          setRows((prev) =>
                            prev.map((x) =>
                              x.rowKey === r.rowKey
                                ? { ...x, unitPrice: Math.max(0, next) }
                                : x
                            )
                          );
                        }}
                        onBlur={() => {
                          if (safeNum(r.unitPrice, 0) < 0) {
                            setRows((prev) =>
                              prev.map((x) =>
                                x.rowKey === r.rowKey
                                  ? { ...x, unitPrice: 0 }
                                  : x
                              )
                            );
                          }
                        }}
                        disabled={saving || !canEdit}
                      />

                      {priceNum > 0 ? (
                        <div className="mt-1 text-xs text-slate-500">
                          {formatNgn(priceNum)}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-400">
                          Enter price
                        </div>
                      )}
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
                          const nextInStock = deriveInStock(!!r.isActive, v);

                          setRows((prev) =>
                            prev.map((x) =>
                              x.rowKey === r.rowKey
                                ? {
                                  ...x,
                                  availableQty: v,
                                  inStock: nextInStock,
                                }
                                : x
                            )
                          );
                        }}
                        disabled={saving || !canEdit}
                      />
                    </td>

                    {/* Active */}
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={r.isActive}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const nextInStock = deriveInStock(checked, r.availableQty);

                          setRows((prev) =>
                            prev.map((x) =>
                              x.rowKey === r.rowKey
                                ? {
                                  ...x,
                                  isActive: checked,
                                  inStock: nextInStock,
                                }
                                : x
                            )
                          );
                        }}
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
                          const v =
                            e.target.value === ""
                              ? ""
                              : safeNum(e.target.value, 0);
                          setRows((prev) =>
                            prev.map((x) =>
                              x.rowKey === r.rowKey
                                ? { ...x, leadDays: v }
                                : x
                            )
                          );
                        }}
                        disabled={saving || !canEdit}
                      />
                    </td>

                    {/* Actions */}
                    {canEdit ? (
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => deleteRow(r)}
                          className="rounded-xl border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                          disabled={saving || !canEdit || r.hasOrders}
                        >
                          Delete
                        </button>

                        {r.hasOrders && (
                          <div className="mt-1 text-[11px] text-amber-700">
                            Locked because this offer has been used in orders.
                          </div>
                        )}
                      </td>
                    ) : (
                      <td className="px-3 py-2 text-slate-400">—</td>
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

          <div className="flex items-center gap-3">
            {saveDisabledReason ? (
              <div className="text-xs text-slate-500">
                {saveDisabledReason}
              </div>
            ) : null}

            <button
              type="button"
              onClick={saveAll}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              disabled={saveButtonDisabled}
              title={saveDisabledReason ?? ""}
            >
              {saving ? "Saving..." : "Save all changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}