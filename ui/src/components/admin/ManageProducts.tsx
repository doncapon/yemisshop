import React, { useEffect, useRef, useState } from "react";
import StatusDot from "../StatusDot";
import {
    Search,
} from 'lucide-react';
import { useModal } from "../ModalProvider";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounced } from "../../utils/useDebounced";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client";
import { getHttpErrorMessage } from "../../utils/httpError";
import SuppliersOfferManager from "./SuppliersOfferManager";


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

type AdminProduct = {
    id: string;
    title: string;
    price: number | string;
    status: string;
    imagesJson?: string[];
    createdAt?: string;
    isDelete?: boolean;
    wnerId?: boolean;
    availableQty: number;
    supplierOffers: SupplierOfferLite[],
    ownerEmail?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    supplierId?: string | null;
    sku?: string | null;
    inStock?: boolean;
};

type VariantChoice = {
    attributeId: string;
    valueId: string;
    label: string;
}

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
    const isSuper = role === 'SUPER_ADMIN';
    const isAdmin = role === 'ADMIN';
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const qc = useQueryClient();
    const staleTImeInSecs = 300_000;

    const ngn = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        maximumFractionDigits: 2,
    });

    function fmtN(n?: number | string) {
        const v = Number(n);
        return Number.isFinite(v) ? v : 0;
    }

    type AdminProduct = {
        id: string;
        title: string;
        price: number | string;
        status: string;
        imagesJson?: string[];
        createdAt?: string;
        isDelete?: boolean;
        ownerId?: boolean;
        availableQty: number;
        supplierOffers: SupplierOfferLite[],
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

    type AdminSupplier = {
        id: string;
        name: string;
        type: 'PHYSICAL' | 'ONLINE';
        status: string;
        contactEmail?: string | null;
        whatsappPhone?: string | null;

        apiBaseUrl?: string | null;
        apiAuthType?: 'NONE' | 'BEARER' | 'BASIC' | null;
        apiKey?: string | null;

        payoutMethod?: 'SPLIT' | 'TRANSFER' | null;
        bankCountry?: string | null;
        bankCode?: string | null;
        bankName?: string | null;
        accountNumber?: string | null;
        accountName?: string | null;
        isPayoutEnabled?: boolean | null;
    };
    function toInt(x: any, d = 0) {
        const n = Number(x);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
    }
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
    type AdminAttribute = any;

    type VariantChoice = { attributeId: string; valueId: string; label: string };

    function statusFromPreset(p: FilterPreset): 'ANY' | 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'LIVE' {
        if (p.startsWith('published')) return 'PUBLISHED';
        if (p === 'published') return 'PUBLISHED';
        if (p === 'pending') return 'PENDING';
        if (p === 'live') return 'LIVE';
        if (p === 'rejected') return 'REJECTED';
        return 'ANY';
    }



    /* ---------------- Tabs ---------------- */

    type FilterPreset =
        | 'all'
        | 'no-offer'
        | 'live'
        | 'published-with-offer'
        | 'published-no-offer'
        | 'published-with-active'
        | 'published-base-in'
        | 'published-base-out'
        | 'with-variants'
        | 'simple'
        | 'published-with-availability'
        | 'published'         // general status-only
        | 'pending'
        | 'rejected';

    // preset <-> URL sync
    const [searchParams, setSearchParams] = useSearchParams();
    const urlPreset = (searchParams.get('view') as FilterPreset) || 'all';
    const [preset, setPreset] = useState<FilterPreset>(urlPreset);

    useEffect(() => {
        setPreset((searchParams.get('view') as FilterPreset) || 'all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.toString()]);

    function setPresetAndUrl(next: FilterPreset) {
        setPreset(next);
        const sp = new URLSearchParams(searchParams);
        if (next && next !== 'all') sp.set('view', next);
        else sp.delete('view');
        setSearchParams(sp, { replace: true });
    }

    type SortKey = 'title' | 'price' | 'avail' | 'stock' | 'status' | 'owner';
    type SortDir = 'asc' | 'desc';
    // ✅ single source of truth for sorting
    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'title', dir: 'asc' });
    const toggleSort = (key: SortKey) =>
        setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

    const SortIndicator = ({ k }: { k: SortKey }) => {
        if (sort.key !== k) return <span className="opacity-50">↕</span>;
        return <span>{sort.dir === 'asc' ? '↑' : '↓'}</span>;
    };

    const statusParam = statusFromPreset(preset);

    //local input for smooth typing
    const [searchInput, setSearchInput] = React.useState(search);
    React.useEffect(() => setSearchInput(search), [search]);
    const debouncedSearch = useDebounced(searchInput, 350);

    const listQ = useQuery<AdminProduct[]>({
        queryKey: ['admin', 'products', 'manage', { q: debouncedSearch, statusParam }],
        enabled: !!token,
        queryFn: async () => {
            const { data } = await api.get('/api/admin/products', {
                headers: { Authorization: `Bearer ${token}` },
                params: { status: statusParam, q: debouncedSearch, take: 50, skip: 0, include: 'owner' },
            });
            const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
            return arr ?? [];
        },
        staleTime: staleTImeInSecs,
        gcTime: 300_000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });



    useEffect(() => {
        if (listQ.isError) {
            const e: any = listQ.error;
            console.error('Products list failed:', e?.response?.status, e?.response?.data || e?.message);
        }
    }, [listQ.isError, listQ.error]);


    useEffect(() => {
        if (listQ.isError) {
            const e: any = listQ.error;
            console.error('Products list failed:', e?.response?.status, e?.response?.data || e?.message);
        }
    }, [listQ.isError, listQ.error]);

    const rows = listQ.data ?? [];


    // --- Supplier-offer availability (derived)
    const offersSummaryQ = useQuery({
        queryKey: ['admin', 'products', 'offers-summary', { ids: rows.map(r => r.id) }],
        enabled: !!token && rows.length > 0,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const productIds = rows.map(r => r.id);
            const qs = new URLSearchParams();
            qs.set('productIds', productIds.join(','));

            const attempts = [
                `/api/admin/supplier-offers?${qs}`,
                `/api/supplier-offers?${qs}`,
                `/api/admin/products/offers?${qs}`,
            ];

            let all: SupplierOfferLite[] | null = null;

            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) { all = arr as SupplierOfferLite[]; break; }
                } catch { /* try next */ }
            }

            if (!all) {
                // fallback: per product
                const per: SupplierOfferLite[] = [];
                for (const pid of productIds) {
                    const perAttempts = [
                        `/api/admin/products/${pid}/supplier-offers`,
                        `/api/admin/products/${pid}/offers`,
                        `/api/products/${pid}/supplier-offers`,
                    ];
                    let got: SupplierOfferLite[] | null = null;
                    for (const u of perAttempts) {
                        try {
                            const { data } = await api.get(u, { headers: hdr });
                            const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                            if (Array.isArray(arr)) { got = arr as SupplierOfferLite[]; break; }
                        } catch { }
                    }
                    if (got) per.push(...got.map(o => ({ ...o, productId: o.productId || pid })));
                }
                all = per;
            }

            const offers = Array.isArray(all) ? all : [];

            const byProduct: Record<string, {
                totalAvailable: number;
                activeOffers: number;
                perSupplier: Array<{ supplierId: string; supplierName?: string; availableQty: number }>;
                inStock: boolean;
            }> = {};

            for (const o of offers) {
                const isActive = o.isActive !== false;
                if (!isActive) continue;

                const availableQty = Math.max(0, toInt((o as any).availableQty, 0));
                const pid = o.productId;
                if (!pid) continue;

                if (!byProduct[pid]) {
                    byProduct[pid] = { totalAvailable: 0, activeOffers: 0, perSupplier: [], inStock: false };
                }
                byProduct[pid].totalAvailable += availableQty;
                byProduct[pid].activeOffers += 1;
                byProduct[pid].perSupplier.push({
                    supplierId: o.supplierId,
                    supplierName: o.supplierName,
                    availableQty,
                });
            }

            Object.values(byProduct).forEach((s) => { s.inStock = s.totalAvailable > 0; });

            return byProduct;
        },
    });

    const getAvail = (p: any) => Number(offersSummaryQ.data?.[p.id]?.totalAvailable ?? 0);
    const getStock = (p: any) => (offersSummaryQ.data?.[p.id]?.inStock ? 1 : 0);
    const getOwner = (p: any) =>
        (p.owner?.email || p.ownerEmail || p.createdByEmail || p.createdBy?.email || '') as string;


    type EffectiveStatus = 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'ARCHIVED'| 'LIVE';


    type RowAction =
        | { kind: 'approve'; label: string; title: string; onClick: () => void; disabled?: boolean; className?: string }
        | { kind: 'movePending'; label: string; title: string; onClick: () => void; disabled?: boolean; className?: string }
        | { kind: 'revive'; label: string; title: string; onClick: () => void; disabled?: boolean; className?: string }
        | { kind: 'archive'; label: string; title: string; onClick: () => void; disabled?: boolean; className?: string }
        | { kind: 'delete'; label: string; title: string; onClick: () => void; disabled?: boolean; className?: string }
        | { kind: 'loading'; label: string; title: string; onClick: () => void; disabled?: boolean; className?: string };

    const getStatus = (p: any): 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'ARCHIVED'| 'LIVE' =>
        p?.isDeleted ? 'ARCHIVED' : (p?.status ?? 'PENDING');

    function primaryActionForRow(p: any): RowAction {
        const eff = getStatus(p);

        // strict offer-based availability (no p.inStock fallback)
        const s = offersSummaryQ.data?.[p.id];
        const hasActiveOffer = !!s && s.activeOffers > 0 && (s.totalAvailable ?? 0) > 0;

        const ordersKnown = !!hasOrdersQ.data;
        const ordered = hasOrder(p.id);

        if (!ordersKnown || offersSummaryQ.isLoading) {
            return {
                kind: 'loading',
                label: '…',
                title: 'Checking…',
                disabled: true,
                onClick: () => { },
                className: 'px-2 py-1 rounded bg-zinc-400 text-white',
            };
        }

        // 1) Pending + has active offer => Approve
        if (eff === 'PENDING' && hasActiveOffer) {
            return {
                kind: 'approve',
                label: 'Approve PUBLISHED',
                title: 'Publish product',
                onClick: () => submitEdit(p.id, 'approvePublished'),
                className: 'px-3 py-2 rounded-lg bg-emerald-600 text-white',
            };
        }

        // 2) Pending but NO active offer => destructive (can’t publish)
        if (eff === 'PENDING' && !hasActiveOffer) {
            return ordered
                ? {
                    kind: 'archive',
                    label: 'Archive',
                    title: 'Archive (soft delete)',
                    onClick: () => deleteM.mutate(p.id),
                    className: 'px-2 py-1 rounded bg-rose-600 text-white',
                }
                : {
                    kind: 'delete',
                    label: 'Delete',
                    title: 'Delete permanently',
                    onClick: () => deleteM.mutate(p.id),
                    className: 'px-2 py-1 rounded bg-rose-600 text-white',
                };
        }

        // 3) Published => Move to PENDING
        if (eff === 'PUBLISHED') {
            return {
                kind: 'movePending',
                label: 'Move to PENDING',
                title: 'Unpublish product (set to PENDING)',
                onClick: () => submitEdit(p.id, 'movePending'),
                className: 'px-3 py-2 rounded-lg border bg-amber-400 text-white',
            };
        }


                // 3) Live => Move to PENDING
        if (eff === 'LIVE') {
            return {
                kind: 'movePending',
                label: 'Move to PENDING',
                title: 'Unpublish product (set to PENDING)',
                onClick: () => submitEdit(p.id, 'movePending'),
                className: 'px-3 py-2 rounded-lg border bg-amber-400 text-white',
            };
        }

        // 4) Archived => Revive
        if (eff === 'ARCHIVED') {
            return {
                kind: 'revive',
                label: 'Revive',
                title: 'Restore archived product',
                onClick: () => restoreM.mutate(p.id),
                className: 'px-3 py-2 rounded-lg bg-sky-600 text-white',
            };
        }

        // 5) Default destructive (e.g., REJECTED etc.)
        return ordered
            ? {
                kind: 'archive',
                label: 'Archive',
                title: 'Archive (soft delete)',
                onClick: () => deleteM.mutate(p.id),
                className: 'px-2 py-1 rounded bg-rose-600 text-white',
            }
            : {
                kind: 'delete',
                label: 'Delete',
                title: 'Delete permanently',
                onClick: () => deleteM.mutate(p.id),
                className: 'px-2 py-1 rounded bg-rose-600 text-white',
            };
    }

    const statusRank: Record<EffectiveStatus, number> = {
        LIVE: 0,
        PUBLISHED: 1,
        PENDING: 2,
        REJECTED: 3,
        ARCHIVED: 4,  // 👈 show archived last
    };
    const updateStatusM = useMutation({
        mutationFn: async ({ id, status }: { id: string; status: 'PUBLISHED' | 'PENDING' | 'REJECTED'  | 'LIVE'}) =>
            (await api.post(`/api/admin/products/${id}/status`, { status }, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
        },
        onError: (e) => openModal({ title: 'Products', message: getHttpErrorMessage(e, 'Status update failed') }),
    });

    /* ---------- lookups ---------- */
    const catsQ = useQuery<AdminCategory[]>({
        queryKey: ['admin', 'products', 'cats'],
        enabled: !!token,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = ['/api/admin/categories', '/api/categories', '/api/catalog/categories'];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch { }
            }
            return [];
        },
        staleTime: staleTImeInSecs,
        refetchOnWindowFocus: false,
    });

    const brandsQ = useQuery<AdminBrand[]>({
        queryKey: ['admin', 'products', 'brands'],
        enabled: !!token,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = ['/api/admin/brands', '/api/brands'];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch { }
            }
            return [];
        },
        staleTime: staleTImeInSecs,
        refetchOnWindowFocus: false,
    });

    const suppliersQ = useQuery<AdminSupplier[]>({
        queryKey: ['admin', 'products', 'suppliers'],
        enabled: !!token,
        refetchOnWindowFocus: false,
        staleTime: staleTImeInSecs,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = ['/api/admin/suppliers', '/api/suppliers'];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch { }
            }
            return [];
        },
    });

    const attrsQ = useQuery<AdminAttribute[]>({
        queryKey: ['admin', 'products', 'attributes'],
        enabled: !!token,
        queryFn: async () => {
            const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = ['/api/admin/attributes', '/api/attributes'];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch { }
            }
            return [];
        },
        staleTime: staleTImeInSecs,
        refetchOnWindowFocus: false,
    });

    /* ---------- mutations ---------- */
    const createM = useMutation({
        mutationFn: async (payload: any) =>
            (await api.post('/api/admin/products', payload, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
        },
        onError: (e) => openModal({ title: 'Products', message: getHttpErrorMessage(e, 'Create failed') }),
    });

    const updateM = useMutation({
        mutationFn: async ({ id, ...payload }: any) =>
            (await api.patch(`/api/admin/products/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
        },
        onError: (e) => openModal({ title: 'Products', message: getHttpErrorMessage(e, 'Update failed') }),
    });



    async function saveVariantsFallback(productId: string, variants: any[]) {
        if (!variants?.length) return true;
        const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

        const bodies = [{ variants }, { data: { variants } }, { productId, variants }, variants];
        const urls = [
            `/api/admin/products/${productId}/variants/bulk?admin=1`,
            `/api/admin/products/${productId}/variants?admin=1`,
            `/api/admin/products/${productId}/variants`,
            `/api/admin/products/${productId}/variants/bulk`,
            `/api/admin/products/${productId}?include=variants,attributes,brand`,
            `/api/admin/products/${productId}?admin=1&include=variants,attributes,brand`,
        ];

        let lastErr: any;
        for (const b of bodies) {
            for (const u of urls) {
                try {
                    await api.post(u, b, { headers: hdr });
                    return true;
                } catch (e) { lastErr = e; }
            }
        }
        console.warn('All variant endpoints failed:', lastErr?.response?.status, lastErr?.response?.data || lastErr?.message);
        return false;
    }
    const UPLOAD_ENDPOINT = '/api/uploads';

    // right after: const rows = listQ.data ?? [];

    const hasOrdersQ = useQuery<Record<string, boolean>>({
        queryKey: ['admin', 'products', 'has-orders', { ids: (rows ?? []).map(r => r.id) }],
        enabled: !!token && rows.length > 0,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const ids = rows.map(r => r.id);

            // Hit `/api/admin/products/:id/has-orders` for each product, in parallel
            const results = await Promise.all(
                ids.map(async (id) => {
                    try {
                        const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, { headers: hdr });
                        // Accept a few possible shapes: {has:true}, {data:{has:true}}, or boolean directly
                        const has =
                            typeof data === 'boolean'
                                ? data
                                : typeof data?.has === 'boolean'
                                    ? data.has
                                    : typeof data?.data?.has === 'boolean'
                                        ? data.data.has
                                        : false;
                        return [id, has] as const;
                    } catch {
                        // On error, default to false so UI still renders
                        return [id, false] as const;
                    }
                })
            );

            return Object.fromEntries(results);
        },
    });

    // tiny helper for JSX
    const hasOrder = (productId: string) => !!hasOrdersQ.data?.[productId];




    const deleteM = useMutation({
        mutationFn: async (id: string) => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

            // prefer the batched result
            let has = hasOrder(id);

            // if unknown (e.g., first render) do a lightweight per-id check
            if (hasOrdersQ.isLoading || hasOrdersQ.data == null) {
                try {
                    const { data } = await api.get(`/api/admin/products/${id}/has-orders`, { headers: hdr });
                    has = !!(data?.data?.has ?? data?.has ?? data);
                } catch {
                    has = false;
                }
            }

            const url = has
                ? `/api/admin/products/${id}/soft-delete` // soft delete/archive
                : `/api/admin/products/${id}`;            // hard delete

            const res = await api.delete(url, { headers: hdr });
            return res.data.data ?? res;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] }),
    });


    /* ---------- creation form state ---------- */
    const [pending, setPending] = useState({
        title: '',
        price: '',
        status: 'PENDING',
        categoryId: '',
        brandId: '',
        supplierId: '',
        sku: '',
        // inStock removed — derived from offers
        imageUrls: '',
        communicationCost: '',  // per-order ops cost (₦)
    });

    const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
    const [files, setFiles] = useState<File[]>([]);

    function parseUrlList(s: string) { return s.split(/[\n,]/g).map(t => t.trim()).filter(Boolean); }
    function isUrlish(s?: string) { return !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s); }
    function toArray(x: any): any[] { return Array.isArray(x) ? x : x == null ? [] : [x]; }
    function extractImageUrls(p: any): string[] {
        if (Array.isArray(p?.imagesJson)) return p.imagesJson.filter(isUrlish);
        if (typeof p?.imagesJson === 'string') {
            try { const arr = JSON.parse(p.imagesJson); if (Array.isArray(arr)) return arr.filter(isUrlish); } catch { }
            return p.imagesJson.split(/[\n,]/g).map((t: string) => t.trim()).filter(isUrlish);
        }
        const cands = [
            ...(toArray(p?.imageUrls) as string[]),
            ...(toArray(p?.images) as string[]),
            p?.image, p?.primaryImage, p?.coverUrl,
        ].filter(Boolean);
        return cands.filter(isUrlish);
    }

    async function uploadLocalFiles(): Promise<string[]> {
        if (!files.length) return [];
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        try {
            setUploading(true);
            const res = await api.post(UPLOAD_ENDPOINT, fd, {
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    'Content-Type': 'multipart/form-data',
                },
            });
            const urls: string[] = (res as any)?.data?.urls || (Array.isArray((res as any)?.data) ? (res as any).data : []);
            return Array.isArray(urls) ? urls : [];
        } finally {
            setUploading(false);
        }
    }

    // attribute helpers
    function setAttrSelect(attributeId: string, valueId: string) {
        setSelectedAttrs((prev) => ({ ...prev, [attributeId]: valueId }));
    }
    function setAttrMulti(attributeId: string, e: React.ChangeEvent<HTMLSelectElement>) {
        const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
        setSelectedAttrs((prev) => ({ ...prev, [attributeId]: opts }));
    }
    function setAttrText(attributeId: string, text: string) {
        setSelectedAttrs((prev) => ({ ...prev, [attributeId]: text }));
    }

    /* ---------- variant builder ---------- */
    const selectableAttrs = (attrsQ.data || []).filter((a) => a.type === 'SELECT' && a.isActive);
    const [variantAttrIds, setVariantAttrIds] = useState<string[]>([]);
    const [variantValueIds, setVariantValueIds] = useState<Record<string, string[]>>({});
    type VariantRow = { key: string; combo: Array<{ attributeId: string; valueId: string }>; skuSuffix: string; priceBump: string; };
    const [variantRows, setVariantRows] = useState<VariantRow[]>([]);

    function toggleVariantAttr(attrId: string) {
        setVariantAttrIds((prev) => {
            const has = prev.includes(attrId);
            let next = has ? prev.filter((id) => id !== attrId) : [...prev, attrId];
            if (next.length > 2) next = next.slice(-2);
            const keep = new Set(next);
            setVariantValueIds((curr) => {
                const copy: Record<string, string[]> = {};
                Object.entries(curr).forEach(([k, v]) => { if (keep.has(k)) copy[k] = v; });
                return copy;
            });
            return next;
        });
    }
    function setVariantValues(attrId: string, vals: string[]) {
        setVariantValueIds((prev) => ({ ...prev, [attrId]: vals }));
    }

    // Update variant row fields
    function updateVariantRow(key: string, patch: Partial<Pick<VariantRow, 'skuSuffix' | 'priceBump'>>) {
        setVariantRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
    }

    useEffect(() => {
        function cartesian<T>(arrays: T[][]): T[][] {
            if (arrays.length === 0) return [];
            return arrays.reduce<T[][]>((acc, curr) => {
                if (acc.length === 0) return curr.map((x) => [x]);
                const out: T[][] = [];
                for (const a of acc) for (const c of curr) out.push([...a, c]);
                return out;
            }, []);
        }

        const chosen = variantAttrIds
            .map((attrId) => {
                const a = selectableAttrs.find((x) => x.id === attrId);
                const values = (a?.values || []).filter((v: { id: string }) => (variantValueIds[attrId] || []).includes(v.id));
                return { attrId, values };
            })
            .filter((x) => x.values.length > 0);

        if (chosen.length === 0) {
            setVariantRows([]);
            return;
        }

        const valueSets: VariantChoice[][] = chosen.map((c) =>
            c.values.map((v: { id: string; name: string }) => ({
                attributeId: String(c.attrId),
                valueId: String(v.id),
                label: String(v.name),
            }))
        );

        const combos: VariantChoice[][] = cartesian<VariantChoice>(valueSets);

        setVariantRows((prevRows) =>
            combos.map((combo) => {
                const suffix = combo
                    .map((c) => {
                        const a = selectableAttrs.find((x: { id: string }) => x.id === c.attributeId);
                        const v = a?.values?.find((vv: { id: string }) => vv.id === c.valueId);
                        const code = (v?.code ?? v?.name ?? '') as string;
                        return code.toUpperCase().replace(/\s+/g, '');
                    })
                    .join('-');

                const key = combo.map((c) => `${c.attributeId}:${c.valueId}`).join('|');

                const prev = prevRows.find((r) => r.key === key);

                return {
                    key,
                    combo: combo.map(({ attributeId, valueId }) => ({ attributeId, valueId })),
                    skuSuffix: prev?.skuSuffix || suffix,
                    priceBump: prev?.priceBump || '',
                };
            })
        );
    }, [variantAttrIds, variantValueIds, attrsQ.data]);

    const defaultPending = {
        title: '',
        price: '',
        status: 'PENDING',
        categoryId: '',
        brandId: '',
        supplierId: '',
        sku: '',
        imageUrls: '',
        communicationCost: '',
    };

    const [editingId, setEditingId] = useState<string | null>(null);

    function populateCreateFormFromProduct(p: any) {
        setEditingId(p.id);
        setPending({
            title: p.title || '',
            price: String(p.price ?? ''),
            status: /^(LIVE)$/i.test(p.status) ? 'LIVE' : p.status === 'PUBLISHED' ? 'PUBLISHED' : 'PENDING',
            categoryId: p.categoryId || '',
            brandId: p.brandId || '',
            supplierId: p.supplierId || '',
            sku: p.sku || '',
            imageUrls: (extractImageUrls(p) || []).join('\n'),
            communicationCost: p.communicationCost != null ? String(p.communicationCost) : '',
        });
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    /** payload builder */
    function buildProductPayload({ base, selectedAttrs, variantRows, attrsAll }: {
        base: {
            title: string;
            price: number;
            status: string;
            sku?: string;
            categoryId?: string;
            brandId?: string;
            supplierId?: string;
            imagesJson?: string[];
            communicationCost?: number;
        };
        selectedAttrs: Record<string, string | string[]>;
        variantRows: Array<{ key: string; combo: Array<{ attributeId: string; valueId: string }>; skuSuffix: string; priceBump: string; }>;
        attrsAll: AdminAttribute[];
    }) {
        const payload: any = { ...base };

        // attributes
        const attributeSelections: any[] = [];
        const attributeValues: Array<{ attributeId: string; valueId?: string; valueIds?: string[] }> = [];
        const attributeTexts: Array<{ attributeId: string; value: string }> = [];

        for (const a of attrsAll) {
            const sel = selectedAttrs[a.id];
            if (sel == null || (Array.isArray(sel) && sel.length === 0) || (typeof sel === 'string' && sel.trim() === '')) continue;

            if (a.type === 'TEXT') {
                attributeSelections.push({ attributeId: a.id, text: String(sel) });
                attributeTexts.push({ attributeId: a.id, value: String(sel) });
            } else if (a.type === 'SELECT') {
                const valueId = String(sel);
                attributeSelections.push({ attributeId: a.id, valueId });
                attributeValues.push({ attributeId: a.id, valueId });
            } else if (a.type === 'MULTISELECT') {
                const valueIds = (sel as string[]).map(String);
                attributeSelections.push({ attributeId: a.id, valueIds });
                attributeValues.push({ attributeId: a.id, valueIds });
            }
        }

        if (attributeSelections.length) payload.attributeSelections = attributeSelections;
        if (attributeValues.length) payload.attributeValues = attributeValues;
        if (attributeTexts.length) payload.attributeTexts = attributeTexts;

        // variants
        if (variantRows.length > 0) {
            const basePrice = Number(base.price) || 0;
            payload.variants = variantRows.map((r) => {
                const bump = Number(r.priceBump) || 0;
                const sku = [base.sku?.trim(), r.skuSuffix].filter(Boolean).join('-');
                const price = bump ? Math.max(0, basePrice + bump) : undefined;

                const options = r.combo.map((c) => ({
                    attributeId: c.attributeId,
                    valueId: c.valueId,
                    attributeValueId: c.valueId,
                }));

                return {
                    sku,
                    ...(price != null ? { price } : {}),
                    options,
                    optionSelections: options,
                    attributes: options.map(o => ({ attributeId: o.attributeId, valueId: o.valueId })),
                };
            });

            payload.variantOptions = payload.variants.map((v: any) => v.options);
        }

        if (!pending.supplierId) {
            openModal({ title: 'Products', message: 'Supplier is required.' });
            return;
        }

        return payload;
    }

    async function fetchProductFull(id: string) {
        const { data } = await api.get(`/api/admin/products/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { include: 'variants,attributes,brand' },
        });
        const prod = data?.data ?? data;
        return {
            ...prod,
            imagesJson: Array.isArray(prod?.imagesJson) ? prod.imagesJson : [],
            variants: Array.isArray(prod?.variants) ? prod.variants : [],
            attributeValues: Array.isArray(prod?.attributeValues) ? prod.attributeValues : [],
            attributeTexts: Array.isArray(prod?.attributeTexts) ? prod.attributeTexts : [],
        };
    }

    function toSkuSuffix(baseSku?: string, variantSku?: string) {
        if (!variantSku) return '';
        if (!baseSku) return variantSku;
        const prefix = `${baseSku}-`.toUpperCase();
        return variantSku.toUpperCase().startsWith(prefix) ? variantSku.slice(prefix.length) : variantSku;
    }

    async function startEdit(p: any) {
        try {
            const full = await fetchProductFull(p.id);
            populateCreateFormFromProduct(full);

            const nextSel: Record<string, string | string[]> = {};
            (full.attributeValues || full.attributeSelections || []).forEach((av: any) => {
                if (Array.isArray(av.valueIds)) nextSel[av.attributeId] = av.valueIds;
                else if (av.valueId) nextSel[av.attributeId] = av.valueId;
            });
            (full.attributeTexts || []).forEach((at: any) => { nextSel[at.attributeId] = at.value; });
            setSelectedAttrs(nextSel);

            const allOpts = new Map<string, Set<string>>();
            (full.variants || []).forEach((v: any) => {
                (v.options || v.optionSelections || []).forEach((o: any) => {
                    const aId = o.attributeId || o.attribute?.id;
                    const vId = o.valueId || o.attributeValueId || o.value?.id;
                    if (!aId || !vId) return;
                    if (!allOpts.has(aId)) allOpts.set(aId, new Set());
                    allOpts.get(aId)!.add(String(vId));
                });
            });
            const axisIds = Array.from(allOpts.keys()).slice(0, 2);
            setVariantAttrIds(axisIds);
            const valueMap: Record<string, string[]> = {};
            axisIds.forEach((aid) => (valueMap[aid] = Array.from(allOpts.get(aid) || [])));
            setVariantValueIds(valueMap);

            const base = Number(full.price) || 0;
            const rowsFromExisting = (full.variants || []).map((v: any) => {
                const combo = (v.options || v.optionSelections || []).map((o: any) => ({
                    attributeId: o.attributeId || o.attribute?.id,
                    valueId: o.valueId || o.attributeValueId || o.value?.id,
                })).filter((x: any) => x.attributeId && x.valueId);
                const key = combo.map((c: any) => `${c.attributeId}:${c.valueId}`).join('|');
                return {
                    key,
                    combo,
                    skuSuffix: toSkuSuffix(full.sku, v.sku),
                    priceBump: v.price != null ? String((Number(v.price) || 0) - base) : '',
                };
            });
            setVariantRows(rowsFromExisting);
            setEditingId(full.id);
        } catch {
            openModal({ title: 'Products', message: 'Could not load product for editing.' });
        }
    }

    // --- Auth → ownerEmail (and optional ownerId)
    function base64UrlDecode(str: string) {
        const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : '';
        const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
        const bin = atob(b64);
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        const dec = new TextDecoder('utf-8');
        return dec.decode(bytes);
    }
    function parseJwtClaims(jwt?: string | null): Record<string, any> | undefined {
        if (!jwt) return;
        try {
            const parts = jwt.split('.');
            if (parts.length < 2) return;
            const json = base64UrlDecode(parts[1]);
            return JSON.parse(json);
        } catch { return; }
    }

    const claims = React.useMemo(() => parseJwtClaims(token), [token]);

    const meQ = useQuery<{ id?: string; email?: string }>({
        queryKey: ['auth', 'me'],
        enabled: !!token,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            try {
                const { data } = await api.get('/api/auth/me', {
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

    // 🔎 FILTER: build from rows + preset + offers
    const filteredRows = React.useMemo(() => {
        const offers = offersSummaryQ.data || {};
        function hasAnyOffer(pId: string) {
            const s = offers[pId];
            return !!s && (s.activeOffers > 0 || s.perSupplier?.length > 0);
        }
        function hasActiveOffer(pId: string) {
            const s = offers[pId];
            return !!s && s.activeOffers > 0 && (s.totalAvailable ?? 0) > 0;
        }
        function isAvailableVariantAware(pId: string, p: any) {
            const s = offers[pId];
            if (s?.inStock) return true;
            return p.inStock === true; // fallback
        }
        function hasVariants(p: any) {
            return Array.isArray(p.variants) ? p.variants.length > 0 : (p.variantCount ?? 0) > 0;
        }
        function baseInStock(p: any) {
            return p.inStock === true;
        }

        return rows.filter((p) => {
            switch (preset) {
                case 'no-offer': return !hasAnyOffer(p.id);
                case 'live': return p.status === 'LIVE';
                case 'published-with-offer': return p.status === 'PUBLISHED' && hasAnyOffer(p.id);
                case 'published-no-offer': return p.status === 'PUBLISHED' && !hasAnyOffer(p.id);
                case 'published-with-active': return p.status === 'PUBLISHED' && hasActiveOffer(p.id);
                case 'published-base-in': return p.status === 'PUBLISHED' && baseInStock(p);
                case 'published-base-out': return p.status === 'PUBLISHED' && !baseInStock(p);
                case 'with-variants': return hasVariants(p);
                case 'simple': return !hasVariants(p);
                case 'published-with-availability': return p.status === 'PUBLISHED' && isAvailableVariantAware(p.id, p);
                case 'published': return p.status === 'PUBLISHED';
                case 'pending': return p.status === 'PENDING';
                case 'rejected': return p.status === 'REJECTED';
                case 'all':
                default: return true;
            }
        });
    }, [rows, preset, offersSummaryQ.data]);

    // 🔁 SORT: always sort the FILTERED rows (not the raw ones)
    const displayRows = React.useMemo(() => {
        const arr = [...filteredRows];

        const cmpNum = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
        const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

        arr.sort((a, b) => {
            let res = 0;
            switch (sort.key) {
                case 'title': res = cmpStr(a?.title ?? '', b?.title ?? ''); break;
                case 'price': res = cmpNum(Number(a?.price) || 0, Number(b?.price) || 0); break;
                case 'avail': res = cmpNum(getAvail(a), getAvail(b)); break;
                case 'stock': res = cmpNum(getStock(a), getStock(b)); break; // 0 or 1
                case 'status': res = cmpNum(statusRank[getStatus(a)] ?? 99, statusRank[getStatus(b)] ?? 99); break;
                case 'owner': res = cmpStr(getOwner(a), getOwner(b)); break;
            }
            return sort.dir === 'asc' ? res : -res;
        });

        return arr;
    }, [filteredRows, sort, offersSummaryQ.data]);

    const userId = claims?.sub || claims?.id || meQ.data?.id;
    /* ---------- submit create/update ---------- */
    const saveOrCreate = async () => {
        const base: any = {
            title: pending.title.trim(),
            price: Number(pending.price) || 0,
            status: pending.status,
            sku: pending.sku.trim() || undefined
        };
        if (userId) base.ownerId = userId;
        if (!base.title) return;

        const comm = Number(pending.communicationCost);
        if (Number.isFinite(comm) && comm >= 0) base.communicationCost = comm;

        if (pending.categoryId) base.categoryId = pending.categoryId;
        if (pending.brandId) base.brandId = pending.brandId;
        if (pending.supplierId) base.supplierId = pending.supplierId;

        const urlList = parseUrlList(pending.imageUrls);
        const uploaded = await uploadLocalFiles();
        const imagesJson = [...urlList, ...uploaded].filter(Boolean);
        if (imagesJson.length) base.imagesJson = imagesJson;

        const resetForm = () => {
            setEditingId(null);
            setPending(defaultPending);
            setSelectedAttrs({});
            setFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
            setVariantAttrIds([]);
            setVariantValueIds({});
            setVariantRows([]);
        };

        const payload = buildProductPayload({
            base, selectedAttrs, variantRows, attrsAll: attrsQ.data || [],
        });

        if (editingId) {
            updateM.mutate(
                { id: editingId, ...payload },
                {
                    onSuccess: async (res) => {
                        const productId = editingId;
                        if ((payload as any)?.variants?.length) {
                            const variantsPersisted = Array.isArray((res as any)?.variants) && (res as any).variants.length > 0;
                            if (!variantsPersisted) await saveVariantsFallback(productId, (payload as any).variants);
                        }
                        qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
                        qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
                        resetForm();
                    },
                    onError: (e) => openModal({ title: 'Products', message: getHttpErrorMessage(e, 'Update failed') }),
                }
            );
        } else {
            createM.mutate(payload, {
                onSuccess: async (res) => {
                    const created = (res?.data ?? res) as any;
                    const productId = created?.id || created?.product?.id || created?.data?.id;
                    if (productId && (payload as any)?.variants?.length) {
                        const variantsPersisted = Array.isArray(created?.variants) && created.variants.length > 0;
                        if (!variantsPersisted) await saveVariantsFallback(productId, (payload as any).variants);
                    }
                    qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
                    qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
                    resetForm();
                },
                onError: (e) => openModal({ title: 'Products', message: getHttpErrorMessage(e, 'Create failed') }),
            });
        }
    };

    /* ---------- inline editor ---------- */
    type EditPending = {
        id: string;
        title: string;
        price: string;
        categoryId: string;
        brandId: string;
        supplierId?: string;
        inStock?: boolean;
        sku?: string;
        status?: string;
        communicationCost?: string;
    };
    const [openEditorId, setOpenEditorId] = useState<string | null>(null);
    const [editPendings, setEditPendings] = useState<Record<string, EditPending>>({});
    const [editImages, setEditImages] = useState<Record<string, string[]>>({});

    function changeEdit(pId: string, patch: Partial<EditPending>) {
        setEditPendings((prev) => ({ ...prev, [pId]: { ...(prev[pId] || { id: pId } as any), ...patch } as EditPending }));
    }

    function cancelEdit() {
        setOpenEditorId(null);
    }

    // ---- Image URL helpers (edit/remove/reorder) for create form
    function urlList(): string[] { return parseUrlList(pending.imageUrls); }
    function setUrlAt(i: number, newUrl: string) {
        const list = urlList();
        list[i] = newUrl.trim();
        setPending(d => ({ ...d, imageUrls: list.filter(Boolean).join('\n') }));
    }
    function removeUrlAt(i: number) {
        const list = urlList();
        list.splice(i, 1);
        setPending(d => ({ ...d, imageUrls: list.join('\n') }));
    }
    function moveUrl(i: number, dir: -1 | 1) {
        const list = urlList();
        const j = i + dir;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        setPending(d => ({ ...d, imageUrls: list.join('\n') }));
    }

    // ---- Local file helpers (replace/remove/reorder)
    function removeFileAt(i: number) {
        setFiles(prev => prev.filter((_, idx) => idx !== i));
    }
    function replaceFileAt(i: number, f: File) {
        setFiles(prev => {
            const copy = [...prev];
            copy[i] = f;
            return copy;
        });
    }
    function moveFile(i: number, dir: -1 | 1) {
        setFiles(prev => {
            const j = i + dir;
            if (j < 0 || j >= prev.length) return prev;
            const copy = [...prev];
            [copy[i], copy[j]] = [copy[j], copy[i]];
            return copy;
        });
    }

    // ---- Primary action resolver (exactly one button) --------------------------

    const restoreM = useMutation({
        mutationFn: async (id: string) => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            // adjust to your actual restore endpoint
            const res = await api.post(`/api/admin/products/${encodeURIComponent(id)}/restore`, {}, { headers: hdr });
            return res.data ?? res;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] }),
        onError: (e) => openModal({ title: 'Products', message: getHttpErrorMessage(e, 'Restore failed') }),
    });





    function submitEdit(
        pId: string,
        intent: 'save' | 'submitForReview' | 'approvePublished' | 'movePending'
    ) {
        // Fallback to product row if no draft exists yet
        const draft = editPendings[pId];

        const source = draft ?? (displayRows.find((r: any) => r.id === pId) ?? rows.find((r: any) => r.id === pId));
        if (!source) return;

        if (intent === 'approvePublished') {
            const avail = offersSummaryQ.data?.[pId]?.inStock ?? (source.inStock !== false);
            if (!avail) {
                openModal({
                    title: 'Cannot publish',
                    message: 'This product is not in stock. Please add stock or active supplier offers first.',
                });
                return;
            }
        }

        // Build the base payload from the draft OR the row
        const base: any = {
            title: (source.title ?? '').trim(),
            price: Number(source.price) || 0,
            categoryId: (source.categoryId ?? null),
            brandId: (source.brandId ?? null),
            supplierId: (source.supplierId ?? null),
            sku: (source.sku ?? '').trim() || undefined,
        };

        // Overlay draft fields if a draft exists (they take precedence)
        if (draft) {
            base.title = (draft.title ?? base.title).trim();
            base.price = Number(draft.price ?? base.price) || 0;
            base.categoryId = draft.categoryId ?? base.categoryId;
            base.brandId = draft.brandId ?? base.brandId;
            base.supplierId = draft.supplierId ?? base.supplierId;
            base.sku = (draft.sku ?? base.sku) || undefined;

            const comm = Number(draft.communicationCost);
            if (Number.isFinite(comm) && comm >= 0) base.communicationCost = comm;

            if (editImages[pId]) base.imagesJson = editImages[pId];
        }

        // Intent → status
        if (intent === 'submitForReview') base.status = 'PENDING';
        else if (intent === 'approvePublished') base.status = 'PUBLISHED';
        else if (intent === 'movePending') base.status = 'PENDING';
        else if (isSuper && draft?.status) base.status = draft.status;

        updateM.mutate({ id: pId, ...base }, { onSuccess: () => setOpenEditorId(null) });
    }


    /* ---------- focus/edit via form ---------- */
    useEffect(() => {
        if (!focusId || !rows?.length) return;
        const target = rows.find((r: any) => r.id === focusId);
        if (!target) return;
        populateCreateFormFromProduct(target);
        onFocusedConsumed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusId, rows]);

    const filePreviews = React.useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
    const urlPreviews = React.useMemo(() => parseUrlList(pending.imageUrls), [pending.imageUrls]);

    const variantsQ = useQuery({
        queryKey: ['admin', 'product', editingId, 'variants'],
        enabled: !!token && !!editingId,
        queryFn: async () => {
            const { data } = await api.get<{ data: any[] }>(`/api/admin/products/${editingId}/variants`,
                { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
            );
            return data?.data ?? [];
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });

    return (
        <div className="space-y-3">
            {editingId && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                    Editing: <span className="font-semibold">{(pending.title || '').trim() || 'Untitled product'}</span>
                    <span className="ml-2 text-xs text-amber-700/80">(ID: <span className="font-mono">{editingId}</span>)</span>
                </div>
            )}

            {/* Supplier offers (panel shown when editing) */}
            {editingId && (
                <div className="rounded-2xl border bg-white shadow-sm mt-3">
                    <div className="px-4 md:px-5 py-3 border-b">
                        <h3 className="text-ink font-semibold">Supplier offers</h3>
                        <p className="text-xs text-ink-soft">
                            Manage price, <strong>availableQty</strong>, variant links, activity and lead time.
                        </p>
                    </div>
                    <SuppliersOfferManager
                        productId={editingId}
                        variants={(variantsQ.data ?? []).map((v: any) => ({ id: v.id, sku: v.sku }))}
                        suppliers={suppliersQ.data ?? []}         // 👈 add this line
                        token={token}
                        readOnly={!(isSuper || isAdmin)}
                    />

                </div>
            )}

            {/* quick add / product form */}
            <div id="create-form" className="grid gap-2">
                {/* Basic fields */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input className="border rounded-lg px-3 py-2" placeholder="Title" value={pending.title} onChange={(e) => setPending((d) => ({ ...d, title: e.target.value }))} />
                    <input className="border rounded-lg px-3 py-2" placeholder="Price" inputMode="decimal" value={pending.price} onChange={(e) => setPending((d) => ({ ...d, price: e.target.value }))} />
                    <input className="border rounded-lg px-3 py-2" placeholder="Base SKU" value={pending.sku} onChange={(e) => setPending((d) => ({ ...d, sku: e.target.value }))} />
                    <select className="border rounded-lg px-3 py-2" value={pending.status} onChange={(e) => setPending((d) => ({ ...d, status: e.target.value }))}>
                        <option value="PUBLISHED">PUBLISHED</option>
                        <option value="PENDING">PENDING</option>
                    </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <select className="border rounded-lg px-3 py-2" value={pending.categoryId} onChange={(e) => setPending((d) => ({ ...d, categoryId: e.target.value }))}>
                        <option value="">{catsQ.isLoading ? 'Loading…' : '— Category —'}</option>
                        {catsQ.data?.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>

                    <select className="border rounded-lg px-3 py-2" value={pending.brandId} onChange={(e) => setPending((d) => ({ ...d, brandId: e.target.value }))}>
                        <option value="">— Brand —</option>
                        {brandsQ.data?.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                    </select>

                    <select className="border rounded-lg px-3 py-2" value={pending.supplierId} onChange={(e) => setPending((d) => ({ ...d, supplierId: e.target.value }))}>
                        <option value="">— Supplier —</option>
                        {suppliersQ.data?.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                    </select>
                </div>

                {/* 🔶 Attributes */}
                <div className="rounded-2xl border bg-white p-4 md:p-5">
                    <h3 className="font-semibold">Attributes</h3>
                    <p className="text-xs text-zinc-600 mb-2">Fill text attributes, pick single- or multi-select values.</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(attrsQ.data || []).map((a: any) => (
                            <div key={a.id} className="space-y-1">
                                <label className="text-xs font-medium text-zinc-700">{a.name}</label>

                                {a.type === 'TEXT' && (
                                    <input
                                        className="border rounded-lg px-3 py-2 w-full"
                                        value={(selectedAttrs[a.id] as string) ?? ''}
                                        onChange={(e) => setAttrText(a.id, e.target.value)}
                                        placeholder={`Enter ${a.name}`}
                                    />
                                )}

                                {a.type === 'SELECT' && (
                                    <select
                                        className="border rounded-lg px-3 py-2 w-full"
                                        value={(selectedAttrs[a.id] as string) ?? ''}
                                        onChange={(e) => setAttrSelect(a.id, e.target.value)}
                                    >
                                        <option value="">— Select —</option>
                                        {(a.values || []).map((v: any) => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                    </select>
                                )}

                                {a.type === 'MULTISELECT' && (
                                    <select
                                        multiple
                                        className="border rounded-lg px-3 py-2 w-full h-28"
                                        value={((selectedAttrs[a.id] as string[]) ?? []) as any}
                                        onChange={(e) => setAttrMulti(a.id, e)}
                                    >
                                        {(a.values || []).map((v: any) => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 🔷 Product Images (single source of truth) */}
                <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-4 md:p-5 shadow-[0_6px_30px_rgba(0,0,0,0.06)]">
                    <h3 className="text-ink font-semibold">Images</h3>
                    <p className="text-xs text-ink-soft mb-3">
                        Paste image URLs (one per line) or upload local files. These save to <code>imagesJson</code> on the product.
                    </p>

                    <label className="block text-xs text-ink-soft mb-1">Image URLs (one per line)</label>
                    <textarea
                        className="w-full border rounded-lg px-3 py-2 mb-3"
                        rows={3}
                        placeholder="https://.../image1.jpg&#10;https://.../image2.png"
                        value={pending.imageUrls}
                        onChange={(e) => setPending(d => ({ ...d, imageUrls: e.target.value }))}
                    />

                    <div className="flex items-center gap-3">
                        <input
                            ref={fileInputRef}
                            id="product-file-input"
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(e) => setFiles(Array.from(e.target.files || []))}
                            className="sr-only"
                        />
                        <label
                            htmlFor="product-file-input"
                            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 font-semibold text-white
                bg-gradient-to-r from-blue-600 to-fuchsia-600 shadow-sm hover:shadow-md
                active:scale-[0.99] cursor-pointer focus:outline-none focus:ring-4 focus:ring-blue-200"
                            title="Choose image files"
                        >
                            Choose Files
                        </label>

                        {!!files.length && (
                            <span className="text-xs text-ink-soft">
                                {files.length} file{files.length === 1 ? '' : 's'} selected
                            </span>
                        )}

                        <button
                            type="button"
                            onClick={async () => { await uploadLocalFiles(); }}
                            className="ml-auto inline-flex items-center rounded-xl border px-3 py-2 text-ink
                hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50"
                            disabled={uploading || files.length === 0}
                            title={uploading ? 'Uploading…' : 'Upload selected files now'}
                        >
                            {uploading ? 'Uploading…' : 'Upload Selected'}
                        </button>
                    </div>

                    {(files.length > 0 || urlPreviews.length > 0) && (
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* URL previews */}
                            {urlPreviews.length > 0 && (
                                <div className="rounded-lg border bg-white">
                                    <div className="px-3 py-2 border-b font-medium">Pasted URLs</div>
                                    <div className="p-3 space-y-3">
                                        {urlPreviews.map((u, i) => (
                                            <div key={`u:${u}:${i}`} className="flex items-start gap-3">
                                                <div className="w-24 h-16 rounded border overflow-hidden bg-zinc-50 shrink-0">
                                                    <img src={u} alt="Image preview" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.opacity = '0.2')} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <input
                                                        className="w-full border rounded-lg px-2 py-1 text-xs"
                                                        value={u}
                                                        onChange={(e) => setUrlAt(i, e.target.value)}
                                                        placeholder="https://..."
                                                    />
                                                    <div className="mt-1 flex gap-2">
                                                        <button className="px-2 py-1 text-xs rounded border" onClick={() => moveUrl(i, -1)} disabled={i === 0} title="Move up">↑</button>
                                                        <button className="px-2 py-1 text-xs rounded border" onClick={() => moveUrl(i, +1)} disabled={i === urlPreviews.length - 1} title="Move down">↓</button>
                                                        <button className="ml-auto px-2 py-1 text-xs rounded bg-rose-600 text-white" onClick={() => removeUrlAt(i)} title="Remove URL">Remove</button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Local file previews */}
                            {filePreviews.length > 0 && (
                                <div className="rounded-lg border bg-white">
                                    <div className="px-3 py-2 border-b font-medium">Selected Files (not uploaded yet)</div>
                                    <div className="p-3 space-y-3">
                                        {filePreviews.map(({ f, url }, i) => (
                                            <div key={`f:${url}:${i}`} className="flex items-start gap-3">
                                                <div className="w-24 h-16 rounded border overflow-hidden bg-zinc-50 shrink-0">
                                                    <img src={url} alt="File preview" className="w-full h-full object-cover" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-medium truncate">{f.name}</div>
                                                    <div className="text-[11px] text-zinc-500">
                                                        {(f.size / 1024).toFixed(0)} KB • {f.type || 'image/*'}
                                                    </div>
                                                    <div className="mt-2 flex gap-2">
                                                        <label className="px-2 py-1 text-xs rounded border cursor-pointer hover:bg-black/5">
                                                            Replace
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                className="hidden"
                                                                onChange={(e) => {
                                                                    const nf = e.target.files?.[0];
                                                                    if (nf) replaceFileAt(i, nf);
                                                                    e.currentTarget.value = '';
                                                                }}
                                                            />
                                                        </label>
                                                        <button className="px-2 py-1 text-xs rounded border" onClick={() => moveFile(i, -1)} disabled={i === 0} title="Move up">↑</button>
                                                        <button className="px-2 py-1 text-xs rounded border" onClick={() => moveFile(i, +1)} disabled={i === filePreviews.length - 1} title="Move down">↓</button>
                                                        <button className="ml-auto px-2 py-1 text-xs rounded bg-rose-600 text-white" onClick={() => removeFileAt(i)} title="Remove file">Remove</button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        <div className="pt-2 border-t flex items-center justify-end">
                                            <button className="px-3 py-1.5 text-xs rounded border" onClick={() => setFiles([])} title="Clear all selected files">
                                                Clear All Files
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <p className="mt-2 text-[11px] text-ink-soft">
                        Files will be uploaded when you click <strong>{editingId ? 'Save Changes' : 'Add Product'}</strong>.
                    </p>
                </div>

                {/* Attributes Manager */}
                <div className="rounded-2xl border bg-white p-4 md:p-5">
                    <h3 className="text-ink font-semibold">Attributes</h3>
                    <p className="text-xs text-ink-soft mb-3">Set values that describe the product. SELECT/MULTISELECT values can also be used as variant axes.</p>

                    {attrsQ.isLoading && <div className="text-sm text-zinc-500">Loading attributes…</div>}
                    {!attrsQ.isLoading && (attrsQ.data || []).length === 0 && (
                        <div className="text-sm text-zinc-500">No attributes available.</div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(attrsQ.data || []).map((a) => (
                            <div key={a.id} className="space-y-1">
                                <label className="text-xs font-medium text-ink">{a.name}</label>
                                {a.type === 'TEXT' && (
                                    <input
                                        className="border rounded-lg px-3 py-2 w-full"
                                        value={(selectedAttrs[a.id] as string) || ''}
                                        onChange={(e) => setAttrText(a.id, e.target.value)}
                                        placeholder={a.placeholder || ''}
                                    />
                                )}
                                {a.type === 'SELECT' && (
                                    <select
                                        className="border rounded-lg px-3 py-2 w-full"
                                        value={(selectedAttrs[a.id] as string) || ''}
                                        onChange={(e) => setAttrSelect(a.id, e.target.value)}
                                    >
                                        <option value="">— Select —</option>
                                        {(a.values || []).map((v: any) => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                    </select>
                                )}

                                {a.type === 'MULTISELECT' && (
                                    <select
                                        multiple
                                        className="border rounded-lg px-3 py-2 w-full h-28"
                                        value={(selectedAttrs[a.id] as string[]) || []}
                                        onChange={(e) => setAttrMulti(a.id, e)}
                                    >
                                        {(a.values || []).map((v: any) => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 🔷 Variants */}
                <div className="rounded-2xl border bg-white p-4 md:p-5">
                    <h3 className="font-semibold">Variants</h3>
                    <p className="text-xs text-zinc-600 mb-2">
                        Choose up to two SELECT attributes as variant axes, pick values, then edit SKU suffix / price bumps.
                    </p>

                    {/* Axis selector */}
                    <div className="flex flex-wrap gap-2 mb-3">
                        {selectableAttrs.map((a: any) => {
                            const checked = variantAttrIds.includes(a.id);
                            return (
                                <label key={a.id} className="inline-flex items-center gap-2 border rounded-lg px-3 py-1.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleVariantAttr(a.id)}
                                        disabled={!checked && variantAttrIds.length >= 2}
                                    />
                                    <span>{a.name}</span>
                                </label>
                            );
                        })}
                    </div>

                    {/* Values per selected axis */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {variantAttrIds.map((aid) => {
                            const a = selectableAttrs.find((x: any) => x.id === aid);
                            return (
                                <div key={aid}>
                                    <div className="text-xs font-medium text-zinc-700 mb-1">{a?.name} values</div>
                                    <select
                                        multiple
                                        className="border rounded-lg px-3 py-2 w-full h-28"
                                        value={((variantValueIds[aid] as string[]) ?? []) as any}
                                        onChange={(e) =>
                                            setVariantValues(
                                                aid,
                                                Array.from(e.target.selectedOptions).map((o) => o.value)
                                            )
                                        }
                                    >
                                        {(a?.values || []).map((v: any) => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                    </select>
                                </div>
                            );
                        })}
                    </div>

                    {/* Generated variant rows */}
                    {variantRows.length > 0 && (
                        <div className="mt-4 overflow-auto rounded border">
                            <table className="w-full text-sm">
                                <thead className="bg-zinc-50">
                                    <tr>
                                        <th className="text-left px-3 py-2">Combination</th>
                                        <th className="text-left px-3 py-2">SKU Suffix</th>
                                        <th className="text-left px-3 py-2">Price Bump</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {variantRows.map((r) => (
                                        <tr key={r.key}>
                                            <td className="px-3 py-2">
                                                {r.combo.map((c) => {
                                                    const a = selectableAttrs.find((x: any) => x.id === c.attributeId);
                                                    const v = a?.values?.find((vv: any) => vv.id === c.valueId);
                                                    return `${a?.name}: ${v?.name}`;
                                                }).join(' • ')}
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    className="border rounded px-2 py-1 w-40"
                                                    value={r.skuSuffix}
                                                    onChange={(e) =>
                                                        setVariantRows((rows) =>
                                                            rows.map((rr) => rr.key === r.key ? { ...rr, skuSuffix: e.target.value } : rr
                                                            )
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    className="border rounded px-2 py-1 w-32"
                                                    inputMode="decimal"
                                                    value={r.priceBump}
                                                    onChange={(e) =>
                                                        setVariantRows((rows) =>
                                                            rows.map((rr) => rr.key === r.key ? { ...rr, priceBump: e.target.value } : rr
                                                            )
                                                        )
                                                    }
                                                    placeholder="+0"
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* actions */}
            <div className="flex gap-2 items-center">
                <button
                    onClick={saveOrCreate}
                    className="px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-60"
                    disabled={uploading}
                    title={uploading ? 'Uploading images…' : (editingId ? 'Save changes' : 'Create product')}
                >
                    {uploading ? 'Uploading…' : (editingId ? 'Save Changes' : 'Add Product')}
                </button>

                {editingId && (
                    <button
                        onClick={() => {
                            setEditingId(null);
                            setPending(defaultPending);
                            setSelectedAttrs({});
                            setFiles([]);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                            setVariantAttrIds([]);
                            setVariantValueIds({});
                            setVariantRows([]);
                        }}
                        className="px-3 py-2 rounded-xl border"
                        title="Cancel edit"
                    >
                        Cancel Edit
                    </button>
                )}

                <button onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'products'] })} className="px-3 py-2 rounded-xl bg-blue-500 text-white">
                    Reload Data
                </button>

                <button onClick={() => { setSearchInput(''); setSearch(''); }} className="px-3 py-2 rounded-xl bg-zinc-400 text-white">
                    Reset Search
                </button>
            </div>

            {/* search */}
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search title, sku…" className="pl-9 pr-3 py-2 rounded-xl border bg-white w-full" />
                </div>
            </div>

            {/* preset chips */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">Filters:</span>
                {[
                    ['all', 'All'],
                    ['live', 'Live'],
                    ['published', 'Published'],
                    ['pending', 'Pending'],
                    ['rejected', 'Rejected'],
                    ['published-with-active', 'Published w/ Active'],
                    ['published-with-offer', 'Published w/ Offer'],
                    ['published-no-offer', 'Published no Offer'],
                    ['no-offer', 'No Offer'],
                    ['with-variants', 'With variants'],
                    ['simple', 'Simple'],
                    ['published-base-in', 'Published base in'],
                    ['published-base-out', 'Published base out'],
                ].map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setPresetAndUrl(key as FilterPreset)}
                        className={`px-2.5 py-1.5 rounded-full border text-xs ${preset === key ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-zinc-50'
                            }`}
                    >
                        {label}
                    </button>
                ))}
                {preset !== 'all' && (
                    <button
                        onClick={() => setPresetAndUrl('all')}
                        className="ml-1 px-2 py-1.5 rounded-full text-xs border bg-white hover:bg-zinc-50"
                        title="Clear filters"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* list */}
            <div className="border rounded-xl overflow-auto">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50">
                        <tr>
                            <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('title')}>
                                Title <SortIndicator k="title" />
                            </th>
                            <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('price')}>
                                Price <SortIndicator k="price" />
                            </th>
                            <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('avail')}>
                                Avail. <SortIndicator k="avail" />
                            </th>
                            <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('stock')}>
                                Stock <SortIndicator k="stock" />
                            </th>
                            <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('status')}>
                                Status <SortIndicator k="status" />
                            </th>
                            {isSuper && (
                                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('owner')}>
                                    Owner <SortIndicator k="owner" />
                                </th>
                            )}
                            <th className="text-right px-3 py-2">Actions</th>
                        </tr>
                    </thead>

                    <tbody className="divide-y">
                        {listQ.isLoading && (
                            <tr><td className="px-3 py-3" colSpan={isSuper ? 7 : 6}>Loading products…</td></tr>
                        )}

                        {!listQ.isLoading && displayRows.map((p: any) => {
                            const open = openEditorId === p.id;
                            const d = editPendings[p.id] ?? {
                                id: p.id,
                                title: p.title ?? '',
                                price: String(p.price ?? ''),
                                categoryId: p.categoryId ?? '',
                                brandId: p.brandId ?? '',
                                supplierId: p.supplierId ?? '',
                                sku: p.sku ?? '',
                                status: p.status,
                                communicationCost: p.communicationCost != null ? String(p.communicationCost) : '',
                            } as EditPending;

                            const stockCell = (() => {
                                const s = offersSummaryQ.data?.[p.id];
                                if (!s) return <span className="text-zinc-400">—</span>;
                                return s.inStock ? (
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
                            })();

                            return (
                                <React.Fragment key={p.id}>
                                    <tr>
                                        <td className="px-3 py-2">{p.title}</td>
                                        <td className="px-3 py-2">{ngn.format(fmtN(p.price))}</td>
                                        <td className="px-3 py-2">
                                            {offersSummaryQ.isLoading ? (
                                                <span className="text-zinc-500 text-xs">…</span>
                                            ) : (
                                                (() => {
                                                    const s = offersSummaryQ.data?.[p.id];
                                                    if (!s) return <span className="text-zinc-400">—</span>;
                                                    return (
                                                        <span className="inline-flex items-center gap-1">
                                                            <span className="font-medium">{s.totalAvailable}</span>
                                                            <span className="text-xs text-zinc-500">({s.activeOffers} offer{s.activeOffers === 1 ? '' : 's'})</span>
                                                        </span>
                                                    );
                                                })()
                                            )}
                                        </td>
                                        <td className="px-3 py-2">{stockCell}</td>
                                        <td className="px-3 py-2">
                                            <StatusDot label={getStatus(p)} />
                                        </td>

                                        {isSuper && (
                                            <td className="px-3 py-2">
                                                {p.owner?.email || p.ownerEmail || p.createdByEmail || p.createdBy?.email || '—'}
                                            </td>
                                        )}
                                        <td className="px-3 py-2 text-right">
                                            <div className="inline-flex gap-2">
                                                <button onClick={() => startEdit(p)} className="px-2 py-1 rounded border">
                                                    Edit in form
                                                </button>

                                                {isAdmin && (
                                                    <button
                                                        onClick={() => updateStatusM.mutate({ id: p.id, status: 'PENDING' })}
                                                        className="px-2 py-1 rounded bg-amber-600 text-white"
                                                    >
                                                        Submit for Review
                                                    </button>
                                                )}

                                                {isSuper && (() => {
                                                    const action = primaryActionForRow(p);
                                                    return (
                                                        <button
                                                            onClick={action.onClick}
                                                            className={action.className}
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

                                    {open && (
                                        <tr id={`prod-editor-${p.id}`} className="bg-zinc-50/50">
                                            <td colSpan={isSuper ? 7 : 6} className="px-3 py-3">
                                                <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                                                    <input className="border rounded-lg px-3 py-2 md:col-span-2" placeholder="Title" value={d?.title || ''} onChange={(e) => changeEdit(p.id, { title: e.target.value })} />
                                                    <input className="border rounded-lg px-3 py-2" placeholder="Price" inputMode="decimal" value={d?.price || ''} onChange={(e) => changeEdit(p.id, { price: e.target.value })} />
                                                    <input className="border rounded-lg px-3 py-2" placeholder="SKU" value={d?.sku || ''} onChange={(e) => changeEdit(p.id, { sku: e.target.value })} />

                                                    <select className="border rounded-lg px-3 py-2" value={d?.categoryId || ''} onChange={(e) => changeEdit(p.id, { categoryId: e.target.value })}>
                                                        <option value="">— Category —</option>
                                                        {catsQ.data?.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                                    </select>
                                                    <select className="border rounded-lg px-3 py-2" value={d?.brandId || ''} onChange={(e) => changeEdit(p.id, { brandId: e.target.value })}>
                                                        <option value="">— Brand —</option>
                                                        {brandsQ.data?.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                                                    </select>
                                                    <select className="border rounded-lg px-3 py-2" value={d?.supplierId || ''} onChange={(e) => changeEdit(p.id, { supplierId: e.target.value })}>
                                                        <option value="">— Supplier —</option>
                                                        {suppliersQ.data?.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                                    </select>

                                                    {isSuper && (
                                                        <select className="border rounded-lg px-3 py-2" value={d?.status || 'PENDING'} onChange={(e) => changeEdit(p.id, { status: e.target.value })}>
                                                            <option value="PENDING">PENDING</option>
                                                            <option value="PUBLISHED">PUBLISHED</option>
                                                        </select>
                                                    )}

                                                    <div className="md:col-span-6 flex items-center justify-end gap-2">
                                                        <button onClick={cancelEdit} className="px-3 py-2 rounded-lg border">Cancel</button>
                                                        <button onClick={() => submitEdit(p.id, 'save')} className="px-3 py-2 rounded-lg bg-zinc-900 text-white">Save Changes</button>
                                                        {isAdmin && (
                                                            <button onClick={() => submitEdit(p.id, 'submitForReview')} className="px-3 py-2 rounded-lg bg-amber-600 text-white" title="Set status to PENDING for approval">
                                                                Submit for Review
                                                            </button>
                                                        )}
                                                        {isSuper && (
                                                            <>
                                                                <button onClick={() => submitEdit(p.id, 'approvePublished')} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">Approve PUBLISHED</button>
                                                                <button onClick={() => submitEdit(p.id, 'movePending')} className="px-3 py-2 rounded-lg border">Move to PENDING</button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {!listQ.isLoading && displayRows.length === 0 && (
                            <tr><td colSpan={isSuper ? 7 : 6} className="px-3 py-4 text-center text-zinc-500">No products</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

