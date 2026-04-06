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
  CheckCircle2,
  XCircle,
  FileBadge2,
  IdCard,
  Landmark,
  ArrowRight,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import { useAuthStore } from "../../store/auth";
import { useModal } from "../../components/ModalProvider";
import api from "../../api/client";
import { useNavigate, useSearchParams, useLocation, Link } from "react-router-dom";
import type { AxiosError } from "axios";
import { useSupplierVerificationGate } from "../../hooks/useSupplierVerificationGate";

/**
 * Adjust this import path if your countries config lives elsewhere.
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

type CountryConfig = {
  code: string;
  name: string;
  phoneCode: string;
  allowSupplierRegistration: boolean;
};

type SupplierDocumentKind =
  | "BUSINESS_REGISTRATION_CERTIFICATE"
  | "GOVERNMENT_ID"
  | "PROOF_OF_ADDRESS"
  | "TAX_DOCUMENT"
  | "BANK_PROOF"
  | "OTHER";

type SupplierDocStatus = "PENDING" | "APPROVED" | "REJECTED";

type SupplierDocumentDto = {
  id: string;
  supplierId: string;
  kind: SupplierDocumentKind;
  storageKey: string;
  originalFilename: string;
  mimeType?: string | null;
  size?: number | null;
  status?: SupplierDocStatus | null;
  note?: string | null;
  uploadedAt?: string | null;
  reviewedAt?: string | null;
};

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
};

type SupplierMeDto = {
  id: string;
  name: string;

  rcNumber?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;

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

const norm = (v: unknown) => String(v ?? "").trim();
const normCode = (v: unknown) => norm(v).padStart(3, "0");

const cookieCfg = { withCredentials: true } as const;

function Card({
  title,
  subtitle,
  icon,
  right,
  children,
  anchorId,
  highlight,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  anchorId?: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      id={anchorId}
      className={`scroll-mt-24 rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden transition ${
        highlight ? "ring-2 ring-violet-300" : ""
      } ${className}`}
    >
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
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{icon}</div>}
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
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{icon}</div>}
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
        disabled ? "bg-zinc-50 text-zinc-500 cursor-not-allowed" : "bg-white hover:bg-black/5"
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

function humanFileSize(size?: number | null) {
  if (!size || size <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "—";
  return new Date(value).toLocaleString();
}

function getLatestDoc(docs: SupplierDocumentDto[], kind: SupplierDocumentKind) {
  return docs
    .filter((d) => d.kind === kind)
    .sort(
      (a, b) =>
        new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    )[0];
}

function isRegisteredBusiness(registrationType?: string | null) {
  return String(registrationType ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS";
}

function docLabel(kind: SupplierDocumentKind) {
  switch (kind) {
    case "BUSINESS_REGISTRATION_CERTIFICATE":
      return "Business registration certificate";
    case "GOVERNMENT_ID":
      return "Government ID";
    case "PROOF_OF_ADDRESS":
      return "Proof of address";
    case "TAX_DOCUMENT":
      return "Tax document";
    case "BANK_PROOF":
      return "Bank proof";
    case "OTHER":
      return "Other document";
    default:
      return kind;
  }
}

function docKindIcon(kind: SupplierDocumentKind) {
  switch (kind) {
    case "BUSINESS_REGISTRATION_CERTIFICATE":
      return <FileBadge2 size={16} />;
    case "GOVERNMENT_ID":
      return <IdCard size={16} />;
    case "PROOF_OF_ADDRESS":
      return <Landmark size={16} />;
    default:
      return <FileText size={16} />;
  }
}

function normalizeDocumentsResponse(raw: unknown): SupplierDocumentDto[] {
  const source = raw as
    | {
        data?: {
          data?: SupplierDocumentDto[];
          documents?: SupplierDocumentDto[];
        } | SupplierDocumentDto[];
        documents?: SupplierDocumentDto[];
      }
    | SupplierDocumentDto[]
    | null;

  const candidates: unknown[] = [
    source && typeof source === "object" && "data" in source
      ? (source as { data?: { data?: SupplierDocumentDto[] } }).data?.data
      : undefined,
    source && typeof source === "object" && "data" in source
      ? (source as { data?: { documents?: SupplierDocumentDto[] } }).data?.documents
      : undefined,
    source && typeof source === "object" && "data" in source
      ? (source as { data?: unknown }).data
      : undefined,
    source && typeof source === "object" && "documents" in source
      ? (source as { documents?: SupplierDocumentDto[] }).documents
      : undefined,
    source,
  ];

  for (const item of candidates) {
    if (Array.isArray(item)) return item as SupplierDocumentDto[];
  }

  return [];
}

function docStatusChip(status?: SupplierDocStatus | null) {
  const s = String(status ?? "").toUpperCase();

  if (s === "APPROVED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 border border-emerald-200 text-[11px]">
        <CheckCircle2 size={14} /> Approved
      </span>
    );
  }

  if (s === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 border border-amber-200 text-[11px]">
        <Clock size={14} /> Pending
      </span>
    );
  }

  if (s === "REJECTED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 px-2.5 py-1 border border-rose-200 text-[11px]">
        <XCircle size={14} /> Rejected
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 text-zinc-700 px-2.5 py-1 border border-zinc-200 text-[11px]">
      <FileText size={14} /> Not uploaded
    </span>
  );
}

export default function SupplierSettings() {
  const { openModal } = useModal();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const userFromStore = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;

  const [searchParams, setSearchParams] = useSearchParams();

  const [highlightPayout, setHighlightPayout] = useState(false);
  const [didAutoOpenBankEdit, setDidAutoOpenBankEdit] = useState(false);

  const urlSupplierId = useMemo(() => {
    const v = String(searchParams.get("supplierId") ?? "").trim();
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();
    return v || undefined;
  }, []);

  const roleFromStore = (userFromStore as { role?: string } | null)?.role;
  const [roleOverride, setRoleOverride] = useState<string | null>(null);
  const role = roleOverride ?? roleFromStore ?? "";
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isSupplierUser = role === "SUPPLIER";

  const verificationQ = useSupplierVerificationGate(hydrated && isSupplierUser);

  const verificationGate = verificationQ.data?.gate;
  const docsPendingLock =
    isSupplierUser &&
    !verificationQ.isLoading &&
    !!verificationGate &&
    !!verificationGate.hasPendingRequiredDoc;

  const docsPendingLockReason =
    verificationGate?.lockReason ||
    "A required verification document is currently pending review. Further document-related changes are locked until admin completes the review.";

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
      supportEmail: String(userFromStore?.email || ""),
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

  useEffect(() => {
    const roleFromMe = meQ.data?.role;
    if (roleFromMe && roleFromMe !== roleOverride) {
      setRoleOverride(roleFromMe);
    }
  }, [meQ.data?.role, roleOverride]);

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
      const { data } = await api.get<{ data: SupplierMeDto }>("/api/supplier/me", {
        ...cookieCfg,
        params: { supplierId: adminSupplierId },
      });
      return data.data;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const docsQ = useQuery({
    queryKey: ["supplier", "documents", { supplierId: adminSupplierId }],
    enabled: !isAdmin || !!adminSupplierId,
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/documents", {
        ...cookieCfg,
        params: { supplierId: adminSupplierId },
      });
      return normalizeDocumentsResponse(data);
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
  const countriesQ = useQuery({
    queryKey: ["supplier-registration-countries"],
    queryFn: async () => {
      const { data } = await api.get<{ data: CountryConfig[] }>(
        "/api/supplier-registration-countries",
        cookieCfg
      );

      return Array.isArray(data?.data) ? data.data : [];
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const availableCountries = useMemo<CountryConfig[]>(() => {
    if (Array.isArray(countriesQ.data) && countriesQ.data.length > 0) {
      return countriesQ.data;
    }

    return [
      { code: "NG", name: "Nigeria", phoneCode: "234", allowSupplierRegistration: true },
      { code: "KE", name: "Kenya", phoneCode: "254", allowSupplierRegistration: true },
      { code: "RW", name: "Rwanda", phoneCode: "250", allowSupplierRegistration: true },
      { code: "GH", name: "Ghana", phoneCode: "233", allowSupplierRegistration: true },
      { code: "CM", name: "Cameroon", phoneCode: "237", allowSupplierRegistration: true },
      { code: "BJ", name: "Benin Republic", phoneCode: "229", allowSupplierRegistration: true },
      { code: "TG", name: "Togo", phoneCode: "228", allowSupplierRegistration: true },
      { code: "BF", name: "Burkina Faso", phoneCode: "226", allowSupplierRegistration: true },
      { code: "CD", name: "Congo", phoneCode: "243", allowSupplierRegistration: true },
    ];
  }, [countriesQ.data]);

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
  }, [draft.bankCountry, countryBanks.length]);

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
      const parsed = JSON.parse(raw) as Partial<SupplierSettingsDraft> | null;
      if (parsed && typeof parsed === "object") {
        setDraft((d) => ({
          ...d,
          ...parsed,
          businessName: d.businessName,
          rcNumber: d.rcNumber,
          supportEmail: String(parsed.supportEmail || d.supportEmail || ""),
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
        businessName: String(sup?.name ?? d.businessName ?? ""),
        rcNumber: String(sup?.rcNumber ?? d.rcNumber ?? ""),

        supportEmail: String(sup?.contactEmail ?? me?.email ?? d.supportEmail ?? ""),
        supportPhone: String(sup?.whatsappPhone ?? me?.phone ?? d.supportPhone ?? ""),

        pickupAddressLine1: String(addr?.streetName ?? d.pickupAddressLine1 ?? ""),
        pickupCity: String(addr?.city ?? addr?.town ?? d.pickupCity ?? ""),
        pickupState: String(addr?.state ?? d.pickupState ?? ""),

        bankCountry: String(
          sup?.bankCountry ??
            sup?.registrationCountryCode ??
            d.bankCountry ??
            "NG"
        ),
        bankCode: String(sup?.bankCode ?? d.bankCode ?? ""),
        bankName: String(sup?.bankName ?? d.bankName ?? ""),
        accountNumber: String(sup?.accountNumber ?? d.accountNumber ?? ""),
        accountName: String(sup?.accountName ?? d.accountName ?? ""),
      };
    });

    if ((supplierQ.data?.bankVerificationStatus ?? "UNVERIFIED") === "VERIFIED") {
      setBankEditUnlocked(false);
    }
  }, [supplierQ.data, meQ.data]);

  const bankStatus: BankVerificationStatus = (supplierQ.data?.bankVerificationStatus ??
    "UNVERIFIED") as BankVerificationStatus;

  const bankLockedByStatus = bankStatus === "VERIFIED" || bankStatus === "PENDING";
  const bankEditable = !bankLockedByStatus || bankEditUnlocked;

  useEffect(() => {
    if (!supplierQ.data) return;

    const focus = String(searchParams.get("focus") ?? "").trim();
    const hash = String(location.hash ?? "").trim();

    const shouldFocus =
      (focus === "payout-bank-details" || hash === "#payout-bank-details") &&
      bankStatus !== "VERIFIED";

    if (!shouldFocus) return;

    window.setTimeout(() => {
      const el = document.getElementById("payout-bank-details");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });

      setHighlightPayout(true);
      window.setTimeout(() => setHighlightPayout(false), 2500);

      const canAutoUnlock =
        !isAdmin &&
        !docsPendingLock &&
        !bankEditUnlocked &&
        !didAutoOpenBankEdit;

      if (canAutoUnlock) {
        setDidAutoOpenBankEdit(true);

        openModal({
          title: "Enter your bank details",
          message:
            "To receive payouts, please enter your payout bank details. When you save, the change will be pending admin verification and locked until reviewed.",
        });

        setBankEditUnlocked(true);
      }
    }, 50);
  }, [
    supplierQ.data,
    searchParams,
    location.hash,
    bankStatus,
    isAdmin,
    docsPendingLock,
    bankEditUnlocked,
    didAutoOpenBankEdit,
    openModal,
  ]);

  const saveM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await api.put<{ data: SupplierMeDto }>("/api/supplier/me", payload, {
        ...cookieCfg,
        params: { supplierId: adminSupplierId },
      });
      return data.data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["supplier", "me"] });
      await qc.invalidateQueries({ queryKey: ["supplier", "me", { supplierId: adminSupplierId }] });
      setBankEditUnlocked(false);
      openModal({ title: "Settings saved", message: "Supplier settings have been saved." });
    },
    onError: (e: AxiosError<{ error?: string }>) => {
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

    if (docsPendingLock) {
      openModal({
        title: "Verification in progress",
        message: docsPendingLockReason,
      });
      return;
    }

    const payload: Record<string, unknown> = {
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

  const bankFieldsDisabled = isAdmin || docsPendingLock || !bankEditable;
  const generalFieldsDisabled = isAdmin || docsPendingLock;
  const showAdminNeedSupplier = isAdmin && !adminSupplierId;

  const docs = docsQ.data ?? [];
  const requiredDocKinds = useMemo<SupplierDocumentKind[]>(() => {
    const kinds: SupplierDocumentKind[] = ["GOVERNMENT_ID", "PROOF_OF_ADDRESS"];
    if (isRegisteredBusiness(supplierQ.data?.registrationType)) {
      kinds.unshift("BUSINESS_REGISTRATION_CERTIFICATE");
    }
    return kinds;
  }, [supplierQ.data?.registrationType]);

  const requiredDocRows = useMemo(() => {
    return requiredDocKinds.map((kind) => ({
      kind,
      doc: getLatestDoc(docs, kind),
    }));
  }, [docs, requiredDocKinds]);

  const optionalDocs = useMemo(() => {
    return docs
      .filter((d) => !requiredDocKinds.includes(d.kind))
      .sort(
        (a, b) =>
          new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
      );
  }, [docs, requiredDocKinds]);

  const docPendingKinds = useMemo(() => {
    return requiredDocRows
      .filter(({ doc }) => String(doc?.status ?? "").toUpperCase() === "PENDING")
      .map(({ kind }) => docLabel(kind));
  }, [requiredDocRows]);

  return (
    <SiteLayout>
      <SupplierLayout>
        {!isAdmin && (
          <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-white/90 backdrop-blur">
            <div className="px-4 py-3 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving || docsPendingLock}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
              >
                <Save size={16} />
                {saving ? "Saving…" : docsPendingLock ? "Verification required" : "Save changes"}
              </button>
              <div className="shrink-0">{bankStatusChip}</div>
            </div>
          </div>
        )}

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
                disabled={saving || isAdmin || docsPendingLock}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95 disabled:opacity-60"
              >
                <Save size={16} />
                {isAdmin
                  ? "Admin view (read-only)"
                  : saving
                    ? "Saving…"
                    : docsPendingLock
                      ? "Verification required"
                      : "Save changes"}
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

        {docsPendingLock && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="font-semibold">Document review in progress</div>
                <div className="mt-1 text-amber-800">
                  {docsPendingLockReason}
                </div>

                {docPendingKinds.length > 0 && (
                  <div className="mt-3 text-[12px] text-amber-800">
                    Pending required document{docPendingKinds.length === 1 ? "" : "s"}:{" "}
                    <b>{docPendingKinds.join(" • ")}</b>
                  </div>
                )}

                <div className="mt-3 text-[12px] text-amber-800">
                  While review is pending, document-related changes and further payout/bank modifications are locked.
                </div>
              </div>

              {verificationGate?.nextPath ? (
                <div className="shrink-0">
                  <Link
                    to={verificationGate.nextPath}
                    className="inline-flex items-center justify-center rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-950"
                  >
                    Continue verification
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        )}

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
              <ReadOnlyField label="Business name" value={draft.businessName} icon={<Building2 size={16} />} />
              <ReadOnlyField label="RC number" value={draft.rcNumber} icon={<Hash size={16} />} placeholder="Not available yet" />

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

            {docsPendingLock && (
              <div className="mt-3 text-[11px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Contact-related changes are temporarily locked while required document review is pending.
              </div>
            )}
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
              <ReadOnlyField label="Address line" value={draft.pickupAddressLine1} icon={<MapPin size={16} />} placeholder="Not available yet" />
              <ReadOnlyField label="City" value={draft.pickupCity} placeholder="Not available yet" />
              <ReadOnlyField label="State" value={draft.pickupState} placeholder="Not available yet" />
            </div>
          </Card>

          <Card
            anchorId="payout-bank-details"
            highlight={highlightPayout}
            title="Payout bank details"
            subtitle="Any bank change requires admin verification. Verified details are locked."
            icon={<CreditCard size={18} />}
            right={
              <div className="flex flex-wrap items-center gap-2">
                {bankStatusChip}
                {!isAdmin && bankStatus === "VERIFIED" && !bankEditUnlocked && !docsPendingLock && (
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
                {!isAdmin && bankEditUnlocked && !docsPendingLock && (
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

            {docsPendingLock ? (
              <div className="mb-3 text-[11px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Bank-detail changes are locked because a required verification document is still pending review.
              </div>
            ) : bankStatus === "PENDING" ? (
              <div className="mb-3 text-[11px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Bank details are <span className="font-semibold">pending verification</span>. Editing is locked until admin review.
              </div>
            ) : null}

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
                  {availableCountries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name} ({country.code})
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {countriesQ.isFetching
                    ? "Loading countries…"
                    : banksQ.isFetching
                      ? "Loading banks…"
                      : ""}
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
                onChange={(v) => setDraft((d) => ({ ...d, accountNumber: v.replace(/\D/g, "").slice(0, 16) }))}
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
                : docsPendingLock
                  ? "Bank-related changes are locked until pending required documents are reviewed."
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
                disabled={isAdmin || docsPendingLock}
              />
              <Toggle
                label="Low stock"
                desc="Alerts when inventory is running low."
                checked={draft.notifyLowStock}
                onChange={(v) => setDraft((d) => ({ ...d, notifyLowStock: v }))}
                disabled={isAdmin || docsPendingLock}
              />
              <Toggle
                label="Payout updates"
                desc="Updates when payouts are processed."
                checked={draft.notifyPayouts}
                onChange={(v) => setDraft((d) => ({ ...d, notifyPayouts: v }))}
                disabled={isAdmin || docsPendingLock}
              />
            </div>

            {docsPendingLock && (
              <div className="mt-3 text-[11px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Settings changes are temporarily locked while required document review is pending.
              </div>
            )}
          </Card>

          <Card
            title="Verification documents"
            subtitle="Live document status from supplier documents."
            icon={<FileText size={18} />}
            right={
              <span className="inline-flex items-center gap-2 text-[11px] rounded-full border bg-white px-3 py-1.5 text-zinc-700">
                {docsQ.isFetching ? "Refreshing…" : `${docs.length} file${docs.length === 1 ? "" : "s"}`}
              </span>
            }
          >
            <div className="space-y-4">
              {docsPendingLock && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="font-semibold">Document modification guard active</div>
                  <div className="mt-1 text-amber-800">
                    At least one required document is pending review, so further document-related modifications are paused until review is completed.
                  </div>
                </div>
              )}

              {requiredDocRows.map(({ kind, doc }) => (
                <div key={kind} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                        {docKindIcon(kind)}
                        <span>{docLabel(kind)}</span>
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-zinc-600">
                        <div>
                          <span className="font-medium text-zinc-700">Filename:</span>{" "}
                          {doc?.originalFilename || "Not uploaded"}
                        </div>
                        <div>
                          <span className="font-medium text-zinc-700">Uploaded:</span>{" "}
                          {formatDateTime(doc?.uploadedAt)}
                        </div>
                        <div>
                          <span className="font-medium text-zinc-700">Reviewed:</span>{" "}
                          {formatDateTime(doc?.reviewedAt)}
                        </div>
                        <div>
                          <span className="font-medium text-zinc-700">Size:</span>{" "}
                          {humanFileSize(doc?.size)}
                        </div>
                        {doc?.note ? (
                          <div className="text-rose-700">
                            <span className="font-medium">Admin note:</span> {doc.note}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0">{docStatusChip(doc?.status)}</div>
                  </div>
                </div>
              ))}

              {optionalDocs.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Other uploaded documents
                  </div>

                  {optionalDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="rounded-2xl border border-zinc-200 bg-white px-4 py-3"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                            {docKindIcon(doc.kind)}
                            <span>{docLabel(doc.kind)}</span>
                          </div>

                          <div className="mt-2 space-y-1 text-xs text-zinc-600">
                            <div>
                              <span className="font-medium text-zinc-700">Filename:</span>{" "}
                              {doc.originalFilename || "—"}
                            </div>
                            <div>
                              <span className="font-medium text-zinc-700">Uploaded:</span>{" "}
                              {formatDateTime(doc.uploadedAt)}
                            </div>
                            <div>
                              <span className="font-medium text-zinc-700">Reviewed:</span>{" "}
                              {formatDateTime(doc.reviewedAt)}
                            </div>
                            <div>
                              <span className="font-medium text-zinc-700">Size:</span>{" "}
                              {humanFileSize(doc.size)}
                            </div>
                            {doc.note ? (
                              <div className="text-rose-700">
                                <span className="font-medium">Admin note:</span> {doc.note}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="shrink-0">{docStatusChip(doc.status)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!docsQ.isFetching && docs.length === 0 && (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                  No verification documents found yet.
                </div>
              )}
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

          <div className="hidden sm:flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={saving || isAdmin || docsPendingLock}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              <Save size={16} />
              {isAdmin
                ? "Admin view (read-only)"
                : saving
                  ? "Saving…"
                  : docsPendingLock
                    ? "Verification required"
                    : "Save changes"}
            </button>

            <div className="text-[11px] text-zinc-500">
              {docsPendingLock
                ? "Required document review is pending. Document-related and payout/bank modifications are temporarily locked."
                : "Bank changes require admin verification. Fields lock when status is "}
              {!docsPendingLock && (
                <>
                  <span className="font-mono">PENDING</span> or{" "}
                  <span className="font-mono">VERIFIED</span>.
                </>
              )}
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}