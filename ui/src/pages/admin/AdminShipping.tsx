// src/pages/admin/AdminShipping.tsx
import React, { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

type Zone = {
  id: string;
  code: string;
  name: string;
  country: string;
  statesJson?: string[];
  lgasJson?: string[];
  priority: number;
  isActive: boolean;
};

type PlatformRate = {
  id: string;
  zoneId: string;
  zone?: { id: string; code: string; name: string };
  serviceLevel: string;
  parcelClass: string;
  minWeightGrams: number;
  maxWeightGrams: number | null;
  baseFee: any;
  perKgFee: any;
  remoteSurcharge: any;
  fuelSurcharge: any;
  handlingFee: any;
  currency: string;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  isActive: boolean;
};

type RouteRate = {
  id: string;
  originZoneCode: string;
  destinationZoneCode: string;
  serviceLevel: string;
  parcelClass: string;
  minWeightGrams: number;
  maxWeightGrams: number | null;
  baseFee: any;
  perKgFee: any;
  remoteSurcharge: any;
  fuelSurcharge: any;
  handlingFee: any;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  isActive: boolean;
};

type SupplierProfile = {
  id: string;
  name: string;
  status: string;
  shippingProfileMode: string;
  defaultServiceLevel: string | null;
  handlingFee: any;
  shippingProfile?: {
    id: string;
    originZoneCode: string | null;
    fulfillmentMode: string;
    preferredCarrier: string | null;
    localFlatFee: any;
    nearbyFlatFee: any;
    nationwideBaseFee: any;
    defaultHandlingFee: any;
    isActive: boolean;
  } | null;
};

type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
};

type PaginationState = {
  page: number;
  pageSize: number;
};

type PaginationMeta = {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

const SERVICE_LEVELS = ["STANDARD", "EXPRESS", "PICKUP_POINT", "SAME_DAY"];
const PARCEL_CLASSES = ["STANDARD", "FRAGILE", "BULKY"];
const PROFILE_MODES = ["DEFAULT_PLATFORM", "SUPPLIER_OVERRIDDEN", "MANUAL_QUOTE"];
const FULFILLMENT_MODES = [
  "SUPPLIER_SELF_SHIP",
  "COURIER_DROPOFF",
  "PLATFORM_LABEL",
  "MANUAL_QUOTE",
];

const DEFAULT_PAGE_SIZE = 20;
const ZONE_OPTIONS_PAGE_SIZE = 100;

const num = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function normalizePaginated<T>(
  payload: PaginatedResponse<T> | undefined,
  fallback: PaginationState
): { rows: T[]; meta: PaginationMeta } {
  const rows = Array.isArray(payload?.data) ? payload!.data : [];
  const total = Number.isFinite(payload?.total) ? Number(payload!.total) : rows.length;
  const page = Number.isFinite(payload?.page) ? Number(payload!.page) : fallback.page;
  const pageSize = Number.isFinite(payload?.pageSize)
    ? Number(payload!.pageSize)
    : fallback.pageSize;
  const pageCount = Math.max(
    1,
    Number.isFinite(payload?.pageCount)
      ? Number(payload!.pageCount)
      : Math.ceil(total / Math.max(1, pageSize))
  );

  return {
    rows,
    meta: {
      total,
      page,
      pageSize,
      pageCount,
      hasNextPage:
        typeof payload?.hasNextPage === "boolean" ? payload.hasNextPage : page < pageCount,
      hasPrevPage:
        typeof payload?.hasPrevPage === "boolean" ? payload.hasPrevPage : page > 1,
    },
  };
}

function rangeStart(meta: PaginationMeta) {
  if (meta.total <= 0) return 0;
  return (meta.page - 1) * meta.pageSize + 1;
}

function rangeEnd(meta: PaginationMeta) {
  if (meta.total <= 0) return 0;
  return Math.min(meta.page * meta.pageSize, meta.total);
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-200 ${props.className || ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-200 ${props.className || ""}`}
    />
  );
}

function Button({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-2 text-sm font-medium transition ${className}`}
    >
      {children}
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">{children}</div>;
}

function TablePagination({
  meta,
  onPageChange,
  onPageSizeChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {meta.total > 0
          ? `Showing ${rangeStart(meta)}–${rangeEnd(meta)} of ${meta.total}`
          : "No results"}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(meta.pageSize)}
          onChange={(e) => onPageSizeChange(Number(e.target.value) || DEFAULT_PAGE_SIZE)}
          className="w-[110px]"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </Select>

        <Button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={!meta.hasPrevPage}
          className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          First
        </Button>
        <Button
          type="button"
          onClick={() => onPageChange(meta.page - 1)}
          disabled={!meta.hasPrevPage}
          className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev
        </Button>

        <div className="px-2">
          Page <span className="font-semibold">{meta.page}</span> of{" "}
          <span className="font-semibold">{meta.pageCount}</span>
        </div>

        <Button
          type="button"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={!meta.hasNextPage}
          className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </Button>
        <Button
          type="button"
          onClick={() => onPageChange(meta.pageCount)}
          disabled={!meta.hasNextPage}
          className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Last
        </Button>
      </div>
    </div>
  );
}

export default function AdminShipping() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"zones" | "platform" | "routes" | "suppliers">("zones");
  const [error, setError] = useState<string | null>(null);

  const [zonesPagination, setZonesPagination] = useState<PaginationState>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [platformPagination, setPlatformPagination] = useState<PaginationState>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [routesPagination, setRoutesPagination] = useState<PaginationState>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [suppliersPagination, setSuppliersPagination] = useState<PaginationState>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const zonesQ = useQuery({
    queryKey: ["admin-shipping-zones", zonesPagination.page, zonesPagination.pageSize],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<Zone>>("/api/admin/shipping/zones", {
        ...AXIOS_COOKIE_CFG,
        params: {
          page: zonesPagination.page,
          pageSize: zonesPagination.pageSize,
        },
      });
      return data;
    },
    placeholderData: keepPreviousData,
    enabled: tab === "zones",
  });

  const zonesOptionsQ = useQuery({
    queryKey: ["admin-shipping-zones-options"],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<Zone>>("/api/admin/shipping/zones", {
        ...AXIOS_COOKIE_CFG,
        params: { page: 1, pageSize: ZONE_OPTIONS_PAGE_SIZE },
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  const platformRatesQ = useQuery({
    queryKey: ["admin-shipping-platform-rates", platformPagination.page, platformPagination.pageSize],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<PlatformRate>>(
        "/api/admin/shipping/platform-rates",
        {
          ...AXIOS_COOKIE_CFG,
          params: {
            page: platformPagination.page,
            pageSize: platformPagination.pageSize,
          },
        }
      );
      return data;
    },
    placeholderData: keepPreviousData,
    enabled: tab === "platform",
  });

  const routeRatesQ = useQuery({
    queryKey: ["admin-shipping-route-rates", routesPagination.page, routesPagination.pageSize],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<RouteRate>>(
        "/api/admin/shipping/route-rates",
        {
          ...AXIOS_COOKIE_CFG,
          params: {
            page: routesPagination.page,
            pageSize: routesPagination.pageSize,
          },
        }
      );
      return data;
    },
    placeholderData: keepPreviousData,
    enabled: tab === "routes",
  });

  const supplierProfilesQ = useQuery({
    queryKey: [
      "admin-shipping-supplier-profiles",
      suppliersPagination.page,
      suppliersPagination.pageSize,
    ],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<SupplierProfile>>(
        "/api/admin/shipping/supplier-profiles",
        {
          ...AXIOS_COOKIE_CFG,
          params: {
            page: suppliersPagination.page,
            pageSize: suppliersPagination.pageSize,
          },
        }
      );
      return data;
    },
    placeholderData: keepPreviousData,
    enabled: tab === "suppliers",
  });

  const zonesData = normalizePaginated(zonesQ.data, zonesPagination);
  const platformData = normalizePaginated(platformRatesQ.data, platformPagination);
  const routesData = normalizePaginated(routeRatesQ.data, routesPagination);
  const suppliersData = normalizePaginated(supplierProfilesQ.data, suppliersPagination);
  const zoneOptions = zonesOptionsQ.data?.data ?? [];

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-shipping-zones"] }),
      qc.invalidateQueries({ queryKey: ["admin-shipping-zones-options"] }),
      qc.invalidateQueries({ queryKey: ["admin-shipping-platform-rates"] }),
      qc.invalidateQueries({ queryKey: ["admin-shipping-route-rates"] }),
      qc.invalidateQueries({ queryKey: ["admin-shipping-supplier-profiles"] }),
    ]);
  };

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Shipping Admin</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Manage zones, platform rates, route cards, and supplier shipping profiles.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {[
            ["zones", "Zones"],
            ["platform", "Platform Rates"],
            ["routes", "Route Rates"],
            ["suppliers", "Supplier Profiles"],
          ].map(([key, label]) => (
            <Button
              key={key}
              type="button"
              onClick={() => setTab(key as any)}
              className={
                tab === key
                  ? "bg-violet-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }
            >
              {label}
            </Button>
          ))}
        </div>

        {tab === "zones" && (
          <ZonesTab
            rows={zonesData.rows}
            pagination={zonesData.meta}
            onPageChange={(page) =>
              setZonesPagination((s) => ({ ...s, page: Math.max(1, page) }))
            }
            onPageSizeChange={(pageSize) =>
              setZonesPagination({ page: 1, pageSize })
            }
            onError={setError}
            onSaved={refreshAll}
          />
        )}

        {tab === "platform" && (
          <PlatformRatesTab
            rows={platformData.rows}
            pagination={platformData.meta}
            zones={zoneOptions}
            onPageChange={(page) =>
              setPlatformPagination((s) => ({ ...s, page: Math.max(1, page) }))
            }
            onPageSizeChange={(pageSize) =>
              setPlatformPagination({ page: 1, pageSize })
            }
            onError={setError}
            onSaved={refreshAll}
          />
        )}

        {tab === "routes" && (
          <RouteRatesTab
            rows={routesData.rows}
            pagination={routesData.meta}
            zones={zoneOptions}
            onPageChange={(page) =>
              setRoutesPagination((s) => ({ ...s, page: Math.max(1, page) }))
            }
            onPageSizeChange={(pageSize) =>
              setRoutesPagination({ page: 1, pageSize })
            }
            onError={setError}
            onSaved={refreshAll}
          />
        )}

        {tab === "suppliers" && (
          <SupplierProfilesTab
            rows={suppliersData.rows}
            pagination={suppliersData.meta}
            zones={zoneOptions}
            onPageChange={(page) =>
              setSuppliersPagination((s) => ({ ...s, page: Math.max(1, page) }))
            }
            onPageSizeChange={(pageSize) =>
              setSuppliersPagination({ page: 1, pageSize })
            }
            onError={setError}
            onSaved={refreshAll}
          />
        )}
      </div>
    </SiteLayout>
  );
}

/* ---------------- Zones tab ---------------- */

function ZonesTab({
  rows,
  pagination,
  onPageChange,
  onPageSizeChange,
  onError,
  onSaved,
}: {
  rows: Zone[];
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onError: (s: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: "",
    name: "",
    country: "Nigeria",
    statesJson: "",
    lgasJson: "",
    priority: 0,
    isActive: true,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        statesJson: form.statesJson
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        lgasJson: form.lgasJson
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      };
      await api.post("/api/admin/shipping/zones", payload, AXIOS_COOKIE_CFG);
    },
    onSuccess: async () => {
      setForm({
        code: "",
        name: "",
        country: "Nigeria",
        statesJson: "",
        lgasJson: "",
        priority: 0,
        isActive: true,
      });
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to create zone"),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await api.patch(`/api/admin/shipping/zones/${id}`, { isActive }, AXIOS_COOKIE_CFG);
    },
    onSuccess: async () => {
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to update zone"),
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 font-medium">Create Zone</div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <Input
            placeholder="Code"
            value={form.code}
            onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
          />
          <Input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          />
          <Input
            placeholder="Country"
            value={form.country}
            onChange={(e) => setForm((s) => ({ ...s, country: e.target.value }))}
          />
          <Input
            placeholder="States (comma-separated)"
            value={form.statesJson}
            onChange={(e) => setForm((s) => ({ ...s, statesJson: e.target.value }))}
          />
          <Input
            placeholder="LGAs (comma-separated)"
            value={form.lgasJson}
            onChange={(e) => setForm((s) => ({ ...s, lgasJson: e.target.value }))}
          />
          <Input
            type="number"
            placeholder="Priority"
            value={form.priority}
            onChange={(e) => setForm((s) => ({ ...s, priority: num(e.target.value, 0) }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))}
            />
            Active
          </label>
        </div>
        <div className="px-4 pb-4">
          <Button
            type="button"
            onClick={() => createMut.mutate()}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            Create Zone
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 font-medium">Zones</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Country</th>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">States</th>
                <th className="px-4 py-3 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((z) => (
                <tr key={z.id} className="border-t border-zinc-100">
                  <td className="px-4 py-3 font-medium">{z.code}</td>
                  <td className="px-4 py-3">{z.name}</td>
                  <td className="px-4 py-3">{z.country}</td>
                  <td className="px-4 py-3">{z.priority}</td>
                  <td className="px-4 py-3">{(z.statesJson || []).join(", ")}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleMut.mutate({ id: z.id, isActive: !z.isActive })}
                      className={`rounded px-2 py-1 text-xs ${
                        z.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {z.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    No zones yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          meta={pagination}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </Card>
    </div>
  );
}

/* ---------------- Platform rates tab ---------------- */

function PlatformRatesTab({
  rows,
  pagination,
  zones,
  onPageChange,
  onPageSizeChange,
  onError,
  onSaved,
}: {
  rows: PlatformRate[];
  pagination: PaginationMeta;
  zones: Zone[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onError: (s: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    zoneId: "",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: "",
    baseFee: 0,
    perKgFee: "",
    remoteSurcharge: "",
    fuelSurcharge: "",
    handlingFee: "",
    etaMinDays: "",
    etaMaxDays: "",
    currency: "NGN",
    isActive: true,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      await api.post(
        "/api/admin/shipping/platform-rates",
        {
          zoneId: form.zoneId,
          serviceLevel: form.serviceLevel,
          parcelClass: form.parcelClass,
          minWeightGrams: num(form.minWeightGrams, 0),
          maxWeightGrams: form.maxWeightGrams === "" ? null : num(form.maxWeightGrams, 0),
          baseFee: num(form.baseFee, 0),
          perKgFee: form.perKgFee === "" ? null : num(form.perKgFee, 0),
          remoteSurcharge: form.remoteSurcharge === "" ? null : num(form.remoteSurcharge, 0),
          fuelSurcharge: form.fuelSurcharge === "" ? null : num(form.fuelSurcharge, 0),
          handlingFee: form.handlingFee === "" ? null : num(form.handlingFee, 0),
          etaMinDays: form.etaMinDays === "" ? null : num(form.etaMinDays, 0),
          etaMaxDays: form.etaMaxDays === "" ? null : num(form.etaMaxDays, 0),
          currency: form.currency,
          isActive: form.isActive,
        },
        AXIOS_COOKIE_CFG
      );
    },
    onSuccess: async () => {
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to create platform rate"),
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 font-medium">Create Platform Rate</div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <Select value={form.zoneId} onChange={(e) => setForm((s) => ({ ...s, zoneId: e.target.value }))}>
            <option value="">Select zone</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code} — {z.name}
              </option>
            ))}
          </Select>

          <Select value={form.serviceLevel} onChange={(e) => setForm((s) => ({ ...s, serviceLevel: e.target.value }))}>
            {SERVICE_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Select value={form.parcelClass} onChange={(e) => setForm((s) => ({ ...s, parcelClass: e.target.value }))}>
            {PARCEL_CLASSES.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Input type="text" value={form.currency} onChange={(e) => setForm((s) => ({ ...s, currency: e.target.value }))} placeholder="Currency" />

          <Input type="number" value={form.minWeightGrams} onChange={(e) => setForm((s) => ({ ...s, minWeightGrams: num(e.target.value, 0) }))} placeholder="Min weight grams" />
          <Input type="number" value={form.maxWeightGrams} onChange={(e) => setForm((s) => ({ ...s, maxWeightGrams: e.target.value }))} placeholder="Max weight grams (blank = no max)" />
          <Input type="number" value={form.baseFee} onChange={(e) => setForm((s) => ({ ...s, baseFee: num(e.target.value, 0) }))} placeholder="Base fee" />
          <Input type="number" value={form.perKgFee} onChange={(e) => setForm((s) => ({ ...s, perKgFee: e.target.value }))} placeholder="Per kg fee" />

          <Input type="number" value={form.remoteSurcharge} onChange={(e) => setForm((s) => ({ ...s, remoteSurcharge: e.target.value }))} placeholder="Remote surcharge" />
          <Input type="number" value={form.fuelSurcharge} onChange={(e) => setForm((s) => ({ ...s, fuelSurcharge: e.target.value }))} placeholder="Fuel surcharge" />
          <Input type="number" value={form.handlingFee} onChange={(e) => setForm((s) => ({ ...s, handlingFee: e.target.value }))} placeholder="Handling fee" />
          <Input type="number" value={form.etaMinDays} onChange={(e) => setForm((s) => ({ ...s, etaMinDays: e.target.value }))} placeholder="ETA min days" />

          <Input type="number" value={form.etaMaxDays} onChange={(e) => setForm((s) => ({ ...s, etaMaxDays: e.target.value }))} placeholder="ETA max days" />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))}
            />
            Active
          </label>
        </div>
        <div className="px-4 pb-4">
          <Button type="button" onClick={() => createMut.mutate()} className="bg-violet-600 text-white hover:bg-violet-700">
            Create Platform Rate
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 font-medium">Platform Rates</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 text-left">Zone</th>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-left">Parcel</th>
                <th className="px-4 py-3 text-left">Weight</th>
                <th className="px-4 py-3 text-left">Fees</th>
                <th className="px-4 py-3 text-left">ETA</th>
                <th className="px-4 py-3 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PlatformRateRow key={r.id} row={r} zones={zones} onSaved={onSaved} onError={onError} />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No platform rates found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          meta={pagination}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </Card>
    </div>
  );
}

function PlatformRateRow({
  row,
  zones,
  onSaved,
  onError,
}: {
  row: PlatformRate;
  zones: Zone[];
  onSaved: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    zoneId: row.zoneId,
    serviceLevel: row.serviceLevel,
    parcelClass: row.parcelClass,
    minWeightGrams: row.minWeightGrams,
    maxWeightGrams: row.maxWeightGrams == null ? "" : String(row.maxWeightGrams),
    baseFee: String(row.baseFee ?? ""),
    perKgFee: row.perKgFee == null ? "" : String(row.perKgFee),
    remoteSurcharge: row.remoteSurcharge == null ? "" : String(row.remoteSurcharge),
    fuelSurcharge: row.fuelSurcharge == null ? "" : String(row.fuelSurcharge),
    handlingFee: row.handlingFee == null ? "" : String(row.handlingFee),
    etaMinDays: row.etaMinDays == null ? "" : String(row.etaMinDays),
    etaMaxDays: row.etaMaxDays == null ? "" : String(row.etaMaxDays),
    currency: row.currency,
    isActive: row.isActive,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      await api.patch(
        `/api/admin/shipping/platform-rates/${row.id}`,
        {
          zoneId: form.zoneId,
          serviceLevel: form.serviceLevel,
          parcelClass: form.parcelClass,
          minWeightGrams: num(form.minWeightGrams, 0),
          maxWeightGrams: form.maxWeightGrams === "" ? null : num(form.maxWeightGrams, 0),
          baseFee: num(form.baseFee, 0),
          perKgFee: form.perKgFee === "" ? null : num(form.perKgFee, 0),
          remoteSurcharge: form.remoteSurcharge === "" ? null : num(form.remoteSurcharge, 0),
          fuelSurcharge: form.fuelSurcharge === "" ? null : num(form.fuelSurcharge, 0),
          handlingFee: form.handlingFee === "" ? null : num(form.handlingFee, 0),
          etaMinDays: form.etaMinDays === "" ? null : num(form.etaMinDays, 0),
          etaMaxDays: form.etaMaxDays === "" ? null : num(form.etaMaxDays, 0),
          currency: form.currency,
          isActive: form.isActive,
        },
        AXIOS_COOKIE_CFG
      );
    },
    onSuccess: async () => {
      setEditing(false);
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to update platform rate"),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/admin/shipping/platform-rates/${row.id}`, AXIOS_COOKIE_CFG);
    },
    onSuccess: async () => {
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to delete platform rate"),
  });

  if (!editing) {
    return (
      <tr className="border-t border-zinc-100">
        <td className="px-4 py-3">{row.zone?.code || row.zone?.name || row.zoneId}</td>
        <td className="px-4 py-3">{row.serviceLevel}</td>
        <td className="px-4 py-3">{row.parcelClass}</td>
        <td className="px-4 py-3">
          {row.minWeightGrams} - {row.maxWeightGrams == null ? "∞" : row.maxWeightGrams}g
        </td>
        <td className="px-4 py-3">
          Base {String(row.baseFee)} / Kg {row.perKgFee == null ? "—" : String(row.perKgFee)}
        </td>
        <td className="px-4 py-3">
          {row.etaMinDays ?? "—"} - {row.etaMaxDays ?? "—"} days
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={row.isActive ? "text-emerald-600" : "text-zinc-500"}>
              {row.isActive ? "Active" : "Inactive"}
            </span>
            <Button type="button" onClick={() => setEditing(true)} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
              Edit
            </Button>
            <Button type="button" onClick={() => deleteMut.mutate()} className="bg-red-100 text-red-700 hover:bg-red-200">
              Delete
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-zinc-100 bg-violet-50/40">
      <td colSpan={7} className="px-4 py-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Select value={form.zoneId} onChange={(e) => setForm((s) => ({ ...s, zoneId: e.target.value }))}>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code} — {z.name}
              </option>
            ))}
          </Select>
          <Select value={form.serviceLevel} onChange={(e) => setForm((s) => ({ ...s, serviceLevel: e.target.value }))}>
            {SERVICE_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
          <Select value={form.parcelClass} onChange={(e) => setForm((s) => ({ ...s, parcelClass: e.target.value }))}>
            {PARCEL_CLASSES.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
          <Input value={form.currency} onChange={(e) => setForm((s) => ({ ...s, currency: e.target.value }))} placeholder="Currency" />

          <Input type="number" value={form.minWeightGrams} onChange={(e) => setForm((s) => ({ ...s, minWeightGrams: num(e.target.value, 0) }))} />
          <Input type="number" value={form.maxWeightGrams} onChange={(e) => setForm((s) => ({ ...s, maxWeightGrams: e.target.value }))} />
          <Input type="number" value={form.baseFee} onChange={(e) => setForm((s) => ({ ...s, baseFee: e.target.value }))} />
          <Input type="number" value={form.perKgFee} onChange={(e) => setForm((s) => ({ ...s, perKgFee: e.target.value }))} />

          <Input type="number" value={form.remoteSurcharge} onChange={(e) => setForm((s) => ({ ...s, remoteSurcharge: e.target.value }))} />
          <Input type="number" value={form.fuelSurcharge} onChange={(e) => setForm((s) => ({ ...s, fuelSurcharge: e.target.value }))} />
          <Input type="number" value={form.handlingFee} onChange={(e) => setForm((s) => ({ ...s, handlingFee: e.target.value }))} />
          <Input type="number" value={form.etaMinDays} onChange={(e) => setForm((s) => ({ ...s, etaMinDays: e.target.value }))} />

          <Input type="number" value={form.etaMaxDays} onChange={(e) => setForm((s) => ({ ...s, etaMaxDays: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))} />
            Active
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <Button type="button" onClick={() => saveMut.mutate()} className="bg-violet-600 text-white hover:bg-violet-700">
            Save
          </Button>
          <Button type="button" onClick={() => setEditing(false)} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ---------------- Route rates tab ---------------- */

function RouteRatesTab({
  rows,
  pagination,
  zones,
  onPageChange,
  onPageSizeChange,
  onError,
  onSaved,
}: {
  rows: RouteRate[];
  pagination: PaginationMeta;
  zones: Zone[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onError: (s: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    originZoneCode: "",
    destinationZoneCode: "",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: 0,
    maxWeightGrams: "",
    baseFee: 0,
    perKgFee: "",
    remoteSurcharge: "",
    fuelSurcharge: "",
    handlingFee: "",
    etaMinDays: "",
    etaMaxDays: "",
    isActive: true,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      await api.post(
        "/api/admin/shipping/route-rates",
        {
          originZoneCode: form.originZoneCode,
          destinationZoneCode: form.destinationZoneCode,
          serviceLevel: form.serviceLevel,
          parcelClass: form.parcelClass,
          minWeightGrams: num(form.minWeightGrams, 0),
          maxWeightGrams: form.maxWeightGrams === "" ? null : num(form.maxWeightGrams, 0),
          baseFee: num(form.baseFee, 0),
          perKgFee: form.perKgFee === "" ? null : num(form.perKgFee, 0),
          remoteSurcharge: form.remoteSurcharge === "" ? null : num(form.remoteSurcharge, 0),
          fuelSurcharge: form.fuelSurcharge === "" ? null : num(form.fuelSurcharge, 0),
          handlingFee: form.handlingFee === "" ? null : num(form.handlingFee, 0),
          etaMinDays: form.etaMinDays === "" ? null : num(form.etaMinDays, 0),
          etaMaxDays: form.etaMaxDays === "" ? null : num(form.etaMaxDays, 0),
          isActive: form.isActive,
        },
        AXIOS_COOKIE_CFG
      );
    },
    onSuccess: async () => {
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to create route rate"),
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 font-medium">Create Route Rate</div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <Select value={form.originZoneCode} onChange={(e) => setForm((s) => ({ ...s, originZoneCode: e.target.value }))}>
            <option value="">Origin zone</option>
            {zones.map((z) => <option key={z.code} value={z.code}>{z.code}</option>)}
          </Select>

          <Select value={form.destinationZoneCode} onChange={(e) => setForm((s) => ({ ...s, destinationZoneCode: e.target.value }))}>
            <option value="">Destination zone</option>
            {zones.map((z) => <option key={z.code} value={z.code}>{z.code}</option>)}
          </Select>

          <Select value={form.serviceLevel} onChange={(e) => setForm((s) => ({ ...s, serviceLevel: e.target.value }))}>
            {SERVICE_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Select value={form.parcelClass} onChange={(e) => setForm((s) => ({ ...s, parcelClass: e.target.value }))}>
            {PARCEL_CLASSES.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Input type="number" value={form.minWeightGrams} onChange={(e) => setForm((s) => ({ ...s, minWeightGrams: num(e.target.value, 0) }))} placeholder="Min weight grams" />
          <Input type="number" value={form.maxWeightGrams} onChange={(e) => setForm((s) => ({ ...s, maxWeightGrams: e.target.value }))} placeholder="Max weight grams" />
          <Input type="number" value={form.baseFee} onChange={(e) => setForm((s) => ({ ...s, baseFee: num(e.target.value, 0) }))} placeholder="Base fee" />
          <Input type="number" value={form.perKgFee} onChange={(e) => setForm((s) => ({ ...s, perKgFee: e.target.value }))} placeholder="Per kg fee" />

          <Input type="number" value={form.remoteSurcharge} onChange={(e) => setForm((s) => ({ ...s, remoteSurcharge: e.target.value }))} placeholder="Remote surcharge" />
          <Input type="number" value={form.fuelSurcharge} onChange={(e) => setForm((s) => ({ ...s, fuelSurcharge: e.target.value }))} placeholder="Fuel surcharge" />
          <Input type="number" value={form.handlingFee} onChange={(e) => setForm((s) => ({ ...s, handlingFee: e.target.value }))} placeholder="Handling fee" />
          <Input type="number" value={form.etaMinDays} onChange={(e) => setForm((s) => ({ ...s, etaMinDays: e.target.value }))} placeholder="ETA min days" />

          <Input type="number" value={form.etaMaxDays} onChange={(e) => setForm((s) => ({ ...s, etaMaxDays: e.target.value }))} placeholder="ETA max days" />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))}
            />
            Active
          </label>
        </div>
        <div className="px-4 pb-4">
          <Button type="button" onClick={() => createMut.mutate()} className="bg-violet-600 text-white hover:bg-violet-700">
            Create Route Rate
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 font-medium">Route Rates</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 text-left">Origin</th>
                <th className="px-4 py-3 text-left">Destination</th>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-left">Parcel</th>
                <th className="px-4 py-3 text-left">Weight</th>
                <th className="px-4 py-3 text-left">Fees</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RouteRateRow key={r.id} row={r} zones={zones} onSaved={onSaved} onError={onError} />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No route rates found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          meta={pagination}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </Card>
    </div>
  );
}

function RouteRateRow({
  row,
  zones,
  onSaved,
  onError,
}: {
  row: RouteRate;
  zones: Zone[];
  onSaved: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    originZoneCode: row.originZoneCode,
    destinationZoneCode: row.destinationZoneCode,
    serviceLevel: row.serviceLevel,
    parcelClass: row.parcelClass,
    minWeightGrams: row.minWeightGrams,
    maxWeightGrams: row.maxWeightGrams == null ? "" : String(row.maxWeightGrams),
    baseFee: String(row.baseFee ?? ""),
    perKgFee: row.perKgFee == null ? "" : String(row.perKgFee),
    remoteSurcharge: row.remoteSurcharge == null ? "" : String(row.remoteSurcharge),
    fuelSurcharge: row.fuelSurcharge == null ? "" : String(row.fuelSurcharge),
    handlingFee: row.handlingFee == null ? "" : String(row.handlingFee),
    etaMinDays: row.etaMinDays == null ? "" : String(row.etaMinDays),
    etaMaxDays: row.etaMaxDays == null ? "" : String(row.etaMaxDays),
    isActive: row.isActive,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      await api.patch(
        `/api/admin/shipping/route-rates/${row.id}`,
        {
          originZoneCode: form.originZoneCode,
          destinationZoneCode: form.destinationZoneCode,
          serviceLevel: form.serviceLevel,
          parcelClass: form.parcelClass,
          minWeightGrams: num(form.minWeightGrams, 0),
          maxWeightGrams: form.maxWeightGrams === "" ? null : num(form.maxWeightGrams, 0),
          baseFee: num(form.baseFee, 0),
          perKgFee: form.perKgFee === "" ? null : num(form.perKgFee, 0),
          remoteSurcharge: form.remoteSurcharge === "" ? null : num(form.remoteSurcharge, 0),
          fuelSurcharge: form.fuelSurcharge === "" ? null : num(form.fuelSurcharge, 0),
          handlingFee: form.handlingFee === "" ? null : num(form.handlingFee, 0),
          etaMinDays: form.etaMinDays === "" ? null : num(form.etaMinDays, 0),
          etaMaxDays: form.etaMaxDays === "" ? null : num(form.etaMaxDays, 0),
          isActive: form.isActive,
        },
        AXIOS_COOKIE_CFG
      );
    },
    onSuccess: async () => {
      setEditing(false);
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to update route rate"),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/admin/shipping/route-rates/${row.id}`, AXIOS_COOKIE_CFG);
    },
    onSuccess: async () => {
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to delete route rate"),
  });

  if (!editing) {
    return (
      <tr className="border-t border-zinc-100">
        <td className="px-4 py-3">{row.originZoneCode}</td>
        <td className="px-4 py-3">{row.destinationZoneCode}</td>
        <td className="px-4 py-3">{row.serviceLevel}</td>
        <td className="px-4 py-3">{row.parcelClass}</td>
        <td className="px-4 py-3">{row.minWeightGrams} - {row.maxWeightGrams == null ? "∞" : row.maxWeightGrams}g</td>
        <td className="px-4 py-3">Base {String(row.baseFee)} / Kg {row.perKgFee == null ? "—" : String(row.perKgFee)}</td>
        <td className="px-4 py-3">
          <div className="flex gap-2">
            <Button type="button" onClick={() => setEditing(true)} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
              Edit
            </Button>
            <Button type="button" onClick={() => deleteMut.mutate()} className="bg-red-100 text-red-700 hover:bg-red-200">
              Delete
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-zinc-100 bg-violet-50/40">
      <td colSpan={7} className="px-4 py-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Select value={form.originZoneCode} onChange={(e) => setForm((s) => ({ ...s, originZoneCode: e.target.value }))}>
            {zones.map((z) => <option key={z.code} value={z.code}>{z.code}</option>)}
          </Select>
          <Select value={form.destinationZoneCode} onChange={(e) => setForm((s) => ({ ...s, destinationZoneCode: e.target.value }))}>
            {zones.map((z) => <option key={z.code} value={z.code}>{z.code}</option>)}
          </Select>
          <Select value={form.serviceLevel} onChange={(e) => setForm((s) => ({ ...s, serviceLevel: e.target.value }))}>
            {SERVICE_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
          <Select value={form.parcelClass} onChange={(e) => setForm((s) => ({ ...s, parcelClass: e.target.value }))}>
            {PARCEL_CLASSES.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Input type="number" value={form.minWeightGrams} onChange={(e) => setForm((s) => ({ ...s, minWeightGrams: num(e.target.value, 0) }))} />
          <Input type="number" value={form.maxWeightGrams} onChange={(e) => setForm((s) => ({ ...s, maxWeightGrams: e.target.value }))} />
          <Input type="number" value={form.baseFee} onChange={(e) => setForm((s) => ({ ...s, baseFee: e.target.value }))} />
          <Input type="number" value={form.perKgFee} onChange={(e) => setForm((s) => ({ ...s, perKgFee: e.target.value }))} />

          <Input type="number" value={form.remoteSurcharge} onChange={(e) => setForm((s) => ({ ...s, remoteSurcharge: e.target.value }))} />
          <Input type="number" value={form.fuelSurcharge} onChange={(e) => setForm((s) => ({ ...s, fuelSurcharge: e.target.value }))} />
          <Input type="number" value={form.handlingFee} onChange={(e) => setForm((s) => ({ ...s, handlingFee: e.target.value }))} />
          <Input type="number" value={form.etaMinDays} onChange={(e) => setForm((s) => ({ ...s, etaMinDays: e.target.value }))} />

          <Input type="number" value={form.etaMaxDays} onChange={(e) => setForm((s) => ({ ...s, etaMaxDays: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))} />
            Active
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <Button type="button" onClick={() => saveMut.mutate()} className="bg-violet-600 text-white hover:bg-violet-700">
            Save
          </Button>
          <Button type="button" onClick={() => setEditing(false)} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ---------------- Supplier profiles tab ---------------- */

function SupplierProfilesTab({
  rows,
  pagination,
  zones,
  onPageChange,
  onPageSizeChange,
  onError,
  onSaved,
}: {
  rows: SupplierProfile[];
  pagination: PaginationMeta;
  zones: Zone[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onError: (s: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  return (
    <Card>
      <div className="border-b border-zinc-200 px-4 py-3 font-medium">Supplier Shipping Profiles</div>
      <div className="divide-y divide-zinc-100">
        {rows.map((r) => (
          <SupplierProfileRow key={r.id} row={r} zones={zones} onSaved={onSaved} onError={onError} />
        ))}
        {!rows.length && <div className="px-4 py-8 text-center text-zinc-500">No suppliers found.</div>}
      </div>

      <TablePagination
        meta={pagination}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </Card>
  );
}

function SupplierProfileRow({
  row,
  zones,
  onSaved,
  onError,
}: {
  row: SupplierProfile;
  zones: Zone[];
  onSaved: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    shippingProfileMode: row.shippingProfileMode,
    defaultServiceLevel: row.defaultServiceLevel ?? "STANDARD",
    originZoneCode: row.shippingProfile?.originZoneCode ?? "",
    fulfillmentMode: row.shippingProfile?.fulfillmentMode ?? "SUPPLIER_SELF_SHIP",
    preferredCarrier: row.shippingProfile?.preferredCarrier ?? "",
    localFlatFee: row.shippingProfile?.localFlatFee == null ? "" : String(row.shippingProfile.localFlatFee),
    nearbyFlatFee: row.shippingProfile?.nearbyFlatFee == null ? "" : String(row.shippingProfile.nearbyFlatFee),
    nationwideBaseFee: row.shippingProfile?.nationwideBaseFee == null ? "" : String(row.shippingProfile.nationwideBaseFee),
    defaultHandlingFee: row.shippingProfile?.defaultHandlingFee == null ? "" : String(row.shippingProfile.defaultHandlingFee),
    isActive: row.shippingProfile?.isActive ?? true,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      await api.patch(
        `/api/admin/shipping/suppliers/${row.id}/profile`,
        {
          shippingProfileMode: form.shippingProfileMode,
          defaultServiceLevel: form.defaultServiceLevel || null,
          originZoneCode: form.originZoneCode || null,
          fulfillmentMode: form.fulfillmentMode || null,
          preferredCarrier: form.preferredCarrier || null,
          localFlatFee: form.localFlatFee === "" ? null : num(form.localFlatFee, 0),
          nearbyFlatFee: form.nearbyFlatFee === "" ? null : num(form.nearbyFlatFee, 0),
          nationwideBaseFee: form.nationwideBaseFee === "" ? null : num(form.nationwideBaseFee, 0),
          defaultHandlingFee: form.defaultHandlingFee === "" ? null : num(form.defaultHandlingFee, 0),
          isActive: form.isActive,
        },
        AXIOS_COOKIE_CFG
      );
    },
    onSuccess: async () => {
      setOpen(false);
      onError(null);
      await onSaved();
    },
    onError: (e: any) => onError(e?.response?.data?.error || "Failed to update supplier profile"),
  });

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-medium text-zinc-900">{row.name}</div>
          <div className="text-sm text-zinc-600">
            Mode: {row.shippingProfileMode} · Default service: {row.defaultServiceLevel ?? "—"}
          </div>
        </div>
        <Button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
        >
          {open ? "Close" : "Edit"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Select value={form.shippingProfileMode} onChange={(e) => setForm((s) => ({ ...s, shippingProfileMode: e.target.value }))}>
            {PROFILE_MODES.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Select value={form.defaultServiceLevel} onChange={(e) => setForm((s) => ({ ...s, defaultServiceLevel: e.target.value }))}>
            {SERVICE_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Select value={form.originZoneCode} onChange={(e) => setForm((s) => ({ ...s, originZoneCode: e.target.value }))}>
            <option value="">No origin zone</option>
            {zones.map((z) => <option key={z.code} value={z.code}>{z.code}</option>)}
          </Select>

          <Select value={form.fulfillmentMode} onChange={(e) => setForm((s) => ({ ...s, fulfillmentMode: e.target.value }))}>
            {FULFILLMENT_MODES.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>

          <Input value={form.preferredCarrier} onChange={(e) => setForm((s) => ({ ...s, preferredCarrier: e.target.value }))} placeholder="Preferred carrier" />
          <Input type="number" value={form.localFlatFee} onChange={(e) => setForm((s) => ({ ...s, localFlatFee: e.target.value }))} placeholder="Local flat fee" />
          <Input type="number" value={form.nearbyFlatFee} onChange={(e) => setForm((s) => ({ ...s, nearbyFlatFee: e.target.value }))} placeholder="Nearby flat fee" />
          <Input type="number" value={form.nationwideBaseFee} onChange={(e) => setForm((s) => ({ ...s, nationwideBaseFee: e.target.value }))} placeholder="Nationwide base fee" />

          <Input type="number" value={form.defaultHandlingFee} onChange={(e) => setForm((s) => ({ ...s, defaultHandlingFee: e.target.value }))} placeholder="Default handling fee" />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))} />
            Profile active
          </label>

          <div className="md:col-span-4 flex gap-2">
            <Button type="button" onClick={() => saveMut.mutate()} className="bg-violet-600 text-white hover:bg-violet-700">
              Save Supplier Profile
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}