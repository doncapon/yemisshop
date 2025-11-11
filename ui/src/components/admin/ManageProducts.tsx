import React, { useEffect, useMemo, useRef, useState } from "react";
import StatusDot from "../StatusDot";
import { Search } from "lucide-react";
import { useModal } from "../ModalProvider";
import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { useDebounced } from "../../utils/useDebounced";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client";
import { getHttpErrorMessage } from "../../utils/httpError";
import SuppliersOfferManager from "./SuppliersOfferManager";

/* ============================
   Types
============================ */

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

type AdminProduct = {
    id: string;
    title: string;
    price: number | string;
    status: string;
    imagesJson?: string[] | string;
    createdAt?: string;
    isDelete?: boolean;
    ownerId?: string | null;
    availableQty?: number;
    supplierOffers?: SupplierOfferLite[];
    ownerEmail?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    supplierId?: string | null;
    sku?: string | null;
    inStock?: boolean;
    variants?: any[];
    variantCount?: number;
    createdByEmail?: string | null;
    createdBy?: { email?: string | null };
    owner?: { email?: string | null };
    communicationCost?: number | string | null;
    description?: string | null;
};

type AdminSupplier = {
    id: string;
    name: string;
    type: "PHYSICAL" | "ONLINE";
    status: string;
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

/* Variant row: each row = subset of attributes + shared price bump */
type VariantRow = {
    id: string;
    selections: Record<string, string>; // attributeId -> valueId | ""
    priceBump: string; // applies to the combo in this row
};

/* ============================
   Helpers
============================ */

function statusFromPreset(
    p: FilterPreset
): "ANY" | "PUBLISHED" | "PENDING" | "REJECTED" | "LIVE" {
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
    const candidates = [
        o?.availableQty,
        o?.available,
        o?.qty,
        o?.stock,
    ];
    for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n)) {
            return Math.max(0, Math.floor(n));
        }
    }
    return 0;
}

async function persistVariantsStrict(
    productId: string,
    variants: any[],
    token?: string | null
) {
    if (!variants?.length) return;
    const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
    const clean = (variants || []).map((v) => ({
        ...v,
        options: (v.options || []).map((o: any) => {
            const n = Number(o.priceBump);
            return {
                attributeId: o.attributeId || o.attribute?.id,
                valueId: o.valueId || o.attributeValueId || o.value?.id,
                priceBump: Number.isFinite(n) ? n : null,
            };
        }),
    }));
    try {
        const { data } = await api.post(
            `/api/admin/products/${encodeURIComponent(productId)}/variants/bulk`,
            { variants: clean, replace: true },
            { headers: hdr }
        );
        return data;
    } catch (e: any) {
        const msg =
            e?.response?.data?.detail ||
            e?.response?.data?.error ||
            e?.message ||
            "Failed to persist variants";
        console.error(
            "persistVariantsStrict error:",
            e?.response?.status,
            e?.response?.data || e
        );
        throw new Error(msg);
    }
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

    const ngn = new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
    });

    const fmtN = (n?: number | string) => {
        const v = Number(n);
        return Number.isFinite(v) ? v : 0;
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
    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
        key: "title",
        dir: "asc",
    });

    const toggleSort = (key: SortKey) =>
        setSort((prev) =>
            prev.key === key
                ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
                : { key, dir: "asc" }
        );

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
        queryKey: [
            "admin",
            "products",
            "manage",
            { q: debouncedSearch, statusParam },
        ],
        enabled: !!token,
        queryFn: async () => {
            const { data } = await api.get("/api/admin/products", {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                    status: statusParam,
                    q: debouncedSearch,
                    take: 50,
                    skip: 0,
                    include: "owner",
                },
            });
            const arr = Array.isArray(data?.data)
                ? data.data
                : Array.isArray(data)
                    ? data
                    : [];
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
            console.error(
                "Products list failed:",
                e?.response?.status,
                e?.response?.data || e?.message
            );
        }
    }, [listQ.isError, listQ.error]);

    const rows = listQ.data ?? [];

    const offersSummaryQ = useQuery({
        queryKey: [
            "admin",
            "products",
            "offers-summary",
            { ids: rows.map((r) => r.id) },
        ],
        enabled: !!token && rows.length > 0,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const productIds = rows.map((r) => r.id);
            if (!productIds.length) return {};

            // ✅ Use the canonical summary endpoint
            const qs = new URLSearchParams();
            qs.set("productIds", productIds.join(","));

            const { data } = await api.get(`/api/admin/supplier-offers?${qs}`, { headers: hdr });

            const arr = Array.isArray(data?.data)
                ? data.data
                : Array.isArray(data)
                    ? data
                    : [];

            const offers = (arr as SupplierOfferLite[]).filter((o) => !!o.productId);

            const byProduct: Record<
                string,
                {
                    totalAvailable: number;
                    activeOffers: number;
                    perSupplier: Array<{
                        supplierId: string;
                        supplierName?: string;
                        availableQty: number;
                    }>;
                    inStock: boolean;
                }
            > = {};

            for (const o of offers) {
                const pid = o.productId;
                const isActive = coerceBool((o as any).isActive, true);
                if (!pid || !isActive) continue;

                const availableQty =
                    availOf(o) ||
                    toInt((o as any).availableQty, 0) ||
                    0;

                if (!byProduct[pid]) {
                    byProduct[pid] = {
                        totalAvailable: 0,
                        activeOffers: 0,
                        perSupplier: [],
                        inStock: false,
                    };
                }

                byProduct[pid].totalAvailable += availableQty;
                byProduct[pid].activeOffers += 1;
                byProduct[pid].perSupplier.push({
                    supplierId: o.supplierId,
                    supplierName: o.supplierName,
                    availableQty,
                });
            }

            Object.values(byProduct).forEach((s) => {
                s.inStock = s.totalAvailable > 0;
            });

            return byProduct;
        },

    });

    const rowsWithDerived: AdminProduct[] = useMemo(() => {
        const summary = offersSummaryQ.data || {};
        return (rows || []).map((p) => {
            const s = summary[p.id];
            if (!s)
                return {
                    ...p,
                    availableQty: 0,
                    inStock: p.inStock === true && (p.availableQty ?? 0) > 0,
                };
            return {
                ...p,
                availableQty: s.totalAvailable,
                inStock: s.inStock,
            };
        });
    }, [rows, offersSummaryQ.data]);

    /* ---------------- Status helpers ---------------- */

    type EffectiveStatus =
        | "PUBLISHED"
        | "PENDING"
        | "REJECTED"
        | "ARCHIVED"
        | "LIVE";

    const getStatus = (p: any): EffectiveStatus =>
        (p?.isDelete || p?.isDeleted) ? "ARCHIVED" : (p?.status ?? "PENDING");

    type RowAction =
        | {
            kind: "approve";
            label: string;
            title: string;
            onClick: () => void;
            disabled?: boolean;
            className?: string;
        }
        | {
            kind: "movePending";
            label: string;
            title: string;
            onClick: () => void;
            disabled?: boolean;
            className?: string;
        }
        | {
            kind: "revive";
            label: string;
            title: string;
            onClick: () => void;
            disabled?: boolean;
            className?: string;
        }
        | {
            kind: "archive";
            label: string;
            title: string;
            onClick: () => void;
            disabled?: boolean;
            className?: string;
        }
        | {
            kind: "delete";
            label: string;
            title: string;
            onClick: () => void;
            disabled?: boolean;
            className?: string;
        }
        | {
            kind: "loading";
            label: string;
            title: string;
            onClick: () => void;
            disabled?: boolean;
            className?: string;
        };

    const statusRank: Record<EffectiveStatus, number> = {
        LIVE: 0,
        PUBLISHED: 1,
        PENDING: 2,
        REJECTED: 3,
        ARCHIVED: 4,
    };

    const updateStatusM = useMutation({
        mutationFn: async ({
            id,
            status,
        }: {
            id: string;
            status: "PUBLISHED" | "PENDING" | "REJECTED" | "LIVE";
        }) =>
            (
                await api.post(
                    `/api/admin/products/${id}/status`,
                    { status },
                    { headers: { Authorization: `Bearer ${token}` } }
                )
            ).data,
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

    /* ---------------- Lookups ---------------- */

    const catsQ = useQuery<AdminCategory[]>({
        queryKey: ["admin", "products", "cats"],
        enabled: !!token,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = [
                "/api/admin/categories",
                "/api/categories",
                "/api/catalog/categories",
            ];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data)
                        ? data.data
                        : Array.isArray(data)
                            ? data
                            : [];
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
                    const arr = Array.isArray(data?.data)
                        ? data.data
                        : Array.isArray(data)
                            ? data
                            : [];
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
            const attempts = ["/api/admin/suppliers", "/api/suppliers"];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data)
                        ? data.data
                        : Array.isArray(data)
                            ? data
                            : [];
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
                    const arr = Array.isArray(data?.data)
                        ? data.data
                        : Array.isArray(data)
                            ? data
                            : [];
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
            (
                await api.post("/api/admin/products", payload, {
                    headers: { Authorization: `Bearer ${token}` },
                })
            ).data,
        onError: (e) =>
            openModal({
                title: "Products",
                message: getHttpErrorMessage(e, "Create failed"),
            }),
    });

    const updateM = useMutation({
        mutationFn: async ({ id, ...payload }: any) =>
            (
                await api.patch(`/api/admin/products/${id}`, payload, {
                    headers: { Authorization: `Bearer ${token}` },
                })
            ).data,
        onError: (e) =>
            openModal({
                title: "Products",
                message: getHttpErrorMessage(e, "Update failed"),
            }),
    });

    const restoreM = useMutation({
        mutationFn: async (id: string) => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const res = await api.post(
                `/api/admin/products/${encodeURIComponent(id)}/restore`,
                {},
                { headers: hdr }
            );
            return res.data ?? res;
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

    const hasOrdersQ = useQuery<Record<string, boolean>>({
        queryKey: [
            "admin",
            "products",
            "has-orders",
            { ids: (rowsWithDerived ?? []).map((r) => r.id) },
        ],
        enabled: !!token && rowsWithDerived.length > 0,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const ids = rowsWithDerived.map((r) => r.id);

            const results = await Promise.all(
                ids.map(async (id) => {
                    try {
                        const { data } = await api.get(
                            `/api/admin/products/${encodeURIComponent(id)}/has-orders`,
                            { headers: hdr }
                        );
                        const has =
                            typeof data === "boolean"
                                ? data
                                : typeof data?.has === "boolean"
                                    ? data.has
                                    : typeof data?.data?.has === "boolean"
                                        ? data.data.has
                                        : false;
                        return [id, has] as const;
                    } catch {
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

            if (hasOrdersQ.isLoading || hasOrdersQ.data == null) {
                try {
                    const { data } = await api.get(
                        `/api/admin/products/${id}/has-orders`,
                        { headers: hdr }
                    );
                    has = !!(data?.data?.has ?? data?.has ?? data);
                } catch {
                    has = false;
                }
            }

            const url = has
                ? `/api/admin/products/${id}/soft-delete`
                : `/api/admin/products/${id}`;
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
        sku: "",
        imageUrls: "",
        communicationCost: "",
        description: "",
    };
    const [offersProductId, setOffersProductId] = useState<string | null>(null);

    const [pending, setPending] = useState(defaultPending);
    const [editingId, setEditingId] = useState<string | null>(null);

    const parseUrlList = (s: string) =>
        s
            .split(/[\n,]/g)
            .map((t) => t.trim())
            .filter(Boolean);

    const isUrlish = (s?: string) =>
        !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);

    const toArray = (x: any): any[] =>
        Array.isArray(x) ? x : x == null ? [] : [x];

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
            const urls: string[] =
                (res as any)?.data?.urls ||
                (Array.isArray((res as any)?.data)
                    ? (res as any).data
                    : []);
            return Array.isArray(urls) ? urls : [];
        } finally {
            setUploading(false);
        }
    }

    /* ---------------- Variants: row-based editor ---------------- */

    const selectableAttrs = useMemo(
        () =>
            (attrsQ.data || []).filter(
                (a) => a.type === "SELECT" && a.isActive
            ),
        [attrsQ.data]
    );

    const [variantRows, setVariantRows] = useState<VariantRow[]>([]);

    // Used ONLY for SupplierOfferManager; fed ONLY via "Refresh offers".
    const [offerVariants, setOfferVariants] = useState<any[]>([]);


    // Do NOT wipe variantRows when attributes flicker; only align keys when we have attrs
    useEffect(() => {
        if (!selectableAttrs.length) {
            return;
        }
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

    function addVariantRow() {
        const id = `vr-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`;
        const selections: Record<string, string> = {};
        selectableAttrs.forEach((a) => {
            selections[a.id] = "";
        });
        setVariantRows((prev) => [
            ...prev,
            { id, selections, priceBump: "" },
        ]);
    }

    function updateVariantSelection(
        rowId: string,
        attributeId: string,
        valueId: string
    ) {
        setVariantRows((rows) =>
            rows.map((row) =>
                row.id === rowId
                    ? {
                        ...row,
                        selections: {
                            ...row.selections,
                            [attributeId]: valueId,
                        },
                    }
                    : row
            )
        );
    }

    function updateVariantPriceBump(
        rowId: string,
        value: string
    ) {
        setVariantRows((rows) =>
            rows.map((row) =>
                row.id === rowId
                    ? { ...row, priceBump: value }
                    : row
            )
        );
    }

    function removeVariantRow(rowId: string) {
        setVariantRows((rows) =>
            rows.filter((r) => r.id !== rowId)
        );
    }

    function resetVariantState() {
        setVariantRows([]);
    }


    /* ---------------- Attribute selections for top form ---------------- */

    const [selectedAttrs, setSelectedAttrs] = useState<
        Record<string, string | string[]>
    >({});

    /* ---------------- JWT / me ---------------- */

    function base64UrlDecode(str: string) {
        const pad =
            str.length % 4 === 2
                ? "=="
                : str.length % 4 === 3
                    ? "="
                    : "";
        const b64 = str
            .replace(/-/g, "+")
            .replace(/_/g, "/") + pad;
        const bin = atob(b64);
        const bytes = Uint8Array.from(
            bin,
            (c) => c.charCodeAt(0)
        );
        const dec = new TextDecoder("utf-8");
        return dec.decode(bytes);
    }

    function parseJwtClaims(
        jwt?: string | null
    ): Record<string, any> | undefined {
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

    const claims = useMemo(
        () => parseJwtClaims(token),
        [token]
    );

    const meQ = useQuery<{
        id?: string;
        email?: string;
    }>({
        queryKey: ["auth", "me"],
        enabled: !!token,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            try {
                const { data } = await api.get(
                    "/api/auth/me",
                    {
                        headers: token
                            ? {
                                Authorization: `Bearer ${token}`,
                            }
                            : undefined,
                    }
                );
                const d = data?.data ?? data ?? {};
                return {
                    id:
                        d.id ||
                        d.user?.id ||
                        d.profile?.id ||
                        d.account?.id,
                    email:
                        d.email ||
                        d.user?.email ||
                        d.profile?.email ||
                        d.account?.email,
                };
            } catch {
                return {};
            }
        },
        staleTime: 5 * 60 * 1000,
    });

    const userId =
        claims?.sub || claims?.id || meQ.data?.id;

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
            communicationCost?: number;
            description?: string | null;
        };
        selectedAttrs: Record<string, string | string[]>;
        variantRows: VariantRow[];
        attrsAll: AdminAttribute[];
    }) {
        const payload: any = { ...base };

        const attributeSelections: any[] = [];
        const attributeValues: Array<{
            attributeId: string;
            valueId?: string;
            valueIds?: string[];
        }> = [];
        const attributeTexts: Array<{
            attributeId: string;
            value: string;
        }> = [];

        for (const a of attrsAll) {
            const sel = selectedAttrs[a.id];
            if (
                sel == null ||
                (Array.isArray(sel) &&
                    sel.length === 0) ||
                (typeof sel === "string" &&
                    sel.trim() === "")
            )
                continue;

            if (a.type === "TEXT") {
                attributeSelections.push({
                    attributeId: a.id,
                    text: String(sel),
                });
                attributeTexts.push({
                    attributeId: a.id,
                    value: String(sel),
                });
            } else if (a.type === "SELECT") {
                const valueId = String(sel);
                attributeSelections.push({
                    attributeId: a.id,
                    valueId,
                });
                attributeValues.push({
                    attributeId: a.id,
                    valueId,
                });
            } else if (a.type === "MULTISELECT") {
                const valueIds = (sel as string[]).map(
                    String
                );
                attributeSelections.push({
                    attributeId: a.id,
                    valueIds,
                });
                attributeValues.push({
                    attributeId: a.id,
                    valueIds,
                });
            }
        }

        if (attributeSelections.length)
            payload.attributeSelections =
                attributeSelections;
        if (attributeValues.length)
            payload.attributeValues =
                attributeValues;
        if (attributeTexts.length)
            payload.attributeTexts =
                attributeTexts;

        // Build variants from the provided rows + attributes (self-contained)
        const selectable = (attrsAll || []).filter(
            (a) => a.type === "SELECT" && a.isActive
        );

        if (variantRows.length > 0 && selectable.length > 0) {
            const variants: any[] = [];

            for (const row of variantRows) {
                const picks = Object.entries(row.selections || {}).filter(
                    ([, valueId]) => valueId
                );
                if (picks.length === 0) continue;

                const bumpNum = Number(row.priceBump);
                const hasBump = Number.isFinite(bumpNum);

                const options = picks.map(([attributeId, valueId]) => {
                    const option: any = {
                        attributeId,
                        valueId,
                        attributeValueId: valueId,
                    };
                    if (hasBump) option.priceBump = bumpNum;
                    return option;
                });

                const labelParts: string[] = [];
                for (const [attributeId, valueId] of picks) {
                    const attr = selectable.find((a) => a.id === attributeId);
                    const val = attr?.values?.find((v) => v.id === valueId);
                    const code = (val?.code || val?.name || "").toString();
                    if (code) {
                        labelParts.push(
                            code.toUpperCase().replace(/\s+/g, "")
                        );
                    }
                }

                const comboLabel = labelParts.join("-");
                const sku =
                    base.sku && comboLabel
                        ? `${base.sku}-${comboLabel}`
                        : base.sku || comboLabel || undefined;

                variants.push({
                    sku,
                    options,
                    optionSelections: options,
                    attributes: options.map((o: any) => ({
                        attributeId: o.attributeId,
                        valueId: o.valueId,
                    })),
                });
            }

            if (variants.length) {
                payload.variants = variants;
                payload.variantOptions = variants.map((v: any) => v.options);
            }
        }



        if (!base.supplierId) {
            openModal({
                title: "Products",
                message:
                    "Supplier is required.",
            });
            return;
        }

        return payload;
    }

    /* ---------------- Load full product into top form ---------------- */

    async function fetchProductFull(
        id: string
    ) {
        const { data } = await api.get(
            `/api/admin/products/${id}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                params: {
                    include:
                        "variants,attributes,brand",
                },
            }
        );
        const prod =
            data?.data ?? data;
        return {
            ...prod,
            imagesJson: Array.isArray(
                prod?.imagesJson
            )
                ? prod.imagesJson
                : [],
            variants: Array.isArray(
                prod?.variants
            )
                ? prod.variants
                : [],
            attributeValues:
                Array.isArray(
                    prod?.attributeValues
                )
                    ? prod.attributeValues
                    : [],
            attributeTexts:
                Array.isArray(
                    prod?.attributeTexts
                )
                    ? prod.attributeTexts
                    : [],
        };
    }

    async function startEdit(p: any) {
        try {
            const full =
                await fetchProductFull(
                    p.id
                );
            setOffersProductId(full.id);
            setEditingId(
                full.id
            );
            setPending({
                title:
                    full.title ||
                    "",
                price: String(
                    full.price ??
                    ""
                ),
                status:
                    full.status ===
                        "PUBLISHED" ||
                        full.status ===
                        "LIVE"
                        ? full.status
                        : "PENDING",
                categoryId:
                    full.categoryId ||
                    "",
                brandId:
                    full.brandId ||
                    "",
                supplierId:
                    full.supplierId ||
                    "",
                sku:
                    full.sku ||
                    "",
                imageUrls: (
                    extractImageUrls(
                        full
                    ) || []
                ).join(
                    "\n"
                ),
                communicationCost:
                    full.communicationCost !=
                        null
                        ? String(
                            full.communicationCost
                        )
                        : "",
                description:
                    full.description ??
                    "",
            });

            const nextSel: Record<
                string,
                string | string[]
            > = {};
            (full.attributeValues ||
                full.attributeSelections ||
                []
            ).forEach(
                (av: any) => {
                    if (
                        Array.isArray(
                            av.valueIds
                        )
                    )
                        nextSel[
                            av
                                .attributeId
                        ] =
                            av.valueIds;
                    else if (
                        av.valueId
                    )
                        nextSel[
                            av
                                .attributeId
                        ] =
                            av.valueId;
                }
            );
            (full.attributeTexts ||
                []
            ).forEach(
                (at: any) => {
                    nextSel[
                        at
                            .attributeId
                    ] =
                        at.value;
                }
            );
            setSelectedAttrs(
                nextSel
            );

            const selsAttrs =
                selectableAttrs.length
                    ? selectableAttrs
                    : (attrsQ.data ||
                        []
                    ).filter(
                        (a) =>
                            a.type ===
                            "SELECT" &&
                            a.isActive
                    );

            const vr: VariantRow[] =
                [];
            if (
                Array.isArray(
                    full.variants
                )
            ) {
                for (const v of full.variants) {
                    const selections: Record<
                        string,
                        string
                    > = {};
                    selsAttrs.forEach(
                        (a) => {
                            selections[
                                a.id
                            ] =
                                "";
                        }
                    );

                    const opts =
                        v.options ||
                        v.optionSelections ||
                        [];
                    let bump: number | null =
                        null;

                    for (const o of opts) {
                        const attrId =
                            o.attributeId ||
                            o.attribute
                                ?.id;
                        const valId =
                            o.valueId ||
                            o.attributeValueId ||
                            o.value
                                ?.id;
                        if (
                            attrId &&
                            valId &&
                            Object.prototype.hasOwnProperty.call(
                                selections,
                                attrId
                            )
                        ) {
                            selections[
                                attrId
                            ] =
                                String(
                                    valId
                                );
                        }
                        const pb =
                            Number(
                                o.priceBump
                            );
                        if (
                            Number.isFinite(
                                pb
                            )
                        )
                            bump =
                                pb;
                    }

                    const hasAny =
                        Object.values(
                            selections
                        ).some(
                            Boolean
                        );
                    if (hasAny) {
                        vr.push({
                            id:
                                v.id ||
                                `vr-${Math.random()
                                    .toString(
                                        36
                                    )
                                    .slice(
                                        2,
                                        8
                                    )}`,
                            selections,
                            priceBump:
                                bump !=
                                    null
                                    ? String(
                                        bump
                                    )
                                    : "",
                        });
                    }
                }
            }

            setVariantRows(
                vr
            );
            loadOfferVariants(full.id);
        } catch (e) {
            console.error(e);
            openModal({
                title:
                    "Products",
                message:
                    "Could not load product for editing.",
            });
        }
    }

    /* ---------------- Supplier offers button / partial refresh ---------------- */

    async function handleOpenSupplierOffers() {
        if (!offersProductId) return;
        await loadOfferVariants(offersProductId);
    }

    async function loadOfferVariants(productId: string) {
        try {
            const full = await fetchProductFull(productId);
            setOfferVariants(full.variants || []);
        } catch (e) {
            console.error(e);
            alert("Could not load product variants for offers.",
            );
        }
    }



    /* ---------------- Save / Create ---------------- */
    async function saveOrCreate() {
        const base: any = {
            title: pending.title.trim(),
            price: Number(pending.price) || 0,
            status: pending.status,
            sku: pending.sku.trim() || undefined,
            description:
                pending.description != null
                    ? pending.description
                    : undefined,
        };

        if (!base.title) return;
        if (userId) base.ownerId = userId;

        const comm = Number(pending.communicationCost);
        if (Number.isFinite(comm) && comm >= 0) {
            base.communicationCost = comm;
        }

        if (pending.categoryId) base.categoryId = pending.categoryId;
        if (pending.brandId) base.brandId = pending.brandId;
        if (pending.supplierId) base.supplierId = pending.supplierId;

        const urlList = parseUrlList(pending.imageUrls);
        const uploaded = await uploadLocalFiles();
        const imagesJson = [...urlList, ...uploaded].filter(Boolean);
        if (imagesJson.length) base.imagesJson = imagesJson;

        // Build full payload (includes attributes + variants)
        const fullPayload = buildProductPayload({
            base,
            selectedAttrs,
            variantRows,
            attrsAll: attrsQ.data || [],
        });

        if (!fullPayload) return;

        if (editingId) {
            const {
                variants,
                variantOptions,
                attributeSelections,
                ...productOnly
            } = fullPayload as any;

            const hasVariantRows =
                Array.isArray(variants) && variants.length > 0;

            updateM.mutate(
                { id: editingId, ...productOnly },
                {
                    onSuccess: async () => {
                        const pid = editingId;

                        // Persist variants when variant rows are defined
                        if (pid && hasVariantRows) {
                            try {
                                await persistVariantsStrict(pid, variants, token);
                            } catch (e) {
                                console.error(
                                    "Failed to persist variants on update",
                                    e
                                );
                                openModal({
                                    title: "Products",
                                    message: getHttpErrorMessage(
                                        e,
                                        "Failed to save variants"
                                    ),
                                });
                            }
                        }

                        // 🔹 Update the cached products list instead of forcing a full refetch
                        qc.setQueryData<AdminProduct[]>(
                            [
                                "admin",
                                "products",
                                "manage",
                                { q: debouncedSearch, statusParam },
                            ],
                            (old) => {
                                if (!old) return old;
                                return old.map((p) =>
                                    p.id === pid ? { ...p, ...productOnly } : p
                                );
                            }
                        );

                        // Still refresh aggregates / detail where it makes sense
                        await Promise.all([
                            qc.invalidateQueries({
                                queryKey: ["admin", "overview"],
                            }),
                            pid
                                ? qc.invalidateQueries({
                                    queryKey: [
                                        "admin",
                                        "product",
                                        pid,
                                        "variants",
                                    ],
                                })
                                : Promise.resolve(),
                        ]);

                        // ✅ Alert only; no reload
                        alert("Product changes saved.");
                    },
                }
            );
        }
        else {
            // CREATE NEW PRODUCT (unchanged logic, still supports variants)
            createM.mutate(fullPayload, {
                onSuccess: async (res) => {
                    const created = (res?.data ?? res) as any;
                    const pid =
                        created?.id ||
                        created?.product?.id ||
                        created?.data?.id;

                    const vars = (fullPayload as any)?.variants ?? [];

                    if (pid && vars.length > 0) {
                        try {
                            await persistVariantsStrict(pid, vars, token);
                        } catch (e) {
                            console.error("Failed to persist variants on create", e);
                            openModal({
                                title: "Products",
                                message: getHttpErrorMessage(
                                    e,
                                    "Failed to save variants"
                                ),
                            });
                        }
                    }

                    if (pid) {
                        setOffersProductId(pid);
                        setEditingId(pid);
                        loadOfferVariants(pid);
                    }

                    await Promise.all([
                        qc.invalidateQueries({
                            queryKey: ["admin", "products", "manage"],
                        }),
                        qc.invalidateQueries({
                            queryKey: ["admin", "overview"],
                        }),
                        pid
                            ? qc.invalidateQueries({
                                queryKey: [
                                    "admin",
                                    "product",
                                    pid,
                                    "variants",
                                ],
                            })
                            : Promise.resolve(),
                    ]);
                },
            });
        }
    }


    /* ---------------- Focus handoff from moderation ---------------- */

    useEffect(() => {
        if (!focusId || !rowsWithDerived?.length)
            return;
        const target =
            rowsWithDerived.find(
                (r: any) =>
                    r.id ===
                    focusId
            );
        if (!target) return;
        startEdit(target);
        onFocusedConsumed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusId, rowsWithDerived]);

    /* ---------------- Previews helpers ---------------- */

    const urlPreviews = useMemo(
        () =>
            parseUrlList(
                pending.imageUrls
            ),
        [pending.imageUrls]
    );
    const filePreviews = useMemo(
        () =>
            files.map((f) => ({
                f,
                url: URL.createObjectURL(
                    f
                ),
            })),
        [files]
    );

    function setUrlAt(
        i: number,
        newUrl: string
    ) {
        const list =
            parseUrlList(
                pending.imageUrls
            );
        list[i] =
            newUrl.trim();
        setPending((d) => ({
            ...d,
            imageUrls:
                list
                    .filter(
                        Boolean
                    )
                    .join(
                        "\n"
                    ),
        }));
    }

    function removeUrlAt(
        i: number
    ) {
        const list =
            parseUrlList(
                pending.imageUrls
            );
        list.splice(i, 1);
        setPending((d) => ({
            ...d,
            imageUrls:
                list.join(
                    "\n"
                ),
        }));
    }

    function moveUrl(
        i: number,
        dir: -1 | 1
    ) {
        const list =
            parseUrlList(
                pending.imageUrls
            );
        const j = i + dir;
        if (
            j < 0 ||
            j >= list.length
        )
            return;
        [list[i], list[j]] = [
            list[j],
            list[i],
        ];
        setPending((d) => ({
            ...d,
            imageUrls:
                list.join(
                    "\n"
                ),
        }));
    }

    function removeFileAt(
        i: number
    ) {
        setFiles((prev) =>
            prev.filter(
                (_, idx) =>
                    idx !== i
            )
        );
    }

    function replaceFileAt(
        i: number,
        f: File
    ) {
        setFiles((prev) => {
            const copy =
                [...prev];
            copy[i] = f;
            return copy;
        });
    }

    function moveFile(
        i: number,
        dir: -1 | 1
    ) {
        setFiles((prev) => {
            const j = i + dir;
            if (
                j < 0 ||
                j >= prev.length
            )
                return prev;
            const copy =
                [...prev];
            [copy[i], copy[j]] =
                [
                    copy[j],
                    copy[i],
                ];
            return copy;
        });
    }

    /* ---------------- Primary actions / status ---------------- */

    function submitStatusEdit(
        pId: string,
        intent:
            | "approvePublished"
            | "movePending"
    ) {
        const source =
            rowsWithDerived.find(
                (r: any) =>
                    r.id ===
                    pId
            );
        if (!source) return;

        const patch: any =
            {};

        if (
            intent ===
            "approvePublished"
        ) {
            const s =
                offersSummaryQ
                    .data?.[pId];
            const avail =
                (source.availableQty ??
                    0) > 0 ||
                (s?.inStock ??
                    source
                        .inStock !==
                    false);
            if (!avail) {
                openModal({
                    title:
                        "Cannot publish",
                    message:
                        "This product is not in stock. Please add stock or active supplier offers first.",
                });
                return;
            }
            patch.status =
                "PUBLISHED";
        } else if (
            intent ===
            "movePending"
        ) {
            patch.status =
                "PENDING";
        }

        updateStatusM.mutate({
            id: pId,
            ...patch,
        });
    }

    function primaryActionForRow(
        p: any
    ): RowAction {
        const eff =
            getStatus(p);
        const s =
            offersSummaryQ
                .data?.[p.id];
        const hasActiveOffer =
            !!s &&
            s.activeOffers >
            0 &&
            (s.totalAvailable ??
                0) > 0;

        const ordersKnown =
            !!hasOrdersQ.data;
        const ordered =
            hasOrder(p.id);

        if (
            !ordersKnown ||
            offersSummaryQ
                .isLoading
        ) {
            return {
                kind: "loading",
                label: "…",
                title:
                    "Checking…",
                disabled:
                    true,
                onClick:
                    () => { },
                className:
                    "px-2 py-1 rounded bg-zinc-400 text-white",
            };
        }

        if (
            eff ===
            "PENDING" &&
            hasActiveOffer
        ) {
            return {
                kind: "approve",
                label:
                    "Approve PUBLISHED",
                title:
                    "Publish product",
                onClick:
                    () =>
                        submitStatusEdit(
                            p.id,
                            "approvePublished"
                        ),
                className:
                    "px-3 py-2 rounded-lg bg-emerald-600 text-white",
            };
        }

        if (
            eff ===
            "PENDING" &&
            !hasActiveOffer
        ) {
            return ordered
                ? {
                    kind: "archive",
                    label:
                        "Archive",
                    title:
                        "Archive (soft delete)",
                    onClick:
                        () =>
                            deleteM.mutate(
                                p.id
                            ),
                    className:
                        "px-2 py-1 rounded bg-rose-600 text-white",
                }
                : {
                    kind: "delete",
                    label:
                        "Delete",
                    title:
                        "Delete permanently",
                    onClick:
                        () =>
                            deleteM.mutate(
                                p.id
                            ),
                    className:
                        "px-2 py-1 rounded bg-rose-600 text-white",
                };
        }

        if (
            eff ===
            "PUBLISHED" ||
            eff === "LIVE"
        ) {
            return {
                kind: "movePending",
                label:
                    "Move to PENDING",
                title:
                    "Unpublish product",
                onClick:
                    () =>
                        submitStatusEdit(
                            p.id,
                            "movePending"
                        ),
                className:
                    "px-3 py-2 rounded-lg border bg-amber-400 text-white",
            };
        }

        if (eff === "ARCHIVED") {
            return {
                kind: "revive",
                label:
                    "Revive",
                title:
                    "Restore archived product",
                onClick:
                    () =>
                        restoreM.mutate(
                            p.id
                        ),
                className:
                    "px-3 py-2 rounded-lg bg-sky-600 text-white",
            };
        }

        return ordered
            ? {
                kind: "archive",
                label:
                    "Archive",
                title:
                    "Archive (soft delete)",
                onClick:
                    () =>
                        deleteM.mutate(
                            p.id
                        ),
                className:
                    "px-2 py-1 rounded bg-rose-600 text-white",
            }
            : {
                kind: "delete",
                label:
                    "Delete",
                title:
                    "Delete permanently",
                onClick:
                    () =>
                        deleteM.mutate(
                            p.id
                        ),
                className:
                    "px-2 py-1 rounded bg-rose-600 text-white",
            };
    }

    /* ---------------- Filters / sorting ---------------- */

    const getAvail = (p: any) =>
        Number(
            offersSummaryQ
                .data?.[p.id]
                ?.totalAvailable ??
            0
        );
    const getOwner = (p: any) =>
        (p.owner?.email ||
            p.ownerEmail ||
            p.createdByEmail ||
            p.createdBy
                ?.email ||
            "") as string;

    const filteredRows = useMemo(
        () => {
            const offers =
                offersSummaryQ.data ||
                {};
            const hasAnyOffer = (
                pId: string
            ) => {
                const s =
                    offers[pId];
                return (
                    !!s &&
                    (s.activeOffers >
                        0 ||
                        s
                            .perSupplier
                            ?.length >
                        0)
                );
            };
            const hasActiveOffer = (
                pId: string
            ) => {
                const s =
                    offers[pId];
                return (
                    !!s &&
                    s.activeOffers >
                    0 &&
                    (s
                        .totalAvailable ??
                        0) > 0
                );
            };
            const isAvailableVariantAware = (
                pId: string,
                p: any
            ) => {
                const s =
                    offers[pId];
                if (s?.inStock)
                    return true;
                return (
                    p.inStock ===
                    true
                );
            };
            const hasVariants = (
                p: any
            ) =>
                Array.isArray(
                    p.variants
                )
                    ? p
                        .variants
                        .length >
                    0
                    : (p.variantCount ??
                        0) > 0;
            const baseInStock = (
                p: any
            ) =>
                p.inStock ===
                true;

            return rowsWithDerived.filter(
                (p) => {
                    switch (
                    preset
                    ) {
                        case "no-offer":
                            return !hasAnyOffer(
                                p.id
                            );
                        case "live":
                            return (
                                p.status ===
                                "LIVE"
                            );
                        case "published-with-offer":
                            return (
                                p.status ===
                                "PUBLISHED" &&
                                hasAnyOffer(
                                    p.id
                                )
                            );
                        case "published-no-offer":
                            return (
                                p.status ===
                                "PUBLISHED" &&
                                !hasAnyOffer(
                                    p.id
                                )
                            );
                        case "published-with-active":
                            return (
                                p.status ===
                                "PUBLISHED" &&
                                hasActiveOffer(
                                    p.id
                                )
                            );
                        case "published-base-in":
                            return (
                                p.status ===
                                "PUBLISHED" &&
                                baseInStock(
                                    p
                                )
                            );
                        case "published-base-out":
                            return (
                                p.status ===
                                "PUBLISHED" &&
                                !baseInStock(
                                    p
                                )
                            );
                        case "with-variants":
                            return hasVariants(
                                p
                            );
                        case "simple":
                            return !hasVariants(
                                p
                            );
                        case "published-with-availability":
                            return (
                                p.status ===
                                "PUBLISHED" &&
                                isAvailableVariantAware(
                                    p.id,
                                    p
                                )
                            );
                        case "published":
                            return (
                                p.status ===
                                "PUBLISHED"
                            );
                        case "pending":
                            return (
                                p.status ===
                                "PENDING"
                            );
                        case "rejected":
                            return (
                                p.status ===
                                "REJECTED"
                            );
                        case "all":
                        default:
                            return true;
                    }
                }
            );
        },
        [
            rowsWithDerived,
            preset,
            offersSummaryQ.data,
        ]
    );

    const displayRows = useMemo(
        () => {
            const arr =
                [...filteredRows];

            const cmpNum = (
                a: number,
                b: number
            ) =>
                a === b
                    ? 0
                    : a < b
                        ? -1
                        : 1;
            const cmpStr = (
                a: string,
                b: string
            ) =>
                a.localeCompare(
                    b,
                    undefined,
                    {
                        sensitivity:
                            "base",
                    }
                );

            arr.sort(
                (a, b) => {
                    let res = 0;
                    switch (
                    sort.key
                    ) {
                        case "title":
                            res =
                                cmpStr(
                                    a?.title ??
                                    "",
                                    b?.title ??
                                    ""
                                );
                            break;
                        case "price":
                            res =
                                cmpNum(
                                    Number(
                                        a?.price
                                    ) || 0,
                                    Number(
                                        b?.price
                                    ) || 0
                                );
                            break;
                        case "avail":
                            res =
                                cmpNum(
                                    a
                                        ?.availableQty ??
                                    getAvail(
                                        a
                                    ),
                                    b
                                        ?.availableQty ??
                                    getAvail(
                                        b
                                    )
                                );
                            break;
                        case "stock":
                            res =
                                cmpNum(
                                    a?.inStock
                                        ? 1
                                        : 0,
                                    b?.inStock
                                        ? 1
                                        : 0
                                );
                            break;
                        case "status":
                            res =
                                cmpNum(
                                    statusRank[
                                    getStatus(
                                        a
                                    )
                                    ] ??
                                    99,
                                    statusRank[
                                    getStatus(
                                        b
                                    )
                                    ] ??
                                    99
                                );
                            break;
                        case "owner":
                            res =
                                cmpStr(
                                    getOwner(
                                        a
                                    ),
                                    getOwner(
                                        b
                                    )
                                );
                            break;
                    }
                    return sort.dir ===
                        "asc"
                        ? res
                        : -res;
                }
            );

            return arr;
        },
        [
            filteredRows,
            sort,
            offersSummaryQ.data,
        ]
    );

    const supplierVariants = useMemo(
        () =>
            (offerVariants || [])
                .filter((v: any) => v && v.id != null && v.id !== "")
                .map((v: any, index: number) => {
                    const fromOptions =
                        Array.isArray(v.options || v.optionSelections)
                            ? (v.options || v.optionSelections)
                                .map(
                                    (o: any) =>
                                        o?.value?.code ||
                                        o?.value?.name ||
                                        o?.attributeValue?.code ||
                                        o?.attributeValue?.name ||
                                        o?.valueId ||
                                        ""
                                )
                                .filter(Boolean)
                                .join(" / ")
                            : "";

                    const label =
                        v.sku ||
                        v.label ||
                        v.name ||
                        fromOptions ||
                        (v.id != null ? String(v.id) : `Variant ${index + 1}`);

                    return {
                        id: String(v.id),
                        sku: v.sku || label,
                        label,
                    };
                }),
        [offerVariants]
    );




    /* ============================
       Render
    ============================ */

    return (
        <div
            className="space-y-3"
            onKeyDownCapture={(e) => {
                if (e.key === "Enter") {
                    const target = e.target as HTMLElement;
                    const tag = target.tagName;
                    const isTextArea = tag === "TEXTAREA";
                    const isButton = tag === "BUTTON";
                    if (!isTextArea && !isButton) {
                        e.preventDefault();
                    }
                }
            }}
            onSubmitCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
        >
            <div className="space-y-3">
                {editingId && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                        Editing:{" "}
                        <span className="font-semibold">
                            {(pending.title ||
                                "").trim() ||
                                "Untitled product"}
                        </span>
                        <span className="ml-2 text-xs text-amber-700/80">
                            (ID:{" "}
                            <span className="font-mono">
                                {editingId}
                            </span>
                            )
                        </span>
                    </div>
                )}

                {/* Supplier offers (button-triggered, partial refresh, keeps state) */}
                {offersProductId && (
                    <div className="rounded-2xl border bg-white shadow-sm mt-3">
                        <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
                            <div>
                                <h3 className="text-ink font-semibold">Supplier offers</h3>
                                <p className="text-xs text-ink-soft">
                                    Link supplier offers to this product and its variants.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleOpenSupplierOffers}
                                className="px-3 py-1.5 text-xs rounded-lg border bg-zinc-50 hover:bg-zinc-100"
                            >
                                Refresh offers
                            </button>
                        </div>

                        <SuppliersOfferManager
                            key={offersProductId}        // ✅ separate “form” per product
                            productId={offersProductId}
                            variants={supplierVariants}
                            suppliers={suppliersQ.data ?? []}
                            token={token}
                            readOnly={!(isSuper || isAdmin)}
                        />
                    </div>
                )}




                {/* Top form: add + edit */}
                <div
                    id="create-form"
                    className="grid gap-2"
                >
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <input
                            className="border rounded-lg px-3 py-2"
                            placeholder="Title"
                            value={
                                pending.title
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        title:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        />
                        <input
                            className="border rounded-lg px-3 py-2"
                            placeholder="Price"
                            inputMode="decimal"
                            value={
                                pending.price
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        price:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        />
                        <input
                            className="border rounded-lg px-3 py-2"
                            placeholder="Base SKU"
                            value={
                                pending.sku
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        sku: e
                                            .target
                                            .value,
                                    })
                                )
                            }
                        />
                        <select
                            className="border rounded-lg px-3 py-2"
                            value={
                                pending.status
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        status:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        >
                            <option value="PUBLISHED">
                                PUBLISHED
                            </option>
                            <option value="PENDING">
                                PENDING
                            </option>
                        </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <select
                            className="border rounded-lg px-3 py-2"
                            value={
                                pending
                                    .categoryId
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        categoryId:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        >
                            <option value="">
                                {catsQ.isLoading
                                    ? "Loading…"
                                    : "— Category —"}
                            </option>
                            {catsQ.data?.map(
                                (c) => (
                                    <option
                                        key={c.id}
                                        value={
                                            c.id
                                        }
                                    >
                                        {
                                            c.name
                                        }
                                    </option>
                                )
                            )}
                        </select>

                        <select
                            className="border rounded-lg px-3 py-2"
                            value={
                                pending.brandId
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        brandId:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        >
                            <option value="">
                                — Brand —
                            </option>
                            {brandsQ.data?.map(
                                (b) => (
                                    <option
                                        key={b.id}
                                        value={
                                            b.id
                                        }
                                    >
                                        {
                                            b.name
                                        }
                                    </option>
                                )
                            )}
                        </select>

                        <select
                            className="border rounded-lg px-3 py-2"
                            value={
                                pending
                                    .supplierId
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        supplierId:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        >
                            <option value="">
                                — Supplier —
                            </option>
                            {suppliersQ.data?.map(
                                (s) => (
                                    <option
                                        key={s.id}
                                        value={
                                            s.id
                                        }
                                    >
                                        {
                                            s.name
                                        }
                                    </option>
                                )
                            )}
                        </select>

                        <input
                            className="border rounded-lg px-3 py-2"
                            placeholder="Communication cost"
                            inputMode="decimal"
                            value={
                                pending
                                    .communicationCost
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        communicationCost:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        />
                    </div>

                    {/* Description */}
                    <div className="rounded-lg border bg-white p-3">
                        <label className="block text-xs font-semibold mb-1">
                            Description
                        </label>
                        <textarea
                            className="w-full border rounded-lg px-3 py-2 min-h-[80px]"
                            placeholder="Enter product description…"
                            value={
                                pending
                                    .description
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        description:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        />
                    </div>

                    {/* Images */}
                    <div className="rounded-lg border bg-white p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h3 className="font-semibold text-sm">
                                    Images
                                </h3>
                                <p className="text-[11px] text-zinc-500">
                                    Paste image URLs
                                    (one per line) or
                                    upload files.
                                    Stored in{" "}
                                    <code>
                                        imagesJson
                                    </code>
                                    .
                                </p>
                            </div>
                        </div>

                        <label className="block text-xs text-zinc-600 mb-1">
                            Image URLs (one per
                            line)
                        </label>
                        <textarea
                            className="w-full border rounded-lg px-3 py-2 text-xs mb-3"
                            rows={3}
                            placeholder={
                                "https://.../image1.jpg\nhttps://.../image2.png"
                            }
                            value={
                                pending
                                    .imageUrls
                            }
                            onChange={(e) =>
                                setPending(
                                    (d) => ({
                                        ...d,
                                        imageUrls:
                                            e
                                                .target
                                                .value,
                                    })
                                )
                            }
                        />

                        <div className="flex items-center gap-3 mb-2">
                            <input
                                ref={
                                    fileInputRef
                                }
                                id="product-file-input"
                                type="file"
                                multiple
                                accept="image/*"
                                onChange={(e) =>
                                    setFiles(
                                        Array.from(
                                            e
                                                .target
                                                .files ||
                                            []
                                        )
                                    )
                                }
                                className="hidden"
                            />
                            <label
                                htmlFor="product-file-input"
                                className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium border cursor-pointer bg-zinc-50 hover:bg-zinc-100"
                            >
                                Choose files
                            </label>
                            {!!files.length && (
                                <span className="text-[11px] text-zinc-500">
                                    {
                                        files.length
                                    }{" "}
                                    file
                                    {files.length ===
                                        1
                                        ? ""
                                        : "s"}{" "}
                                    selected
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={
                                    uploadLocalFiles
                                }
                                className="ml-auto inline-flex items-center rounded-md border px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50"
                                disabled={
                                    uploading ||
                                    files.length ===
                                    0
                                }
                            >
                                {uploading
                                    ? "Uploading…"
                                    : "Upload selected now"}
                            </button>
                        </div>

                        {(urlPreviews.length >
                            0 ||
                            filePreviews.length >
                            0) && (
                                <div className="grid md:grid-cols-2 gap-3 mt-2">
                                    {urlPreviews.length >
                                        0 && (
                                            <div className="border rounded-md">
                                                <div className="px-2 py-1.5 text-xs font-semibold border-b bg-zinc-50">
                                                    URL previews
                                                </div>
                                                <div className="p-2 space-y-2">
                                                    {urlPreviews.map(
                                                        (
                                                            u,
                                                            i
                                                        ) => (
                                                            <div
                                                                key={`url-${i}`}
                                                                className="flex items-start gap-2"
                                                            >
                                                                <div className="w-16 h-12 bg-zinc-100 border rounded overflow-hidden shrink-0">
                                                                    <img
                                                                        src={
                                                                            u
                                                                        }
                                                                        alt=""
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <input
                                                                        className="w-full border rounded px-2 py-1 text-[10px]"
                                                                        value={
                                                                            u
                                                                        }
                                                                        onChange={(
                                                                            e
                                                                        ) =>
                                                                            setUrlAt(
                                                                                i,
                                                                                e
                                                                                    .target
                                                                                    .value
                                                                            )
                                                                        }
                                                                    />
                                                                    <div className="flex gap-1 mt-1">
                                                                        <button
                                                                            type="button"
                                                                            className="px-1.5 py-0.5 text-[9px] border rounded"
                                                                            onClick={() =>
                                                                                moveUrl(
                                                                                    i,
                                                                                    -1
                                                                                )
                                                                            }
                                                                            disabled={
                                                                                i ===
                                                                                0
                                                                            }
                                                                        >
                                                                            ↑
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="px-1.5 py-0.5 text-[9px] border rounded"
                                                                            onClick={() =>
                                                                                moveUrl(
                                                                                    i,
                                                                                    +1
                                                                                )
                                                                            }
                                                                            disabled={
                                                                                i ===
                                                                                urlPreviews.length -
                                                                                1
                                                                            }
                                                                        >
                                                                            ↓
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-rose-600 text-white"
                                                                            onClick={() =>
                                                                                removeUrlAt(
                                                                                    i
                                                                                )
                                                                            }
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                    {filePreviews.length >
                                        0 && (
                                            <div className="border rounded-md">
                                                <div className="px-2 py-1.5 text-xs font-semibold border-b bg-zinc-50">
                                                    Local files
                                                </div>
                                                <div className="p-2 space-y-2">
                                                    {filePreviews.map(
                                                        (
                                                            {
                                                                f,
                                                                url,
                                                            },
                                                            i
                                                        ) => (
                                                            <div
                                                                key={`file-${i}`}
                                                                className="flex items-start gap-2"
                                                            >
                                                                <div className="w-16 h-12 bg-zinc-100 border rounded overflow-hidden shrink-0">
                                                                    <img
                                                                        src={
                                                                            url
                                                                        }
                                                                        alt=""
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-[10px] font-medium truncate">
                                                                        {
                                                                            f.name
                                                                        }
                                                                    </div>
                                                                    <div className="text-[9px] text-zinc-500">
                                                                        {(
                                                                            f.size /
                                                                            1024
                                                                        ).toFixed(
                                                                            0
                                                                        )}{" "}
                                                                        KB •{" "}
                                                                        {f.type ||
                                                                            "image/*"}
                                                                    </div>
                                                                    <div className="flex gap-1 mt-1">
                                                                        <label className="px-1.5 py-0.5 text-[9px] border rounded cursor-pointer">
                                                                            Replace
                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                className="hidden"
                                                                                onChange={(
                                                                                    e
                                                                                ) => {
                                                                                    const nf =
                                                                                        e
                                                                                            .target
                                                                                            .files?.[0];
                                                                                    if (
                                                                                        nf
                                                                                    )
                                                                                        replaceFileAt(
                                                                                            i,
                                                                                            nf
                                                                                        );
                                                                                }}
                                                                            />
                                                                        </label>
                                                                        <button
                                                                            type="button"
                                                                            className="px-1.5 py-0.5 text-[9px] border rounded"
                                                                            onClick={() =>
                                                                                moveFile(
                                                                                    i,
                                                                                    -1
                                                                                )
                                                                            }
                                                                            disabled={
                                                                                i ===
                                                                                0
                                                                            }
                                                                        >
                                                                            ↑
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="px-1.5 py-0.5 text-[9px] border rounded"
                                                                            onClick={() =>
                                                                                moveFile(
                                                                                    i,
                                                                                    +1
                                                                                )
                                                                            }
                                                                            disabled={
                                                                                i ===
                                                                                filePreviews.length -
                                                                                1
                                                                            }
                                                                        >
                                                                            ↓
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-rose-600 text-white"
                                                                            onClick={() =>
                                                                                removeFileAt(
                                                                                    i
                                                                                )
                                                                            }
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    )}
                                                    <div className="pt-1 border-t flex justify-end">
                                                        <button
                                                            type="button"
                                                            className="px-2 py-0.5 text-[9px] border rounded"
                                                            onClick={() =>
                                                                setFiles(
                                                                    []
                                                                )
                                                            }
                                                        >
                                                            Clear all
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                </div>
                            )}

                        <p className="mt-1 text-[10px] text-zinc-500">
                            Files (if any) are
                            uploaded and URLs
                            stored when you
                            click{" "}
                            <strong>
                                {editingId
                                    ? "Save Changes"
                                    : "Add Product"}
                            </strong>
                            .
                        </p>
                    </div>

                    {/* Variants: select-in-row + price bump, green dot on selected options */}
                    <div className="rounded-lg border bg-white p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-sm">
                                    Variant combinations
                                </h3>
                                <p className="text-[10px] text-zinc-500">
                                    Each row: pick any
                                    attribute values
                                    you want for that
                                    combo and set one
                                    price bump.
                                    Selected selects
                                    show a green dot;
                                    empty selects mean
                                    that attribute is
                                    ignored for that
                                    row.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={addVariantRow}
                                className="px-2 py-1.5 text-xs rounded-md border bg-zinc-50 hover:bg-zinc-100"
                            >
                                + Add variant row
                            </button>
                        </div>

                        {selectableAttrs.length ===
                            0 && (
                                <p className="text-[10px] text-zinc-500">
                                    No selectable
                                    attributes found.
                                    Configure
                                    attributes in
                                    Catalog Settings
                                    first.
                                </p>
                            )}

                        {variantRows.length >
                            0 &&
                            selectableAttrs.length >
                            0 && (
                                <div className="space-y-2">
                                    {variantRows.map(
                                        (row) => (
                                            <div
                                                key={
                                                    row.id
                                                }
                                                className="flex flex-wrap items-center gap-2 border rounded-md px-2 py-2"
                                            >
                                                {selectableAttrs.map(
                                                    (
                                                        attr
                                                    ) => {
                                                        const valueId =
                                                            row
                                                                .selections[
                                                            attr
                                                                .id
                                                            ] ||
                                                            "";
                                                        const hasSelection =
                                                            !!valueId;
                                                        return (
                                                            <div
                                                                key={
                                                                    attr.id
                                                                }
                                                                className="flex items-center gap-1"
                                                            >
                                                                {hasSelection && (
                                                                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                                                                )}
                                                                <select
                                                                    className="border rounded px-2 py-1 text-[10px] bg-white"
                                                                    value={
                                                                        valueId
                                                                    }
                                                                    onChange={(
                                                                        e
                                                                    ) =>
                                                                        updateVariantSelection(
                                                                            row.id,
                                                                            attr.id,
                                                                            e
                                                                                .target
                                                                                .value
                                                                        )
                                                                    }
                                                                >
                                                                    <option value="">
                                                                        {
                                                                            attr.name
                                                                        }
                                                                    </option>
                                                                    {(attr.values ||
                                                                        []
                                                                    ).map(
                                                                        (
                                                                            v
                                                                        ) => (
                                                                            <option
                                                                                key={
                                                                                    v.id
                                                                                }
                                                                                value={
                                                                                    v.id
                                                                                }
                                                                            >
                                                                                {
                                                                                    v.name
                                                                                }
                                                                            </option>
                                                                        )
                                                                    )}
                                                                </select>
                                                            </div>
                                                        );
                                                    }
                                                )}

                                                <div className="flex items-center gap-1 ml-2">
                                                    <span className="text-[10px] text-zinc-500">
                                                        Price
                                                        bump
                                                    </span>
                                                    <input
                                                        className="w-20 border rounded px-1 py-1 text-[10px]"
                                                        placeholder="+0"
                                                        inputMode="decimal"
                                                        value={
                                                            row.priceBump
                                                        }
                                                        onChange={(
                                                            e
                                                        ) =>
                                                            updateVariantPriceBump(
                                                                row.id,
                                                                e
                                                                    .target
                                                                    .value
                                                            )
                                                        }
                                                    />
                                                    <span className="text-[10px] text-zinc-400">
                                                        (for this
                                                        combo)
                                                    </span>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        removeVariantRow(
                                                            row.id
                                                        )
                                                    }
                                                    className="ml-auto px-2 py-1 text-[10px] rounded bg-rose-50 text-rose-700 border border-rose-200"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                    </div>
                </div>

                <div className="flex gap-2 items-center">
                    <button
                        type="button"
                        onClick={saveOrCreate}
                        className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-60"
                        disabled={
                            uploading ||
                            createM.isPending ||
                            updateM.isPending
                        }
                    >
                        {uploading
                            ? "Uploading…"
                            : editingId
                                ? "Save Changes"
                                : "Add Product"}
                    </button>

                    {editingId && (
                        <>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingId(null);
                                    setOffersProductId(null);
                                    setPending(defaultPending);
                                    setSelectedAttrs({});
                                    setFiles([]);
                                    if (fileInputRef.current)
                                        fileInputRef.current.value = "";
                                    resetVariantState();
                                    setOfferVariants([]);


                                }}
                                className="px-3 py-2 rounded-md bg-zinc-900 text-white text-sm"
                            >
                                Confirm &amp; Close
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingId(null);
                                    setPending(defaultPending);
                                    setSelectedAttrs({});
                                    setFiles([]);
                                    if (fileInputRef.current)
                                        fileInputRef.current.value = "";
                                    resetVariantState();
                                }}
                                className="px-3 py-2 rounded-md border text-sm"
                            >
                                Cancel
                            </button>
                        </>
                    )}
                </div>


                {/* Search */}
                <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                        <Search
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                        />
                        <input
                            value={
                                searchInput
                            }
                            onChange={(e) =>
                                setSearchInput(
                                    e.target
                                        .value
                                )
                            }
                            placeholder="Search title, sku…"
                            className="pl-9 pr-3 py-2 rounded-md border bg-white w-full text-sm"
                        />
                    </div>
                </div>

                {/* Filter chips */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">
                        Filters:
                    </span>
                    {[
                        ["all", "All"],
                        ["live", "Live"],
                        ["published", "Published"],
                        ["pending", "Pending"],
                        ["rejected", "Rejected"],
                        [
                            "published-with-active",
                            "Published w/ Active",
                        ],
                        [
                            "published-with-offer",
                            "Published w/ Offer",
                        ],
                        [
                            "published-no-offer",
                            "Published no Offer",
                        ],
                        ["no-offer", "No Offer"],
                        [
                            "with-variants",
                            "With variants",
                        ],
                        ["simple", "Simple"],
                        [
                            "published-base-in",
                            "Published base in",
                        ],
                        [
                            "published-base-out",
                            "Published base out",
                        ],
                    ].map(
                        ([
                            key,
                            label,
                        ]) => (
                            <button
                                type="button"
                                key={key}
                                onClick={() =>
                                    setPresetAndUrl(
                                        key as FilterPreset
                                    )
                                }
                                className={`px-2.5 py-1.5 rounded-full border text-xs ${preset ===
                                    key
                                    ? "bg-zinc-900 text-white"
                                    : "bg-white hover:bg-zinc-50"
                                    }`}
                            >
                                {label}
                            </button>
                        )
                    )}
                    {preset !==
                        "all" && (
                            <button
                                type="button"
                                onClick={() =>
                                    setPresetAndUrl(
                                        "all"
                                    )
                                }
                                className="ml-1 px-2 py-1.5 rounded-full text-xs border bg-white hover:bg-zinc-50"
                            >
                                Clear
                            </button>
                        )}
                </div>

                {/* Products table */}
                <div className="border rounded-md overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th
                                    className="text-left px-3 py-2 cursor-pointer select-none"
                                    onClick={() =>
                                        toggleSort(
                                            "title"
                                        )
                                    }
                                >
                                    Title{" "}
                                    <SortIndicator k="title" />
                                </th>
                                <th
                                    className="text-left px-3 py-2 cursor-pointer select-none"
                                    onClick={() =>
                                        toggleSort(
                                            "price"
                                        )
                                    }
                                >
                                    Price{" "}
                                    <SortIndicator k="price" />
                                </th>
                                <th
                                    className="text-left px-3 py-2 cursor-pointer select-none"
                                    onClick={() =>
                                        toggleSort(
                                            "avail"
                                        )
                                    }
                                >
                                    Avail.{" "}
                                    <SortIndicator k="avail" />
                                </th>
                                <th
                                    className="text-left px-3 py-2 cursor-pointer select-none"
                                    onClick={() =>
                                        toggleSort(
                                            "stock"
                                        )
                                    }
                                >
                                    Stock{" "}
                                    <SortIndicator k="stock" />
                                </th>
                                <th
                                    className="text-left px-3 py-2 cursor-pointer select-none"
                                    onClick={() =>
                                        toggleSort(
                                            "status"
                                        )
                                    }
                                >
                                    Status{" "}
                                    <SortIndicator k="status" />
                                </th>
                                {isSuper && (
                                    <th
                                        className="text-left px-3 py-2 cursor-pointer select-none"
                                        onClick={() =>
                                            toggleSort(
                                                "owner"
                                            )
                                        }
                                    >
                                        Owner{" "}
                                        <SortIndicator k="owner" />
                                    </th>
                                )}
                                <th className="text-right px-3 py-2">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {listQ.isLoading && (
                                <tr>
                                    <td
                                        className="px-3 py-3"
                                        colSpan={
                                            isSuper
                                                ? 7
                                                : 6
                                        }
                                    >
                                        Loading
                                        products…
                                    </td>
                                </tr>
                            )}

                            {!listQ.isLoading &&
                                displayRows.map(
                                    (p: any) => {
                                        const stockCell =
                                            p.inStock ===
                                                true ? (
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
                                            <tr
                                                key={
                                                    p.id
                                                }
                                            >
                                                <td className="px-3 py-2">
                                                    {
                                                        p.title
                                                    }
                                                </td>
                                                <td className="px-3 py-2">
                                                    {ngn.format(
                                                        fmtN(
                                                            p.price
                                                        )
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {offersSummaryQ.isLoading ? (
                                                        <span className="text-zinc-500 text-xs">
                                                            …
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1">
                                                            <span className="font-medium">
                                                                {p.availableQty ??
                                                                    0}
                                                            </span>
                                                            <span className="text-xs text-zinc-500">
                                                                (
                                                                {offersSummaryQ
                                                                    .data?.[
                                                                    p
                                                                        .id
                                                                ]
                                                                    ?.activeOffers ??
                                                                    0}{" "}
                                                                offer
                                                                {(offersSummaryQ
                                                                    .data?.[
                                                                    p
                                                                        .id
                                                                ]
                                                                    ?.activeOffers ??
                                                                    0) ===
                                                                    1
                                                                    ? ""
                                                                    : "s"}
                                                                )
                                                            </span>
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {stockCell}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <StatusDot
                                                        label={getStatus(
                                                            p
                                                        )}
                                                    />
                                                </td>
                                                {isSuper && (
                                                    <td className="px-3 py-2">
                                                        {p.owner
                                                            ?.email ||
                                                            p.ownerEmail ||
                                                            p.createdByEmail ||
                                                            p
                                                                .createdBy
                                                                ?.email ||
                                                            "—"}
                                                    </td>
                                                )}
                                                <td className="px-3 py-2 text-right">
                                                    <div className="inline-flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                startEdit(
                                                                    p
                                                                )
                                                            }
                                                            className="px-2 py-1 rounded border text-xs"
                                                        >
                                                            Edit in
                                                            form
                                                        </button>

                                                        {isAdmin && (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    updateStatusM.mutate(
                                                                        {
                                                                            id: p.id,
                                                                            status:
                                                                                "PENDING",
                                                                        }
                                                                    )
                                                                }
                                                                className="px-2 py-1 rounded bg-amber-600 text-white text-xs"
                                                            >
                                                                Submit
                                                                for
                                                                Review
                                                            </button>
                                                        )}

                                                        {isSuper &&
                                                            (() => {
                                                                const action =
                                                                    primaryActionForRow(
                                                                        p
                                                                    );
                                                                return (
                                                                    <button
                                                                        type="button"
                                                                        onClick={
                                                                            action.onClick
                                                                        }
                                                                        className={
                                                                            action.className ||
                                                                            "px-2 py-1 rounded border text-xs"
                                                                        }
                                                                        disabled={
                                                                            deleteM.isPending ||
                                                                            restoreM.isPending ||
                                                                            action.disabled
                                                                        }
                                                                        title={
                                                                            action.title
                                                                        }
                                                                    >
                                                                        {
                                                                            action.label
                                                                        }
                                                                    </button>
                                                                );
                                                            })()}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    }
                                )}

                            {!listQ.isLoading &&
                                displayRows.length ===
                                0 && (
                                    <tr>
                                        <td
                                            colSpan={
                                                isSuper
                                                    ? 7
                                                    : 6
                                            }
                                            className="px-3 py-4 text-center text-zinc-500"
                                        >
                                            No
                                            products
                                        </td>
                                    </tr>
                                )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
