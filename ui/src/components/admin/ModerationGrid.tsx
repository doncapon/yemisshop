import {
    PackageCheck,
    PackageX,
    Search
} from 'lucide-react';
import api from '../../api/client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';

type AdminProduct = {
    id: string;
    title: string;
    price: number | string;
    status: string;
    imagesJson?: string[];
    createdAt?: string;
    isDelete?: boolean;
    availableQty: boolean;
    supplierOffers: SupplierOfferLite;
    ownerId?: boolean;
    ownerEmail?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    supplierId?: string | null;
    sku?: string | null;
    inStock?: boolean;
};

type SupplierOfferLite = {
    id: string;
    productId: string;
    variantId?: string | null;
    supplierId: string;
    supplierName?: string;
    isActive?: boolean;
    inStock?: boolean;


    // any of these may exist depending on backend:
    available?: number;
    qty?: number;
    stock?: number;
};

/* =========================================================
   Moderation / Manage
   ========================================================= */
type ModerationGridProps = {
    search: string;
    token: string;
    setSearch: (s: string) => void;
    onApprove: (id: string) => void;
    onInspect: (p: Pick<AdminProduct, 'id' | 'title' | 'sku'>) => void;
};
function toArray(x: any): any[] {
    return Array.isArray(x) ? x : x == null ? [] : [x];
}

function isUrlish(s?: string) { return !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s); }

function extractImageUrls(p: any): string[] {
    // 1) straight array
    if (Array.isArray(p?.imagesJson)) {
        return p.imagesJson.filter(isUrlish);
    }
    // 2) JSON/string/CSV variants commonly seen
    if (typeof p?.imagesJson === 'string') {
        try {
            const parsed = JSON.parse(p.imagesJson);
            if (Array.isArray(parsed)) return parsed.filter(isUrlish);
        } catch { }
        return p.imagesJson
            .split(/[\n,]/g)
            .map((t: string) => t.trim())
            .filter(isUrlish);
    }
    // 3) other common fields one might get back
    const candidates = [
        ...(toArray(p?.imageUrls) as string[]),
        ...(toArray(p?.images) as string[]),
        p?.image,
        p?.primaryImage,
        p?.coverUrl,
    ].filter(Boolean);
    return candidates.filter(isUrlish);
}
const STALE_TIME = 30_000
function usePendingProductsQuery(token: string | null | undefined, searchInput: string) {
    return useQuery<AdminProduct[]>({
        queryKey: ['admin', 'products', 'pending', { q: searchInput }],
        enabled: !!token,
        staleTime: STALE_TIME,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

            // Ask backend to include supplierOffers so ModerationGrid can make decisions
            const params = {
                status: 'PENDING',
                q: searchInput || undefined,
                take: 50,
                skip: 0,
                include: 'supplierOffers,owner', // backend should support this; safe if ignored
            };

            const { data } = await api.get('/api/admin/products', { headers, params });

            // Normalize into an array
            const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
            const rows: AdminProduct[] = (arr ?? []).map((p: any) => ({
                id: String(p.id),
                title: String(p.title ?? ''),
                price: p.price,
                status: String(p.status ?? 'PENDING'),
                imagesJson: p.imagesJson,
                createdAt: p.createdAt,
                isDeleted: !!p.isDeleted,
                ownerId: p.ownerId ?? p.owner?.id ?? null,
                ownerEmail: p.ownerEmail ?? p.owner?.email ?? null,
                categoryId: p.categoryId ?? null,
                brandId: p.brandId ?? null,
                supplierId: p.supplierId ?? null,
                sku: p.sku ?? null,
                inStock: p.inStock,
                supplierOffers: Array.isArray(p.supplierOffers) ? p.supplierOffers : [],
            }));

            return rows;
        },
    });
}

export function ModerationGrid({
    token,
    search,
    setSearch,
    onApprove,
    onInspect,
}: ModerationGridProps) {
    // helpers
    function statusOf(p: any) {
        return String(p?.status || '').toUpperCase();
    }
    function isPublished(p: any) {
        return statusOf(p) === 'PUBLISHED';
    }
    function isPending(p: any) {
        return statusOf(p) === 'PENDING';
    }

    function hasSupplierOffer(p: any) {
        const offers = Array.isArray(p?.supplierOffer) ? p.supplierOffer : [];
        // Active offer with availableQty > 0 counts as “present”
        return offers.some((o: any) => (o?.isActive ?? true) && Number(o?.availableQty ?? 0) > 0);
    }

    // Can approve only when the item is PENDING and has at least one active offer
    function canApprove(p: any) {
        return isPublished(p) && hasSupplierOffer(p);
    }

    const productsQ = usePendingProductsQuery(token, search);


    // local search input (smooth typing, if you want to debounce later)
    const [searchInput, setSearchInput] = React.useState(search);
    React.useEffect(() => setSearchInput(search), [search]);

    const qc = useQueryClient();

    // The rows we actually render
    const gridRows = (productsQ.data ?? []) as any[];
    // Keep results a bit to reduce refetch churn
    const STALE_TIME = 5 * 60 * 1000;

    // Normalize to string IDs so object key lookups are consistent
    const normalizeId = (id: string | number | boolean | undefined | null) => String(id ?? '');

    // Build a stable, deduped id list for the key and the fetcher
    const ids = React.useMemo(
        () => Array.from(new Set((gridRows ?? []).map(r => normalizeId(r.id)))),
        [gridRows]
    );

    const hasOrdersQ = useQuery<Record<string, boolean>>({
        // include token in the key so a different user/session doesn’t reuse cached answers
        queryKey: ['admin', 'products', 'has-orders', { token: !!token, ids }],
        enabled: !!token && ids.length > 0,
        refetchOnWindowFocus: false,
        staleTime: STALE_TIME,

        // IMPORTANT: get ids from queryKey, not from outer closure, to avoid stale captures
        queryFn: async ({ queryKey }) => {
            const [, , , keyObj] = queryKey as any;
            const fetchIds: string[] = keyObj.ids;

            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

            // Fire them in parallel but don’t let one failure cancel all
            const settled = await Promise.allSettled(
                fetchIds.map(async (id) => {
                    try {
                        const { data, status } = await api.get(
                            `/api/admin/products/${encodeURIComponent(id)}/has-orders`,
                            { headers: hdr }
                        );

                        // Accept: boolean | {has:boolean} | {data:{has:boolean}} | {count:number}
                        const has =
                            typeof data === 'boolean' ? data
                                : typeof data?.has === 'boolean' ? data.has
                                    : typeof data?.data?.has === 'boolean' ? data.data.has
                                        : typeof data?.count === 'number' ? data.count > 0
                                            : typeof data?.data?.count === 'number' ? data.data.count > 0
                                                : false;

                        return [id, !!has] as const;
                    } catch (e: any) {
                        // If the API fails (403/500), it's safer to assume the product HAS orders,
                        // so the destructive actions stay disabled. Flip to true here.
                        const code = e?.response?.status;
                        const assumeHas = code >= 500 || code === 403 ? true : false; // 404 -> probably no orders
                        return [id, assumeHas] as const;
                    }
                })
            );

            // Build mapping; failed entries still contribute via our catch branch above
            const entries: Array<readonly [string, boolean]> = [];
            for (const r of settled) {
                if (r.status === 'fulfilled') entries.push(r.value);
                else {
                    // Shouldn't happen, but keep it safe: disable destructive action
                    const id = r.reason?.id ? normalizeId(r.reason.id) : undefined;
                    if (id) entries.push([id, true]);
                }
            }

            // If any ID is missing (unlikely), default it to true (safe)
            const map = Object.fromEntries(entries);
            for (const id of fetchIds) {
                if (!(id in map)) map[id] = true;
            }
            return map;
        },
    });

    // Helper — ALWAYS normalize productId to string
    const hasOrder = (productId: string | number | boolean) =>
        !!hasOrdersQ.data?.[normalizeId(productId)];



    const rejectM = useMutation({
        mutationFn: async (id: string) => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const res = await api.post(`/api/admin/products/${id}/reject`, {}, { headers: hdr });
            return res.data?.data ?? res.data ?? res;
        },
        onSuccess: () => {
            // Refresh moderation-related lists
            qc.invalidateQueries({ queryKey: ['admin', 'products'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
        },
    });

    return (
        <>
            <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by title…"
                    className="pl-9 pr-3 py-2 rounded-xl border bg-white"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {gridRows.map((p) => {
                    const eligible = canApprove(p);

                    return (
                        <div key={p.id} className="rounded-2xl border bg-white overflow-hidden shadow-sm">
                            {/* Thumbnails */}
                            <div className="p-3">
                                {(() => {
                                    const urls = extractImageUrls(p);
                                    return urls.length ? (
                                        <div className="grid grid-cols-5 sm:grid-cols-6 gap-1">
                                            {urls.map((src, idx) => (
                                                <div key={`${p.id}-img-${idx}`} className="relative w-full pt-[100%] bg-zinc-100 overflow-hidden rounded">
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

                            {/* Actions (with approval gating) */}
                            <div className="px-3 pb-3">
                                <div className="mt-1 flex items-center justify-between">
                                    <div className="inline-flex gap-2">
                                        <button
                                            onClick={() => {
                                                if (!eligible) {
                                                    window.alert('Cannot approve: product must be PENDING and have at least one active supplier offer.');
                                                    return;
                                                }
                                                onApprove(p.id);
                                            }}
                                            disabled={!eligible}
                                            className={[
                                                'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg',
                                                eligible
                                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                                    : 'bg-emerald-600/30 text-white/70 cursor-not-allowed',
                                            ].join(' ')}
                                            title={
                                                eligible
                                                    ? 'Approve product'
                                                    : 'Disabled — needs to be PENDING and have a supplier offer with available quantity'
                                            }
                                        >
                                            <PackageCheck size={16} /> Approve
                                        </button>

                                        <button
                                            onClick={() => onInspect({ id: p.id, title: p.title, sku: p.sku })}
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
                                            hasOrdersQ.isLoading
                                                ? 'Checking orders…'
                                                : hasOrder(p.id)
                                                    ? 'Cannot reject: product already has orders'
                                                    : 'Reject product'
                                        }
                                        disabled={hasOrdersQ.isLoading || hasOrder(p.id)}
                                    >
                                        <PackageX size={16} /> Reject
                                    </button>

                                </div>

                                {/* Tiny eligibility hint row */}
                                <div className="mt-2 text-[11px] text-zinc-600 space-x-2">
                                    <span
                                        className={
                                            isPublished(p)
                                                ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700'
                                                : 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700'
                                        }
                                    >
                                        Status  {productsQ.isLoading ? "..." : p?.status}
                                    </span>
                                    <span
                                        className={
                                            hasSupplierOffer(p)
                                                ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700'
                                                : 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700'
                                        }
                                    >
                                        Supplier offer: {productsQ.isLoading ? "..." : hasSupplierOffer(p) ? 'present' : 'missing'}
                                    </span>

                                     <span
                                        className={
                                            hasOrder(p.id)
                                                ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700'
                                                : 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700'
                                        }
                                    >
                                        Orders : {productsQ.isLoading ? "..." : hasOrder(p.id) ? 'present' : 'none'}
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

                {!productsQ.isLoading && (productsQ.data ?? []).length === 0 && (
                    <div className="col-span-full text-center text-zinc-500 py-8">
                        Nothing to review right now.
                    </div>
                )}
            </div>
        </>
    );
}
