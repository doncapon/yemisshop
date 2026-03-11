import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Box,
  CircleDollarSign,
  Package,
  ShoppingBag,
  Sparkles,
  Truck,
  Settings,
  Undo2,
  Tags,
  ChevronDown,
  X,
  Search,
  CheckCircle2,
  MapPin,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white/80 p-3 sm:p-4 flex items-start gap-2.5">
      <div className="mt-0.5 text-zinc-700 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] sm:text-xs text-zinc-500 leading-tight">{label}</div>
        <div className="text-base sm:text-lg font-semibold text-zinc-900 leading-tight">{value}</div>
        {hint && <div className="text-[11px] text-zinc-500 mt-1 leading-tight">{hint}</div>}
      </div>
    </div>
  );
}

type SupplierLite = {
  id: string;
  name?: string | null;
  businessName?: string | null;
  email?: string | null;
  status?: string | null;
};

type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

type AuthMeLite = {
  id?: string;
  role?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

type SupplierMeLite = {
  id?: string;
  supplierId?: string;
  name?: string | null;
  businessName?: string | null;
  legalName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
  status?: string | null;
  kycStatus?: string | null;
  registeredAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
  pickupAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
};

type OnboardingState = {
  authMe: AuthMeLite;
  supplierMe: SupplierMeLite;
  docs: SupplierDocumentLite[];
  contactDone: boolean;
  businessDone: boolean;
  addressDone: boolean;
  docsDone: boolean;
  onboardingDone: boolean;
  nextPath: string;
  progressItems: Array<{ key: string; label: string; done: boolean }>;
};

function normStr(v: any) {
  return String(v ?? "").trim();
}

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

function hasAddress(addr: any) {
  if (!addr) return false;
  return Boolean(
    String(addr.houseNumber ?? "").trim() ||
      String(addr.streetName ?? "").trim() ||
      String(addr.city ?? "").trim() ||
      String(addr.state ?? "").trim() ||
      String(addr.country ?? "").trim() ||
      String(addr.postCode ?? "").trim()
  );
}

function isRegisteredBusiness(registrationType?: string | null) {
  return String(registrationType ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS";
}

function docSatisfied(docs: SupplierDocumentLite[], kind: string) {
  return docs.some((d) => {
    const k = String(d.kind ?? "").trim().toUpperCase();
    const s = String(d.status ?? "").trim().toUpperCase();
    return k === kind && (s === "PENDING" || s === "APPROVED");
  });
}

export default function SupplierDashboard() {
  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const role = useAuthStore((s: any) => s.user?.role);
  const userId = useAuthStore((s: any) => s.user?.id);

  const roleNorm = normRole(role);
  const isAdmin = roleNorm === "ADMIN" || roleNorm === "SUPER_ADMIN";
  const isRider = roleNorm === "SUPPLIER_RIDER";
  const isSupplier = roleNorm === "SUPPLIER";

  useEffect(() => {
    useAuthStore.getState().bootstrap?.().catch?.(() => null);
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();

  const urlSupplierId = useMemo(() => {
    const v = normStr(searchParams.get("supplierId"));
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = normStr(localStorage.getItem(ADMIN_SUPPLIER_KEY));
    return v || undefined;
  }, []);

  const adminSupplierId = isAdmin ? urlSupplierId ?? storedSupplierId : undefined;

  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = normStr(searchParams.get("supplierId"));
    const fromStore = normStr(localStorage.getItem(ADMIN_SUPPLIER_KEY));

    if (fromUrl) {
      if (fromUrl !== fromStore) localStorage.setItem(ADMIN_SUPPLIER_KEY, fromUrl);
      return;
    }

    if (fromStore) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("supplierId", fromStore);
          return next;
        },
        { replace: true }
      );
    }
  }, [isAdmin, searchParams, setSearchParams]);

  const withSupplierCtx = (to: string) => {
    if (!isAdmin || !adminSupplierId) return to;
    if (to.includes("supplierId=")) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  const [pickerOpen, setPickerOpen] = useState(false);
  const [supplierQ, setSupplierQ] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!pickerOpen) return;
      const el = pickerRef.current;
      if (!el) return;
      if (!el.contains(e.target as any)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [pickerOpen]);

  const suppliersQ = useQuery({
    queryKey: ["admin", "suppliers", { q: supplierQ }],
    enabled: hydrated && isAdmin && pickerOpen,
    queryFn: async () => {
      const { data } = await api.get<{ data: SupplierLite[] }>("/api/admin/suppliers", {
        withCredentials: true,
        params: { q: supplierQ.trim() || undefined, take: 50, skip: 0 },
      });
      return Array.isArray((data as any)?.data) ? (data as any).data : (data as any);
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const suppliers = suppliersQ.data ?? [];

  const filteredSuppliers = useMemo(() => {
    const needle = supplierQ.trim().toLowerCase();
    if (!needle) return suppliers;
    return suppliers.filter((s: any) => {
      const hay = [s.id, s.name, s.businessName, s.email, s.status]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(needle);
    });
  }, [suppliers, supplierQ]);

  const selectedSupplierQ = useQuery({
    queryKey: ["admin", "supplier", adminSupplierId],
    enabled: hydrated && isAdmin && !!adminSupplierId,
    queryFn: async () => {
      const { data } = await api.get(
        "/api/admin/suppliers/" + encodeURIComponent(String(adminSupplierId)),
        { withCredentials: true }
      );
      return (data as any)?.data ?? data;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const selectedSupplierLabel = useMemo(() => {
    if (!isAdmin) return null;
    const s = selectedSupplierQ.data as SupplierLite | null;
    if (!adminSupplierId) return "Select supplier…";
    if (!s) return `Supplier: ${adminSupplierId.slice(0, 8)}…`;
    const name = s.businessName || s.name || s.email || adminSupplierId;
    const extra = s.email && (s.businessName || s.name) ? ` • ${s.email}` : "";
    return `${name}${extra}`;
  }, [isAdmin, adminSupplierId, selectedSupplierQ.data]);

  function selectSupplier(id: string) {
    const nextId = normStr(id);
    if (!nextId) return;

    localStorage.setItem(ADMIN_SUPPLIER_KEY, nextId);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("supplierId", nextId);
        return next;
      },
      { replace: true }
    );

    setPickerOpen(false);
  }

  function clearSupplierSelection() {
    localStorage.removeItem(ADMIN_SUPPLIER_KEY);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("supplierId");
        return next;
      },
      { replace: true }
    );

    setSupplierQ("");
    setPickerOpen(false);
  }

  const onboardingQ = useQuery<OnboardingState>({
    queryKey: ["supplier", "dashboard", "onboarding-state", userId],
    enabled: hydrated && isSupplier && !isRider,
    queryFn: async () => {
      const [authRes, supplierRes, docsRes] = await Promise.all([
        api.get("/api/auth/me", { withCredentials: true }),
        api.get("/api/supplier/me", { withCredentials: true }),
        api
          .get("/api/supplier/documents", { withCredentials: true })
          .catch(() => ({ data: { data: [] } })),
      ]);

      const authMe = ((authRes.data as any)?.data ??
        (authRes.data as any)?.user ??
        authRes.data ??
        {}) as AuthMeLite;

      const supplierMe = ((supplierRes.data as any)?.data ??
        supplierRes.data ??
        {}) as SupplierMeLite;

      const rawDocs = (docsRes as any)?.data?.data ?? (docsRes as any)?.data ?? [];
      const docs = Array.isArray(rawDocs) ? (rawDocs as SupplierDocumentLite[]) : [];

      const contactDone = !!authMe?.emailVerified && !!authMe?.phoneVerified;

      const businessDone = Boolean(
        String(supplierMe?.legalName ?? "").trim() &&
          String(supplierMe?.registrationType ?? "").trim() &&
          String(supplierMe?.registrationCountryCode ?? "").trim()
      );

      const addressDone =
        hasAddress(supplierMe?.registeredAddress) || hasAddress(supplierMe?.pickupAddress);

      const requiredKinds = [
        ...(isRegisteredBusiness(supplierMe?.registrationType)
          ? ["BUSINESS_REGISTRATION_CERTIFICATE"]
          : []),
        "GOVERNMENT_ID",
        "PROOF_OF_ADDRESS",
      ];

      const docsDone = requiredKinds.every((kind) => docSatisfied(docs, kind));

      const nextPath = !contactDone
        ? "/supplier/verify-contact"
        : !businessDone
        ? "/supplier/onboarding"
        : !addressDone
        ? "/supplier/onboarding/address"
        : !docsDone
        ? "/supplier/onboarding/documents"
        : "/supplier";

      return {
        authMe,
        supplierMe,
        docs,
        contactDone,
        businessDone,
        addressDone,
        docsDone,
        onboardingDone: contactDone && businessDone && addressDone && docsDone,
        nextPath,
        progressItems: [
          { key: "contact", label: "Contact verified", done: contactDone },
          { key: "business", label: "Business details", done: businessDone },
          { key: "address", label: "Address details", done: addressDone },
          { key: "documents", label: "Documents uploaded", done: docsDone },
        ],
      };
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const onboarding = onboardingQ.data;

  const summaryQ = useQuery({
    queryKey: ["supplier", "dashboard", "summary", { supplierId: adminSupplierId }],
    enabled:
      hydrated &&
      (!isAdmin || !!adminSupplierId) &&
      (!isSupplier || !!onboarding?.onboardingDone),
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/dashboard/summary", {
        withCredentials: true,
        params: { supplierId: adminSupplierId },
      });
      return (data as any)?.data ?? data;
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const insightsQ = useQuery({
    queryKey: ["supplier", "dashboard", "insights", { supplierId: adminSupplierId }],
    enabled:
      hydrated &&
      (!isAdmin || !!adminSupplierId) &&
      (!isSupplier || !!onboarding?.onboardingDone),
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/dashboard/insights", {
        withCredentials: true,
        params: { supplierId: adminSupplierId },
      });
      return (data as any)?.data ?? data;
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const insights = insightsQ.data ?? null;

  const kpis = summaryQ.data ?? {
    liveProducts: 0,
    lowStock: 0,
    pendingOrders: 0,
    shippedToday: 0,
    balance: 0,
    paidOutTotal: 0,
    rating: 0,
    currency: "NGN",
  };

  const ngn = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  });

  const pillBase =
    "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm";

  const onboardingPct = useMemo(() => {
    const items = onboarding?.progressItems || [];
    if (!items.length) return 0;
    const done = items.filter((x) => x.done).length;
    return Math.round((done / items.length) * 100);
  }, [onboarding?.progressItems]);

  const nextStepLabel = useMemo(() => {
    const p = onboarding?.nextPath;
    if (p === "/supplier/verify-contact") return "Continue contact verification";
    if (p === "/supplier/onboarding") return "Continue business onboarding";
    if (p === "/supplier/onboarding/address") return "Continue address setup";
    if (p === "/supplier/onboarding/documents") return "Continue document upload";
    return "Go to supplier dashboard";
  }, [onboarding?.nextPath]);

  const showOnboardingMode =
    isSupplier && !isRider && !!onboarding && !onboarding.onboardingDone;

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="relative overflow-hidden rounded-3xl mt-4 sm:mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />

          <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[20px] sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight"
            >
              {showOnboardingMode ? (
                <>
                  Complete supplier onboarding <Sparkles className="inline ml-1" size={18} />
                </>
              ) : (
                <>
                  Supplier Overview <Sparkles className="inline ml-1" size={18} />
                </>
              )}
            </motion.h1>

            <p className="mt-1 text-[13px] sm:text-sm text-white/80 leading-snug">
              {showOnboardingMode
                ? "Finish the remaining setup steps to unlock full supplier access."
                : "Track sales, manage products, and fulfill orders from one place."}
            </p>

            {isAdmin && !isRider && (
              <div className="mt-4" ref={pickerRef}>
                <div className="text-[11px] text-white/80 mb-1">Admin view</div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className={`${pillBase} bg-white text-zinc-900 hover:opacity-95`}
                    title="Choose supplier"
                  >
                    <span className="max-w-[220px] sm:max-w-[420px] truncate">
                      {selectedSupplierLabel ?? "Select supplier…"}
                    </span>
                    <ChevronDown size={14} />
                  </button>

                  {!!adminSupplierId && (
                    <button
                      type="button"
                      onClick={clearSupplierSelection}
                      className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                      title="Clear supplier selection"
                    >
                      <X size={14} /> Clear
                    </button>
                  )}
                </div>

                {pickerOpen && (
                  <div className="mt-2 w-full max-w-xl rounded-2xl border border-white/20 bg-white/95 text-zinc-900 shadow-lg overflow-hidden">
                    <div className="p-3 border-b bg-white/80">
                      <div className="relative">
                        <Search
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                          size={16}
                        />
                        <input
                          value={supplierQ}
                          onChange={(e) => setSupplierQ(e.target.value)}
                          placeholder="Search suppliers…"
                          className="w-full rounded-xl border bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400 transition"
                          autoFocus
                        />
                      </div>

                      {suppliersQ.isFetching && (
                        <div className="mt-2 text-[11px] text-zinc-500">Searching…</div>
                      )}
                      {suppliersQ.isError && (
                        <div className="mt-2 text-[11px] text-rose-700">
                          Failed to load suppliers. Check your admin suppliers endpoint.
                        </div>
                      )}
                    </div>

                    <div className="max-h-[320px] overflow-auto">
                      {filteredSuppliers.length === 0 && !suppliersQ.isFetching ? (
                        <div className="p-4 text-sm text-zinc-600">No suppliers found.</div>
                      ) : (
                        filteredSuppliers.map((s: any) => {
                          const name = s.businessName || s.name || "Unnamed supplier";
                          const email = s.email ? String(s.email) : "";
                          const active = adminSupplierId === s.id;

                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => selectSupplier(s.id)}
                              className={`w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-black/5 transition ${
                                active ? "bg-emerald-50" : "bg-white"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-zinc-900 truncate">
                                    {name}
                                  </div>
                                  <div className="text-[11px] text-zinc-600 truncate">
                                    {email ? `${email} • ` : ""}
                                    {s.id}
                                  </div>
                                </div>
                                {active && (
                                  <span className="text-[11px] px-2 py-1 rounded-full border bg-white text-emerald-700 border-emerald-200">
                                    Selected
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isRider ? (
              showOnboardingMode ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    to={onboarding?.nextPath || "/supplier/verify-contact"}
                    className={`${pillBase} bg-white text-zinc-900 hover:opacity-95`}
                  >
                    {nextStepLabel} <ArrowRight size={14} />
                  </Link>

                  <Link
                    to="/supplier/verify-contact"
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Contact step <BadgeCheck size={14} />
                  </Link>

                  <Link
                    to="/supplier/onboarding"
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Business step <ShieldCheck size={14} />
                  </Link>

                  <Link
                    to="/supplier/onboarding/address"
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Address step <MapPin size={14} />
                  </Link>

                  <Link
                    to="/supplier/onboarding/documents"
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Documents step <FileText size={14} />
                  </Link>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  <Link
                    to={withSupplierCtx("/supplier/products")}
                    className={`${pillBase} bg-white text-zinc-900 hover:opacity-95`}
                  >
                    Products <ArrowRight size={14} />
                  </Link>

                  <Link
                    to={withSupplierCtx("/supplier/orders")}
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Orders <ArrowRight size={14} />
                  </Link>

                  <Link
                    to={withSupplierCtx("/supplier/catalog-requests")}
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Catalog <Tags size={14} />
                  </Link>

                  <Link
                    to={withSupplierCtx("/supplier/refunds")}
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Refunds <Undo2 size={14} />
                  </Link>

                  <Link
                    to={withSupplierCtx("/supplier/settings")}
                    className={`${pillBase} border border-white/30 bg-white/10 hover:bg-white/15`}
                  >
                    Settings <Settings size={14} />
                  </Link>
                </div>
              )
            ) : (
              <div className="mt-4">
                <Link
                  to={withSupplierCtx("/supplier/orders")}
                  className={`${pillBase} bg-white text-zinc-900 hover:opacity-95`}
                >
                  Go to orders <ArrowRight size={14} />
                </Link>
                <div className="mt-3 text-[12px] text-white/80">
                  Riders can only view and deliver assigned orders.
                </div>
              </div>
            )}

            {isAdmin && !adminSupplierId ? (
              <div className="mt-3 text-[12px] text-amber-200">
                Select a supplier above to load dashboard KPIs.
              </div>
            ) : isSupplier && onboardingQ.isFetching ? (
              <div className="mt-3 text-[12px] text-white/80">Checking onboarding status…</div>
            ) : showOnboardingMode ? (
              <div className="mt-3 text-[12px] text-white/90">
                Onboarding incomplete. Complete the next required step to unlock products, orders,
                payouts and settings.
              </div>
            ) : summaryQ.isFetching ? (
              <div className="mt-3 text-[12px] text-white/80">Loading dashboard…</div>
            ) : summaryQ.isError ? (
              <div className="mt-3 text-[12px] text-white/90">
                Failed to load dashboard.{" "}
                <button className="underline" onClick={() => summaryQ.refetch()}>
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {showOnboardingMode ? (
          <>
            <div className="mt-4 sm:mt-6 grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Contact verification"
                value={onboarding?.contactDone ? "Done" : "Pending"}
                icon={<BadgeCheck size={16} />}
              />
              <Stat
                label="Business details"
                value={onboarding?.businessDone ? "Done" : "Pending"}
                icon={<ShieldCheck size={16} />}
              />
              <Stat
                label="Address details"
                value={onboarding?.addressDone ? "Done" : "Pending"}
                icon={<MapPin size={16} />}
              />
              <Stat
                label="Documents"
                value={onboarding?.docsDone ? "Done" : "Pending"}
                icon={<FileText size={16} />}
              />
            </div>

            <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
              <Card className="lg:col-span-2">
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                    Complete onboarding
                  </div>
                  <div className="text-[11px] sm:text-xs text-zinc-500">
                    Full supplier tools unlock after minimum requirements are complete
                  </div>
                </div>

                <div className="p-4 sm:p-5">
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
                    <div
                      className="h-full rounded-full bg-zinc-900 transition-all"
                      style={{ width: `${onboardingPct}%` }}
                    />
                  </div>

                  <div className="mt-3 text-sm text-zinc-700">
                    Progress: <span className="font-semibold text-zinc-900">{onboardingPct}%</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {(onboarding?.progressItems || []).map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between rounded-2xl border bg-white px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                              item.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {item.done ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}
                          </div>
                          <div className="text-sm font-medium text-zinc-900">{item.label}</div>
                        </div>

                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            item.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {item.done ? "Done" : "Pending"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      to={onboarding?.nextPath || "/supplier/verify-contact"}
                      className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black"
                    >
                      {nextStepLabel}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                    Locked until onboarding completes
                  </div>
                  <div className="text-[11px] sm:text-xs text-zinc-500">
                    These supplier tools stay restricted for now
                  </div>
                </div>

                <div className="p-3 sm:p-5 space-y-3 text-[13px] sm:text-sm text-zinc-700">
                  {[
                    "Products and new listings",
                    "Order fulfilment actions",
                    "Payout access",
                    "Store settings",
                    "Refund workflow",
                  ].map((x) => (
                    <div key={x} className="rounded-xl border bg-zinc-50 p-3 text-zinc-700">
                      {x}
                    </div>
                  ))}

                  <div className="rounded-xl border bg-white p-3">
                    <div className="font-semibold text-zinc-900 text-[13px] sm:text-sm">
                      Current supplier status
                    </div>
                    <div className="mt-2 text-[12px] text-zinc-600 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span>Status</span>
                        <b className="text-zinc-900">
                          {String(onboarding?.supplierMe?.status ?? "PENDING")}
                        </b>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>KYC</span>
                        <b className="text-zinc-900">
                          {String(onboarding?.supplierMe?.kycStatus ?? "PENDING")}
                        </b>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 sm:mt-6 grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Live products" value={`${kpis.liveProducts}`} icon={<Package size={16} />} />
              <Stat label="Low stock" value={`${kpis.lowStock}`} icon={<Box size={16} />} hint="Restock soon" />
              <Stat label="Pending orders" value={`${kpis.pendingOrders}`} icon={<ShoppingBag size={16} />} />
              <Stat label="Shipped today" value={`${kpis.shippedToday}`} icon={<Truck size={16} />} />
              <Stat label="Available balance" value={ngn.format(kpis.balance)} icon={<CircleDollarSign size={16} />} />
              <Stat label="Paid out" value={ngn.format(kpis.paidOutTotal)} icon={<CircleDollarSign size={16} />} />
              <Stat label="Store rating" value={kpis.rating ? `${kpis.rating.toFixed(1)}` : "—"} icon={<BadgeCheck size={16} />} />
            </div>

            {!isRider ? (
              <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
                <Card className="lg:col-span-2">
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                    <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Today’s checklist</div>
                    <div className="text-[11px] sm:text-xs text-zinc-500">Fast actions suppliers do daily</div>
                  </div>

                  <div className="p-3 sm:p-5 space-y-2.5">
                    {[
                      { title: "Confirm stock levels", desc: "Update inventory for popular SKUs.", to: "/supplier/products" },
                      { title: "Fulfill pending orders", desc: "Pack and mark orders as shipped.", to: "/supplier/orders" },
                      { title: "Review payouts", desc: "Check balance and payout schedule.", to: "/supplier/payouts" },
                      {
                        title: "Request catalog items",
                        desc: "Need a new brand/category/attribute? Submit a request for admin approval.",
                        to: "/supplier/catalog-requests",
                      },
                      { title: "Update store settings", desc: "Pickup address, payout details & notifications.", to: "/supplier/settings" },
                    ].map((x) => (
                      <Link
                        key={x.title}
                        to={withSupplierCtx(x.to)}
                        className="block rounded-2xl border bg-white hover:bg-black/5 transition p-3 sm:p-4"
                      >
                        <div className="font-semibold text-[13px] sm:text-sm text-zinc-900">{x.title}</div>
                        <div className="text-[12px] sm:text-sm text-zinc-600 leading-snug mt-0.5">{x.desc}</div>
                      </Link>
                    ))}
                  </div>
                </Card>

                <Card>
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                    <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Quick insights</div>
                    <div className="text-[11px] sm:text-xs text-zinc-500">Placeholder (wire to analytics)</div>
                  </div>

                  <div className="p-3 sm:p-5 space-y-3 text-[13px] sm:text-sm text-zinc-700">
                    {isAdmin && !adminSupplierId ? (
                      <div className="rounded-xl border bg-white p-3 text-zinc-600">
                        Select a supplier above to load insights.
                      </div>
                    ) : insightsQ.isFetching ? (
                      <div className="rounded-xl border bg-white p-3 text-zinc-600">Loading insights…</div>
                    ) : insightsQ.isError ? (
                      <div className="rounded-xl border bg-white p-3 text-rose-700">
                        Failed to load insights.{" "}
                        <button className="underline" onClick={() => insightsQ.refetch()}>
                          Retry
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-xl border bg-white p-3">
                          Top product (last {insights?.windowDays ?? 30} days):{" "}
                          <b>{insights?.topProduct?.title ?? "—"}</b>
                          {insights?.topProduct ? (
                            <div className="text-[11px] text-zinc-500 mt-1">
                              Revenue: <b>{ngn.format(insights.topProduct.revenue)}</b> • Units:{" "}
                              <b>{insights.topProduct.units}</b>
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-xl border bg-white p-3">
                          Most ordered: <b>{insights?.mostOrdered?.title ?? "—"}</b>
                          {insights?.mostOrdered ? (
                            <div className="text-[11px] text-zinc-500 mt-1">
                              Units: <b>{insights.mostOrdered.units}</b>
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-xl border bg-white p-3">
                          Refund rate (last {insights?.windowDays ?? 30} days):{" "}
                          <b>{(insights?.refundRatePct ?? 0).toFixed(1)}%</b>
                          <div className="text-[11px] text-zinc-500 mt-1">
                            Refunds: <b>{insights?.refunds ?? 0}</b> • Purchase orders:{" "}
                            <b>{insights?.purchaseOrders ?? 0}</b>
                            {typeof insights?.pendingPayouts === "number" ? (
                              <>
                                {" "}
                                • Pending payouts: <b>{insights.pendingPayouts}</b>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </>
                    )}

                    <Link
                      to={withSupplierCtx("/supplier/catalog-requests")}
                      className="block rounded-xl border bg-white p-3 hover:bg-black/5 transition"
                    >
                      <div className="font-semibold text-zinc-900 text-[13px] sm:text-sm">Catalog requests</div>
                      <div className="text-[11px] sm:text-xs text-zinc-600">Ask admin to add new brands, categories or attributes</div>
                    </Link>

                    <Link
                      to={withSupplierCtx("/supplier/settings")}
                      className="block rounded-xl border bg-white p-3 hover:bg-black/5 transition"
                    >
                      <div className="font-semibold text-zinc-900 text-[13px] sm:text-sm">Settings</div>
                      <div className="text-[11px] sm:text-xs text-zinc-600">Edit payout, pickup and notifications</div>
                    </Link>
                  </div>
                </Card>
              </div>
            ) : (
              <div className="mt-6">
                <Card>
                  <div className="px-5 py-4 border-b bg-white/70">
                    <div className="text-sm font-semibold text-zinc-900">Rider access</div>
                    <div className="text-xs text-zinc-500">You can only view and deliver assigned orders.</div>
                  </div>
                  <div className="p-5">
                    <Link
                      to={withSupplierCtx("/supplier/orders")}
                      className="inline-flex items-center gap-2 rounded-full bg-primary-900 text-white px-4 py-2 text-sm font-semibold hover:opacity-95"
                    >
                      View assigned orders <ArrowRight size={16} />
                    </Link>
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </SupplierLayout>
    </SiteLayout>
  );
}