// src/components/admin/ManageProducts.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import StatusDot from "../StatusDot";
import { Search } from "lucide-react";
import { useModal } from "../ModalProvider";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounced } from "../../utils/useDebounced";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client";
import { getHttpErrorMessage } from "../../utils/httpError";
import SuppliersOfferManager from "./SuppliersOfferManager";

/* ============================
   Types
============================ */


// ============================
// Offer summary helpers (ManageProducts)
// ============================

type SupplierOfferLite = {
  id: string;
  productId: string;
  variantId?: string | null;
  supplierId: string;
  supplierName?: string;
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number;
  available?: number;
  qty?: number;
  stock?: number;
};

function coerceQty(o: SupplierOfferLite): number {
  const raw = o.availableQty ?? o.available ?? o.qty ?? o.stock ?? 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * IMPORTANT:
 * - "offerCount" should be TOTAL rows (even if qty=0)
 * - "availableTotal" should be SUM of qty where row is active+inStock+qty>0
 */
export function buildOfferSummaryByProduct(
  offers: SupplierOfferLite[]
): Map<string, { availableTotal: number; offerCount: number }> {
  const map = new Map<string, { availableTotal: number; offerCount: number }>();

  for (const o of offers ?? []) {
    const pid = String(o.productId);
    const cur = map.get(pid) ?? { availableTotal: 0, offerCount: 0 };

    // Count ALL offers for that product (even if qty=0)
    cur.offerCount += 1;

    // Available is only from offers that actually have qty > 0 and are active+inStock
    const qty = coerceQty(o);
    const active = o.isActive != null ? !!o.isActive : true;
    const inStock = o.inStock != null ? !!o.inStock : qty > 0;

    if (active && inStock && qty > 0) {
      cur.availableTotal += qty;
    }

    map.set(pid, cur);
  }

  return map;
}


type AdminProduct = {
  id: string;
  title: string;
  price: number | string;
  status: string;
  imagesJson?: string[] | string;
  createdAt?: string;
  retailPrice?: number | string | null;
  isDeleted?: boolean;
  isDelete?: boolean;

  ownerId?: string | null;
  userId?: string | null;

  supplierId?: string | null;

  availableQty?: number;
  supplierOffers?: SupplierOfferLite[];
  ownerEmail?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  sku?: string | null;
  inStock?: boolean;

  variants?: any[];
  variantCount?: number;

  createdByEmail?: string | null;
  createdBy?: { email?: string | null };
  owner?: { email?: string | null };
  description?: string | null;

  // derived debug (optional)
  __baseQty?: number;
  __offerQty?: number;
  __offerCount?: number;
};

type AdminSupplier = {
  id: string;
  name: string;
  type: "PHYSICAL" | "ONLINE";
  status: string;
  userId?: string | null;
  contactEmail?: string | null;
  whatsappPhone?: string | null;
  apiBaseUrl?: string | null;
  apiAuthType?: "NONE" | "BEARER" | "BASIC" | null;
  apiKey?: string | null;
  payoutMethod?: "SPLIT" | "TRANSFER" | null;
  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  isPayoutEnabled?: boolean | null;
};

type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  position?: number | null;
  isActive: boolean;
};

type AdminBrand = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  isActive: boolean;
};

type AdminAttributeValue = {
  id: string;
  name: string;
  code?: string | null;
  attributeId: string;
  position?: number | null;
  isActive: boolean;
};

type AdminAttribute = {
  id: string;
  name: string;
  type: "TEXT" | "SELECT" | "MULTISELECT";
  placeholder?: string | null;
  isActive: boolean;
  values?: AdminAttributeValue[];
};

type FilterPreset =
  | "all"
  | "no-offer"
  | "live"
  | "published-with-offer"
  | "published-no-offer"
  | "published-with-active"
  | "published-base-in"
  | "published-base-out"
  | "with-variants"
  | "simple"
  | "published-with-availability"
  | "published"
  | "pending"
  | "rejected";

type VariantRow = {
  id: string;
  selections: Record<string, string>; // attributeId -> valueId
  priceBump: string;

  // optional (safe defaults)
  inStock?: boolean;
  availableQty?: number;
  imagesJson?: string[];
};

/* ============================
   Helpers
============================ */

function statusFromPreset(p: FilterPreset): "ANY" | "PUBLISHED" | "PENDING" | "REJECTED" | "LIVE" {
  if (p.startsWith("published")) return "PUBLISHED";
  if (p === "published") return "PUBLISHED";
  if (p === "pending") return "PENDING";
  if (p === "live") return "LIVE";
  if (p === "rejected") return "REJECTED";
  return "ANY";
}

function coerceBool(v: any, def = true) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|1|yes|y)$/i.test(v.trim());
  if (v == null) return def;
  return Boolean(v);
}

function toInt(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
}

function availOf(o: any): number {
  const candidates = [o?.availableQty, o?.available, o?.qty, o?.stock];

  const parseNum = (v: any) => {
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v);
    if (v && typeof v === "object" && typeof v.toString === "function") {
      const s = String(v.toString());
      return Number(s);
    }
    return NaN;
  };

  for (const v of candidates) {
    const n = parseNum(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

function normalizeNullableId(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s === "null" || s === "undefined") return null;
  return s;
}

async function fetchSupplierOffersForProduct(productId: string, token?: string | null) {
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

  const attempts = [
    `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
    `/api/admin/supplier-offers?productId=${encodeURIComponent(productId)}`,
  ];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url, { headers: hdr });
      const root = data?.data?.data ?? data?.data ?? data;
      const arr = Array.isArray(root) ? root : Array.isArray(root?.data) ? root.data : [];
      return arr as any[];
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) continue;
      throw e;
    }
  }

  return [];
}

function normalizeId(x: any): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s || s === "null" || s === "undefined") return null;
  return s;
}

async function persistVariantsStrict(
  productId: string,
  variants: any[],
  token?: string | null,
  opts?: { replace?: boolean }
) {
  const replace = opts?.replace ?? true;
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

  const clean = (variants || []).map((v) => {
    const id = normalizeId(v?.id);
    const sku = String(v?.sku ?? "").trim();

    return {
      ...(id ? { id } : {}),
      ...(!id && sku ? { sku } : {}),
      options: (v?.options || v?.optionSelections || []).map((o: any) => {
        const rawPb = o?.priceBump;
        const n = rawPb === "" || rawPb == null ? NaN : Number(rawPb);

        return {
          attributeId: o.attributeId || o.attribute?.id,
          valueId: o.valueId || o.attributeValueId || o.value?.id,
          priceBump: Number.isFinite(n) ? n : null,
        };
      }),
    };
  });

  const attempts: Array<{ method: "post" | "put"; url: string; body: any }> = [
    {
      method: "post",
      url: `/api/admin/products/${encodeURIComponent(productId)}/variants/bulk`,
      body: { variants: clean, replace },
    },
    {
      method: "post",
      url: `/api/admin/products/${encodeURIComponent(productId)}/variants/bulk-replace`,
      body: { variants: clean, replace },
    },
    {
      method: "put",
      url: `/api/admin/products/${encodeURIComponent(productId)}/variants`,
      body: { variants: clean, replace },
    },
    {
      method: "post",
      url: `/api/admin/products/${encodeURIComponent(productId)}/variants`,
      body: { variants: clean, replace },
    },
    {
      method: "post",
      url: `/api/admin/variants/bulk?productId=${encodeURIComponent(productId)}`,
      body: { variants: clean, replace },
    },
  ];

  let lastErr: any = null;

  for (const a of attempts) {
    try {
      const req =
        a.method === "put" ? api.put(a.url, a.body, { headers: hdr }) : api.post(a.url, a.body, { headers: hdr });
      const { data } = await req;
      return data;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404 || status === 405) {
        lastErr = e;
        continue;
      }
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || "Failed to persist variants";
      console.error("persistVariantsStrict error:", status, e?.response?.data || e);
      throw new Error(msg);
    }
  }

  console.error("No variants bulk endpoint found. Last error:", lastErr?.response?.status, lastErr?.response?.data);
  throw new Error("Your API does not expose a variants bulk endpoint. Add one server-side or update the frontend to match your backend route.");
}

type AttrDef = { id: string; name?: string };
const rowKey = (row: VariantRow, index: number) => String(row?.id ?? index);

function buildComboKey(row: VariantRow, attrs: AttrDef[]): string {
  const parts = attrs.map((a) => `${a.id}:${String(row?.selections?.[a.id] ?? "").trim()}`);
  const allEmpty = parts.every((p) => p.endsWith(":"));
  return allEmpty ? "" : parts.join("|");
}

function findDuplicateCombos(rows: VariantRow[], attrs: AttrDef[]): Record<string, string> {
  const keyToRows = new Map<string, string[]>();

  rows.forEach((r, idx) => {
    const ck = buildComboKey(r, attrs);
    if (!ck) return;
    const rk = rowKey(r, idx);
    const list = keyToRows.get(ck) ?? [];
    list.push(rk);
    keyToRows.set(ck, list);
  });

  const errors: Record<string, string> = {};
  for (const [, list] of keyToRows.entries()) {
    if (list.length <= 1) continue;
    list.forEach((rk) => {
      errors[rk] = "Duplicate variant combination. Each row’s Size/Volume/Weight combo must be unique.";
    });
  }
  return errors;
}

/* ============================
   Component
============================ */

export function ManageProducts({
  role,
  token,
  search,
  setSearch,
  focusId,
  onFocusedConsumed,
}: {
  role: string;
  token?: string | null;
  search: string;
  setSearch: (s: string) => void;
  focusId: string | null;
  onFocusedConsumed: () => void;
}) {
  const { openModal } = useModal();
  const isSuper = role === "SUPER_ADMIN";
  const isAdmin = role === "ADMIN";
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const qc = useQueryClient();
  const staleTImeInSecs = 300_000;

  // ✅ FIX #1: stop spamming /has-orders when route doesn't exist (404)
  // unknown -> we probe once; unsupported -> we never call again
  const hasOrdersSupportRef = useRef<"unknown" | "supported" | "unsupported">("unknown");
  const hasOrdersProbeDoneRef = useRef(false);

  const ngn = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  });

  const getRetailPrice = (p: any) => {
    const v = p?.retailPrice ?? p?.price ?? 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const extractProductVariants = (p: any): any[] => {
    if (Array.isArray(p?.variants)) return p.variants;
    if (Array.isArray(p?.ProductVariant)) return p.ProductVariant;
    if (Array.isArray(p?.productVariants)) return p.productVariants;
    return [];
  };

  /* ---------------- Tabs / Filters ---------------- */

  const [searchParams, setSearchParams] = useSearchParams();
  const urlPreset = (searchParams.get("view") as FilterPreset) || "all";
  const [preset, setPreset] = useState<FilterPreset>(urlPreset);

  useEffect(() => {
    setPreset((searchParams.get("view") as FilterPreset) || "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  function setPresetAndUrl(next: FilterPreset) {
    setPreset(next);
    const sp = new URLSearchParams(searchParams);
    if (next && next !== "all") sp.set("view", next);
    else sp.delete("view");
    setSearchParams(sp, { replace: true });
  }

  type SortKey = "title" | "price" | "avail" | "stock" | "status" | "owner";
  type SortDir = "asc" | "desc";
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "title", dir: "asc" });

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const SortIndicator = ({ k }: { k: SortKey }) => {
    if (sort.key !== k) return <span className="opacity-50">↕</span>;
    return <span>{sort.dir === "asc" ? "↑" : "↓"}</span>;
  };

  const statusParam = statusFromPreset(preset);

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => setSearchInput(search), [search]);
  const debouncedSearch = useDebounced(searchInput, 350);

  /* ---------------- Queries ---------------- */

  const listQ = useQuery<AdminProduct[]>({
    queryKey: ["admin", "products", "manage", { q: debouncedSearch, statusParam }],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get("/api/admin/products", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          status: statusParam,
          q: debouncedSearch,
          take: 50,
          skip: 0,
          include: "owner,variants,supplierOffers",
        },
      });
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return (arr ?? []) as AdminProduct[];
    },
    staleTime: staleTImeInSecs,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (listQ.isError) {
      const e: any = listQ.error;
      console.error("Products list failed:", e?.response?.status, e?.response?.data || e?.message);
    }
  }, [listQ.isError, listQ.error]);

  const rows = listQ.data ?? [];

  /**
   * productId -> Set(variantIds)
   */
  const validVariantIdsByProduct = useMemo(() => {
    const by: Record<string, Set<string>> = {};
    for (const p of rows) {
      const set = new Set<string>();
      const vars = extractProductVariants(p);
      for (const v of vars) {
        const id = v?.id ?? v?.variantId;
        if (id != null && String(id).trim() !== "") set.add(String(id));
      }
      by[p.id] = set;
    }
    return by;
  }, [rows]);

  const variantIdsHash = useMemo(() => {
    return rows
      .map((p) => {
        const set = validVariantIdsByProduct[p.id];
        const ids = set ? Array.from(set).sort().join(",") : "";
        return `${p.id}:${ids}`;
      })
      .join("|");
  }, [rows, validVariantIdsByProduct]);

  const offersSummaryQ = useQuery({
    queryKey: ["admin", "products", "offers-summary", { ids: rows.map((r) => r.id), variantIdsHash }],
    enabled: !!token && rows.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const productIds = rows.map((r) => r.id);
      if (!productIds.length) return {};

      const qs = new URLSearchParams();
      qs.set("productIds", productIds.join(","));

      const { data } = await api.get(`/api/admin/supplier-offers?${qs}`, { headers: hdr });

      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const offers = (arr as SupplierOfferLite[]).filter((o) => !!(o as any));

      const byProduct: Record<
        string,
        {
          // availability (qty-based)
          totalAvailable: number;
          baseAvailable: number;
          variantAvailable: number;

          // ✅ counts (row-based)
          offerCountTotal: number; // ALL rows (even qty=0)
          activeOfferCount: number; // active rows (even qty=0) - optional
          inStock: boolean;

          perSupplier: Array<{ supplierId: string; supplierName?: string; availableQty: number }>;
        }
      > = {};

      for (const o of offers) {
        const rawPid = (o as any)?.productId?.id ?? (o as any)?.product?.id ?? (o as any)?.productId;
        const pid = normalizeNullableId(rawPid);
        if (!pid) continue;

        const rawSid = (o as any)?.supplierId?.id ?? (o as any)?.supplier?.id ?? (o as any)?.supplierId;
        const supplierId = normalizeNullableId(rawSid) ?? "";

        const rawVid = (o as any)?.variantId?.id ?? (o as any)?.variant?.id ?? (o as any)?.variantId;
        const vid = normalizeNullableId(rawVid);

        const isActive = coerceBool((o as any).isActive, true);
        const isInStock = coerceBool((o as any).inStock, true);
        const availableQty = availOf(o) || toInt((o as any).availableQty, 0) || 0;

        if (!byProduct[pid]) {
          byProduct[pid] = {
            totalAvailable: 0,
            baseAvailable: 0,
            variantAvailable: 0,

            offerCountTotal: 0,
            activeOfferCount: 0,

            perSupplier: [],
            inStock: false,
          };
        }

        // ✅ count ALL offer rows (even if qty=0, even if inactive)
        byProduct[pid].offerCountTotal += 1;

        // optional: count active rows (still regardless of qty)
        if (isActive) byProduct[pid].activeOfferCount += 1;

        // ✅ availability uses qty + active + inStock
        if (isActive && isInStock && availableQty > 0) {
          byProduct[pid].totalAvailable += availableQty;

          if (vid) byProduct[pid].variantAvailable += availableQty;
          else byProduct[pid].baseAvailable += availableQty;

          byProduct[pid].perSupplier.push({
            supplierId,
            supplierName: (o as any).supplierName,
            availableQty,
          });
        }
      }

      Object.values(byProduct).forEach((s) => {
        s.inStock = s.totalAvailable > 0;
      });

      return byProduct;
    },
  });


  /**
   * ✅ Derive "Avail" and "offers count":
   * - total stock = base product qty + sum(offers summary qty)
   * - offers count from offers summary; fallback to variant qty>0 count only if summary missing
   */
  const rowsWithDerived: AdminProduct[] = useMemo(() => {
    const summary = (offersSummaryQ.data || {}) as any;

    const pickQty = (p: any, keys: string[]) => {
      for (const k of keys) {
        const v = p?.[k];
        const n = Number(v);
        if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
      }
      return 0;
    };

    return (rows || []).map((p) => {
      const s = summary[p.id];

      const baseQty = pickQty(p as any, ["availableQty", "baseQty", "baseQuantity", "baseAvailableQty"]);

      // qty from offers that have qty > 0 (already computed in summary)
      const offerQty = toInt(s?.totalAvailable ?? 0, 0);

      const finalAvail = baseQty + offerQty;

      // ✅ Offer count should be TOTAL rows (even if qty=0)
      // if summary missing, fall back to product.supplierOffers length if present
      const offerCount =
        s != null
          ? toInt(s?.offerCountTotal ?? 0, 0)
          : Array.isArray((p as any)?.supplierOffers)
            ? (p as any).supplierOffers.length
            : 0;

      const inStock = finalAvail > 0;

      return {
        ...p,
        availableQty: finalAvail,
        inStock,
        __baseQty: baseQty,
        __offerQty: offerQty,
        __offerCount: offerCount,
      } as any;
    });
  }, [rows, offersSummaryQ.data]);

  /* ---------------- Status helpers ---------------- */

  type EffectiveStatus = "PUBLISHED" | "PENDING" | "REJECTED" | "ARCHIVED" | "LIVE";

  const getStatus = (p: any): EffectiveStatus => (p?.isDelete || p?.isDeleted ? "ARCHIVED" : (p?.status ?? "PENDING"));

  const statusRank: Record<EffectiveStatus, number> = {
    LIVE: 0,
    PUBLISHED: 1,
    PENDING: 2,
    REJECTED: 3,
    ARCHIVED: 4,
  };

  const updateStatusM = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "PUBLISHED" | "PENDING" | "REJECTED" | "LIVE" }) =>
      (await api.post(`/api/admin/products/${id}/status`, { status }, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Status update failed"),
      }),
  });

  function isRowEmpty(row: VariantRow) {
    const vals = Object.values(row?.selections || {});
    return vals.length === 0 || vals.every((v) => !String(v || "").trim());
  }

  function findEmptyRowErrors(rows: VariantRow[]): Record<string, string> {
    const errors: Record<string, string> = {};
    rows.forEach((r, idx) => {
      if (isRowEmpty(r)) {
        errors[rowKey(r, idx)] = "Pick at least 1 option (or remove this row).";
      }
    });
    return errors;
  }

  /* ---------------- Lookups ---------------- */

  const catsQ = useQuery<AdminCategory[]>({
    queryKey: ["admin", "products", "cats"],
    enabled: !!token,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/categories", "/api/categories", "/api/catalog/categories"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
    staleTime: staleTImeInSecs,
    refetchOnWindowFocus: false,
  });

  const brandsQ = useQuery<AdminBrand[]>({
    queryKey: ["admin", "products", "brands"],
    enabled: !!token,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/brands", "/api/brands"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
    staleTime: staleTImeInSecs,
    refetchOnWindowFocus: false,
  });

  const suppliersQ = useQuery<AdminSupplier[]>({
    queryKey: ["admin", "products", "suppliers"],
    enabled: !!token,
    refetchOnWindowFocus: false,
    staleTime: staleTImeInSecs,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/suppliers"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
  });

  const attrsQ = useQuery<AdminAttribute[]>({
    queryKey: ["admin", "products", "attributes"],
    enabled: !!token,
    queryFn: async () => {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/attributes", "/api/attributes"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
    staleTime: staleTImeInSecs,
    refetchOnWindowFocus: false,
  });

  /* ---------------- Mutations ---------------- */

  const createM = useMutation({
    mutationFn: async (payload: any) =>
      (await api.post("/api/admin/products", payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Create failed"),
      }),
  });

  const updateM = useMutation({
    mutationFn: async ({ id, ...payload }: any) =>
      (await api.patch(`/api/admin/products/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Update failed"),
      }),
  });

  const restoreM = useMutation({
    mutationFn: async (id: string) => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await api.post(`/api/admin/products/${encodeURIComponent(id)}/restore`, {}, { headers: hdr });
      return (res as any).data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Restore failed"),
      }),
  });

  // ✅ FIX #1 continued: probe /has-orders once; if 404 => disable permanently
  async function ensureHasOrdersSupport(sampleId: string) {
    if (!token) return "unsupported" as const;
    if (hasOrdersSupportRef.current !== "unknown") return hasOrdersSupportRef.current;
    if (hasOrdersProbeDoneRef.current) return hasOrdersSupportRef.current;

    hasOrdersProbeDoneRef.current = true;

    try {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      await api.get(`/api/admin/products/${encodeURIComponent(sampleId)}/has-orders`, { headers: hdr });
      hasOrdersSupportRef.current = "supported";
      return "supported" as const;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) {
        hasOrdersSupportRef.current = "unsupported";
        return "unsupported" as const;
      }
      // non-404 errors: treat as supported (route exists) but failing
      hasOrdersSupportRef.current = "supported";
      return "supported" as const;
    }
  }

  const hasOrdersQ = useQuery<Record<string, boolean>>({
    queryKey: ["admin", "products", "has-orders", { ids: (rowsWithDerived ?? []).map((r) => r.id) }],
    enabled: !!token && rowsWithDerived.length > 0 && hasOrdersSupportRef.current !== "unsupported",
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const ids = rowsWithDerived.map((r) => r.id);

      if (!ids.length) return {};

      const support = await ensureHasOrdersSupport(ids[0]);
      if (support === "unsupported") {
        // no network calls; silence the 404 spam completely
        return Object.fromEntries(ids.map((id) => [id, false] as const));
      }

      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, { headers: hdr });
            const has =
              typeof data === "boolean"
                ? data
                : typeof data?.hasOrders === "boolean"
                  ? data.hasOrders
                  : typeof data?.data?.hasOrders === "boolean"
                    ? data.data.hasOrders
                    : typeof data?.has === "boolean"
                      ? data.has
                      : typeof data?.data?.has === "boolean"
                        ? data.data.has
                        : false;

            return [id, has] as const;
          } catch (e: any) {
            const status = e?.response?.status;
            if (status === 404) {
              // if backend removed the route mid-session, disable from now on
              hasOrdersSupportRef.current = "unsupported";
              return [id, false] as const;
            }
            return [id, false] as const;
          }
        })
      );

      return Object.fromEntries(results);
    },
  });

  const hasOrder = (productId: string) => !!hasOrdersQ.data?.[productId];

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

      let has = hasOrder(id);

      // ✅ FIX #1 continued: if /has-orders unsupported, never call it here
      if (hasOrdersSupportRef.current === "unsupported") {
        has = false;
      } else if (hasOrdersQ.isLoading || hasOrdersQ.data == null) {
        // if unknown, probe once; 404 => mark unsupported and proceed without has-orders
        const support = await ensureHasOrdersSupport(id);
        if (support === "unsupported") {
          has = false;
        } else {
          try {
            const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, { headers: hdr });
            has = !!(data?.data?.has ?? data?.has ?? data);
          } catch (e: any) {
            const status = e?.response?.status;
            if (status === 404) hasOrdersSupportRef.current = "unsupported";
            has = false;
          }
        }
      }

      const url = has ? `/api/admin/products/${id}/soft-delete` : `/api/admin/products/${id}`;
      const res = await api.delete(url, { headers: hdr });
      return (res as any).data?.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
  });

  /* ---------------- Top form state ---------------- */

  const defaultPending = {
    title: "",
    price: "",
    status: "PENDING",
    categoryId: "",
    brandId: "",
    supplierId: "",
    supplierAvailableQty: "",
    sku: "",
    imageUrls: "",
    description: "",
  };

  const [offersProductId, setOffersProductId] = useState<string | null>(null);
  const [pending, setPending] = useState(defaultPending);
  const [editingId, setEditingId] = useState<string | null>(null);

  const lockedVariantIdsQ = useQuery<string[]>({
    queryKey: ["admin", "products", "locked-variant-ids", { productId: editingId }],
    enabled: !!token && !!editingId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const offers = await fetchSupplierOffersForProduct(editingId!, token);
      const locked = new Set<string>();
      for (const o of offers) {
        const rawVid = o?.variantId?.id ?? o?.variant?.id ?? o?.variantId;
        const vid = normalizeNullableId(rawVid);
        if (vid) locked.add(vid);
      }
      return Array.from(locked);
    },
  });

  const lockedVariantIds = useMemo(() => new Set<string>(lockedVariantIdsQ.data ?? []), [lockedVariantIdsQ.data]);

  const [showEditor, setShowEditor] = useState(false);

  const parseUrlList = (s: string) =>
    s
      .split(/[\n,]/g)
      .map((t) => t.trim())
      .filter(Boolean);

  const isUrlish = (s?: string) => !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);

  const toArray = (x: any): any[] => (Array.isArray(x) ? x : x == null ? [] : [x]);

  function extractImageUrls(p: any): string[] {
    if (Array.isArray(p?.imagesJson)) return p.imagesJson.filter(isUrlish);
    if (typeof p?.imagesJson === "string") {
      try {
        const arr = JSON.parse(p.imagesJson);
        if (Array.isArray(arr)) return arr.filter(isUrlish);
      } catch {
        return p.imagesJson
          .split(/[\n,]/g)
          .map((t: string) => t.trim())
          .filter(isUrlish);
      }
    }
    const cands = [
      ...(toArray(p?.imageUrls) as string[]),
      ...(toArray(p?.images) as string[]),
      p?.image,
      p?.primaryImage,
      p?.coverUrl,
    ].filter(Boolean);
    return cands.filter(isUrlish);
  }

  const [files, setFiles] = useState<File[]>([]);
  const UPLOAD_ENDPOINT = "/api/uploads";

  function dedupe(list: string[]) {
    return Array.from(new Set(list.map((x) => x.trim()).filter(Boolean)));
  }

  function appendUploadedUrlsToForm(urls: string[]) {
    if (!urls?.length) return;

    setPending((p) => {
      const existing = parseUrlList(p.imageUrls || "");
      const next = dedupe([...existing, ...urls]);
      return { ...p, imageUrls: next.join("\n") };
    });

    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadLocalFiles(): Promise<string[]> {
    if (!files.length) return [];
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    try {
      setUploading(true);
      const res = await api.post(UPLOAD_ENDPOINT, fd, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "multipart/form-data",
        },
      });
      const urls: string[] = (res as any)?.data?.urls || (Array.isArray((res as any)?.data) ? (res as any).data : []);
      return Array.isArray(urls) ? urls : [];
    } finally {
      setUploading(false);
    }
  }

  // ------------------------------
  // Variant rows helpers (FULL)
  // ------------------------------

  function makeTempRowId() {
    return `tmp:${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function touchVariants() {
    setVariantsDirty(true);
  }

  function makeEmptySelections() {
    const selections: Record<string, string> = {};
    (selectableAttrs || []).forEach((a) => (selections[a.id] = ""));
    return selections;
  }

  /**
   * Add a blank row (same as your old Add row button)
   */
  function addVariantCombo() {
    if (hasDuplicateCombos) {
      openModal({ title: "Variants", message: "Fix duplicate combinations before adding more rows." });
      return;
    }

    const row: VariantRow = {
      id: makeTempRowId(),
      selections: makeEmptySelections(),
      priceBump: "",
      inStock: true,
      availableQty: 0,
      imagesJson: [],
    };

    setVariantRows((prev) => [...(Array.isArray(prev) ? prev : []), row]);
    touchVariants();
  }

  /**
   * Remove a row (marks variantsDirty so save persists)
   */
  function removeVariantRow(rowId: string) {
    const rid = String(rowId || "").trim();
    if (!rid) return;

    if (isRealVariantId(rid) && lockedVariantIds.has(rid)) {
      openModal({
        title: "Cannot remove variant in use",
        message: "This variant is linked to supplier offers. Remove/disable the supplier offers first, or keep this variant.",
      });
      return;
    }

    setVariantRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      return rows.filter((r) => String(r?.id) !== rid);
    });

    touchVariants();
  }

  /**
   * Selection change
   * Keeps keys aligned with selectableAttrs (no delete needed)
   */
  function setVariantRowSelection(rowId: string, attributeId: string, valueId: string | null) {
    const rid = String(rowId || "").trim();
    const aid = String(attributeId || "").trim();
    const vid = valueId == null ? "" : String(valueId).trim();

    if (!rid || !aid) return;

    setVariantRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      return rows.map((r) => {
        if (String(r?.id) !== rid) return r;

        return {
          ...r,
          selections: {
            ...(r.selections || {}),
            [aid]: vid,
          },
        };
      });
    });

    touchVariants();
  }

  /**
   * Price bump change
   */
  function setVariantRowPriceBump(rowId: string, bump: string) {
    const rid = String(rowId || "").trim();
    if (!rid) return;

    setVariantRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      return rows.map((r) => (String(r?.id) === rid ? { ...r, priceBump: bump } : r));
    });

    touchVariants();
  }

  /* ---------------- Variants: row-based editor ---------------- */

  const selectableAttrs = useMemo(() => (attrsQ.data || []).filter((a) => a.type === "SELECT" && a.isActive), [attrsQ.data]);

  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [offerVariants, setOfferVariants] = useState<any[]>([]);

  const comboErrors = React.useMemo(() => {
    return findDuplicateCombos(variantRows ?? [], selectableAttrs ?? []);
  }, [variantRows, selectableAttrs]);

  const hasDuplicateCombos = Object.keys(comboErrors).length > 0;

  useEffect(() => {
    if (!selectableAttrs.length) return;
    const ids = selectableAttrs.map((a) => a.id);
    setVariantRows((rows) =>
      rows.map((row) => {
        const next: Record<string, string> = {};
        ids.forEach((id) => {
          next[id] = row.selections[id] || "";
        });
        return { ...row, selections: next };
      })
    );
  }, [selectableAttrs]);

  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
  const [variantsDirty, setVariantsDirty] = useState(false);
  const initialVariantIdsRef = useRef<Set<string>>(new Set());
  const [clearAllVariantsIntent, setClearAllVariantsIntent] = useState(false);

  const DRAFT_KEY = useMemo(() => `adminProductDraft:${editingId ?? "new"}`, [editingId]);
  const skipDraftLoadRef = useRef(false);

  useEffect(() => {
    if (skipDraftLoadRef.current) return;

    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    try {
      const d = JSON.parse(raw);
      if (d?.pending) setPending(d.pending);
      if (Array.isArray(d?.variantRows)) setVariantRows(d.variantRows);
      if (d?.selectedAttrs) setSelectedAttrs(d.selectedAttrs);
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DRAFT_KEY]);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ pending, variantRows, selectedAttrs }));
  }, [DRAFT_KEY, pending, variantRows, selectedAttrs]);

  /* ---------------- JWT / me ---------------- */

  function base64UrlDecode(str: string) {
    const pad = str.length % 4 === 2 ? "==" : str.length % 4 === 3 ? "=" : "";
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const dec = new TextDecoder("utf-8");
    return dec.decode(bytes);
  }

  function parseJwtClaims(jwt?: string | null): Record<string, any> | undefined {
    if (!jwt) return;
    try {
      const parts = jwt.split(".");
      if (parts.length < 2) return;
      const json = base64UrlDecode(parts[1]);
      return JSON.parse(json);
    } catch {
      return;
    }
  }

  const claims = useMemo(() => parseJwtClaims(token), [token]);

  const meQ = useQuery<{ id?: string; email?: string }>({
    queryKey: ["auth", "me"],
    enabled: !!token,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/auth/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const d = data?.data ?? data ?? {};
        return {
          id: d.id || d.user?.id || d.profile?.id || d.account?.id,
          email: d.email || d.user?.email || d.profile?.email || d.account?.email,
        };
      } catch {
        return {};
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const adminUserId = claims?.sub || claims?.id || meQ.data?.id;

  /* ---------------- Payload builder (variants) ---------------- */

  function buildProductPayload({
    base,
    selectedAttrs,
    variantRows,
    attrsAll,
  }: {
    base: {
      title: string;
      price: number;
      status: string;
      sku?: string;
      categoryId?: string;
      brandId?: string;
      supplierId?: string;
      imagesJson?: string[];
      description?: string | null;
      ownerId?: string | null;
      availableQty?: number;
      inStock?: boolean;
    };
    selectedAttrs: Record<string, string | string[]>;
    variantRows: VariantRow[];
    attrsAll: AdminAttribute[];
  }) {
    const payload: any = { ...base };

    const attributeSelections: any[] = [];
    const attributeValues: Array<{ attributeId: string; valueId?: string; valueIds?: string[] }> = [];
    const attributeTexts: Array<{ attributeId: string; value: string }> = [];

    for (const a of attrsAll) {
      const sel = selectedAttrs[a.id];
      if (
        sel == null ||
        (Array.isArray(sel) && sel.length === 0) ||
        (typeof sel === "string" && sel.trim() === "")
      )
        continue;

      if (a.type === "TEXT") {
        attributeSelections.push({ attributeId: a.id, text: String(sel) });
        attributeTexts.push({ attributeId: a.id, value: String(sel) });
      } else if (a.type === "SELECT") {
        const valueId = String(sel);
        attributeSelections.push({ attributeId: a.id, valueId });
        attributeValues.push({ attributeId: a.id, valueId });
      } else if (a.type === "MULTISELECT") {
        const valueIds = (sel as string[]).map(String);
        attributeSelections.push({ attributeId: a.id, valueIds });
        attributeValues.push({ attributeId: a.id, valueIds });
      }
    }

    if (attributeSelections.length) payload.attributeSelections = attributeSelections;
    if (attributeValues.length) payload.attributeValues = attributeValues;
    if (attributeTexts.length) payload.attributeTexts = attributeTexts;

    const selectable = (attrsAll || []).filter((a) => a.type === "SELECT" && a.isActive);
    const selectableById = new Map(selectable.map((a) => [String(a.id), a]));

    if (variantRows.length > 0) {
      const variants: any[] = [];

      const isRealVariantIdLocal = (id?: string) =>
        !!id &&
        !id.startsWith("vr-") &&
        !id.startsWith("new-") &&
        !id.startsWith("temp-") &&
        !id.startsWith("tmp:");

      for (const row of variantRows) {
        const picks = Object.entries(row.selections || {}).filter(([, valueId]) => !!valueId);
        if (picks.length === 0) continue;

        const raw = (row.priceBump ?? "").trim();
        const bumpNum = raw === "" ? NaN : Number(raw);
        const hasBump = raw !== "" && Number.isFinite(bumpNum);

        const options = picks.map(([attributeId, valueId]) => {
          const option: any = { attributeId, valueId, attributeValueId: valueId };
          if (hasBump) option.priceBump = bumpNum;
          return option;
        });

        const labelParts: string[] = [];
        for (const [attributeId, valueId] of picks) {
          const attr = selectableById.get(String(attributeId));
          const val = attr?.values?.find((v) => String(v.id) === String(valueId));
          const code = String(val?.code || val?.name || valueId || "").trim();
          if (code) labelParts.push(code.toUpperCase().replace(/\s+/g, ""));
        }

        const comboLabel = labelParts.join("-");
        const sku = base.sku && comboLabel ? `${base.sku}-${comboLabel}` : base.sku || comboLabel || undefined;

        variants.push({
          ...(isRealVariantIdLocal(row.id) ? { id: row.id } : {}),
          sku,
          options,
          optionSelections: options,
          attributes: options.map((o: any) => ({ attributeId: o.attributeId, valueId: o.valueId })),
        });
      }

      payload.variants = variants.length ? variants : [];
      payload.variantOptions = variants.length ? variants.map((v: any) => v.options) : [];
    }

    return payload;
  }

  /* ---------------- Load full product into top form ---------------- */

  async function fetchProductFull(id: string) {
    const { data } = await api.get(`/api/admin/products/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { include: "variants,attributes,brand,supplier,owner" },
    });

    const prod = data?.data?.data ?? data?.data ?? data ?? {};

    const rawVariants =
      (Array.isArray(prod?.variants) && prod.variants) ||
      (Array.isArray(prod?.ProductVariant) && prod.ProductVariant) ||
      (Array.isArray(prod?.productVariants) && prod.productVariants) ||
      [];

    const pickFirstNonEmptyArray = (...cands: any[]): any[] => {
      for (const c of cands) {
        if (Array.isArray(c) && c.length > 0) return c;
      }
      return [];
    };

    const variantsNormalized = (rawVariants || []).map((v: any) => {
      const vid =
        normalizeNullableId(v?.id) ||
        normalizeNullableId(v?.variantId) ||
        normalizeNullableId(v?.variant?.id);

      const pickedOptions = pickFirstNonEmptyArray(
        v?.options,
        v?.optionSelections,
        v?.attributes,
        v?.attributeSelections,
        v?.ProductVariantOption,
        v?.ProductVariantOptions,
        v?.productVariantOptions,
        v?.variantOptions,
        v?.VariantOption,
        v?.VariantOptions
      );

      const next: any = { ...v, id: vid || v?.id };
      if (pickedOptions.length > 0) next.options = pickedOptions;

      return next;
    });

    const attributeValues =
      (Array.isArray(prod?.attributes?.options) && prod.attributes.options) ||
      (Array.isArray(prod?.attributeValues) && prod.attributeValues) ||
      (Array.isArray(prod?.attributeOptions) && prod.attributeOptions) ||
      [];

    const attributeTexts =
      (Array.isArray(prod?.attributes?.texts) && prod.attributes.texts) ||
      (Array.isArray(prod?.attributeTexts) && prod.attributeTexts) ||
      (Array.isArray(prod?.ProductAttributeText) && prod.ProductAttributeText) ||
      [];

    const supplierId = normalizeNullableId(prod?.supplierId) || normalizeNullableId(prod?.supplier?.id) || null;

    return {
      ...prod,
      variants: variantsNormalized,
      variantsNormalized,
      supplierId,
      imagesJson: Array.isArray(prod?.imagesJson) ? prod.imagesJson : [],
      attributeValues,
      attributeTexts,
    };
  }

  function startNewProduct() {
    setEditingId(null);
    setOffersProductId(null);
    setPending(defaultPending);
    setShowEditor(true);

    setSelectedAttrs({});

    setVariantRows([]);
    initialVariantIdsRef.current = new Set();
    setClearAllVariantsIntent(false);
    setVariantsDirty(false);

    setNewCombo({});
    setNewComboBump("");

    setOfferVariants([]);
    setFiles([]);
  }

  function findSupplierIdFallbackFromOwner(full: any): string | null {
    const ownerUserId =
      normalizeNullableId(full?.ownerId) ||
      normalizeNullableId(full?.owner?.id) ||
      normalizeNullableId(full?.userId);
    if (!ownerUserId) return null;

    const match = (suppliersQ.data ?? []).find((s) => normalizeNullableId(s.userId) === ownerUserId);
    return match ? String(match.id) : null;
  }

  async function startEdit(p: any) {
    try {
      setShowEditor(true);

      const full = await fetchProductFull(p.id);

      skipDraftLoadRef.current = true;

      setOffersProductId(full.id);
      setEditingId(full.id);

      const resolvedSupplierId = normalizeNullableId(full.supplierId) || findSupplierIdFallbackFromOwner(full) || "";

      const nextPending = {
        title: full.title || "",
        price: String(full.price ?? full.retailPrice ?? ""),
        status: full.status === "PUBLISHED" || full.status === "LIVE" ? full.status : "PENDING",
        categoryId: full.categoryId || "",
        brandId: full.brandId || "",
        supplierId: resolvedSupplierId || "",
        supplierAvailableQty: "",
        sku: full.sku || "",
        imageUrls: (extractImageUrls(full) || []).join("\n"),
        description: full.description ?? "",
      };

      const nextSel: Record<string, string | string[]> = {};
      (full.attributeValues || full.attributeSelections || []).forEach((av: any) => {
        if (Array.isArray(av.valueIds)) nextSel[av.attributeId] = av.valueIds;
        else if (av.valueId) nextSel[av.attributeId] = av.valueId;
      });
      (full.attributeTexts || []).forEach((at: any) => {
        nextSel[at.attributeId] = at.value;
      });

      const serverVariants = (full as any).variants || (full as any).variantsNormalized || [];
      const vr = buildVariantRowsFromServerVariants(serverVariants);

      setPending(nextPending);
      setSelectedAttrs(nextSel);

      initialVariantIdsRef.current = new Set(vr.map((r) => r.id).filter((id) => isRealVariantId(id)));
      setClearAllVariantsIntent(false);
      setVariantRows(vr);
      setVariantsDirty(false);

      await loadOfferVariants(full.id);

      localStorage.setItem(`adminProductDraft:${full.id}`, JSON.stringify({ pending: nextPending, variantRows: vr, selectedAttrs: nextSel }));
    } catch (e) {
      console.error(e);
      openModal({ title: "Products", message: "Could not load product for editing." });
    } finally {
      queueMicrotask(() => {
        skipDraftLoadRef.current = false;
      });
    }
  }

  function isRealVariantId(id?: string) {
    return !!id && !id.startsWith("vr-") && !id.startsWith("new-") && !id.startsWith("temp-") && !id.startsWith("tmp:");
  }

  // ✅ FIX #2: only use replace=true when variants were actually removed / cleared.
  // This prevents unnecessary “bulk replace” that can accidentally break offer-linked variants on some backends.
  function shouldReplaceVariants(args: {
    variantRows: any[] | undefined;
    initialVariantIds: Set<string>;
    clearAllVariantsIntent: boolean;
  }) {
    const { variantRows, initialVariantIds, clearAllVariantsIntent } = args;

    if (clearAllVariantsIntent) return true;

    const currentIds = new Set(
      (variantRows ?? [])
        .map((r: any) => String(r?.id ?? "").trim())
        .filter((id: string) => !!id && id !== "NEW" && id !== "TEMP")
    );

    for (const id of initialVariantIds) {
      if (!currentIds.has(id)) return true;
    }

    return false;
  }

  function pickAttrId(o: any): string | null {
    return normalizeNullableId(
      o?.attributeId ??
      o?.productAttributeId ??
      o?.productAttribute?.id ??
      o?.attribute?.id ??
      o?.attributeValue?.attributeId ??
      o?.attributeValue?.attribute?.id ??
      o?.productAttributeOption?.attributeId ??
      o?.productAttributeValue?.attributeId ??
      o?.attribute_value?.attributeId
    );
  }

  function pickValueId(o: any): string | null {
    return normalizeNullableId(
      o?.valueId ??
      o?.attributeValueId ??
      o?.productAttributeOptionId ??
      o?.productAttributeValueId ??
      o?.attributeValue?.id ??
      o?.productAttributeOption?.id ??
      o?.productAttributeValue?.id ??
      o?.value?.id ??
      o?.attribute_value?.id
    );
  }

  function buildVariantRowsFromServerVariants(fullVariants: any[]): VariantRow[] {
    const vr: VariantRow[] = [];

    const pickFirstArray = (...cands: any[]): any[] => {
      for (const c of cands) if (Array.isArray(c) && c.length) return c;
      for (const c of cands) if (Array.isArray(c)) return c;
      return [];
    };

    for (const v of fullVariants || []) {
      const selections: Record<string, string> = makeEmptySelections();

      const opts = pickFirstArray(
        v?.options,
        v?.optionSelections,
        v?.attributes,
        v?.attributeSelections,
        v?.ProductVariantOption,
        v?.ProductVariantOptions,
        v?.productVariantOptions,
        v?.variantOptions,
        v?.VariantOption,
        v?.VariantOptions
      );

      let bump: number | null = null;

      for (const o of opts) {
        const attrId = pickAttrId(o);
        const valId = pickValueId(o);

        if (attrId) selections[String(attrId)] = valId ? String(valId) : "";

        const pb = Number(o?.priceBump ?? v?.priceBump);
        if (Number.isFinite(pb) && pb !== 0) bump = pb;
      }

      const hasAnyPick = Object.values(selections).some((x) => !!String(x || "").trim());
      if (!hasAnyPick) continue;

      const id = normalizeNullableId(v?.id) || normalizeNullableId(v?.variantId) || normalizeNullableId(v?.variant?.id);
      if (!id) continue;

      vr.push({
        id: String(id),
        selections,
        priceBump: bump != null ? String(bump) : "",
        inStock: coerceBool(v?.inStock, true),
        availableQty: toInt(v?.availableQty ?? v?.available ?? v?.qty ?? v?.stock, 0),
        imagesJson: Array.isArray(v?.imagesJson) ? v.imagesJson : [],
      });
    }

    return vr;
  }

  async function loadOfferVariants(productId: string) {
    try {
      const full = await fetchProductFull(productId);
      setOfferVariants((full as any).variants || (full as any).variantsNormalized || []);
    } catch (e) {
      console.error(e);
      alert("Could not load product variants for offers.");
    }
  }

  function dedupeVariantRowsByCombo(rows: VariantRow[], attrs: AttrDef[]) {
    const byKey = new Map<string, VariantRow>();

    for (const r of rows) {
      const k = buildComboKey(r, attrs) || `__id:${r.id}`;
      const prev = byKey.get(k);

      if (!prev) byKey.set(k, r);
      else if (!isRealVariantId(prev.id) && isRealVariantId(r.id)) byKey.set(k, r);
    }

    return Array.from(byKey.values());
  }

  /* ---------------- Save / Create ---------------- */

  async function saveOrCreate() {
    const title = pending.title.trim();
    const priceNum = Number(pending.price) || 0;

    if (!title) {
      openModal({ title: "Products", message: "Title is required." });
      return;
    }

    if (!pending.supplierId) {
      openModal({ title: "Products", message: "Supplier is required." });
      return;
    }

    if (hasDuplicateCombos) {
      openModal({
        title: "Variants",
        message: "Fix duplicate variant combinations before saving.",
      });
      return;
    }

    const emptyRowErrorsNow = findEmptyRowErrors(variantRows ?? []);
    const hasEmptyRows = Object.keys(emptyRowErrorsNow).length > 0;
    if (hasEmptyRows) {
      openModal({
        title: "Variants",
        message: "You have a variant row with no option selected. Pick at least 1 option or remove the row.",
      });
      return;
    }

    const supplierQty = toInt((pending as any).supplierAvailableQty, 0);
    const urlList = parseUrlList(pending.imageUrls);

    const supplier = (suppliersQ.data ?? []).find((s) => String(s.id) === String(pending.supplierId));
    const supplierUserId = normalizeNullableId((supplier as any)?.userId);

    const base: any = {
      title,
      retailPrice: priceNum,   // ✅ IMPORTANT
      price: priceNum,         // keep for backward compatibility (optional)
      status: pending.status,
      sku: pending.sku.trim() || undefined,
      description: pending.description != null ? pending.description : undefined,
      categoryId: pending.categoryId || undefined,
      brandId: pending.brandId || undefined,
      supplierId: pending.supplierId,
      ...(supplierUserId ? { ownerId: supplierUserId } : {}),
    };

    if (!editingId && supplierQty > 0) {
      base.availableQty = supplierQty;
      base.inStock = true;
    }

    if (urlList.length) base.imagesJson = urlList;

    const fullPayload = buildProductPayload({
      base,
      selectedAttrs,
      variantRows,
      attrsAll: attrsQ.data || [],
    });

    const variants = Array.isArray((fullPayload as any).variants) ? (fullPayload as any).variants : [];

    if (editingId) {
      const hadVariantsBefore = initialVariantIdsRef.current.size > 0;
      const isNowNoVariants = variants.length === 0;

      if (hadVariantsBefore && isNowNoVariants && !clearAllVariantsIntent) {
        openModal({
          title: "Variants",
          message:
            "This save would remove ALL existing variants. If you really want to make this a simple product, click “Remove all variants” first, then Save.",
        });
        return;
      }
    }

    if (files.length) {
      try {
        const uploaded = await uploadLocalFiles();
        if (uploaded.length) {
          appendUploadedUrlsToForm(uploaded);
          fullPayload.imagesJson = dedupe([...(fullPayload.imagesJson || []), ...uploaded]);
        }
      } catch (e: any) {
        openModal({
          title: "Uploads",
          message: getHttpErrorMessage(e, "Upload failed"),
        });
        return;
      }
    }

    // -----------------------------
    // EDIT FLOW
    // -----------------------------
    if (editingId) {
      const { variantOptions, ...payloadForPatch } = fullPayload as any; // keep variants!


      const userTouchedVariants = variantsDirty || clearAllVariantsIntent;

      if (userTouchedVariants) {
        const submittedIds = new Set(
          (variants || []).map((v: any) => normalizeNullableId(v?.id)).filter(Boolean) as string[]
        );

        const missingLocked = Array.from(lockedVariantIds).filter((id) => !submittedIds.has(id));

        if (missingLocked.length > 0) {
          openModal({
            title: "Cannot remove variants in use",
            message:
              `You tried to remove ${missingLocked.length} variant(s) that are linked to supplier offers. ` +
              `Remove/disable the supplier offers first, or keep those variants.`,
          });
          return;
        }
      }

      updateM.mutate({
        id: editingId, ...payloadForPatch
      },
        {
          onSuccess: async () => {
            const pid = editingId;
            const touched = variantsDirty || clearAllVariantsIntent;

            if (pid && touched) {
              try {
                // ✅ FIX #2: choose replace based on actual removals/clear-all
                const replaceFlag = shouldReplaceVariants({
                  variantRows: variants || [],
                  initialVariantIds: initialVariantIdsRef.current,
                  clearAllVariantsIntent,
                });

                await persistVariantsStrict(pid, variants || [], token, { replace: replaceFlag });

                setVariantsDirty(false);
                setClearAllVariantsIntent(false);

                qc.invalidateQueries({
                  queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
                });
              } catch (e) {
                console.error("Failed to persist variants on update", e);
                openModal({
                  title: "Products",
                  message: getHttpErrorMessage(e, "Failed to save variants"),
                });
                return;
              }
            }

            try {
              if (pid) {
                const refreshed = await fetchProductFull(pid);

                const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
                const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, selectableAttrs);

                setVariantRows(nextRows);

                initialVariantIdsRef.current = new Set(nextRows.map((r) => r.id).filter((id) => isRealVariantId(id)));

                setOfferVariants(refreshed.variants || []);

                qc.invalidateQueries({
                  queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
                });
              }
            } catch (e) {
              console.warn("Product saved but refresh failed", e);
            }

            await Promise.all([
              qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] }),
              qc.invalidateQueries({ queryKey: ["admin", "overview"] }),
              qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] }),
              pid ? qc.invalidateQueries({ queryKey: ["admin", "product", pid, "variants"] }) : Promise.resolve(),
              pid ? qc.invalidateQueries({ queryKey: ["admin", "products", pid, "supplier-offers"] }) : Promise.resolve(),
            ]);

            alert("Product changes saved.");
          },
        }
      );

      return;
    }

    // -----------------------------
    // CREATE FLOW
    // -----------------------------
    createM.mutate(fullPayload, {
      onSuccess: async (res) => {
        const created = (res?.data ?? res) as any;
        const pid = created?.id || created?.product?.id || created?.data?.id;

        const vars = extractProductVariants(fullPayload);
        if (pid && vars.length > 0) {
          try {
            await persistVariantsStrict(pid, vars, token, { replace: true });

            const refreshed = await fetchProductFull(pid);

            const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
            const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, selectableAttrs);
            setVariantRows(nextRows);

            initialVariantIdsRef.current = new Set(nextRows.map((r) => r.id).filter((id) => isRealVariantId(id)));

            setOfferVariants(refreshed.variants || []);

            qc.invalidateQueries({
              queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
            });
          } catch (e) {
            console.error("Failed to persist variants on create", e);
            openModal({
              title: "Products",
              message: getHttpErrorMessage(e, "Failed to save variants"),
            });
          }
        }

        if (pid) {
          setOffersProductId(pid);
          setEditingId(pid);
          setShowEditor(true);
          await loadOfferVariants(pid);
        }

        await Promise.all([
          qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] }),
          qc.invalidateQueries({ queryKey: ["admin", "overview"] }),
          qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] }),
          pid ? qc.invalidateQueries({ queryKey: ["admin", "product", pid, "variants"] }) : Promise.resolve(),
          pid ? qc.invalidateQueries({ queryKey: ["admin", "products", pid, "supplier-offers"] }) : Promise.resolve(),
        ]);
      },
    });
  }

  /* ---------------- Focus handoff from moderation ---------------- */

  useEffect(() => {
    if (!focusId || !rowsWithDerived?.length) return;
    const target = rowsWithDerived.find((r: any) => r.id === focusId);
    if (!target) return;
    startEdit(target);
    onFocusedConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, rowsWithDerived]);

  /* ---------------- Previews helpers ---------------- */

  const urlPreviews = useMemo(() => parseUrlList(pending.imageUrls), [pending.imageUrls]);

  function setUrlAt(i: number, newUrl: string) {
    const list = parseUrlList(pending.imageUrls);
    list[i] = newUrl.trim();
    setPending((d) => ({ ...d, imageUrls: list.filter(Boolean).join("\n") }));
  }

  function removeUrlAt(i: number) {
    const list = parseUrlList(pending.imageUrls);
    list.splice(i, 1);
    setPending((d) => ({ ...d, imageUrls: list.join("\n") }));
  }

  /* ---------------- Primary actions / status ---------------- */

  function submitStatusEdit(pId: string, intent: "approvePublished" | "movePending") {
    const source = rowsWithDerived.find((r: any) => r.id === pId);
    if (!source) return;

    const patch: any = {};

    if (intent === "approvePublished") {
      const avail = (source.availableQty ?? 0) > 0 || source.inStock !== false;
      if (!avail) {
        openModal({
          title: "Cannot publish",
          message: "This product is not in stock. Please add stock or active supplier offers first.",
        });
        return;
      }
      patch.status = "PUBLISHED";
    } else if (intent === "movePending") {
      patch.status = "PENDING";
    }

    updateStatusM.mutate({ id: pId, ...patch });
  }

  function primaryActionForRow(p: any): any {
    const eff = getStatus(p);
    const hasActiveOffer = (Number(p.availableQty ?? 0) || 0) > 0;

    const ordersKnown = !!hasOrdersQ.data || hasOrdersSupportRef.current === "unsupported";
    const ordered = hasOrder(p.id);

    if (!ordersKnown || offersSummaryQ.isLoading) {
      return {
        label: "…",
        title: "Checking…",
        disabled: true,
        onClick: () => { },
        className: "px-2 py-1 rounded bg-zinc-400 text-white",
      };
    }

    if (eff === "PENDING" && hasActiveOffer) {
      return {
        label: "Approve PUBLISHED",
        title: "Publish product",
        onClick: () => submitStatusEdit(p.id, "approvePublished"),
        className: "px-3 py-2 rounded-lg bg-emerald-600 text-white",
      };
    }

    if (eff === "PENDING" && !hasActiveOffer) {
      return ordered
        ? {
          label: "Archive",
          title: "Archive (soft delete)",
          onClick: () => deleteM.mutate(p.id),
          className: "px-2 py-1 rounded bg-rose-600 text-white",
        }
        : {
          label: "Delete",
          title: "Delete permanently",
          onClick: () => deleteM.mutate(p.id),
          className: "px-2 py-1 rounded bg-rose-600 text-white",
        };
    }

    if (eff === "PUBLISHED" || eff === "LIVE") {
      return {
        label: "Move to PENDING",
        title: "Unpublish product",
        onClick: () => submitStatusEdit(p.id, "movePending"),
        className: "px-3 py-2 rounded-lg border bg-amber-400 text-white",
      };
    }

    if (eff === "ARCHIVED") {
      return {
        label: "Revive",
        title: "Restore archived product",
        onClick: () => restoreM.mutate(p.id),
        className: "px-3 py-2 rounded-lg bg-sky-600 text-white",
      };
    }

    return ordered
      ? {
        label: "Archive",
        title: "Archive (soft delete)",
        onClick: () => deleteM.mutate(p.id),
        className: "px-2 py-1 rounded bg-rose-600 text-white",
      }
      : {
        label: "Delete",
        title: "Delete permanently",
        onClick: () => deleteM.mutate(p.id),
        className: "px-2 py-1 rounded bg-rose-600 text-white",
      };
  }

  /* ---------------- Filters / sorting ---------------- */

  const getOwner = (p: any) => (p.owner?.email || p.ownerEmail || p.createdByEmail || p.createdBy?.email || "") as string;

  const filteredRows = useMemo(() => {
    const offers = (offersSummaryQ.data || {}) as any;

    const hasAnyOffer = (pId: string, p: any) => {
      const offerCount = toInt((p as any).__offerCount ?? 0, 0);
      const s = offers[pId];
      return offerCount > 0 || (!!s && (s.activeOffers > 0 || s.perSupplier?.length > 0));
    };

    const hasActiveOffer = (pId: string, p: any) => {
      const s = offers[pId];
      const offerCount = toInt((p as any).__offerCount ?? 0, 0);
      return (offerCount > 0 && (p.availableQty ?? 0) > 0) || (!!s && s.activeOffers > 0 && (s.totalAvailable ?? 0) > 0);
    };

    const isAvailableVariantAware = (pId: string, p: any) => {
      const s = offers[pId];
      if (s?.inStock) return true;
      return (p.availableQty ?? 0) > 0 || p.inStock === true;
    };

    const hasVariants = (p: any) => extractProductVariants(p).length > 0 || (p.variantCount ?? 0) > 0;
    const baseInStock = (p: any) => p.inStock === true;

    return rowsWithDerived.filter((p) => {
      switch (preset) {
        case "no-offer":
          return !hasAnyOffer(p.id, p);
        case "live":
          return p.status === "LIVE";
        case "published-with-offer":
          return p.status === "PUBLISHED" && hasAnyOffer(p.id, p);
        case "published-no-offer":
          return p.status === "PUBLISHED" && !hasAnyOffer(p.id, p);
        case "published-with-active":
          return p.status === "PUBLISHED" && hasActiveOffer(p.id, p);
        case "published-base-in":
          return p.status === "PUBLISHED" && baseInStock(p);
        case "published-base-out":
          return p.status === "PUBLISHED" && !baseInStock(p);
        case "with-variants":
          return hasVariants(p);
        case "simple":
          return !hasVariants(p);
        case "published-with-availability":
          return p.status === "PUBLISHED" && isAvailableVariantAware(p.id, p);
        case "published":
          return p.status === "PUBLISHED";
        case "pending":
          return p.status === "PENDING";
        case "rejected":
          return p.status === "REJECTED";
        case "all":
        default:
          return true;
      }
    });
  }, [rowsWithDerived, preset, offersSummaryQ.data]);

  const displayRows = useMemo(() => {
    const arr = [...filteredRows];

    const cmpNum = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
    const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

    arr.sort((a, b) => {
      let res = 0;
      switch (sort.key) {
        case "title":
          res = cmpStr(a?.title ?? "", b?.title ?? "");
          break;
        case "price":
          res = cmpNum(Number(a?.price) || 0, Number(b?.price) || 0);
          break;
        case "avail":
          res = cmpNum(Number(a?.availableQty ?? 0), Number(b?.availableQty ?? 0));
          break;
        case "stock":
          res = cmpNum(a?.inStock ? 1 : 0, b?.inStock ? 1 : 0);
          break;
        case "status":
          res = cmpNum(statusRank[getStatus(a)] ?? 99, statusRank[getStatus(b)] ?? 99);
          break;
        case "owner":
          res = cmpStr(getOwner(a), getOwner(b));
          break;
      }
      return sort.dir === "asc" ? res : -res;
    });

    return arr;
  }, [filteredRows, sort]);

  const supplierVariants = useMemo(() => {
    const attrById = new Map((selectableAttrs || []).map((a) => [String(a.id), a]));

    const norm = (x: any) => {
      if (x == null) return null;
      const s = String(x).trim();
      if (!s || s === "null" || s === "undefined") return null;
      return s;
    };

    return (offerVariants || [])
      .map((v: any, index: number) => {
        const vid =
          norm(v?.id) ||
          norm(v?.variantId) ||
          norm(v?.variant?.id) ||
          norm(v?.id?.id) ||
          norm(v?.variantId?.id);

        if (!vid) return null;

        const optsRaw =
          v?.options ??
          v?.optionSelections ??
          v?.variantOptions ??
          v?.ProductVariantOption ??
          v?.ProductVariantOptions ??
          [];

        const opts = Array.isArray(optsRaw) ? optsRaw : [];

        const parts = opts
          .map((o: any) => {
            const attrId = norm(
              o?.attributeId ??
              o?.attribute?.id ??
              o?.productAttributeId ??
              o?.attribute?.attributeId ??
              o?.attributeValue?.attributeId
            );

            const valId = norm(
              o?.valueId ??
              o?.attributeValueId ??
              o?.attributeValue?.id ??
              o?.value?.id ??
              o?.valId
            );

            if (!attrId || !valId) return "";

            const attr = attrById.get(attrId);
            const valName = attr?.values?.find((vv) => String(vv.id) === valId)?.name;
            return valName || valId;
          })
          .filter(Boolean);

        const fromOptions = parts.join(" / ");
        const label = v?.sku || v?.label || v?.name || fromOptions || `Variant ${index + 1}`;

        return { id: vid, sku: v?.sku || label, label };
      })
      .filter(Boolean) as Array<{ id: string; sku: string; label: string }>;
  }, [offerVariants, selectableAttrs]);

  const emptyRowErrors = useMemo(() => findEmptyRowErrors(variantRows ?? []), [variantRows]);

  /* ---------------- Attributes (Form UI) ---------------- */

  const activeAttrs = useMemo(() => (attrsQ.data ?? []).filter((a) => a?.isActive), [attrsQ.data]);

  function findAttrByNames(names: string[]) {
    const lower = names.map((n) => n.toLowerCase());
    return activeAttrs.find((a) => lower.includes(String(a.name ?? "").toLowerCase()));
  }

  const attrColor = useMemo(() => findAttrByNames(["color", "colour"]), [activeAttrs]);
  const attrMaterial = useMemo(() => findAttrByNames(["material"]), [activeAttrs]);
  const attrSize = useMemo(() => findAttrByNames(["size"]), [activeAttrs]);
  const attrVolume = useMemo(() => findAttrByNames(["volume"]), [activeAttrs]);
  const attrWeight = useMemo(() => findAttrByNames(["weight"]), [activeAttrs]);

  function setAttr(attrId: string, value: string | string[]) {
    setSelectedAttrs((prev) => ({ ...prev, [attrId]: value }));
  }

  function getAttrValue(attrId?: string) {
    if (!attrId) return "";
    const v = selectedAttrs?.[attrId];
    if (Array.isArray(v)) return v[0] ?? "";
    return String(v ?? "");
  }

  /* ============================
     Render
  ============================ */

  const presetButtons: Array<{ key: FilterPreset; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "published", label: "Published" },
    { key: "live", label: "Live" },
    { key: "no-offer", label: "No offer" },
    { key: "with-variants", label: "With variants" },
    { key: "simple", label: "Simple" },
    { key: "rejected", label: "Rejected" },
  ];

  const [newCombo, setNewCombo] = useState<Record<string, string>>({});
  const [newComboBump, setNewComboBump] = useState<string>("");

  useEffect(() => {
    if (!selectableAttrs.length) return;
    setNewCombo((prev) => {
      const next: Record<string, string> = {};
      selectableAttrs.forEach((a) => (next[a.id] = prev[a.id] || ""));
      return next;
    });
  }, [selectableAttrs]);

  function addNewComboRow() {
    setVariantsDirty(true);

    const picks = Object.entries(newCombo || {}).filter(([, v]) => !!String(v || "").trim());
    if (picks.length === 0) {
      openModal({ title: "Variants", message: "Pick at least 1 option before adding a variant row." });
      return;
    }

    const id = `vr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const selections: Record<string, string> = {};
    selectableAttrs.forEach((a) => (selections[a.id] = newCombo[a.id] || ""));

    const candidate: VariantRow = {
      id,
      selections,
      priceBump: (newComboBump || "").trim(),
      inStock: true,
      availableQty: 0,
      imagesJson: [],
    };

    const candKey = buildComboKey(candidate, selectableAttrs);
    const isDup = (variantRows || []).some((r) => buildComboKey(r, selectableAttrs) === candKey && candKey !== "");
    if (isDup) {
      openModal({ title: "Variants", message: "That variant combination already exists." });
      return;
    }

    setVariantRows((prev) => [...prev, candidate]);

    setNewCombo((prev) => {
      const next: Record<string, string> = {};
      selectableAttrs.forEach((a) => (next[a.id] = ""));
      return next;
    });
    setNewComboBump("");
  }

  return (
    <div
      className="space-y-3"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter") {
          const target = e.target as HTMLElement;
          const tag = target.tagName;
          const isTextArea = tag === "TEXTAREA";
          const isButton = tag === "BUTTON";
          if (!isTextArea && !isButton) e.preventDefault();
        }
      }}
      onSubmitCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {/* Top toolbar */}
      <div className="rounded-2xl border bg-white shadow-sm p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {presetButtons.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setPresetAndUrl(b.key)}
                className={[
                  "px-3 py-1.5 rounded-xl text-sm border",
                  preset === b.key ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setSearch(e.target.value);
                }}
                placeholder="Search products…"
                className="pl-9 pr-3 py-2 rounded-xl border w-[260px] max-w-full"
              />
            </div>

            {!editingId && !showEditor && (isSuper || isAdmin) && (
              <button
                type="button"
                onClick={startNewProduct}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Add new product
              </button>
            )}

            <button
              type="button"
              onClick={async () => { await Promise.all([listQ.refetch(), offersSummaryQ.refetch()]); }

              }
              disabled={listQ.isFetching}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
              title="Reload products"
            >
              {listQ.isFetching ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {/* ✅ Editor area */}
      {(showEditor || !!editingId) && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setShowEditor(false);
              setEditingId(null);
              setOffersProductId(null);

              setPending(defaultPending);
              setFiles([]);
              setVariantRows([]);
              setSelectedAttrs({});
              setOfferVariants([]);
            }}
            className="rounded-xl border border-slate-300 bg-danger text-white px-3 py-2 text-sm hover:bg-slate-50 ml-auto mx-10 hover:text-black"
          >
            Close Form
          </button>

          {editingId && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
              Editing: <span className="font-semibold">{(pending.title || "").trim() || "Untitled product"}</span>
              <span className="ml-2 text-xs text-amber-700/80">
                (ID: <span className="font-mono">{editingId}</span>)
              </span>
            </div>
          )}

          {editingId && offersProductId && (
            <div className="rounded-2xl border bg-white shadow-sm">
              <SuppliersOfferManager
                productId={offersProductId}
                variants={supplierVariants}
                suppliers={suppliersQ.data}
                token={token}
                readOnly={!(isSuper || isAdmin)}
                defaultUnitCost={Number(pending.price) || 0}
                onSaved={() => {
                  qc.invalidateQueries({
                    queryKey: ["admin", "products", "locked-variant-ids", { productId: editingId }],
                  });
                  qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] });
                  qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
                }}
              />
            </div>
          )}

          {/* Product Add/Edit Form */}
          <div className="rounded-2xl border bg-white shadow-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{editingId ? "Edit product" : "Create product (Admin)"}</div>
                <div className="text-sm text-slate-500">Admin can create and edit products on behalf of any supplier.</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Title</label>
                    <input
                      value={pending.title}
                      onChange={(e) => setPending((p) => ({ ...p, title: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      placeholder="Product title"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">Price (NGN)</label>
                    <input
                      value={pending.price}
                      onChange={(e) => setPending((p) => ({ ...p, price: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Status</label>
                    <select
                      value={pending.status}
                      onChange={(e) => setPending((p) => ({ ...p, status: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="PUBLISHED">PUBLISHED</option>
                      <option value="LIVE">LIVE</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">SKU</label>
                    <input
                      value={pending.sku}
                      onChange={(e) => setPending((p) => ({ ...p, sku: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      placeholder="SKU"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Category</label>
                    <select
                      value={pending.categoryId}
                      onChange={(e) => setPending((p) => ({ ...p, categoryId: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                    >
                      <option value="">— Select category —</option>
                      {(catsQ.data ?? [])
                        .filter((c) => c.isActive)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">Brand</label>
                    <select
                      value={pending.brandId}
                      onChange={(e) => setPending((p) => ({ ...p, brandId: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                    >
                      <option value="">— Select brand —</option>
                      {(brandsQ.data ?? [])
                        .filter((b) => b.isActive)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Supplier</label>
                  <select
                    value={pending.supplierId || ""}
                    onChange={(e) => setPending((p) => ({ ...p, supplierId: e.target.value }))}
                    className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                  >
                    <option value="">— Select supplier —</option>
                    {(suppliersQ.data ?? [])
                      .filter((s) => (s.status || "").toUpperCase() === "ACTIVE")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <div className="text-xs text-slate-500 mt-1">Required. This also defaults the supplier in the offers manager.</div>
                </div>

                {!editingId && (
                  <div>
                    <label className="text-sm font-medium text-slate-700">Supplier available qty (create)</label>
                    <input
                      value={pending.supplierAvailableQty}
                      onChange={(e) => setPending((p) => ({ ...p, supplierAvailableQty: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      placeholder="e.g. 10"
                      inputMode="numeric"
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-slate-700">Description</label>
                  <textarea
                    value={pending.description}
                    onChange={(e) => setPending((p) => ({ ...p, description: e.target.value }))}
                    className="mt-1 w-full rounded-xl border px-3 py-2 min-h-[120px]"
                    placeholder="Product description"
                  />
                </div>
              </div>

              {/* Right */}
              <div className="space-y-3">
                <div className="rounded-2xl border p-4">
                  <div className="text-sm font-semibold">Images</div>
                  <div className="text-xs text-slate-500">Paste URLs (one per line) and/or upload local files.</div>

                  <div className="mt-3">
                    <label className="text-sm font-medium text-slate-700">Image URLs</label>
                    <textarea
                      value={pending.imageUrls}
                      onChange={(e) => setPending((p) => ({ ...p, imageUrls: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2 min-h-[110px]"
                      placeholder="https://…"
                    />
                  </div>

                  <div className="mt-3 flex flex-col md:flex-row md:items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={(e) => setFiles(Array.from(e.target.files || []))}
                      className="text-sm"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const uploaded = await uploadLocalFiles();
                          appendUploadedUrlsToForm(uploaded);
                        } catch (e: any) {
                          openModal({ title: "Uploads", message: getHttpErrorMessage(e, "Upload failed") });
                        }
                      }}
                      disabled={!files.length || uploading}
                      className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {uploading ? "Uploading…" : "Upload selected"}
                    </button>
                  </div>

                  {urlPreviews.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-slate-600">URL previews</div>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
                        {urlPreviews.map((u, idx) => (
                          <div key={u + idx} className="rounded-xl border p-2">
                            <div className="aspect-square rounded-lg overflow-hidden bg-slate-50">
                              <img src={u} alt="" className="w-full h-full object-cover" />
                            </div>
                            <input
                              value={u}
                              onChange={(e) => setUrlAt(idx, e.target.value)}
                              className="mt-2 w-full rounded-lg border px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => removeUrlAt(idx)}
                              className="mt-2 w-full rounded-lg border px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Attributes */}
                <div className="rounded-2xl border bg-white">
                  <div className="p-4 border-b">
                    <div className="font-semibold">Attributes</div>
                    <div className="text-xs text-slate-500">Optional details used for filtering and variant setup.</div>
                  </div>

                  <div className="p-4 space-y-3">
                    {attrColor?.type === "SELECT" && (
                      <div>
                        <label className="text-sm font-medium text-slate-700">{attrColor.name}</label>
                        <select
                          value={getAttrValue(attrColor.id)}
                          onChange={(e) => setAttr(attrColor.id, e.target.value)}
                          className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                        >
                          <option value="">— Select —</option>
                          {(attrColor.values ?? [])
                            .filter((v) => v.isActive)
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {attrMaterial && (
                      <div>
                        <label className="text-sm font-medium text-slate-700">{attrMaterial.name}</label>
                        <input
                          value={getAttrValue(attrMaterial.id)}
                          onChange={(e) => setAttr(attrMaterial.id, e.target.value)}
                          className="mt-1 w-full rounded-xl border px-3 py-2"
                          placeholder={attrMaterial.placeholder || "Enter material..."}
                        />
                      </div>
                    )}

                    {attrSize?.type === "SELECT" && (
                      <div>
                        <label className="text-sm font-medium text-slate-700">{attrSize.name}</label>
                        <select
                          value={getAttrValue(attrSize.id)}
                          onChange={(e) => setAttr(attrSize.id, e.target.value)}
                          className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                        >
                          <option value="">— Select —</option>
                          {(attrSize.values ?? [])
                            .filter((v) => v.isActive)
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {attrVolume?.type === "SELECT" && (
                      <div>
                        <label className="text-sm font-medium text-slate-700">{attrVolume.name}</label>
                        <select
                          value={getAttrValue(attrVolume.id)}
                          onChange={(e) => setAttr(attrVolume.id, e.target.value)}
                          className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                        >
                          <option value="">— Select —</option>
                          {(attrVolume.values ?? [])
                            .filter((v) => v.isActive)
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {attrWeight?.type === "SELECT" && (
                      <div>
                        <label className="text-sm font-medium text-slate-700">{attrWeight.name}</label>
                        <select
                          value={getAttrValue(attrWeight.id)}
                          onChange={(e) => setAttr(attrWeight.id, e.target.value)}
                          className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                        >
                          <option value="">— Select —</option>
                          {(attrWeight.values ?? [])
                            .filter((v) => v.isActive)
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {!attrColor && !attrMaterial && !attrSize && !attrVolume && !attrWeight && (
                      <div className="text-sm text-slate-500">No active attributes found (Color/Material/Size/Volume/Weight).</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Variants editor */}
            <div className="mt-4 rounded-2xl border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Variants</div>
                  <div className="text-xs text-slate-500">Add combinations (SELECT attributes only). Optional price bump per row.</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addVariantCombo}
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50"
                    disabled={!selectableAttrs.length}
                  >
                    Add row
                  </button>

                  {editingId && initialVariantIdsRef.current.size > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setClearAllVariantsIntent(true);
                        setVariantsDirty(true);
                        setVariantRows([]);
                      }}
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-rose-50 text-rose-700 border-rose-200"
                      title="Explicitly remove all variants (will replace on save)"
                    >
                      Remove all variants
                    </button>
                  )}
                </div>
              </div>

              {/* Quick add */}
              <div className="mt-3 rounded-xl border bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-600 mb-2">Add a new variant combo</div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {selectableAttrs.map((a) => (
                    <div key={a.id}>
                      <label className="text-xs text-slate-600">{a.name}</label>
                      <select
                        value={newCombo[a.id] || ""}
                        onChange={(e) => setNewCombo((p) => ({ ...p, [a.id]: e.target.value }))}
                        className="mt-1 w-full rounded-lg border px-2 py-1 bg-white"
                      >
                        <option value="">—</option>
                        {(a.values || []).filter((v) => v.isActive).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}

                  <div>
                    <label className="text-xs text-slate-600">Price bump</label>
                    <input
                      value={newComboBump}
                      onChange={(e) => setNewComboBump(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-2 py-1 bg-white"
                      placeholder="e.g. 1000"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={addNewComboRow}
                    disabled={!selectableAttrs.length}
                    className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-60"
                  >
                    Add variant combo
                  </button>
                </div>
              </div>

              {variantRows.length === 0 && <div className="mt-3 text-sm text-slate-500">No variant rows yet.</div>}

              {variantRows.length > 0 && (
                <div className="mt-3 overflow-auto">
                  <table className="min-w-[720px] w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {selectableAttrs.map((a) => (
                          <th key={a.id} className="text-left px-3 py-2">
                            {a.name}
                          </th>
                        ))}
                        <th className="text-left px-3 py-2">Price bump</th>
                        <th className="text-right px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {variantRows.map((row, index) => {
                        const isLocked = lockedVariantIds.has(row.id);
                        const rk = rowKey(row, index);

                        return (
                          <React.Fragment key={row.id}>
                            <tr>
                              {selectableAttrs.map((a) => (
                                <td key={a.id} className="px-3 py-2">
                                  <select
                                    value={row.selections[a.id] || ""}
                                    onChange={(e) => setVariantRowSelection(row.id, a.id, e.target.value)}
                                    disabled={isLocked}
                                    className={[
                                      "w-full rounded-lg border px-2 py-1 bg-white",
                                      isLocked ? "opacity-60 cursor-not-allowed" : "",
                                    ].join(" ")}
                                  >
                                    <option value="">—</option>
                                    {(a.values || []).filter((v) => v.isActive).map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              ))}

                              <td className="px-3 py-2">
                                <input
                                  value={row.priceBump}
                                  onChange={(e) => setVariantRowPriceBump(row.id, e.target.value)}
                                  className="w-full rounded-lg border px-2 py-1"
                                  placeholder="e.g. 1000"
                                  inputMode="decimal"
                                />
                                {isLocked && <div className="text-[11px] text-slate-500 mt-1">In use: only price bump can be edited</div>}
                              </td>

                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeVariantRow(row.id)}
                                  disabled={isLocked}
                                  className={[
                                    "rounded-lg border px-2 py-1 text-xs",
                                    isLocked ? "opacity-60 cursor-not-allowed bg-slate-50" : "hover:bg-slate-50",
                                  ].join(" ")}
                                >
                                  {isLocked ? "In use" : "Remove"}
                                </button>
                              </td>
                            </tr>

                            {comboErrors[rk] && (
                              <tr>
                                <td colSpan={selectableAttrs.length + 2} className="px-3 pb-2">
                                  <div className="text-sm text-red-600">{comboErrors[rk]}</div>
                                </td>
                              </tr>
                            )}

                            {emptyRowErrors[rk] && (
                              <tr>
                                <td colSpan={selectableAttrs.length + 2} className="px-3 pb-2">
                                  <div className="text-sm text-red-600">{emptyRowErrors[rk]}</div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>


            <button
              type="button"
              onClick={saveOrCreate}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 my-3"
              disabled={createM.isPending || updateM.isPending || uploading || hasDuplicateCombos}
            >
              {editingId ? (updateM.isPending ? "Saving..." : "Save changes") : createM.isPending ? "Creating..." : "Create product"}
            </button>
          </div>
        </div>
      )}

      {/* Products table */}
      <div className="border rounded-md overflow-auto bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("title")}>
                Title <SortIndicator k="title" />
              </th>
              <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("price")}>
                Price <SortIndicator k="price" />
              </th>
              <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("avail")}>
                Avail. <SortIndicator k="avail" />
              </th>
              <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("stock")}>
                Stock <SortIndicator k="stock" />
              </th>
              <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("status")}>
                Status <SortIndicator k="status" />
              </th>
              {isSuper && (
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("owner")}>
                  Owner <SortIndicator k="owner" />
                </th>
              )}
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {listQ.isLoading && (
              <tr>
                <td className="px-3 py-3" colSpan={isSuper ? 7 : 6}>
                  Loading products…
                </td>
              </tr>
            )}

            {!listQ.isLoading &&
              displayRows.map((p: any) => {
                const stockCell =
                  p.inStock === true ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-600" />
                      In stock
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-rose-700">
                      <span className="inline-block w-2 h-2 rounded-full bg-rose-600" />
                      Out of stock
                    </span>
                  );

                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2">{p.title}</td>
                    <td className="px-3 py-2">{ngn.format(getRetailPrice(p))}</td>
                    <td className="px-3 py-2">
                      {offersSummaryQ.isLoading ? (
                        <span className="text-zinc-500 text-xs">…</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-medium">{p.availableQty ?? 0}</span>
                          <span className="text-xs text-zinc-500">
                            ({((p as any).__offerCount ?? 0)} offer{((p as any).__offerCount ?? 0) === 1 ? "" : "s"})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{stockCell}</td>
                    <td className="px-3 py-2">
                      <StatusDot label={getStatus(p)} />
                    </td>

                    {isSuper && (
                      <td className="px-3 py-2">{p.owner?.email || p.ownerEmail || p.createdByEmail || p.createdBy?.email || "—"}</td>
                    )}

                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <button type="button" onClick={() => startEdit(p)} className="px-2 py-1 rounded border text-xs">
                          Edit in form
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => updateStatusM.mutate({ id: p.id, status: "PENDING" })}
                            className="px-2 py-1 rounded bg-amber-600 text-white text-xs"
                          >
                            Submit for Review
                          </button>
                        )}

                        {isSuper &&
                          (() => {
                            const action = primaryActionForRow(p);
                            return (
                              <button
                                type="button"
                                onClick={action.onClick}
                                className={action.className || "px-2 py-1 rounded border text-xs"}
                                disabled={deleteM.isPending || restoreM.isPending || action.disabled}
                                title={action.title}
                              >
                                {action.label}
                              </button>
                            );
                          })()}
                      </div>
                    </td>
                  </tr>
                );
              })}

            {!listQ.isLoading && displayRows.length === 0 && (
              <tr>
                <td colSpan={isSuper ? 7 : 6} className="px-3 py-4 text-center text-zinc-500">
                  No products
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
