// src/pages/Receipt.tsx

import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

type ReceiptResp = {
  ok: boolean;
  receiptNo: string;
  issuedAt: string;
  data: any; // snapshot from backend
};

type PublicSettings = {
  shippingEnabled?: boolean;
  enableShipping?: boolean;
  shipping?: { enabled?: boolean };
  checkout?: { shippingEnabled?: boolean };
  features?: { shipping?: boolean };
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const toNum = (v: any): number => {
  if (v == null) return 0;

  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* -------------------------------------------------------------------------- */
/* Normalise service fee from snapshot                                        */
/* -------------------------------------------------------------------------- */
function resolveServiceFeeTotal(order: any): number {
  if (!order) return 0;

  const base = toNum(order.serviceFeeBase);
  const comms = toNum(order.serviceFeeComms);
  const gateway = toNum(order.serviceFeeGateway);
  const explicitTotal = toNum(order.serviceFeeTotal);
  const legacy = toNum(order.serviceFee);
  const legacyCommsTotal = toNum(order.commsTotal ?? order.comms);

  if (explicitTotal > 0) return explicitTotal;

  const componentsSum = base + comms + gateway;
  if (componentsSum > 0) return componentsSum;

  if (legacy > 0) return legacy;

  if (legacyCommsTotal > 0) return legacyCommsTotal;

  return 0;
}

/* -------------------------------------------------------------------------- */
/* Shipping for RECEIPT DISPLAY                                               */
/* -------------------------------------------------------------------------- */
function resolveShippingDisplay(order: any): number {
  if (!order) return 0;

  const subtotal = toNum(order.subtotal ?? order.itemsSubtotal);
  const total = toNum(order.total);
  const serviceFee = resolveServiceFeeTotal(order);

  let best = 0;

  if (subtotal > 0 && total > 0) {
    const fromTotals = total - subtotal - serviceFee;
    if (fromTotals > 0) best = fromTotals;
  }

  const rawBreakdown =
    order.shippingBreakdownJson ??
    order.shippingBreakdown ??
    order.shippingBreakdownJSON;

  let breakdown: any = rawBreakdown;

  if (typeof rawBreakdown === "string") {
    try {
      breakdown = JSON.parse(rawBreakdown);
    } catch {
      breakdown = null;
    }
  }

  if (breakdown && typeof breakdown === "object") {
    const candidatesKeys = [
      "customerCharged",
      "customerAmount",
      "totalFee",
      "shippingTotal",
      "total",
      "totalWithTax",
      "gross",
    ];

    for (const key of candidatesKeys) {
      const v = toNum(breakdown[key]);
      if (v > best) best = v;
    }

    const base =
      toNum(breakdown.shippingFee ?? breakdown.baseFee ?? breakdown.fee);
    const vat =
      toNum(breakdown.tax ?? breakdown.vat ?? breakdown.vatAmount ?? 0);

    if (base > 0 && base + vat > best) {
      best = base + vat;
    }
  }

  if (!best) {
    const direct = toNum(order.shipping ?? order.shippingFee);
    if (direct > 0) best = direct;
  }

  return best > 0 ? best : 0;
}

function formatAddressLines(address: any): string[] {
  if (!address) return [];

  const line1 = [address.houseNumber, address.streetName].filter(Boolean).join(" ").trim();
  const line2 = [address.town, address.city].filter(Boolean).join(", ").trim();
  const line3 = [address.state, address.country].filter(Boolean).join(", ").trim();

  return [line1, line2, line3].filter(Boolean);
}

/* ========================================================================== */

export default function ReceiptPage() {
  const { paymentId = "" } = useParams();

  const q = useQuery({
    queryKey: ["receipt", paymentId],
    enabled: !!paymentId,
    queryFn: async () =>
      (await api.get<ReceiptResp>(`/api/payments/${encodeURIComponent(paymentId)}/receipt`)).data,
  });

  const settingsQ = useQuery({
    queryKey: ["settings-public"],
    queryFn: async () =>
      (await api.get<PublicSettings>("/api/settings/public")).data,
    staleTime: 5 * 60_000,
  });

  const settings = (settingsQ.data || {}) as PublicSettings;
  const shippingEnabled = !!(
    settings.shippingEnabled ||
    settings.enableShipping ||
    settings.shipping?.enabled ||
    settings.checkout?.shippingEnabled ||
    settings.features?.shipping
  );

  useEffect(() => {
    document.title = q.data?.receiptNo
      ? `Receipt ${q.data.receiptNo}`
      : "Receipt";
  }, [q.data?.receiptNo]);

  if (q.isLoading) {
    return (
      <SiteLayout>
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
          <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-600 shadow-sm sm:px-6">
            Loading…
          </div>
        </div>
      </SiteLayout>
    );
  }

  if (q.error || !q.data?.ok) {
    return (
      <SiteLayout>
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700 shadow-sm sm:px-6">
            Receipt not available.
          </div>
        </div>
      </SiteLayout>
    );
  }

  const r = q.data.data || {};
  const order = r.order || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const serviceFee = resolveServiceFeeTotal(order);
  const shippingDisplay = shippingEnabled ? resolveShippingDisplay(order) : 0;
  const shipToLines = formatAddressLines(order.shippingAddress);

  const downloadReceipt = async (key: string) => {
    try {
      const res = await api.get(
        `/api/payments/${encodeURIComponent(key)}/receipt.pdf`,
        { responseType: "blob" }
      );
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `receipt-${key}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      alert(e?.response?.data?.error || "Could not download receipt.");
    }
  };

  return (
    <SiteLayout>
      <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {/* Top header */}
          <div className="border-b border-zinc-200 px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
                  {r.merchant?.name || "Receipt"}
                </h1>

                {(r.merchant?.addressLine1 || r.merchant?.addressLine2 || r.merchant?.supportEmail) && (
                  <div className="mt-3 space-y-1 text-sm leading-6 text-zinc-600">
                    {r.merchant?.addressLine1 && (
                      <div className="break-words">{r.merchant.addressLine1}</div>
                    )}
                    {r.merchant?.addressLine2 && (
                      <div className="break-words">{r.merchant.addressLine2}</div>
                    )}
                    {r.merchant?.supportEmail && (
                      <div className="break-all">Support: {r.merchant.supportEmail}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="w-full rounded-2xl bg-zinc-50 p-4 sm:w-[300px] sm:shrink-0">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Receipt No
                    </div>
                    <div className="mt-1 break-words text-base font-semibold text-zinc-900">
                      {q.data.receiptNo}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Reference
                    </div>
                    <div className="mt-1 break-all font-mono text-sm text-zinc-900">
                      {r.reference || "—"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Paid At
                    </div>
                    <div className="mt-1 text-sm text-zinc-900">
                      {r.paidAt ? new Date(r.paidAt).toLocaleString() : "—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="border-b border-zinc-200 px-4 py-5 sm:px-6">
            <div className={`grid gap-4 ${shippingEnabled ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Billed To
                </div>
                <div className="mt-2 text-lg font-semibold text-zinc-900">
                  {r.customer?.name || "—"}
                </div>
                <div className="mt-1 break-all text-sm text-zinc-700">
                  {r.customer?.email || "—"}
                </div>
                {r.customer?.phone && (
                  <div className="mt-1 text-sm text-zinc-700">{r.customer.phone}</div>
                )}
              </div>

              {shippingEnabled && (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Ship To
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-zinc-700">
                    {shipToLines.length > 0 ? (
                      shipToLines.map((line, idx) => (
                        <div key={idx} className="break-words">
                          {line}
                        </div>
                      ))
                    ) : (
                      <div>—</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Items - desktop table */}
          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-50">
                  <tr className="border-b border-zinc-200">
                    <th className="px-6 py-3 text-left font-semibold text-zinc-700">Item</th>
                    <th className="px-6 py-3 text-right font-semibold text-zinc-700">Qty</th>
                    <th className="px-6 py-3 text-right font-semibold text-zinc-700">Unit</th>
                    <th className="px-6 py-3 text-right font-semibold text-zinc-700">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {items.map((it: any) => {
                    const qty = Number(it.quantity || 1);
                    const unit = Number(it.unitPrice || 0);
                    const line = Number(it.lineTotal) || unit * qty;

                    return (
                      <tr key={it.id}>
                        <td className="px-6 py-4 align-top">
                          <div className="font-medium text-zinc-900">{it.title}</div>

                          {Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0 && (
                            <div className="mt-1 text-xs text-zinc-600">
                              {it.selectedOptions
                                .map((o: any) => `${o.attribute}: ${o.value}`)
                                .join(" • ")}
                            </div>
                          )}

                          {it.variantSku && (
                            <div className="mt-1 text-xs text-zinc-600">
                              SKU: {it.variantSku}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right text-zinc-800">{qty}</td>
                        <td className="px-6 py-4 text-right text-zinc-800">{ngn.format(unit)}</td>
                        <td className="px-6 py-4 text-right font-medium text-zinc-900">
                          {ngn.format(line)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Items - mobile cards */}
          <div className="space-y-3 px-4 py-4 md:hidden">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Items
            </div>

            {items.map((it: any) => {
              const qty = Number(it.quantity || 1);
              const unit = Number(it.unitPrice || 0);
              const line = Number(it.lineTotal) || unit * qty;

              return (
                <div
                  key={it.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4"
                >
                  <div className="font-medium text-zinc-900">{it.title}</div>

                  {Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0 && (
                    <div className="mt-1 text-xs leading-5 text-zinc-600">
                      {it.selectedOptions
                        .map((o: any) => `${o.attribute}: ${o.value}`)
                        .join(" • ")}
                    </div>
                  )}

                  {it.variantSku && (
                    <div className="mt-1 text-xs text-zinc-600">
                      SKU: {it.variantSku}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-xl bg-zinc-50 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                        Qty
                      </div>
                      <div className="mt-1 font-medium text-zinc-900">{qty}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                        Unit
                      </div>
                      <div className="mt-1 font-medium text-zinc-900">{ngn.format(unit)}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                        Total
                      </div>
                      <div className="mt-1 font-semibold text-zinc-900">{ngn.format(line)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-5 sm:px-6">
            <div className="ml-auto w-full max-w-md space-y-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-zinc-600">Subtotal</span>
                <span className="font-medium text-zinc-900">
                  {ngn.format(toNum(order.subtotal || 0))}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-zinc-600">Tax (Included)</span>
                <span className="font-medium text-zinc-900">
                  {ngn.format(toNum(order.tax || 0))}
                </span>
              </div>

              {shippingEnabled && (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-zinc-600">Shipping</span>
                  <span className="font-medium text-zinc-900">
                    {ngn.format(shippingDisplay)}
                  </span>
                </div>
              )}

              {serviceFee > 0 && (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-zinc-600">Service fee</span>
                  <span className="font-medium text-zinc-900">
                    {ngn.format(serviceFee)}
                  </span>
                </div>
              )}

              <div className="border-t border-zinc-200 pt-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-base font-semibold text-zinc-900">Total</span>
                  <span className="text-base font-semibold text-zinc-900">
                    {ngn.format(toNum(order.total || 0))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="px-4 py-4 sm:px-6">
            {/* Mobile: simple links */}
            <div className="flex flex-col gap-3 sm:hidden">
              <button
                type="button"
                className="text-left text-sm font-medium text-zinc-700 underline underline-offset-4"
                onClick={(e) => {
                  e.stopPropagation();
                  if (paymentId) downloadReceipt(paymentId);
                }}
              >
                Download PDF
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="text-left text-sm font-medium text-zinc-700 underline underline-offset-4"
              >
                Print receipt
              </button>

              <Link
                to="/orders"
                className="text-sm font-medium text-zinc-700 underline underline-offset-4"
              >
                Back to orders
              </Link>
            </div>

            {/* Desktop: keep buttons */}
            <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2">
              <button
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
                onClick={(e) => {
                  e.stopPropagation();
                  if (paymentId) downloadReceipt(paymentId);
                }}
              >
                Download PDF
              </button>

              <button
                onClick={() => window.print()}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
              >
                Print
              </button>

              <Link
                to="/orders"
                className="ml-auto inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
              >
                Back to orders
              </Link>
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
