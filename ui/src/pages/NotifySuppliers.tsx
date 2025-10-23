// src/pages/NotifySuppliers.tsx
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

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

export default function NotifySuppliersPage() {
  const nav = useNavigate();
  const token = useAuthStore((s) => s.token);
  const loc = useLocation();
  const orderId = new URLSearchParams(loc.search).get('orderId') || '';

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const kick = async () => {
    if (!orderId) {
      setErr('Missing orderId.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data } = await api.post<Resp>(`/api/orders/${orderId}/notify-suppliers`, {}, { headers });
      setResp(data);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Could not notify suppliers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Notify Suppliers</h1>

      {err && <div className="p-3 rounded bg-red-50 text-red-700">{err}</div>}
      {loading && <div className="text-sm opacity-70">Sending WhatsApp messages…</div>}

      {resp && (
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
            <div>
              <div className="text-ink font-semibold">Order #{orderId.slice(-6)}</div>
              <div className="text-xs text-ink-soft">
                Reference: <span className="font-mono">{resp.paidReference || '—'}</span>
              </div>
            </div>
            <button
              className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5"
              onClick={kick}
            >
              Re-send
            </button>
          </div>

          <div className="p-4">
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
                    <td className="px-3 py-2">{r.phone || '—'}</td>
                    <td className="px-3 py-2">{r.itemCount}</td>
                    <td className="px-3 py-2">
                      {new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(r.amount || 0)}
                    </td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-emerald-600/10 text-emerald-700 border-emerald-600/20">
                          Sent ({r.mode})
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-rose-500/10 text-rose-700 border-rose-600/20" title={r.error || ''}>
                          Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex gap-2">
              <button className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5" onClick={() => nav('/orders')}>
                Back to orders
              </button>
              <button className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5" onClick={() => nav('/')}>
                Continue shopping
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
