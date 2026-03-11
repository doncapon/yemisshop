// src/pages/supplier/SupplierBusinessDetails.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Wallet,
  BadgeCheck as VerifiedIcon,
  AlertTriangle,
  Clock,
  Lock,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";

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

type SupplierMe = {
  id: string;
  supplierId?: string;
  name?: string | null;
  businessName?: string | null;
  legalName?: string | null;
  registeredBusinessName?: string | null;
  registrationNumber?: string | null;
  registrationType?: string | null;
  registrationDate?: string | null;
  registrationCountryCode?: string | null;
  registryAuthorityId?: string | null;
  natureOfBusiness?: string | null;
  contactEmail?: string | null;
  whatsappPhone?: string | null;

  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  bankVerificationStatus?: BankVerificationStatus | string | null;
  bankVerificationNote?: string | null;
  bankVerificationRequestedAt?: string | null;
  bankVerifiedAt?: string | null;

  registeredAddress?: {
    id?: string;
    houseNumber?: string | null;
    streetName?: string | null;
    town?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;

  pickupAddress?: {
    id?: string;
    houseNumber?: string | null;
    streetName?: string | null;
    town?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;

  status?: string | null;
  kycStatus?: string | null;

  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  contactPhone?: string | null;

  documents?: any[] | null;
  verificationDocuments?: any[] | null;
  identityDocumentUrl?: string | null;
  proofOfAddressUrl?: string | null;
  cacDocumentUrl?: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const EMPTY_FORM = {
  legalName: "",
  registeredBusinessName: "",
  registrationNumber: "",
  registrationType: "",
  registrationDate: "",
  registrationCountryCode: "NG",
  registryAuthorityId: "",
  natureOfBusiness: "",

  bankCountry: "NG",
  bankCode: "",
  bankName: "",
  accountName: "",
  accountNumber: "",
};

function hasAddress(addr: SupplierMe["registeredAddress"] | SupplierMe["pickupAddress"]) {
  if (!addr) return false;
  return Boolean(
    addr.streetName ||
    addr.houseNumber ||
    addr.city ||
    addr.state ||
    addr.country ||
    addr.postCode
  );
}

function hasDocuments(s: SupplierMe | null) {
  if (!s) return false;
  return Boolean(
    (Array.isArray(s.documents) && s.documents.length > 0) ||
    (Array.isArray(s.verificationDocuments) && s.verificationDocuments.length > 0) ||
    s.identityDocumentUrl ||
    s.proofOfAddressUrl ||
    s.cacDocumentUrl
  );
}

const norm = (v: any) => String(v ?? "").trim();
const normCode = (v: any) => norm(v).padStart(3, "0");
const hasValue = (v: any) => String(v ?? "").trim().length > 0;

function pickFirst(...vals: any[]) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function normalizeDateInputValue(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeSupplierPayload(raw: any): SupplierMe {
  const s = raw?.data ?? raw?.supplier ?? raw ?? {};

  return {
    ...s,
    legalName: pickFirst(s.legalName, s.businessName, s.name),
    registeredBusinessName: pickFirst(
      s.registeredBusinessName,
      s.businessName,
      s.legalName,
      s.name
    ),
    registrationNumber: pickFirst(s.registrationNumber),
    registrationType: pickFirst(s.registrationType),
    registrationDate: normalizeDateInputValue(pickFirst(s.registrationDate)),
    registrationCountryCode: pickFirst(s.registrationCountryCode, "NG"),
    registryAuthorityId: pickFirst(s.registryAuthorityId),
    natureOfBusiness: pickFirst(s.natureOfBusiness),

    bankCountry: pickFirst(s.bankCountry, "NG"),
    bankCode: normCode(pickFirst(s.bankCode)),
    bankName: pickFirst(s.bankName),
    accountName: pickFirst(s.accountName),
    accountNumber: pickFirst(s.accountNumber),
  };
}

export default function SupplierBusinessDetails() {
  const nav = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);

  const [supplier, setSupplier] = useState<SupplierMe | null>(null);
  const [countries, setCountries] = useState<any[]>([]);
  const [banks, setBanks] = useState<BankOption[]>(FALLBACK_BANKS);
  const [bankEditUnlocked, setBankEditUnlocked] = useState(false);

  const setField =
    (key: keyof typeof form) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
        setSaveState("idle");
        setErr(null);
      };

  const hydrateFormFromSupplier = useCallback((s: SupplierMe, replace = false) => {
    setForm((prev) => {
      if (replace) {
        return {
          legalName: pickFirst(s.legalName),
          registeredBusinessName: pickFirst(s.registeredBusinessName),
          registrationNumber: pickFirst(s.registrationNumber),
          registrationType: pickFirst(s.registrationType),
          registrationDate: normalizeDateInputValue(pickFirst(s.registrationDate)),
          registrationCountryCode: pickFirst(s.registrationCountryCode, "NG"),
          registryAuthorityId: pickFirst(s.registryAuthorityId),
          natureOfBusiness: pickFirst(s.natureOfBusiness),

          bankCountry: pickFirst(s.bankCountry, "NG"),
          bankCode: normCode(pickFirst(s.bankCode)),
          bankName: pickFirst(s.bankName),
          accountName: pickFirst(s.accountName),
          accountNumber: pickFirst(s.accountNumber),
        };
      }

      return {
        legalName: pickFirst(s.legalName, prev.legalName),
        registeredBusinessName: pickFirst(
          s.registeredBusinessName,
          prev.registeredBusinessName
        ),
        registrationNumber: pickFirst(s.registrationNumber, prev.registrationNumber),
        registrationType: pickFirst(s.registrationType, prev.registrationType),
        registrationDate: pickFirst(
          normalizeDateInputValue(s.registrationDate),
          prev.registrationDate
        ),
        registrationCountryCode: pickFirst(
          s.registrationCountryCode,
          prev.registrationCountryCode,
          "NG"
        ),
        registryAuthorityId: pickFirst(s.registryAuthorityId, prev.registryAuthorityId),
        natureOfBusiness: pickFirst(s.natureOfBusiness, prev.natureOfBusiness),

        bankCountry: pickFirst(s.bankCountry, prev.bankCountry, "NG"),
        bankCode: pickFirst(normCode(s.bankCode), prev.bankCode),
        bankName: pickFirst(s.bankName, prev.bankName),
        accountName: pickFirst(s.accountName, prev.accountName),
        accountNumber: pickFirst(s.accountNumber, prev.accountNumber),
      };
    });
  }, []);

  const savedBusinessFieldsComplete = useMemo(() => {
    return {
      legalName: hasValue(supplier?.legalName),
      registeredBusinessName: hasValue(supplier?.registeredBusinessName),
      registrationNumber: hasValue(supplier?.registrationNumber),
      registrationType: hasValue(supplier?.registrationType),
      registrationDate: hasValue(supplier?.registrationDate),
      registrationCountryCode: hasValue(supplier?.registrationCountryCode),
      natureOfBusiness: hasValue(supplier?.natureOfBusiness),
    };
  }, [supplier]);

  const savedBusinessDone = useMemo(() => {
    return Object.values(savedBusinessFieldsComplete).every(Boolean);
  }, [savedBusinessFieldsComplete]);

  const savedBankFieldsComplete = useMemo(() => {
    return {
      bankCountry: hasValue(supplier?.bankCountry),
      bankCode: hasValue(supplier?.bankCode),
      bankName: hasValue(supplier?.bankName),
      accountName: hasValue(supplier?.accountName),
      accountNumber: hasValue(supplier?.accountNumber),
    };
  }, [supplier]);

  const savedBankDone = useMemo(() => {
    return Object.values(savedBankFieldsComplete).every(Boolean);
  }, [savedBankFieldsComplete]);

  const draftBusinessFieldsComplete = useMemo(() => {
    return {
      legalName: hasValue(form.legalName),
      registeredBusinessName: hasValue(form.registeredBusinessName),
      registrationNumber: hasValue(form.registrationNumber),
      registrationType: hasValue(form.registrationType),
      registrationDate: hasValue(form.registrationDate),
      registrationCountryCode: hasValue(form.registrationCountryCode),
      natureOfBusiness: hasValue(form.natureOfBusiness),
    };
  }, [form]);

  const draftBusinessDone = useMemo(() => {
    return Object.values(draftBusinessFieldsComplete).every(Boolean);
  }, [draftBusinessFieldsComplete]);

  const draftBankFieldsComplete = useMemo(() => {
    return {
      bankCountry: hasValue(form.bankCountry),
      bankCode: hasValue(form.bankCode),
      bankName: hasValue(form.bankName),
      accountName: hasValue(form.accountName),
      accountNumber: hasValue(form.accountNumber),
    };
  }, [form]);

  const draftBankDone = useMemo(() => {
    return Object.values(draftBankFieldsComplete).every(Boolean);
  }, [draftBankFieldsComplete]);

  const missingSavedBusinessFields = useMemo(() => {
    const items: string[] = [];
    if (!savedBusinessFieldsComplete.legalName) items.push("Legal entity name");
    if (!savedBusinessFieldsComplete.registeredBusinessName) {
      items.push("Registered business name");
    }
    if (!savedBusinessFieldsComplete.registrationNumber) items.push("Registration number");
    if (!savedBusinessFieldsComplete.registrationType) items.push("Registration type");
    if (!savedBusinessFieldsComplete.registrationDate) items.push("Registration date");
    if (!savedBusinessFieldsComplete.registrationCountryCode) items.push("Country");
    if (!savedBusinessFieldsComplete.natureOfBusiness) items.push("Nature of business");
    return items;
  }, [savedBusinessFieldsComplete]);

  const missingSavedBankFields = useMemo(() => {
    const items: string[] = [];
    if (!savedBankFieldsComplete.bankCountry) items.push("Bank country");
    if (!savedBankFieldsComplete.bankCode) items.push("Bank code");
    if (!savedBankFieldsComplete.bankName) items.push("Bank name");
    if (!savedBankFieldsComplete.accountName) items.push("Account name");
    if (!savedBankFieldsComplete.accountNumber) items.push("Account number");
    return items;
  }, [savedBankFieldsComplete]);

  const businessDirty = useMemo(() => {
    return (
      norm(form.legalName) !== norm(supplier?.legalName) ||
      norm(form.registeredBusinessName) !== norm(supplier?.registeredBusinessName) ||
      norm(form.registrationNumber) !== norm(supplier?.registrationNumber) ||
      norm(form.registrationType) !== norm(supplier?.registrationType) ||
      norm(normalizeDateInputValue(form.registrationDate)) !==
      norm(normalizeDateInputValue(supplier?.registrationDate)) ||
      norm(form.registrationCountryCode) !== norm(supplier?.registrationCountryCode || "NG") ||
      norm(form.registryAuthorityId) !== norm(supplier?.registryAuthorityId) ||
      norm(form.natureOfBusiness) !== norm(supplier?.natureOfBusiness)
    );
  }, [form, supplier]);

  const bankDirty = useMemo(() => {
    return (
      norm(form.bankCountry) !== norm(supplier?.bankCountry || "NG") ||
      normCode(form.bankCode) !== normCode(supplier?.bankCode) ||
      norm(form.bankName) !== norm(supplier?.bankName) ||
      norm(form.accountName) !== norm(supplier?.accountName) ||
      norm(form.accountNumber) !== norm(supplier?.accountNumber)
    );
  }, [form, supplier]);

  const hasUnsavedChanges = businessDirty || bankDirty;

  const addressDone = useMemo(() => {
    return hasAddress(supplier?.registeredAddress) || hasAddress(supplier?.pickupAddress);
  }, [supplier]);

  const docsDone = useMemo(() => {
    return hasDocuments(supplier);
  }, [supplier]);

  const canProceedToAddress = useMemo(() => {
    return savedBusinessDone && draftBusinessDone && !businessDirty;
  }, [savedBusinessDone, draftBusinessDone, businessDirty]);

  const canProceedToDocuments = useMemo(() => {
    return savedBusinessDone && draftBusinessDone && addressDone && !hasUnsavedChanges;
  }, [savedBusinessDone, draftBusinessDone, addressDone, hasUnsavedChanges]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);

      const { data } = await api.get("/api/supplier/me", {
        withCredentials: true,
      });

      const s = normalizeSupplierPayload(data);
      setSupplier(s);
      hydrateFormFromSupplier(s, false);

      if ((s.bankVerificationStatus ?? "UNVERIFIED") === "VERIFIED") {
        setBankEditUnlocked(false);
      }
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Could not load supplier onboarding."
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateFormFromSupplier]);

  useEffect(() => {
    load();
  }, [load, location.key]);

  useEffect(() => {
    const onFocus = () => load();
    const onPageShow = () => load();

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [load]);

  useEffect(() => {
    api
      .get("/api/public/supplier-registration-countries")
      .then((res) => {
        setCountries(res.data?.data || []);
      })
      .catch(() => setCountries([]));
  }, []);

  useEffect(() => {
    api
      .get("/api/banks", { withCredentials: true })
      .then((res) => {
        const items =
          Array.isArray(res.data?.data) && res.data.data.length > 0
            ? res.data.data
            : FALLBACK_BANKS;
        setBanks(items);
      })
      .catch(() => setBanks(FALLBACK_BANKS));
  }, []);

  const bankStatus = (supplier?.bankVerificationStatus ?? "UNVERIFIED") as BankVerificationStatus;
  const bankLockedByStatus = bankStatus === "VERIFIED" || bankStatus === "PENDING";
  const bankEditable = !bankLockedByStatus || bankEditUnlocked;
  const bankFieldsDisabled = !bankEditable || loading || saveState === "saving";

  const countryBanks = useMemo(() => {
    const country = form.bankCountry || "NG";
    return banks.filter((b) => b.country === country);
  }, [banks, form.bankCountry]);

  useEffect(() => {
    if (!countryBanks.length) return;

    setForm((f) => {
      const currentCode = normCode(f.bankCode);
      const currentName = norm(f.bankName);

      if (currentCode) {
        const byCode = countryBanks.find((b) => normCode(b.code) === currentCode);
        if (byCode) {
          const nextCode = normCode(byCode.code);
          const nextName = byCode.name;
          if (f.bankCode !== nextCode || f.bankName !== nextName) {
            return { ...f, bankCode: nextCode, bankName: nextName };
          }
          return f;
        }
      }

      if (currentName) {
        const byName = countryBanks.find(
          (b) => norm(b.name).toLowerCase() === currentName.toLowerCase()
        );
        if (byName) {
          const nextCode = normCode(byName.code);
          const nextName = byName.name;
          if (f.bankCode !== nextCode || f.bankName !== nextName) {
            return { ...f, bankCode: nextCode, bankName: nextName };
          }
          return f;
        }
      }

      return f;
    });
  }, [countryBanks]);

  function setBankByName(name: string) {
    const match = countryBanks.find((b) => b.name === name);
    setForm((f) => ({
      ...f,
      bankName: name || "",
      bankCode: match ? normCode(match.code) : "",
    }));
    setSaveState("idle");
    setErr(null);
  }

  function setBankByCode(code: string) {
    const c = normCode(code);
    const match = countryBanks.find((b) => normCode(b.code) === c);
    setForm((f) => ({
      ...f,
      bankCode: c,
      bankName: match?.name || f.bankName || "",
    }));
    setSaveState("idle");
    setErr(null);
  }

  const save = async () => {
    try {
      setSaveState("saving");
      setErr(null);

      const payload: any = {
        legalName: form.legalName.trim() || null,
        registeredBusinessName: form.registeredBusinessName.trim() || null,
        registrationNumber: form.registrationNumber.trim() || null,
        registrationType: form.registrationType.trim() || null,
        registrationDate: form.registrationDate.trim() || null,
        registrationCountryCode: form.registrationCountryCode.trim() || null,
        registryAuthorityId: form.registryAuthorityId.trim() || null,
        natureOfBusiness: form.natureOfBusiness.trim() || null,
      };

      if (bankEditable) {
        payload.bankCountry = form.bankCountry.trim() || null;
        payload.bankCode = normCode(form.bankCode) || null;
        payload.bankName = form.bankName.trim() || null;
        payload.accountName = form.accountName.trim() || null;
        payload.accountNumber = form.accountNumber.replace(/\D/g, "").trim() || null;
      }

      const { data } = await api.put("/api/supplier/me", payload, {
        withCredentials: true,
      });

      const s = normalizeSupplierPayload(data);
      setSupplier(s);
      hydrateFormFromSupplier(s, true);
      setSaveState("saved");
      setBankEditUnlocked(false);
    } catch (e: any) {
      setSaveState("error");
      setErr(
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Could not save onboarding details."
      );
    }
  };

  const goToAddressStep = () => {
    if (!draftBusinessDone) {
      setErr("Please complete all required business details before continuing.");
      return;
    }

    if (businessDirty) {
      setErr("You have unsaved business details. Please save progress before continuing.");
      return;
    }

    if (!savedBusinessDone) {
      setErr("Please save your completed business details before continuing to Address.");
      return;
    }

    nav("/supplier/onboarding/address");
  };

  const goToDocumentsStep = () => {
    if (!draftBusinessDone) {
      setErr("Please complete all required business details before continuing.");
      return;
    }

    if (hasUnsavedChanges) {
      setErr("You have unsaved changes. Please save progress before continuing.");
      return;
    }

    if (!savedBusinessDone) {
      setErr("Please save your completed business details before continuing to Documents.");
      return;
    }

    if (!addressDone) {
      setErr("Please complete Address details before continuing to Documents.");
      return;
    }

    nav("/supplier/onboarding/documents");
  };

  const goToDashboard = () => {
    nav("/supplier");
  };

  const stepBase =
    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm transition";
  const stepDone = "border-emerald-200 bg-emerald-50 text-emerald-700";
  const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
  const stepLocked = "border-zinc-100 bg-zinc-50 text-zinc-400";

  const input =
    "w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] md:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";
  const label = "mb-1.5 block text-sm font-semibold text-slate-800";
  const card =
    "rounded-[28px] border border-white/70 bg-white/95 p-4 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 md:p-8";
  const panel = "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";
  const primaryBtn =
    "inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60";
  const secondaryBtn =
    "inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50";

  const bankStatusChip = (() => {
    if (bankStatus === "VERIFIED") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
          <VerifiedIcon size={14} /> Verified
        </span>
      );
    }
    if (bankStatus === "PENDING") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
          <Clock size={14} /> Pending verification
        </span>
      );
    }
    if (bankStatus === "REJECTED") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] text-rose-700">
          <AlertTriangle size={14} /> Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700">
        <Lock size={14} /> Unverified
      </span>
    );
  })();

  const progress = useMemo(() => {
    const contactDone = true;

    const items = [
      { key: "contact", label: "Contact verified", done: contactDone },
      { key: "business", label: "Business details", done: savedBusinessDone },
      { key: "bank", label: "Bank details", done: savedBankDone },
      { key: "address", label: "Address details", done: addressDone },
      { key: "docs", label: "Documents uploaded", done: docsDone },
    ];

    const doneCount = items.filter((x) => x.done).length;
    const pct = Math.round((doneCount / items.length) * 100);

    return {
      items,
      doneCount,
      total: items.length,
      pct,
      businessDone: savedBusinessDone,
      bankDone: savedBankDone,
      addressDone,
      docsDone,
    };
  }, [savedBusinessDone, savedBankDone, addressDone, docsDone]);

  const canAccessFullDashboard = useMemo(() => {
    return progress.businessDone && progress.addressDone && progress.bankDone && progress.docsDone;
  }, [progress]);

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
        <div className="px-3 py-6 sm:px-4 sm:py-10">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <div className="space-y-4">
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">
                  Complete your supplier onboarding
                </h1>
                <p className="mt-2 text-sm text-zinc-600">
                  Your email and phone are verified. Finish your supplier profile to unlock full
                  access.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <div className={`${stepBase} ${stepDone}`}>
                  <CheckCircle2 size={16} />
                  <span>Register</span>
                </div>

                <div className={`${stepBase} ${stepDone}`}>
                  <BadgeCheck size={16} />
                  <span>Verify email / phone</span>
                </div>

                <div className={`${stepBase} ${stepActive}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    3
                  </span>
                  <span>Business details</span>
                </div>

                <div className={`${stepBase} ${progress.addressDone ? stepDone : stepLocked}`}>
                  <MapPin size={16} />
                  <span>Address details</span>
                </div>

                <div className={`${stepBase} ${progress.docsDone ? stepDone : stepLocked}`}>
                  <ShieldCheck size={16} />
                  <span>Documents</span>
                </div>

                <div className={`${stepBase} ${canAccessFullDashboard ? stepDone : stepLocked}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    6
                  </span>
                  <span>Dashboard access</span>
                </div>
              </div>
            </div>



            {hasUnsavedChanges && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                You have unsaved changes. Save progress before continuing to the next step.
              </div>
            )}

            {draftBusinessDone && !savedBusinessDone && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Business details look complete, but they are not saved yet.
              </div>
            )}

            {draftBankDone && !savedBankDone && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Bank details look complete, but they are not saved yet.
              </div>
            )}

            {!savedBusinessDone && missingSavedBusinessFields.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Complete and save all required business details before continuing:{" "}
                {missingSavedBusinessFields.join(", ")}.
              </div>
            )}

            {!savedBankDone && missingSavedBankFields.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Bank details still missing or not saved: {missingSavedBankFields.join(", ")}.
              </div>
            )}
            {err && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {err}
              </div>
            )}

            <div className={`${card} space-y-5`}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                  <div className={panel}>
                    <div className="mb-4 flex items-center gap-3">
                      <div className="rounded-xl bg-zinc-100 p-3">
                        <Building2 className="h-5 w-5 text-zinc-700" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-zinc-900">Business details</h2>
                        <p className="text-sm text-zinc-600">
                          Complete your supplier identity and registration profile.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className={label}>Legal entity name</label>
                        <input
                          value={form.legalName}
                          onChange={setField("legalName")}
                          className={input}
                          placeholder="Legal business name"
                        />
                      </div>

                      <div>
                        <label className={label}>Registered business name</label>
                        <input
                          value={form.registeredBusinessName}
                          onChange={setField("registeredBusinessName")}
                          className={input}
                          placeholder="Registered business name"
                        />
                      </div>

                      <div>
                        <label className={label}>Registration number</label>
                        <input
                          value={form.registrationNumber}
                          onChange={setField("registrationNumber")}
                          className={input}
                          placeholder="Registration number"
                        />
                      </div>

                      <div>
                        <label className={label}>Registration type</label>
                        <select
                          value={form.registrationType}
                          onChange={setField("registrationType")}
                          className={input}
                        >
                          <option value="">Select registration type</option>
                          <option value="INDIVIDUAL">Individual</option>
                          <option value="REGISTERED_BUSINESS">Registered business</option>
                        </select>
                      </div>

                      <div>
                        <label className={label}>Registration date</label>
                        <input
                          type="date"
                          value={form.registrationDate}
                          onChange={setField("registrationDate")}
                          className={input}
                        />
                      </div>

                      <div>
                        <label className={label}>Country</label>
                        <select
                          value={form.registrationCountryCode}
                          onChange={setField("registrationCountryCode")}
                          className={input}
                        >
                          {countries.length === 0 && <option>Loading countries...</option>}
                          {countries.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className={label}>Nature of business</label>
                        <textarea
                          value={form.natureOfBusiness}
                          onChange={setField("natureOfBusiness")}
                          className={`${input} min-h-[110px] resize-y`}
                          placeholder="Describe the products or services your business provides"
                        />
                      </div>
                    </div>
                  </div>

                  <div className={panel}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-zinc-100 p-3">
                          <Wallet className="h-5 w-5 text-zinc-700" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold text-zinc-900">Bank details</h2>
                          <p className="text-sm text-zinc-600">
                            Add payout details to prepare your supplier account.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {bankStatusChip}
                        {bankStatus === "VERIFIED" && !bankEditUnlocked && (
                          <button
                            type="button"
                            onClick={() => setBankEditUnlocked(true)}
                            className="rounded-full border bg-white px-3 py-1.5 text-[11px] hover:bg-black/5"
                          >
                            Request change
                          </button>
                        )}
                        {bankEditUnlocked && (
                          <button
                            type="button"
                            onClick={() => setBankEditUnlocked(false)}
                            className="rounded-full border bg-white px-3 py-1.5 text-[11px] hover:bg-black/5"
                          >
                            Cancel change
                          </button>
                        )}
                      </div>
                    </div>

                    {supplier?.bankVerificationNote && (
                      <div className="mb-3 rounded-xl border bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                        <span className="font-semibold">Admin note:</span>{" "}
                        {supplier.bankVerificationNote}
                      </div>
                    )}

                    {bankStatus === "PENDING" && (
                      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        Bank details are <span className="font-semibold">pending verification</span>.
                        Editing is locked until review is complete.
                      </div>
                    )}

                    {bankStatus === "VERIFIED" && !bankEditUnlocked && (
                      <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                        Your bank details are verified and locked. Use{" "}
                        <span className="font-semibold">Request change</span> to update them.
                      </div>
                    )}

                    {bankEditUnlocked && bankStatus !== "PENDING" && (
                      <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                        When you save new bank details, they will be submitted for verification.
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div>
                        <label className={label}>Bank country</label>
                        <select
                          value={form.bankCountry}
                          onChange={(e) => {
                            setForm((f) => ({
                              ...f,
                              bankCountry: e.target.value || "NG",
                              bankCode: "",
                              bankName: "",
                            }));
                            setSaveState("idle");
                            setErr(null);
                          }}
                          disabled={bankFieldsDisabled}
                          className={`${input} ${bankFieldsDisabled
                              ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0"
                              : ""
                            }`}
                        >
                          {countries.length === 0 && <option>Loading countries...</option>}
                          {countries.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className={label}>Bank name</label>
                        <select
                          value={form.bankName}
                          onChange={(e) => setBankByName(e.target.value)}
                          disabled={bankFieldsDisabled}
                          className={`${input} ${bankFieldsDisabled
                              ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0"
                              : ""
                            }`}
                        >
                          <option value="">Select bank…</option>
                          {countryBanks.map((b) => (
                            <option key={`${b.country}-${b.code}`} value={b.name}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className={label}>Bank code</label>
                        <select
                          value={normCode(form.bankCode)}
                          onChange={(e) => setBankByCode(e.target.value)}
                          disabled={bankFieldsDisabled}
                          className={`${input} ${bankFieldsDisabled
                              ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0"
                              : ""
                            }`}
                        >
                          <option value="">Select bank…</option>
                          {countryBanks.map((b) => (
                            <option key={`${b.country}-${b.code}`} value={normCode(b.code)}>
                              {normCode(b.code)} — {b.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className={label}>Account name</label>
                        <input
                          value={form.accountName}
                          onChange={setField("accountName")}
                          disabled={bankFieldsDisabled}
                          className={`${input} ${bankFieldsDisabled
                              ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0"
                              : ""
                            }`}
                          placeholder="Account name"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className={label}>Account number</label>
                        <input
                          value={form.accountNumber}
                          onChange={(e) => {
                            setForm((f) => ({
                              ...f,
                              accountNumber: e.target.value.replace(/\D/g, "").slice(0, 16),
                            }));
                            setSaveState("idle");
                            setErr(null);
                          }}
                          disabled={bankFieldsDisabled}
                          className={`${input} ${bankFieldsDisabled
                              ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0"
                              : ""
                            }`}
                          placeholder="Account number"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className={panel}>
                    <h2 className="text-base font-semibold text-zinc-900">Onboarding progress</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      Complete the remaining steps to unlock full supplier access.
                    </p>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full rounded-full bg-zinc-900 transition-all"
                        style={{ width: `${progress.pct}%` }}
                      />
                    </div>

                    <p className="mt-2 text-sm text-zinc-700">
                      {progress.doneCount} of {progress.total} completed
                    </p>

                    <div className="mt-4 space-y-2">
                      {progress.items.map((item) => (
                        <div
                          key={item.key}
                          className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2"
                        >
                          <span className="text-sm text-zinc-700">{item.label}</span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.done
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                              }`}
                          >
                            {item.done ? "Done" : "Pending"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={panel}>
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-zinc-100 p-3">
                        <MapPin className="h-5 w-5 text-zinc-700" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">Address step</h3>
                        <p className="mt-1 text-sm text-zinc-600">
                          Add your registered or pickup address next.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={goToAddressStep}
                      disabled={!canProceedToAddress}
                      className={`${secondaryBtn} mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      Continue to address
                    </button>
                  </div>

                  <div className={panel}>
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-zinc-100 p-3">
                        <ShieldCheck className="h-5 w-5 text-zinc-700" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">Document step</h3>
                        <p className="mt-1 text-sm text-zinc-600">
                          Upload required documents to complete verification.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={goToDocumentsStep}
                      disabled={!canProceedToDocuments}
                      className={`${secondaryBtn} mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      Continue to documents
                    </button>
                  </div>

                  <div className={panel}>
                    <h3 className="text-sm font-semibold text-zinc-900">Full dashboard access</h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      Dashboard becomes fully available once minimum onboarding requirements are
                      complete.
                    </p>

                    <button
                      type="button"
                      onClick={goToDashboard}
                      disabled={!canAccessFullDashboard}
                      className={`${primaryBtn} mt-4 w-full`}
                    >
                      Go to dashboard
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => nav("/supplier/verify-contact")}
                  className={secondaryBtn}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </button>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={save}
                    disabled={loading || saveState === "saving"}
                    className={secondaryBtn}
                  >
                    {saveState === "saving"
                      ? "Saving…"
                      : saveState === "saved"
                        ? "Saved"
                        : "Save progress"}
                  </button>

                  <button
                    type="button"
                    onClick={goToAddressStep}
                    disabled={!canProceedToAddress}
                    className={primaryBtn}
                  >
                    Next step
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {loading && (
              <div className="text-center text-sm text-zinc-500">Loading onboarding…</div>
            )}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}