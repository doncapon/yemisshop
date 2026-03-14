// src/pages/Payment.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useModal } from "../components/ModalProvider";
import { markPaystackExit } from "../utils/paystackReturn";
import SiteLayout from "../layouts/SiteLayout";

type InitResp = {
  reference: string;
  amount?: number;
  currency?: string;
  mode: "trial" | "paystack" | "paystack_inline_bank";
  authorization_url?: string;
  bank?: {
    bank_name: string;
    account_name: string;
    account_number: string;
  };
};

const AUTO_REDIRECT_KEY = "paystack:autoRedirect";
const LAST_REF_KEY = "paystack:lastRef";
const INIT_TIMEOUT_MS = 15000;

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

type PageStatus = "idle" | "initializing" | "redirecting" | "ready" | "error";

function safeNumber(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function getErrorMessage(e: any): string {
  return String(e?.response?.data?.error || e?.message || "").trim();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label = "Request timed out"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(id);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(id);
        reject(err);
      }
    );
  });
}

export default function Payment() {
  const nav = useNavigate();
  const loc = useLocation();
  const { openModal } = useModal();

  const orderId = useMemo(() => {
    return new URLSearchParams(loc.search).get("orderId") || "";
  }, [loc.search]);

  const state = (loc.state || {}) as any;

  const sessionInit = useMemo(() => {
    try {
      const raw = sessionStorage.getItem("payment:init");
      if (!raw) return null;

      const parsed = JSON.parse(raw) as any;
      if (!parsed || String(parsed.orderId || "") !== String(orderId || "")) return null;

      return parsed;
    } catch {
      return null;
    }
  }, [orderId]);

  const bootstrap = state && Object.keys(state).length ? state : sessionInit || {};

  const estimatedTotal =
    typeof bootstrap.total === "number" ? bootstrap.total : safeNumber(bootstrap.total);

  const estimatedServiceFeeTotal =
    typeof bootstrap.serviceFeeTotal === "number"
      ? bootstrap.serviceFeeTotal
      : safeNumber(bootstrap.serviceFeeTotal);

  const [status, setStatus] = useState<PageStatus>("idle");
  const [init, setInit] = useState<InitResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showHosted, setShowHosted] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [autoRedirect, setAutoRedirect] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_REDIRECT_KEY) === "1";
    } catch {
      return false;
    }
  });

  const redirectTimerRef = useRef<number | null>(null);

  const loading = status === "initializing";
  const redirecting = status === "redirecting";

  const gotoOrders = () => nav("/orders");
  const gotoCheckout = () => nav("/cart");
  const gotoCart = () => nav("/cart");

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current != null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!orderId) {
      setStatus("error");
      setErr("Missing order ID.");
      return;
    }

    let alive = true;

    const initPayment = async () => {
      setStatus("initializing");
      setErr(null);
      setInfo(null);
      setInit(null);
      setShowHosted(false);

      try {
        const basePayload: Record<string, any> = {
          orderId,
          channel: "paystack",
        };

        const firstPayload: Record<string, any> =
          typeof estimatedTotal === "number" && Number.isFinite(estimatedTotal)
            ? { ...basePayload, expectedTotal: estimatedTotal }
            : basePayload;

        let data: InitResp | null = null;
        let retriedWithoutExpectedTotal = false;

        try {
          const resp = await withTimeout(
            api.post<InitResp>("/api/payments/init", firstPayload, {
              withCredentials: true,
            }),
            INIT_TIMEOUT_MS,
            "Payment initialization is taking too long."
          );
          data = resp.data;
        } catch (e: any) {
          const statusCode = Number(e?.response?.status || 0);

          if (statusCode === 409) {
            retriedWithoutExpectedTotal = true;

            const retry = await withTimeout(
              api.post<InitResp>("/api/payments/init", basePayload, {
                withCredentials: true,
              }),
              INIT_TIMEOUT_MS,
              "Payment initialization retry is taking too long."
            );

            data = retry.data;
          } else {
            throw e;
          }
        }

        if (!alive) return;

        if (!data) {
          throw new Error("Failed to initialize payment.");
        }

        if (!data.reference) {
          throw new Error("Payment reference was not returned.");
        }

        setInit(data);

        try {
          localStorage.setItem(
            LAST_REF_KEY,
            JSON.stringify({
              reference: data.reference,
              orderId,
              at: new Date().toISOString(),
            })
          );
        } catch {
          //
        }

        if (retriedWithoutExpectedTotal) {
          setInfo("Your order total was refreshed from the latest backend calculation.");
        }

        if (
          typeof data.amount === "number" &&
          typeof estimatedTotal === "number" &&
          Number.isFinite(data.amount) &&
          Number.isFinite(estimatedTotal) &&
          Math.abs(data.amount - estimatedTotal) > 1
        ) {
          setInfo(
            `Your payable total was refreshed from ${ngn.format(estimatedTotal)} to ${ngn.format(
              data.amount
            )} based on the latest backend calculation.`
          );
        }

        if (data.mode === "paystack") {
          if (!data.authorization_url) {
            setStatus("error");
            setErr("Payment link was not returned. Please try again or go to your orders.");
            return;
          }

          if (autoRedirect) {
            setStatus("redirecting");

            redirectTimerRef.current = window.setTimeout(() => {
              if (!alive) return;
              try {
                markPaystackExit();
                window.location.assign(data!.authorization_url!);
              } catch {
                if (!alive) return;
                setStatus("ready");
                setShowHosted(true);
                setInfo("Automatic redirect did not complete. Please continue manually.");
              }
            }, 120);

            return;
          }

          setShowHosted(true);
          setStatus("ready");
          return;
        }

        setStatus("ready");
      } catch (e: any) {
        if (!alive) return;

        const statusCode = Number(e?.response?.status || 0);
        const message = getErrorMessage(e) || "Failed to initialize payment.";

        if (statusCode === 401) {
          setErr("Your session has expired. Please log in again.");
        } else if (statusCode === 409) {
          setErr(
            "This order was recalculated and could not be initialized for payment. Please reopen payment from your orders page."
          );
        } else {
          setErr(message);
        }

        setStatus("error");
      }
    };

    void initPayment();

    return () => {
      alive = false;
    };
  }, [orderId, estimatedTotal, autoRedirect, attempt]);

  const retryInit = () => {
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    if (!orderId) return;

    try {
      const raw = sessionStorage.getItem("payment:init");
      if (!raw) return;

      const parsed = JSON.parse(raw) as any;
      if (String(parsed?.orderId || "") === String(orderId)) {
        sessionStorage.removeItem("payment:init");
      }
    } catch {
      //
    }
  }, [orderId]);

  const markPaidManual = async () => {
    if (!init) return;

    setStatus("initializing");
    setErr(null);

    try {
      await withTimeout(
        api.post(
          "/api/payments/verify",
          { reference: init.reference, orderId },
          { withCredentials: true }
        ),
        INIT_TIMEOUT_MS,
        "Payment verification is taking too long."
      );

      openModal({ title: "Payment", message: "Payment verified. Thank you!" });
      nav(`/payment-callback?orderId=${orderId}&reference=${init.reference}`, {
        replace: true,
      });
    } catch (e: any) {
      setErr(getErrorMessage(e) || "Verification failed");
      setStatus("error");
    }
  };

  const copyRef = async () => {
    if (!init?.reference) return;
    try {
      await navigator.clipboard.writeText(init.reference);
      openModal({
        title: "Reference copied",
        message: "Payment reference copied to clipboard.",
      });
    } catch {
      openModal({
        title: "Copy failed",
        message: "Select the reference and copy it manually.",
      });
    }
  };

  const shareRef = async () => {
    if (!init?.reference) return;
    const text = `Payment reference: ${init.reference}\nOrder: ${orderId}`;
    const url = init.authorization_url || window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Payment Reference", text, url });
      } catch {
        //
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
          : "",
        `Saved: ${new Date().toLocaleString()}\n`,
      ],
      { type: "text/plain;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-ref-${init.reference}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const goToPaystack = () => {
    if (!init?.authorization_url) {
      setErr("Payment link is missing. Please try again.");
      setStatus("error");
      return;
    }

    try {
      setStatus("redirecting");
      markPaystackExit();
      window.location.assign(init.authorization_url);
    } catch {
      setStatus("ready");
      setErr("Could not open Paystack automatically. Please try again.");
    }
  };

  const toggleAuto = (v: boolean) => {
    setAutoRedirect(v);
    try {
      localStorage.setItem(AUTO_REDIRECT_KEY, v ? "1" : "0");
    } catch {
      //
    }
  };

  if (!orderId) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-md p-4 sm:p-6">
          <div className="rounded-2xl border bg-white p-4 text-sm space-y-3">
            <div>Missing order ID.</div>
            <button
              className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
              onClick={gotoOrders}
            >
              Go to orders
            </button>
          </div>
        </div>
      </SiteLayout>
    );
  }

  const isBankFlow =
    init?.mode === "trial" || init?.mode === "paystack_inline_bank";

  const displayTotal =
    typeof init?.amount === "number" && init.amount > 0 ? init.amount : undefined;

  const HostedCheckoutModal = () => {
    if (!showHosted || !init?.authorization_url) return null;

    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/50">
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
                onClick={() => {
                  setShowHosted(false);
                  gotoCart();
                }}
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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

              {displayTotal !== undefined && (
                <div className="rounded-xl border p-3">
                  <div className="text-[11px] text-zinc-500">Total payable</div>
                  <div className="text-lg font-semibold mt-1">{ngn.format(displayTotal)}</div>

                  {typeof estimatedTotal === "number" &&
                    typeof init.amount === "number" &&
                    Math.abs(estimatedTotal - init.amount) > 1 && (
                      <div className="text-[10px] text-zinc-500 mt-1 leading-snug">
                        Your earlier checkout estimate was {ngn.format(estimatedTotal)}.
                        This payment page is using the latest backend total of{" "}
                        {ngn.format(init.amount)}.
                      </div>
                    )}

                  {estimatedServiceFeeTotal ? (
                    <div className="text-[10px] text-zinc-500 mt-1">
                      Estimated service &amp; gateway fees from checkout:{" "}
                      {ngn.format(estimatedServiceFeeTotal)}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t bg-white space-y-2">
              <label className="flex items-start gap-2 text-[10px] sm:text-xs text-zinc-600 leading-snug">
                <input
                  className="mt-0.5"
                  type="checkbox"
                  checked={autoRedirect}
                  onChange={(e) => toggleAuto(e.target.checked)}
                />
                <span>Always skip this step and go straight to Paystack next time</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-xl border bg-white hover:bg-black/5 py-2.5 text-sm"
                  onClick={gotoCart}
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
          <div className="p-3 rounded-xl border bg-red-50 text-red-700 text-sm space-y-3">
            <div>{err}</div>
            <div className="flex gap-2">
              <button
                className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                onClick={gotoCheckout}
              >
                Back to cart
              </button>
              <button
                className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                onClick={gotoOrders}
              >
                Go to orders
              </button>
              <button
                className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                onClick={retryInit}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {info && (
          <div className="p-3 rounded-xl border bg-amber-50 text-amber-800 text-sm">
            {info}
          </div>
        )}

        {loading && (
          <div className="rounded-xl border bg-white p-4 text-sm opacity-80 space-y-3">
            <div>Initializing payment…</div>
            <div className="flex gap-2">
              <button
                className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                onClick={retryInit}
              >
                Retry
              </button>
              <button
                className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                onClick={gotoOrders}
              >
                Go to orders
              </button>
            </div>
          </div>
        )}

        {redirecting && init?.mode === "paystack" && (
          <div className="rounded-xl border bg-white p-5 text-center space-y-2">
            <div className="text-lg font-semibold">Redirecting to Paystack…</div>
            <div className="text-sm text-zinc-600">
              Please wait while we open your payment page.
            </div>

            <div className="pt-2">
              <button
                className="rounded-xl bg-zinc-900 text-white hover:opacity-90 px-4 py-2 text-sm"
                onClick={goToPaystack}
              >
                Continue now
              </button>
            </div>
          </div>
        )}

        {showHosted && init?.mode === "paystack" && (
          <div className="rounded-xl border bg-amber-50 text-amber-800 px-4 py-3 text-sm">
            You’re about to continue to Paystack. Please confirm your total and save your reference.
          </div>
        )}

        <HostedCheckoutModal />

        {!loading && !redirecting && init && isBankFlow && (
          <div className="space-y-4">
            <div className="border rounded-2xl p-4 bg-white">
              <h2 className="font-medium mb-2">Bank Transfer Details</h2>

              {init.mode === "trial" && (
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

              {typeof init.amount === "number" && init.amount > 0 && (
                <div className="mt-4 rounded-xl border bg-zinc-50 p-3">
                  <div className="text-[11px] text-zinc-500">Total payable</div>
                  <div className="text-lg font-semibold mt-1">
                    {ngn.format(init.amount)}
                  </div>

                  {typeof estimatedTotal === "number" && Math.abs(estimatedTotal - init.amount) > 1 ? (
                    <div className="text-[11px] text-zinc-500 mt-1">
                      Earlier checkout estimate was {ngn.format(estimatedTotal)}. This page is using the latest backend total.
                    </div>
                  ) : estimatedServiceFeeTotal ? (
                    <div className="text-[11px] text-zinc-500 mt-1">
                      Includes estimated service &amp; gateway fees: {ngn.format(estimatedServiceFeeTotal)}
                    </div>
                  ) : null}
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
                onClick={gotoCart}
              >
                Back to cart
              </button>
            </div>
          </div>
        )}

        {!loading &&
          !redirecting &&
          init &&
          init.mode === "paystack" &&
          !showHosted &&
          !!init.authorization_url && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="text-sm text-zinc-700">Your payment is ready.</div>
              <div className="flex gap-2">
                <button
                  className="rounded-xl bg-zinc-900 text-white hover:opacity-90 px-4 py-2 text-sm"
                  onClick={goToPaystack}
                >
                  Continue to Paystack
                </button>
                <button
                  className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                  onClick={gotoOrders}
                >
                  Go to orders
                </button>
              </div>
            </div>
          )}

        {!loading &&
          !redirecting &&
          init &&
          init.mode === "paystack" &&
          !init.authorization_url && (
            <div className="rounded-xl border bg-red-50 text-red-700 px-4 py-3 text-sm">
              Payment link was not returned. Please try again from your orders page.
            </div>
          )}
      </div>
    </SiteLayout>
  );
}