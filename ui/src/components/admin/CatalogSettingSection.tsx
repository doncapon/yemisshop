import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AdminProductAttributes from "./AdminProductAttributes";
import { VariantsSection } from "./VariantSection";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useModal } from "../ModalProvider";
import React from "react";
import api from "../../api/client";
import StatusDot from "../StatusDot";
import { useAuthStore } from "../../store/auth";
import { AttributeForm } from "./AttributeForm";




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

type SupplierFormValues = {
    name: string;
    type: 'PHYSICAL' | 'ONLINE';
    status?: string;
    contactEmail?: string | null;
    whatsappPhone?: string | null;

    apiBaseUrl?: string | null;
    apiAuthType?: 'NONE' | 'BEARER' | 'BASIC' | '' | null;
    apiKey?: string | null;

    payoutMethod?: 'SPLIT' | 'TRANSFER' | '' | null;
    bankCountry?: string | null;   // e.g. "NG"
    bankCode?: string | null;      // bank sort code
    bankName?: string | null;      // bank display name
    accountNumber?: string | null; // long field
    accountName?: string | null;   // long field
    isPayoutEnabled?: boolean | null;
};




/* ---------------- Small, typing-safe form components ---------------- */
function CategoryForm({
    onCreate,
    categories,
}: {
    onCreate: (payload: { name: string; slug: string; parentId: string | null; isActive: boolean }) => void;
    categories: Array<{ id: string; name: string }>;
}) {
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [parentId, setParentId] = useState<string | null>(null);
    const [isActive, setIsActive] = useState(true);

    const submit = useCallback(() => {
        if (!name.trim() || !slug.trim()) return;
        onCreate({ name: name.trim(), slug: slug.trim(), parentId, isActive });
        setName('');
        setSlug('');
        setParentId(null);
        setIsActive(true);
    }, [name, slug, parentId, isActive, onCreate]);

    return (
        <div className="mb-3 grid grid-cols-2 gap-2">
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="border rounded-lg px-3 py-2" />
            <input placeholder="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="border rounded-lg px-3 py-2" />
            <select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)} className="border rounded-lg px-3 py-2 col-span-2">
                <option value="">No parent</option>
                {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Active</span>
            </label>
            <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
                Add
            </button>
        </div>
    );
}


function BrandForm({ onCreate }: { onCreate: (payload: { name: string; slug: string; logoUrl?: string; isActive: boolean }) => void }) {
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [logoUrl, setLogoUrl] = useState('');
    const [isActive, setIsActive] = useState(true);

    const submit = useCallback(() => {
        if (!name.trim() || !slug.trim()) return;
        onCreate({ name: name.trim(), slug: slug.trim(), logoUrl: logoUrl.trim() || undefined, isActive });
        setName('');
        setSlug('');
        setLogoUrl('');
        setIsActive(true);
    }, [name, slug, logoUrl, isActive, onCreate]);

    return (
        <div className="mb-3 grid grid-cols-2 gap-2">
            <input placeholder="Name" className="border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="Slug" className="border rounded-lg px-3 py-2" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <input placeholder="Logo URL (optional)" className="border rounded-lg px-3 py-2 col-span-2" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Active</span>
            </label>
            <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
                Add
            </button>
        </div>
    );
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


type BankOption = { country: string; code: string; name: string };

const FALLBACK_BANKS: BankOption[] = [
    { country: 'NG', code: '044', name: 'Access Bank' },
    { country: 'NG', code: '011', name: 'First Bank of Nigeria' },
    { country: 'NG', code: '058', name: 'Guaranty Trust Bank' },
    { country: 'NG', code: '221', name: 'Stanbic IBTC Bank' },
    { country: 'NG', code: '232', name: 'Sterling Bank' },
    { country: 'NG', code: '033', name: 'United Bank for Africa' },
    { country: 'NG', code: '035', name: 'Wema Bank' },
];

function SupplierForm({
    editing,
    onCancelEdit,
    onCreate,
    onUpdate,
}: {
    editing: AdminSupplier | null;
    onCancelEdit: () => void;
    onCreate: (payload: SupplierFormValues) => void;
    onUpdate: (payload: SupplierFormValues & { id: string }) => void;
}) {
    const { token } = useAuthStore();

    // One source of truth for banks (uses admin list, falls back locally)
    const banksQ = useQuery({
        queryKey: ['admin', 'banks'],
        queryFn: async () => {
            const { data } = await api.get<{ data: BankOption[] }>('/api/admin/banks', {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            return Array.isArray(data?.data) && data.data.length > 0 ? data.data : FALLBACK_BANKS;
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
    const banks = banksQ.data ?? FALLBACK_BANKS;

    const [values, setValues] = useState<SupplierFormValues>({
        name: '',
        type: 'PHYSICAL',
        status: 'ACTIVE',
        contactEmail: '',
        whatsappPhone: '',
        apiBaseUrl: '',
        apiAuthType: 'NONE',
        apiKey: '',

        payoutMethod: '',
        bankCountry: 'NG',
        bankCode: '',
        bankName: '',
        accountNumber: '',
        accountName: '',
        isPayoutEnabled: false,
    });

    // Hydrate when editing
    useEffect(() => {
        if (!editing) return;
        setValues({
            name: editing.name ?? '',
            type: editing.type ?? 'PHYSICAL',
            status: editing.status ?? 'ACTIVE',
            contactEmail: editing.contactEmail ?? '',
            whatsappPhone: editing.whatsappPhone ?? '',
            apiBaseUrl: editing.apiBaseUrl ?? '',
            apiAuthType: editing.apiAuthType ?? 'NONE',
            apiKey: editing.apiKey ?? '',

            payoutMethod: editing.payoutMethod ?? '',
            bankCountry: editing.bankCountry ?? 'NG',
            bankCode: editing.bankCode ?? '',
            bankName: editing.bankName ?? '',
            accountNumber: editing.accountNumber ?? '',
            accountName: editing.accountName ?? '',
            isPayoutEnabled: !!editing.isPayoutEnabled,
        });
    }, [editing]);

    // Filter banks by selected country
    const countryBanks = useMemo(
        () => banks.filter((b) => (values.bankCountry || 'NG') === b.country),
        [banks, values.bankCountry]
    );

    // Keep Bank Name <-> Bank Code in sync
    function setBankByName(name: string) {
        const match = countryBanks.find((b) => b.name === name);
        setValues((v) => ({
            ...v,
            bankName: name || '',
            bankCode: match?.code || '',
        }));
    }
    function setBankByCode(code: string) {
        const match = countryBanks.find((b) => b.code === code);
        setValues((v) => ({
            ...v,
            bankCode: code || '',
            bankName: match?.name || '',
        }));
    }

    function submit() {
        if (!values.name.trim()) {
            alert('Supplier name is required');
            return;
        }
        if (editing) onUpdate({ id: editing.id, ...values });
        else onCreate(values);
    }

    return (
        <div className="rounded-2xl border bg-white/95 p-4 md:p-6 mb-4 w-full">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-ink font-semibold">{editing ? 'Edit Supplier' : 'Add Supplier'}</h4>
                {editing && (
                    <button className="text-sm text-zinc-600 hover:underline" onClick={onCancelEdit}>
                        Cancel edit
                    </button>
                )}
            </div>

            {/* 12-col grid; long fields span 8 on md+ */}
            <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Name</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.name}
                        onChange={(e) => setValues({ ...values, name: e.target.value })}
                        placeholder="Supplier name"
                    />
                </div>

                <div className="col-span-6 md:col-span-3">
                    <label className="block text-xs text-ink-soft mb-1">Type</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.type}
                        onChange={(e) => setValues({ ...values, type: e.target.value as any })}
                    >
                        <option value="PHYSICAL">PHYSICAL</option>
                        <option value="ONLINE">ONLINE</option>
                    </select>
                </div>

                <div className="col-span-6 md:col-span-3">
                    <label className="block text-xs text-ink-soft mb-1">Status</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.status || 'ACTIVE'}
                        onChange={(e) => setValues({ ...values, status: e.target.value })}
                    >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                    </select>
                </div>

                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Contact Email</label>
                    <input
                        type="email"
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.contactEmail ?? ''}
                        onChange={(e) => setValues({ ...values, contactEmail: e.target.value })}
                        placeholder="e.g. vendors@company.com"
                    />
                </div>

                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">WhatsApp Phone</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.whatsappPhone ?? ''}
                        onChange={(e) => setValues({ ...values, whatsappPhone: e.target.value })}
                        placeholder="+2348xxxxxxxxx"
                    />
                </div>
                {/* API credentials */}
                {values.type === 'ONLINE' &&
                    (<>
                        <div className="col-span-12 md:col-span-4">
                            <label className="block text-xs text-ink-soft mb-1">API Base URL</label>
                            <input
                                className="w-full border rounded-lg px-3 py-2"
                                value={values.apiBaseUrl ?? ''}
                                onChange={(e) => setValues({ ...values, apiBaseUrl: e.target.value })}
                                placeholder="https://api.supplier.com"
                            />
                        </div>
                        <div className="col-span-6 md:col-span-4">
                            <label className="block text-xs text-ink-soft mb-1">API Auth Type</label>
                            <select
                                className="w-full border rounded-lg px-3 py-2"
                                value={values.apiAuthType ?? 'NONE'}
                                onChange={(e) => setValues({ ...values, apiAuthType: e.target.value as any })}
                            >
                                <option value="NONE">NONE</option>
                                <option value="BEARER">BEARER</option>
                                <option value="BASIC">BASIC</option>
                            </select>
                        </div>
                        <div className="col-span-6 md:col-span-4">
                            <label className="block text-xs text-ink-soft mb-1">API Key / Token</label>
                            <input
                                className="w-full border rounded-lg px-3 py-2"
                                value={values.apiKey ?? ''}
                                onChange={(e) => setValues({ ...values, apiKey: e.target.value })}
                                placeholder="••••••••••••"
                            />
                        </div>
                    </>)
                }
                {/* Payout & Bank info */}
                <div className="col-span-6 md:col-span-4">
                    <label className="block text-xs text-ink-soft mb-1">Payout Method</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.payoutMethod ?? ''}
                        onChange={(e) => setValues({ ...values, payoutMethod: (e.target.value || '') as any })}
                    >
                        <option value="">—</option>
                        <option value="TRANSFER">TRANSFER</option>
                        <option value="SPLIT">SPLIT</option>
                    </select>
                </div>

                <div className="col-span-6 md:col-span-4">
                    <label className="block text-xs text-ink-soft mb-1">Bank Country</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.bankCountry ?? 'NG'}
                        onChange={(e) =>
                            setValues((v: any) => ({
                                ...v,
                                bankCountry: e.target.value || 'NG',
                                bankCode: '',
                                bankName: '',
                            }))
                        }
                    >
                        <option value="NG">Nigeria (NG)</option>
                    </select>
                </div>

                <div className="col-span-12 md:col-span-4 flex items-end">
                    <div className="text-xs text-zinc-500">
                        {banksQ.isFetching ? 'Loading banks…' : ''}
                    </div>
                </div>

                {/* Bank Name dropdown */}
                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Bank Name</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.bankName ?? ''}
                        onChange={(e) => setBankByName(e.target.value)}
                    >
                        <option value="">Select bank…</option>
                        {countryBanks.map((b) => (
                            <option key={`${b.country}-${b.code}`} value={b.name}>
                                {b.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Bank Code dropdown (kept in sync with name) */}
                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Bank Code</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.bankCode ?? ''}
                        onChange={(e) => setBankByCode(e.target.value)}
                    >
                        <option value="">Select bank…</option>
                        {countryBanks.map((b) => (
                            <option key={`${b.country}-${b.code}`} value={b.code}>
                                {b.code} — {b.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Long fields (twice wider) */}
                <div className="col-span-12 md:col-span-8">
                    <label className="block text-xs text-ink-soft mb-1">Account Number</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.accountNumber ?? ''}
                        onChange={(e) => setValues({ ...values, accountNumber: e.target.value })}
                        placeholder="0123456789"
                        inputMode="numeric"
                    />
                </div>

                <div className="col-span-12 md:col-span-8">
                    <label className="block text-xs text-ink-soft mb-1">Account Name</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.accountName ?? ''}
                        onChange={(e) => setValues({ ...values, accountName: e.target.value })}
                        placeholder="e.g. ACME DISTRIBUTION LTD"
                    />
                </div>

                <div className="col-span-12 md:col-span-4 flex items-end">
                    <label className="inline-flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={!!values.isPayoutEnabled}
                            onChange={(e) => setValues({ ...values, isPayoutEnabled: e.target.checked })}
                        />
                        Enable payouts for this supplier
                    </label>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 justify-end">
                {editing && (
                    <button className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5" onClick={onCancelEdit}>
                        Cancel
                    </button>
                )}
                <button
                    className="px-3 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90"
                    onClick={submit}
                >
                    {editing ? 'Update Supplier' : 'Add Supplier'}
                </button>
            </div>
        </div>
    );
}

type AdminAttribute = any;


export function CatalogSettingsSection(props: {
    token?: string | null;
    canEdit: boolean;
    categoriesQ: any;
    brandsQ: any;
    attributesQ: any;
    usageQ: any;
    createCategory: any;
    updateCategory: any;
    deleteCategory: any;
    createBrand: any;
    updateBrand: any;
    deleteBrand: any;
    createAttribute: any;
    updateAttribute: any;
    deleteAttribute: any;
    createAttrValue: any;
    updateAttrValue: any;
    deleteAttrValue: any;
    /* Suppliers */
    suppliersQ: any;
    createSupplier: any;
    updateSupplier: any;
    deleteSupplier: any;
}) {
    const {
        canEdit,
        categoriesQ,
        brandsQ,
        attributesQ,
        usageQ,
        createCategory,
        updateCategory,
        deleteCategory,
        createBrand,
        updateBrand,
        deleteBrand,
        createAttribute,
        updateAttribute,
        deleteAttribute,
        createAttrValue,
        updateAttrValue,
        deleteAttrValue,
        suppliersQ,
        createSupplier,
        updateSupplier,
        deleteSupplier,
    } = props;

    const categoryUsage: Record<string, number> = usageQ.data?.categories || {};
    const attributeUsage: Record<string, number> = usageQ.data?.attributes || {};
    const brandUsage: Record<string, number> = usageQ.data?.brands || {};

    const [editingSupplier, setEditingSupplier] = useState<AdminSupplier | null>(null);

    const qc = useQueryClient();
    const { openModal } = useModal();

    function SectionCard({
        title,
        subtitle,
        right,
        children,
    }: {
        title: string;
        subtitle?: string;
        right?: ReactNode;
        children: ReactNode;
    }) {
        return (
            <div className="rounded-2xl border bg-white shadow-sm overflow-visible">
                <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
                    <div>
                        <h3 className="text-ink font-semibold">{title}</h3>
                        {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
                    </div>
                    {right}
                </div>
                <div className="p-4 md:p-5">{children}</div>
            </div>
        );
    }

    // --- focus/anchor guards (stop global hotkeys + # anchors) ---
    const stopHashNav = (evt: React.SyntheticEvent) => {
        const el = (evt.target as HTMLElement)?.closest?.('a[href="#"],a[href=""]');
        if (el) {
            evt.preventDefault();
            evt.stopPropagation();
        }
    };
    const stopKeyBubblingFromInputs = (e: React.KeyboardEvent) => {
        const t = e.target as HTMLElement;
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            e.stopPropagation(); // don’t let globals grab it
        }
    };

    // --- isolated, memoized mini-adder: prevents remount/focus loss ---
    const AttributeValueAdder = React.memo(function AttributeValueAdder({
        attributeId,
        onCreate,
    }: {
        attributeId: string;
        onCreate: (vars: { attributeId: string; name: string; code?: string }) => void;
    }) {
        const [name, setName] = useState('');
        const [code, setCode] = useState('');

        const submit = () => {
            const n = name.trim();
            if (!n) return;
            onCreate({ attributeId, name: n, code: code.trim() || undefined });
            setName('');
            setCode('');
        };

        return (
            <div
                role="form"
                className="grid grid-cols-3 gap-2"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    // let typing flow; only capture Enter and stop bubbling of all keys
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submit();
                    }
                }}
            >
                <input
                    type="text"
                    autoComplete="off"
                    placeholder="Value name"
                    className="border rounded-lg px-3 py-2 col-span-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <input
                    type="text"
                    autoComplete="off"
                    placeholder="Code (optional)"
                    className="border rounded-lg px-3 py-2"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                />
                <div className="col-span-3 justify-self-end">
                    <button type="button" onClick={submit} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">
                        Add value
                    </button>
                </div>
            </div>
        );
    });

    return (
        <div
            className="grid grid-cols-1 xl:grid-cols-3 gap-6"
            onClickCapture={stopHashNav}
            onMouseDownCapture={stopHashNav}
            onKeyDownCapture={stopKeyBubblingFromInputs}
        >
            {/* Categories */}
            <SectionCard
                title="Categories"
                subtitle="Organize your catalog hierarchy"
                right={
                    <button
                        type="button"
                        onClick={async () => {
                            try {
                                await api.post('/api/admin/catalog/backfill');
                                qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
                                qc.invalidateQueries({ queryKey: ['admin', 'brands'] });
                                qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
                                qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'usage'] });
                            } catch (e: any) {
                                openModal({ title: 'Backfill', message: e?.response?.data?.error || 'Failed to backfill' });
                            }
                        }}
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
                    >
                        Backfill & Relink
                    </button>
                }
            >
                {canEdit && (
                    <CategoryForm categories={categoriesQ.data ?? []} onCreate={(payload) => createCategory.mutate(payload)} />
                )}

                <div className="border rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Slug</th>
                                <th className="text-left px-3 py-2">Parent</th>
                                <th className="text-left px-3 py-2">In use</th>
                                <th className="text-right px-3 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {(categoriesQ.data ?? []).map((c: AdminCategory) => {
                                const used = categoryUsage[c.id] || 0;
                                return (
                                    <tr key={c.id}>
                                        <td className="px-3 py-2">{c.name}</td>
                                        <td className="px-3 py-2">{c.slug}</td>
                                        <td className="px-3 py-2">
                                            {(categoriesQ.data ?? []).find((x: AdminCategory) => x.id === c.parentId)?.name || '—'}
                                        </td>
                                        <td className="px-3 py-2">{used}</td>
                                        <td className="px-3 py-2 text-right">
                                            {canEdit && (
                                                <div className="inline-flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateCategory.mutate({ id: c.id, isActive: !c.isActive })}
                                                        className="px-2 py-1 rounded border"
                                                    >
                                                        {c.isActive ? 'Disable' : 'Enable'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => used === 0 && deleteCategory.mutate(c.id)}
                                                        className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                                                            }`}
                                                        disabled={used > 0}
                                                        title={used > 0 ? 'Cannot delete: category is in use' : 'Delete category'}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {(categoriesQ.data ?? []).length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                                        No categories
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {/* Brands */}
            <SectionCard title="Brands" subtitle="Manage brand metadata">
                {canEdit && <BrandForm onCreate={(payload) => createBrand.mutate(payload)} />}
                <div className="border rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Slug</th>
                                <th className="text-left px-3 py-2">Active</th>
                                <th className="text-left px-3 py-2">In use</th>
                                <th className="text-right px-3 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {(brandsQ.data ?? []).map((b: AdminBrand) => {
                                const used = brandUsage[b.id] || 0;
                                return (
                                    <tr key={b.id}>
                                        <td className="px-3 py-2">{b.name}</td>
                                        <td className="px-3 py-2">{b.slug}</td>
                                        <td className="px-3 py-2">
                                            <StatusDot label={b.isActive ? 'ACTIVE' : 'INACTIVE'} />
                                        </td>
                                        <td className="px-3 py-2">{used}</td>
                                        <td className="px-3 py-2 text-right">
                                            {canEdit && (
                                                <div className="inline-flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateBrand.mutate({ id: b.id, isActive: !b.isActive })}
                                                        className="px-2 py-1 rounded border"
                                                    >
                                                        {b.isActive ? 'Disable' : 'Enable'}
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => used === 0 && deleteBrand.mutate(b.id)}
                                                        className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                                                            }`}
                                                        disabled={used > 0}
                                                        title={used > 0 ? 'Cannot delete: brand is in use' : 'Delete brand'}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {(brandsQ.data ?? []).length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                                        No brands
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {/* Suppliers */}
            <SectionCard title="Suppliers" subtitle="Manage suppliers available to assign to products">
                {canEdit && (
                    <SupplierForm
                        editing={editingSupplier}
                        onCancelEdit={() => setEditingSupplier(null)}
                        onCreate={(payload) =>
                            createSupplier.mutate(payload, {
                                onSuccess: () => setEditingSupplier(null),
                            })
                        }
                        onUpdate={(payload: any) =>
                            updateSupplier.mutate(payload, {
                                onSuccess: () => setEditingSupplier(null),
                            })
                        }
                    />
                )}
                <div className="border rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Type</th>
                                <th className="text-left px-3 py-2">Status</th>
                                <th className="text-right px-3 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {(suppliersQ.data ?? []).map((s: AdminSupplier) => (
                                <tr key={s.id}>
                                    <td className="px-3 py-2">{s.name}</td>
                                    <td className="px-3 py-2">{s.type}</td>
                                    <td className="px-3 py-2">
                                        <StatusDot label={s.status || 'INACTIVE'} />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {canEdit && (
                                            <div className="inline-flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        updateSupplier.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
                                                    }
                                                    className="px-2 py-1 rounded border"
                                                >
                                                    {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingSupplier(s)}
                                                    className="px-2 py-1 rounded border"
                                                    title="Edit supplier"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => deleteSupplier.mutate(s.id)}
                                                    className="px-2 py-1 rounded bg-rose-600 text-white"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {(suppliersQ.data ?? []).length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                                        No suppliers
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {/* Attributes & Values */}
            <SectionCard title="Attributes" subtitle="Define attribute schema & options">
                {canEdit && <AttributeForm onCreate={(payload) => createAttribute.mutate(payload)} />}

                <div className="grid gap-3">
                    {(attributesQ.data ?? []).map((a: AdminAttribute) => {
                        const used = attributeUsage[a.id] || 0;

                        return (
                            <div key={a.id} className="border rounded-xl">
                                <div className="flex items-center justify-between px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="font-medium">
                                            {a.name} <span className="text-xs text-zinc-500">({a.type})</span>
                                        </div>
                                        <div className="text-xs flex items-center gap-2">
                                            <StatusDot label={a.isActive ? 'ACTIVE' : 'INACTIVE'} />
                                            <span className="text-zinc-500">In use: {used}</span>
                                        </div>
                                    </div>
                                    {canEdit && (
                                        <div className="inline-flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => updateAttribute.mutate({ id: a.id, isActive: !a.isActive })}
                                                className="px-2 py-1 rounded border"
                                            >
                                                {a.isActive ? 'Disable' : 'Enable'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => used === 0 && deleteAttribute.mutate(a.id)}
                                                className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                                                    }`}
                                                disabled={used > 0}
                                                title={used > 0 ? 'Cannot delete: attribute is in use' : 'Delete attribute'}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Values */}
                                <div className="border-t p-3">
                                    <div className="text-xs text-ink-soft mb-2">Values</div>

                                    {(a.values ?? []).length === 0 && (
                                        <div className="text-xs text-zinc-500 mb-2">No values</div>
                                    )}

                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {(a.values ?? []).map((v: { id: React.Key | null | undefined; name: string | number | bigint | boolean | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<ReactNode> | React.ReactPortal | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | null | undefined; isActive: any; }) => (
                                            <div key={v.id} className="px-2 py-1 rounded border bg-white inline-flex items-center gap-2">
                                                <span className="text-sm">{v.name}</span>
                                                {canEdit && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className="text-xs underline"
                                                            onClick={() =>
                                                                updateAttrValue.mutate({ attributeId: a.id, id: v.id, isActive: !v.isActive })
                                                            }
                                                        >
                                                            {v.isActive ? 'Disable' : 'Enable'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="text-xs text-rose-600 underline"
                                                            onClick={() => deleteAttrValue.mutate({ attributeId: a.id, id: v.id })}
                                                        >
                                                            Delete
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {canEdit && (
                                        <AttributeValueAdder
                                            attributeId={a.id}
                                            onCreate={(vars) =>
                                                createAttrValue.mutate(vars, {
                                                    onSuccess: () =>
                                                        qc.invalidateQueries({ queryKey: ['admin', 'attributes'] }),
                                                })
                                            }
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {(attributesQ.data ?? []).length === 0 && (
                        <div className="text-center text-zinc-500 text-sm py-4">No attributes</div>
                    )}
                </div>

                {/* Product ↔ attributes linking UI + Variants manager row */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
                    <div className="xl:col-span-3">
                        <AdminProductAttributes />
                    </div>
                </div>
            </SectionCard>

            {/* Variants Section */}
            <VariantsSection />
        </div>
    );
}