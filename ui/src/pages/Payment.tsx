// src/pages/Payment.tsx
import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useModal } from "../components/ModalProvider";
import { markPaystackExit } from '../utils/paystackReturn';
import SiteLayout from '../layouts/SiteLayout';

type InitResp = {
  reference: string;
  amount?: number;
  currency?: string;
  mode: 'trial' | 'paystack' | 'paystack_inline_bank';
  authorization_url?: string;
  bank?: {
    bank_name: string;
    account_name: string;
    account_number: string;
  };
};

const AUTO_REDIRECT_KEY = 'paystack:autoRedirect';
const LAST_REF_KEY = 'paystack:lastRef';

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

export default function Payment() {
  const nav = useNavigate();
  const token = useAuthStore((s) => s.token);
  const loc = useLocation();
  const orderId = new URLSearchParams(loc.search).get('orderId') || '';

  // 🔹 NEW: read estimated totals (incl. service fee) from navigation state
  const state = (loc.state || {}) as any;
  const estimatedTotal =
    typeof state.total === 'number'
      ? state.total
      : state.total
      ? Number(state.total) || undefined
      : undefined;
  const estimatedServiceFeeTotal =
    typeof state.serviceFeeTotal === 'number'
      ? state.serviceFeeTotal
      : state.serviceFeeTotal
      ? Number(state.serviceFeeTotal) || undefined
      : undefined;

  const [loading, setLoading] = useState(false);
  const [init, setInit] = useState<InitResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { openModal } = useModal();
  const initOnce = useRef(false);

  const [showHosted, setShowHosted] = useState(false);
  const [autoRedirect, setAutoRedirect] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_REDIRECT_KEY) === '1';
    } catch {
      return false;
    }
  });

  const gotoOrders = () => nav('/orders');

  useEffect(() => {
    if (!orderId) return;
    if (initOnce.current) return;
    initOnce.current = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data } = await api.post<InitResp>(
          '/api/payments/init',
          { orderId, channel: 'paystack' },
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );
        setInit(data);

        try {
          localStorage.setItem(
            LAST_REF_KEY,
            JSON.stringify({
              reference: data.reference,
              orderId,
              at: new Date().toISOString(),
            }),
          );
        } catch {}

        if (data.mode === 'paystack' && data.authorization_url) {
          if (localStorage.getItem(AUTO_REDIRECT_KEY) === '1') {
            markPaystackExit();
            window.location.href = data.authorization_url;
          } else {
            setShowHosted(true);
          }
        }
      } catch (e: any) {
        setErr(e?.response?.data?.error || 'Failed to init payment');
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId, token]);

  const markPaidManual = async () => {
    if (!init) return;
    setLoading(true);
    setErr(null);
    try {
      await api.post(
        '/api/payments/verify',
        { reference: init.reference, orderId },
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      openModal({ title: 'Payment', message: 'Payment verified. Thank you!' });
      nav(`/payment-callback?orderId=${orderId}&reference=${init.reference}`);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  if (!orderId) {
    return (
      <SiteLayout>
        <div className="max-w-md mx-auto p-6">Missing order ID.</div>
      </SiteLayout>
    );
  }

  const isBankFlow =
    init?.mode === 'trial' || init?.mode === 'paystack_inline_bank';

  // ---------- helpers ----------
  const copyRef = async () => {
    if (!init?.reference) return;
    try {
      await navigator.clipboard.writeText(init.reference);
      openModal({
        title: 'Reference copied',
        message: 'Payment reference copied to clipboard.',
      });
    } catch {
      openModal({
        title: 'Copy failed',
        message: 'Select the reference and copy it manually.',
      });
    }
  };

  const shareRef = async () => {
    if (!init?.reference) return;
    const text = `Payment reference: ${init.reference}\nOrder: ${orderId}`;
    const url = init.authorization_url || window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Payment Reference', text, url });
      } catch {
        // ignore
      }
    } else {
      await copyRef();
    }
  };

  const downloadRef = () => {
    if (!init?.reference) return;
    const blob = new Blob(
      [
        `Payment Reference: ${init.reference}\n`,
        `Order ID: ${orderId}\n`,
        init.amount && init.currency
          ? `Backend amount: ${init.currency} ${Number(init.amount).toLocaleString()}\n`
          : '',
        `Saved: ${new Date().toLocaleString()}\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-ref-${init.reference}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const goToPaystack = () => {
    if (!init?.authorization_url) return;
    markPaystackExit();
    window.location.href = init.authorization_url;
  };

  const toggleAuto = (v: boolean) => {
    setAutoRedirect(v);
    try {
      localStorage.setItem(AUTO_REDIRECT_KEY, v ? '1' : '0');
    } catch {}
  };

  // ---------- Hosted modal ----------
  const HostedCheckoutModal = () => {
    if (!init?.authorization_url) return null;

    // 🔹 pick what to show as "Total payable"
    const displayTotal =
      typeof estimatedTotal === 'number' && estimatedTotal > 0
        ? estimatedTotal
        : typeof init.amount === 'number'
        ? init.amount
        : undefined;

    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
      >
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border">
          <div className="px-5 py-4 border-b">
            <h2 className="text-lg font-semibold">Before you pay</h2>
            <p className="text-sm text-zinc-600 mt-1">
              Save your payment reference. You’ll need it if you contact support.
            </p>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <div className="text-xs text-zinc-500">Payment Reference</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="px-2 py-1 rounded bg-zinc-100 text-zinc-900 text-sm">
                  {init.reference}
                </code>
                <button
                  className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5"
                  onClick={copyRef}
                >
                  Copy
                </button>
                <button
                  className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5"
                  onClick={shareRef}
                >
                  Share
                </button>
                <button
                  className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5"
                  onClick={downloadRef}
                >
                  Download .txt
                </button>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                Tip: We’ve also stored this reference locally on your device.
              </div>
            </div>

            {/* 🔹 Show total payable including service fee when we have it */}
            {displayTotal !== undefined && (
              <div className="text-sm">
                <b>Total payable</b>{' '}
                <span className="font-semibold">
                  {ngn.format(displayTotal)}
                </span>
                {estimatedTotal &&
                  init.amount &&
                  estimatedTotal !== init.amount && (
                    <div className="text-[10px] text-zinc-500">
                      Includes estimated service &amp; gateway fees. Backend
                      amount ({ngn.format(init.amount)}) will be reconciled on
                      the receipt.
                    </div>
                  )}
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={autoRedirect}
                onChange={(e) => toggleAuto(e.target.checked)}
              />
              Always skip this step and go straight to Paystack next time
            </label>
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5 text-sm"
                onClick={gotoOrders}
              >
                Pay later
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90 text-sm"
                onClick={goToPaystack}
              >
                Continue to Paystack
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <SiteLayout>
      <div className="max-w-lg mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Payment</h1>

        {err && (
          <div className="p-2 rounded bg-red-50 text-red-700">
            {err}
          </div>
        )}
        {loading && (
          <div className="text-sm opacity-70">
            Loading…
          </div>
        )}

        {showHosted &&
          init?.mode === 'paystack' && (
            <div className="rounded-xl border bg-amber-50 text-amber-800 px-4 py-2 text-sm">
              You’re about to continue to Paystack. Please confirm your total and
              save your reference.
            </div>
          )}

        {showHosted &&
          init?.mode === 'paystack' && (
            <HostedCheckoutModal />
          )}

        {/* Inline bank / trial */}
        {!loading && init && isBankFlow && (
          <div className="space-y-4">
            <div className="border rounded p-4 bg-white">
              <h2 className="font-medium mb-2">
                Bank Transfer Details
              </h2>

              {init.mode === 'trial' && (
                <p className="text-sm mb-2">
                  Trial mode: use the demo bank details below and click “I’ve
                  transferred” to continue.
                </p>
              )}

              {init.bank ? (
                <ul className="text-sm space-y-1">
                  <li>
                    <b>Bank:</b> {init.bank.bank_name}
                  </li>
                  <li>
                    <b>Account Name:</b>{' '}
                    {init.bank.account_name}
                  </li>
                  <li>
                    <b>Account Number:</b>{' '}
                    {init.bank.account_number}
                  </li>
                </ul>
              ) : (
                <p className="text-sm">
                  Bank details will be shown here.
                </p>
              )}

              {/* 🔹 Show total payable here too */}
              {estimatedTotal && (
                <div className="mt-3 text-sm">
                  <b>Total payable</b>{' '}
                  <span className="font-semibold">
                    {ngn.format(estimatedTotal)}
                  </span>
                  {estimatedServiceFeeTotal && (
                    <div className="text-[10px] text-zinc-500">
                      Includes estimated service &amp; gateway
                      fees: {ngn.format(estimatedServiceFeeTotal)}
                    </div>
                  )}
                </div>
              )}

              {!estimatedTotal &&
                init.amount &&
                init.currency && (
                  <div className="mt-3 text-sm">
                    <b>Amount:</b>{' '}
                    {init.currency}{' '}
                    {Number(init.amount).toLocaleString()}
                  </div>
                )}

              <div className="mt-1 text-xs opacity-70">
                Use your order reference in transfer notes:
                <br />
                <code>{init.reference}</code>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="rounded-md border bg-black text-white px-4 py-2 hover:opacity-90 transition disabled:opacity-50"
                disabled={loading}
                onClick={markPaidManual}
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

        {!loading &&
          init &&
          init.mode === 'paystack' &&
          !init.authorization_url && (
            <div className="text-sm opacity-70">
              Awaiting Paystack authorization URL…
            </div>
          )}
      </div>
    </SiteLayout>
  );
}
