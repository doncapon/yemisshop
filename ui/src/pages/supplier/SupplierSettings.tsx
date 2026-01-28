// src/pages/supplier/SupplierSettings.tsx
import { useEffect, useMemo, useState } from "react";
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
import { useAuthStore } from "../../store/auth";
import { useModal } from "../../components/ModalProvider";
import api from "../../api/client";
import { useNavigate } from "react-router-dom";

/**
 * Rules:
 * - Business name: read-only (CAC-locked)
 * - RC number: read-only (from Supplier.rcNumber)
 * - Address: read-only (CAC-locked)
 * - Bank details:
 *    - Supplier can submit bank details
 *    - Any change => bankVerificationStatus becomes PENDING (admin must verify)
 *    - When VERIFIED: fields are locked
 *    - If supplier needs changes after VERIFIED: click "Request bank change" (creates a pending update on save)
 */

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
  rcNumber: string; // ✅ read-only

  supportEmail: string;
  supportPhone: string;

  // CAC-derived (read-only)
  pickupAddressLine1: string;
  pickupCity: string;
  pickupState: string;

  // Bank (subject to admin verification)
  bankCountry: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;

  // UI-only for now
  notifyNewOrders: boolean;
  notifyLowStock: boolean;
  notifyPayouts: boolean;

  // UI-only for now
  docsID: string;
};

type SupplierMeDto = {
  id: string;
  name: string;

  // ✅ from Supplier table (already stored during registration)
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

const norm = (v: any) => String(v ?? "").trim();
const normCode = (v: any) => norm(v).padStart(3, "0"); // "44" -> "044"


const LS_KEY = "supplierSettings:v3";

/* ---------------- UI components ---------------- */

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
      <div className="px-4 md:px-5 py-3 border-b bg-white/70 flex items-center justify-between">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-[2px] text-zinc-700">{icon}</div>}
          <div>
            <div className="text-sm font-semibold text-zinc-900">{title}</div>
            {subtitle && <div className="text-xs text-zinc-500">{subtitle}</div>}
          </div>
        </div>
        {right}
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
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{icon}</div>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full rounded-xl border border-zinc-300/80 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 outline-none transition shadow-sm ${icon ? "pl-9" : ""
            } ${disabled
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
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{icon}</div>}
        <input
          value={v || placeholder}
          readOnly
          disabled
          className={`w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-zinc-800 outline-none shadow-sm ${icon ? "pl-9" : ""
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
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full rounded-2xl border bg-white hover:bg-black/5 transition p-4 text-left flex items-start justify-between gap-3"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-900">{label}</div>
        {desc && <div className="text-xs text-zinc-500 mt-1">{desc}</div>}
      </div>
      <span
        className={`shrink-0 inline-flex h-6 w-11 items-center rounded-full border transition ${checked ? "bg-zinc-900 border-zinc-900" : "bg-zinc-200 border-zinc-300"
          }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow-sm transition transform ${checked ? "translate-x-5" : "translate-x-1"
            }`}
        />
      </span>
    </button>
  );
}

/* ---------------- page ---------------- */

export default function SupplierSettings() {
  const { openModal } = useModal();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const token = useAuthStore((s) => s.token);
  const userFromStore = useAuthStore((s) => s.user);
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

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

  // local “request change” toggle (only matters when VERIFIED)
  const [bankEditUnlocked, setBankEditUnlocked] = useState(false);

  /* ---------------- Queries ---------------- */

  const meQ = useQuery({
    queryKey: ["auth", "me"],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<AuthMeDto>("/api/auth/me", { headers: hdr });
      return data;
    },
    staleTime: 60_000,
  });

  const supplierQ = useQuery({
    queryKey: ["supplier", "me"],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<{ data: SupplierMeDto }>("/api/supplier/me", { headers: hdr });
      return data.data;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const banksQ = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const { data } = await api.get<{ data: BankOption[] }>("/api/banks");
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

      // If code exists, prefer it and derive name
      if (code) {
        const m = countryBanks.find((b) => normCode(b.code) === code);
        if (m) {
          return {
            ...d,
            bankCode: normCode(m.code),
            bankName: m.name,
          };
        }
      }

      // Else if name exists, derive code
      if (name) {
        const m = countryBanks.find((b) => norm(b.name).toLowerCase() === name.toLowerCase());
        if (m) {
          return {
            ...d,
            bankName: m.name,
            bankCode: normCode(m.code),
          };
        }
      }

      // Otherwise just normalize what we have
      if (d.bankCode !== code) return { ...d, bankCode: code };
      return d;
    });
  }, [draft.bankCountry, countryBanks.length]); // intentionally not depending on draft.bankCode to avoid loops


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


  /* ---------------- LocalStorage fallback ---------------- */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setDraft((d) => ({
          ...d,
          ...parsed,
          // never trust local CAC-locked fields; API will overwrite
          businessName: d.businessName,
          rcNumber: d.rcNumber,
          supportEmail: (parsed.supportEmail || d.supportEmail || "").toString(),
        }));
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- Hydrate draft from API ---------------- */

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

  /* ---------------- Save mutation ---------------- */

  const saveM = useMutation({
    mutationFn: async (payload: {
      contactEmail?: string | null;
      whatsappPhone?: string | null;

      bankCountry?: string | null;
      bankCode?: string | null;
      bankName?: string | null;
      accountNumber?: string | null;
      accountName?: string | null;
    }) => {
      const { data } = await api.put<{ data: SupplierMeDto }>("/api/supplier/me", payload, { headers: hdr });
      return data.data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["supplier", "me"] });
      setBankEditUnlocked(false);
      openModal({ title: "Settings saved", message: "Your supplier settings have been saved." });
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
    } catch {
      // ignore
    }

    if (!token) {
      openModal({
        title: "Saved locally only",
        message: "You’re not logged in, so settings were saved only on this device.",
      });
      return;
    }

    // Do NOT send businessName, rcNumber, CAC address (locked)
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

    await saveM.mutateAsync(payload);
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
console.log("saved bankCode:", supplierQ.data?.bankCode, "draft:", draft.bankCode, "options:", countryBanks.map(b => b.code));

  return (
    <SiteLayout>
      <div className="max-w-screen-2xl mx-auto min-h-screen">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-8 text-white">
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

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95 disabled:opacity-60"
              >
                <Save size={16} />
                {saving ? "Saving…" : "Save changes"}
              </button>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold">
                <ShieldCheck size={16} />
                Supplier portal
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-2 md:px-8 pb-10 mt-6 space-y-4">
          {/* Store profile */}
          <Card
            title="Store profile"
            subtitle="Business name, RC number and CAC address are locked (pulled from registration)."
            icon={<Building2 size={18} />}
            right={
              <span className="hidden sm:inline-flex items-center gap-2 text-[11px] rounded-full border bg-white px-3 py-1.5 text-zinc-700">
                <Lock size={14} /> CAC-locked fields
              </span>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ReadOnlyField label="Business name" value={draft.businessName} icon={<Building2 size={16} />} />
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
              />

              <Field
                label="Support phone"
                value={draft.supportPhone}
                onChange={(v) => setDraft((d) => ({ ...d, supportPhone: v }))}
                placeholder="e.g. +234 801 234 5678"
                icon={<Phone size={16} />}
              />
            </div>
          </Card>

          {/* Pickup (CAC read-only) */}
          <Card
            title="Pickup address"
            subtitle="Pulled from CAC during registration and cannot be edited."
            icon={<MapPin size={18} />}
            right={
              <span className="hidden sm:inline-flex items-center gap-2 text-[11px] rounded-full border bg-white px-3 py-1.5 text-zinc-700">
                <Lock size={14} /> CAC-locked
              </span>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ReadOnlyField label="Address line" value={draft.pickupAddressLine1} icon={<MapPin size={16} />} placeholder="Not available yet" />
              <ReadOnlyField label="City" value={draft.pickupCity} placeholder="Not available yet" />
              <ReadOnlyField label="State" value={draft.pickupState} placeholder="Not available yet" />
            </div>
          </Card>

          {/* Bank / Payouts */}
          <Card
            title="Payout bank details"
            subtitle="Any bank change requires admin verification. Verified details are locked."
            icon={<CreditCard size={18} />}
            right={
              <div className="flex items-center gap-2">
                {bankStatusChip}
                {bankStatus === "VERIFIED" && !bankEditUnlocked && (
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
                {bankEditUnlocked && (
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
                Your bank details are <span className="font-semibold">pending verification</span>. Editing is locked until admin review.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <label className="block text-xs font-semibold text-zinc-700">Bank country</label>
                <select
                  className={`w-full rounded-xl border px-3 py-2.5 shadow-sm outline-none transition ${bankEditable
                    ? "bg-white border-zinc-300/80 focus:border-violet-400 focus:ring-4 focus:ring-violet-200"
                    : "bg-zinc-50 border-zinc-200 text-zinc-600 cursor-not-allowed"
                    }`}
                  value={draft.bankCountry || "NG"}
                  disabled={!bankEditable}
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
                <div className="mt-1 text-[11px] text-zinc-500">{banksQ.isFetching ? "Loading banks…" : ""}</div>
              </div>

              <div className="md:col-span-1">
                <label className="block text-xs font-semibold text-zinc-700">Bank name</label>
                <select
                  className={`w-full rounded-xl border px-3 py-2.5 shadow-sm outline-none transition ${bankEditable
                    ? "bg-white border-zinc-300/80 focus:border-violet-400 focus:ring-4 focus:ring-violet-200"
                    : "bg-zinc-50 border-zinc-200 text-zinc-600 cursor-not-allowed"
                    }`}
                  value={draft.bankName ?? ""}
                  disabled={!bankEditable}
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
                  className={`w-full rounded-xl border px-3 py-2.5 shadow-sm outline-none transition ${bankEditable
                    ? "bg-white border-zinc-300/80 focus:border-violet-400 focus:ring-4 focus:ring-violet-200"
                    : "bg-zinc-50 border-zinc-200 text-zinc-600 cursor-not-allowed"
                    }`}
                  value={normCode(draft.bankCode)}
                  disabled={!bankEditable}
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
                disabled={!bankEditable}
                onChange={(v) => setDraft((d) => ({ ...d, accountNumber: v.replace(/\D/g, "").slice(0, 16) }))}
                placeholder="0123456789"
              />

              <Field
                label="Account name"
                value={draft.accountName}
                disabled={!bankEditable}
                onChange={(v) => setDraft((d) => ({ ...d, accountName: v }))}
                placeholder="e.g. ACME DISTRIBUTION LTD"
              />
            </div>

            <div className="mt-3 text-[11px] text-zinc-500">
              {bankStatus === "VERIFIED" && !bankEditUnlocked
                ? "Your bank details are verified and locked. Use “Request change” to submit an update for admin review."
                : "When you save new bank details, they become pending admin verification and will be locked until reviewed."}
            </div>
          </Card>

          {/* Notifications */}
          <Card title="Notifications" subtitle="Control which alerts you receive. (Not yet wired to backend)" icon={<Bell size={18} />}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Toggle
                label="New orders"
                desc="Get notified when you receive a new order."
                checked={draft.notifyNewOrders}
                onChange={(v) => setDraft((d) => ({ ...d, notifyNewOrders: v }))}
              />
              <Toggle
                label="Low stock"
                desc="Alerts when inventory is running low."
                checked={draft.notifyLowStock}
                onChange={(v) => setDraft((d) => ({ ...d, notifyLowStock: v }))}
              />
              <Toggle
                label="Payout updates"
                desc="Updates when payouts are processed."
                checked={draft.notifyPayouts}
                onChange={(v) => setDraft((d) => ({ ...d, notifyPayouts: v }))}
              />
            </div>
          </Card>

          {/* Documents */}
          <Card title="Verification documents" subtitle="Placeholder UI (not wired)." icon={<FileText size={18} />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ReadOnlyField label="CAC RC number" value={draft.rcNumber} icon={<Hash size={16} />} placeholder="Not available yet" />
              <Field
                label="Owner ID (or file ref)"
                value={draft.docsID}
                onChange={(v) => setDraft((d) => ({ ...d, docsID: v }))}
                placeholder="e.g. NIN / Passport ref"
              />
            </div>
          </Card>

          {/* Security */}
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

          {/* Save footer */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              <Save size={16} />
              {saving ? "Saving…" : "Save changes"}
            </button>

            <div className="text-[11px] text-zinc-500">
              Bank changes require admin verification. Fields lock when status is{" "}
              <span className="font-mono">PENDING</span> or <span className="font-mono">VERIFIED</span>.
            </div>
          </div>
        </div>
      </div >
    </SiteLayout >
  );
}
