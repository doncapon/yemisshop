import { PackageCheck, PackageX, Search } from 'lucide-react';
import api from '../../api/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';

/* ===================== Types ===================== */
type SupplierOfferLite = {
  id: string;
  productId: string;
  variantId?: string | null;
  supplierId: string;
  supplierName?: string;
  isActive?: boolean;
  inStock?: boolean;
  // any of these may exist depending on backend:
  availableQty?: number | null;
  available?: number | null;
  qty?: number | null;
  stock?: number | null;
};

type AdminProduct = {
  id: string;
  title: string;
  price: number | string | null;
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

/* ===================== Utils ===================== */
const STALE_TIME = 30_000;

const toArray = (x: any): any[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const isUrlish = (s?: string) => !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);

// safe available units from many shapes
function availableUnits(o: SupplierOfferLite | any) {
  const raw = o?.availableQty ?? o?.available ?? o?.qty ?? o?.stock ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function extractImageUrls(p: any): string[] {
  if (Array.isArray(p?.imagesJson)) return p.imagesJson.filter(isUrlish);
  if (typeof p?.imagesJson === 'string') {
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

// tiny debounce hook
function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ===================== Data ===================== */
function normalizeStatus(s: any) {
  return String(s ?? '').toUpperCase();
}

// sorting: PUBLISHED first (rank 0), then PENDING-like (rank 1), then others (rank 2)
// within same rank, newest first by createdAt
function statusRank(s: string) {
  const u = normalizeStatus(s);
  if (u === 'PUBLISHED') return 0;
  if (u === 'PENDING' || u === 'PENDING_APPROVAL') return 1;
  return 2;
}
function timeVal(iso?: string) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function useModeratableProductsQuery(token: string | null | undefined, q: string) {
  return useQuery<AdminProduct[]>({
    queryKey: ['admin', 'products', 'moderation', { q }],
    enabled: !!token,
    staleTime: STALE_TIME,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    queryFn: async () => {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      // no status filter server-side so we can collect multiple states
      const params = {
        q: q || undefined,
        take: 50,
        skip: 0,
        include: 'supplierOffers,owner',
      };
      const { data } = await api.get('/api/admin/products', { headers, params });
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

      const rows: AdminProduct[] = (arr ?? []).map((p: any) => ({
        id: String(p.id),
        title: String(p.title ?? ''),
        price: p.price != null ? p.price : null,
        status: String(p.status ?? ''),
        imagesJson: Array.isArray(p.imagesJson) || typeof p.imagesJson === 'string' ? p.imagesJson : [],
        createdAt: p.createdAt ?? null,
        isDeleted: !!p.isDeleted,
        ownerId: p.ownerId ?? p.owner?.id ?? null,
        ownerEmail: p.ownerEmail ?? p.owner?.email ?? null,
        categoryId: p.categoryId ?? null,
        brandId: p.brandId ?? null,
        supplierId: p.supplierId ?? null,
        sku: p.sku ?? null,
        inStock: p.inStock !== false,
        supplierOffers: Array.isArray(p.supplierOffers) ? p.supplierOffers : [],
      }));

      // 1) Only NOT LIVE
      const nonLive = rows.filter((p) => normalizeStatus(p.status) !== 'LIVE');

      // 2) Sort: PUBLISHED first, then PENDING-like, then others; and newest first inside each bucket
      nonLive.sort((a, b) => {
        const ra = statusRank(a.status);
        const rb = statusRank(b.status);
        if (ra !== rb) return ra - rb;
        // newest first
        return timeVal(b.createdAt) - timeVal(a.createdAt);
      });

      return nonLive;
    },
  });
}

/* ===================== Component ===================== */
type ModerationGridProps = {
  search: string;                 // parent-provided value (we’ll keep it in sync)
  token: string;
  setSearch: (s: string) => void; // parent setter (we’ll call it after debounce)
  onApprove: (id: string) => void;
  onInspect: (p: Pick<AdminProduct, 'id' | 'title' | 'sku'>) => void;
};

export function ModerationGrid({
  token,
  search,
  setSearch,
  onApprove,
  onInspect,
}: ModerationGridProps) {
  const statusOf = (p: any) => normalizeStatus(p?.status);
  const isPublished = (p: any) => statusOf(p) === 'PUBLISHED';

  // Supplier-offer check:
  // - default active to true when missing
  // - if inStock is missing, derive from available units
  function hasSupplierOffer(p: any) {
    const offers: SupplierOfferLite[] = Array.isArray(p?.supplierOffers) ? p.supplierOffers : [];
    return offers.some((o) => {
      const active = o?.isActive !== false; // treat undefined as active
      const units = availableUnits(o);
      const stockFlag = typeof o?.inStock === 'boolean' ? o.inStock : units > 0;
      return active && stockFlag && units > 0;
    });
  }

  // ------ Search (single debounce in the component) ------
  const [searchLocal, setSearchLocal] = React.useState(search);
  React.useEffect(() => setSearchLocal(search), [search]);
  const debouncedLocal = useDebounced(searchLocal, 350);
  React.useEffect(() => {
    if (debouncedLocal !== search) setSearch(debouncedLocal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedLocal]);

  // Products (non-LIVE, sorted Published → Pending → Others)
  const productsQ = useModeratableProductsQuery(token, debouncedLocal);
  const qc = useQueryClient();

  const gridRows = productsQ.data ?? [];

  // ------ Has-orders probe (map: id -> boolean) ------
  const normalizeId = (id: any) => String(id ?? '');
  const ids = React.useMemo(
    () => Array.from(new Set(gridRows.map((r) => normalizeId(r.id)))),
    [gridRows]
  );

  const hasOrdersQ = useQuery<Record<string, boolean>>({
    queryKey: ['admin', 'products', 'has-orders', { ids }],
    enabled: !!token && ids.length > 0,
    refetchOnWindowFocus: false,
    staleTime: STALE_TIME,
    queryFn: async ({ queryKey }) => {
      const [, , , keyObj] = queryKey as any;
      const fetchIds: string[] = keyObj.ids;
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

      const settled = await Promise.allSettled(
        fetchIds.map(async (id) => {
          const { data } = await api.get(
            `/api/admin/products/${encodeURIComponent(id)}/has-orders`,
            { headers: hdr }
          );
          const has =
            typeof data === 'boolean'
              ? data
              : typeof data?.has === 'boolean'
              ? data.has
              : typeof data?.data?.has === 'boolean'
              ? data.data.has
              : typeof data?.count === 'number'
              ? data.count > 0
              : typeof data?.data?.count === 'number'
              ? data.data.count > 0
              : false;

          return [id, !!has] as const;
        })
      );

      const entries: Array<readonly [string, boolean]> = [];
      for (const r of settled) {
        if (r.status === 'fulfilled') entries.push(r.value);
      }
      const map = Object.fromEntries(entries);
      for (const id of fetchIds) if (!(id in map)) map[id] = false;
      return map;
    },
  });

  const hasOrder = (productId: any) => !!hasOrdersQ.data?.[normalizeId(productId)];

  // ------ Actions ------
  const rejectM = useMutation({
    mutationFn: async (id: string) => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await api.post(`/api/admin/products/${id}/reject`, {}, { headers: hdr });
      return res.data?.data ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      productsQ.refetch();
    },
  });

  /* ===================== UI ===================== */
  return (
    <>
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={searchLocal}
          onChange={(e) => setSearchLocal(e.target.value)}
          placeholder="Search by title…"
          className="pl-9 pr-3 py-2 rounded-xl border bg-white"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {gridRows.map((p) => {
          const published = isPublished(p);
          const offersPresent = hasSupplierOffer(p);
          const ordersPresent = hasOrder(p.id);
          const checkingOrders = hasOrdersQ.isLoading;

          // Disable if: NOT published OR no supplier offer OR has orders (also disable while checking)
          const disableApprove = !published || !offersPresent || checkingOrders || ordersPresent;

          const approveTitle = checkingOrders
            ? 'Checking orders…'
            : !published
            ? 'Only PUBLISHED items can be approved'
            : !offersPresent
            ? 'Needs at least one active supplier offer with available quantity'
            : ordersPresent
            ? 'Cannot approve: product already has orders'
            : 'Approve product';

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
                            alt={`${p.title || 'Product'} image ${idx + 1}`}
                            className="absolute inset-0 w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-28 rounded bg-zinc-100 grid place-items-center text-xs text-zinc-500">
                      No images
                    </div>
                  );
                })()}
              </div>

              {/* Actions */}
              <div className="px-3 pb-3">
                <div className="mt-1 flex items-center justify-between">
                  <div className="inline-flex gap-2">
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
                        'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg',
                        !disableApprove
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-emerald-600/30 text-white/70 cursor-not-allowed',
                      ].join(' ')}
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
                  </div>

                  <button
                    onClick={() => rejectM.mutate(p.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                    title={
                      checkingOrders
                        ? 'Checking orders…'
                        : ordersPresent
                        ? 'Cannot reject: product already has orders'
                        : 'Reject product'
                    }
                    disabled={checkingOrders || ordersPresent}
                  >
                    <PackageX size={16} /> Reject
                  </button>
                </div>

                {/* Hints */}
                <div className="mt-2 text-[11px] text-zinc-600 space-x-2">
                  <span
                    className={
                      published
                        ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700'
                        : 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700'
                    }
                  >
                    Status: {productsQ.isLoading ? '…' : p?.status || '—'}
                  </span>

                  <span
                    className={
                      offersPresent
                        ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700'
                        : 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700'
                    }
                  >
                    Supplier offer: {productsQ.isLoading ? '…' : offersPresent ? 'present' : 'missing'}
                  </span>

                  <span
                    className={
                      ordersPresent
                        ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700'
                        : 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700'
                    }
                  >
                    Orders: {hasOrdersQ.isLoading ? '…' : ordersPresent ? 'present' : 'none'}
                  </span>
                </div>
              </div>

              {/* Basic details */}
              <div className="px-3 pb-3">
                <div className="font-medium truncate">{p.title || 'Untitled product'}</div>
                <div className="text-xs text-zinc-500">
                  {p.sku ? `SKU: ${p.sku}` : ''}
                  {p.sku && p.price != null ? ' • ' : ''}
                  {p.price != null ? `₦${Number(p.price || 0).toLocaleString()}` : ''}
                </div>
              </div>
            </div>
          );
        })}

        {!productsQ.isLoading && gridRows.length === 0 && (
          <div className="col-span-full text-center text-zinc-500 py-8">
            Nothing to review right now.
          </div>
        )}
      </div>
    </>
  );
}
