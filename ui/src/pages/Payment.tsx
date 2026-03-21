// src/pages/Payment.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useModal } from "../components/ModalProvider";
import SiteLayout from "../layouts/SiteLayout";

type InitResp = {
  reference: string;
  amount?: number;
  currency?: string;
  mode: "trial" | "paystack" | "paystack_inline_bank";
  authorization_url?: string;
  authorizationUrl?: string;
  bank?: {
    bank_name: string;
    account_name: string;
    account_number: string;
  };
};

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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "Request timed out"
): Promise<T> {
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

function isRetriableInitError(e: any): boolean {
  const status = Number(e?.response?.status || 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;

  const msg = getErrorMessage(e).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("timed out") ||
    msg.includes("socket hang up") ||
    msg.includes("failed to fetch")
  );
}

function shouldRetryWithoutExpectedTotal(e: any): boolean {
  const status = Number(e?.response?.status || 0);
  const msg = getErrorMessage(e).toLowerCase();

  if ([400, 409, 422].includes(status)) {
    return (
      msg.includes("expectedtotal") ||
      msg.includes("expected total") ||
      msg.includes("total mismatch") ||
      msg.includes("recalculated") ||
      msg.includes("amount changed") ||
      msg.includes("stale total")
    );
  }

  return false;
}

function readPaymentInitResponse(payload: any): InitResp | null {
  const root =
    payload?.data?.data ??
    payload?.data ??
    payload ??
    null;

  if (!root || typeof root !== "object") return null;

  const modeRaw = String(root?.mode ?? root?.channel ?? "").trim().toLowerCase();
  const mode: InitResp["mode"] =
    modeRaw === "trial"
      ? "trial"
      : modeRaw === "paystack_inline_bank"
        ? "paystack_inline_bank"
        : "paystack";

  const reference = String(
    root?.reference ??
    root?.paymentReference ??
    ""
  ).trim();

  const authorization_url = String(
    root?.authorization_url ??
    root?.authorizationUrl ??
    root?.paymentUrl ??
    ""
  ).trim();

  const amount = safeNumber(root?.amount);
  const currency = String(root?.currency ?? "NGN").trim() || "NGN";

  const bank =
    root?.bank && typeof root.bank === "object"
      ? {
        bank_name: String(root.bank.bank_name ?? "").trim(),
        account_name: String(root.bank.account_name ?? "").trim(),
        account_number: String(root.bank.account_number ?? "").trim(),
      }
      : undefined;

  return {
    reference,
    amount,
    currency,
    mode,
    authorization_url: authorization_url || undefined,
    authorizationUrl: authorization_url || undefined,
    bank,
  };
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
      if (!parsed || String(parsed.orderId || "") !== String(orderId || "")) {
        return null;
      }

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
  const [attempt, setAttempt] = useState(0);

  const initRunRef = useRef<string | null>(null);
  const autoRetriedRef = useRef(false);
  const redirectStartedRef = useRef(false);

  const loading = status === "initializing";
  const redirecting = status === "redirecting";

  const gotoOrders = () => nav("/orders");
  const gotoCheckout = () => nav("/cart");
  const gotoCart = () => nav("/cart");

  const redirectToHosted = (url: string) => {
    const finalUrl = String(url || "").trim();

    console.log("[payment] redirectToHosted called", {
      finalUrl,
      redirectStarted: redirectStartedRef.current,
    });

    if (!finalUrl || redirectStartedRef.current) return;

    redirectStartedRef.current = true;
    setStatus("redirecting");

    // use href directly for the hardest redirect possible
    window.location.href = finalUrl;
  };

  useEffect(() => {
    if (!orderId) {
      setStatus("error");
      setErr("Missing order ID.");
      return;
    }

    if (attempt === 0) {
      autoRetriedRef.current = false;
    }

    const runKey = `${orderId}:${attempt}`;
    if (initRunRef.current === runKey) return;
    initRunRef.current = runKey;

    let alive = true;

    const uiTimeout = window.setTimeout(() => {
      if (!alive) return;
      setStatus("error");
      setErr("Payment initialization is taking too long. Please retry.");
    }, INIT_TIMEOUT_MS + 1500);

    const runInitRequest = async (): Promise<{
      data: InitResp;
      retriedWithoutExpectedTotal: boolean;
    }> => {
      const basePayload: Record<string, any> = {
        orderId,
        channel: "paystack",
      };

      const payloadWithExpectedTotal: Record<string, any> =
        typeof estimatedTotal === "number" && Number.isFinite(estimatedTotal)
          ? { ...basePayload, expectedTotal: estimatedTotal }
          : basePayload;

      try {
        const resp = await withTimeout(
          api.post("/api/payments/init", payloadWithExpectedTotal, {
            withCredentials: true,
          }),
          INIT_TIMEOUT_MS,
          "Payment initialization is taking too long."
        );

        const parsed = readPaymentInitResponse(resp);
        if (!parsed) {
          throw new Error("Invalid payment initialization response.");
        }

        return { data: parsed, retriedWithoutExpectedTotal: false };
      } catch (firstErr: any) {
        if (shouldRetryWithoutExpectedTotal(firstErr)) {
          const retryResp = await withTimeout(
            api.post("/api/payments/init", basePayload, {
              withCredentials: true,
            }),
            INIT_TIMEOUT_MS,
            "Payment initialization is taking too long."
          );

          const parsed = readPaymentInitResponse(retryResp);
          if (!parsed) {
            throw new Error("Invalid payment initialization response.");
          }

          return { data: parsed, retriedWithoutExpectedTotal: true };
        }

        throw firstErr;
      }
    };

    const initPayment = async () => {
      setStatus("initializing");
      setErr(null);
      setInfo(null);
      setInit(null);
      redirectStartedRef.current = false;

      try {
        const { data, retriedWithoutExpectedTotal } = await runInitRequest();
        console.log("[payment] init parsed", data);

        if (!alive) return;

        if (!data?.reference) {
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
          const hostedUrl = String(
            data.authorization_url ?? data.authorizationUrl ?? ""
          ).trim();

          console.log("[payment] paystack branch", {
            hostedUrl,
            hasHostedUrl: !!hostedUrl,
            reference: data.reference,
          });

          if (!hostedUrl) {
            setStatus("error");
            setErr(
              "Payment was initialized but no redirect link was returned. Please retry or go to your orders."
            );
            return;
          }

          redirectToHosted(hostedUrl);
          return;
        }

        setStatus("ready");
      } catch (e: any) {
        if (!alive) return;

        const statusCode = Number(e?.response?.status || 0);
        const message = getErrorMessage(e) || e?.message || "Failed to initialize payment.";

        if (!autoRetriedRef.current && attempt === 0 && isRetriableInitError(e)) {
          autoRetriedRef.current = true;
          setInfo("Payment initialization is taking longer than expected. Retrying automatically…");

          window.setTimeout(() => {
            if (!alive) return;
            initRunRef.current = null;
            setAttempt((n) => n + 1);
          }, 400);

          return;
        }

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
      } finally {
        window.clearTimeout(uiTimeout);
      }
    };

    void initPayment();

    return () => {
      alive = false;
      window.clearTimeout(uiTimeout);
    };
  }, [orderId, estimatedTotal, attempt]);

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

  const retryInit = () => {
    initRunRef.current = null;
    autoRetriedRef.current = false;
    redirectStartedRef.current = false;
    setAttempt((n) => n + 1);
  };

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
      setErr(getErrorMessage(e) || e?.message || "Verification failed");
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

  useEffect(() => {
    if (redirectStartedRef.current) return;
    if (!init) return;
    if (init.mode !== "paystack") return;

    const url = String(
      init.authorization_url ?? init.authorizationUrl ?? ""
    ).trim();

    console.log("[payment] redirect effect", {
      mode: init.mode,
      reference: init.reference,
      url,
      hasUrl: !!url,
      status,
    });

    if (!url) return;

    redirectToHosted(url);
  }, [init, status]);

  const shareRef = async () => {
    if (!init?.reference) return;
    const text = `Payment reference: ${init.reference}\nOrder: ${orderId}`;
    const url = init.authorization_url || init.authorizationUrl || window.location.href;

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
    const url = String(init?.authorization_url ?? init?.authorizationUrl ?? "").trim();

    if (!url) {
      setErr("Payment link is missing. Please try again.");
      setStatus("error");
      return;
    }

    redirectToHosted(url);
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

  const hostedUrl = String(init?.authorization_url ?? init?.authorizationUrl ?? "").trim();

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
                  <div className="text-lg font-semibold mt-1">{ngn.format(init.amount)}</div>

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
          !!hostedUrl && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="text-sm text-zinc-700">
                Your payment is ready. Automatic redirect did not complete.
              </div>
              <div className="text-xs text-zinc-500">
                Reference: {init.reference}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  className="rounded-xl bg-zinc-900 text-white hover:opacity-90 px-4 py-2 text-sm"
                  onClick={goToPaystack}
                >
                  Continue to Paystack
                </button>
                <button
                  className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                  onClick={copyRef}
                >
                  Copy reference
                </button>
                <button
                  className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                  onClick={shareRef}
                >
                  Share
                </button>
                <button
                  className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-black/5"
                  onClick={downloadRef}
                >
                  Download
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
          !hostedUrl && (
            <div className="rounded-xl border bg-red-50 text-red-700 px-4 py-3 text-sm">
              Payment link was not returned. Please try again from your orders page.
            </div>
          )}
      </div>
    </SiteLayout>
  );
}