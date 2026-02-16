// src/pages/Privacy.tsx
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  Sparkles,
  Info,
  Lock,
  ChevronRight,
  Save,
  RefreshCcw,
  Cookie,
  Mail,
  Trash2,
} from "lucide-react";

import SiteLayout from "../layouts/SiteLayout";
import api from "../api/client";
import { useModal } from "../components/ModalProvider";

/* ---------------------- Cookie auth helpers ---------------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

/* ---------------------- Types ---------------------- */
type ConsentResponse = {
  ok: boolean;
  data: {
    analytics: boolean;
    marketing: boolean;
    consentAnalyticsAt: string | null;
    consentMarketingAt: string | null;
  };
};

type MeResponse = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

const dateTimeFmt = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString();
};

/* ---------------------- UI primitives (same vibe as dashboard) ---------------------- */
function GlassCard(props: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-2xl border border-white/40 bg-white/70 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-5 ${
        props.className || ""
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-cyan-500/15 text-fuchsia-600 shrink-0">
            {props.icon ?? <Sparkles size={18} />}
          </span>
          <h2 className="text-lg font-semibold tracking-tight truncate">{props.title}</h2>
        </div>
        {props.right}
      </div>
      {props.children}
    </motion.section>
  );
}

function ToggleRow(props: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold text-zinc-900">{props.title}</div>
          {props.badge}
        </div>
        <div className="text-sm text-zinc-600 mt-0.5">{props.description}</div>
      </div>

      <button
        type="button"
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
        className={`shrink-0 relative inline-flex h-7 w-12 items-center rounded-full border transition disabled:opacity-60 ${
          props.checked ? "bg-emerald-500/90 border-emerald-400/50" : "bg-zinc-200 border-zinc-300"
        }`}
        aria-pressed={props.checked}
        aria-label={props.title}
      >
        <span
          className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
            props.checked ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

/* ---------------------- Data hooks ---------------------- */
function useMeLite() {
  return useQuery({
    queryKey: ["me", "lite"],
    queryFn: async () => (await api.get<MeResponse>("/api/auth/me", AXIOS_COOKIE_CFG)).data,
    staleTime: 30_000,
    retry: false,
  });
}

function useConsent(enabled = true) {
  return useQuery({
    queryKey: ["privacy", "consent"],
    enabled,
    queryFn: async () => (await api.get<ConsentResponse>("/api/privacy/consent", AXIOS_COOKIE_CFG)).data,
    staleTime: 30_000,
    retry: 1,
  });
}

/* ---------------------- Page ---------------------- */
export default function Privacy() {
  const nav = useNavigate();
  const location = useLocation();
  const { openModal } = useModal();
  const qc = useQueryClient();

  const meQ = useMeLite();

  // Only fetch consent after we know auth isn't failing.
  const consentEnabled = !(meQ.isError && isAuthError(meQ.error));
  const consentQ = useConsent(consentEnabled);

  // If cookie session is missing/expired -> redirect to login
  useEffect(() => {
    if (!meQ.isError) return;
    if (!isAuthError(meQ.error)) return;
    nav("/login", { replace: true, state: { from: location.pathname + location.search } });
  }, [meQ.isError, meQ.error, nav, location.pathname, location.search]);

  // local form state (so user can toggle before saving)
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [dirty, setDirty] = useState(false);

  // hydrate from server once loaded
  useEffect(() => {
    if (!consentQ.data?.data) return;
    setAnalytics(!!consentQ.data.data.analytics);
    setMarketing(!!consentQ.data.data.marketing);
    setDirty(false);
  }, [consentQ.data?.data?.analytics, consentQ.data?.data?.marketing]); // intentional granularity

  // If consent endpoints return 401/403, also redirect (cookie not present)
  useEffect(() => {
    if (!consentQ.isError) return;
    if (!isAuthError(consentQ.error)) return;
    nav("/login", { replace: true, state: { from: location.pathname + location.search } });
  }, [consentQ.isError, consentQ.error, nav, location.pathname, location.search]);

  const saveM = useMutation({
    mutationFn: async (payload: { analytics: boolean; marketing: boolean }) => {
      const { data } = await api.post<ConsentResponse>(
        "/api/privacy/consent",
        payload,
        {
          ...AXIOS_COOKIE_CFG,
          headers: { "Content-Type": "application/json" },
        }
      );
      return data;
    },
    onSuccess: async () => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["privacy", "consent"] });
      openModal({ title: "Saved", message: "Your privacy preferences have been updated." });
    },
    onError: (e: any) => {
      if (isAuthError(e)) {
        nav("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      openModal({
        title: "Could not save",
        message: e?.response?.data?.error || "Please try again.",
      });
    },
  });

  const resetToServer = () => {
    const d = consentQ.data?.data;
    if (!d) return;
    setAnalytics(!!d.analytics);
    setMarketing(!!d.marketing);
    setDirty(false);
  };

  const busy = consentQ.isLoading || saveM.isPending || meQ.isLoading;

  // marketing implies analytics (mirror backend rule)
  const onToggleMarketing = (v: boolean) => {
    setDirty(true);
    if (v) {
      setMarketing(true);
      setAnalytics(true);
      return;
    }
    setMarketing(false);
  };

  const onToggleAnalytics = (v: boolean) => {
    setDirty(true);
    // if marketing already on, analytics cannot be turned off
    if (!v && marketing) return;
    setAnalytics(v);
  };

  const lastAnalyticsAt = consentQ.data?.data?.consentAnalyticsAt ?? null;
  const lastMarketingAt = consentQ.data?.data?.consentMarketingAt ?? null;

  const headerRight = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        <motion.button
          whileHover={{ y: -1 }}
          disabled={busy}
          onClick={() => qc.invalidateQueries({ queryKey: ["privacy", "consent"] })}
          className="inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
          title="Refresh"
        >
          <RefreshCcw size={16} />
          Refresh
        </motion.button>

        <motion.button
          whileHover={{ y: -1 }}
          disabled={busy || !dirty}
          onClick={() => saveM.mutate({ analytics, marketing })}
          className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60
                     bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800"
        >
          <Save size={16} />
          Save changes
        </motion.button>
      </div>
    );
  }, [busy, dirty, analytics, marketing, qc, saveM]);

  return (
    <SiteLayout>
      <div className="max-w-screen-2xl mx-auto">
        {/* Neon-ish header */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,0,167,0.08),transparent_70%),radial-gradient(closest-side,rgba(0,204,255,0.10),transparent_70%)]" />
          <div className="relative px-4 md:px-8 pt-8 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <motion.h1
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900"
                >
                  Data & privacy{" "}
                  <span className="inline-block align-middle">
                    <ShieldCheck className="inline text-fuchsia-600" size={22} />
                  </span>
                </motion.h1>
                <p className="text-sm text-zinc-600">
                  Control how we use your data for analytics and communications. You can change these settings anytime.
                </p>
              </div>

              <div className="hidden md:block">{headerRight}</div>
            </div>

            {/* mobile actions */}
            <div className="mt-3 md:hidden">{headerRight}</div>
          </div>
        </div>

        <div className="px-4 md:px-8 pb-10 grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Left rail */}
          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <GlassCard title="Quick links" icon={<ChevronRight size={18} />}>
              <div className="grid gap-2 text-sm">
                <Link to="/profile" className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline">
                  Profile <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
                <Link to="/orders" className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline">
                  Orders <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
                <Link
                  to="/account/sessions"
                  className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline"
                >
                  Sessions & devices <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
              </div>
            </GlassCard>

            <GlassCard title="Your account" icon={<Lock size={18} />}>
              {meQ.isLoading ? (
                <div className="text-sm text-zinc-600">Loading…</div>
              ) : meQ.isError ? (
                <div className="text-sm text-rose-600 inline-flex items-center gap-2">
                  <Info size={16} /> Couldn’t load account info.
                </div>
              ) : (
                <div className="text-sm text-zinc-700 space-y-1">
                  <div className="font-semibold text-zinc-900 truncate">{meQ.data?.email}</div>
                  <div className="text-xs text-zinc-600">
                    Name: {[meQ.data?.firstName, meQ.data?.lastName].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div className="text-xs text-zinc-600">
                    Email verification: {meQ.data?.emailVerified ? "Verified" : "Pending"}
                  </div>
                </div>
              )}

              <div className="mt-3">
                <button
                  onClick={() => nav("/account/sessions")}
                  className="text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1"
                >
                  Review signed-in devices <ChevronRight size={14} />
                </button>
              </div>
            </GlassCard>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <GlassCard title="Cookie & consent preferences" icon={<Cookie size={18} />}>
              {consentQ.isLoading ? (
                <div className="text-sm text-zinc-600">Loading your preferences…</div>
              ) : consentQ.isError ? (
                <div className="text-sm text-rose-600 inline-flex items-center gap-2">
                  <Info size={16} /> Couldn’t load your privacy preferences.
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border bg-white p-4">
                    <ToggleRow
                      title="Strictly necessary"
                      description="These are required for sign-in, security, and core site functionality (e.g., keeping you logged in)."
                      checked={true}
                      disabled={true}
                      onChange={() => {}}
                      badge={
                        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-zinc-100 text-zinc-700 border-zinc-200">
                          Always on
                        </span>
                      }
                    />
                    <div className="h-px bg-zinc-200/70" />
                    <ToggleRow
                      title="Analytics"
                      description="Help us understand what’s working (pages visited, performance) so we can improve the experience."
                      checked={analytics}
                      disabled={busy || marketing /* can't switch off if marketing is on */}
                      onChange={onToggleAnalytics}
                      badge={
                        lastAnalyticsAt ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-cyan-50 text-cyan-700 border-cyan-200">
                            Updated {dateTimeFmt(lastAnalyticsAt)}
                          </span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-zinc-50 text-zinc-700 border-zinc-200">
                            Not set
                          </span>
                        )
                      }
                    />
                    <div className="h-px bg-zinc-200/70" />
                    <ToggleRow
                      title="Marketing"
                      description="Allow messages about promos, product highlights, and announcements. Marketing implies analytics."
                      checked={marketing}
                      disabled={busy}
                      onChange={onToggleMarketing}
                      badge={
                        lastMarketingAt ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                            Updated {dateTimeFmt(lastMarketingAt)}
                          </span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-zinc-50 text-zinc-700 border-zinc-200">
                            Not set
                          </span>
                        )
                      }
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button
                      disabled={busy || !dirty}
                      onClick={resetToServer}
                      className="inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                      title="Discard unsaved changes"
                    >
                      <Trash2 size={16} />
                      Reset
                    </button>

                    <div className="text-xs text-zinc-500">You can change preferences anytime.</div>
                  </div>
                </>
              )}
            </GlassCard>

            <GlassCard title="What we collect and why" icon={<Info size={18} />}>
              <div className="space-y-3 text-sm text-zinc-700">
                <p>
                  We collect only what we need to run an e-commerce marketplace: account details, order details, delivery
                  details, and payment references (processed by Paystack).
                </p>

                <div className="rounded-2xl border bg-white p-4">
                  <div className="font-semibold text-zinc-900">Typical data categories</div>
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-zinc-700">
                    <li>
                      <b>Account:</b> email, name, phone (for sign-in, support, and order updates).
                    </li>
                    <li>
                      <b>Orders:</b> items, quantities, totals, delivery address (to fulfil orders).
                    </li>
                    <li>
                      <b>Payments:</b> payment status, reference, provider transaction identifiers (to confirm payment and
                      handle refunds).
                    </li>
                    <li>
                      <b>Security:</b> session/device metadata (to protect your account).
                    </li>
                    <li>
                      <b>Optional analytics/marketing:</b> depending on your consent above.
                    </li>
                  </ul>
                </div>

                <p className="text-xs text-zinc-500">
                  This page is a practical control panel. Your full privacy notice should live on a dedicated route (e.g.{" "}
                  <span className="font-mono">/privacy-policy</span>) with legal text aligned to Nigerian data protection
                  requirements.
                </p>
              </div>
            </GlassCard>

            <GlassCard title="Contact" icon={<Mail size={18} />}>
              <div className="text-sm text-zinc-700">For privacy questions or data requests, contact support.</div>
              <div className="mt-3">
                <Link to="/support" className="inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline text-sm">
                  Contact support <ChevronRight size={14} />
                </Link>
              </div>
            </GlassCard>

            <div className="text-[11px] text-zinc-500">
              Note: “Strictly necessary” cookies/processing may still apply to keep the service secure and functional.
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
