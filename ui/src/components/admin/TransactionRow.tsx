import { useState } from "react";
import StatusDot from "../StatusDot";
import { Check, ChevronDown, ChevronRight, CreditCard, Link } from "lucide-react";


type AdminPayment = {
    id: string;
    orderId: string;
    userEmail?: string | null;
    amount: number | string;
    status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED' | string;
    provider?: string | null;
    channel?: string | null;
    reference?: string | null;
    createdAt?: string;
    orderStatus?: string;
    items?: AdminPaymentItem[];
};


type AdminPaymentItem = {
    id: string;
    title: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    status?: string;
};

/* ---------------- Utils ---------------- */
const ngn = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
});
function fmtN(n?: number | string) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
}
function fmtDate(s?: string) {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(+d)) return s;
    return d.toLocaleString(undefined, {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function TransactionRow({ tx, onVerify, onRefund }: { tx: AdminPayment; onVerify: () => void; onRefund: () => void }) {
    const [open, setOpen] = useState(false);
    const hasItems = Array.isArray(tx.items) && tx.items.length > 0;
    return (
        <>
            <tr className="hover:bg-black/5">
                <td className="px-3 py-3 font-mono">
                    <div className="flex items-center gap-2">
                        {hasItems ? (
                            <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center justify-center w-6 h-6 rounded-md border hover:bg-black/5">
                                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                        ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border text-zinc-300">•</span>
                        )}
                        <span>{tx.id}</span>
                    </div>
                    {tx.reference && <div className="text-[11px] text-zinc-500 mt-0.5">Ref: {tx.reference}</div>}
                </td>
                <td className="px-3 py-3">
                    <Link to={`/orders?open=${tx.orderId}`} className="text-primary-700 underline">
                        {tx.orderId}
                    </Link>
                </td>
                <td className="px-3 py-3">{tx.userEmail || '—'}</td>
                <td className="px-3 py-3">{ngn.format(fmtN(tx.amount))}</td>
                <td className="px-3 py-3">
                    <StatusDot label={tx.status} />
                </td>
                <td className="px-3 py-3">{fmtDate(tx.createdAt)}</td>
                <td className="px-3 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                        <button
                            onClick={onVerify}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            disabled={['PAID', 'VERIFIED', 'CANCELED', 'REFUNDED'].includes((tx.status || '').toUpperCase())}
                            title={tx.status === 'PAID' ? 'Already verified' : 'Verify payment'}
                        >
                            <Check size={16} /> Verify
                        </button>
                        <button onClick={onRefund} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5" title="Refund">
                            <CreditCard size={16} /> Refund
                        </button>
                    </div>
                </td>
            </tr>

            {open && hasItems && (
                <tr className="bg-zinc-50/60">
                    <td colSpan={7} className="px-3 py-3">
                        <div className="rounded-xl border bg-white">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-zinc-50">
                                        <th className="text-left px-3 py-2">Item</th>
                                        <th className="text-left px-3 py-2">Qty</th>
                                        <th className="text-left px-3 py-2">Unit Price</th>
                                        <th className="text-left px-3 py-2">Line Total</th>
                                        <th className="text-left px-3 py-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {tx.items!.map((it) => (
                                        <tr key={it.id}>
                                            <td className="px-3 py-2">{it.title}</td>
                                            <td className="px-3 py-2">{it.quantity}</td>
                                            <td className="px-3 py-2">{ngn.format(fmtN(it.unitPrice))}</td>
                                            <td className="px-3 py-2">{ngn.format(fmtN(it.lineTotal))}</td>
                                            <td className="px-3 py-2">
                                                <StatusDot label={it.status || '—'} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-zinc-50">
                                        <td colSpan={3} className="px-3 py-2 text-right font-medium">
                                            Order total:
                                        </td>
                                        <td className="px-3 py-2 font-semibold">{ngn.format(fmtN(tx.amount))}</td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}