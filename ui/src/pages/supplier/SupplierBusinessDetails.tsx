// src/pages/supplier/SupplierBusinessDetails.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
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

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

type BankVerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

type SupplierDocument = {
  id?: string;
  kind?: string | null;
  status?: string | null;
  storageKey?: string | null;
  originalFilename?: string | null;
};

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

function hasAddress(
  addr: SupplierMe["registeredAddress"] | SupplierMe["pickupAddress"]
) {
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

function hasInlineDocuments(s: SupplierMe | null) {
  if (!s) return false;
  return Boolean(
    (Array.isArray(s.documents) && s.documents.length > 0) ||
      (Array.isArray(s.verificationDocuments) && s.verificationDocuments.length > 0) ||
      s.identityDocumentUrl ||
      s.proofOfAddressUrl ||
      s.cacDocumentUrl
  );
}

function normalizeDocumentsPayload(raw: any): SupplierDocument[] {
  const candidates = [
    raw?.data?.data,
    raw?.data?.documents,
    raw?.data,
    raw?.documents,
    raw,
  ];

  for (const item of candidates) {
    if (Array.isArray(item)) return item as SupplierDocument[];
  }

  return [];
}

function hasFetchedDocuments(docs: SupplierDocument[]) {
  return Array.isArray(docs) && docs.length > 0;
}

const norm = (v: any) => String(v ?? "").trim();
const normCode = (v: any) => String(v ?? "").trim().padStart(3, "0");
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

function extractSupplierRecord(raw: any): any {
  return (
    raw?.data?.data?.supplier ||
    raw?.data?.data ||
    raw?.data?.supplier ||
    raw?.supplier ||
    raw?.data ||
    raw ||
    {}
  );
}

function normalizeSupplierPayload(raw: any): SupplierMe {
  const s = extractSupplierRecord(raw);

  return {
    ...s,
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

    registeredAddress: s.registeredAddress ?? null,
    pickupAddress: s.pickupAddress ?? null,
    documents: Array.isArray(s.documents) ? s.documents : null,
    verificationDocuments: Array.isArray(s.verificationDocuments)
      ? s.verificationDocuments
      : null,
    identityDocumentUrl: s.identityDocumentUrl ?? null,
    proofOfAddressUrl: s.proofOfAddressUrl ?? null,
    cacDocumentUrl: s.cacDocumentUrl ?? null,
  };
}

function isRegisteredBusinessType(v: string | null | undefined) {
  return String(v ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS";
}

function isPlaceholderBankText(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  return (
    !v ||
    v === "0" ||
    v === "00" ||
    v === "000" ||
    v === "select bank" ||
    v === "select bank..." ||
    v === "account name" ||
    v === "account number" ||
    v === "null" ||
    v === "undefined" ||
    v === "n/a" ||
    v === "na" ||
    v === "-"
  );
}

function isZeroOnly(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return !!digits && /^0+$/.test(digits);
}

function hasMeaningfulBankDetails(
  source:
    | {
        bankCountry?: string | null;
        bankCode?: string | null;
        bankName?: string | null;
        accountName?: string | null;
        accountNumber?: string | null;
      }
    | null
    | undefined
) {
  if (!source) return false;

  const bankCountry = String(source.bankCountry ?? "").trim().toUpperCase();
  const bankCode = String(source.bankCode ?? "").trim();
  const bankName = String(source.bankName ?? "").trim();
  const accountName = String(source.accountName ?? "").trim();
  const accountNumber = String(source.accountNumber ?? "").trim();

  const meaningfulBankCode = !isPlaceholderBankText(bankCode) && !isZeroOnly(bankCode);
  const meaningfulBankName = !isPlaceholderBankText(bankName);
  const meaningfulAccountName = !isPlaceholderBankText(accountName);
  const meaningfulAccountNumber =
    !isPlaceholderBankText(accountNumber) && !isZeroOnly(accountNumber);

  const hasCoreBankFields =
    meaningfulBankCode ||
    meaningfulBankName ||
    meaningfulAccountName ||
    meaningfulAccountNumber;

  const onlyDefaultCountry =
    !bankCountry || bankCountry === "NG" || bankCountry === "NIGERIA";

  if (!hasCoreBankFields && onlyDefaultCountry) return false;
  return hasCoreBankFields;
}

function getEffectiveBankStatus(
  rawStatus: string | null | undefined,
  source:
    | {
        bankCountry?: string | null;
        bankCode?: string | null;
        bankName?: string | null;
        accountName?: string | null;
        accountNumber?: string | null;
      }
    | null
    | undefined
): BankVerificationStatus {
  const status = String(rawStatus ?? "").trim().toUpperCase();

  if (status === "VERIFIED") return "VERIFIED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "PENDING") {
    return hasMeaningfulBankDetails(source) ? "PENDING" : "UNVERIFIED";
  }
  return "UNVERIFIED";
}

export default function SupplierBusinessDetails() {
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const locationState = (location.state as any) ?? {};

  const [loading, setLoading] = useState(true);
  const [businessSaveState, setBusinessSaveState] = useState<SaveState>("idle");
  const [bankSaveState, setBankSaveState] = useState<SaveState>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [bankFormError, setBankFormError] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);

  const [supplier, setSupplier] = useState<SupplierMe | null>(null);
  const [supplierDocuments, setSupplierDocuments] = useState<SupplierDocument[]>([]);
  const [countries, setCountries] = useState<any[]>([]);
  const [banks, setBanks] = useState<BankOption[]>(FALLBACK_BANKS);
  const [bankEditUnlocked, setBankEditUnlocked] = useState(false);
  const [businessStepSaved, setBusinessStepSaved] = useState(false);
  const [documentsLockedOnLoad, setDocumentsLockedOnLoad] = useState(false);

  const cameFromVerifyContact = Boolean(locationState?.fromVerifyContact);

  const hasHydratedRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);

  const isBusinessAutosaving = businessSaveState === "saving";
  const isBankSaving = bankSaveState === "saving";

  const isAdminReviewMode = useMemo(() => {
    return Boolean(
      locationState?.adminReview ||
        locationState?.allowReview ||
        location.pathname.startsWith("/admin/")
    );
  }, [location.pathname, locationState]);

  const adminSupplierId = useMemo(() => {
    if (!isAdminReviewMode) return "";

    const fromQuery = searchParams.get("supplierId");
    const fromStateSupplierId = locationState?.supplierId;
    const fromStateAdminSupplierId = locationState?.adminSupplierId;

    let fromStorage = "";
    try {
      fromStorage = localStorage.getItem(ADMIN_SUPPLIER_KEY) || "";
    } catch {}

    return pickFirst(
      fromQuery,
      fromStateSupplierId,
      fromStateAdminSupplierId,
      fromStorage
    );
  }, [isAdminReviewMode, locationState, searchParams]);

  useEffect(() => {
    try {
      if (isAdminReviewMode && adminSupplierId) {
        localStorage.setItem(ADMIN_SUPPLIER_KEY, adminSupplierId);
      } else {
        localStorage.removeItem(ADMIN_SUPPLIER_KEY);
      }
    } catch {}
  }, [adminSupplierId, isAdminReviewMode]);

  const buildStepUrl = useCallback(
    (path: string) => {
      if (!isAdminReviewMode || !adminSupplierId) return path;
      const qs = new URLSearchParams();
      qs.set("supplierId", adminSupplierId);
      return `${path}?${qs.toString()}`;
    },
    [adminSupplierId, isAdminReviewMode]
  );

  const makeStepState = useCallback(
    (targetPath: string, extraState?: Record<string, any>) => ({
      adminReview: isAdminReviewMode,
      allowReview: isAdminReviewMode,
      supplierId: isAdminReviewMode ? adminSupplierId || "" : "",
      adminSupplierId: isAdminReviewMode ? adminSupplierId || "" : "",
      fromOnboardingTab: true,
      skipAutoFinalize: true,
      returnTo: targetPath,
      nextAfterVerify: targetPath,
      fromVerifyContact: false,
      fromBusinessDetails: targetPath.includes("/business-details"),
      ...extraState,
    }),
    [adminSupplierId, isAdminReviewMode]
  );

  const pushOnboardingStep = useCallback(
    (path: string, extraState?: Record<string, any>) => {
      const targetPath = buildStepUrl(path);
      nav(targetPath, {
        state: makeStepState(targetPath, extraState),
      });
    },
    [buildStepUrl, makeStepState, nav]
  );

  const persistVerifyContactJourney = useCallback(
    (patch: {
      contactVerified?: boolean;
      reachedBusiness?: boolean;
      reachedAddress?: boolean;
      reachedDocuments?: boolean;
      reachedDashboard?: boolean;
    }) => {
      if (!isAdminReviewMode || !adminSupplierId) return;

      try {
        const key = `supplier:verify-contact:journey:${adminSupplierId}`;
        const raw = sessionStorage.getItem(key);
        const current = raw && raw.trim() ? JSON.parse(raw) : {};
        sessionStorage.setItem(
          key,
          JSON.stringify({
            ...current,
            ...patch,
          })
        );
      } catch {}
    },
    [adminSupplierId, isAdminReviewMode]
  );

  const isRegisteredBusiness = useMemo(
    () => isRegisteredBusinessType(form.registrationType),
    [form.registrationType]
  );

  const legalNameRef = useRef<HTMLInputElement | null>(null);
  const registeredBusinessNameRef = useRef<HTMLInputElement | null>(null);
  const registrationNumberRef = useRef<HTMLInputElement | null>(null);
  const registrationTypeRef = useRef<HTMLSelectElement | null>(null);
  const registrationDateRef = useRef<HTMLInputElement | null>(null);
  const registrationCountryCodeRef = useRef<HTMLSelectElement | null>(null);
  const natureOfBusinessRef = useRef<HTMLTextAreaElement | null>(null);

  const bankCountryRef = useRef<HTMLSelectElement | null>(null);
  const bankNameRef = useRef<HTMLSelectElement | null>(null);
  const bankCodeRef = useRef<HTMLSelectElement | null>(null);
  const accountNameRef = useRef<HTMLInputElement | null>(null);
  const accountNumberRef = useRef<HTMLInputElement | null>(null);

  const fieldRefs = {
    legalName: legalNameRef,
    registeredBusinessName: registeredBusinessNameRef,
    registrationNumber: registrationNumberRef,
    registrationType: registrationTypeRef,
    registrationDate: registrationDateRef,
    registrationCountryCode: registrationCountryCodeRef,
    natureOfBusiness: natureOfBusinessRef,
    bankCountry: bankCountryRef,
    bankName: bankNameRef,
    bankCode: bankCodeRef,
    accountName: accountNameRef,
    accountNumber: accountNumberRef,
  };

  const businessFieldMap: Record<string, keyof typeof fieldRefs> = {
    "Legal entity name": "legalName",
    "Registered business name": "registeredBusinessName",
    "Registration number": "registrationNumber",
    "Registration type": "registrationType",
    "Registration date": "registrationDate",
    Country: "registrationCountryCode",
    "Nature of business": "natureOfBusiness",
  };

  const bankFieldMap: Record<string, keyof typeof fieldRefs> = {
    "Bank country": "bankCountry",
    "Bank name": "bankName",
    "Bank code": "bankCode",
    "Account name": "accountName",
    "Account number": "accountNumber",
  };

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToField = useCallback(
    (field: keyof typeof fieldRefs) => {
      const el = fieldRefs[field]?.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => {
          try {
            el.focus();
          } catch {}
        }, 180);
      } else {
        scrollToTop();
      }
    },
    [scrollToTop]
  );

  const getMissingDraftBusinessFields = useCallback(() => {
    const items: string[] = [];
    if (!hasValue(form.legalName)) items.push("Legal entity name");
    if (isRegisteredBusiness && !hasValue(form.registeredBusinessName)) {
      items.push("Registered business name");
    }
    if (!hasValue(form.registrationNumber)) items.push("Registration number");
    if (!hasValue(form.registrationType)) items.push("Registration type");
    if (!hasValue(form.registrationDate)) items.push("Registration date");
    if (!hasValue(form.registrationCountryCode)) items.push("Country");
    if (!hasValue(form.natureOfBusiness)) items.push("Nature of business");
    return items;
  }, [form, isRegisteredBusiness]);

  const getMissingDraftBankFields = useCallback(() => {
    const items: string[] = [];
    if (!hasValue(form.bankCountry)) items.push("Bank country");
    if (!hasValue(form.bankCode)) items.push("Bank code");
    if (!hasValue(form.bankName)) items.push("Bank name");
    if (!hasValue(form.accountName)) items.push("Account name");
    if (!hasValue(form.accountNumber)) items.push("Account number");
    return items;
  }, [form]);

  const showBusinessValidationError = useCallback(
    (missingBusiness: string[]) => {
      setErr(
        `Please complete all required business details first: ${missingBusiness.join(", ")}.`
      );
      const firstField = businessFieldMap[missingBusiness[0]];
      if (firstField) scrollToField(firstField);
      else scrollToTop();
    },
    [businessFieldMap, scrollToField, scrollToTop]
  );

  const showBankValidationError = useCallback(
    (
      missingBank: string[],
      prefix = "Please complete all required bank details first"
    ) => {
      const message = `${prefix}: ${missingBank.join(", ")}.`;
      setErr(message);
      setBankFormError(message);
      const firstField = bankFieldMap[missingBank[0]];
      if (firstField) scrollToField(firstField);
      else scrollToTop();
    },
    [bankFieldMap, scrollToField, scrollToTop]
  );

  const documentsLocked = documentsLockedOnLoad;

  const setField =
    (key: keyof typeof form) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) => {
      if (documentsLocked) return;

      const value = e.target.value;

      setForm((f) => {
        const next = { ...f, [key]: value };

        if (
          key === "registrationType" &&
          String(value).trim().toUpperCase() === "INDIVIDUAL"
        ) {
          next.registeredBusinessName = "";
        }

        return next;
      });

      if (
        key === "legalName" ||
        key === "registeredBusinessName" ||
        key === "registrationNumber" ||
        key === "registrationType" ||
        key === "registrationDate" ||
        key === "registrationCountryCode" ||
        key === "registryAuthorityId" ||
        key === "natureOfBusiness"
      ) {
        if (businessSaveState !== "saving") setBusinessSaveState("idle");
      } else {
        if (bankSaveState !== "saving") setBankSaveState("idle");
        if (bankFormError) setBankFormError(null);
      }

      if (err) setErr(null);
    };

  const hydrateFormFromSupplier = useCallback((s: SupplierMe, replace = false) => {
    setForm((prev) => {
      const nextRegistrationType = pickFirst(
        s.registrationType,
        replace ? "" : prev.registrationType
      );
      const nextIsRegisteredBusiness =
        isRegisteredBusinessType(nextRegistrationType);

      if (replace) {
        return {
          legalName: pickFirst(s.legalName),
          registeredBusinessName: nextIsRegisteredBusiness
            ? pickFirst(s.registeredBusinessName)
            : "",
          registrationNumber: pickFirst(s.registrationNumber),
          registrationType: nextRegistrationType,
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
        registeredBusinessName: nextIsRegisteredBusiness
          ? pickFirst(s.registeredBusinessName, prev.registeredBusinessName)
          : "",
        registrationNumber: pickFirst(s.registrationNumber, prev.registrationNumber),
        registrationType: nextRegistrationType,
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
    const registeredBusinessRequired = isRegisteredBusinessType(
      supplier?.registrationType
    );
    return {
      legalName: hasValue(supplier?.legalName),
      registeredBusinessName: registeredBusinessRequired
        ? hasValue(supplier?.registeredBusinessName)
        : true,
      registrationNumber: hasValue(supplier?.registrationNumber),
      registrationType: hasValue(supplier?.registrationType),
      registrationDate: hasValue(supplier?.registrationDate),
      registrationCountryCode: hasValue(supplier?.registrationCountryCode),
      natureOfBusiness: hasValue(supplier?.natureOfBusiness),
    };
  }, [supplier]);

  const savedBusinessDone = useMemo(() => {
    return businessStepSaved && Object.values(savedBusinessFieldsComplete).every(Boolean);
  }, [businessStepSaved, savedBusinessFieldsComplete]);

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
      registeredBusinessName: isRegisteredBusiness
        ? hasValue(form.registeredBusinessName)
        : true,
      registrationNumber: hasValue(form.registrationNumber),
      registrationType: hasValue(form.registrationType),
      registrationDate: hasValue(form.registrationDate),
      registrationCountryCode: hasValue(form.registrationCountryCode),
      natureOfBusiness: hasValue(form.natureOfBusiness),
    };
  }, [form, isRegisteredBusiness]);

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
    if (
      !savedBusinessFieldsComplete.registeredBusinessName &&
      isRegisteredBusinessType(supplier?.registrationType)
    ) {
      items.push("Registered business name");
    }
    if (!savedBusinessFieldsComplete.registrationNumber)
      items.push("Registration number");
    if (!savedBusinessFieldsComplete.registrationType)
      items.push("Registration type");
    if (!savedBusinessFieldsComplete.registrationDate)
      items.push("Registration date");
    if (!savedBusinessFieldsComplete.registrationCountryCode) items.push("Country");
    if (!savedBusinessFieldsComplete.natureOfBusiness)
      items.push("Nature of business");
    return items;
  }, [savedBusinessFieldsComplete, supplier]);

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
    const supplierRegisteredBusinessRequired = isRegisteredBusinessType(
      supplier?.registrationType
    );
    const currentRegisteredBusinessName = isRegisteredBusiness
      ? form.registeredBusinessName
      : "";
    const savedRegisteredBusinessName = supplierRegisteredBusinessRequired
      ? supplier?.registeredBusinessName
      : "";

    return (
      norm(form.legalName) !== norm(supplier?.legalName) ||
      norm(currentRegisteredBusinessName) !== norm(savedRegisteredBusinessName) ||
      norm(form.registrationNumber) !== norm(supplier?.registrationNumber) ||
      norm(form.registrationType) !== norm(supplier?.registrationType) ||
      norm(normalizeDateInputValue(form.registrationDate)) !==
        norm(normalizeDateInputValue(supplier?.registrationDate)) ||
      norm(form.registrationCountryCode) !==
        norm(supplier?.registrationCountryCode || "NG") ||
      norm(form.registryAuthorityId) !== norm(supplier?.registryAuthorityId) ||
      norm(form.natureOfBusiness) !== norm(supplier?.natureOfBusiness)
    );
  }, [form, supplier, isRegisteredBusiness]);

  const bankDirty = useMemo(() => {
    return (
      norm(form.bankCountry) !== norm(supplier?.bankCountry || "NG") ||
      normCode(form.bankCode) !== normCode(supplier?.bankCode) ||
      norm(form.bankName) !== norm(supplier?.bankName) ||
      norm(form.accountName) !== norm(supplier?.accountName) ||
      norm(form.accountNumber) !== norm(supplier?.accountNumber)
    );
  }, [form, supplier]);

  const addressDone = useMemo(() => {
    return (
      hasAddress(supplier?.registeredAddress) || hasAddress(supplier?.pickupAddress)
    );
  }, [supplier]);

  const docsDone = useMemo(() => {
    return hasInlineDocuments(supplier) || hasFetchedDocuments(supplierDocuments);
  }, [supplier, supplierDocuments]);

  const businessReadyLive = useMemo(() => {
    return documentsLocked ? savedBusinessDone || draftBusinessDone : draftBusinessDone;
  }, [documentsLocked, savedBusinessDone, draftBusinessDone]);

  const bankReadyLive = useMemo(() => {
    return documentsLocked ? savedBankDone || draftBankDone : draftBankDone;
  }, [documentsLocked, savedBankDone, draftBankDone]);

  const savedBankIsMeaningful = useMemo(() => {
    return hasMeaningfulBankDetails(supplier);
  }, [supplier]);

  const effectiveBankStatus = useMemo<BankVerificationStatus>(() => {
    return getEffectiveBankStatus(supplier?.bankVerificationStatus, supplier);
  }, [supplier]);

  const bankLockedByStatus = useMemo(() => {
    return effectiveBankStatus === "VERIFIED" || effectiveBankStatus === "PENDING";
  }, [effectiveBankStatus]);

  const bankEditable = useMemo(() => {
    if (documentsLocked) return false;
    if (!savedBankIsMeaningful) return true;
    if (!bankLockedByStatus) return true;
    return bankEditUnlocked;
  }, [documentsLocked, savedBankIsMeaningful, bankLockedByStatus, bankEditUnlocked]);

  const businessTextLocked = documentsLocked;
  const businessSelectLocked = documentsLocked;
  const bankTextLocked = documentsLocked || !bankEditable;
  const bankSelectLocked = documentsLocked || !bankEditable;

  const canProceedToAddress = useMemo(() => {
    if (loading) return false;
    if (documentsLocked) return true;
    return (
      businessReadyLive &&
      bankReadyLive &&
      !businessDirty &&
      !bankDirty &&
      !isBusinessAutosaving &&
      !isBankSaving
    );
  }, [
    loading,
    documentsLocked,
    businessReadyLive,
    bankReadyLive,
    businessDirty,
    bankDirty,
    isBusinessAutosaving,
    isBankSaving,
  ]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);

      const params =
        isAdminReviewMode && adminSupplierId ? { supplierId: adminSupplierId } : undefined;

      const [supplierRes, docsRes] = await Promise.allSettled([
        api.get("/api/supplier/me", {
          withCredentials: true,
          params,
        }),
        api.get("/api/supplier/documents", {
          withCredentials: true,
          params,
        }),
      ]);

      if (supplierRes.status === "fulfilled") {
        const s = normalizeSupplierPayload(supplierRes.value.data);
        setSupplier(s);
        hydrateFormFromSupplier(s, false);

        const fetchedDocs =
          docsRes.status === "fulfilled"
            ? normalizeDocumentsPayload(docsRes.value.data)
            : [];

        setSupplierDocuments(fetchedDocs);

        const lockedFromInitialLoad =
          hasInlineDocuments(s) || hasFetchedDocuments(fetchedDocs);
        setDocumentsLockedOnLoad(lockedFromInitialLoad);

        const storageKey = s.id
          ? `supplier:onboarding:business-step-saved:${s.id}`
          : "";

        if (storageKey) {
          if (cameFromVerifyContact) {
            try {
              sessionStorage.removeItem(storageKey);
            } catch {}
            setBusinessStepSaved(false);
          } else {
            try {
              setBusinessStepSaved(sessionStorage.getItem(storageKey) === "true");
            } catch {
              setBusinessStepSaved(false);
            }
          }
        } else {
          setBusinessStepSaved(false);
        }

        if (getEffectiveBankStatus(s.bankVerificationStatus, s) !== "VERIFIED") {
          setBankEditUnlocked(false);
        }
      } else {
        throw supplierRes.reason;
      }

      hasHydratedRef.current = true;
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not load supplier onboarding."
      );
      scrollToTop();
    } finally {
      setLoading(false);
    }
  }, [
    adminSupplierId,
    cameFromVerifyContact,
    hydrateFormFromSupplier,
    isAdminReviewMode,
    scrollToTop,
  ]);

  useEffect(() => {
    void load();
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

  const countryBanks = useMemo(() => {
    const country = form.bankCountry || "NG";
    return banks.filter((b) => b.country === country);
  }, [banks, form.bankCountry]);

  useEffect(() => {
    if (!countryBanks.length) return;
    if (documentsLocked) return;

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
  }, [countryBanks, documentsLocked]);

  function setBankByName(name: string) {
    if (documentsLocked) return;
    const match = countryBanks.find((b) => b.name === name);
    setForm((f) => ({
      ...f,
      bankName: name || "",
      bankCode: match ? normCode(match.code) : "",
    }));
    if (bankSaveState !== "saving") setBankSaveState("idle");
    if (bankFormError) setBankFormError(null);
    if (err) setErr(null);
  }

  function setBankByCode(code: string) {
    if (documentsLocked) return;
    const c = normCode(code);
    const match = countryBanks.find((b) => normCode(b.code) === c);
    setForm((f) => ({
      ...f,
      bankCode: c,
      bankName: match?.name || f.bankName || "",
    }));
    if (bankSaveState !== "saving") setBankSaveState("idle");
    if (bankFormError) setBankFormError(null);
    if (err) setErr(null);
  }

  const saveBusinessOnly = useCallback(async () => {
    try {
      if (documentsLocked) return;

      setBusinessSaveState("saving");
      setErr(null);

      const payload: any = {
        legalName: form.legalName.trim() || null,
        registeredBusinessName: isRegisteredBusiness
          ? form.registeredBusinessName.trim() || null
          : null,
        registrationNumber: form.registrationNumber.trim() || null,
        registrationType: form.registrationType.trim() || null,
        registrationDate: form.registrationDate.trim() || null,
        registrationCountryCode: form.registrationCountryCode.trim() || null,
        registryAuthorityId: form.registryAuthorityId.trim() || null,
        natureOfBusiness: form.natureOfBusiness.trim() || null,
      };

      const params =
        isAdminReviewMode && adminSupplierId ? { supplierId: adminSupplierId } : undefined;

      const { data } = await api.put("/api/supplier/me", payload, {
        withCredentials: true,
        params,
      });

      const s = normalizeSupplierPayload(data);
      setSupplier(s);
      hydrateFormFromSupplier(s, true);

      const isSavedRegisteredBusinessRequired = isRegisteredBusinessType(
        s.registrationType
      );

      const isBusinessComplete =
        hasValue(s.legalName) &&
        (!isSavedRegisteredBusinessRequired || hasValue(s.registeredBusinessName)) &&
        hasValue(s.registrationNumber) &&
        hasValue(s.registrationType) &&
        hasValue(s.registrationDate) &&
        hasValue(s.registrationCountryCode) &&
        hasValue(s.natureOfBusiness);

      setBusinessStepSaved(isBusinessComplete);

      if (s.id) {
        try {
          if (isBusinessComplete) {
            sessionStorage.setItem(
              `supplier:onboarding:business-step-saved:${s.id}`,
              "true"
            );
          } else {
            sessionStorage.removeItem(
              `supplier:onboarding:business-step-saved:${s.id}`
            );
          }
        } catch {}
      }

      setBusinessSaveState("saved");
    } catch (e: any) {
      setBusinessSaveState("error");
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not save business details."
      );
      scrollToTop();
    }
  }, [
    adminSupplierId,
    documentsLocked,
    form,
    hydrateFormFromSupplier,
    isAdminReviewMode,
    isRegisteredBusiness,
    scrollToTop,
  ]);

  const saveBankDetails = useCallback(async () => {
    try {
      if (!bankEditable || documentsLocked) return;

      const missingBank = getMissingDraftBankFields();
      if (missingBank.length > 0) {
        setBankSaveState("error");
        showBankValidationError(
          missingBank,
          "Please complete all missing bank details before saving"
        );
        return;
      }

      setBankSaveState("saving");
      setErr(null);
      setBankFormError(null);

      const payload: any = {
        bankCountry: form.bankCountry.trim() || null,
        bankCode: normCode(form.bankCode) || null,
        bankName: form.bankName.trim() || null,
        accountName: form.accountName.trim() || null,
        accountNumber: form.accountNumber.replace(/\D/g, "").trim() || null,
      };

      const params =
        isAdminReviewMode && adminSupplierId ? { supplierId: adminSupplierId } : undefined;

      const { data } = await api.put("/api/supplier/me", payload, {
        withCredentials: true,
        params,
      });

      const s = normalizeSupplierPayload(data);
      setSupplier(s);
      hydrateFormFromSupplier(s, true);

      setBankSaveState("saved");
      setBankEditUnlocked(false);
      setBankFormError(null);
    } catch (e: any) {
      setBankSaveState("error");
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not save bank details."
      );
      setBankFormError(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not save bank details."
      );
      scrollToTop();
    }
  }, [
    adminSupplierId,
    bankEditable,
    documentsLocked,
    form,
    getMissingDraftBankFields,
    hydrateFormFromSupplier,
    isAdminReviewMode,
    scrollToTop,
    showBankValidationError,
  ]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    if (loading) return;
    if (documentsLocked) return;
    if (!businessDirty) return;
    if (isBusinessAutosaving) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void saveBusinessOnly();
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [businessDirty, documentsLocked, isBusinessAutosaving, loading, saveBusinessOnly]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const goToAddressStep = useCallback(() => {
    if (loading) return;
    if (!canProceedToAddress && !documentsLocked) return;

    setErr(null);
    setBankFormError(null);

    if (documentsLocked) {
      pushOnboardingStep("/supplier/onboarding/address", {
        fromBusinessDetails: true,
      });
      return;
    }

    pushOnboardingStep("/supplier/onboarding/address", {
      fromBusinessDetails: true,
    });
  }, [loading, canProceedToAddress, documentsLocked, pushOnboardingStep]);

  const goToVerifyContact = useCallback(() => {
    if (loading) return;

    setErr(null);

    persistVerifyContactJourney({
      contactVerified: true,
      reachedBusiness: true,
      reachedAddress: addressDone,
      reachedDocuments: docsDone,
      reachedDashboard: false,
    });

    const targetPath = buildStepUrl("/supplier/verify-contact");
    nav(targetPath, {
      state: {
        adminReview: isAdminReviewMode,
        allowReview: isAdminReviewMode,
        supplierId: isAdminReviewMode ? adminSupplierId || "" : "",
        adminSupplierId: isAdminReviewMode ? adminSupplierId || "" : "",
        fromOnboardingTab: true,
        skipAutoFinalize: true,
        fromBusinessDetails: true,
        returnTo: buildStepUrl("/supplier/onboarding"),
        nextAfterVerify: buildStepUrl("/supplier/onboarding"),
      },
    });
  }, [
    loading,
    addressDone,
    adminSupplierId,
    buildStepUrl,
    docsDone,
    isAdminReviewMode,
    nav,
    persistVerifyContactJourney,
  ]);

  const businessAutosaveStatusText =
    documentsLocked
      ? "Business details locked after document submission"
      : businessSaveState === "saving"
      ? "Saving business details…"
      : businessSaveState === "saved"
      ? "Business details saved"
      : businessSaveState === "error"
      ? "Business autosave failed"
      : businessDirty
      ? "Unsaved business changes"
      : "Business details up to date";

  const bankSaveStatusText =
    documentsLocked
      ? "Bank details locked after document submission"
      : bankSaveState === "saving"
      ? "Saving bank details…"
      : bankSaveState === "saved"
      ? "Bank details saved"
      : bankSaveState === "error"
      ? "Bank save failed"
      : bankDirty
      ? "Unsaved bank changes"
      : "Bank details up to date";

  const stepBase =
    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm transition";
  const stepDone = "border-emerald-200 bg-emerald-50 text-emerald-700";
  const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
  const stepLocked = "border-zinc-100 bg-zinc-50 text-zinc-400";
  const stepClickable = "cursor-pointer hover:bg-zinc-50";
  const stepDisabledLoading =
    "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400 pointer-events-none";
  const stepDisabledBlocked =
    "cursor-not-allowed border-zinc-100 bg-zinc-50 text-zinc-400 pointer-events-none";

  const input =
    "w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] md:text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow,background-color] duration-150 ease-out focus:border-violet-400 focus:ring-4 focus:ring-violet-200 shadow-sm";
  const inputLocked =
    "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0";
  const label = "mb-1.5 block text-sm font-semibold text-slate-800";
  const card =
    "rounded-[28px] border border-white/70 bg-white/95 p-4 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 md:p-8";
  const panel = "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";
  const primaryBtn =
    "inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60";
  const secondaryBtn =
    "inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60";

  const bankStatusChip = (() => {
    if (effectiveBankStatus === "VERIFIED") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
          <VerifiedIcon size={14} /> Verified
        </span>
      );
    }
    if (effectiveBankStatus === "PENDING") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
          <Clock size={14} /> Pending verification
        </span>
      );
    }
    if (effectiveBankStatus === "REJECTED") {
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
    const items = [
      { key: "contact", label: "Contact verified", done: true },
      { key: "business", label: "Business details", done: businessReadyLive },
      { key: "bank", label: "Bank details", done: bankReadyLive },
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
    };
  }, [addressDone, bankReadyLive, businessReadyLive, docsDone]);

  const documentsAccessible = useMemo(() => {
    return addressDone;
  }, [addressDone]);

  const addressTabAccessible = canProceedToAddress || documentsLocked;
  const documentsTabAccessible = docsDone || documentsAccessible;

  const canClickPreviousTab = !loading;
  const canClickAddressTab = !loading && addressTabAccessible;
  const tabsBlockedByLoading = loading;

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
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-semibold">
                    1
                  </span>
                  <span>Register</span>
                </div>

                <button
                  type="button"
                  onClick={canClickPreviousTab ? goToVerifyContact : undefined}
                  disabled={!canClickPreviousTab}
                  className={`${stepBase} ${
                    tabsBlockedByLoading ? stepDisabledLoading : stepDone
                  } ${
                    canClickPreviousTab && !tabsBlockedByLoading
                      ? stepClickable
                      : "cursor-not-allowed"
                  }`}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-semibold">
                    2
                  </span>
                  <span>Verify contact</span>
                </button>

                <div className={`${stepBase} ${stepActive}`}>
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-semibold">
                    3
                  </span>
                  <span>Business details</span>
                </div>

                <button
                  type="button"
                  onClick={canClickAddressTab ? goToAddressStep : undefined}
                  disabled={!canClickAddressTab}
                  className={`${stepBase} ${
                    tabsBlockedByLoading
                      ? stepDisabledLoading
                      : addressTabAccessible
                      ? stepDone
                      : stepDisabledBlocked
                  } ${
                    canClickAddressTab && !tabsBlockedByLoading
                      ? stepClickable
                      : "cursor-not-allowed"
                  }`}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-semibold">
                    4
                  </span>
                  <span>Address</span>
                </button>

                <div
                  className={`${stepBase} ${
                    tabsBlockedByLoading
                      ? stepDisabledLoading
                      : documentsTabAccessible
                      ? stepDone
                      : stepDisabledBlocked
                  }`}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-semibold">
                    5
                  </span>
                  <span>Documents</span>
                </div>

                <div
                  className={`${stepBase} ${
                    tabsBlockedByLoading ? stepDisabledLoading : stepDisabledBlocked
                  }`}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-semibold">
                    6
                  </span>
                  <span>Dashboard access</span>
                </div>
              </div>

              {loading && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                  Loading onboarding details. Tabs are temporarily locked until the page is fully ready.
                </div>
              )}
            </div>

            {documentsLocked && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Documents had already been submitted when this page loaded. Business and bank details are read-only on this visit.
              </div>
            )}

            {!documentsLocked && businessDirty && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Business changes are being saved automatically. You can still click Next, and we’ll
                guide you to what needs attention.
              </div>
            )}

            {!documentsLocked && bankDirty && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                You have unsaved bank changes. Click Next and you’ll be taken to the bank field that
                still needs saving.
              </div>
            )}

            {!documentsLocked && draftBusinessDone && !savedBusinessDone && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Business details look complete. Autosave will store them shortly.
              </div>
            )}

            {!documentsLocked && draftBankDone && !savedBankDone && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Bank details look complete, but they are not saved yet.
              </div>
            )}

            {!documentsLocked && !savedBusinessDone && missingSavedBusinessFields.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Complete all required business details: {missingSavedBusinessFields.join(", ")}.
              </div>
            )}

            {!documentsLocked && !savedBankDone && missingSavedBankFields.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Bank details still missing: {missingSavedBankFields.join(", ")}.
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
                          ref={legalNameRef}
                          value={form.legalName}
                          onChange={setField("legalName")}
                          readOnly={businessTextLocked}
                          className={`${input} ${businessTextLocked ? inputLocked : ""}`}
                          placeholder="Legal business name"
                        />
                      </div>

                      {isRegisteredBusiness && (
                        <div>
                          <label className={label}>Registered business name</label>
                          <input
                            ref={registeredBusinessNameRef}
                            value={form.registeredBusinessName}
                            onChange={setField("registeredBusinessName")}
                            readOnly={businessTextLocked}
                            className={`${input} ${businessTextLocked ? inputLocked : ""}`}
                            placeholder="Registered business name"
                          />
                        </div>
                      )}

                      <div>
                        <label className={label}>Registration number</label>
                        <input
                          ref={registrationNumberRef}
                          value={form.registrationNumber}
                          onChange={setField("registrationNumber")}
                          readOnly={businessTextLocked}
                          className={`${input} ${businessTextLocked ? inputLocked : ""}`}
                          placeholder="Registration number"
                        />
                      </div>

                      <div>
                        <label className={label}>Registration type</label>
                        <select
                          ref={registrationTypeRef}
                          value={form.registrationType}
                          onChange={setField("registrationType")}
                          disabled={businessSelectLocked}
                          className={`${input} ${businessSelectLocked ? inputLocked : ""}`}
                        >
                          <option value="">Select registration type</option>
                          <option value="INDIVIDUAL">Individual</option>
                          <option value="REGISTERED_BUSINESS">Registered business</option>
                        </select>
                      </div>

                      <div>
                        <label className={label}>Registration date</label>
                        <input
                          ref={registrationDateRef}
                          type="date"
                          value={form.registrationDate}
                          onChange={setField("registrationDate")}
                          readOnly={businessTextLocked}
                          className={`${input} ${businessTextLocked ? inputLocked : ""}`}
                        />
                      </div>

                      <div>
                        <label className={label}>Country</label>
                        <select
                          ref={registrationCountryCodeRef}
                          value={form.registrationCountryCode}
                          onChange={setField("registrationCountryCode")}
                          disabled={businessSelectLocked}
                          className={`${input} ${businessSelectLocked ? inputLocked : ""}`}
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
                          ref={natureOfBusinessRef}
                          value={form.natureOfBusiness}
                          onChange={setField("natureOfBusiness")}
                          readOnly={businessTextLocked}
                          className={`${input} min-h-[110px] resize-y ${
                            businessTextLocked ? inputLocked : ""
                          }`}
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
                        {effectiveBankStatus === "VERIFIED" &&
                          !bankEditUnlocked &&
                          !documentsLocked && (
                            <button
                              type="button"
                              onClick={() => setBankEditUnlocked(true)}
                              className="rounded-full border bg-white px-3 py-1.5 text-[11px] hover:bg-black/5"
                            >
                              Request change
                            </button>
                          )}
                        {bankEditUnlocked && !documentsLocked && (
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

                    {supplier?.bankVerificationNote && savedBankIsMeaningful && (
                      <div className="mb-3 rounded-xl border bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                        <span className="font-semibold">Admin note:</span>{" "}
                        {supplier.bankVerificationNote}
                      </div>
                    )}

                    {effectiveBankStatus === "PENDING" && savedBankIsMeaningful && (
                      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        Bank details are <span className="font-semibold">pending verification</span>.
                        Editing is locked until review is complete.
                      </div>
                    )}

                    {effectiveBankStatus === "VERIFIED" && !bankEditUnlocked && !documentsLocked && (
                      <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                        Your bank details are verified and locked. Use{" "}
                        <span className="font-semibold">Request change</span> to update them.
                      </div>
                    )}

                    {documentsLocked && (
                      <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                        Bank details are locked because documents had already been submitted when this page loaded.
                      </div>
                    )}

                    {bankEditUnlocked &&
                      effectiveBankStatus !== "PENDING" &&
                      !documentsLocked && (
                        <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                          When you save new bank details, they will be submitted for verification.
                        </div>
                      )}

                    {bankFormError && (
                      <div className="mb-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        {bankFormError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div>
                        <label className={label}>Bank country</label>
                        <select
                          ref={bankCountryRef}
                          value={form.bankCountry}
                          onChange={(e) => {
                            if (documentsLocked) return;
                            setForm((f) => ({
                              ...f,
                              bankCountry: e.target.value || "NG",
                              bankCode: "",
                              bankName: "",
                            }));
                            if (bankSaveState !== "saving") setBankSaveState("idle");
                            if (bankFormError) setBankFormError(null);
                            if (err) setErr(null);
                          }}
                          disabled={bankSelectLocked}
                          className={`${input} ${bankSelectLocked ? inputLocked : ""}`}
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
                          ref={bankNameRef}
                          value={form.bankName}
                          onChange={(e) => setBankByName(e.target.value)}
                          disabled={bankSelectLocked}
                          className={`${input} ${bankSelectLocked ? inputLocked : ""}`}
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
                          ref={bankCodeRef}
                          value={normCode(form.bankCode)}
                          onChange={(e) => setBankByCode(e.target.value)}
                          disabled={bankSelectLocked}
                          className={`${input} ${bankSelectLocked ? inputLocked : ""}`}
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
                          ref={accountNameRef}
                          value={form.accountName}
                          onChange={setField("accountName")}
                          readOnly={bankTextLocked}
                          className={`${input} ${bankTextLocked ? inputLocked : ""}`}
                          placeholder="Account name"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className={label}>Account number</label>
                        <input
                          ref={accountNumberRef}
                          value={form.accountNumber}
                          onChange={(e) => {
                            if (documentsLocked) return;
                            setForm((f) => ({
                              ...f,
                              accountNumber: e.target.value.replace(/\D/g, "").slice(0, 16),
                            }));
                            if (bankSaveState !== "saving") setBankSaveState("idle");
                            if (bankFormError) setBankFormError(null);
                            if (err) setErr(null);
                          }}
                          readOnly={bankTextLocked}
                          className={`${input} ${bankTextLocked ? inputLocked : ""}`}
                          placeholder="Account number"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <span
                        className={`text-sm ${
                          bankSaveState === "error"
                            ? "text-rose-600"
                            : bankSaveState === "saving"
                            ? "text-amber-700"
                            : "text-zinc-600"
                        }`}
                      >
                        {bankSaveStatusText}
                      </span>

                      <button
                        type="button"
                        onClick={() => void saveBankDetails()}
                        disabled={documentsLocked || !bankEditable || isBankSaving || loading}
                        className={secondaryBtn}
                      >
                        {documentsLocked
                          ? "Locked"
                          : bankSaveState === "saving"
                          ? "Saving bank details…"
                          : bankSaveState === "saved" && !bankDirty
                          ? "Bank details saved"
                          : "Save bank details"}
                      </button>
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
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              item.done
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
                      disabled={loading || !addressTabAccessible}
                      className={`${secondaryBtn} mt-4 w-full`}
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
                          {documentsAccessible
                            ? "Documents is now available after completing the Address step."
                            : "This becomes available after the Address step is completed."}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled
                      className={`mt-4 w-full inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${
                        documentsTabAccessible
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border border-zinc-300 bg-white text-zinc-400"
                      }`}
                    >
                      Continue to documents
                    </button>
                  </div>

                  <div className={panel}>
                    <h3 className="text-sm font-semibold text-zinc-900">Full dashboard access</h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      Dashboard becomes fully available once all onboarding steps are completed.
                    </p>

                    <button type="button" disabled className={`${primaryBtn} mt-4 w-full`}>
                      Go to dashboard
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={goToVerifyContact}
                  disabled={loading}
                  className={secondaryBtn}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </button>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm ${
                      businessSaveState === "error"
                        ? "text-rose-600"
                        : businessSaveState === "saving"
                        ? "text-amber-700"
                        : "text-zinc-600"
                    }`}
                  >
                    {businessAutosaveStatusText}
                  </span>

                  <button
                    type="button"
                    onClick={goToAddressStep}
                    disabled={loading || !addressTabAccessible}
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