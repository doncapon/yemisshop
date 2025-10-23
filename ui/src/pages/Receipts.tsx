import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type ReceiptResp = {
    ok: boolean;
    receiptNo: string;
    issuedAt: string;
    data: any; // snapshot structure we created in backend
};

const ngn = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

export default function ReceiptPage() {
    const { paymentId = '' } = useParams();
    const token = useAuthStore(s => s.token);

    const q = useQuery({
        queryKey: ['receipt', paymentId],
        enabled: !!token && !!paymentId,
        queryFn: async () => (await api.get<ReceiptResp>(`/api/payments/${paymentId}/receipt`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })).data,
    });

    useEffect(() => {
        document.title = q.data?.receiptNo ? `Receipt ${q.data.receiptNo}` : 'Receipt';
    }, [q.data?.receiptNo]);

    if (q.isLoading) return <div className="p-6">Loading…</div>;
    if (q.error || !q.data?.ok) return <div className="p-6 text-rose-600">Receipt not available.</div>;

    const r = q.data.data;
    const items = r.order?.items || [];
    const pdfUrl = `/api/payments/${paymentId}/receipt.pdf`;
    const downloadReceipt = async (reference: string) => {
        try {
            const res = await api.get(`/api/payments/${reference}/receipt.pdf`, {
                responseType: 'blob',
                // api client already sets Authorization, but this is fine too:
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            const blob = new Blob([res.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            // open in a new tab:
            const w = window.open(url, '_blank');
            if (!w) {
                // fallback to download if a popup blocker intervenes
                const a = document.createElement('a');
                a.href = url;
                a.download = `receipt-${reference}.pdf`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
            // cleanup later
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (e: any) {
            alert(e?.response?.data?.error || 'Could not download receipt.');
        }
    };
    return (
        <div className="max-w-3xl mx-auto p-6">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h1 className="text-xl font-semibold">{r.merchant?.name || 'Receipt'}</h1>
                    <div className="text-sm text-zinc-600">
                        {r.merchant?.addressLine1}{r.merchant?.addressLine2 ? `, ${r.merchant?.addressLine2}` : ''}
                    </div>
                    {r.merchant?.supportEmail && <div className="text-sm text-zinc-600">Support: {r.merchant.supportEmail}</div>}
                </div>
                <div className="text-right">
                    <div className="text-sm">Receipt No</div>
                    <div className="font-semibold">{q.data.receiptNo}</div>
                    <div className="text-sm mt-2">Reference</div>
                    <div className="font-mono">{r.reference}</div>
                    <div className="text-sm mt-2">Paid At</div>
                    <div>{new Date(r.paidAt).toLocaleString()}</div>
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 border rounded-xl bg-white p-4 mb-4">
                <div>
                    <div className="text-sm text-zinc-600">Billed To</div>
                    <div className="font-medium">{r.customer?.name || '—'}</div>
                    <div className="text-sm">{r.customer?.email || '—'}</div>
                    {r.customer?.phone && <div className="text-sm">{r.customer.phone}</div>}
                </div>
                <div>
                    <div className="text-sm text-zinc-600">Ship To</div>
                    <div className="text-sm">
                        {[r.order?.shippingAddress?.houseNumber, r.order?.shippingAddress?.streetName].filter(Boolean).join(' ')}
                    </div>
                    <div className="text-sm">
                        {[r.order?.shippingAddress?.town, r.order?.shippingAddress?.city].filter(Boolean).join(', ')}
                    </div>
                    <div className="text-sm">
                        {[r.order?.shippingAddress?.state, r.order?.shippingAddress?.country].filter(Boolean).join(', ')}
                    </div>
                </div>
            </div>

            <div className="rounded-xl border bg-white overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead className="bg-zinc-50">
                        <tr>
                            <th className="text-left px-3 py-2">Item</th>
                            <th className="text-right px-3 py-2">Qty</th>
                            <th className="text-right px-3 py-2">Unit</th>
                            <th className="text-right px-3 py-2">Line Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {items.map((it: any) => {
                            const qty = Number(it.quantity || 1);
                            const unit = Number(it.unitPrice || 0);
                            const line = Number(it.lineTotal || unit * qty);
                            return (
                                <tr key={it.id}>
                                    <td className="px-3 py-2">
                                        <div className="font-medium">{it.title}</div>
                                        {Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0 && (
                                            <div className="text-xs text-zinc-600">
                                                {it.selectedOptions.map((o: any) => `${o.attribute}: ${o.value}`).join(' • ')}
                                            </div>
                                        )}
                                        {it.variantSku && <div className="text-xs text-zinc-600">SKU: {it.variantSku}</div>}
                                    </td>
                                    <td className="px-3 py-2 text-right">{qty}</td>
                                    <td className="px-3 py-2 text-right">{ngn.format(unit)}</td>
                                    <td className="px-3 py-2 text-right">{ngn.format(line)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="bg-zinc-50">
                            <td className="px-3 py-2 font-medium text-right" colSpan={3}>Subtotal</td>
                            <td className="px-3 py-2 text-right">{ngn.format(Number(r.order?.subtotal || 0))}</td>
                        </tr>
                        <tr className="bg-zinc-50">
                            <td className="px-3 py-2 font-medium text-right" colSpan={3}>Tax</td>
                            <td className="px-3 py-2 text-right">{ngn.format(Number(r.order?.tax || 0))}</td>
                        </tr>
                        <tr className="bg-zinc-50">
                            <td className="px-3 py-2 font-medium text-right" colSpan={3}>Shipping</td>
                            <td className="px-3 py-2 text-right">{ngn.format(Number(r.order?.shipping || 0))}</td>
                        </tr>
                        <tr className="bg-zinc-50">
                            <td className="px-3 py-2 font-semibold text-right" colSpan={3}>Total</td>
                            <td className="px-3 py-2 font-semibold text-right">{ngn.format(Number(r.order?.total || 0))}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div className="mt-4 flex gap-2">
                <button
                    className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-1.5 hover:bg-black/5"
                    onClick={(e) => {
                        e.stopPropagation();
                        downloadReceipt(paymentId!!);
                    }}
                >
                    Download PDF
                </button>
                <button onClick={() => window.print()} className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5">
                    Print
                </button>
                <Link to="/orders" className="ml-auto rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5">
                    Back to orders
                </Link>
            </div>
        </div>
    );
}
