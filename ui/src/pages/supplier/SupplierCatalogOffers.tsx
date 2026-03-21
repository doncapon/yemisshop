import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Search,
  RefreshCcw,
  ChevronDown,
  ChevronUp,
  Pencil,
  Copy,
  Package,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import SupplierLayout from "../../layouts/SupplierLayout";
import SiteLayout from "../../layouts/SiteLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const PAGE_SIZES = [10, 20, 30, 50, 100] as const;

const toNum = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const is401 = (e: any) => Number(e?.response?.status) === 401;

type VariantOptionWire = {
  attributeId: string;
  valueId: string;
  attribute?: { id: string; name: string; type?: string; code?: string | null };
  value?: { id: string; name: string; code?: string | null };
};

type VariantOfferWire = {
  id: string;
  supplierId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  supplierProductOfferId?: string | null;
  unitPrice?: number | null;
  availableQty?: number | null;
  leadDays?: number | null;
  isActive?: boolean;
  inStock?: boolean;
  currency?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type VariantWire = {
  id: string;
  sku?: string | null;
  retailPrice?: number | null;
  availableQty?: number | null;
  inStock?: boolean;
  imagesJson?: string[];
  options?: VariantOptionWire[];
  supplierVariantOffer?: VariantOfferWire | null;
};

type BaseOfferWire = {
  id: string;
  supplierId?: string | null;
  productId?: string | null;
  basePrice?: number | null;
  availableQty?: number | null;
  leadDays?: number | null;
  isActive?: boolean;
  inStock?: boolean;
  currency?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  pendingChangeId?: string | null;
};

type ProductWire = {
  id: string;
  title: string;
  description?: string | null;
  sku?: string;
  retailPrice?: number | null;
  imagesJson?: string[];
  inStock?: boolean;
  availableQty?: number | null;
  status?: string | null;
  brand?: { id: string; name: string } | null;
  supplierId?: string | null;
  offer?: BaseOfferWire | null;
  ProductVariant?: VariantWire[];
};

type CatalogResponse = {
  supplierId: string;
  items: ProductWire[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  skip: number;
  take: number;
};

type AttributeGuideRow = {
  attributeId: string;
  attributeName: string;
  attributeType?: string | null;
  values: Array<{ id: string; name: string; code?: string | null }>;
};

type AttributeTextGuideRow = {
  attributeId: string;
  attributeName: string;
  attributeType?: string | null;
  value: string;
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
    availableQty: toNum(v?.availableQty, 0),
    inStock: v?.inStock !== false,
    imagesJson: Array.isArray(v?.imagesJson) ? v.imagesJson : [],
    supplierVariantOffer: v?.supplierVariantOffer
      ? {
          id: String(v.supplierVariantOffer.id ?? ""),
          supplierId: v.supplierVariantOffer.supplierId ?? null,
          productId: v.supplierVariantOffer.productId ?? null,
          variantId: v.supplierVariantOffer.variantId ?? null,
          supplierProductOfferId: v.supplierVariantOffer.supplierProductOfferId ?? null,
          unitPrice: toNum(v.supplierVariantOffer.unitPrice, 0),
          availableQty: toNum(v.supplierVariantOffer.availableQty, 0),
          leadDays:
            v.supplierVariantOffer.leadDays == null ? null : toNum(v.supplierVariantOffer.leadDays, 0),
          isActive: v.supplierVariantOffer.isActive !== false,
          inStock: v.supplierVariantOffer.inStock !== false,
          currency: v.supplierVariantOffer.currency ?? "NGN",
          createdAt: v.supplierVariantOffer.createdAt ?? null,
          updatedAt: v.supplierVariantOffer.updatedAt ?? null,
        }
      : null,
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
    description: p?.description ?? null,
    sku: p?.sku ?? "",
    retailPrice: pickRetailPrice(p),
    imagesJson: Array.isArray(p?.imagesJson) ? p.imagesJson : [],
    inStock: p?.inStock !== false,
    availableQty: toNum(p?.availableQty, 0),
    status: p?.status ?? null,
    brand: p?.brand ? { id: String(p.brand.id), name: String(p.brand.name) } : null,
    supplierId: p?.supplierId ?? null,
    offer: p?.offer
      ? {
          id: String(p.offer.id ?? ""),
          supplierId: p.offer.supplierId ?? null,
          productId: p.offer.productId ?? null,
          basePrice: toNum(p.offer.basePrice, 0),
          availableQty: toNum(p.offer.availableQty, 0),
          leadDays: p.offer.leadDays == null ? null : toNum(p.offer.leadDays, 0),
          isActive: p.offer.isActive !== false,
          inStock: p.offer.inStock !== false,
          currency: p.offer.currency ?? "NGN",
          createdAt: p.offer.createdAt ?? null,
          updatedAt: p.offer.updatedAt ?? null,
          pendingChangeId: p.offer.pendingChangeId ?? null,
        }
      : null,
    ProductVariant: Array.isArray(p?.ProductVariant) ? p.ProductVariant.map(normalizeVariant) : [],
  };
}

/**
 * Reads product attributes so supplier can inspect the template before copying.
 * IMPORTANT:
 * Backend returns attributeGuide / attributeTextGuide with human-readable names.
 * Raw attributeValues / attributeTexts may only contain IDs.
 */
function ProductAttributesPreview({
  productId,
  enabled,
}: {
  productId: string;
  enabled: boolean;
}) {
  const q = useQuery({
    queryKey: ["supplier-template-product-attributes", productId],
    enabled,
    queryFn: async () => {
      const { data } = await api.get(`/api/supplier/products/${productId}`, {
        withCredentials: true,
      });
      const payload = (data as any)?.data ?? data;
      return payload as {
        attributeGuide?: AttributeGuideRow[];
        attributeTextGuide?: AttributeTextGuideRow[];
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: (fc, e) => !is401(e) && fc < 2,
  });

  const attributeGuide = (q.data?.attributeGuide ?? []) as AttributeGuideRow[];
  const attributeTextGuide = (q.data?.attributeTextGuide ?? []) as AttributeTextGuideRow[];

  if (!enabled) return null;

  return (
    <div className="rounded-2xl border bg-white p-3 sm:p-4">
      <div className="font-semibold text-[13px] sm:text-sm tracking-tight">Attributes</div>
      <div className="text-[11px] text-zinc-500 mt-1">
        Helpful guide to available options you can copy into your own product.
      </div>

      {q.isLoading ? (
        <div className="mt-3 text-sm text-zinc-600">Loading attributes…</div>
      ) : q.isError ? (
        <div className="mt-3 text-sm text-rose-600">
          Failed to load attributes.
          <div className="text-[11px] opacity-70 mt-1">{String((q.error as any)?.message ?? "")}</div>
        </div>
      ) : attributeGuide.length === 0 && attributeTextGuide.length === 0 ? (
        <div className="mt-3 text-sm text-zinc-600">No attribute options found for this product.</div>
      ) : (
        <div className="mt-3 grid gap-3">
          {attributeGuide.map((g) => (
            <div key={g.attributeId} className="grid gap-2">
              <div className="text-[11px] text-zinc-600">{g.attributeName || "Attribute"}</div>
              <div className="flex flex-wrap gap-2">
                {(g.values || []).map((v) => (
                  <span
                    key={`${g.attributeId}:${v.id}`}
                    className="inline-flex items-center px-2 py-1 rounded-full text-[11px] border bg-zinc-50 text-zinc-700 border-zinc-200"
                  >
                    {v.name || v.code || v.id}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {attributeTextGuide.length > 0 && (
            <div className="grid gap-2">
              <div className="text-[11px] text-zinc-600">Text attributes</div>
              <div className="flex flex-wrap gap-2">
                {attributeTextGuide.map((t, idx) => {
                  const aLabel = t.attributeName || t.attributeId || "Attribute";
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

function VariantPreviewList({ variants }: { variants: VariantWire[] }) {
  if (!variants.length) {
    return (
      <div className="rounded-2xl border bg-white p-3 sm:p-4">
        <div className="font-semibold text-[13px] sm:text-sm tracking-tight">Variants</div>
        <div className="mt-3 text-sm text-zinc-600">No variants on this product.</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-zinc-50 p-3 sm:p-4">
      <div className="font-semibold text-[13px] sm:text-sm tracking-tight">Variants</div>
      <div className="text-[11px] text-zinc-500 mt-1">
        Review this product structure before creating your own version.
      </div>

      <div className="mt-3 grid gap-2">
        {variants.map((v) => {
          const label = formatVariantLabel(v);
          const offer = v.supplierVariantOffer;
          const shownQty = offer?.availableQty ?? v.availableQty ?? 0;
          const shownInStock = offer?.inStock ?? v.inStock;
          const shownPrice = offer?.unitPrice ?? v.retailPrice ?? null;

          return (
            <div key={v.id} className="rounded-2xl border bg-white p-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-snug text-zinc-900">
                    {label || `Variant ${v.id}`}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {v.sku ? (
                      <span className="inline-flex items-center rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
                        SKU: {v.sku}
                      </span>
                    ) : null}
                    {shownPrice != null ? (
                      <span className="inline-flex items-center rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
                        Price: {NGN.format(toNum(shownPrice, 0))}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
                      Qty: {toNum(shownQty, 0)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${
                        shownInStock !== false
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-zinc-200 bg-zinc-50 text-zinc-700"
                      }`}
                    >
                      {shownInStock !== false ? "In stock" : "Out of stock"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SupplierCatalogOffers() {
  const navigate = useNavigate();

  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const userId = useAuthStore((s: any) => s.user?.id) as string | undefined;

  React.useEffect(() => {
    useAuthStore.getState().bootstrap().catch(() => null);
  }, []);

  const [q, setQ] = React.useState("");
  const qDebounced = useDebounced(q, 300);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(30);

  React.useEffect(() => {
    setPage(1);
  }, [qDebounced, pageSize]);

  const catalogQ = useQuery({
    queryKey: ["supplier-catalog-template-products", qDebounced, page, pageSize],
    enabled: hydrated,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    placeholderData: keepPreviousData,
    retry: (fc, e) => !is401(e) && fc < 2,
    queryFn: async (): Promise<CatalogResponse> => {
      const { data } = await api.get("/api/supplier/catalog/products", {
        params: { q: qDebounced, page, pageSize },
        withCredentials: true,
      });

      const payload = (data as any)?.data ?? data;
      const items: any[] = Array.isArray(payload?.items) ? payload.items : [];

      return {
        supplierId: String(payload?.supplierId ?? ""),
        items: items.map(normalizeProduct),
        total: toNum(payload?.total, 0),
        page: toNum(payload?.page, page),
        pageSize: toNum(payload?.pageSize, pageSize),
        totalPages: Math.max(1, toNum(payload?.totalPages, 1)),
        hasNextPage: Boolean(payload?.hasNextPage),
        hasPrevPage: Boolean(payload?.hasPrevPage),
        skip: toNum(payload?.skip, 0),
        take: toNum(payload?.take, pageSize),
      };
    },
  });

  React.useEffect(() => {
    if (!hydrated) return;
    catalogQ.refetch().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, userId]);

  const items = catalogQ.data?.items ?? [];
  const total = catalogQ.data?.total ?? 0;
  const currentPage = catalogQ.data?.page ?? page;
  const currentPageSize = catalogQ.data?.pageSize ?? pageSize;
  const totalPages = catalogQ.data?.totalPages ?? 1;
  const hasNextPage = catalogQ.data?.hasNextPage ?? false;
  const hasPrevPage = catalogQ.data?.hasPrevPage ?? false;
  const start = total === 0 ? 0 : (currentPage - 1) * currentPageSize + 1;
  const end = total === 0 ? 0 : Math.min(currentPage * currentPageSize, total);

  const goToCreateFromTemplate = React.useCallback(
    (productId: string) => {
      navigate(`/supplier/products/add?copyFromProductId=${encodeURIComponent(productId)}`);
    },
    [navigate]
  );

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="w-full max-w-none md:max-w-6xl mx-auto px-2 sm:px-4 md:px-6 py-3 sm:py-4 md:py-6 font-sans">
          <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[14px] sm:text-lg md:text-xl font-semibold tracking-tight text-zinc-900">
                  Catalogue Templates
                </h1>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Browse catalogue products and use any item as a template for your own product.
                </div>
                <div className="text-[11px] text-zinc-500 mt-2">
                  Search by title, SKU, variant SKU, attribute, or value.
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

            <div className="mt-3 grid gap-3">
              <div className="relative">
                <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search products / variants…"
                  className="w-full pl-9 pr-3 h-10 rounded-2xl border bg-white text-[13px] focus:outline-none focus:ring-4 focus:ring-fuchsia-200"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-[11px] text-zinc-500">
                  {catalogQ.isLoading
                    ? "Loading catalogue…"
                    : catalogQ.isError
                    ? "Catalogue unavailable"
                    : `${start}–${end} of ${total} product${total === 1 ? "" : "s"}`}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(toNum(e.target.value, 30))}
                    className="rounded-xl border bg-white px-3 py-2 text-[12px]"
                    title="Items per page"
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}/page
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={!hasPrevPage || catalogQ.isFetching}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Prev
                  </button>

                  <div className="text-[12px] text-zinc-600">
                    Page <span className="font-semibold text-zinc-900">{currentPage}</span> /{" "}
                    <span className="font-semibold text-zinc-900">{totalPages}</span>
                  </div>

                  <button
                    type="button"
                    disabled={!hasNextPage || catalogQ.isFetching}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] disabled:opacity-50"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

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
                  <div className="mt-2 text-[11px] text-zinc-600">You may need to login again.</div>
                )}
              </div>
            ) : items.length === 0 ? (
              <div className="mt-4 text-sm text-zinc-600">No products found.</div>
            ) : (
              <div className="mt-4 grid gap-3">
                {items.map((p) => {
                  const img = (p.imagesJson || [])[0] || "/placeholder.svg";
                  const isOpen = !!expanded[p.id];
                  const variants = p.ProductVariant || [];

                  return (
                    <div key={p.id} className="rounded-2xl border bg-white overflow-hidden">
                      <div className="p-3 sm:p-4">
                        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                          <button
                            type="button"
                            onClick={() => goToCreateFromTemplate(p.id)}
                            className="sm:shrink-0 flex sm:block justify-center text-left"
                            title="Use this product as a template"
                          >
                            <div className="w-[88px] h-[88px] sm:w-20 sm:h-20 rounded-2xl border bg-zinc-50 overflow-hidden">
                              <img
                                src={img}
                                alt={p.title}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.opacity = "0.25";
                                }}
                              />
                            </div>
                          </button>

                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => goToCreateFromTemplate(p.id)}
                              className="block text-left w-full"
                              title="Use this product as a template"
                            >
                              <div className="text-[13px] sm:text-[14px] font-semibold leading-snug line-clamp-2 text-zinc-900 hover:text-fuchsia-700 transition-colors">
                                {p.title}
                              </div>
                            </button>

                            <div className="mt-1 text-[11px] text-zinc-500">
                              {p.brand?.name ? <span className="font-medium">{p.brand.name}</span> : null}
                              {p.brand?.name ? <span className="opacity-60"> • </span> : null}
                              SKU: <span className="font-medium">{p.sku || "—"}</span>
                              {p.status ? (
                                <>
                                  <span className="opacity-60"> • </span>
                                  <span className="font-medium">{p.status}</span>
                                </>
                              ) : null}
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[11px] text-fuchsia-800">
                                <Copy className="h-3.5 w-3.5" />
                                <span className="font-semibold">Use as template</span>
                              </span>

                              <span className="inline-flex items-center rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
                                <Package className="h-3.5 w-3.5 mr-1.5" />
                                {variants.length} variant{variants.length === 1 ? "" : "s"}
                              </span>

                              {p.retailPrice != null ? (
                                <span className="inline-flex items-center rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
                                  Retail: {NGN.format(toNum(p.retailPrice, 0))}
                                </span>
                              ) : null}

                              {p.offer?.basePrice != null ? (
                                <span className="inline-flex items-center rounded-full border bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
                                  Offer: {NGN.format(toNum(p.offer.basePrice, 0))}
                                </span>
                              ) : null}

                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${
                                  p.inStock !== false
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-zinc-200 bg-zinc-50 text-zinc-700"
                                }`}
                              >
                                {p.inStock !== false ? "In stock" : "Out of stock"}
                              </span>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                              <button
                                type="button"
                                onClick={() => goToCreateFromTemplate(p.id)}
                                className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white px-3 py-2 text-[12px] whitespace-nowrap"
                                title="Create my own similar product"
                              >
                                <Pencil className="h-4 w-4" />
                                <span>Use This Product</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))}
                                className="inline-flex items-center justify-center gap-2 rounded-full border bg-white hover:bg-zinc-50 px-3 py-2 text-[12px] whitespace-nowrap"
                              >
                                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                <span>{isOpen ? "Hide Details" : "Preview Details"}</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="mt-4 grid gap-4">
                            <div className="rounded-2xl border bg-zinc-50 p-3 sm:p-4">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div>
                                  <div className="font-semibold text-[13px] sm:text-sm tracking-tight">
                                    Template action
                                  </div>
                                  <div className="text-[11px] text-zinc-500 mt-1">
                                    Open Add Product with this product prefilled as a starting point.
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => goToCreateFromTemplate(p.id)}
                                  className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-white px-3 py-2 text-[12px] whitespace-nowrap"
                                >
                                  <Copy className="h-4 w-4" />
                                  Copy Into My Product
                                  <ArrowRight className="h-4 w-4" />
                                </button>
                              </div>
                            </div>

                            <ProductAttributesPreview productId={p.id} enabled={isOpen} />
                            <VariantPreviewList variants={variants} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {totalPages > 1 && (
                  <div className="pt-2 flex items-center justify-end gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={!hasPrevPage || catalogQ.isFetching}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </button>

                    <div className="text-[12px] text-zinc-600">
                      Page <span className="font-semibold text-zinc-900">{currentPage}</span> /{" "}
                      <span className="font-semibold text-zinc-900">{totalPages}</span>
                    </div>

                    <button
                      type="button"
                      disabled={!hasNextPage || catalogQ.isFetching}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}