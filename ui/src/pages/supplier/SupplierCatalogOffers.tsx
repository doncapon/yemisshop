// src/pages/supplier/SupplierCatalogOffers.tsx
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  RefreshCcw,
  PackagePlus,
  Save,
  Trash2,
  ChevronDown,
  ChevronUp,
  Pencil,
} from "lucide-react";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { Link } from "react-router-dom";
import SiteLayout from "../../layouts/SiteLayout";

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const toNum = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const is401 = (e: any) => Number(e?.response?.status) === 401;

type OfferBase = {
  id: string;
  basePrice: number | string;
  availableQty: number;
  leadDays: number | null;
  isActive: boolean;
  inStock: boolean;
  currency?: string;
  updatedAt?: string;
};

type OfferVariant = {
  id: string;
  variantId: string;
  unitPrice: number | string;
  availableQty: number;
  leadDays: number | null;
  isActive: boolean;
  inStock: boolean;
  currency?: string;
  updatedAt?: string;
};

type VariantWire = {
  id: string;
  sku?: string | null;
  retailPrice?: number | null;
  inStock?: boolean;
  imagesJson?: string[];
  options?: Array<{
    attributeId: string;
    valueId: string;
    attribute?: { id: string; name: string; type?: string; code?: string | null };
    value?: { id: string; name: string; code?: string | null };
  }>;
};

type ProductWire = {
  id: string;
  title: string;
  sku?: string;
  retailPrice?: number | null;
  imagesJson?: string[];
  inStock?: boolean;
  brand?: { id: string; name: string } | null;
  supplierId?: string | null;
  ProductVariant?: VariantWire[];
  supplierProductOffers?: OfferBase[];
  supplierVariantOffers?: OfferVariant[];
};

type AttributeValueWire = {
  attributeId: string;
  valueId: string;
  attribute?: { id: string; name: string; type?: string; code?: string | null };
  value?: { id: string; name: string; code?: string | null };
};

type AttributeTextWire = {
  attributeId: string;
  value: string;
  attribute?: { id: string; name: string; type?: string; code?: string | null };
};

function formatVariantLabel(v: VariantWire) {
  const parts =
    (v.options || [])
      .map((o) => `${o.attribute?.name ?? o.attributeId}: ${o.value?.name ?? o.valueId}`)
      .filter(Boolean) || [];
  const sku = v.sku ? `(${v.sku})` : "";
  return `${sku} ${parts.join(" • ")}`.trim();
}

function useDebounced<T>(value: T, ms = 350) {
  const [out, setOut] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

function pickRetailPrice(p: any): number | null {
  const raw = p?.retailPrice ?? p?.price ?? null;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeVariant(v: any): VariantWire {
  return {
    id: String(v?.id ?? ""),
    sku: v?.sku ?? null,
    retailPrice: pickRetailPrice(v),
    inStock: v?.inStock !== false,
    imagesJson: Array.isArray(v?.imagesJson) ? v.imagesJson : [],
    options: Array.isArray(v?.options)
      ? v.options.map((o: any) => ({
          attributeId: String(o?.attributeId ?? ""),
          valueId: String(o?.valueId ?? ""),
          attribute: o?.attribute
            ? {
                id: String(o.attribute.id),
                name: String(o.attribute.name),
                type: o.attribute.type,
                code: o.attribute.code ?? null,
              }
            : undefined,
          value: o?.value
            ? { id: String(o.value.id), name: String(o.value.name), code: o.value.code ?? null }
            : undefined,
        }))
      : [],
  };
}

function normalizeProduct(p: any): ProductWire {
  return {
    id: String(p?.id ?? ""),
    title: String(p?.title ?? ""),
    sku: p?.sku ?? "",
    retailPrice: pickRetailPrice(p),
    imagesJson: Array.isArray(p?.imagesJson) ? p.imagesJson : [],
    inStock: p?.inStock !== false,
    brand: p?.brand ? { id: String(p.brand.id), name: String(p.brand.name) } : null,
    supplierId: p?.supplierId ?? null,
    ProductVariant: Array.isArray(p?.ProductVariant) ? p.ProductVariant.map(normalizeVariant) : [],
    supplierProductOffers: Array.isArray(p?.supplierProductOffers) ? p.supplierProductOffers : [],
    supplierVariantOffers: Array.isArray(p?.supplierVariantOffers) ? p.supplierVariantOffers : [],
  };
}

function calcRetailFromOffer(offerPrice: number, pricingMarkupPercent: string | number | null) {
  const m = Number(pricingMarkupPercent);
  const p = Number(offerPrice);
  const safeM = Number.isFinite(m) ? m : 0;
  const safeP = Number.isFinite(p) ? p : 0;
  const retail = safeP * (1 + safeM / 100);
  return Math.round(retail * 100) / 100;
}

/**
 * ✅ Hook-safe per-product attributes fetcher
 * ✅ COOKIE AUTH: uses withCredentials, no token headers
 */
function ProductAttributesPreview({ productId, enabled }: { productId: string; enabled: boolean }) {
  const q = useQuery({
    queryKey: ["supplier-product-attributes", productId],
    enabled,
    queryFn: async () => {
      const { data } = await api.get(`/api/supplier/products/${productId}`, {
        withCredentials: true,
      });
      const payload = (data as any)?.data ?? data;
      return payload as {
        attributeValues?: AttributeValueWire[];
        attributeTexts?: AttributeTextWire[];
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: (fc, e) => (!is401(e) && fc < 2),
  });

  const attributeValues = (q.data?.attributeValues ?? []) as AttributeValueWire[];
  const attributeTexts = (q.data?.attributeTexts ?? []) as AttributeTextWire[];

  const grouped = React.useMemo(() => {
    const map = new Map<string, { label: string; values: { id: string; label: string }[] }>();

    for (const row of attributeValues) {
      const aLabel = row.attribute?.code || row.attribute?.name || row.attributeId || "Attribute";
      const vLabel = row.value?.code || row.value?.name || row.valueId || "Value";
      const key = String(row.attributeId || aLabel);

      if (!map.has(key)) map.set(key, { label: aLabel, values: [] });
      map.get(key)!.values.push({ id: row.valueId, label: vLabel });
    }

    for (const [k, g] of map.entries()) {
      const seen = new Set<string>();
      g.values = g.values.filter((v) => {
        const kk = `${v.id}:${v.label}`;
        if (seen.has(kk)) return false;
        seen.add(kk);
        return true;
      });
      map.set(k, g);
    }

    return Array.from(map.values());
  }, [attributeValues]);

  if (!enabled) return null;

  return (
    <div className="rounded-2xl border bg-white p-3 sm:p-4">
      <div className="font-semibold text-[13px] sm:text-sm tracking-tight">Attributes</div>
      <div className="text-[11px] text-zinc-500 mt-1">
        Helpful guide to available options (Color, Size, Material, etc).
      </div>

      {q.isLoading ? (
        <div className="mt-3 text-sm text-zinc-600">Loading attributes…</div>
      ) : q.isError ? (
        <div className="mt-3 text-sm text-rose-600">
          Failed to load attributes.
          <div className="text-[11px] opacity-70 mt-1">{String((q.error as any)?.message ?? "")}</div>
        </div>
      ) : grouped.length === 0 && attributeTexts.length === 0 ? (
        <div className="mt-3 text-sm text-zinc-600">No attribute options found for this product.</div>
      ) : (
        <div className="mt-3 grid gap-3">
          {grouped.map((g) => (
            <div key={g.label} className="grid gap-2">
              <div className="text-[11px] text-zinc-600">{g.label}</div>
              <div className="flex flex-wrap gap-2">
                {g.values.map((v) => (
                  <span
                    key={`${g.label}:${v.id}:${v.label}`}
                    className="inline-flex items-center px-2 py-1 rounded-full text-[11px] border bg-zinc-50 text-zinc-700 border-zinc-200"
                  >
                    {v.label}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {attributeTexts.length > 0 && (
            <div className="grid gap-2">
              <div className="text-[11px] text-zinc-600">Text attributes</div>
              <div className="flex flex-wrap gap-2">
                {attributeTexts.map((t, idx) => {
                  const aLabel = t.attribute?.code || t.attribute?.name || t.attributeId || "Attribute";
                  const val = String(t.value ?? "").trim();
                  if (!val) return null;
                  return (
                    <span
                      key={`${t.attributeId}:${idx}`}
                      className="inline-flex items-center px-2 py-1 rounded-full text-[11px] border bg-white text-zinc-700 border-zinc-200"
                    >
                      {aLabel}: {val}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SupplierCatalogOffers() {
  const qc = useQueryClient();

  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const userId = useAuthStore((s: any) => s.user?.id) as string | undefined;

  // ✅ ensure session bootstrap happens even if navbar timing differs
  React.useEffect(() => {
    useAuthStore.getState().bootstrap().catch(() => null);
  }, []);

  const [q, setQ] = React.useState("");
  const qDebounced = useDebounced(q, 300);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const settingsQ = useQuery({
    queryKey: ["public-pricing-settings"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings/public", { withCredentials: true });
      const payload = (data as any)?.data ?? data;
      const mp = toNum(payload?.marginPercent ?? payload?.pricingMarkupPercent ?? 0, 0);
      return { marginPercent: mp };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const pricingMarkupPercent = settingsQ.data?.marginPercent ?? 0;

  /**
   * ✅ Fix “loads only after refresh”
   * Cookie auth does NOT need userId gate.
   * We fetch as soon as the auth store is hydrated; backend session decides.
   */
  const catalogQ = useQuery({
    queryKey: ["supplier-catalog-products", qDebounced],
    enabled: hydrated, // ✅ no userId chicken/egg
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    retry: (fc, e) => (!is401(e) && fc < 2),
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/catalog/products", {
        params: { q: qDebounced, take: 30, skip: 0 },
        withCredentials: true,
      });

      const payload = (data as any)?.data ?? data;
      const items: any[] = payload?.items ?? [];

      return {
        supplierId: String(payload?.supplierId ?? ""),
        items: items.map(normalizeProduct),
      };
    },
  });

  // ✅ when login completes and user appears, force a refetch (prevents “empty until refresh”)
  React.useEffect(() => {
    if (!hydrated) return;
    // If userId flips from undefined -> string, pull immediately
    catalogQ.refetch().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, userId]);

  const invalidateCatalog = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["supplier-catalog-products"], exact: false });
  }, [qc]);

  const upsertBaseM = useMutation({
    mutationFn: async (input: {
      productId: string;
      basePrice: number;
      availableQty: number;
      leadDays: number | null;
      isActive: boolean;
      inStock: boolean;
    }) => {
      const { data } = await api.put("/api/supplier/catalog/offers/base", input, {
        withCredentials: true,
      });
      return (data as any)?.data ?? data;
    },
    onSuccess: invalidateCatalog,
  });

  const deleteBaseM = useMutation({
    mutationFn: async (productId: string) => {
      const { data } = await api.delete(`/api/supplier/catalog/offers/base/${productId}`, {
        withCredentials: true,
      });
      return data;
    },
    onSuccess: invalidateCatalog,
  });

  const upsertVariantM = useMutation({
    mutationFn: async (input: {
      productId: string;
      variantId: string;
      unitPrice: number;
      availableQty: number;
      leadDays: number | null;
      isActive: boolean;
      inStock: boolean;
    }) => {
      const { data } = await api.put("/api/supplier/catalog/offers/variant", input, {
        withCredentials: true,
      });
      return (data as any)?.data ?? data;
    },
    onSuccess: invalidateCatalog,
  });

  const deleteVariantM = useMutation({
    mutationFn: async (offerId: string) => {
      const { data } = await api.delete(`/api/supplier/catalog/offers/variant/${offerId}`, {
        withCredentials: true,
      });
      return data;
    },
    onSuccess: invalidateCatalog,
  });

  const items = catalogQ.data?.items ?? [];

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="w-full max-w-none md:max-w-6xl mx-auto px-2 sm:px-4 md:px-6 py-3 sm:py-4 md:py-6 font-sans">
          <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 md:p-5">
            {/* ✅ smaller, cleaner header on mobile */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[14px] sm:text-lg md:text-xl font-semibold tracking-tight text-zinc-900">
                  Catalogue Offers
                </h1>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Search by title, SKU, variant SKU, attribute/value.
                </div>
                <div className="text-[11px] text-zinc-500 mt-2">
                  Margin:{" "}
                  <span className="font-semibold">
                    {Number.isFinite(pricingMarkupPercent) ? `${pricingMarkupPercent}%` : "0%"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => catalogQ.refetch()}
                className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] whitespace-nowrap"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            {/* ✅ compact search */}
            <div className="mt-3">
              <div className="relative">
                <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search products / variants…"
                  className="w-full pl-9 pr-3 h-10 rounded-2xl border bg-white text-[13px] focus:outline-none focus:ring-4 focus:ring-fuchsia-200"
                />
              </div>
            </div>

            {/* States */}
            {!hydrated ? (
              <div className="mt-4 text-sm text-zinc-600">Loading session…</div>
            ) : catalogQ.isLoading ? (
              <div className="mt-4 text-sm text-zinc-600">Loading catalogue…</div>
            ) : catalogQ.isError ? (
              <div className="mt-4 text-sm text-rose-600">
                Failed to load catalogue.
                <div className="text-[11px] opacity-70 mt-1">
                  {String((catalogQ.error as any)?.message ?? "")}
                </div>
                {is401(catalogQ.error) && (
                  <div className="mt-2 text-[11px] text-zinc-600">
                    You may need to login again.
                  </div>
                )}
              </div>
            ) : items.length === 0 ? (
              <div className="mt-4 text-sm text-zinc-600">No products found.</div>
            ) : (
              <div className="mt-4 grid gap-3">
                {items.map((p) => {
                  const img = (p.imagesJson || [])[0] || "/placeholder.svg";
                  const baseOffer = (p.supplierProductOffers || [])[0] || null;

                  const isOpen = !!expanded[p.id];
                  const variants = p.ProductVariant || [];
                  const vOffers = p.supplierVariantOffers || [];
                  const offerByVariantId = new Map(vOffers.map((o) => [o.variantId, o]));

                  return (
                    <div key={p.id} className="rounded-2xl border bg-white overflow-hidden">
                      <div className="p-3 sm:p-4">
                        {/* ✅ MOBILE: image on top, text below (prevents overlap) */}
                        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="sm:shrink-0 flex sm:block justify-center">
                            <div className="w-[88px] h-[88px] sm:w-20 sm:h-20 rounded-2xl border bg-zinc-50 overflow-hidden">
                              <img
                                src={img}
                                alt={p.title}
                                className="w-full h-full object-cover"
                                onError={(e) => (e.currentTarget.style.opacity = "0.25")}
                              />
                            </div>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] sm:text-[14px] font-semibold leading-snug line-clamp-2 text-zinc-900">
                              {p.title}
                            </div>

                            <div className="mt-1 text-[11px] text-zinc-500">
                              {p.brand?.name ? <span className="font-medium">{p.brand.name}</span> : null}
                              {p.brand?.name ? <span className="opacity-60"> • </span> : null}
                              SKU: <span className="font-medium">{p.sku || "—"}</span>
                            </div>

                            {/* ✅ nicer status row under text */}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {baseOffer ? (
                                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800">
                                  <span className="font-semibold">Offering</span>
                                  <span className="opacity-60">•</span>
                                  <span className="font-medium">{NGN.format(toNum(baseOffer.basePrice, 0))}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
                                  Not offered yet
                                </span>
                              )}
                            </div>

                            {/* ✅ compact actions: two small pills, never overlaps */}
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                              <Link
                                to={`/supplier/products/${p.id}/edit?scope=offers_mine`}
                                className="inline-flex items-center justify-center gap-2 rounded-full border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] whitespace-nowrap"
                                title="Edit this product offers in my store"
                              >
                                <Pencil className="h-4 w-4" />
                                <span>Edit</span>
                              </Link>

                              <button
                                type="button"
                                onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))}
                                className="inline-flex items-center justify-center gap-2 rounded-full border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] whitespace-nowrap"
                              >
                                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                <span>{isOpen ? "Hide" : "Offer"}</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="mt-4 grid gap-4">
                            <ProductAttributesPreview productId={p.id} enabled={isOpen} />

                            <BaseOfferEditor
                              productId={p.id}
                              existing={baseOffer}
                              defaultOfferPrice={toNum(baseOffer?.basePrice, 0) || 0}
                              pricingMarkupPercent={pricingMarkupPercent}
                              onSave={(row) => upsertBaseM.mutate(row)}
                              onDelete={() => deleteBaseM.mutate(p.id)}
                              busy={upsertBaseM.isPending || deleteBaseM.isPending}
                            />

                            <div className="rounded-2xl border bg-zinc-50 p-3 sm:p-4">
                              <div>
                                <div className="font-semibold text-[13px] sm:text-sm tracking-tight">
                                  Variant offers
                                </div>
                                <div className="text-[11px] text-zinc-500 mt-1">
                                  Enter your offer price. Retail is calculated from margin.
                                </div>
                              </div>

                              {variants.length === 0 ? (
                                <div className="mt-3 text-sm text-zinc-600">No variants on this product.</div>
                              ) : (
                                <div className="mt-3 grid gap-2">
                                  {variants.map((v) => {
                                    const existing = offerByVariantId.get(v.id) || null;
                                    return (
                                      <VariantOfferRow
                                        key={v.id}
                                        productId={p.id}
                                        variant={v}
                                        existing={existing}
                                        defaultOfferPrice={toNum(existing?.unitPrice, 0) || 0}
                                        pricingMarkupPercent={pricingMarkupPercent}
                                        canEdit={true}
                                        onSave={(row) => upsertVariantM.mutate(row)}
                                        onDelete={(offerId) => deleteVariantM.mutate(offerId)}
                                        busy={upsertVariantM.isPending || deleteVariantM.isPending}
                                      />
                                    );
                                  })}
                                </div>
                              )}

                              {(upsertVariantM.error || deleteVariantM.error) && (
                                <div className="mt-2 text-[11px] text-rose-700">
                                  {String(
                                    (upsertVariantM.error as any)?.response?.data?.error ||
                                      (deleteVariantM.error as any)?.response?.data?.error ||
                                      (upsertVariantM.error as any)?.message ||
                                      (deleteVariantM.error as any)?.message ||
                                      "Error"
                                  )}
                                </div>
                              )}
                            </div>

                            {(upsertBaseM.error || deleteBaseM.error) && (
                              <div className="text-[11px] text-rose-700">
                                {String(
                                  (upsertBaseM.error as any)?.response?.data?.error ||
                                    (deleteBaseM.error as any)?.response?.data?.error ||
                                    (upsertBaseM.error as any)?.message ||
                                    (deleteBaseM.error as any)?.message ||
                                    "Error"
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}

function BaseOfferEditor({
  productId,
  existing,
  defaultOfferPrice,
  pricingMarkupPercent,
  onSave,
  onDelete,
  busy,
}: {
  productId: string;
  existing: OfferBase | null;
  defaultOfferPrice: number;
  pricingMarkupPercent: number | string | null;
  onSave: (row: {
    productId: string;
    basePrice: number;
    availableQty: number;
    leadDays: number | null;
    isActive: boolean;
    inStock: boolean;
  }) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [offerPrice, setOfferPrice] = React.useState(() => toNum(existing?.basePrice, defaultOfferPrice));
  const [availableQty, setAvailableQty] = React.useState(() => toNum(existing?.availableQty, 0));
  const [leadDays, setLeadDays] = React.useState<number | null>(() => existing?.leadDays ?? null);
  const [isActive, setIsActive] = React.useState(() => (existing ? !!existing.isActive : true));
  const [inStock, setInStock] = React.useState(() => (existing ? !!existing.inStock : true));

  React.useEffect(() => {
    setOfferPrice(toNum(existing?.basePrice, defaultOfferPrice));
    setAvailableQty(toNum(existing?.availableQty, 0));
    setLeadDays(existing?.leadDays ?? null);
    setIsActive(existing ? !!existing.isActive : true);
    setInStock(existing ? !!existing.inStock : true);
  }, [existing?.id, defaultOfferPrice]);

  const calcRetail = calcRetailFromOffer(toNum(offerPrice, 0), pricingMarkupPercent);

  return (
    <div className="rounded-2xl border bg-white p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="font-semibold text-[13px] sm:text-sm tracking-tight">Base offer</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Enter your offer price; retail is calculated from margin.
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {existing ? (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="inline-flex items-center justify-center gap-2 rounded-full border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] disabled:opacity-60 whitespace-nowrap"
              title="Remove base offer"
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          ) : (
            <span className="text-[11px] text-zinc-500 inline-flex items-center gap-2">
              <PackagePlus className="h-4 w-4" />
              Optional: create a base offer
            </span>
          )}

          <button
            type="button"
            disabled={busy || toNum(offerPrice, 0) <= 0}
            onClick={() =>
              onSave({
                productId,
                basePrice: Math.max(0, toNum(offerPrice, 0)),
                availableQty: Math.max(0, Math.floor(toNum(availableQty, 0))),
                leadDays: leadDays == null ? null : Math.max(0, Math.floor(toNum(leadDays, 0))),
                isActive,
                inStock,
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white px-3 py-2 text-[12px] disabled:opacity-60 whitespace-nowrap"
          >
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Offer price (NGN)</span>
          <input
            value={String(offerPrice)}
            onChange={(e) => setOfferPrice(toNum(e.target.value, 0))}
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-white"
            inputMode="decimal"
          />
        </label>

        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Retail price (calc)</span>
          <input
            value={toNum(offerPrice, 0) > 0 ? String(calcRetail) : ""}
            readOnly
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-zinc-50 text-zinc-700"
            inputMode="decimal"
          />
        </label>

        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Available qty</span>
          <input
            value={String(availableQty)}
            onChange={(e) => setAvailableQty(toNum(e.target.value, 0))}
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-white"
            inputMode="numeric"
          />
        </label>

        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Lead days</span>
          <input
            value={leadDays == null ? "" : String(leadDays)}
            onChange={(e) => setLeadDays(e.target.value.trim() ? toNum(e.target.value, 0) : null)}
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-white"
            inputMode="numeric"
            placeholder="e.g. 2"
          />
        </label>

        <label className="flex items-center gap-2 rounded-2xl border px-3 h-10 bg-white whitespace-nowrap">
          <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />
          <span className="text-[13px]">In stock</span>
        </label>

        <label className="flex items-center gap-2 rounded-2xl border px-3 h-10 bg-white whitespace-nowrap">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span className="text-[13px]">Active</span>
        </label>
      </div>

      <div className="mt-2 text-[11px] text-zinc-600">
        Preview retail:{" "}
        <span className="font-semibold">{toNum(offerPrice, 0) > 0 ? NGN.format(calcRetail) : NGN.format(0)}</span>
        <span className="opacity-60"> • margin {pricingMarkupPercent}%</span>
      </div>
    </div>
  );
}

function VariantOfferRow({
  productId,
  variant,
  existing,
  defaultOfferPrice,
  pricingMarkupPercent,
  canEdit,
  onSave,
  onDelete,
  busy,
}: {
  productId: string;
  variant: VariantWire;
  existing: OfferVariant | null;
  defaultOfferPrice: number;
  pricingMarkupPercent: number;
  canEdit: boolean;
  onSave: (row: {
    productId: string;
    variantId: string;
    unitPrice: number;
    availableQty: number;
    leadDays: number | null;
    isActive: boolean;
    inStock: boolean;
  }) => void;
  onDelete: (offerId: string) => void;
  busy: boolean;
}) {
  const [offerPrice, setOfferPrice] = React.useState(() => toNum(existing?.unitPrice, defaultOfferPrice));
  const [availableQty, setAvailableQty] = React.useState(() => toNum(existing?.availableQty, 0));
  const [leadDays, setLeadDays] = React.useState<number | null>(() => existing?.leadDays ?? null);
  const [isActive, setIsActive] = React.useState(() => (existing ? !!existing.isActive : true));
  const [inStock, setInStock] = React.useState(() => (existing ? !!existing.inStock : true));

  React.useEffect(() => {
    setOfferPrice(toNum(existing?.unitPrice, defaultOfferPrice));
    setAvailableQty(toNum(existing?.availableQty, 0));
    setLeadDays(existing?.leadDays ?? null);
    setIsActive(existing ? !!existing.isActive : true);
    setInStock(existing ? !!existing.inStock : true);
  }, [existing?.id, defaultOfferPrice]);

  const label = formatVariantLabel(variant);
  const saveDisabled = busy || !canEdit || toNum(offerPrice, 0) <= 0;
  const retailCalc = calcRetailFromOffer(toNum(offerPrice, 0), pricingMarkupPercent);

  return (
    <div className="rounded-2xl border bg-white p-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-snug line-clamp-2 text-zinc-900">
            {label || `Variant ${variant.id}`}
          </div>

          {existing ? (
            <div className="mt-2 inline-flex items-center text-[11px] px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
              Offering
            </div>
          ) : (
            <div className="mt-2 inline-flex items-center text-[11px] px-2.5 py-1 rounded-full border bg-zinc-50 text-zinc-700">
              Not offered
            </div>
          )}
        </div>

        <div className="shrink-0 grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
          {existing ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(existing.id)}
              className="inline-flex items-center justify-center gap-2 rounded-full border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] disabled:opacity-60 whitespace-nowrap"
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}

          <button
            type="button"
            disabled={saveDisabled}
            onClick={() =>
              onSave({
                productId,
                variantId: variant.id,
                unitPrice: Math.max(0, toNum(offerPrice, 0)),
                availableQty: Math.max(0, Math.floor(toNum(availableQty, 0))),
                leadDays: leadDays == null ? null : Math.max(0, Math.floor(toNum(leadDays, 0))),
                isActive,
                inStock,
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-white px-3 py-2 text-[12px] disabled:opacity-60 whitespace-nowrap"
          >
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Offer price (NGN)</span>
          <input
            value={String(offerPrice)}
            onChange={(e) => setOfferPrice(toNum(e.target.value, 0))}
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-white"
            inputMode="decimal"
            disabled={!canEdit}
          />
        </label>

        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Retail price (calc)</span>
          <input
            value={toNum(offerPrice, 0) > 0 ? String(retailCalc) : ""}
            readOnly
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-zinc-50 text-zinc-700"
          />
        </label>

        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Available qty</span>
          <input
            value={String(availableQty)}
            onChange={(e) => setAvailableQty(toNum(e.target.value, 0))}
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-white"
            inputMode="numeric"
            disabled={!canEdit}
          />
        </label>

        <label className="grid gap-1 min-w-0">
          <span className="text-[11px] text-zinc-600">Lead days</span>
          <input
            value={leadDays == null ? "" : String(leadDays)}
            onChange={(e) => setLeadDays(e.target.value.trim() ? toNum(e.target.value, 0) : null)}
            className="w-full h-10 rounded-2xl border px-3 text-[13px] bg-white"
            inputMode="numeric"
            placeholder="e.g. 2"
            disabled={!canEdit}
          />
        </label>

        <label className="flex items-center gap-2 rounded-2xl border px-3 h-10 bg-white whitespace-nowrap">
          <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} disabled={!canEdit} />
          <span className="text-[13px]">In stock</span>
        </label>

        <label className="flex items-center gap-2 rounded-2xl border px-3 h-10 bg-white whitespace-nowrap">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={!canEdit} />
          <span className="text-[13px]">Active</span>
        </label>
      </div>

      <div className="mt-2 text-[11px] text-zinc-600">
        Preview retail:{" "}
        <span className="font-semibold">{toNum(offerPrice, 0) > 0 ? NGN.format(retailCalc) : NGN.format(0)}</span>
        <span className="opacity-60"> • margin {pricingMarkupPercent}%</span>
      </div>
    </div>
  );
}
