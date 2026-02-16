import React from "react";
import { PackageCheck, PackageX, Search, Wrench, Plus } from "lucide-react";
import api from "../../api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/* ===================== Types ===================== */
type SupplierOfferLite = {
  id: string;
  productId: string;
  variantId?: string | null;
  supplierId: string;
  supplierName?: string;
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number | null;
  available?: number | null;
  qty?: number | null;
  stock?: number | null;

  // ✅ important: backend uses offerPrice; some older payloads use price
  offerPrice?: number | string | null;
  unitPrice?: number | string | null;
  currency?: string | null;
};

type AdminProduct = {
  id: string;
  title: string;
  retailPrice: number | string | null;
  status: string;
  imagesJson?: string[] | string;
  createdAt?: string;
  isDeleted?: boolean;
  ownerId?: string | null;
  ownerEmail?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  supplierId?: string | null;
  sku?: string | null;
  inStock?: boolean;
  supplierOffers?: SupplierOfferLite[];
};

type AdminBrand = { id: string; name: string; slug: string; logoUrl?: string | null; isActive: boolean };
type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  isActive: boolean;
  position?: number | null;
};

/* ===================== Utils ===================== */
const STALE_TIME = 30_000;

const toArray = (x: any): any[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const isUrlish = (s?: string) => !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);

function availableUnits(o: SupplierOfferLite | any) {
  const raw = o?.availableQty ?? o?.available ?? o?.qty ?? o?.stock ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function offerUnitPrice(o: SupplierOfferLite | any) {
  const raw = o?.offerPrice ?? o?.price ?? null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function extractImageUrls(p: any): string[] {
  if (Array.isArray(p?.imagesJson)) return p.imagesJson.filter(isUrlish);
  if (typeof p?.imagesJson === "string") {
    try {
      const parsed = JSON.parse(p.imagesJson);
      if (Array.isArray(parsed)) return parsed.filter(isUrlish);
    } catch {}
    return p.imagesJson
      .split(/[\n,]/g)
      .map((t: string) => t.trim())
      .filter(isUrlish);
  }
  const candidates = [
    ...(toArray(p?.imageUrls) as string[]),
    ...(toArray(p?.images) as string[]),
    p?.image,
    p?.primaryImage,
    p?.coverUrl,
  ].filter(Boolean);
  return (candidates as string[]).filter(isUrlish);
}

function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function normalizeStatus(s: any) {
  return String(s ?? "").toUpperCase();
}
function statusRank(s: string) {
  const u = normalizeStatus(s);
  if (u === "PUBLISHED") return 0;
  if (u === "PENDING" || u === "PENDING_APPROVAL") return 1;
  return 2;
}
function timeVal(iso?: string) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function slugifyLocal(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

/* ===================== Data ===================== */
function useModeratableProductsQuery(q: string) {
  return useQuery<AdminProduct[]>({
    queryKey: ["admin", "products", "moderation", { q }],
    enabled: true,
    staleTime: STALE_TIME,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    queryFn: async () => {
      // 1) Fetch products (do NOT rely on supplierOffers being included)
      const params = {
        status: "ANY",
        q: q || undefined,
        take: 50,
        skip: 0,
        include: "owner",
      };

      // ✅ cookie auth
      const { data } = await api.get("/api/admin/products", { withCredentials: true, params });
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

      const baseRows: AdminProduct[] = (arr ?? []).map((p: any) => ({
        id: String(p.id),
        title: String(p.title ?? ""),
        retailPrice: p.retailPrice != null ? p.retailPrice : p.price != null ? p.price : null,
        status: String(p.status ?? ""),
        imagesJson: Array.isArray(p.imagesJson) || typeof p.imagesJson === "string" ? p.imagesJson : [],
        createdAt: p.createdAt ?? null,
        isDeleted: !!p.isDeleted,
        ownerId: p.ownerId ?? p.owner?.id ?? null,
        ownerEmail: p.ownerEmail ?? p.owner?.email ?? null,
        categoryId: p.categoryId ?? null,
        brandId: p.brandId ?? null,
        supplierId: p.supplierId ?? null,
        sku: p.sku ?? null,
        inStock: p.inStock !== false,
        supplierOffers: [],
      }));

      const productIds = Array.from(new Set(baseRows.map((r) => r.id))).filter(Boolean);

      // 2) Fetch supplier offers by productIds
      let offersByProductId: Record<string, SupplierOfferLite[]> = {};
      if (productIds.length) {
        try {
          // ✅ cookie auth
          const { data: offerData } = await api.get("/api/admin/supplier-offers", {
            withCredentials: true,
            params: { productIds: productIds.join(",") },
          });

          const rawOffers = Array.isArray(offerData?.data) ? offerData.data : Array.isArray(offerData) ? offerData : [];

          for (const o of rawOffers) {
            const pid = String(o?.productId ?? "");
            if (!pid) continue;

            const norm: SupplierOfferLite = {
              id: String(o?.id ?? ""),
              productId: pid,
              variantId: o?.variantId ?? null,
              supplierId: String(o?.supplierId ?? ""),
              supplierName: o?.supplierName ?? undefined,
              isActive: o?.isActive !== false,
              inStock: typeof o?.inStock === "boolean" ? o.inStock : undefined,

              availableQty: Number.isFinite(Number(o?.availableQty))
                ? Number(o.availableQty)
                : Number.isFinite(Number(o?.availableQuantity))
                ? Number(o.availableQuantity)
                : null,
              available: o?.available ?? null,
              qty: o?.qty ?? o?.quantity ?? null,
              stock: o?.stock ?? o?.stockQty ?? null,

              offerPrice: o?.offerPrice ?? o?.unitPrice ?? o?.priceNGN ?? null,
              unitPrice: o?.unitPrice ?? null,
              currency: o?.currency ?? null,
            };

            if (!offersByProductId[pid]) offersByProductId[pid] = [];
            offersByProductId[pid].push(norm);
          }
        } catch {
          // leave offers empty
        }
      }

      // 3) Attach offers onto products
      const rows = baseRows.map((p) => ({
        ...p,
        supplierOffers: offersByProductId[p.id] ?? [],
      }));

      // 4) Show everything that's NOT LIVE
      const nonLive = rows.filter((p) => p.status?.toUpperCase() !== "LIVE");

      nonLive.sort((a, b) => {
        const ra = statusRank(a.status);
        const rb = statusRank(b.status);
        if (ra !== rb) return ra - rb;
        return timeVal(b.createdAt) - timeVal(a.createdAt);
      });

      return nonLive;
    },
  });
}

function useAdminBrands() {
  return useQuery<AdminBrand[]>({
    queryKey: ["admin", "brands"],
    enabled: true,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // ✅ cookie auth
      const { data } = await api.get("/api/admin/brands", { withCredentials: true });
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return arr.map((b: any) => ({
        id: String(b.id),
        name: String(b.name ?? ""),
        slug: String(b.slug ?? ""),
        logoUrl: b.logoUrl ?? null,
        isActive: b.isActive !== false,
      }));
    },
  });
}

function useAdminCategories() {
  return useQuery<AdminCategory[]>({
    queryKey: ["admin", "categories"],
    enabled: true,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // ✅ cookie auth
      const { data } = await api.get("/api/admin/categories", { withCredentials: true });
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return arr.map((c: any) => ({
        id: String(c.id),
        name: String(c.name ?? ""),
        slug: String(c.slug ?? ""),
        parentId: c.parentId ?? null,
        isActive: c.isActive !== false,
        position: c.position ?? null,
      }));
    },
  });
}

/* ===================== Product patch helper ===================== */
async function patchProductCatalogMeta(productId: string, meta: { brandId?: string | null; categoryId?: string | null }) {
  // ✅ cookie auth
  const { data } = await api.patch(`/api/admin/products/${encodeURIComponent(productId)}`, meta, {
    withCredentials: true,
  });

  return data?.data ?? data ?? { ok: true };
}

/* ===================== Component ===================== */
type ModerationGridProps = {
  search: string;
  setSearch: (s: string) => void;
  onApprove: (id: string) => void;
  onInspect: (p: Pick<AdminProduct, "id" | "title" | "sku">) => void;
};

export function ModerationGrid({ search, setSearch, onApprove, onInspect }: ModerationGridProps) {
  const statusOf = (p: any) => normalizeStatus(p?.status);
  const isPublished = (p: any) => statusOf(p) === "PUBLISHED";

  // ✅ eligible supplier offer = active + qty>0 + unit price > 0
  function hasEligibleSupplierOffer(p: any) {
    const offers: SupplierOfferLite[] = Array.isArray(p?.supplierOffers) ? p.supplierOffers : [];
    return offers.some((o) => {
      const active = o?.isActive !== false;
      const units = availableUnits(o);
      const unitPrice = offerUnitPrice(o);
      return active && units > 0 && unitPrice > 0;
    });
  }

  // ------ Search ------
  const [searchLocal, setSearchLocal] = React.useState(search);
  React.useEffect(() => setSearchLocal(search), [search]);
  const debouncedLocal = useDebounced(searchLocal, 350);
  React.useEffect(() => {
    if (debouncedLocal !== search) setSearch(debouncedLocal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedLocal]);

  const productsQ = useModeratableProductsQuery(debouncedLocal);
  const qc = useQueryClient();
  const gridRows = productsQ.data ?? [];

  // ------ Has-orders probe ------
  const normalizeId = (id: any) => String(id ?? "");
  const ids = React.useMemo(() => Array.from(new Set(gridRows.map((r) => normalizeId(r.id)))), [gridRows]);

  const hasOrdersQ = useQuery<Record<string, boolean>>({
    queryKey: ["admin", "products", "has-orders", { ids }],
    enabled: ids.length > 0,
    refetchOnWindowFocus: false,
    staleTime: STALE_TIME,
    queryFn: async ({ queryKey }) => {
      const [, , , keyObj] = queryKey as any;
      const fetchIds: string[] = keyObj.ids;

      const settled = await Promise.allSettled(
        fetchIds.map(async (id) => {
          // ✅ cookie auth
          const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, {
            withCredentials: true,
          });

          const has =
            typeof data?.data?.hasOrders === "boolean"
              ? data.data.hasOrders
              : typeof data?.hasOrders === "boolean"
              ? data.hasOrders
              : typeof data?.data?.orderLineCount === "number"
              ? data.data.orderLineCount > 0
              : typeof data?.orderLineCount === "number"
              ? data.orderLineCount > 0
              : false;

          return [id, !!has] as const;
        })
      );

      const entries: Array<readonly [string, boolean]> = [];
      for (const r of settled) if (r.status === "fulfilled") entries.push(r.value);

      const map = Object.fromEntries(entries);
      for (const id of fetchIds) if (!(id in map)) map[id] = false;
      return map;
    },
  });

  const hasOrder = (productId: any) => !!hasOrdersQ.data?.[normalizeId(productId)];

  // ------ Reject ------
  const rejectM = useMutation({
    mutationFn: async (id: string) => {
      // ✅ cookie auth
      const res = await api.post(`/api/admin/products/${id}/reject`, {}, { withCredentials: true });
      return res.data?.data ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      productsQ.refetch();
    },
  });

  /* ===================== Fix Brand/Category modal ===================== */
  const brandsQ = useAdminBrands();
  const categoriesQ = useAdminCategories();

  const [fixOpen, setFixOpen] = React.useState(false);
  const [fixProduct, setFixProduct] = React.useState<AdminProduct | null>(null);

  const [selectedBrandId, setSelectedBrandId] = React.useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string>("");

  const [newBrandName, setNewBrandName] = React.useState("");
  const [newBrandSlug, setNewBrandSlug] = React.useState("");
  const [newCategoryName, setNewCategoryName] = React.useState("");
  const [newCategorySlug, setNewCategorySlug] = React.useState("");
  const [newCategoryParentId, setNewCategoryParentId] = React.useState<string>("");

  const openFix = (p: AdminProduct) => {
    setFixProduct(p);
    setSelectedBrandId(p.brandId ?? "");
    setSelectedCategoryId(p.categoryId ?? "");
    setNewBrandName("");
    setNewBrandSlug("");
    setNewCategoryName("");
    setNewCategorySlug("");
    setNewCategoryParentId("");
    setFixOpen(true);
  };

  const closeFix = () => {
    setFixOpen(false);
    setFixProduct(null);
  };

  const createBrandM = useMutation({
    mutationFn: async () => {
      const name = newBrandName.trim();
      if (!name) throw new Error("Brand name is required");
      const slug = (newBrandSlug.trim() || slugifyLocal(name)).trim();
      // ✅ cookie auth
      const { data } = await api.post("/api/admin/brands", { name, slug, isActive: true }, { withCredentials: true });
      return data?.brand ?? data?.data ?? data;
    },
    onSuccess: async (created: any) => {
      await qc.invalidateQueries({ queryKey: ["admin", "brands"] });
      const id = String(created?.id || "");
      if (id) setSelectedBrandId(id);
      setNewBrandName("");
      setNewBrandSlug("");
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || "Failed to create brand";
      window.alert(msg);
    },
  });

  const createCategoryM = useMutation({
    mutationFn: async () => {
      const name = newCategoryName.trim();
      if (!name) throw new Error("Category name is required");
      const slug = (newCategorySlug.trim() || slugifyLocal(name)).trim();
      const parentId = newCategoryParentId || null;

      // ✅ cookie auth
      const { data } = await api.post(
        "/api/admin/categories",
        { name, slug, parentId, position: 0, isActive: true },
        { withCredentials: true }
      );
      return data?.category ?? data?.data ?? data;
    },
    onSuccess: async (created: any) => {
      await qc.invalidateQueries({ queryKey: ["admin", "categories"] });
      const id = String(created?.id || "");
      if (id) setSelectedCategoryId(id);
      setNewCategoryName("");
      setNewCategorySlug("");
      setNewCategoryParentId("");
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || "Failed to create category";
      window.alert(msg);
    },
  });

  const saveAndApproveM = useMutation({
    mutationFn: async () => {
      if (!fixProduct) throw new Error("No product selected");

      const meta = {
        brandId: selectedBrandId || null,
        categoryId: selectedCategoryId || null,
      };

      await patchProductCatalogMeta(fixProduct.id, meta);
      return true;
    },
    onSuccess: () => {
      if (fixProduct) onApprove(fixProduct.id);

      qc.invalidateQueries({ queryKey: ["admin", "products"] });
      productsQ.refetch();
      closeFix();
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.error || e?.message || "Failed to save brand/category. Use Inspect to set it manually.";
      window.alert(msg);
    },
  });

  /* ===================== UI ===================== */
  return (
    <>
      {/* Search */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={searchLocal}
          onChange={(e) => setSearchLocal(e.target.value)}
          placeholder="Search by title…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border bg-white"
        />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {gridRows.map((p) => {
          const published = isPublished(p);
          const offersPresent = hasEligibleSupplierOffer(p);
          const ordersPresent = hasOrder(p.id);
          const checkingOrders = hasOrdersQ.isLoading;

          // ✅ Approve only when ALL are satisfied
          const disableApprove = !published || !offersPresent || checkingOrders;

          const approveTitle = checkingOrders
            ? "Checking orders…"
            : !published
            ? "Only PUBLISHED items can be approved"
            : !offersPresent
            ? "Needs at least one active supplier offer with quantity and price"
            : ordersPresent
            ? "Cannot approve: product already has orders"
            : "Approve product";

          const brandMissing = !p.brandId;
          const categoryMissing = !p.categoryId;

          return (
            <div key={p.id} className="rounded-2xl border bg-white overflow-hidden shadow-sm">
              {/* Thumbnails */}
              <div className="p-3">
                {(() => {
                  const urls = extractImageUrls(p);
                  return urls.length ? (
                    <div className="grid grid-cols-5 sm:grid-cols-6 gap-1">
                      {urls.map((src, idx) => (
                        <div
                          key={`${p.id}-img-${idx}`}
                          className="relative w-full pt-[100%] bg-zinc-100 overflow-hidden rounded"
                        >
                          <img
                            src={src}
                            alt={`${p.title || "Product"} image ${idx + 1}`}
                            className="absolute inset-0 w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-28 rounded bg-zinc-100 grid place-items-center text-xs text-zinc-500">No images</div>
                  );
                })()}
              </div>

              {/* Actions */}
              <div className="px-3 pb-3">
                {/* ✅ Desktop/tablet: original horizontal layout */}
                <div className="hidden md:flex mt-1 items-center justify-between gap-2">
                  <div className="inline-flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        if (disableApprove) {
                          window.alert(approveTitle);
                          return;
                        }
                        onApprove(p.id);
                      }}
                      disabled={disableApprove}
                      className={[
                        "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg",
                        !disableApprove
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-emerald-600/30 text-white/70 cursor-not-allowed",
                      ].join(" ")}
                      title={approveTitle}
                    >
                      <PackageCheck size={16} /> Approve
                    </button>

                    <button
                      onClick={() => onInspect({ id: p.id, title: p.title, sku: p.sku ?? (null as any) })}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5"
                      title="Go to Manage and open this item"
                    >
                      <Search size={16} /> Inspect
                    </button>

                    <button
                      onClick={() => openFix(p)}
                      className={[
                        "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border",
                        brandMissing || categoryMissing ? "bg-amber-50 hover:bg-amber-100" : "bg-white hover:bg-black/5",
                      ].join(" ")}
                      title="Quickly set Brand/Category (and optionally create them) then approve"
                    >
                      <Wrench size={16} /> Fix
                    </button>
                  </div>

                  <button
                    onClick={() => rejectM.mutate(p.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                    title={
                      checkingOrders
                        ? "Checking orders…"
                        : ordersPresent
                        ? "Cannot reject: product already has orders"
                        : "Reject product"
                    }
                    disabled={checkingOrders || ordersPresent}
                  >
                    <PackageX size={16} /> Reject
                  </button>
                </div>

                {/* ✅ Mobile: clean grid layout (no overflow / wrapping mess) */}
                <div className="md:hidden mt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        if (disableApprove) {
                          window.alert(approveTitle);
                          return;
                        }
                        onApprove(p.id);
                      }}
                      disabled={disableApprove}
                      className={[
                        "w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold",
                        !disableApprove
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-emerald-600/30 text-white/70 cursor-not-allowed",
                      ].join(" ")}
                      title={approveTitle}
                    >
                      <PackageCheck size={16} /> Approve
                    </button>

                    <button
                      onClick={() => onInspect({ id: p.id, title: p.title, sku: p.sku ?? (null as any) })}
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold border bg-white hover:bg-black/5"
                      title="Go to Manage and open this item"
                    >
                      <Search size={16} /> Inspect
                    </button>

                    <button
                      onClick={() => openFix(p)}
                      className={[
                        "col-span-2 w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold border",
                        brandMissing || categoryMissing ? "bg-amber-50 hover:bg-amber-100" : "bg-white hover:bg-black/5",
                      ].join(" ")}
                      title="Quickly set Brand/Category (and optionally create them) then approve"
                    >
                      <Wrench size={16} /> Fix brand/category
                    </button>

                    <button
                      onClick={() => rejectM.mutate(p.id)}
                      className="col-span-2 w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                      title={
                        checkingOrders
                          ? "Checking orders…"
                          : ordersPresent
                          ? "Cannot reject: product already has orders"
                          : "Reject product"
                      }
                      disabled={checkingOrders || ordersPresent}
                    >
                      <PackageX size={16} /> Reject
                    </button>
                  </div>
                </div>

                {/* Hints */}
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-600">
                  <span
                    className={
                      published
                        ? "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700"
                        : "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700"
                    }
                  >
                    Status: {productsQ.isLoading ? "…" : p?.status || "—"}
                  </span>

                  <span
                    className={
                      offersPresent
                        ? "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700"
                        : "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700"
                    }
                  >
                    Supplier offer: {productsQ.isLoading ? "…" : offersPresent ? "present" : "missing"}
                  </span>

                  <span
                    className={
                      ordersPresent
                        ? "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700 "
                        : "inline-flex items-center gap-1 px-2 py-0.5 rounded  bg-emerald-50 text-emerald-700"
                    }
                  >
                    Orders: {hasOrdersQ.isLoading ? "…" : ordersPresent ? "present" : "none"}
                  </span>

                  <span
                    className={
                      p.brandId
                        ? "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700"
                        : "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700"
                    }
                  >
                    Brand: {p.brandId ? "set" : "missing"}
                  </span>

                  <span
                    className={
                      p.categoryId
                        ? "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700"
                        : "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700"
                    }
                  >
                    Category: {p.categoryId ? "set" : "missing"}
                  </span>
                </div>
              </div>

              {/* Basic details */}
              <div className="px-3 pb-3">
                <div className="font-medium truncate">{p.title || "Untitled product"}</div>
                <div className="text-xs text-zinc-500">
                  {p.sku ? `SKU: ${p.sku}` : ""}
                  {p.sku && p.retailPrice != null ? " • " : ""}
                  {p.retailPrice != null ? `₦${Number(p.retailPrice || 0).toLocaleString()}` : ""}
                </div>
              </div>
            </div>
          );
        })}

        {!productsQ.isLoading && gridRows.length === 0 && (
          <div className="col-span-full text-center text-zinc-500 py-8">Nothing to review right now.</div>
        )}
      </div>

      {/* ===================== Modal ===================== */}
      {fixOpen && fixProduct && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={closeFix} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl rounded-2xl border bg-white shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">Fix Brand / Category</div>
                  <div className="text-xs text-zinc-500 truncate">
                    {fixProduct.title || "Untitled"} {fixProduct.sku ? `• ${fixProduct.sku}` : ""}
                  </div>
                </div>
                <button className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5" onClick={closeFix}>
                  Close
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Brand picker */}
                  <div className="rounded-xl border p-3">
                    <div className="text-xs font-semibold text-zinc-700 mb-1">Brand</div>
                    <select
                      className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
                      value={selectedBrandId}
                      onChange={(e) => setSelectedBrandId(e.target.value)}
                    >
                      <option value="">{brandsQ.isLoading ? "Loading…" : "— Select brand —"}</option>
                      {(brandsQ.data ?? [])
                        .filter((b) => b.isActive !== false)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>

                    <div className="mt-3 border-t pt-3">
                      <div className="text-[11px] text-zinc-500 mb-2">Create brand (Super Admin)</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          className="rounded-lg border px-3 py-2 text-sm"
                          placeholder="Brand name"
                          value={newBrandName}
                          onChange={(e) => {
                            setNewBrandName(e.target.value);
                            if (!newBrandSlug.trim()) setNewBrandSlug(slugifyLocal(e.target.value));
                          }}
                        />
                        <input
                          className="rounded-lg border px-3 py-2 text-sm"
                          placeholder="Slug (optional)"
                          value={newBrandSlug}
                          onChange={(e) => setNewBrandSlug(e.target.value)}
                        />
                      </div>
                      <button
                        className="mt-2 inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60"
                        disabled={createBrandM.isPending}
                        onClick={() => createBrandM.mutate()}
                      >
                        <Plus size={16} /> {createBrandM.isPending ? "Creating…" : "Create brand"}
                      </button>
                    </div>
                  </div>

                  {/* Category picker */}
                  <div className="rounded-xl border p-3">
                    <div className="text-xs font-semibold text-zinc-700 mb-1">Category</div>
                    <select
                      className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
                      value={selectedCategoryId}
                      onChange={(e) => setSelectedCategoryId(e.target.value)}
                    >
                      <option value="">{categoriesQ.isLoading ? "Loading…" : "— Select category —"}</option>
                      {(categoriesQ.data ?? [])
                        .filter((c) => c.isActive !== false)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>

                    <div className="mt-3 border-t pt-3">
                      <div className="text-[11px] text-zinc-500 mb-2">Create category (Super Admin)</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          className="rounded-lg border px-3 py-2 text-sm"
                          placeholder="Category name"
                          value={newCategoryName}
                          onChange={(e) => {
                            setNewCategoryName(e.target.value);
                            if (!newCategorySlug.trim()) setNewCategorySlug(slugifyLocal(e.target.value));
                          }}
                        />
                        <input
                          className="rounded-lg border px-3 py-2 text-sm"
                          placeholder="Slug (optional)"
                          value={newCategorySlug}
                          onChange={(e) => setNewCategorySlug(e.target.value)}
                        />
                        <select
                          className="rounded-lg border px-3 py-2 text-sm bg-white md:col-span-2"
                          value={newCategoryParentId}
                          onChange={(e) => setNewCategoryParentId(e.target.value)}
                        >
                          <option value="">No parent</option>
                          {(categoriesQ.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="mt-2 inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60"
                        disabled={createCategoryM.isPending}
                        onClick={() => createCategoryM.mutate()}
                      >
                        <Plus size={16} /> {createCategoryM.isPending ? "Creating…" : "Create category"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border bg-zinc-50 p-3 text-xs text-zinc-600">
                  <b>Note:</b> This shortcut only fixes <b>Brand</b> and <b>Category</b>. Attributes are managed in your
                  Catalog Settings page to avoid duplicate schema changes.
                </div>
              </div>

              <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
                <button
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5"
                  onClick={() => onInspect({ id: fixProduct.id, title: fixProduct.title, sku: fixProduct.sku ?? (null as any) })}
                >
                  Inspect instead
                </button>

                <button
                  className="px-4 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90 disabled:opacity-60"
                  disabled={saveAndApproveM.isPending}
                  onClick={() => saveAndApproveM.mutate()}
                  title="Save Brand/Category to product (if possible) then approve"
                >
                  {saveAndApproveM.isPending ? "Saving…" : "Save & approve"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
