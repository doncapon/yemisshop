export type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

export type AuthMeLite = {
  id?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
};

export type SupplierMeLite = {
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

export type VerificationProgressItem = {
  key: "contact" | "business" | "address" | "documents";
  label: string;
  done: boolean;
};

export type SupplierVerificationGate = {
  contactDone: boolean;
  businessDone: boolean;
  addressDone: boolean;
  docsDone: boolean;
  onboardingDone: boolean;

  supplierStatus: string;
  kycStatus: string;

  requiredKinds: string[];
  requiredDocStates: Array<{
    kind: string;
    status: "MISSING" | "PENDING" | "APPROVED" | "REJECTED";
  }>;

  hasPendingRequiredDoc: boolean;
  hasRejectedRequiredDoc: boolean;
  needsReverification: boolean;

  isLocked: boolean;
  lockReason: string | null;
  nextPath: string;

  progressItems: VerificationProgressItem[];
};

function pickString(v: unknown) {
  return String(v ?? "").trim();
}

function normStatus(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function isTruthyVerificationFlag(value: unknown) {
  if (value === true) return true;
  if (typeof value === "string" && value.trim()) return true;
  return false;
}

function isEmailVerified(authMe?: AuthMeLite | null) {
  return (
    isTruthyVerificationFlag(authMe?.emailVerified) ||
    isTruthyVerificationFlag(authMe?.emailVerifiedAt)
  );
}

function isPhoneVerified(authMe?: AuthMeLite | null) {
  return (
    isTruthyVerificationFlag(authMe?.phoneVerified) ||
    isTruthyVerificationFlag(authMe?.phoneVerifiedAt)
  );
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

function pickBestDocStatus(docs: SupplierDocumentLite[], kind: string) {
  const matches = docs.filter(
    (d) => normStatus(d.kind) === normStatus(kind)
  );

  if (!matches.length) return "MISSING" as const;

  const statuses = matches.map((d) => normStatus(d.status));

  if (statuses.includes("PENDING")) return "PENDING" as const;
  if (statuses.includes("REJECTED")) return "REJECTED" as const;
  if (statuses.includes("APPROVED")) return "APPROVED" as const;

  return "MISSING" as const;
}

export function evaluateSupplierVerificationGate(args: {
  authMe?: AuthMeLite | null;
  supplierMe?: SupplierMeLite | null;
  docs?: SupplierDocumentLite[] | null;
}): SupplierVerificationGate {
  const authMe = args.authMe ?? {};
  const supplierMe = args.supplierMe ?? {};
  const docs = Array.isArray(args.docs) ? args.docs : [];

  const supplierStatus = normStatus(supplierMe.status) || "PENDING";
  const kycStatus = normStatus(supplierMe.kycStatus) || "PENDING";

  const contactDone = isEmailVerified(authMe) && isPhoneVerified(authMe);

  const businessDone = Boolean(
    pickString(supplierMe.legalName) &&
      pickString(supplierMe.registrationType) &&
      pickString(supplierMe.registrationCountryCode)
  );

  const addressDone =
    hasAddress(supplierMe.registeredAddress) || hasAddress(supplierMe.pickupAddress);

  const requiredKinds = [
    ...(isRegisteredBusiness(supplierMe.registrationType)
      ? ["BUSINESS_REGISTRATION_CERTIFICATE"]
      : []),
    "GOVERNMENT_ID",
    "PROOF_OF_ADDRESS",
  ];

  const requiredDocStates = requiredKinds.map((kind) => ({
    kind,
    status: pickBestDocStatus(docs, kind),
  }));

  const hasPendingRequiredDoc = requiredDocStates.some((d) => d.status === "PENDING");
  const hasRejectedRequiredDoc = requiredDocStates.some((d) => d.status === "REJECTED");
  const hasMissingRequiredDoc = requiredDocStates.some((d) => d.status === "MISSING");

  // Important:
  // Docs are done ONLY when every required doc is approved.
  // Pending after resubmission must lock again.
  const docsDone = requiredDocStates.every((d) => d.status === "APPROVED");

  const onboardingDone = contactDone && businessDone && addressDone && docsDone;

  const needsReverification =
    !docsDone &&
    (supplierStatus === "APPROVED" ||
      supplierStatus === "ACTIVE" ||
      kycStatus === "APPROVED" ||
      kycStatus === "ACTIVE");

  let nextPath = "/supplier/verify-contact";
  if (!contactDone) nextPath = "/supplier/verify-contact";
  else if (!businessDone) nextPath = "/supplier/onboarding";
  else if (!addressDone) nextPath = "/supplier/onboarding/address";
  else nextPath = "/supplier/onboarding/documents";

  let lockReason: string | null = null;

  if (!contactDone) {
    lockReason = "Verify your email and phone to continue.";
  } else if (!businessDone) {
    lockReason = "Complete your business details to continue.";
  } else if (!addressDone) {
    lockReason = "Complete your address details to continue.";
  } else if (hasPendingRequiredDoc) {
    lockReason = "Your documents are under review. Editing is locked until re-verification is complete.";
  } else if (hasRejectedRequiredDoc) {
    lockReason = "Some required documents were rejected. Re-upload them to continue.";
  } else if (hasMissingRequiredDoc) {
    lockReason = "Upload all required documents to continue.";
  }

  return {
    contactDone,
    businessDone,
    addressDone,
    docsDone,
    onboardingDone,

    supplierStatus,
    kycStatus,

    requiredKinds,
    requiredDocStates,

    hasPendingRequiredDoc,
    hasRejectedRequiredDoc,
    needsReverification,

    isLocked: !onboardingDone,
    lockReason,
    nextPath,

    progressItems: [
      { key: "contact", label: "Contact verified", done: contactDone },
      { key: "business", label: "Business details", done: businessDone },
      { key: "address", label: "Address details", done: addressDone },
      { key: "documents", label: needsReverification ? "Re-verification" : "Documents approved", done: docsDone },
    ],
  };
}