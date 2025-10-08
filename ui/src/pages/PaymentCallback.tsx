import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type VerifyResp = {
  ok?: boolean;
  status?: 'PAID' | 'PENDING' | 'FAILED';
  message?: string;
};

const POLL_INTERVAL_MS = 4000;   // every 4 seconds
const POLL_MAX_ATTEMPTS = 15;    // ~60 seconds

export default function PaymentCallback() {
  const nav = useNavigate();
  const loc = useLocation();
  const token = useAuthStore((s) => s.token);

  const [phase, setPhase] = useState<'loading' | 'pending' | 'success' | 'error'>('loading');
  const [msg, setMsg] = useState('Verifying your payment…');
  const [attempt, setAttempt] = useState(0);
  const [remaining, setRemaining] = useState(POLL_MAX_ATTEMPTS);
  const timerRef = useRef<number | null>(null);

  // Extract params
  const params = new URLSearchParams(loc.search);
  const orderId = params.get('orderId') || '';
  const reference = params.get('reference') || '';

  const verifyOnce = async () => {
    if (!orderId || !reference) {
      setPhase('error');
      setMsg('Missing orderId or reference in the callback URL.');
      return;
    }

    try {
      const { data } = await api.post<VerifyResp>(
        '/api/payments/verify',
        { orderId, reference },
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      // Normalize message
      const info = data?.message || '';

      if (data?.status === 'PAID') {
        localStorage.removeItem('cart'); // optional
        setPhase('success');
        setMsg(info || 'Payment verified. Redirecting to your orders…');
        // short delay then redirect
        window.setTimeout(() => nav('/orders'), 1200);
        return;
      }

      if (data?.status === 'FAILED') {
        setPhase('error');
        setMsg(info || 'Payment could not be verified. Please try again.');
        return;
      }

      // Status is PENDING (or unknown -> treat as pending)
      setPhase('pending');
      setMsg(info || 'Waiting for confirmation from the payment processor…');

    } catch (e: any) {
      const em =
        e?.response?.data?.error ||
        e?.message ||
        'Verification failed. Please try again or contact support.';
      setPhase('error');
      setMsg(em);
    }
  };

  // First verification on mount
  useEffect(() => {
    verifyOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while pending
  useEffect(() => {
    if (phase !== 'pending') return;

    // guard: stop polling when out of attempts
    if (remaining <= 0) {
      setPhase('error');
      setMsg('We couldn’t confirm the payment in time. Please check your bank app or try again.');
      return;
    }

    // schedule next verify
    timerRef.current = window.setTimeout(async () => {
      setAttempt(a => a + 1);
      setRemaining(r => r - 1);
      await verifyOnce();
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
    // reset polling window
    setRemaining(POLL_MAX_ATTEMPTS);
    setAttempt(0);
    setPhase('loading');
    setMsg('Re-checking your payment…');
    await verifyOnce();
  };

  return (
    <div className="max-w-md mx-auto p-6 text-center">
      {/* LOADING */}
      {phase === 'loading' && (
        <>
          <div className="animate-pulse text-sm opacity-70">Please wait…</div>
          <h1 className="text-xl font-semibold mt-2">Verifying payment</h1>
          <p className="mt-2 text-sm">{msg}</p>
        </>
      )}

      {/* PENDING */}
      {phase === 'pending' && (
        <>
          <h1 className="text-xl font-semibold text-primary-700">Almost there…</h1>
          <p className="mt-2 text-sm">{msg}</p>
          <div className="mt-4 text-xs opacity-70">
            Checking again in a few seconds. Attempts left: {remaining}
          </div>
          <div className="mt-5 flex gap-3 justify-center">
            <button className="rounded border px-4 py-2" onClick={tryAgainNow}>
              Try again now
            </button>
            <button className="rounded border px-4 py-2" onClick={() => nav('/orders')}>
              View orders
            </button>
          </div>
          <p className="mt-4 text-xs opacity-60">
            Tip: If your bank app shows the transfer as successful, it may take a moment for us to receive confirmation.
          </p>
        </>
      )}

      {/* SUCCESS */}
      {phase === 'success' && (
        <>
          <h1 className="text-xl font-semibold text-green-600">Payment confirmed</h1>
          <p className="mt-2 text-sm">{msg}</p>
          <button className="mt-4 rounded border px-4 py-2" onClick={() => nav('/orders')}>
            Go to orders
          </button>
        </>
      )}

      {/* ERROR */}
      {phase === 'error' && (
        <>
          <h1 className="text-xl font-semibold text-red-600">Payment not verified</h1>
          <p className="mt-2 text-sm">{msg}</p>
          <div className="mt-5 flex gap-3 justify-center">
            <button className="rounded border px-4 py-2" onClick={tryAgainNow}>
              Try again
            </button>
            <button className="rounded border px-4 py-2" onClick={() => nav('/orders')}>
              View orders
            </button>
            <button className="rounded border px-4 py-2" onClick={() => nav('/cart')}>
              Back to cart
            </button>
          </div>
          <p className="mt-4 text-xs opacity-60">
            If you paid by bank transfer, please give it a minute. If it still doesn’t reflect, keep your reference handy and contact support.
          </p>
        </>
      )}
    </div>
  );
}
