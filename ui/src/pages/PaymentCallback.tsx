import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useQuery } from '@tanstack/react-query';

type VerifyResp = { ok?: boolean; status?: 'PAID' | 'PENDING' | 'FAILED' | 'CANCELED' | 'REFUNDED'; message?: string; };
type StatusResp = { status: 'PAID' | 'PENDING' | 'FAILED' | 'CANCELED' | 'REFUNDED' };

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 15;

export default function PaymentCallback() {
  const nav = useNavigate();
  const loc = useLocation();
  const token = useAuthStore((s) => s.token);

  const [phase, setPhase] = useState<'loading' | 'pending' | 'success' | 'error'>('loading');
  const [msg, setMsg] = useState('Verifying your payment…');
  const [attempt, setAttempt] = useState(0);
  const [remaining, setRemaining] = useState(POLL_MAX_ATTEMPTS);
  const timerRef = useRef<number | null>(null);

  const params = new URLSearchParams(loc.search);
  const orderId = params.get('orderId') || '';
  const reference = params.get('reference') || '';
  const gateway = (params.get('gateway') || '').toLowerCase(); // 'paystack' for hosted card flow

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const meQ = useQuery({
    queryKey: ['me-min'],
    enabled: !!token,
    queryFn: async () => (await api.get('/api/profile/me', { headers: { Authorization: `Bearer ${token}` } })).data as { role: string },
    staleTime: 60_000,
  });
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes((meQ.data?.role || '').toUpperCase());

  const checkStatus = async () => {
    try {
      const { data } = await api.get<StatusResp>('/api/payments/status', {
        params: { orderId, reference },
        headers,
      });

      if (data.status === 'PAID') {
        localStorage.removeItem('cart'); // optional
        setPhase('success');
        setMsg('Payment verified. Redirecting to your orders…');
        return;
      }

      if (data.status === 'FAILED' || data.status === 'CANCELED' || data.status === 'REFUNDED') {
        setPhase('error');
        setMsg('Payment is not successful.');
        return;
      }

      // still pending
      setPhase('pending');
      setMsg('Waiting for confirmation from the payment processor…');
    } catch (e: any) {
      setPhase('error');
      setMsg(e?.response?.data?.error || 'Could not check status right now.');
    }
  };

  const verifyOnceIfCard = async () => {
    // Only try gateway verify for hosted Paystack card flows

    if (gateway !== 'paystack') {
      return;
    }
    try {
      const { data } = await api.post<VerifyResp>(
        '/api/payments/verify',
        { orderId, reference },
        { headers }
      );
      
      if (data.status === 'PAID') {
        localStorage.removeItem('cart');
        setPhase('success');
        setMsg(data.message || 'Payment verified. Redirecting to your orders…');
        return;
      }
      if (data.status === 'FAILED' || data.status === 'CANCELED' || data.status === 'REFUNDED') {
        setPhase('error');
        setMsg(data.message || 'Payment could not be verified.');
        return;
      }

      // pending → fall through to status polling
      setPhase('pending');
      setMsg(data.message || 'Waiting for confirmation from the payment processor…');
    } catch (e: any) {
      // If verify fails (network, etc.), just poll status — webhook can still flip it.
      setPhase('pending');
      setMsg('Awaiting confirmation…');
    }
  };

  // On mount: (1) try verify once if card, then (2) check status
  useEffect(() => {
    (async () => {
      if (!orderId || !reference) {
        setPhase('error');
        setMsg('Missing orderId or reference in the callback URL.');
        return;
      }
      await verifyOnceIfCard();
      await checkStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll DB status (webhook will flip it to PAID)
  useEffect(() => {
    if (phase !== 'pending') return;

    if (remaining <= 0) {
      setPhase('error');
      setMsg('We couldn’t confirm the payment in time. Please check your bank app or try again.');
      return;
    }

    timerRef.current = window.setTimeout(async () => {
      setAttempt((a) => a + 1);
      setRemaining((r) => r - 1);
      await checkStatus();
    }, POLL_INTERVAL_MS) as unknown as number;

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remaining, attempt]);

  const tryAgainNow = async () => {
    setRemaining(POLL_MAX_ATTEMPTS);
    setAttempt(0);
    setPhase('loading');
    setMsg('Re-checking your payment…');
    await checkStatus();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">

      {
        phase === 'success' && (
          <>
            {isAdmin && orderId && (

              <button
                className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                onClick={async () => {
                  try {
                    const res = await api.post(`/api/admin/orders/${orderId}/notify-suppliers`, {}, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
                    alert('Notifications (re)triggered.');
                  } catch (e: any) {
                    alert(e?.response?.data?.error || 'Could not notify suppliers.');
                  }
                }}
              >
                Notify suppliers
              </button>
            )}

            <button
              className="inline-flex items-center justify-center rounded-xl bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700"
              onClick={() => nav('/orders')}
            >
              Go to orders
            </button>
          </>
        )
      }

      {/* Hero: matches dashboard header vibe */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-sky-700 via-sky-600 to-indigo-700 text-white">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(closest-side,rgba(255,255,255,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,0,0,0.15),transparent_60%)]" />
        <div className="relative px-5 md:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                Payment Status
              </h1>
              <p className="text-white/80 text-sm mt-1">
                We’re verifying your transaction and will update this page automatically.
              </p>
            </div>
            {reference && (
              <div className="hidden md:block text-right">
                <div className="text-xs text-white/80">Reference</div>
                <div className="text-sm font-semibold">{reference}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content card */}
      <div className="mt-6 rounded-2xl border bg-white shadow-sm">
        <div className="px-4 md:px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusBadge phase={phase} />
            <div>
              <div className="text-ink font-semibold">
                {phase === 'loading' && 'Verifying payment'}
                {phase === 'pending' && 'Awaiting confirmation'}
                {phase === 'success' && 'Payment confirmed'}
                {phase === 'error' && 'Payment not verified'}
              </div>
              <div className="text-xs text-ink-soft">
                {orderId ? <>Order: <span className="font-mono">{orderId}</span></> : 'No order id provided'}
              </div>
            </div>
          </div>

          {(phase === 'pending' || phase === 'loading') && (
            <div className="text-xs text-ink-soft">
              {phase === 'pending' ? `Attempts left: ${remaining}` : 'Please wait…'}
            </div>
          )}
        </div>

        <div className="p-4 md:p-6">
          <p className="text-sm text-ink">{msg}</p>

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-3">
            {phase === 'pending' && (
              <>
                <button
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                  onClick={tryAgainNow}
                >
                  Try again now
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                  onClick={() => nav('/orders')}
                >
                  View orders
                </button>
                <p className="text-xs text-ink-soft mt-1 w-full">
                  Tip: If your bank app shows the transfer as successful, it may take a moment for us to receive confirmation.
                </p>
              </>
            )}

            {phase === 'loading' && (
              <div className="text-sm text-ink-soft animate-pulse">Checking payment…</div>
            )}

            {phase === 'success' && (
              <>
                <button
                  className="inline-flex items-center justify-center rounded-xl bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700"
                  onClick={() => nav('/orders')}
                >
                  Go to orders
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                  onClick={() => nav('/')}
                >
                  Continue shopping
                </button>
              </>
            )}

            {phase === 'error' && (
              <>
                <button
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                  onClick={tryAgainNow}
                >
                  Try again
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                  onClick={() => nav('/orders')}
                >
                  View orders
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                  onClick={() => nav('/cart')}
                >
                  Back to cart
                </button>
                <p className="text-xs text-ink-soft mt-1 w-full">
                  If you paid by bank transfer, please give it a minute. If it still doesn’t reflect, keep your reference handy and contact support.
                </p>
              </>
            )}
          </div>

          {/* Sub-info grid */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <InfoTile label="Order ID" value={orderId || '—'} />
            <InfoTile label="Reference" value={reference || '—'} />
            <InfoTile
              label="Auto-check cadence"
              value={`${Math.floor(POLL_INTERVAL_MS / 1000)}s (${POLL_MAX_ATTEMPTS} tries)`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- tiny presentational helpers (reused across dashboard pages) ---------- */

function StatusBadge({ phase }: { phase: 'loading' | 'pending' | 'success' | 'error' }) {
  let label = 'Loading';
  let cls = 'bg-zinc-500/10 text-zinc-700 border-zinc-600/20';
  if (phase === 'pending') { label = 'Pending'; cls = 'bg-amber-500/10 text-amber-700 border-amber-600/20'; }
  if (phase === 'success') { label = 'Paid'; cls = 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20'; }
  if (phase === 'error') { label = 'Failed'; cls = 'bg-rose-500/10 text-rose-700 border-rose-600/20'; }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}>
      {label}
    </span>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="text-sm font-semibold text-ink mt-0.5 break-all">{value}</div>
    </div>
  );
}
