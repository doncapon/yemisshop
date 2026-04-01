// src/pages/supplier/SupplierVerifyContact.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Mail,
  Phone,
  RefreshCw,
  Building2,
  User,
  Globe,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";
import { useAuthStore } from "../../store/auth";

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

type VerifyLocationState = {
  supplierId?: string | null;
  email?: string | null;
  phone?: string | null;
  dialCode?: string | null;
  emailSent?: boolean;
  phoneOtpSent?: boolean;
  nextAfterVerify?: string;
  flow?: string;
  adminReview?: boolean;
  allowReview?: boolean;
  skipAutoFinalize?: boolean;
  returnTo?: string;
  fromBusinessDetails?: boolean;
  fromOnboardingTab?: boolean;
};

type VerifySummary = {
  businessName: string;
  legalName: string;
  registeredBusinessName: string;
  registrationType: string;
  registrationCountryCode: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  contactDialCode: string;
};

type AddressLite = {
  id?: string;
  houseNumber?: string | null;
  streetName?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postCode?: string | null;
};

type SupplierMeLite = {
  id?: string;
  supplierId?: string;
  userId?: string | null;

  businessName?: string | null;
  legalName?: string | null;
  registeredBusinessName?: string | null;
  registrationNumber?: string | null;
  registrationType?: string | null;
  registrationDate?: string | null;
  registrationCountryCode?: string | null;
  registryAuthorityId?: string | null;
  natureOfBusiness?: string | null;

  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;

  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactDialCode?: string | null;
  name?: string | null;

  registeredAddress?: AddressLite | null;
  pickupAddress?: AddressLite | null;

  documents?: any[] | null;
  verificationDocuments?: any[] | null;
  identityDocumentUrl?: string | null;
  proofOfAddressUrl?: string | null;
  cacDocumentUrl?: string | null;

  user?: {
    id?: string | null;
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    emailVerifiedAt?: string | null;
    phoneVerifiedAt?: string | null;
  } | null;
};

type AuthMeLite = {
  id?: string | null;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
  status?: string | null;
};

type PersistedJourneyState = {
  contactVerified?: boolean;
  reachedBusiness?: boolean;
  reachedAddress?: boolean;
  reachedDocuments?: boolean;
  reachedDashboard?: boolean;
};

type VerificationSnapshot = {
  emailVerified: boolean;
  phoneVerified: boolean;
};

function maskEmail(v: string) {
  const [name, domain] = String(v || "").split("@");
  if (!name || !domain) return v;
  if (name.length <= 2) return `${name[0] ?? ""}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(v: string) {
  const raw = String(v || "").trim();
  if (raw.length < 6) return raw;
  return `${raw.slice(0, 4)}***${raw.slice(-3)}`;
}

function normalizeDialCode(raw: unknown): string {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

function getTempToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("tempToken") || "";
}

function clearTempToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("tempToken");
}

function getVerifyConfig() {
  const tempToken = getTempToken();

  return {
    withCredentials: true,
    headers: tempToken ? { Authorization: `Bearer ${tempToken}` } : {},
  };
}

function pickString(v: unknown) {
  return String(v ?? "").trim();
}

function hasValue(v: unknown) {
  return String(v ?? "").trim().length > 0;
}

function isTruthyVerificationFlag(value: unknown) {
  if (value === true) return true;
  if (typeof value === "string" && value.trim()) return true;
  return false;
}

function isAuthEmailVerified(
  source?: Pick<AuthMeLite, "emailVerified" | "emailVerifiedAt"> | null
) {
  return (
    isTruthyVerificationFlag(source?.emailVerified) ||
    isTruthyVerificationFlag(source?.emailVerifiedAt)
  );
}

function isAuthPhoneVerified(
  source?: Pick<AuthMeLite, "phoneVerified" | "phoneVerifiedAt"> | null
) {
  return (
    isTruthyVerificationFlag(source?.phoneVerified) ||
    isTruthyVerificationFlag(source?.phoneVerifiedAt)
  );
}

function isSupplierUserEmailVerified(source?: SupplierMeLite | null) {
  return Boolean(source?.user?.emailVerifiedAt);
}

function isSupplierUserPhoneVerified(source?: SupplierMeLite | null) {
  return Boolean(source?.user?.phoneVerifiedAt);
}

function isRegisteredBusinessType(v?: string | null) {
  return String(v ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS";
}

function hasAddress(addr?: AddressLite | null) {
  if (!addr) return false;
  return Boolean(
    addr.streetName ||
      addr.houseNumber ||
      addr.city ||
      addr.state ||
      addr.country ||
      addr.postCode ||
      addr.town
  );
}

function hasDocuments(s?: SupplierMeLite | null) {
  if (!s) return false;
  return Boolean(
    (Array.isArray(s.documents) && s.documents.length > 0) ||
      (Array.isArray(s.verificationDocuments) &&
        s.verificationDocuments.length > 0) ||
      s.identityDocumentUrl ||
      s.proofOfAddressUrl ||
      s.cacDocumentUrl
  );
}

function hasMeaningfulBusinessDetails(s?: SupplierMeLite | null) {
  if (!s) return false;
  const registeredBusinessRequired = isRegisteredBusinessType(
    s.registrationType
  );

  return (
    hasValue(s.legalName) &&
    (!registeredBusinessRequired || hasValue(s.registeredBusinessName)) &&
    hasValue(s.registrationNumber) &&
    hasValue(s.registrationType) &&
    hasValue(s.registrationDate) &&
    hasValue(s.registrationCountryCode) &&
    hasValue(s.natureOfBusiness)
  );
}

function hasMeaningfulBankDetails(s?: SupplierMeLite | null) {
  if (!s) return false;
  return (
    hasValue(s.bankCountry) &&
    hasValue(s.bankCode) &&
    hasValue(s.bankName) &&
    hasValue(s.accountName) &&
    hasValue(s.accountNumber)
  );
}

function countryLabel(code?: string | null) {
  const c = String(code || "").toUpperCase();
  if (c === "NG") return "Nigeria";
  if (c === "KE") return "Kenya";
  if (c === "RW") return "Rwanda";
  if (c === "BJ") return "Benin Republic";
  if (c === "GH") return "Ghana";
  if (c === "CD") return "Congo";
  if (c === "CM") return "Cameroon";
  if (c === "TG") return "Togo";
  if (c === "BF") return "Burkina Faso";
  return c || "—";
}

function registrationTypeLabel(v?: string | null) {
  const value = String(v || "").toUpperCase();
  if (value === "INDIVIDUAL") return "Individual";
  if (value === "REGISTERED_BUSINESS") return "Registered business";
  return "—";
}

function normalizeAuthMePayload(payload: any) {
  const data = payload?.data ?? payload?.user ?? payload ?? {};

  const id = String(data?.id ?? "").trim();
  const email = String(data?.email ?? "").trim();

  if (!id || !email) {
    return null;
  }

  return {
    id,
    email,
    role: String(data?.role ?? "").trim(),
    phone: data?.phone ?? null,
    firstName: data?.firstName ?? null,
    middleName: data?.middleName ?? null,
    lastName: data?.lastName ?? null,
    emailVerified: !!(data?.emailVerified ?? data?.emailVerifiedAt),
    phoneVerified: !!(data?.phoneVerified ?? data?.phoneVerifiedAt),
    emailVerifiedAt: data?.emailVerifiedAt ?? null,
    phoneVerifiedAt: data?.phoneVerifiedAt ?? null,
    status: data?.status ?? null,
  };
}

function readJourneyState(key: string): PersistedJourneyState {
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PersistedJourneyState;
  } catch {
    return {};
  }
}

function writeJourneyState(key: string, patch: PersistedJourneyState) {
  if (!key || typeof window === "undefined") return;
  try {
    const current = readJourneyState(key);
    sessionStorage.setItem(
      key,
      JSON.stringify({
        ...current,
        ...patch,
      })
    );
  } catch {}
}

export default function SupplierVerifyContact() {
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const state = (location.state ?? {}) as VerifyLocationState;

  const adminSupplierId = useMemo(() => {
    const fromQuery = searchParams.get("supplierId");
    const fromState = state.supplierId;

    const explicitAdminMode = Boolean(
      state.adminReview ||
        state.allowReview ||
        location.pathname.startsWith("/admin/")
    );

    if (!explicitAdminMode) return "";

    let fromStorage = "";
    try {
      fromStorage = localStorage.getItem(ADMIN_SUPPLIER_KEY) || "";
    } catch {}

    return pickString(fromQuery || fromState || fromStorage);
  }, [
    location.pathname,
    searchParams,
    state.adminReview,
    state.allowReview,
    state.supplierId,
  ]);

  const isAdminReviewMode = useMemo(() => {
    return Boolean(
      state.adminReview ||
        state.allowReview ||
        location.pathname.startsWith("/admin/")
    );
  }, [location.pathname, state.adminReview, state.allowReview]);

  const buildStepUrl = useMemo(() => {
    return (path: string) => {
      if (!isAdminReviewMode || !adminSupplierId) return path;
      const qs = new URLSearchParams();
      qs.set("supplierId", adminSupplierId);
      return `${path}?${qs.toString()}`;
    };
  }, [adminSupplierId, isAdminReviewMode]);

  const makeStepState = useMemo(() => {
    return (
      targetPath: string,
      extraState?: Record<string, unknown>
    ): Record<string, unknown> => {
      return {
        email: state.email || "",
        phone: state.phone || "",
        dialCode: state.dialCode || "",
        emailSent: state.emailSent || false,
        phoneOtpSent: state.phoneOtpSent || false,
        flow: state.flow,

        adminReview: isAdminReviewMode,
        allowReview: isAdminReviewMode,
        skipAutoFinalize: true,
        supplierId: isAdminReviewMode
          ? adminSupplierId || state.supplierId || ""
          : "",
        fromOnboardingTab: true,

        returnTo: targetPath,
        nextAfterVerify: targetPath,

        fromBusinessDetails: false,

        ...extraState,
      };
    };
  }, [
    adminSupplierId,
    isAdminReviewMode,
    state.dialCode,
    state.email,
    state.emailSent,
    state.flow,
    state.phone,
    state.phoneOtpSent,
    state.supplierId,
  ]);

  const pushStep = useMemo(() => {
    return (path: string, extraState?: Record<string, unknown>) => {
      const targetPath = buildStepUrl(path);
      nav(targetPath, {
        state: makeStepState(targetPath, extraState),
      });
    };
  }, [buildStepUrl, makeStepState, nav]);

  const journeyKey = useMemo(() => {
    const keyId = pickString(
      adminSupplierId || state.supplierId || searchParams.get("supplierId")
    );
    return keyId ? `supplier:verify-contact:journey:${keyId}` : "";
  }, [adminSupplierId, searchParams, state.supplierId]);

  const stepHint = useMemo(() => {
    return `${state.returnTo || ""} ${state.nextAfterVerify || ""}`.toLowerCase();
  }, [state.nextAfterVerify, state.returnTo]);

  const cameFromBusinessStep = useMemo(() => {
    return Boolean(
      state.fromBusinessDetails || stepHint.includes("/business-details")
    );
  }, [state.fromBusinessDetails, stepHint]);

  const cameFromAddressStep = useMemo(() => {
    return stepHint.includes("/onboarding/address");
  }, [stepHint]);

  const cameFromDocumentsStep = useMemo(() => {
    return stepHint.includes("/onboarding/documents");
  }, [stepHint]);

  const cameFromDashboardStep = useMemo(() => {
    return /(^|[\s?])\/supplier($|[/?\s])/.test(stepHint);
  }, [stepHint]);

  const cameFromOnboardingRoot = useMemo(() => {
    return (
      stepHint.includes("/supplier/onboarding") &&
      !stepHint.includes("/business-details") &&
      !stepHint.includes("/address") &&
      !stepHint.includes("/documents") &&
      !/(^|[\s?])\/supplier($|[/?\s])/.test(stepHint)
    );
  }, [stepHint]);

  const [journeyState, setJourneyState] = useState<PersistedJourneyState>({});
  const [summary, setSummary] = useState<VerifySummary | null>(
    state.email || state.phone
      ? {
          businessName: "",
          legalName: "",
          registrationType: "",
          registrationCountryCode: "",
          contactFirstName: "",
          contactLastName: "",
          registeredBusinessName: "",
          contactEmail: state.email || "",
          contactPhone: state.phone || "",
          contactDialCode: normalizeDialCode(state.dialCode || ""),
        }
      : null
  );

  const [supplierSnapshot, setSupplierSnapshot] =
    useState<SupplierMeLite | null>(null);

  const [email, setEmail] = useState(state.email || "");
  const [phone, setPhone] = useState(state.phone || "");
  const [dialCode, setDialCode] = useState(
    normalizeDialCode(state.dialCode || "")
  );

  const [emailSent, setEmailSent] = useState(!!state.emailSent);
  const [phoneOtpSent, setPhoneOtpSent] = useState(!!state.phoneOtpSent);

  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);

  const [busyEmail, setBusyEmail] = useState(false);
  const [busyPhone, setBusyPhone] = useState(false);
  const [busyVerifyOtp, setBusyVerifyOtp] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [finalizingSession, setFinalizingSession] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasAutoFinalizedRef = useRef(false);
  const hasAutoRequestedOtpRef = useRef(false);

  const hasVerifySession = useMemo(() => {
    return Boolean(getTempToken());
  }, [emailVerified, phoneVerified, loadingSummary]);

  useEffect(() => {
    setJourneyState(readJourneyState(journeyKey));
  }, [journeyKey]);

  useEffect(() => {
    if (!journeyKey) return;

    const patch: PersistedJourneyState = {};

    if (cameFromBusinessStep) patch.reachedBusiness = true;
    if (cameFromAddressStep) patch.reachedAddress = true;
    if (cameFromDocumentsStep) patch.reachedDocuments = true;
    if (cameFromDashboardStep) patch.reachedDashboard = true;

    if (Object.keys(patch).length > 0) {
      writeJourneyState(journeyKey, patch);
      setJourneyState(readJourneyState(journeyKey));
    }
  }, [
    cameFromAddressStep,
    cameFromBusinessStep,
    cameFromDashboardStep,
    cameFromDocumentsStep,
    journeyKey,
  ]);

  const loadSummary = async () => {
    try {
      setLoadingSummary(true);
      setErr(null);

      const cfg = getVerifyConfig();
      const tempToken = getTempToken();

      let supplierData: SupplierMeLite | null = null;
      let authData: AuthMeLite | null = null;

      if (isAdminReviewMode) {
        try {
          const supplierRes = await api.get("/api/supplier/me", {
            ...cfg,
            params: adminSupplierId ? { supplierId: adminSupplierId } : undefined,
          });
          supplierData = ((supplierRes.data as any)?.data ??
            supplierRes.data ??
            {}) as SupplierMeLite;
          setSupplierSnapshot(supplierData);
        } catch {}
      } else if (tempToken) {
        try {
          const supplierRes = await api.get("/api/supplier/me", cfg);
          supplierData = ((supplierRes.data as any)?.data ??
            supplierRes.data ??
            {}) as SupplierMeLite;
          setSupplierSnapshot(supplierData);
        } catch {}

        try {
          const authRes = await api.get("/api/auth/me", cfg);
          authData = normalizeAuthMePayload(authRes.data);
        } catch {}
      }

      const resolvedEmail =
        state.email ||
        pickString(supplierData?.contactEmail) ||
        pickString(supplierData?.user?.email) ||
        pickString(authData?.email);

      const resolvedPhone =
        state.phone ||
        pickString(supplierData?.contactPhone) ||
        pickString(supplierData?.user?.phone) ||
        pickString(authData?.phone);

      const resolvedDialCode =
        normalizeDialCode(state.dialCode) ||
        normalizeDialCode(supplierData?.contactDialCode);

      setEmail(resolvedEmail);
      setPhone(resolvedPhone);
      setDialCode(resolvedDialCode);

      if (supplierData || authData) {
        setSummary({
          businessName:
            pickString(supplierData?.businessName) ||
            pickString(supplierData?.name),
          legalName: pickString(supplierData?.legalName),
          registeredBusinessName: pickString(
            supplierData?.registeredBusinessName
          ),
          registrationType: pickString(supplierData?.registrationType),
          registrationCountryCode: pickString(
            supplierData?.registrationCountryCode
          ),
          contactFirstName:
            pickString(supplierData?.contactFirstName) ||
            pickString(supplierData?.user?.firstName) ||
            pickString(authData?.firstName),
          contactLastName:
            pickString(supplierData?.contactLastName) ||
            pickString(supplierData?.user?.lastName) ||
            pickString(authData?.lastName),
          contactEmail: resolvedEmail,
          contactPhone: resolvedPhone,
          contactDialCode: resolvedDialCode,
        });

        if (isAdminReviewMode) {
          setEmailVerified(isSupplierUserEmailVerified(supplierData));
          setPhoneVerified(isSupplierUserPhoneVerified(supplierData));
        } else {
          setEmailVerified(isAuthEmailVerified(authData));
          setPhoneVerified(isAuthPhoneVerified(authData));
        }
      }
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not load supplier registration details."
      );
    } finally {
      setLoadingSummary(false);
    }
  };

  const legalEntityLabel =
    summary?.registrationType === "REGISTERED_BUSINESS"
      ? "Company legal name"
      : "Full legal name";

  const loadStatus = useCallback(
    async (): Promise<VerificationSnapshot | null> => {
      try {
        setErr(null);
        setChecking(true);

        if (isAdminReviewMode) {
          const supplierRes = await api.get("/api/supplier/me", {
            ...getVerifyConfig(),
            params: adminSupplierId ? { supplierId: adminSupplierId } : undefined,
          });

          const supplierData = ((supplierRes.data as any)?.data ??
            supplierRes.data ??
            {}) as SupplierMeLite;

          const nextEmailVerified = Boolean(supplierData?.user?.emailVerifiedAt);
          const nextPhoneVerified = Boolean(supplierData?.user?.phoneVerifiedAt);

          setSupplierSnapshot(supplierData);
          setEmailVerified(nextEmailVerified);
          setPhoneVerified(nextPhoneVerified);

          return {
            emailVerified: nextEmailVerified,
            phoneVerified: nextPhoneVerified,
          };
        }

        const activeEmail = email || summary?.contactEmail || "";
        if (!activeEmail) {
          setErr("No supplier email found for verification.");
          return null;
        }

        const emailRes = await api.get("/api/auth/email-status", {
          params: { email: activeEmail },
          withCredentials: true,
        });

        const nextEmailVerified =
          !!emailRes?.data?.emailVerifiedAt || !!emailRes?.data?.emailVerified;

        setEmailVerified(nextEmailVerified);

        let nextPhoneVerified = false;
        const tempToken = getTempToken();

        if (tempToken) {
          const cfg = getVerifyConfig();

          try {
            const supplierRes = await api.get("/api/supplier/me", cfg);
            const supplierData = ((supplierRes.data as any)?.data ??
              supplierRes.data ??
              {}) as SupplierMeLite;
            setSupplierSnapshot(supplierData);
          } catch {
            // ignore
          }

          try {
            const meRes = await api.get("/api/auth/me", cfg);
            const me = normalizeAuthMePayload(meRes.data);
            nextPhoneVerified = isAuthPhoneVerified(me);
            setPhoneVerified(nextPhoneVerified);
          } catch {
            // ignore
          }
        }

        return {
          emailVerified: nextEmailVerified,
          phoneVerified: nextPhoneVerified,
        };
      } catch (e: any) {
        setErr(
          e?.response?.data?.error ||
            e?.response?.data?.message ||
            "Could not load verification status."
        );
        return null;
      } finally {
        setChecking(false);
      }
    },
    [adminSupplierId, email, isAdminReviewMode, summary?.contactEmail]
  );

  const hydrateAuthStoreFromSession = async () => {
    await useAuthStore.getState().bootstrap();

    const authedUser = useAuthStore.getState().user;
    if (!authedUser?.id) {
      throw new Error("Could not hydrate authenticated user.");
    }

    return authedUser;
  };

  const contactVerifiedByJourney = useMemo(() => {
    return Boolean(journeyState.contactVerified);
  }, [journeyState.contactVerified]);

  const reachedBusinessEffective = useMemo(() => {
    return Boolean(journeyState.reachedBusiness);
  }, [journeyState]);

  const reachedAddressEffective = useMemo(() => {
    return Boolean(journeyState.reachedAddress);
  }, [journeyState]);

  const emailVerifiedEffective = useMemo(() => {
    return emailVerified || contactVerifiedByJourney;
  }, [emailVerified, contactVerifiedByJourney]);

  const phoneVerifiedEffective = useMemo(() => {
    return phoneVerified || contactVerifiedByJourney;
  }, [phoneVerified, contactVerifiedByJourney]);

  useEffect(() => {
    if (!journeyKey) return;

    if (emailVerified && phoneVerified) {
      writeJourneyState(journeyKey, { contactVerified: true });
      setJourneyState(readJourneyState(journeyKey));
      return;
    }

    if (!emailVerified && !phoneVerified && journeyState.contactVerified) {
      writeJourneyState(journeyKey, { contactVerified: false });
      setJourneyState(readJourneyState(journeyKey));
    }
  }, [emailVerified, phoneVerified, journeyKey, journeyState.contactVerified]);

  const canContinue = useMemo(
    () => emailVerifiedEffective && phoneVerifiedEffective,
    [emailVerifiedEffective, phoneVerifiedEffective]
  );

  const businessDetailsDone = useMemo(() => {
    return (
      hasMeaningfulBusinessDetails(supplierSnapshot) &&
      hasMeaningfulBankDetails(supplierSnapshot)
    );
  }, [supplierSnapshot]);

  const addressDone = useMemo(() => {
    return (
      hasAddress(supplierSnapshot?.registeredAddress) ||
      hasAddress(supplierSnapshot?.pickupAddress)
    );
  }, [supplierSnapshot]);

  const documentsDone = useMemo(() => {
    return hasDocuments(supplierSnapshot);
  }, [supplierSnapshot]);

  useEffect(() => {
    if (!journeyKey) return;

    const patch: PersistedJourneyState = {};
    if (businessDetailsDone) patch.reachedBusiness = true;
    if (addressDone) patch.reachedAddress = true;
    if (documentsDone) patch.reachedDocuments = true;
    if (businessDetailsDone && addressDone && documentsDone && canContinue) {
      patch.reachedDashboard = true;
    }

    if (Object.keys(patch).length > 0) {
      writeJourneyState(journeyKey, patch);
      setJourneyState(readJourneyState(journeyKey));
    }
  }, [addressDone, businessDetailsDone, canContinue, documentsDone, journeyKey]);

  const businessDetailsAccessible = useMemo(() => {
    return canContinue;
  }, [canContinue]);

  const documentsAccessible = useMemo(() => {
    return addressDone || reachedAddressEffective;
  }, [addressDone, reachedAddressEffective]);

  const openedFromOnboardingTab = useMemo(() => {
    return Boolean(
      state.fromOnboardingTab ||
        state.returnTo ||
        state.nextAfterVerify ||
        cameFromBusinessStep ||
        cameFromAddressStep ||
        cameFromDocumentsStep ||
        cameFromDashboardStep ||
        cameFromOnboardingRoot
    );
  }, [
    cameFromAddressStep,
    cameFromBusinessStep,
    cameFromDashboardStep,
    cameFromDocumentsStep,
    cameFromOnboardingRoot,
    state.fromOnboardingTab,
    state.nextAfterVerify,
    state.returnTo,
  ]);

  const shouldAutoFinalize = useMemo(() => {
    return (
      !isAdminReviewMode &&
      !state.skipAutoFinalize &&
      canContinue &&
      !openedFromOnboardingTab
    );
  }, [
    canContinue,
    isAdminReviewMode,
    openedFromOnboardingTab,
    state.skipAutoFinalize,
  ]);

  const finalizeVerifiedSession = async (opts?: { replace?: boolean }) => {
    const replace = opts?.replace ?? true;
    const targetPath = buildStepUrl("/supplier/onboarding");

    if (journeyKey) {
      writeJourneyState(journeyKey, {
        contactVerified: canContinue,
        reachedBusiness: true,
      });
      setJourneyState(readJourneyState(journeyKey));
    }

    if (isAdminReviewMode) {
      nav(targetPath, {
        replace,
        state: makeStepState(targetPath, {
          fromVerifyContact: true,
          fromBusinessDetails: true,
        }),
      });
      return;
    }

    if (hasAutoFinalizedRef.current) return;
    hasAutoFinalizedRef.current = true;

    try {
      setErr(null);
      setFinalizingSession(true);

      try {
        await hydrateAuthStoreFromSession();
        clearTempToken();
        nav(targetPath, {
          replace,
          state: makeStepState(targetPath, {
            fromVerifyContact: true,
            fromBusinessDetails: true,
          }),
        });
        return;
      } catch {
        // no normal session yet
      }

      const tempToken = getTempToken();

      if (!tempToken) {
        const snapshot = await loadStatus();

        if (snapshot?.emailVerified && snapshot?.phoneVerified) {
          try {
            await hydrateAuthStoreFromSession();
            nav(targetPath, {
              replace,
              state: makeStepState(targetPath, {
                fromVerifyContact: true,
                fromBusinessDetails: true,
              }),
            });
            return;
          } catch {
            // fall through
          }
        }

        hasAutoFinalizedRef.current = false;
        setErr("Verification session expired. Please log in to continue.");
        return;
      }

      await api.post(
        "/api/auth/complete-verified-login",
        {},
        {
          withCredentials: true,
          headers: {
            Authorization: `Bearer ${tempToken}`,
          },
        }
      );

      clearTempToken();
      await hydrateAuthStoreFromSession();

      nav(targetPath, {
        replace,
        state: makeStepState(targetPath, {
          fromVerifyContact: true,
          fromBusinessDetails: true,
        }),
      });
    } catch (e: any) {
      hasAutoFinalizedRef.current = false;
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Your details were verified, but we could not finish signing you in automatically. Please try again."
      );
    } finally {
      setFinalizingSession(false);
    }
  };

  useEffect(() => {
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadingSummary) {
      void loadStatus();
    }
  }, [loadingSummary, email, isAdminReviewMode, adminSupplierId, loadStatus]);

  useEffect(() => {
    if (shouldAutoFinalize) {
      void finalizeVerifiedSession({ replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoFinalize]);

  const resendEmail = async () => {
    if (isAdminReviewMode) return;

    try {
      setErr(null);
      setBusyEmail(true);

      const activeEmail = email || summary?.contactEmail || "";
      if (!activeEmail) {
        setErr("No email found for verification.");
        return;
      }

      await api.post(
        "/api/auth/resend-verification",
        { email: activeEmail },
        getVerifyConfig()
      );

      setEmailSent(true);
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not resend email verification."
      );
    } finally {
      setBusyEmail(false);
    }
  };

  const resendPhoneOtp = async () => {
    if (isAdminReviewMode) return;
    if (phoneVerifiedEffective || canContinue || finalizingSession) return;

    const tempToken = getTempToken();
    if (!tempToken) {
      const snapshot = await loadStatus();

      if (snapshot?.phoneVerified) {
        setPhoneVerified(true);
        setErr(null);
        return;
      }

      setErr("Your verification session expired. Please sign in again to resend the code.");
      return;
    }

    try {
      setErr(null);
      setOtpError(null);
      setBusyPhone(true);

      const activePhone = phone || summary?.contactPhone || "";
      const activeDialCode =
        normalizeDialCode(dialCode) ||
        normalizeDialCode(summary?.contactDialCode) ||
        normalizeDialCode(state.dialCode);

      await api.post(
        "/api/auth/resend-otp",
        {
          phone: activePhone,
          contactPhone: activePhone,
          dialCode: activeDialCode,
          contactDialCode: activeDialCode,
        },
        {
          withCredentials: true,
          headers: {
            Authorization: `Bearer ${tempToken}`,
          },
        }
      );

      setPhoneOtpSent(true);
    } catch (e: any) {
      const status = e?.response?.status;
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Could not send phone verification code.";

      if (status === 401) {
        const snapshot = await loadStatus();

        if (snapshot?.phoneVerified) {
          setPhoneVerified(true);
          setErr(null);
          return;
        }

        setErr("Your verification session expired. Please sign in again to resend the code.");
        return;
      }

      setErr(msg);
    } finally {
      setBusyPhone(false);
    }
  };

  useEffect(() => {
    if (
      isAdminReviewMode ||
      loadingSummary ||
      hasAutoRequestedOtpRef.current ||
      phoneVerifiedEffective ||
      phoneOtpSent ||
      finalizingSession ||
      !(phone || summary?.contactPhone) ||
      !hasVerifySession
    ) {
      return;
    }

    hasAutoRequestedOtpRef.current = true;
    void resendPhoneOtp();
  }, [
    isAdminReviewMode,
    loadingSummary,
    phoneVerifiedEffective,
    phoneOtpSent,
    phone,
    summary?.contactPhone,
    finalizingSession,
    hasVerifySession,
  ]);

  const verifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isAdminReviewMode) return;
    if (phoneVerifiedEffective || canContinue || finalizingSession) return;

    if (!otp.trim()) {
      setOtpError("Please enter the verification code sent to your phone.");
      setErr(null);
      return;
    }

    const tempToken = getTempToken();
    if (!tempToken) {
      const snapshot = await loadStatus();

      if (snapshot?.phoneVerified) {
        setPhoneVerified(true);
        setOtp("");
        setOtpError(null);
        setErr(null);
        return;
      }

      setOtpError("Your verification session expired. Please sign in again.");
      setErr(null);
      return;
    }

    try {
      setErr(null);
      setOtpError(null);
      setBusyVerifyOtp(true);

      await api.post(
        "/api/auth/verify-otp",
        {
          otp: otp.trim(),
        },
        {
          withCredentials: true,
          headers: {
            Authorization: `Bearer ${tempToken}`,
          },
        }
      );

      setPhoneVerified(true);
      setOtp("");
      setOtpError(null);

      const snapshot = await loadStatus();

      if (snapshot?.phoneVerified) {
        setPhoneVerified(true);
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Invalid or expired phone verification code.";

      if (/phone already verified/i.test(msg)) {
        setPhoneVerified(true);
        setErr(null);
        setOtpError(null);
        setOtp("");
        return;
      }

      if (status === 401) {
        const snapshot = await loadStatus();

        if (snapshot?.phoneVerified) {
          setPhoneVerified(true);
          setErr(null);
          setOtpError(null);
          setOtp("");
          return;
        }

        setOtpError(
          "Your verification session expired. Refresh status or sign in again if needed."
        );
        setErr(null);
        return;
      }

      setOtpError(msg);
      setErr(null);
    } finally {
      setBusyVerifyOtp(false);
    }
  };

  const continueToOnboarding = async () => {
    if (!canContinue) return;
    await finalizeVerifiedSession({ replace: true });
  };

  const goToBusinessDetails = async () => {
    if (!businessDetailsAccessible || finalizingSession) return;

    if (canContinue) {
      await finalizeVerifiedSession({ replace: true });
      return;
    }

    pushStep("/supplier/onboarding", {
      fromVerifyContact: true,
      fromBusinessDetails: true,
    });
  };

  const stepBase =
    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm transition";
  const stepDone = "border-emerald-200 bg-emerald-50 text-emerald-700";
  const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
  const stepLocked = "border-zinc-100 bg-zinc-50 text-zinc-400";

  const card =
    "rounded-[28px] border border-white/70 bg-white/95 backdrop-blur shadow-[0_16px_50px_rgba(15,23,42,0.08)] p-4 sm:p-6 md:p-8";
  const panel =
    "rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm";
  const button =
    "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed";
  const primaryBtn = `${button} bg-zinc-900 text-white hover:bg-black`;
  const secondaryBtn = `${button} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`;
  const input =
    "w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] md:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";

  const otpInputClass = otpError
    ? `${input} border-rose-400 bg-rose-50/40 focus:border-rose-500 focus:ring-rose-200`
    : input;

  const continueButtonLabel = "Continue to business details";

  const steps = [
    {
      step: 1,
      label: "Register",
      active: false,
      done: true,
      accessible: false,
      onClick: undefined as (() => void) | undefined,
    },
    {
      step: 2,
      label: "Verify email / phone",
      active: true,
      done: canContinue,
      accessible: true,
      onClick: undefined as (() => void) | undefined,
    },
    {
      step: 3,
      label: "Business details",
      active: false,
      done: businessDetailsDone || reachedBusinessEffective,
      accessible: businessDetailsAccessible,
      onClick: () => {
        void goToBusinessDetails();
      },
    },
    {
      step: 4,
      label: "Address details",
      active: false,
      done: addressDone,
      accessible: false,
      onClick: undefined as (() => void) | undefined,
    },
    {
      step: 5,
      label: "Documents",
      active: false,
      done: documentsDone,
      accessible: documentsAccessible,
      onClick: undefined as (() => void) | undefined,
    },
    {
      step: 6,
      label: "Dashboard access",
      active: false,
      done: false,
      accessible: false,
      onClick: undefined as (() => void) | undefined,
    },
  ];

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
        <div className="px-3 py-6 sm:px-4 sm:py-10">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <div className="space-y-4">
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">
                  Verify your contact details
                </h1>
                <p className="mt-2 text-sm text-zinc-600">
                  {isAdminReviewMode
                    ? "Review the supplier’s email and phone verification status before continuing."
                    : "Complete email and phone verification before continuing to business details."}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {steps.map((item) => {
                  const stateClass = item.active
                    ? stepActive
                    : item.accessible
                    ? stepDone
                    : item.done
                    ? stepDone
                    : stepLocked;

                  const clickable =
                    item.step === 3 &&
                    !item.active &&
                    !!item.onClick &&
                    item.accessible;

                  return (
                    <button
                      key={item.step}
                      type="button"
                      onClick={clickable ? item.onClick : undefined}
                      disabled={!clickable || finalizingSession}
                      className={`${stepBase} ${stateClass} ${
                        clickable && !finalizingSession
                          ? "cursor-pointer"
                          : item.active
                          ? "cursor-default"
                          : "cursor-not-allowed"
                      }`}
                    >
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                        {item.step}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isAdminReviewMode && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Admin review mode is active. This page will not send codes or
                auto-complete login.
              </div>
            )}

            {!isAdminReviewMode && !hasVerifySession && !canContinue && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Your verification session expired. Please sign in again to continue.
              </div>
            )}

            {err && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {err}
              </div>
            )}

            <div className={`${card} space-y-5`}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className={panel}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-zinc-100 p-3">
                      <Mail className="h-5 w-5 text-zinc-700" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-zinc-900">
                            Email verification
                          </h2>
                          <p className="mt-1 break-all text-sm text-zinc-600">
                            {email ? maskEmail(email) : "No email found"}
                          </p>
                        </div>

                        <div
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            emailVerifiedEffective
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {emailVerifiedEffective ? "Verified" : "Pending"}
                        </div>
                      </div>

                      {!emailVerifiedEffective && !isAdminReviewMode && (
                        <p className="mt-4 text-sm text-zinc-600">
                          Open the verification link sent to your inbox, then
                          return here and refresh your status.
                        </p>
                      )}

                      {!emailVerifiedEffective && isAdminReviewMode && (
                        <p className="mt-4 text-sm text-zinc-600">
                          This supplier’s email is not verified yet.
                        </p>
                      )}

                      {!emailVerifiedEffective && !isAdminReviewMode && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={resendEmail}
                            disabled={busyEmail || !hasVerifySession}
                            className={secondaryBtn}
                          >
                            {busyEmail
                              ? "Sending…"
                              : emailSent
                              ? "Resend email"
                              : "Send email"}
                          </button>

                          <button
                            type="button"
                            onClick={() => void loadStatus()}
                            disabled={checking}
                            className={secondaryBtn}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {checking ? "Checking…" : "Refresh status"}
                          </button>
                        </div>
                      )}

                      {!emailVerifiedEffective && isAdminReviewMode && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void loadStatus()}
                            disabled={checking}
                            className={secondaryBtn}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {checking ? "Checking…" : "Refresh status"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className={panel}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-zinc-100 p-3">
                      <Phone className="h-5 w-5 text-zinc-700" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-zinc-900">
                            Phone verification
                          </h2>
                          <p className="mt-1 text-sm text-zinc-600">
                            {phone ? maskPhone(phone) : "No phone found"}
                          </p>
                        </div>

                        <div
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            phoneVerifiedEffective
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {phoneVerifiedEffective ? "Verified" : "Pending"}
                        </div>
                      </div>

                      {!phoneVerifiedEffective && !isAdminReviewMode && (
                        <p className="mt-4 text-sm text-zinc-600">
                          Enter the OTP sent to your phone or WhatsApp number.
                        </p>
                      )}

                      {!phoneVerifiedEffective && isAdminReviewMode && (
                        <p className="mt-4 text-sm text-zinc-600">
                          This supplier’s phone is not verified yet.
                        </p>
                      )}

                      {!isAdminReviewMode ? (
                        <form onSubmit={verifyPhoneOtp} className="mt-4 space-y-3">
                          {!phoneVerifiedEffective && !finalizingSession && (
                            <>
                              <input
                                value={otp}
                                onChange={(e) => {
                                  setOtp(e.target.value);
                                  setErr(null);
                                  setOtpError(null);
                                }}
                                className={otpInputClass}
                                placeholder="Enter verification code"
                                inputMode="numeric"
                                disabled={!hasVerifySession}
                              />
                              {otpError && (
                                <p className="text-xs text-rose-600">
                                  {otpError}
                                </p>
                              )}
                            </>
                          )}

                          {!phoneVerifiedEffective && !finalizingSession && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="submit"
                                disabled={busyVerifyOtp || !hasVerifySession}
                                className={primaryBtn}
                              >
                                {busyVerifyOtp ? "Verifying…" : "Verify phone"}
                              </button>

                              <button
                                type="button"
                                onClick={() => void resendPhoneOtp()}
                                disabled={busyPhone || !hasVerifySession}
                                className={secondaryBtn}
                              >
                                {busyPhone
                                  ? "Sending…"
                                  : phoneOtpSent
                                  ? "Resend code"
                                  : "Send code"}
                              </button>
                            </div>
                          )}
                        </form>
                      ) : (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void loadStatus()}
                            disabled={checking}
                            className={secondaryBtn}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {checking ? "Checking…" : "Refresh status"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900">
                      Continue to business details
                    </h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      {isAdminReviewMode
                        ? "Move to the next onboarding step for this supplier once both contact methods are verified."
                        : "Once verified, sign in the supplier and continue to onboarding."}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void continueToOnboarding()}
                    disabled={!canContinue || finalizingSession}
                    className={`${primaryBtn} min-w-[240px]`}
                  >
                    {finalizingSession
                      ? "Finishing setup…"
                      : continueButtonLabel}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className={card}>
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-xl bg-zinc-100 p-3">
                  <Building2 className="h-5 w-5 text-zinc-700" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">
                    Registration details
                  </h2>
                  <p className="text-sm text-zinc-600">
                    Reloaded from your supplier account details.
                  </p>
                </div>
              </div>

              {loadingSummary ? (
                <div className="text-sm text-zinc-500">
                  Loading registration details…
                </div>
              ) : summary ? (
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Store name</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {summary.businessName || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">{legalEntityLabel}</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {summary.legalName || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <User className="h-4 w-4" />
                      Primary contact
                    </div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {[summary.contactFirstName, summary.contactLastName]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Registration type</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {registrationTypeLabel(summary.registrationType)}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Contact email</div>
                    <div className="mt-1 break-all font-medium text-zinc-900">
                      {summary.contactEmail || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Contact phone</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {summary.contactPhone || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 md:col-span-2">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <Globe className="h-4 w-4" />
                      Registration country
                    </div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {countryLabel(summary.registrationCountryCode)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-zinc-500">
                  Registration details are not available yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}