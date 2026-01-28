// src/pages/supplier/SupplierOrders.tsx
import React, { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  PackageCheck,
  Search,
  Sparkles,
  Truck,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

type ShippingAddress = {
  houseNumber: string;
  streetName: string;
  postCode?: string | null;
  town?: string | null;
  city: string;
  state: string;
  country: string;
};

type OrderItem = {
  id: string;
  title: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  chosenSupplierOfferId?: string | null;
  chosenSupplierUnitPrice?: number | null;
  selectedOptions?: any;
};

type SupplierOrder = {
  id: string;
  status: string;
  createdAt?: string | null;
  customerEmail?: string | null;
  shippingAddress?: ShippingAddress | null;

  purchaseOrderId?: string | null;
  supplierStatus?: string | null;

  items: OrderItem[];

  supplierAmount?: number | null;
  poSubtotal?: number | null;
  payoutStatus?: string | null;
  paidOutAt?: string | null;
};

function formatDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function moneyNgn(n?: number | null) {
  if (n == null) return "—";
  return `₦${Number(n).toLocaleString("en-NG")}`;
}

function badgeClass(status: string) {
  const s = String(status || "").toUpperCase();
  if (["SHIPPED", "DELIVERED"].includes(s)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["PACKED", "CONFIRMED"].includes(s)) return "bg-amber-50 text-amber-700 border-amber-200";
  if (["CANCELED", "CANCELLED", "FAILED"].includes(s)) return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-zinc-50 text-zinc-700 border-zinc-200";
}

function formatAddress(a?: ShippingAddress | null) {
  if (!a) return "—";
  const parts = [
    `${a.houseNumber} ${a.streetName}`.trim(),
    a.town || "",
    a.city || "",
    a.state || "",
    a.postCode || "",
    a.country || "",
  ].filter(Boolean);
  return parts.join(", ");
}

function supplierOptionsLabel(selectedOptions: any) {
  if (!Array.isArray(selectedOptions) || !selectedOptions.length) return "";
  return selectedOptions
    .map((o) => {
      const a = o?.attribute || "Attribute";
      const v = o?.value || o?.name || "Value";
      return `${a}: ${v}`;
    })
    .join(", ");
}
export default function SupplierOrders() {
  const { orderId } = useParams<{ orderId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // ✅ init q from /orders/:orderId OR from ?q=...
  const [q, setQ] = useState(() => {
    return (orderId ?? searchParams.get("q") ?? "").trim();
  });

  // ✅ when route param exists, force it into q and URL (?q=...)
  useEffect(() => {
    const v = (orderId ?? "").trim();
    if (!v) return;

    setQ(v);

    // keep URL in sync for refresh/share
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("q", v);
      return next;
    }, { replace: true });
  }, [orderId, setSearchParams]);

  // ✅ OPTIONAL: keep URL updated when typing
  useEffect(() => {
    const v = (q ?? "").trim();
    const cur = (searchParams.get("q") ?? "").trim();
    if (v === cur) return;

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set("q", v);
      else next.delete("q");
      return next;
    }, { replace: true });
  }, [q, searchParams, setSearchParams]);



  const token = useAuthStore((s) => s.token);

  const [status, setStatus] = useState<string>("ANY");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<string>("PENDING");

  const supplierStatuses = ["PENDING", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELED"];

  // ✅ When navigating to /supplier/orders/:orderId, force q to that value
  useEffect(() => {
    const v = (orderId ?? "").trim();
    if (!v) return;

    // only update if different (avoid pointless rerenders)
    setQ((prev) => (prev === v ? prev : v));

    // keep URL in sync (?q=orderId) for refresh/share
    const currentQ = (searchParams.get("q") ?? "").trim();
    if (currentQ !== v) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("q", v);
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // ✅ If user lands on /supplier/orders?q=..., reflect it in input
  useEffect(() => {
    const qp = (searchParams.get("q") ?? "").trim();
    // only sync if it differs and there's no route param overriding it
    if (!orderId && qp && qp !== q) setQ(qp);
    if (!orderId && !qp && q) {
      // querystring cleared externally
      setQ("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ✅ Keep querystring updated when user types (guard to avoid loops)
  useEffect(() => {
    const v = (q ?? "").trim();
    const cur = (searchParams.get("q") ?? "").trim();
    if (v === cur) return;

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set("q", v);
      else next.delete("q");
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const ordersQ = useQuery({
    queryKey: ["supplier", "orders"],
    enabled: !!token,
    queryFn: async () => {
      try {
        const { data } = await api.get<{ data: SupplierOrder[] }>("/api/supplier/orders");
        return Array.isArray(data?.data) ? data.data : [];
      } catch (err) {
        const e = err as AxiosError<any>;
        const status = e?.response?.status;

        // ✅ Treat "no endpoint / not mounted yet" as "no orders"
        if (status === 404) return [];
        if (status === 204) return [];

        throw err;
      }
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const filtered = useMemo(() => {
    const list = ordersQ.data || [];
    const needle = q.trim().toLowerCase();

    return list.filter((o) => {
      const supplierStatus = String(o.supplierStatus || "PENDING").toUpperCase();

      if (status !== "ANY" && supplierStatus !== status) return false;
      if (!needle) return true;

      const hitOrderId = String(o.id).toLowerCase().includes(needle);
      const hitEmail = String(o.customerEmail || "").toLowerCase().includes(needle);
      const hitItem = (o.items || []).some((it) => String(it.title || "").toLowerCase().includes(needle));

      return hitOrderId || hitEmail || hitItem;
    });
  }, [ordersQ.data, q, status]);

  const updateStatusM = useMutation({
    mutationFn: async (vars: { orderId: string; status: string }) => {
      const { data } = await api.patch(`/api/supplier/orders/${vars.orderId}/status`, {
        status: vars.status,
      });
      return (data as any)?.data ?? data;
    },
    onSuccess: () => {
      setEditingId(null);
      ordersQ.refetch();
    },
  });

  return (
    <SiteLayout>
      <SupplierLayout>
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl md:text-3xl font-bold tracking-tight"
            >
              Orders <Sparkles className="inline ml-1" size={22} />
            </motion.h1>
            <p className="mt-1 text-sm text-white/80">
              Orders allocated to you (based on{" "}
              <code className="px-1 rounded bg-white/10">chosenSupplierId</code> on order items).
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
              >
                Back to overview <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                <input
                  placeholder="Search by order ID, customer email, product…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full rounded-2xl border bg-white pl-9 pr-4 py-3 text-sm outline-none focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400 transition"
                />
              </div>

              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full sm:w-[220px] rounded-2xl border bg-white px-4 py-3 text-sm"
              >
                <option value="ANY">Any supplier status</option>
                {supplierStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          <Card>
            <div className="p-5 flex items-center gap-3">
              <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                <PackageCheck size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-zinc-500">Fulfillment</div>
                <div className="text-sm font-semibold text-zinc-900">Confirm → Pack → Ship</div>
                <div className="text-[11px] text-zinc-500">Supplier status is stored on PurchaseOrder.</div>
              </div>
            </div>
          </Card>
        </div>

        {/* List */}
        <div className="mt-4">
          <Card>
            <div className="px-5 py-4 border-b bg-white/70">
              <div className="text-sm font-semibold text-zinc-900">Order queue</div>
              <div className="text-xs text-zinc-500">
                {ordersQ.isLoading
                  ? "Loading…"
                  : ordersQ.isError
                  ? "Temporarily unavailable"
                  : `${filtered.length} order(s)`}
              </div>
            </div>

            <div className="p-5 space-y-3">
              {ordersQ.isError && (
                <div className="rounded-2xl border bg-white p-6 text-sm text-zinc-600">
                  We couldn’t load your orders right now. Please refresh and try again.
                </div>
              )}

              {!ordersQ.isLoading && !ordersQ.isError && filtered.length === 0 && (
                <div className="rounded-2xl border bg-white p-6 text-sm text-zinc-600">
                  You have no orders yet.
                </div>
              )}

              {filtered.map((o) => {
                const isOpen = !!expanded[o.id];
                const supplierStatus = String(o.supplierStatus || "PENDING").toUpperCase();

                const retailTotal = (o.items || []).reduce((sum, it) => sum + Number(it.lineTotal || 0), 0);
                const supplierTotal = (o.items || []).reduce(
                  (sum, it) => sum + Number(it.chosenSupplierUnitPrice || 0) * Number(it.quantity || 0),
                  0
                );

                return (
                  <div key={o.id} className="rounded-2xl border bg-white p-4 flex flex-col gap-3">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-zinc-900 flex items-center gap-2">
                          <span className="truncate">{o.id}</span>
                          <button
                            type="button"
                            onClick={() => setExpanded((s) => ({ ...s, [o.id]: !s[o.id] }))}
                            className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900"
                          >
                            {isOpen ? (
                              <>
                                Hide <ChevronUp size={14} />
                              </>
                            ) : (
                              <>
                                Details <ChevronDown size={14} />
                              </>
                            )}
                          </button>
                        </div>

                        <div className="text-sm text-zinc-600">
                          {o.customerEmail ? `${o.customerEmail} • ` : ""}
                          {o.items.length} item{o.items.length === 1 ? "" : "s"} • {formatDate(o.createdAt)}
                        </div>

                        <div className="mt-1 text-xs text-zinc-500">
                          Ship to: <span className="text-zinc-700">{formatAddress(o.shippingAddress)}</span>
                        </div>

                        <div className="mt-1 text-xs text-zinc-500">
                          Retail total (your items):{" "}
                          <span className="font-semibold text-zinc-800">{moneyNgn(retailTotal)}</span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Supplier total (your price):{" "}
                          <span className="font-semibold text-zinc-800">{moneyNgn(supplierTotal)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${badgeClass(o.status)}`}>
                          ORDER: {String(o.status || "").toUpperCase()}
                        </span>

                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${badgeClass(supplierStatus)}`}
                        >
                          YOU: {supplierStatus}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(o.id);
                            setNextStatus(supplierStatus || "PENDING");
                          }}
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs hover:bg-black/5"
                        >
                          <Truck size={14} /> Update
                        </button>
                      </div>
                    </div>

                    {editingId === o.id && (
                      <div className="rounded-xl border bg-zinc-50 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="text-xs font-semibold text-zinc-700">Set supplier status</div>

                        <select
                          value={nextStatus}
                          onChange={(e) => setNextStatus(e.target.value)}
                          className="rounded-xl border bg-white px-3 py-2 text-sm"
                        >
                          {supplierStatuses.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>

                        <div className="flex gap-2 sm:ml-auto">
                          <button
                            type="button"
                            onClick={() => updateStatusM.mutate({ orderId: o.id, status: nextStatus })}
                            disabled={updateStatusM.isPending || !nextStatus}
                            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60"
                          >
                            <Save size={14} /> {updateStatusM.isPending ? "Saving…" : "Save"}
                          </button>

                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs hover:bg-black/5"
                          >
                            Cancel
                          </button>
                        </div>

                        {updateStatusM.isError && <div className="text-xs text-rose-700">Failed to update. Please try again.</div>}
                      </div>
                    )}

                    {isOpen && (
                      <div className="rounded-2xl border bg-white p-3">
                        <div className="text-xs font-semibold text-zinc-700 mb-2">Items allocated to you</div>

                        <div className="space-y-2">
                          {(o.items || []).map((it) => {
                            const optLabel = supplierOptionsLabel(it.selectedOptions);
                            const supplierCost =
                              it.chosenSupplierUnitPrice != null ? it.chosenSupplierUnitPrice * it.quantity : null;

                            return (
                              <div
                                key={it.id}
                                className="rounded-xl border bg-zinc-50 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-zinc-900 truncate">{it.title}</div>
                                  <div className="text-xs text-zinc-600">
                                    Qty: <b>{it.quantity}</b>
                                    {optLabel ? <span> • {optLabel}</span> : null}
                                  </div>
                                  <div className="text-[11px] text-zinc-500 mt-1">
                                    Retail: <b>{moneyNgn(it.unitPrice)}</b> each • Line: <b>{moneyNgn(it.lineTotal)}</b>
                                    {supplierCost != null ? (
                                      <>
                                        {" "}
                                        • Your cost: <b>{moneyNgn(supplierCost)}</b>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
