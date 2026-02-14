// src/pages/Payment.tsx
import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
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
  const loc = useLocation();
  const orderId = new URLSearchParams(loc.search).get('orderId') || '';

  // 🔹 Read estimated totals (incl. service fee) from navigation state
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
        // ✅ Cookie auth: rely on httpOnly session cookie
        const { data } = await api.post<InitResp>(
          '/api/payments/init',
          { orderId, channel: 'paystack' },
          { withCredentials: true },
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
  }, [orderId]);

  const markPaidManual = async () => {
    if (!init) return;
    setLoading(true);
    setErr(null);
    try {
      // ✅ Cookie auth
      await api.post(
        '/api/payments/verify',
        { reference: init.reference, orderId },
        { withCredentials: true },
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
        <div className="mx-auto max-w-md p-4 sm:p-6">
          <div className="rounded-2xl border bg-white p-4 text-sm">
            Missing order ID.
          </div>
        </div>
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

    // pick what to show as "Total payable"
    const displayTotal =
      typeof estimatedTotal === 'number' && estimatedTotal > 0
        ? estimatedTotal
        : typeof init.amount === 'number'
        ? init.amount
        : undefined;

    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/50">
        {/* Mobile sheet: taller + more room for details */}
        <div className="fixed inset-x-0 bottom-0 sm:inset-0 sm:grid sm:place-items-center">
          <div
            className="
              w-full sm:max-w-lg sm:mx-4
              bg-white border shadow-2xl
              rounded-t-2xl sm:rounded-2xl
              h-[92vh] sm:h-auto
              max-h-[92vh] sm:max-h-[80vh]
              flex flex-col
            "
          >
            {/* ✅ smaller header */}
            <div className="px-4 py-3 border-b flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-semibold leading-tight">
                  Before you pay
                </h2>
                <p className="text-[11px] sm:text-sm text-zinc-600 mt-1 leading-snug">
                  Save your payment reference. You’ll need it if you contact support.
                </p>
              </div>

              <button
                aria-label="Close"
                className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-black/5"
                onClick={() => setShowHosted(false)}
              >
                ✕
              </button>
            </div>

            {/* ✅ BIG scroll area (details) */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* Reference block (less padding, less nested whitespace) */}
              <div className="rounded-xl border bg-zinc-50 p-3">
                <div className="text-[11px] text-zinc-500">Payment Reference</div>

                <code className="mt-2 block w-full rounded-lg bg-white border px-3 py-2 text-sm break-all">
                  {init.reference}
                </code>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    className="rounded-lg border bg-white hover:bg-black/5 py-2 text-xs"
                    onClick={copyRef}
                  >
                    Copy
                  </button>
                  <button
                    className="rounded-lg border bg-white hover:bg-black/5 py-2 text-xs"
                    onClick={shareRef}
                  >
                    Share
                  </button>
                  <button
                    className="rounded-lg border bg-white hover:bg-black/5 py-2 text-xs"
                    onClick={downloadRef}
                  >
                    Download
                  </button>
                </div>

                <div className="mt-2 text-[10px] text-zinc-500">
                  Tip: We’ve also stored this reference locally on your device.
                </div>
              </div>

              {/* Total payable */}
              {displayTotal !== undefined && (
                <div className="rounded-xl border p-3">
                  <div className="text-[11px] text-zinc-500">Total payable</div>
                  <div className="text-lg font-semibold mt-1">
                    {ngn.format(displayTotal)}
                  </div>

                  {estimatedTotal &&
                    init.amount &&
                    estimatedTotal !== init.amount && (
                      <div className="text-[10px] text-zinc-500 mt-1 leading-snug">
                        Includes estimated service &amp; gateway fees. Backend amount ({ngn.format(init.amount)}) will be reconciled on the receipt.
                      </div>
                    )}

                  {estimatedServiceFeeTotal ? (
                    <div className="text-[10px] text-zinc-500 mt-1">
                      Estimated service &amp; gateway fees: {ngn.format(estimatedServiceFeeTotal)}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* ✅ smaller footer + smaller buttons */}
            <div className="px-4 py-3 border-t bg-white space-y-2">
              <label className="flex items-start gap-2 text-[10px] sm:text-xs text-zinc-600 leading-snug">
                <input
                  className="mt-0.5"
                  type="checkbox"
                  checked={autoRedirect}
                  onChange={(e) => toggleAuto(e.target.checked)}
                />
                <span>
                  Always skip this step and go straight to Paystack next time
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-xl border bg-white hover:bg-black/5 py-2.5 text-sm"
                  onClick={gotoOrders}
                >
                  Pay later
                </button>
                <button
                  className="rounded-xl bg-zinc-900 text-white hover:opacity-90 py-2.5 text-sm"
                  onClick={goToPaystack}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };


  return (
    <SiteLayout>
      <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-4">
        <h1 className="text-xl sm:text-2xl font-semibold">Payment</h1>

        {err && (
          <div className="p-3 rounded-xl border bg-red-50 text-red-700 text-sm">
            {err}
          </div>
        )}

        {loading && (
          <div className="text-sm opacity-70">
            Loading…
          </div>
        )}

        {showHosted && init?.mode === 'paystack' && (
          <div className="rounded-xl border bg-amber-50 text-amber-800 px-4 py-3 text-sm">
            You’re about to continue to Paystack. Please confirm your total and save your reference.
          </div>
        )}

        {showHosted && init?.mode === 'paystack' && <HostedCheckoutModal />}

        {/* Inline bank / trial */}
        {!loading && init && isBankFlow && (
          <div className="space-y-4">
            <div className="border rounded-2xl p-4 bg-white">
              <h2 className="font-medium mb-2">Bank Transfer Details</h2>

              {init.mode === 'trial' && (
                <p className="text-sm mb-3 text-zinc-700">
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
                <p className="text-sm">Bank details will be shown here.</p>
              )}

              {(estimatedTotal !== undefined || (init.amount && init.currency)) && (
                <div className="mt-4 rounded-xl border bg-zinc-50 p-3">
                  {estimatedTotal !== undefined ? (
                    <>
                      <div className="text-[11px] text-zinc-500">Total payable</div>
                      <div className="text-lg font-semibold mt-1">
                        {ngn.format(estimatedTotal)}
                      </div>
                      {estimatedServiceFeeTotal ? (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Includes estimated service &amp; gateway fees: {ngn.format(estimatedServiceFeeTotal)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-sm">
                      <b>Amount:</b> {init.currency} {Number(init.amount).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 text-xs text-zinc-600">
                Use your order reference in transfer notes:
                <div className="mt-1">
                  <code className="break-all px-2 py-1 rounded-lg bg-zinc-100 border">
                    {init.reference}
                  </code>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-xl border bg-black text-white px-4 py-3 hover:opacity-90 transition disabled:opacity-50 text-sm"
                disabled={loading}
                onClick={markPaidManual}
              >
                I’ve transferred
              </button>
              <button
                className="rounded-xl border px-4 py-3 text-sm"
                onClick={() => nav('/cart')}
              >
                Back to cart
              </button>
            </div>
          </div>
        )}

        {!loading && init && init.mode === 'paystack' && !init.authorization_url && (
          <div className="text-sm opacity-70">
            Awaiting Paystack authorization URL…
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
