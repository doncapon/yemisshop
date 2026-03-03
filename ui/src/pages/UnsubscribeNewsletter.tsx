// src/pages/UnsubscribeNewsletter.tsx
import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import SiteLayout from "../layouts/SiteLayout";
import api from "../api/client";

type State =
  | { status: "idle" | "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export default function UnsubscribeNewsletterPage() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<State>({ status: "idle" });

  useEffect(() => {
    const token = searchParams.get("token") || "";
    if (!token) {
      setState({
        status: "error",
        message: "Missing unsubscribe token. Please use the link directly from your email.",
      });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const { data } = await api.post("/api/newsletter/unsubscribe", { token });
        if (cancelled) return;
        if (data?.success) {
          setState({
            status: "success",
            message: data.message || "You have been unsubscribed from DaySpring updates.",
          });
        } else {
          setState({
            status: "error",
            message:
              data?.message ||
              "We couldn't process your unsubscribe request. Please try again later.",
          });
        }
      } catch (err: any) {
        console.error("[unsubscribe] error", err);
        if (cancelled) return;
        const msg =
          err?.response?.data?.message ||
          "We couldn't process your unsubscribe request. Please try again later.";
        setState({ status: "error", message: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const isLoading = state.status === "loading";

  return (
    <SiteLayout>
      <div className="min-h-[70vh] bg-surface flex items-center justify-center px-3 sm:px-4">
        <div className="w-full max-w-md rounded-2xl border border-[--color-surface-ring] bg-white shadow-sm p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            {state.status === "success" ? (
              <div className="rounded-full bg-emerald-50 text-emerald-600 p-1.5">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            ) : state.status === "error" ? (
              <div className="rounded-full bg-amber-50 text-amber-600 p-1.5">
                <AlertTriangle className="h-4 w-4" />
              </div>
            ) : (
              <div className="rounded-full bg-primary-50 text-primary-600 p-1.5">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}

            <h1 className="text-sm sm:text-base font-semibold text-ink">
              {state.status === "success"
                ? "You’re unsubscribed"
                : state.status === "error"
                ? "Unable to unsubscribe"
                : "Unsubscribing from DaySpring updates…"}
            </h1>
          </div>

          <p className="text-[12px] sm:text-sm text-ink-soft">
            {state.status === "success"
              ? state.message
              : state.status === "error"
              ? state.message
              : "Please wait a moment while we update your email preferences."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] sm:text-xs">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-xl border border-[--color-surface-ring] bg-surface px-3 py-1.5 text-[11px] sm:text-xs text-ink hover:bg-black/5"
            >
              Back to homepage
            </Link>
            <Link
              to="/profile"
              className="inline-flex items-center justify-center rounded-xl border border-[--color-surface-ring] bg-surface px-3 py-1.5 text-[11px] sm:text-xs text-ink hover:bg-black/5"
            >
              Go to my account
            </Link>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}