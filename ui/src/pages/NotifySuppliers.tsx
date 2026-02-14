// src/pages/NotifySuppliers.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

type Result = {
  supplierId: string;
  supplierName: string;
  phone: string | null;
  itemCount: number;
  amount: number;
  ok: boolean;
  mode: string;
  error?: string;
};

type Resp = {
  ok: boolean;
  orderId: string;
  paidReference: string | null;
  totalSuppliers: number;
  results: Result[];
};

function pickErrorMessage(e: any): string {
  const data = e?.response?.data;
  const msg =
    data?.error ??
    data?.message ??
    e?.message ??
    (typeof data === "string" ? data : null);

  if (typeof msg === "string" && msg.trim()) return msg;

  try {
    return JSON.stringify(data);
  } catch {
    return "Could not notify suppliers.";
  }
}

export default function NotifySuppliersPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const orderId = useMemo(() => new URLSearchParams(loc.search).get("orderId") || "", [loc.search]);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Prevent double-run (e.g., React 18 StrictMode) AND prevent overlap resends
  const kickedOnce = useRef(false);
  const inFlight = useRef<AbortController | null>(null);

  const money = useMemo(
    () => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }),
    []
  );

  const kick = useCallback(async () => {
    if (!orderId) {
      setErr("Missing orderId.");
      setResp(null);
      return;
    }

    // If something is already running, cancel it first
    if (inFlight.current) {
      inFlight.current.abort();
      inFlight.current = null;
    }

    const ac = new AbortController();
    inFlight.current = ac;

    setLoading(true);
    setErr(null);

    try {
      const { data } = await api.post<Resp>(`/api/orders/${orderId}/notify-suppliers`, {}, { signal: ac.signal });
      setResp(data);
    } catch (e: any) {
      // Ignore abort errors (user navigated away or retriggered)
      if (e?.name === "CanceledError" || e?.name === "AbortError") return;
      setErr(pickErrorMessage(e));
      setResp(null);
    } finally {
      // Only clear loading if this is still the active request
      if (inFlight.current === ac) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, [orderId]);

  useEffect(() => {
    if (!orderId) {
      setErr("Missing orderId.");
      setResp(null);
      return;
    }

    if (kickedOnce.current) return;
    kickedOnce.current = true;

    kick();

    return () => {
      // cancel any pending request on unmount / route change
      if (inFlight.current) {
        inFlight.current.abort();
        inFlight.current = null;
      }
    };
  }, [orderId, kick]);

  return (
    <SiteLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Notify Suppliers</h1>

        {!orderId && (
          <div className="p-3 rounded bg-amber-50 text-amber-800">
            Missing <span className="font-mono">orderId</span> in the URL.
          </div>
        )}

        {err && <div className="p-3 rounded bg-red-50 text-red-700">{err}</div>}

        {loading && <div className="text-sm opacity-70">Sending WhatsApp messages…</div>}

        {resp && (
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between gap-3">
              <div>
                <div className="text-ink font-semibold">Order #{(resp.orderId || orderId).slice(-6)}</div>
                <div className="text-xs text-ink-soft">
                  Reference: <span className="font-mono">{resp.paidReference || "—"}</span>
                </div>
                <div className="text-xs text-ink-soft">Suppliers: {resp.totalSuppliers ?? resp.results.length}</div>
              </div>

              <button
                className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-50 disabled:hover:bg-white"
                onClick={kick}
                disabled={loading || !orderId}
                title={loading ? "Please wait…" : "Send again"}
              >
                {loading ? "Sending…" : "Re-send"}
              </button>
            </div>

            <div className="p-4">
              {resp.results.length === 0 ? (
                <div className="text-sm text-ink-soft">No suppliers were found for this order.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-zinc-50">
                      <tr>
                        <th className="text-left px-3 py-2">Supplier</th>
                        <th className="text-left px-3 py-2">Phone</th>
                        <th className="text-left px-3 py-2">Items</th>
                        <th className="text-left px-3 py-2">Total</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {resp.results.map((r) => (
                        <tr key={r.supplierId}>
                          <td className="px-3 py-2">{r.supplierName}</td>
                          <td className="px-3 py-2">{r.phone || "—"}</td>
                          <td className="px-3 py-2">{r.itemCount}</td>
                          <td className="px-3 py-2">{money.format(Number(r.amount || 0))}</td>
                          <td className="px-3 py-2">
                            {r.ok ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-emerald-600/10 text-emerald-700 border-emerald-600/20">
                                Sent ({r.mode})
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-rose-500/10 text-rose-700 border-rose-600/20"
                                title={r.error || ""}
                              >
                                Failed
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5"
                  onClick={() => nav("/orders")}
                >
                  Back to orders
                </button>
                <button
                  className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5"
                  onClick={() => nav("/")}
                >
                  Continue shopping
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
