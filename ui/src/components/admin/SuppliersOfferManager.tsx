import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * SuppliersOfferManager.tsx
 *
 * ✅ Cookie auth (NO bearer tokens):
 * - All requests use credentials: "include"
 * - Removed all localStorage/sessionStorage token scanning
 *
 * ✅ Uses ONLY these endpoints (no fallbacks):
 * - GET  /api/admin/products/:productId/supplier-offers
 * - POST /api/admin/products/:productId/supplier-offers
 * - PATCH /api/admin/supplier-offers/:id
 * - DELETE /api/admin/supplier-offers/:id
 *
 * ✅ One price field in API payloads ONLY: `price`
 *   - BASE row:     price -> SupplierProductOffer.basePrice
 *   - VARIANT row:  price -> SupplierVariantOffer.unitPrice (FULL unit price)
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

  supplierId: string;
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
};

type Row = {
  rowKey: string;

  /** Current backend offer id for this row (null if new / not saved yet) */
  offerId: string | null;

  /**
   * If user changes combo to a NEW combo, we remember old offerId here.
   * ✅ We DO NOT auto delete on Save (deletes may be blocked after orders).
   */
  deleteOfferId: string | null;

  supplierId: string;
  variantId: string | null;

  kind: OfferKind;

  /**
   * One editable price in UI:
   *  - BASE row: basePrice
   *  - VARIANT row: unitPrice (full)
   *
   * NOTE: internal number value (0 means blank in UI)
   */
  unitPrice: number;

  availableQty: number;
  isActive: boolean;

  // display-only / derived
  inStock: boolean;

  leadDays: number | "" | null;
};

type Props = {
  productId: string;

  variants?: Variant[];
  suppliers?: Supplier[];

  // kept for compatibility; NOT used (cookie auth)
  token?: string | null;

  readOnly?: boolean;

  fixedSupplierId?: string | null;
  defaultUnitCost?: number; // kept for compatibility; not used to auto-fill
  onSaved?: () => void;
};

/* ------------------------------ UI Combobox ------------------------------ */

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
        className={`w-full rounded-xl border px-3 py-2 text-left ${
          disabled ? "bg-slate-100 border-slate-200 text-slate-500" : "bg-white border-slate-300"
        }`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? "Select supplier first" : selectedLabel}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="whitespace-normal break-words leading-snug">{selectedLabel || "— Select —"}</span>
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
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${idx === active ? "bg-slate-50" : ""}`}
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

/* ------------------------------ Cookie fetch helper ------------------------------ */

async function apiFetchJson<T>(path: string, opts: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  const headers = new Headers(opts.headers || {});
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && opts.body) headers.set("Content-Type", "application/json");

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

function variantDisplay(productSku: string, v: Variant) {
  const prefix = productSku ? `${productSku}-` : "";
  const skuOrFallback = v.sku && v.sku.trim() ? v.sku.trim() : v.id.slice(-6);
  const skuPart = `${prefix}${skuOrFallback}`;
  return v.label ? `${skuPart} — ${v.label}` : skuPart;
}

function deriveKindFromOffer(o: OfferApi): OfferKind {
  if (o.kind === "BASE" || o.kind === "VARIANT") return o.kind;
  const vid = normalizeId(o.variantId);
  if (vid) return "VARIANT";
  const id = String(o.id || "");
  if (id.startsWith("variant:")) return "VARIANT";
  return "BASE";
}

function makeBaseOfferMap(offers: OfferApi[]) {
  const m = new Map<string, OfferApi>();
  for (const o of offers) {
    const k = deriveKindFromOffer(o);
    if (k === "BASE") m.set(o.supplierId, { ...o, kind: "BASE" });
  }
  return m;
}

/* -------------------------------- Component -------------------------------- */

export default function SuppliersOfferManager({
  productId,
  variants: variantsProp,
  suppliers: suppliersProp,
  // token prop ignored (cookie auth)
  token: _tokenIgnored,
  readOnly,
  fixedSupplierId,
  defaultUnitCost: _defaultUnitCostIgnored, // kept for compatibility
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

  const allowedVariantIds = useMemo(() => new Set((variants ?? []).map((v) => String(v.id))), [variants]);

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
    for (const raw of offersLoaded) {
      if (!raw?.supplierId) continue;
      const o: OfferApi = { ...raw, kind: deriveKindFromOffer(raw) };
      const vid = (o.variantId ?? null) as string | null;
      m.set(comboKey(o.supplierId, vid), o);
    }
    return m;
  }, [offersLoaded]);

  // kept (not used for save logic, but harmless if referenced elsewhere)
  const baseOfferBySupplier = useMemo(() => makeBaseOfferMap(offersLoaded), [offersLoaded]);

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

  function isVariantUsedElsewhere(sid: string, variantId: string, rowKey: string) {
    if (!sid || !variantId) return false;
    return rows.some((r) => {
      const rsid = fixedSupplierId ?? r.supplierId;
      return r.rowKey !== rowKey && rsid === sid && r.variantId === variantId;
    });
  }

  const sanitizeVariantId = (raw: any): string | null => {
    const vid = normalizeId(raw);
    if (!vid) return null;
    if (allowedVariantIds.size === 0) return vid;
    return allowedVariantIds.has(vid) ? vid : null;
  };

  function deriveInStock(isActive: boolean, availableQty: number) {
    return !!isActive && Math.max(0, Math.trunc(Number(availableQty) || 0)) > 0;
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
      supplierId: o.supplierId,
      variantId: isVariant ? rawVid : null,
      kind: isVariant ? "VARIANT" : "BASE",
      unitPrice: Math.max(0, safeNum(price, 0)),
      availableQty: qty,
      isActive,
      inStock: deriveInStock(isActive, qty),
      leadDays: o.leadDays ?? "",
    };
  }

  function snapRowToCombo(rowKey: string, supplierId: string, variantId: string | null) {
    if (variantId && allowedVariantIds.size > 0 && !allowedVariantIds.has(String(variantId))) {
      setError("Selected variant does not belong to this product.");
      variantId = null;
    }

    const existing = supplierId ? offersByCombo.get(comboKey(supplierId, variantId)) : undefined;

    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;

        const currentSupplier = fixedSupplierId ?? r.supplierId;
        const sameSupplier = String(currentSupplier || "") === String(supplierId || "");
        const sameVariant = (r.variantId ?? null) === (variantId ?? null);
        if (sameSupplier && sameVariant) return r;

        if (existing) {
          const hydrated = offerToRow(existing);
          return {
            ...r,
            ...hydrated,
            rowKey: r.rowKey,
            deleteOfferId: r.deleteOfferId ?? null,
          };
        }

        const nextKind: OfferKind = variantId ? "VARIANT" : "BASE";

        const keptQty = Math.max(0, Math.trunc(Number(r.availableQty ?? 0) || 0));
        const keptIsActive = !!r.isActive;
        const keptPrice = Math.max(0, safeNum(r.unitPrice, 0));
        const keptLead = r.leadDays ?? "";

        const idToDelete = r.offerId ? r.offerId : null;

        return {
          ...r,
          deleteOfferId: idToDelete ?? r.deleteOfferId ?? null,
          offerId: null,
          supplierId,
          variantId,
          kind: nextKind,
          unitPrice: keptPrice,
          availableQty: keptQty,
          isActive: keptIsActive,
          inStock: deriveInStock(keptIsActive, keptQty),
          leadDays: keptLead,
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
      const productPromise = apiFetchJson<any>(
        `/api/admin/products/${encodeURIComponent(productId)}?include=variants,ProductVariant,productVariants`,
        { signal: ac.signal }
      );

      const suppliersPromise =
        !suppliersProp || suppliersProp.length === 0
          ? apiFetchJson<any>(`/api/admin/suppliers`, { signal: ac.signal })
          : Promise.resolve({ data: suppliersProp ?? [] } as any);

      const offersPromise = apiFetchJson<any>(
        `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
        { signal: ac.signal }
      );

      const [pRaw, sRaw, oRaw] = await Promise.all([productPromise, suppliersPromise, offersPromise]);

      const p = pRaw ? unwrap<any>(pRaw) : null;
      const s = unwrap<any>(sRaw);
      const o = unwrap<any>(oRaw);

      if (p) {
        setProductTitle(p?.title || "");
        setProductSku(p?.sku || "");
        setVariants(extractVariantsFromProduct(p));
      }

      const suppliersArr: Supplier[] = Array.isArray(s) ? s : Array.isArray(s?.data) ? s.data : [];
      if (suppliersArr) setSuppliers(suppliersArr);

      const offersArr: OfferApi[] = Array.isArray(o) ? o : Array.isArray(o?.data) ? o.data : [];
      const filteredOffers = (offersArr || [])
        .filter((of) => String(of?.productId) === String(productId))
        .map((of) => ({ ...of, kind: deriveKindFromOffer(of) }));

      const productVariants = p ? extractVariantsFromProduct(p) : [];
      const seededFromOffers: Variant[] = filteredOffers
        .filter((x) => deriveKindFromOffer(x) === "VARIANT" && x.variantId)
        .map((x) => ({
          id: String(x.variantId),
          sku: x.variantSku != null ? String(x.variantSku) : null,
        }));

      const mergedVariants = (() => {
        const m = new Map<string, Variant>();
        for (const v of productVariants) m.set(v.id, v);
        for (const v of seededFromOffers) if (!m.has(v.id)) m.set(v.id, v);
        return Array.from(m.values());
      })();

      if (mergedVariants.length > 0) setVariants(mergedVariants);

      setOffersLoaded(filteredOffers);

      const backendRows = filteredOffers
        .filter((x) => x?.id && x?.supplierId)
        .map((x) => offerToRow(x));

      // Preserve current UI order
      setRows((prev) => {
        const byId = new Map<string, Row>();
        const byCombo = new Map<string, Row>();

        for (const br of backendRows) {
          if (br.offerId) byId.set(br.offerId, br);
          const k = comboKey(br.supplierId, br.variantId);
          byCombo.set(k, br);
        }

        const usedIds = new Set<string>();
        const usedCombos = new Set<string>();

        const merged: Row[] = prev.map((r) => {
          const matchById = r.offerId ? byId.get(r.offerId) : undefined;
          const matchByCombo = !matchById ? byCombo.get(comboKey(r.supplierId, r.variantId)) : undefined;
          const match = matchById ?? matchByCombo;

          if (!match) return r;

          if (match.offerId) usedIds.add(match.offerId);
          usedCombos.add(comboKey(match.supplierId, match.variantId));

          return {
            ...r,
            offerId: match.offerId,
            supplierId: match.supplierId,
            variantId: match.variantId,
            kind: match.kind,
            unitPrice: match.unitPrice,
            availableQty: match.availableQty,
            isActive: match.isActive,
            inStock: match.inStock,
            leadDays: match.leadDays,
            deleteOfferId: r.deleteOfferId ?? null,
            rowKey: r.rowKey,
          };
        });

        const tail: Row[] = [];
        for (const br of backendRows) {
          const idOk = br.offerId ? !usedIds.has(br.offerId) : true;
          const comboOk = !usedCombos.has(comboKey(br.supplierId, br.variantId));
          if (idOk && comboOk) tail.push(br);
        }

        return [...merged, ...tail];
      });
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

    const startQty = 0;
    const startIsActive = true;

    const newRow: Row = {
      rowKey,
      offerId: null,
      deleteOfferId: null,
      supplierId: startSupplierId,
      variantId: null,
      kind: "BASE",
      unitPrice: 0,
      availableQty: startQty,
      isActive: startIsActive,
      inStock: deriveInStock(startIsActive, startQty),
      leadDays: "",
    };

    setRows((prev) => [newRow, ...prev]);
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
      await apiFetchJson(`/api/admin/supplier-offers/${encodeURIComponent(row.offerId)}`, { method: "DELETE" });
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
      const replacing = rows.find((r) => !!r.deleteOfferId);
      if (replacing) {
        throw new Error(
          "This product has order history, so offers cannot be deleted/replaced. " +
            "Undo the supplier/variant combo change (select the original combo), " +
            "or create a new row and leave the old one unchanged (or delete manually if allowed)."
        );
      }

      const patchOffer = async (offerId: string, payload: any) => {
        return apiFetchJson<any>(`/api/admin/supplier-offers/${encodeURIComponent(offerId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      };

      const postOffer = async (payload: any) => {
        return apiFetchJson<any>(`/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      };

      const setOfferId = (rowKey: string, newOfferId: string | null) => {
        setRows((prev) =>
          prev.map((r) =>
            r.rowKey === rowKey
              ? {
                  ...r,
                  offerId: newOfferId,
                  deleteOfferId: null,
                }
              : r
          )
        );
      };

      for (const r of rows) {
        const sid = fixedSupplierId ?? r.supplierId;
        if (!sid) throw new Error("Each row must have a supplier selected.");

        const qty = Math.max(0, Math.trunc(Number(r.availableQty) || 0));
        const isActive = !!r.isActive;

        const price = Math.max(0, safeNum(r.unitPrice, 0));
        if (price <= 0) throw new Error("Price must be greater than 0.");

        const leadDays =
          r.leadDays === "" || r.leadDays == null ? null : Math.max(0, Math.trunc(Number(r.leadDays) || 0));

        if (r.variantId == null) {
          // BASE
          if (r.offerId) {
            const payload = {
              supplierId: sid,
              price,
              currency: "NGN",
              availableQty: qty,
              isActive,
              leadDays,
            };

            await patchOffer(r.offerId, payload);
            setOfferId(r.rowKey, r.offerId);
          } else {
            const payload = {
              kind: "BASE" as const,
              supplierId: sid,
              variantId: null,
              price,
              currency: "NGN",
              availableQty: qty,
              isActive,
              leadDays,
            };

            const out = await postOffer(payload);
            const dto = unwrap<any>(out);
            const createdId: string | null = (dto?.data?.id ? String(dto.data.id) : null) ?? (dto?.id ? String(dto.id) : null);

            setOfferId(r.rowKey, createdId);
          }
        } else {
          // VARIANT
          const vid = sanitizeVariantId(r.variantId);
          if (!vid) throw new Error("Each VARIANT row must have a valid variant selected.");

          if (r.offerId) {
            const payload = {
              supplierId: sid,
              variantId: vid,
              price,
              currency: "NGN",
              availableQty: qty,
              isActive,
              leadDays,
            };

            await patchOffer(r.offerId, payload);
            setOfferId(r.rowKey, r.offerId);
          } else {
            const payload = {
              kind: "VARIANT" as const,
              supplierId: sid,
              variantId: vid,
              price,
              currency: "NGN",
              availableQty: qty,
              isActive,
              leadDays,
            };

            const out = await postOffer(payload);
            const dto = unwrap<any>(out);
            const createdId: string | null = (dto?.data?.id ? String(dto.data.id) : null) ?? (dto?.id ? String(dto.id) : null);

            setOfferId(r.rowKey, createdId);
          }
        }
      }

      await load();
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const saveDisabledReason = useMemo(() => {
    if (!canEdit) return "Not in edit mode";
    if (saving || loading) return "Busy";
    if (rows.length === 0) return "No rows";

    for (const r of rows) {
      const sid = fixedSupplierId ?? r.supplierId;
      if (!sid) return "Supplier is required";

      if (r.variantId != null) {
        const vid = sanitizeVariantId(r.variantId);
        if (!vid) return "Variant is required";
      }

      const p = safeNum(r.unitPrice, 0);
      if (p <= 0) return "Price must be greater than 0";
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, canEdit, saving, loading, fixedSupplierId]);

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
            Link supplier offers to this product and its variants.
            {productTitle ? <span className="ml-2 text-slate-400">({productTitle})</span> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={() => setIsEditingOffers((v) => !v)}
              className={`rounded-xl px-3 py-2 text-sm border ${
                isEditingOffers
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
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-[1500px] w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left font-semibold w-[260px]">Supplier</th>
              <th className="px-3 py-2 text-left font-semibold w-[900px]">Variant</th>
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
                <td className="px-3 py-6 text-slate-500" colSpan={7}>
                  {loading ? "Loading..." : "No supplier offers yet. Click Add row to create one."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const supplierIdShown = fixedSupplierId ?? r.supplierId;
                const supplierOk = !!supplierIdShown;

                const baseDisabled = !!supplierIdShown && hasOtherBaseRow(supplierIdShown, r.rowKey);

                const usedSet = supplierIdShown ? usedVariantIdsBySupplier.get(supplierIdShown) : undefined;
                const usedOther = new Set<string>();
                if (usedSet) for (const id of usedSet) if (id !== r.variantId) usedOther.add(id);

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

                const priceNum = safeNum(r.unitPrice, 0);
                const priceInputValue: string = priceNum <= 0 ? "" : String(priceNum);

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

                      {canEdit && r.deleteOfferId ? (
                        <div className="mt-1 text-[11px] text-amber-600">
                          Replacement pending (cannot auto-delete after orders)
                        </div>
                      ) : null}
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

                          if (r.variantId == null) return;

                          if (hasOtherBaseRow(sid, r.rowKey)) {
                            setError("This supplier already has a BASE offer row. You can’t add another base row.");
                            return;
                          }
                          snapRowToCombo(r.rowKey, sid, null);
                        }}
                        onSelectVariant={(vid) => {
                          const sid = fixedSupplierId ?? r.supplierId;
                          if (!sid) return;

                          if (r.variantId === vid) return;

                          if (isVariantUsedElsewhere(sid, vid, r.rowKey)) {
                            setError("This variant combo is already used for this supplier.");
                            return;
                          }

                          snapRowToCombo(r.rowKey, sid, vid);
                        }}
                      />

                      {!supplierIdShown ? <div className="mt-1 text-xs text-amber-600">Select supplier first</div> : null}

                      {baseDisabled ? (
                        <div className="mt-1 text-[11px] text-slate-400">Base offer already exists for this supplier.</div>
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
                            prev.map((x) => (x.rowKey === r.rowKey ? { ...x, unitPrice: Math.max(0, next) } : x))
                          );
                        }}
                        onBlur={() => {
                          if (safeNum(r.unitPrice, 0) < 0) {
                            setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, unitPrice: 0 } : x)));
                          }
                        }}
                        disabled={saving || !canEdit || !supplierOk}
                      />

                      {priceNum > 0 ? (
                        <div className="mt-1 text-xs text-slate-500">{formatNgn(priceNum)}</div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-400">Enter price</div>
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
                              x.rowKey === r.rowKey ? { ...x, availableQty: v, inStock: nextInStock } : x
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
                              x.rowKey === r.rowKey ? { ...x, isActive: checked, inStock: nextInStock } : x
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

          <div className="flex items-center gap-3">
            {saveDisabledReason ? <div className="text-xs text-slate-500">{saveDisabledReason}</div> : null}

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
