// src/pages/Payment.tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useModal } from "../components/ModalProvider";
import { markPaystackExit } from '../utils/paystackReturn';

type InitResp = {
  reference: string;
  amount?: number; // may be present for trial/inline-bank
  currency?: string; // "NGN"
  mode: 'trial' | 'paystack' | 'paystack_inline_bank';
  authorization_url?: string;
  bank?: {
    bank_name: string;
    account_name: string;
    account_number: string;
  };
};

export default function Payment() {
  const nav = useNavigate();
  const token = useAuthStore((s) => s.token);
  const loc = useLocation();
  const orderId = new URLSearchParams(loc.search).get('orderId') || '';

  const [loading, setLoading] = useState(false);
  const [init, setInit] = useState<InitResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { openModal } = useModal();

  // Kick off init
  useEffect(() => {
    if (!orderId) return;
    if (!token) {
      setErr('You must be logged in to pay.');
      // We do not immediately navigate away to let user see the message.
    }

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data } = await api.post<InitResp>(
          '/api/payments/init',
          { orderId, channel: 'card' }, // or 'bank_transfer'
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
        );
        setInit(data);
      } catch (e: any) {
        setErr(e?.response?.data?.error || 'Failed to init payment');
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId, token]);

  // If the backend returned Paystack hosted checkout, redirect safely.
  useEffect(() => {
    if (init?.mode === 'paystack' && init.authorization_url) {
      markPaystackExit();
      window.location.href = init.authorization_url;
    }
  }, [init?.mode, init?.authorization_url]);

  const markPaidManual = async () => {
    if (!init) return;
    setLoading(true);
    setErr(null);
    try {
      await api.post(
        '/api/payments/verify',
        { reference: init.reference, orderId },
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      openModal({ title: 'Payment', message: 'Payment verified. Thank you!' });
      nav('/orders');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  if (!orderId) {
    return <div className="max-w-md mx-auto p-6">Missing order ID.</div>;
  }

  // For pure Paystack hosted checkout, we immediately redirected above.
  const isBankFlow = init?.mode === 'trial' || init?.mode === 'paystack_inline_bank';

  return (
    <div className="max-w-lg mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Payment</h1>

      {err && <div className="p-2 rounded bg-red-50 text-red-700">{err}</div>}
      {loading && <div className="text-sm opacity-70">Loading…</div>}

      {!loading && init && isBankFlow && (
        <div className="space-y-4">
          <div className="border rounded p-4 bg-white">
            <h2 className="font-medium mb-2">Bank Transfer Details</h2>

            {init.mode === 'trial' && (
              <p className="text-sm mb-2">
                Trial mode: use the demo bank details below and click “I’ve transferred” to continue.
              </p>
            )}

            {init.bank ? (
              <ul className="text-sm space-y-1">
                <li><b>Bank:</b> {init.bank.bank_name}</li>
                <li><b>Account Name:</b> {init.bank.account_name}</li>
                <li><b>Account Number:</b> {init.bank.account_number}</li>
              </ul>
            ) : (
              <p className="text-sm">
                Bank details will be shown here. If you don’t see them, confirm your backend mode and keys.
              </p>
            )}

            {Number.isFinite(init.amount) && init.currency && (
              <div className="mt-3 text-sm">
                <b>Amount:</b> {init.currency} {Number(init.amount).toLocaleString()}
              </div>
            )}

            <div className="mt-1 text-xs opacity-70">
              Use your order reference in transfer notes if possible:<br />
              <code>{init.reference}</code>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="rounded-md border bg-accent-500 px-4 py-2 text-white hover:bg-accent-600 transition disabled:opacity-50"
              disabled={loading}
              onClick={markPaidManual}
              title="I have completed the bank transfer"
            >
              I’ve transferred
            </button>
            <button
              className="rounded-md border px-4 py-2"
              onClick={() => nav('/cart')}
            >
              Back to cart
            </button>
          </div>
        </div>
      )}

      {/* If init exists but it's hosted Paystack, the effect above will redirect. */}
      {!loading && init && init.mode === 'paystack' && !init.authorization_url && (
        <div className="text-sm opacity-70">
          Awaiting Paystack authorization URL…
        </div>
      )}
    </div>
  );
}
