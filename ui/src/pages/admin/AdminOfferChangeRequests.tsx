import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  RefreshCcw,
  Search,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta } from "../../hooks/useCatalogMeta";

type ChangeItem = {
  id: string;
  requestType: "OFFER" | "PRODUCT";
  status: "PENDING" | "APPROVED" | "REJECTED" | string;
  scope?: "BASE_OFFER" | "VARIANT_OFFER" | "PRODUCT" | string;
  supplierId: string;
  productId: string;
  variantId?: string | null;
  proposedPatch: any;
  currentSnapshot?: any;
  requestedAt?: string;
  supplier?: { id: string; name?: string | null };
  product?: { id: string; title?: string | null; sku?: string | null };
};

type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isFinite(+d) ? d.toLocaleString() : s;
}

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const status = e?.response?.status;
  return status === 401 || status === 403;
}

function getRequestPatch(x: any) {
  return x?.proposedPatch ?? x?.patchJson ?? x?.proposed_patch ?? {};
}

function getRequestSnapshot(x: any) {
  return (
    x?.currentSnapshot ??
    x?.current_snapshot ??
    x?.snapshotJson ??
    x?.currentValues ??
    {}
  );
}

function deepMap(value: any, fn: (node: any) => any): any {
  const mapped = fn(value);

  if (Array.isArray(mapped)) {
    return mapped.map((item) => deepMap(item, fn));
  }

  if (mapped && typeof mapped === "object") {
    return Object.fromEntries(
      Object.entries(mapped).map(([k, v]) => [k, deepMap(v, fn)])
    );
  }

  return mapped;
}

function getMetaAttributes(meta: any): any[] {
  if (Array.isArray(meta?.attributes)) return meta.attributes;
  if (Array.isArray(meta?.catalogAttributes)) return meta.catalogAttributes;
  if (Array.isArray(meta?.data?.attributes)) return meta.data.attributes;
  if (Array.isArray(meta?.data?.catalogAttributes)) return meta.data.catalogAttributes;
  return [];
}

function getAttributeValues(attr: any): any[] {
  if (Array.isArray(attr?.values)) return attr.values;
  if (Array.isArray(attr?.attributeValues)) return attr.attributeValues;
  if (Array.isArray(attr?.options)) return attr.options;
  if (Array.isArray(attr?.items)) return attr.items;
  return [];
}

function formatValueLabel(meta?: {
  name?: string | null;
  code?: string | null;
}) {
  if (!meta) return undefined;
  const name = String(meta.name ?? "").trim();
  const code = String(meta.code ?? "").trim();

  if (name && code && code.toLowerCase() !== name.toLowerCase()) {
    return `${name} (${code})`;
  }
  return name || code || undefined;
}

function prettifyAttributeSelections(
  input: any,
  attributeNameById: Map<string, string>,
  valueMetaById: Map<string, { name?: string | null; code?: string | null; attributeId?: string | null }>
) {
  if (!Array.isArray(input)) return input;

  return input.map((row: any) => {
    const attributeId = String(row?.attributeId ?? "").trim();
    const valueId = String(row?.valueId ?? "").trim();

    const valueIds = Array.isArray(row?.valueIds)
      ? row.valueIds.map((v: any) => String(v)).filter(Boolean)
      : [];

    const attributeName =
      row?.attributeName ??
      (attributeId ? attributeNameById.get(attributeId) ?? attributeId : undefined);

    const valueMeta = valueId ? valueMetaById.get(valueId) : undefined;
    const valueName =
      row?.valueName ??
      formatValueLabel(valueMeta) ??
      (valueId || undefined);

    const valueNames =
      valueIds.length > 0
        ? valueIds.map((id: any) => {
            const meta = valueMetaById.get(String(id));
            return formatValueLabel(meta) ?? String(id);
          })
        : undefined;

    return {
      ...row,
      ...(attributeId ? { attributeId } : {}),
      ...(attributeName ? { attributeName } : {}),
      ...(valueId ? { valueId } : {}),
      ...(valueName ? { valueName } : {}),
      ...(valueIds.length ? { valueIds } : {}),
      ...(valueNames?.length ? { valueNames } : {}),
    };
  });
}

function prettifyVariantOptions(
  input: any,
  attributeNameById: Map<string, string>,
  valueMetaById: Map<string, { name?: string | null; code?: string | null; attributeId?: string | null }>
) {
  if (!Array.isArray(input)) return input;

  return input.map((row: any) => {
    const attributeId = String(
      row?.attributeId ??
        row?.attribute?.id ??
        row?.attributeValue?.attributeId ??
        row?.value?.attributeId ??
        ""
    ).trim();

    const valueId = String(
      row?.valueId ??
        row?.attributeValueId ??
        row?.attributeValue?.id ??
        row?.value?.id ??
        ""
    ).trim();

    const attributeName =
      row?.attributeName ??
      row?.attribute?.name ??
      (attributeId ? attributeNameById.get(attributeId) ?? attributeId : undefined);

    const valueMeta = valueId ? valueMetaById.get(valueId) : undefined;
    const valueName =
      row?.valueName ??
      row?.value?.name ??
      row?.attributeValue?.name ??
      formatValueLabel(valueMeta) ??
      (valueId || undefined);

    return {
      ...row,
      ...(attributeId ? { attributeId } : {}),
      ...(attributeName ? { attributeName } : {}),
      ...(valueId ? { valueId } : {}),
      ...(valueName ? { valueName } : {}),
    };
  });
}

function prettifySingleIdPair(
  node: any,
  attributeNameById: Map<string, string>,
  valueMetaById: Map<string, { name?: string | null; code?: string | null; attributeId?: string | null }>
) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;

  const attributeId = String(node?.attributeId ?? "").trim();
  const valueId = String(node?.valueId ?? "").trim();

  if (!attributeId && !valueId) return node;

  const next = { ...node };

  if (attributeId && !next.attributeName) {
    next.attributeName = attributeNameById.get(attributeId) ?? attributeId;
  }

  if (valueId && !next.valueName) {
    next.valueName = formatValueLabel(valueMetaById.get(valueId)) ?? valueId;
  }

  return next;
}

function prettifyPayload(
  payload: any,
  attributeNameById: Map<string, string>,
  valueMetaById: Map<string, { name?: string | null; code?: string | null; attributeId?: string | null }>
) {
  return deepMap(payload, (node) => {
    if (!node || typeof node !== "object") return node;

    if (Array.isArray(node?.attributeSelections)) {
      return {
        ...node,
        attributeSelections: prettifyAttributeSelections(
          node.attributeSelections,
          attributeNameById,
          valueMetaById
        ),
      };
    }

    if (Array.isArray(node?.options)) {
      return {
        ...node,
        options: prettifyVariantOptions(
          node.options,
          attributeNameById,
          valueMetaById
        ),
      };
    }

    if (Array.isArray(node?.variantOptions)) {
      return {
        ...node,
        variantOptions: prettifyVariantOptions(
          node.variantOptions,
          attributeNameById,
          valueMetaById
        ),
      };
    }

    if (Array.isArray(node?.VariantOptions)) {
      return {
        ...node,
        VariantOptions: prettifyVariantOptions(
          node.VariantOptions,
          attributeNameById,
          valueMetaById
        ),
      };
    }

    if (Array.isArray(node?.attributes)) {
      return {
        ...node,
        attributes: prettifyVariantOptions(
          node.attributes,
          attributeNameById,
          valueMetaById
        ),
      };
    }

    if (Array.isArray(node?.optionSelections)) {
      return {
        ...node,
        optionSelections: prettifyVariantOptions(
          node.optionSelections,
          attributeNameById,
          valueMetaById
        ),
      };
    }

    return prettifySingleIdPair(node, attributeNameById, valueMetaById);
  });
}

function summarizeAttributeSelections(input: any) {
  if (!Array.isArray(input) || input.length === 0) return "";

  return input
    .map((row: any) => {
      const a = String(
        row?.attributeName ??
          row?.attribute ??
          row?.attributeId ??
          ""
      ).trim();

      const single = String(
        row?.valueName ??
          row?.value ??
          row?.valueId ??
          ""
      ).trim();

      const multi = Array.isArray(row?.valueNames)
        ? row.valueNames.map((x: any) => String(x)).filter(Boolean)
        : Array.isArray(row?.valueIds)
          ? row.valueIds.map((x: any) => String(x)).filter(Boolean)
          : [];

      const text = String(row?.text ?? "").trim();

      if (multi.length) return `${a}: ${multi.join(", ")}`;
      if (single) return `${a}: ${single}`;
      if (text) return `${a}: ${text}`;
      return a;
    })
    .filter(Boolean)
    .join(" • ");
}

function summarizePatch(patch: any) {
  if (!patch || typeof patch !== "object") return "";

  const bits: string[] = [];

  const attrSummary = summarizeAttributeSelections(patch.attributeSelections);
  if (attrSummary) bits.push(attrSummary);

  if (patch.description) bits.push("Description updated");
  if (patch.categoryId) bits.push("Category changed");
  if (patch.brandId) bits.push("Brand changed");

  if (Array.isArray(patch.variants) && patch.variants.length) {
    bits.push(`${patch.variants.length} variant change(s)`);
  }

  if (patch.basePrice != null) bits.push(`Base price: ${patch.basePrice}`);
  if (patch.unitPrice != null) bits.push(`Unit price: ${patch.unitPrice}`);
  if (patch.leadDays != null) bits.push(`Lead days: ${patch.leadDays}`);
  if (patch.isActive != null) bits.push(`Active: ${patch.isActive ? "Yes" : "No"}`);

  return bits.join(" • ");
}

function toPositiveInt(value: any, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v > 0 ? v : fallback;
}

function extractItems(root: any): any[] {
  if (Array.isArray(root?.data)) return root.data;
  if (Array.isArray(root?.items)) return root.items;
  if (Array.isArray(root?.data?.items)) return root.data.items;
  if (Array.isArray(root?.rows)) return root.rows;
  if (Array.isArray(root)) return root;
  return [];
}

function extractPaginated<T = any>(root: any, fallbackPage: number, fallbackPageSize: number): PaginatedResult<T> {
  const items = extractItems(root) as T[];

  const totalRaw =
    root?.total ??
    root?.data?.total ??
    root?.count ??
    root?.data?.count;

  const pageRaw =
    root?.page ??
    root?.data?.page;

  const pageSizeRaw =
    root?.pageSize ??
    root?.data?.pageSize;

  const totalPagesRaw =
    root?.totalPages ??
    root?.data?.totalPages;

  const total = Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : items.length;
  const page = toPositiveInt(pageRaw, fallbackPage);
  const pageSize = toPositiveInt(pageSizeRaw, fallbackPageSize);
  const totalPages =
    Number.isFinite(Number(totalPagesRaw))
      ? Math.max(1, Number(totalPagesRaw))
      : Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export default function AdminOfferChangeRequests() {
  const qc = useQueryClient();
  useAuthStore((s) => s.user);

  const [tab, setTab] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const meQ = useQuery({
    queryKey: ["me-min"],
    queryFn: async () =>
      (await api.get("/api/profile/me", AXIOS_COOKIE_CFG)).data as {
        role?: string;
        id?: string;
      },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const authReady = meQ.isSuccess || meQ.isError;
  const queriesEnabled = authReady && !(meQ.isError && isAuthError(meQ.error));

  const catalogMeta = useCatalogMeta({ enabled: queriesEnabled }) as any;
  const attributes = useMemo(() => getMetaAttributes(catalogMeta), [catalogMeta]);

  const attributeNameById = useMemo(() => {
    const m = new Map<string, string>();

    for (const a of attributes) {
      const attributeId = String(a?.id ?? "").trim();
      if (!attributeId) continue;
      m.set(attributeId, String(a?.name ?? attributeId));
    }

    return m;
  }, [attributes]);

  const valueMetaById = useMemo(() => {
    const m = new Map<
      string,
      { name?: string | null; code?: string | null; attributeId?: string | null }
    >();

    for (const a of attributes) {
      const attributeId = String(a?.id ?? "").trim() || null;
      const values = getAttributeValues(a);

      for (const v of values) {
        const valueId = String(v?.id ?? "").trim();
        if (!valueId) continue;

        m.set(valueId, {
          name: v?.name ?? null,
          code: v?.code ?? null,
          attributeId: String(v?.attributeId ?? attributeId ?? "").trim() || null,
        });
      }
    }

    return m;
  }, [attributes]);

  const listQ = useQuery({
    queryKey: ["admin", "change-requests", tab, page, pageSize],
    enabled: queriesEnabled,
    queryFn: async () => {
      const qs = new URLSearchParams({
        status: tab,
        page: String(page),
        pageSize: String(pageSize),
      }).toString();

      const [offerRes, productRes] = await Promise.all([
        api.get(`/api/admin/offer-change-requests?${qs}`, AXIOS_COOKIE_CFG),
        api.get(`/api/admin/product-change-requests?${qs}`, AXIOS_COOKIE_CFG),
      ]);

      const offerRoot = (offerRes as any)?.data;
      const productRoot = (productRes as any)?.data;

      const offerPaged = extractPaginated<any>(offerRoot, page, pageSize);
      const productPaged = extractPaginated<any>(productRoot, page, pageSize);

      const offerItems = offerPaged.items.map((x: any) => ({
        ...x,
        requestType: "OFFER" as const,
      }));

      const productItems = productPaged.items.map((x: any) => ({
        ...x,
        requestType: "PRODUCT" as const,
        scope: "PRODUCT",
        variantId: null,
      }));

      const merged = [...offerItems, ...productItems].sort((a, b) => {
        const ta = new Date(a?.requestedAt ?? 0).getTime();
        const tb = new Date(b?.requestedAt ?? 0).getTime();
        return tb - ta;
      }) as ChangeItem[];

      const mergedTotal =
        (offerPaged.total || 0) + (productPaged.total || 0);

      const mergedTotalPages = Math.max(
        offerPaged.totalPages || 1,
        productPaged.totalPages || 1,
        Math.ceil(mergedTotal / Math.max(1, pageSize))
      );

      return {
        items: merged,
        total: mergedTotal,
        page,
        pageSize,
        totalPages: mergedTotalPages,
        offerTotal: offerPaged.total,
        productTotal: productPaged.total,
      };
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const filtered = useMemo(() => {
    const items = listQ.data?.items ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return items;

    return items.filter((x) => {
      const prettyPatch = prettifyPayload(
        getRequestPatch(x),
        attributeNameById,
        valueMetaById
      );

      const prettySnapshot = prettifyPayload(
        getRequestSnapshot(x),
        attributeNameById,
        valueMetaById
      );

      const hay = [
        x?.supplier?.name,
        x?.product?.title,
        x?.product?.sku,
        x?.scope,
        x?.requestType,
        x?.status,
        x?.variantId,
        JSON.stringify(prettyPatch ?? {}),
        JSON.stringify(prettySnapshot ?? {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(term);
    });
  }, [listQ.data?.items, q, attributeNameById, valueMetaById]);

  const approveM = useMutation({
    mutationFn: async ({
      id,
      requestType,
    }: {
      id: string;
      requestType: "OFFER" | "PRODUCT";
    }) => {
      const url =
        requestType === "PRODUCT"
          ? `/api/admin/product-change-requests/${id}/approve`
          : `/api/admin/offer-change-requests/${id}/approve`;

      const res = await api.post(url, {}, AXIOS_COOKIE_CFG);
      return (res as any)?.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "change-requests"] });
      qc.invalidateQueries({ queryKey: ["admin", "offer-change-requests"] });
      qc.invalidateQueries({ queryKey: ["admin", "product-change-requests"] });
    },
  });

  const rejectM = useMutation({
    mutationFn: async ({
      id,
      reason,
      requestType,
    }: {
      id: string;
      reason?: string;
      requestType: "OFFER" | "PRODUCT";
    }) => {
      const url =
        requestType === "PRODUCT"
          ? `/api/admin/product-change-requests/${id}/reject`
          : `/api/admin/offer-change-requests/${id}/reject`;

      const res = await api.post(
        url,
        { reason: reason || "Rejected by admin" },
        AXIOS_COOKIE_CFG
      );
      return (res as any)?.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "change-requests"] });
      qc.invalidateQueries({ queryKey: ["admin", "offer-change-requests"] });
      qc.invalidateQueries({ queryKey: ["admin", "product-change-requests"] });
    },
  });

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const authErr =
    authReady && meQ.isError && isAuthError(meQ.error)
      ? "You’re not signed in (or your session expired). Please login again."
      : null;

  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, listQ.data?.totalPages ?? 1);

  return (
    <SiteLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Offer change approvals
            </h1>
            <p className="text-sm text-zinc-600 mt-1">
              Approve or reject supplier changes (price / lead-days / active
              status). Stock changes are applied immediately.
            </p>
          </div>

          <button
            type="button"
            onClick={() => listQ.refetch()}
            disabled={!queriesEnabled}
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
          >
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>

        {authErr && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {authErr}
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="inline-flex rounded-2xl border bg-white overflow-hidden">
            {(["PENDING", "APPROVED", "REJECTED"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setPage(1);
                  setExpanded(new Set());
                }}
                className={`px-4 py-2 text-sm font-semibold ${
                  tab === t
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-800 hover:bg-black/5"
                }`}
                disabled={!queriesEnabled}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 relative">
            <Search className="absolute left-3 top-2.5 text-zinc-400" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search supplier, product, SKU, patch…"
              className="w-full rounded-2xl border bg-white pl-9 pr-3 py-2 text-sm"
              disabled={!queriesEnabled}
            />
          </div>
        </div>

        {!authErr && (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-2xl border bg-white p-3">
            <div className="text-sm text-zinc-600">
              <span className="font-semibold text-zinc-900">{total}</span> total request(s)
              {q.trim() ? (
                <>
                  {" "}
                  • <span className="font-semibold text-zinc-900">{filtered.length}</span> shown after search
                </>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={!queriesEnabled || page <= 1 || listQ.isFetching}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              >
                <ChevronsLeft size={16} />
                First
              </button>

              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!queriesEnabled || page <= 1 || listQ.isFetching}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              >
                Prev
              </button>

              <div className="text-sm text-zinc-700 px-2">
                Page <span className="font-semibold text-zinc-900">{page}</span> of{" "}
                <span className="font-semibold text-zinc-900">{totalPages}</span>
              </div>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={!queriesEnabled || page >= totalPages || listQ.isFetching}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              >
                Next
              </button>

              <button
                type="button"
                onClick={() => setPage(totalPages)}
                disabled={!queriesEnabled || page >= totalPages || listQ.isFetching}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              >
                Last
                <ChevronsRight size={16} />
              </button>
            </div>
          </div>
        )}

        {!authErr && listQ.isLoading && (
          <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">
            Loading…
          </div>
        )}

        {!authErr && listQ.isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Failed to load approvals.
          </div>
        )}

        {!authErr && !listQ.isLoading && filtered.length === 0 && (
          <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">
            No items.
          </div>
        )}

        <div className="space-y-3">
          {!authErr &&
            filtered.map((x) => {
              const isOpen = expanded.has(x.id);
              const supplierName = x?.supplier?.name ?? x.supplierId;
              const productTitle = x?.product?.title ?? x.productId;
              const sku = x?.product?.sku ?? "—";

              const prettyProposedPatch = prettifyPayload(
                getRequestPatch(x),
                attributeNameById,
                valueMetaById
              );

              const prettyCurrentSnapshot = prettifyPayload(
                getRequestSnapshot(x),
                attributeNameById,
                valueMetaById
              );

              const scopeLabel =
                x.requestType === "OFFER"
                  ? x.scope === "BASE_OFFER"
                    ? "Base offer"
                    : x.scope === "VARIANT_OFFER"
                      ? "Variant offer"
                      : "Offer"
                  : "Product";

              return (
                <div
                  key={x.id}
                  className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden"
                >
                  <div className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-zinc-900">
                        {productTitle}{" "}
                        <span className="text-zinc-400 font-normal">({sku})</span>
                      </div>

                      <div className="text-xs text-zinc-600 mt-1">
                        Supplier: <b className="text-zinc-900">{supplierName}</b> • Type:{" "}
                        <b className="text-zinc-900">{x.requestType}</b> • Scope:{" "}
                        <b className="text-zinc-900">{scopeLabel}</b>
                        {x.variantId ? (
                          <>
                            {" "}
                            • Variant: <b className="text-zinc-900">{x.variantId}</b>
                          </>
                        ) : null}{" "}
                        • Requested: <b className="text-zinc-900">{fmtDate(x.requestedAt)}</b>
                      </div>

                      <div className="text-xs text-zinc-700 mt-2">
                        <span className="text-zinc-500">Change summary:</span>{" "}
                        <span className="break-words">
                          {summarizePatch(prettyProposedPatch) || "View details"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(x.id)}
                        className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
                      >
                        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        Details
                      </button>

                      {tab === "PENDING" && (
                        <>
                          <button
                            type="button"
                            disabled={approveM.isPending || rejectM.isPending}
                            onClick={() =>
                              approveM.mutate({ id: x.id, requestType: x.requestType })
                            }
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
                          >
                            <CheckCircle2 size={16} /> Approve
                          </button>

                          <button
                            type="button"
                            disabled={approveM.isPending || rejectM.isPending}
                            onClick={() => {
                              const input = window.prompt("Reason for rejection (optional):");
                              if (input === null) return;

                              const reason = input.trim() || "Rejected by admin";

                              rejectM.mutate({
                                id: x.id,
                                reason,
                                requestType: x.requestType,
                              });
                            }}
                            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
                          >
                            <XCircle size={16} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t bg-zinc-50 p-4 text-xs text-zinc-800 space-y-2">
                      <div className="font-semibold text-zinc-900">Current snapshot</div>
                      <pre className="rounded-xl border bg-white p-3 overflow-auto">
                        {JSON.stringify(prettyCurrentSnapshot ?? {}, null, 2)}
                      </pre>

                      <div className="font-semibold text-zinc-900 mt-3">Proposed patch</div>
                      <pre className="rounded-xl border bg-white p-3 overflow-auto">
                        {JSON.stringify(prettyProposedPatch ?? {}, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {!authErr && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={!queriesEnabled || page <= 1 || listQ.isFetching}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              <ChevronsLeft size={16} />
              First
            </button>

            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!queriesEnabled || page <= 1 || listQ.isFetching}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              Prev
            </button>

            <div className="text-sm text-zinc-700 px-3">
              Page <span className="font-semibold text-zinc-900">{page}</span> of{" "}
              <span className="font-semibold text-zinc-900">{totalPages}</span>
            </div>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={!queriesEnabled || page >= totalPages || listQ.isFetching}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              Next
            </button>

            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={!queriesEnabled || page >= totalPages || listQ.isFetching}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              Last
              <ChevronsRight size={16} />
            </button>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}