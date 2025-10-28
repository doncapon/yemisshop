import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { useMemo, useState } from "react";
import React from "react";

type SupplierOfferLite = {
    id: string;
    productId: string;
    variantId: string | null;
    supplierId: string;
    supplierName?: string;
    price: number | string;
    currency?: string;
    availableQty?: number;
    leadDays?: number;
    isActive?: boolean;
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

type VariantLite = { id: string; sku: string };

// --- Optional: metadata for displaying variant attributes
type VariantMeta = {
    id: string;
    sku: string;
    // minimal structure for UI labels; robust to various backend shapes
    options?: Array<{
        attributeId?: string;
        attributeName?: string;
        valueId?: string;
        valueName?: string;
        code?: string | null;
    }>;
};

function useVariantMeta(productId: string, variantId: string | null | undefined, token?: string | null) {
    const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

    return useQuery<VariantMeta | null>({
        queryKey: ["admin", "products", productId, "variant-meta", variantId ?? "PRODUCT"],
        enabled: !!productId && !!variantId, // only fetch when variantId is defined (not for product-wide rows)
        refetchOnWindowFocus: false,
        staleTime: 300_000,
        queryFn: async () => {
            if (!variantId) return null;
            // Try a few sensible endpoints
            const attempts = [
                `/api/admin/variants/${variantId}`,
                `/api/admin/products/${productId}/variants/${variantId}`,
                `/api/products/${productId}/variants/${variantId}`,
            ];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const v = (data?.data ?? data) as any;
                    if (v && typeof v === "object") {
                        // Normalize options
                        const options: VariantMeta["options"] =
                            (v.options || v.optionSelections || []).map((o: any) => ({
                                attributeId: o.attributeId || o.attribute?.id,
                                attributeName: o.attribute?.name || o.attributeName,
                                valueId: o.valueId || o.attributeValueId || o.value?.id,
                                valueName: o.value?.name || o.valueName,
                                code: o.value?.code ?? o.code ?? null,
                            })) ?? [];
                        return { id: String(v.id), sku: String(v.sku || ""), options };
                    }
                } catch {
                    /* try next */
                }
            }
            return null;
        },
    });
}

export function SuppliersOfferManager({
    productId,
    variants,
    token,
    readOnly,
}: {
    productId: string;
    variants: VariantLite[];
    token?: string | null;
    readOnly?: boolean;
}) {
    const qc = useQueryClient();
    const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

    // ——— Fetch offers for this product
    const offersQ = useQuery<SupplierOfferLite[]>({
        queryKey: ['admin', 'products', productId, 'offers'],
        enabled: !!productId,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        queryFn: async () => {
            const qs = new URLSearchParams({ productId });
            const attempts = [
                `/api/admin/products/${productId}/supplier-offers`,
                `/api/admin/products/${productId}/offers`,
                `/api/products/${productId}/supplier-offers`,
                `/api/admin/supplier-offers?${qs}`,
                `/api/supplier-offers?${qs}`,
            ];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch (e: any) {
                    // swallow 404s and try next route
                    if (e?.response?.status !== 404) {
                        // Non-404 (e.g. 401) — rethrow to surface auth problems
                        throw e;
                    }
                }
            }
            return [];
        },
    });


    // ——— Fetch suppliers for dropdown (re-use your suppliersQ if you like)
    const suppliersQ = useQuery<AdminSupplier[]>({
        queryKey: ["admin", "products", "suppliers", "for-offers"],
        enabled: !!token,
        refetchOnWindowFocus: false,
        staleTime: 300_000,
        queryFn: async () => {
            const attempts = ["/api/admin/suppliers", "/api/suppliers"];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
                    if (Array.isArray(arr)) return arr as AdminSupplier[];
                } catch { }
            }
            return [];
        },
    });

    // ——— Create / Update / Delete
    const createM = useMutation({
        mutationFn: async (payload: Omit<SupplierOfferLite, 'id' | 'supplierName'>) => {
            const nestedBodies = [payload, { data: payload }];
            const flatBodies = [
                { ...payload, productId },          // flat style expects productId in body
                { data: { ...payload, productId } },
            ];
            const attempts: Array<{ url: string; body: any }> = [
                { url: `/api/admin/products/${productId}/supplier-offers`, body: nestedBodies[0] },
                { url: `/api/admin/products/${productId}/supplier-offers`, body: nestedBodies[1] },
                { url: `/api/admin/products/${productId}/offers`, body: nestedBodies[0] },
                { url: `/api/admin/products/${productId}/offers`, body: nestedBodies[1] },
                { url: `/api/products/${productId}/supplier-offers`, body: nestedBodies[0] },
                { url: `/api/products/${productId}/supplier-offers`, body: nestedBodies[1] },
                { url: `/api/admin/supplier-offers`, body: flatBodies[0] },
                { url: `/api/admin/supplier-offers`, body: flatBodies[1] },
                { url: `/api/supplier-offers`, body: flatBodies[0] },
                { url: `/api/supplier-offers`, body: flatBodies[1] },
            ];
            let lastErr: any;
            for (const a of attempts) {
                try {
                    const res = await api.post(a.url, a.body, { headers: hdr });
                    return (res?.data?.data ?? res?.data) as SupplierOfferLite;
                } catch (e: any) {
                    lastErr = e;
                    if (e?.response?.status && e.response.status !== 404) {
                        // if server exists but rejects (400, 401, 403), surface early
                        throw e;
                    }
                }
            }
            throw lastErr;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', productId, 'offers'] });
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'offers-summary'] });
        },
    });


    const updateM = useMutation({
        mutationFn: async ({ id, ...patch }: Partial<SupplierOfferLite> & { id: string }) => {
            const bodies = [patch, { data: patch }];
            const attempts = [
                `/api/admin/supplier-offers/${id}`,
                `/api/supplier-offers/${id}`,
                // some backends accept nested PATCH too:
                `/api/admin/products/${productId}/supplier-offers/${id}`,
                `/api/products/${productId}/supplier-offers/${id}`,
            ];
            let lastErr: any;
            for (const u of attempts) {
                for (const b of bodies) {
                    try {
                        const res = await api.patch(u, b, { headers: hdr });
                        return (res?.data?.data ?? res?.data) as SupplierOfferLite;
                    } catch (e: any) {
                        lastErr = e;
                        if (e?.response?.status && e.response.status !== 404) throw e;
                    }
                }
            }
            throw lastErr;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', productId, 'offers'] });
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'offers-summary'] });
        },
    });

    const deleteM = useMutation({
        mutationFn: async (id: string) => {
            const attempts = [
                `/api/admin/supplier-offers/${id}`,
                `/api/supplier-offers/${id}`,
                `/api/admin/products/${productId}/supplier-offers/${id}`,
                `/api/products/${productId}/supplier-offers/${id}`,
            ];
            let lastErr: any;
            for (const u of attempts) {
                try {
                    const res = await api.delete(u, { headers: hdr });
                    return res?.data;
                } catch (e: any) {
                    lastErr = e;
                    if (e?.response?.status && e.response.status !== 404) throw e;
                }
            }
            throw lastErr;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', productId, 'offers'] });
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'offers-summary'] });
        },
    });

    // ——— Form state for new/edit rows
    type RowDraft = {
        id?: string;
        supplierId: string;
        variantId: string | "PRODUCT";
        price: string;
        currency: string;
        availableQty: string;
        leadDays: string;
        isActive: boolean;
    };
    const [draft, setDraft] = useState<RowDraft>({
        supplierId: "",
        variantId: "PRODUCT",
        price: "",
        currency: "NGN",
        availableQty: "",
        leadDays: "",
        isActive: true,
    });

    const [editingId, setEditingId] = useState<string | null>(null);

    const resetDraft = () => {
        setDraft({
            supplierId: "",
            variantId: "PRODUCT",
            price: "",
            currency: "NGN",
            availableQty: "",
            leadDays: "",
            isActive: true,
        });
        setEditingId(null);
    };

    const startEdit = (o: SupplierOfferLite) => {
        setEditingId(o.id);
        setDraft({
            id: o.id,
            supplierId: o.supplierId,
            variantId: o.variantId ?? "PRODUCT",
            price: String(o.price ?? ""),
            currency: (o.currency as string) || "NGN",
            availableQty: String(o.availableQty ?? ""),
            leadDays: String(o.leadDays ?? ""),
            isActive: o.isActive !== false,
        });
    };

    const submitDraft = () => {
        if (readOnly) return;
        const payload = {
            productId,
            supplierId: draft.supplierId,
            variantId: draft.variantId === "PRODUCT" ? null : draft.variantId,
            price: Number(draft.price) || 0,
            currency: draft.currency || "NGN",
            availableQty: Number(draft.availableQty) || 0,
            leadDays: Number(draft.leadDays) || 0,
            isActive: !!draft.isActive,
        };
        if (editingId) {
            updateM.mutate({ id: editingId, ...payload });
        } else {
            createM.mutate(payload as any);
        }
        resetDraft();
    };

    // Group by variant (PRODUCT = product-wide)
    const grouped = useMemo(() => {
        const arr = offersQ.data || [];
        const byVariant: Record<string, SupplierOfferLite[]> = {};
        for (const o of arr) {
            const key = o.variantId ?? "PRODUCT";
            if (!byVariant[key]) byVariant[key] = [];
            byVariant[key].push(o);
        }
        return byVariant;
    }, [offersQ.data]);

    // Totals per variant; product-wide contributes to caps for specific variants
    const variantTotals = useMemo(() => {
        const byVar: Record<string, number> = {};
        (offersQ.data || []).forEach((o) => {
            if (o.isActive === false) return;
            const key = o.variantId ?? "PRODUCT";
            byVar[key] = (byVar[key] || 0) + Math.max(0, Number(o.availableQty || 0));
        });
        return byVar;
    }, [offersQ.data]);

    const productWide = variantTotals["PRODUCT"] ?? 0;
    const totalForVariant = (vid: string | "PRODUCT") =>
        (variantTotals[vid] ?? 0) + (vid === "PRODUCT" ? 0 : productWide);

    // Fetch meta for the currently edited variant (for attribute display)
    const editedVariantId = draft.variantId === "PRODUCT" ? null : (draft.variantId as string);
    const editedVariantMetaQ = useVariantMeta(productId, editedVariantId, token);

    // Small helpers
    const supplierName = (id?: string) =>
        (suppliersQ.data || []).find((s) => s.id === id)?.name || id || "—";

    return (
        <div className="space-y-4">
            {/* List */}
            <div className="overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50">
                        <tr>
                            <th className="text-left px-3 py-2">Variant</th>
                            <th className="text-left px-3 py-2">Supplier</th>
                            <th className="text-left px-3 py-2">Price</th>
                            <th className="text-left px-3 py-2">Currency</th>
                            <th className="text-left px-3 py-2">Avail. Qty</th>
                            <th className="text-left px-3 py-2">Lead (days)</th>
                            <th className="text-left px-3 py-2">Active</th>
                            {!readOnly && <th className="text-right px-3 py-2">Actions</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {offersQ.isLoading && (
                            <tr>
                                <td className="px-3 py-3" colSpan={8}>
                                    Loading offers…
                                </td>
                            </tr>
                        )}
                        {!offersQ.isLoading && Object.keys(grouped).length === 0 && (
                            <tr>
                                <td className="px-3 py-3 text-zinc-500" colSpan={8}>
                                    No supplier offers yet
                                </td>
                            </tr>
                        )}

                        {Object.entries(grouped).map(([key, list]) => (
                            <React.Fragment key={key}>
                                {/* Variant header with total */}
                                <tr className="bg-zinc-50/50">
                                    <td className="px-3 py-2 font-medium" colSpan={8}>
                                        Variant:{" "}
                                        {key === "PRODUCT" ? (
                                            <span className="text-zinc-600">Product-wide</span>
                                        ) : (
                                            variants.find((v) => v.id === key)?.sku || key
                                        )}
                                        <span className="ml-2 inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">
                                            Total available:{" "}
                                            {key === "PRODUCT"
                                                ? variantTotals["PRODUCT"] ?? 0
                                                : totalForVariant(key as any)}
                                        </span>
                                    </td>
                                </tr>

                                {/* Offer rows */}
                                {list.map((o) => {
                                    const isEditingThis = editingId === o.id;
                                    return (
                                        <React.Fragment key={o.id}>
                                            <tr>
                                                <td className="px-3 py-2">
                                                    {o.variantId
                                                        ? variants.find((v) => v.id === o.variantId)?.sku ||
                                                        o.variantId
                                                        : "Product-wide"}
                                                </td>
                                                <td className="px-3 py-2">{o.supplierName || o.supplierId}</td>
                                                <td className="px-3 py-2">{o.price}</td>
                                                <td className="px-3 py-2">{o.currency || "NGN"}</td>
                                                <td className="px-3 py-2">{o.availableQty ?? 0}</td>
                                                <td className="px-3 py-2">{o.leadDays ?? 0}</td>
                                                <td className="px-3 py-2">
                                                    {o.isActive !== false ? (
                                                        <span className="inline-flex items-center gap-1 text-emerald-700">
                                                            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-zinc-500">
                                                            <span className="w-2 h-2 rounded-full bg-zinc-400 inline-block" />
                                                            Inactive
                                                        </span>
                                                    )}
                                                </td>
                                                {!readOnly && (
                                                    <td className="px-3 py-2 text-right">
                                                        <div className="inline-flex gap-2">
                                                            <button
                                                                className="px-2 py-1 rounded border"
                                                                onClick={() =>
                                                                    isEditingThis ? setEditingId(null) : startEdit(o)
                                                                }
                                                            >
                                                                {isEditingThis ? "Close" : "Edit"}
                                                            </button>
                                                            <button
                                                                className="px-2 py-1 rounded bg-rose-600 text-white"
                                                                onClick={() => deleteM.mutate(o.id)}
                                                            >
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>

                                            {/* INLINE EDITOR: expands exactly under the row being edited */}
                                            {!readOnly && isEditingThis && (
                                                <tr className="bg-zinc-50/50">
                                                    <td className="px-3 py-3" colSpan={8}>
                                                        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                                                            {/* Variant picker (shows totals including product-wide) */}
                                                            <div className="md:col-span-2">
                                                                <label className="block text-xs text-zinc-600 mb-1">
                                                                    Variant
                                                                </label>
                                                                <select
                                                                    className="border rounded-lg px-3 py-2 w-full"
                                                                    value={draft.variantId}
                                                                    onChange={(e) =>
                                                                        setDraft((d) => ({
                                                                            ...d,
                                                                            variantId: e.target.value as any,
                                                                        }))
                                                                    }
                                                                    title="Choose Product-wide or a Variant"
                                                                >
                                                                    <option value="PRODUCT">
                                                                        Product-wide ({variantTotals["PRODUCT"] ?? 0})
                                                                    </option>
                                                                    {variants.map((v) => (
                                                                        <option key={v.id} value={v.id}>
                                                                            {v.sku} ({totalForVariant(v.id)})
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {/* Supplier */}
                                                            <div>
                                                                <label className="block text-xs text-zinc-600 mb-1">
                                                                    Supplier
                                                                </label>
                                                                <select
                                                                    className="border rounded-lg px-3 py-2 w-full"
                                                                    value={draft.supplierId}
                                                                    onChange={(e) =>
                                                                        setDraft((d) => ({
                                                                            ...d,
                                                                            supplierId: e.target.value,
                                                                        }))
                                                                    }
                                                                >
                                                                    <option value="">— Supplier —</option>
                                                                    {suppliersQ.data?.map((s) => (
                                                                        <option key={s.id} value={s.id}>
                                                                            {s.name}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {/* Price */}
                                                            <div>
                                                                <label className="block text-xs text-zinc-600 mb-1">
                                                                    Price
                                                                </label>
                                                                <input
                                                                    className="border rounded-lg px-3 py-2 w-full"
                                                                    placeholder="Price"
                                                                    inputMode="decimal"
                                                                    value={draft.price}
                                                                    onChange={(e) =>
                                                                        setDraft((d) => ({ ...d, price: e.target.value }))
                                                                    }
                                                                />
                                                            </div>

                                                            {/* Currency */}
                                                            <div>
                                                                <label className="block text-xs text-zinc-600 mb-1">
                                                                    Currency
                                                                </label>
                                                                <input
                                                                    className="border rounded-lg px-3 py-2 w-full"
                                                                    placeholder="Currency"
                                                                    value={draft.currency}
                                                                    onChange={(e) =>
                                                                        setDraft((d) => ({
                                                                            ...d,
                                                                            currency: e.target.value,
                                                                        }))
                                                                    }
                                                                />
                                                            </div>

                                                            {/* Available Qty */}
                                                            <div>
                                                                <label className="block text-xs text-zinc-600 mb-1">
                                                                    Available Qty
                                                                </label>
                                                                <input
                                                                    className="border rounded-lg px-3 py-2 w-full"
                                                                    placeholder="Available Qty"
                                                                    inputMode="numeric"
                                                                    value={draft.availableQty}
                                                                    onChange={(e) =>
                                                                        setDraft((d) => ({
                                                                            ...d,
                                                                            availableQty: e.target.value,
                                                                        }))
                                                                    }
                                                                />
                                                            </div>

                                                            {/* Lead days */}
                                                            <div>
                                                                <label className="block text-xs text-zinc-600 mb-1">
                                                                    Lead (days)
                                                                </label>
                                                                <input
                                                                    className="border rounded-lg px-3 py-2 w-full"
                                                                    placeholder="Lead days"
                                                                    inputMode="numeric"
                                                                    value={draft.leadDays}
                                                                    onChange={(e) =>
                                                                        setDraft((d) => ({
                                                                            ...d,
                                                                            leadDays: e.target.value,
                                                                        }))
                                                                    }
                                                                />
                                                            </div>

                                                            {/* Active + Actions */}
                                                            <div className="flex items-end justify-between gap-2">
                                                                <label className="inline-flex items-center gap-2 text-sm">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={draft.isActive}
                                                                        onChange={(e) =>
                                                                            setDraft((d) => ({
                                                                                ...d,
                                                                                isActive: e.target.checked,
                                                                            }))
                                                                        }
                                                                    />
                                                                    Active
                                                                </label>
                                                                <div className="ml-auto flex gap-2">
                                                                    <button
                                                                        className="px-3 py-2 rounded-lg border"
                                                                        onClick={() => {
                                                                            setEditingId(null);
                                                                            resetDraft();
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                    <button
                                                                        className="px-3 py-2 rounded-lg bg-zinc-900 text-white"
                                                                        onClick={submitDraft}
                                                                    >
                                                                        Update Offer
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Variant attribute chips (for the currently chosen variant in the editor) */}
                                                        {editedVariantId && (
                                                            <div className="mt-3 rounded-lg border bg-white p-3">
                                                                <div className="text-xs text-zinc-600 mb-2">
                                                                    Variant attributes
                                                                </div>
                                                                {editedVariantMetaQ.isLoading ? (
                                                                    <div className="text-xs text-zinc-500">
                                                                        Loading variant details…
                                                                    </div>
                                                                ) : editedVariantMetaQ.data?.options?.length ? (
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {editedVariantMetaQ.data.options.map((o, idx) => (
                                                                            <span
                                                                                key={idx}
                                                                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-700"
                                                                                title={`${o.attributeName || o.attributeId} = ${o.valueName || o.valueId
                                                                                    }`}
                                                                            >
                                                                                <span className="font-medium">
                                                                                    {o.attributeName || o.attributeId}
                                                                                </span>
                                                                                :
                                                                                <span className="uppercase">
                                                                                    {o.code || o.valueName || o.valueId}
                                                                                </span>
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-xs text-zinc-500">
                                                                        No attributes for this variant (or not available).
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Creator (add a NEW offer) */}
            {!readOnly && (
                <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                    <select
                        className="border rounded-lg px-3 py-2"
                        value={draft.variantId}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, variantId: e.target.value as any }))
                        }
                        title="Choose Product-wide or a Variant"
                    >
                        <option value="PRODUCT">
                            Product-wide ({variantTotals["PRODUCT"] ?? 0})
                        </option>
                        {variants.map((v) => (
                            <option key={v.id} value={v.id}>
                                {v.sku} ({totalForVariant(v.id)})
                            </option>
                        ))}
                    </select>

                    <select
                        className="border rounded-lg px-3 py-2"
                        value={draft.supplierId}
                        onChange={(e) => setDraft((d) => ({ ...d, supplierId: e.target.value }))}
                    >
                        <option value="">— Supplier —</option>
                        {suppliersQ.data?.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>

                    <input
                        className="border rounded-lg px-3 py-2"
                        placeholder="Price"
                        inputMode="decimal"
                        value={draft.price}
                        onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                    />

                    <input
                        className="border rounded-lg px-3 py-2"
                        placeholder="Currency"
                        value={draft.currency}
                        onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
                    />

                    <input
                        className="border rounded-lg px-3 py-2"
                        placeholder="Available Qty"
                        inputMode="numeric"
                        value={draft.availableQty}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, availableQty: e.target.value }))
                        }
                    />

                    <input
                        className="border rounded-lg px-3 py-2"
                        placeholder="Lead days"
                        inputMode="numeric"
                        value={draft.leadDays}
                        onChange={(e) => setDraft((d) => ({ ...d, leadDays: e.target.value }))}
                    />

                    <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={draft.isActive}
                                onChange={(e) =>
                                    setDraft((d) => ({ ...d, isActive: e.target.checked }))
                                }
                            />
                            Active
                        </label>
                        <div className="ml-auto flex gap-2">
                            <button className="px-3 py-2 rounded-lg border" onClick={resetDraft}>
                                Cancel
                            </button>
                            <button
                                className="px-3 py-2 rounded-lg bg-zinc-900 text-white"
                                onClick={submitDraft}
                            >
                                {editingId ? "Update Offer" : "Add Offer"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Optional compact summary */}
            <div className="text-[11px] text-zinc-600">
                <div className="mt-2 font-medium">Availability summary</div>
                <ul className="list-disc pl-5 space-y-0.5">
                    <li>Product-wide: {variantTotals["PRODUCT"] ?? 0}</li>
                    {variants.map((v) => (
                        <li key={v.id}>
                            {v.sku}: {totalForVariant(v.id)} (includes product-wide)
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
