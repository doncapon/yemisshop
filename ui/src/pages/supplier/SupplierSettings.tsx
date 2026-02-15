// src/pages/supplier/SupplierSettings.tsx
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Bell,
  Building2,
  CreditCard,
  FileText,
  Lock,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Clock,
  Hash,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import { useAuthStore } from "../../store/auth";
import { useModal } from "../../components/ModalProvider";
import api from "../../api/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { AxiosError } from "axios";

type BankOption = { country: string; code: string; name: string };

const FALLBACK_BANKS: BankOption[] = [
  { country: "NG", code: "044", name: "Access Bank" },
  { country: "NG", code: "011", name: "First Bank of Nigeria" },
  { country: "NG", code: "058", name: "Guaranty Trust Bank" },
  { country: "NG", code: "221", name: "Stanbic IBTC Bank" },
  { country: "NG", code: "232", name: "Sterling Bank" },
  { country: "NG", code: "033", name: "United Bank for Africa" },
  { country: "NG", code: "035", name: "Wema Bank" },
];

type BankVerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

type SupplierSettingsDraft = {
  businessName: string;
  rcNumber: string;

  supportEmail: string;
  supportPhone: string;

  pickupAddressLine1: string;
  pickupCity: string;
  pickupState: string;

  bankCountry: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;

  notifyNewOrders: boolean;
  notifyLowStock: boolean;
  notifyPayouts: boolean;

  docsID: string;
};

type SupplierMeDto = {
  id: string;
  name: string;

  rcNumber?: string | null;

  contactEmail?: string | null;
  whatsappPhone?: string | null;

  registeredAddress?: {
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    town?: string | null;
  } | null;

  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;

  bankVerificationStatus?: BankVerificationStatus | null;
  bankVerificationNote?: string | null;
  bankVerificationRequestedAt?: string | null;
  bankVerifiedAt?: string | null;
};

type AuthMeDto = {
  id: string;
  email: string;
  phone?: string | null;
  role: string;
};

const ADMIN_SUPPLIER_KEY = "adminSupplierId";
const LS_KEY = "supplierSettings:v3";

const norm = (v: any) => String(v ?? "").trim();
const normCode = (v: any) => norm(v).padStart(3, "0");

/** cookie-auth config (replace Bearer token header usage) */
const cookieCfg = { withCredentials: true } as const;

function Card({
  title,
  subtitle,
  icon,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden">
      {/* mobile-neater header: stack on small screens */}
      <div className="px-4 md:px-5 py-3 border-b bg-white/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          {icon && <div className="mt-[2px] text-zinc-700 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 truncate">{title}</div>
            {subtitle && <div className="text-xs text-zinc-500 mt-0.5">{subtitle}</div>}
          </div>
        </div>
        {right ? <div className="sm:ml-3">{right}</div> : null}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-zinc-700">{label}</label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full rounded-xl border border-zinc-300/80 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 outline-none transition shadow-sm ${
            icon ? "pl-9" : ""
          } ${
            disabled
              ? "bg-zinc-50 text-zinc-600 cursor-not-allowed"
              : "bg-white focus:border-violet-400 focus:ring-4 focus:ring-violet-200"
          }`}
        />
      </div>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  icon,
  placeholder = "—",
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  placeholder?: string;
}) {
  const v = (value || "").trim();
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-zinc-700">{label}</label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            {icon}
          </div>
        )}
        <input
          value={v || placeholder}
          readOnly
          disabled
          className={`w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-zinc-800 outline-none shadow-sm ${
            icon ? "pl-9" : ""
          }`}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-full rounded-2xl border transition p-4 text-left flex items-start justify-between gap-3 ${
        disabled
          ? "bg-zinc-50 text-zinc-500 cursor-not-allowed"
          : "bg-white hover:bg-black/5"
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-900">{label}</div>
        {desc && <div className="text-xs text-zinc-500 mt-1">{desc}</div>}
      </div>
      <span
        className={`shrink-0 inline-flex h-6 w-11 items-center rounded-full border transition ${
          checked ? "bg-zinc-900 border-zinc-900" : "bg-zinc-200 border-zinc-300"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow-sm transition transform ${
            checked ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

export default function SupplierSettings() {
  const { openModal } = useModal();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const userFromStore = useAuthStore((s) => s.user);

  const [searchParams, setSearchParams] = useSearchParams();

  const urlSupplierId = useMemo(() => {
    const v = String(searchParams.get("supplierId") ?? "").trim();
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();
    return v || undefined;
  }, []);

  // ✅ robust admin detection: prefer /auth/me role once loaded, fallback to store
  const roleFromStore = (userFromStore as any)?.role;
  const [roleOverride, setRoleOverride] = useState<string | null>(null);
  const role = roleOverride ?? roleFromStore ?? "";
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const adminSupplierId = isAdmin ? (urlSupplierId ?? storedSupplierId) : undefined;

  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = String(searchParams.get("supplierId") ?? "").trim();
    const fromStore = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();

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

  const initial: SupplierSettingsDraft = useMemo(
    () => ({
      businessName: "",
      rcNumber: "",
      supportEmail: (userFromStore?.email || "").toString(),
      supportPhone: "",
      pickupAddressLine1: "",
      pickupCity: "",
      pickupState: "",
      bankCountry: "NG",
      bankCode: "",
      bankName: "",
      accountNumber: "",
      accountName: "",
      notifyNewOrders: true,
      notifyLowStock: true,
      notifyPayouts: true,
      docsID: "",
    }),
    [userFromStore?.email]
  );

  const [draft, setDraft] = useState<SupplierSettingsDraft>(initial);
  const [bankEditUnlocked, setBankEditUnlocked] = useState(false);

  const meQ = useQuery<AuthMeDto, AxiosError>({
  queryKey: ["auth", "me"],
  queryFn: async () => {
    const { data } = await api.get<AuthMeDto>("/api/auth/me", cookieCfg);
    return data;
  },
  staleTime: 60_000,
  retry: 1,
});

// keep role aligned even if store is stale
useEffect(() => {
  const roleFromMe = meQ.data?.role;
  if (roleFromMe && roleFromMe !== roleOverride) {
    setRoleOverride(roleFromMe);
  }
}, [meQ.data?.role, roleOverride]);

// handle 401s
useEffect(() => {
  const status = meQ.error?.response?.status;
  if (status === 401) {
    openModal({
      title: "Session expired",
      message: "Please log in again.",
    });
    navigate("/login");
  }
}, [meQ.error, navigate, openModal]);

  const supplierQ = useQuery({
    queryKey: ["supplier", "me", { supplierId: adminSupplierId }],
    enabled: !isAdmin || !!adminSupplierId,
    queryFn: async () => {
      const { data } = await api.get<{ data: SupplierMeDto }>(
        "/api/supplier/me",
        {
          ...cookieCfg,
          params: { supplierId: adminSupplierId }, // ✅ admin view-as supplier
        }
      );
      return data.data;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const banksQ = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const { data } = await api.get<{ data: BankOption[] }>("/api/banks", cookieCfg);
      return Array.isArray(data?.data) && data.data.length > 0 ? data.data : FALLBACK_BANKS;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const banks = banksQ.data ?? FALLBACK_BANKS;

  const countryBanks = useMemo(() => {
    const country = draft.bankCountry || "NG";
    return banks.filter((b) => b.country === country);
  }, [banks, draft.bankCountry]);

  useEffect(() => {
    if (!countryBanks.length) return;

    setDraft((d) => {
      const code = normCode(d.bankCode);
      const name = norm(d.bankName);

      if (code) {
        const m = countryBanks.find((b) => normCode(b.code) === code);
        if (m) return { ...d, bankCode: normCode(m.code), bankName: m.name };
      }

      if (name) {
        const m = countryBanks.find((b) => norm(b.name).toLowerCase() === name.toLowerCase());
        if (m) return { ...d, bankName: m.name, bankCode: normCode(m.code) };
      }

      if (d.bankCode !== code) return { ...d, bankCode: code };
      return d;
    });
  }, [draft.bankCountry, countryBanks.length]); // avoid loops

  function setBankByName(name: string) {
    const match = countryBanks.find((b) => b.name === name);
    setDraft((d) => ({
      ...d,
      bankName: name || "",
      bankCode: match?.code || "",
    }));
  }
  function setBankByCode(code: string) {
    const c = normCode(code);
    const match = countryBanks.find((b) => normCode(b.code) === c);
    setDraft((d) => ({
      ...d,
      bankCode: c,
      bankName: match?.name || d.bankName || "",
    }));
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setDraft((d) => ({
          ...d,
          ...parsed,
          businessName: d.businessName,
          rcNumber: d.rcNumber,
          supportEmail: (parsed.supportEmail || d.supportEmail || "").toString(),
        }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    const sup = supplierQ.data;
    const me = meQ.data;
    if (!sup && !me) return;

    setDraft((d) => {
      const addr = sup?.registeredAddress;
      return {
        ...d,
        businessName: (sup?.name ?? d.businessName ?? "").toString(),
        rcNumber: (sup?.rcNumber ?? d.rcNumber ?? "").toString(),

        supportEmail: (sup?.contactEmail ?? me?.email ?? d.supportEmail ?? "").toString(),
        supportPhone: (sup?.whatsappPhone ?? me?.phone ?? d.supportPhone ?? "").toString(),

        pickupAddressLine1: (addr?.streetName ?? d.pickupAddressLine1 ?? "").toString(),
        pickupCity: (addr?.city ?? addr?.town ?? d.pickupCity ?? "").toString(),
        pickupState: (addr?.state ?? d.pickupState ?? "").toString(),

        bankCountry: (sup?.bankCountry ?? d.bankCountry ?? "NG").toString(),
        bankCode: (sup?.bankCode ?? d.bankCode ?? "").toString(),
        bankName: (sup?.bankName ?? d.bankName ?? "").toString(),
        accountNumber: (sup?.accountNumber ?? d.accountNumber ?? "").toString(),
        accountName: (sup?.accountName ?? d.accountName ?? "").toString(),
      };
    });

    if ((supplierQ.data?.bankVerificationStatus ?? "UNVERIFIED") === "VERIFIED") {
      setBankEditUnlocked(false);
    }
  }, [supplierQ.data, meQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const bankStatus: BankVerificationStatus = (supplierQ.data?.bankVerificationStatus ??
    "UNVERIFIED") as BankVerificationStatus;

  const bankLockedByStatus = bankStatus === "VERIFIED" || bankStatus === "PENDING";
  const bankEditable = !bankLockedByStatus || bankEditUnlocked;

  const saveM = useMutation({
    mutationFn: async (payload: any) => {
      const { data } = await api.put<{ data: SupplierMeDto }>(
        "/api/supplier/me",
        payload,
        {
          ...cookieCfg,
          params: { supplierId: adminSupplierId }, // backend can still enforce role
        }
      );
      return data.data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["supplier", "me"] });
      setBankEditUnlocked(false);
      openModal({ title: "Settings saved", message: "Supplier settings have been saved." });
    },
    onError: (e: any) => {
      openModal({
        title: "Could not save",
        message: e?.response?.data?.error || "Please try again.",
      });
    },
  });

  const save = async () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(draft));
    } catch {}

    if (isAdmin) {
      openModal({ title: "Admin view", message: "Admin supplier settings is read-only for now." });
      return;
    }

    // cookie-auth: if not logged in, server will 401; keep local save message friendly
    const payload: any = {
      contactEmail: draft.supportEmail?.trim() ? draft.supportEmail.trim() : null,
      whatsappPhone: draft.supportPhone?.trim() ? draft.supportPhone.trim() : null,
    };

    if (bankEditable) {
      payload.bankCountry = draft.bankCountry?.trim() ? draft.bankCountry.trim() : null;
      payload.bankCode = draft.bankCode?.trim() ? draft.bankCode.trim() : null;
      payload.bankName = draft.bankName?.trim() ? draft.bankName.trim() : null;
      payload.accountNumber = draft.accountNumber?.replace(/\D/g, "").trim() || null;
      payload.accountName = draft.accountName?.trim() ? draft.accountName.trim() : null;
    }

    try {
      await saveM.mutateAsync(payload);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        openModal({
          title: "Saved locally only",
          message: "You’re not logged in, so settings were saved only on this device.",
        });
      }
    }
  };

  const saving = saveM.isPending;

  const bankStatusChip = (() => {
    if (bankStatus === "VERIFIED")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 border border-emerald-200 text-[11px]">
          <BadgeCheck size={14} /> Verified
        </span>
      );
    if (bankStatus === "PENDING")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 border border-amber-200 text-[11px]">
          <Clock size={14} /> Pending admin verification
        </span>
      );
    if (bankStatus === "REJECTED")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 px-2.5 py-1 border border-rose-200 text-[11px]">
          <AlertTriangle size={14} /> Rejected
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 text-zinc-700 px-2.5 py-1 border border-zinc-200 text-[11px]">
        <Lock size={14} /> Unverified
      </span>
    );
  })();

  const bankFieldsDisabled = isAdmin || !bankEditable;
  const generalFieldsDisabled = isAdmin;

  const showAdminNeedSupplier = isAdmin && !adminSupplierId;

  return (
    <SiteLayout>
      <SupplierLayout>
        {/* Sticky mobile save bar */}
        {!isAdmin && (
          <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-white/90 backdrop-blur">
            <div className="px-4 py-3 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
              >
                <Save size={16} />
                {saving ? "Saving…" : "Save changes"}
              </button>
              <div className="shrink-0">{bankStatusChip}</div>
            </div>
          </div>
        )}

        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-7 md:py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl md:text-3xl font-bold tracking-tight"
            >
              Supplier Settings <Sparkles className="inline ml-1" size={22} />
            </motion.h1>
            <p className="mt-1 text-sm text-white/80">
              Configure store profile, pickup details, payouts, notifications and security.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
              <button
                onClick={save}
                disabled={saving || isAdmin}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95 disabled:opacity-60"
              >
                <Save size={16} />
                {isAdmin ? "Admin view (read-only)" : saving ? "Saving…" : "Save changes"}
              </button>

              <span className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold">
                <ShieldCheck size={16} />
                {isAdmin ? "Admin view" : "Supplier portal"}
              </span>

              {showAdminNeedSupplier ? (
                <span className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2 text-sm font-semibold">
                  Select a supplier first
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="mt-6 space-y-4 pb-28 sm:pb-10">
          <Card
            title="Store profile"
            subtitle="Business name, RC number and CAC address are locked (pulled from registration)."
            icon={<Building2 size={18} />}
            right={
              <span className="inline-flex items-center gap-2 text-[11px] rounded-full border bg-white px-3 py-1.5 text-zinc-700">
                <Lock size={14} /> CAC-locked fields
              </span>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ReadOnlyField
                label="Business name"
                value={draft.businessName}
                icon={<Building2 size={16} />}
              />
              <ReadOnlyField
                label="RC number"
                value={draft.rcNumber}
                icon={<Hash size={16} />}
                placeholder="Not available yet"
              />

              <Field
                label="Support email"
                value={draft.supportEmail}
                onChange={(v) => setDraft((d) => ({ ...d, supportEmail: v }))}
                placeholder="support@yourstore.com"
                icon={<Mail size={16} />}
                type="email"
                disabled={generalFieldsDisabled}
              />

              <Field
                label="Support phone"
                value={draft.supportPhone}
                onChange={(v) => setDraft((d) => ({ ...d, supportPhone: v }))}
                placeholder="e.g. +234 801 234 5678"
                icon={<Phone size={16} />}
                disabled={generalFieldsDisabled}
              />
            </div>
          </Card>

          <Card
            title="Pickup address"
            subtitle="Pulled from CAC during registration and cannot be edited."
            icon={<MapPin size={18} />}
            right={
              <span className="inline-flex items-center gap-2 text-[11px] rounded-full border bg-white px-3 py-1.5 text-zinc-700">
                <Lock size={14} /> CAC-locked
              </span>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ReadOnlyField
                label="Address line"
                value={draft.pickupAddressLine1}
                icon={<MapPin size={16} />}
                placeholder="Not available yet"
              />
              <ReadOnlyField label="City" value={draft.pickupCity} placeholder="Not available yet" />
              <ReadOnlyField
                label="State"
                value={draft.pickupState}
                placeholder="Not available yet"
              />
            </div>
          </Card>

          <Card
            title="Payout bank details"
            subtitle="Any bank change requires admin verification. Verified details are locked."
            icon={<CreditCard size={18} />}
            right={
              <div className="flex flex-wrap items-center gap-2">
                {bankStatusChip}
                {!isAdmin && bankStatus === "VERIFIED" && !bankEditUnlocked && (
                  <button
                    type="button"
                    onClick={() => {
                      openModal({
                        title: "Request bank change",
                        message:
                          "You can update your bank details once. When you save, the change will be pending admin verification and locked until reviewed.",
                      });
                      setBankEditUnlocked(true);
                    }}
                    className="text-[11px] px-3 py-1.5 rounded-full border bg-white hover:bg-black/5"
                  >
                    Request change
                  </button>
                )}
                {!isAdmin && bankEditUnlocked && (
                  <button
                    type="button"
                    onClick={() => setBankEditUnlocked(false)}
                    className="text-[11px] px-3 py-1.5 rounded-full border bg-white hover:bg-black/5"
                  >
                    Cancel change
                  </button>
                )}
              </div>
            }
          >
            {supplierQ.data?.bankVerificationNote && (
              <div className="mb-3 text-[11px] rounded-xl border bg-zinc-50 px-3 py-2 text-zinc-700">
                <span className="font-semibold">Admin note:</span> {supplierQ.data.bankVerificationNote}
              </div>
            )}

            {bankStatus === "PENDING" && (
              <div className="mb-3 text-[11px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Bank details are <span className="font-semibold">pending verification</span>. Editing
                is locked until admin review.
              </div>
            )}

            {/* mobile-neater: keep inputs stacked; on md use 3 cols */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <label className="block text-xs font-semibold text-zinc-700">Bank country</label>
                <select
                  className={`w-full rounded-xl border px-3 py-2.5 shadow-sm outline-none transition ${
                    bankFieldsDisabled
                      ? "bg-zinc-50 border-zinc-200 text-zinc-600 cursor-not-allowed"
                      : "bg-white border-zinc-300/80 focus:border-violet-400 focus:ring-4 focus:ring-violet-200"
                  }`}
                  value={draft.bankCountry || "NG"}
                  disabled={bankFieldsDisabled}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      bankCountry: e.target.value || "NG",
                      bankCode: "",
                      bankName: "",
                    }))
                  }
                >
                  <option value="NG">Nigeria (NG)</option>
                </select>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {banksQ.isFetching ? "Loading banks…" : ""}
                </div>
              </div>

              <div className="md:col-span-1">
                <label className="block text-xs font-semibold text-zinc-700">Bank name</label>
                <select
                  className={`w-full rounded-xl border px-3 py-2.5 shadow-sm outline-none transition ${
                    bankFieldsDisabled
                      ? "bg-zinc-50 border-zinc-200 text-zinc-600 cursor-not-allowed"
                      : "bg-white border-zinc-300/80 focus:border-violet-400 focus:ring-4 focus:ring-violet-200"
                  }`}
                  value={draft.bankName ?? ""}
                  disabled={bankFieldsDisabled}
                  onChange={(e) => setBankByName(e.target.value)}
                >
                  <option value="">Select bank…</option>
                  {countryBanks.map((b) => (
                    <option key={`${b.country}-${b.code}`} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1">
                <label className="block text-xs font-semibold text-zinc-700">Bank code</label>
                <select
                  className={`w-full rounded-xl border px-3 py-2.5 shadow-sm outline-none transition ${
                    bankFieldsDisabled
                      ? "bg-zinc-50 border-zinc-200 text-zinc-600 cursor-not-allowed"
                      : "bg-white border-zinc-300/80 focus:border-violet-400 focus:ring-4 focus:ring-violet-200"
                  }`}
                  value={normCode(draft.bankCode)}
                  disabled={bankFieldsDisabled}
                  onChange={(e) => setBankByCode(e.target.value)}
                >
                  <option value="">Select bank…</option>
                  {countryBanks.map((b) => (
                    <option key={`${b.country}-${b.code}`} value={b.code}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <Field
                label="Account number"
                value={draft.accountNumber}
                disabled={bankFieldsDisabled}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    accountNumber: v.replace(/\D/g, "").slice(0, 16),
                  }))
                }
                placeholder="0123456789"
              />

              <Field
                label="Account name"
                value={draft.accountName}
                disabled={bankFieldsDisabled}
                onChange={(v) => setDraft((d) => ({ ...d, accountName: v }))}
                placeholder="e.g. ACME DISTRIBUTION LTD"
              />
            </div>

            <div className="mt-3 text-[11px] text-zinc-500">
              {isAdmin
                ? "Admin view is read-only."
                : bankStatus === "VERIFIED" && !bankEditUnlocked
                ? "Bank details are verified and locked. Use “Request change” to submit an update."
                : "When you save new bank details, they become pending admin verification."}
            </div>
          </Card>

          <Card
            title="Notifications"
            subtitle="Control which alerts you receive. (Not yet wired to backend)"
            icon={<Bell size={18} />}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Toggle
                label="New orders"
                desc="Get notified when you receive a new order."
                checked={draft.notifyNewOrders}
                onChange={(v) => setDraft((d) => ({ ...d, notifyNewOrders: v }))}
                disabled={isAdmin}
              />
              <Toggle
                label="Low stock"
                desc="Alerts when inventory is running low."
                checked={draft.notifyLowStock}
                onChange={(v) => setDraft((d) => ({ ...d, notifyLowStock: v }))}
                disabled={isAdmin}
              />
              <Toggle
                label="Payout updates"
                desc="Updates when payouts are processed."
                checked={draft.notifyPayouts}
                onChange={(v) => setDraft((d) => ({ ...d, notifyPayouts: v }))}
                disabled={isAdmin}
              />
            </div>
          </Card>

          <Card title="Verification documents" subtitle="Placeholder UI (not wired)." icon={<FileText size={18} />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ReadOnlyField
                label="CAC RC number"
                value={draft.rcNumber}
                icon={<Hash size={16} />}
                placeholder="Not available yet"
              />
              <Field
                label="Owner ID (or file ref)"
                value={draft.docsID}
                onChange={(v) => setDraft((d) => ({ ...d, docsID: v }))}
                placeholder="e.g. NIN / Passport ref"
                disabled={isAdmin}
              />
            </div>
          </Card>

          <Card title="Security" subtitle="Account security actions (not wired)." icon={<Lock size={18} />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="rounded-2xl border bg-white hover:bg-black/5 transition p-4 text-left"
              >
                <div className="text-sm font-semibold text-zinc-900">Change password</div>
                <div className="text-xs text-zinc-500 mt-1">Reset your password via email/OTP.</div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/account/sessions")}
                className="rounded-2xl border bg-white hover:bg-black/5 transition p-4 text-left"
              >
                <div className="text-sm font-semibold text-zinc-900">Manage sessions</div>
                <div className="text-xs text-zinc-500 mt-1">Device/IP tracking and forced logout.</div>
              </button>
            </div>
          </Card>

          {/* Desktop footer actions (mobile uses sticky bar) */}
          <div className="hidden sm:flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={saving || isAdmin}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              <Save size={16} />
              {isAdmin ? "Admin view (read-only)" : saving ? "Saving…" : "Save changes"}
            </button>

            <div className="text-[11px] text-zinc-500">
              Bank changes require admin verification. Fields lock when status is{" "}
              <span className="font-mono">PENDING</span> or{" "}
              <span className="font-mono">VERIFIED</span>.
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
