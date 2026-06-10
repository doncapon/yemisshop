import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/client";
import { useAuthStore } from "../store/auth";
import { normRole } from "../lib/roles";

/* ── Types ────────────────────────────────────────────────────────── */

export type SupplierDocKind =
  | "BUSINESS_REGISTRATION_CERTIFICATE"
  | "GOVERNMENT_ID"
  | "PROOF_OF_ADDRESS";

export type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

export type SupplierMeLite = {
  legalName?: string | null;
  name?: string | null;
  businessName?: string | null;
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

type AuthMeLite = {
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

export type SupplierStageState = {
  loading: boolean;
  contactDone: boolean;
  businessDone: boolean;
  addressDone: boolean;
  docsDone: boolean;
  onboardingDone: boolean;
  nextPath: string | null;
};

export type SupplierStep =
  | "verify"
  | "business"
  | "address"
  | "documents"
  | "dashboard";

/* ── Helpers ───────────────────────────────────────────────────────── */

function hasAddress(addr: any) {
  if (!addr) return false;
  return Boolean(
    String(addr.houseNumber ?? "").trim() ||
      String(addr.streetName ?? "").trim() ||
      String(addr.city ?? "").trim() ||
      String(addr.state ?? "").trim() ||
      String(addr.country ?? "").trim() ||
      String(addr.postCode ?? "").trim(),
  );
}

function isRegisteredBusiness(registrationType?: string | null) {
  return (
    String(registrationType ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS"
  );
}

function docSatisfied(docs: SupplierDocumentLite[], kind: SupplierDocKind) {
  return docs.some((d) => {
    const k = String(d.kind ?? "").trim().toUpperCase();
    const s = String(d.status ?? "").trim().toUpperCase();
    return k === kind && (s === "PENDING" || s === "APPROVED");
  });
}

function isSupplierEffectivelyApproved(supplier?: SupplierMeLite | null) {
  const status = String(supplier?.status ?? "").trim().toUpperCase();
  const kycStatus = String(supplier?.kycStatus ?? "").trim().toUpperCase();
  const approvedStates = new Set([
    "APPROVED",
    "ACTIVE",
    "VERIFIED",
    "COMPLETED",
    "ENABLED",
  ]);
  return approvedStates.has(status) || approvedStates.has(kycStatus);
}

export function getSupplierNextPath(stage: {
  contactDone: boolean;
  businessDone: boolean;
  addressDone: boolean;
  docsDone: boolean;
}) {
  if (!stage.contactDone) return "/supplier/verify-contact";
  if (!stage.businessDone) return "/supplier/onboarding";
  if (!stage.addressDone) return "/supplier/onboarding/address";
  if (!stage.docsDone) return "/supplier/onboarding/documents";
  return null;
}

function normalizeSupplierDocsLite(raw: unknown): SupplierDocumentLite[] {
  const source = raw as
    | {
        data?: { data?: SupplierDocumentLite[]; documents?: SupplierDocumentLite[] } | SupplierDocumentLite[];
        documents?: SupplierDocumentLite[];
      }
    | SupplierDocumentLite[]
    | null;

  const candidates: unknown[] = [
    source && typeof source === "object" && "data" in source
      ? (source as { data?: unknown }).data &&
        typeof (source as { data?: unknown }).data === "object" &&
        (source as { data?: { data?: SupplierDocumentLite[] } }).data?.data
      : undefined,
    source && typeof source === "object" && "data" in source
      ? (source as { data?: { documents?: SupplierDocumentLite[] } }).data?.documents
      : undefined,
    source && typeof source === "object" && "data" in source
      ? (source as { data?: unknown }).data
      : undefined,
    source && typeof source === "object" && "documents" in source
      ? (source as { documents?: SupplierDocumentLite[] }).documents
      : undefined,
    source,
  ];

  for (const item of candidates) {
    if (Array.isArray(item)) return item as SupplierDocumentLite[];
  }
  return [];
}

/* ── Context ───────────────────────────────────────────────────────── */

export const SupplierStageContext = createContext<SupplierStageState | null>(null);

export function useSupplierStage(): SupplierStageState {
  const ctx = useContext(SupplierStageContext);
  if (!ctx) {
    return {
      loading: false,
      contactDone: true,
      businessDone: true,
      addressDone: true,
      docsDone: true,
      onboardingDone: true,
      nextPath: null,
    };
  }
  return ctx;
}

/* ── Hook ──────────────────────────────────────────────────────────── */

function useSupplierStageState(): SupplierStageState {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  const [state, setState] = useState<SupplierStageState>({
    loading: true,
    contactDone: false,
    businessDone: false,
    addressDone: false,
    docsDone: false,
    onboardingDone: false,
    nextPath: null,
  });

  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (!hydrated) return;

      const role = normRole(user?.role);

      if (!user?.id || role !== "SUPPLIER") {
        if (!alive) return;
        setState({
          loading: false,
          contactDone: true,
          businessDone: true,
          addressDone: true,
          docsDone: true,
          onboardingDone: true,
          nextPath: null,
        });
        return;
      }

      try {
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

        const docs = normalizeSupplierDocsLite((docsRes as any)?.data);
        const supplierApproved = isSupplierEffectivelyApproved(supplierMe);

        const contactDone =
          supplierApproved || (!!authMe?.emailVerified && !!authMe?.phoneVerified);

        const businessDone =
          supplierApproved ||
          Boolean(
            String(
              supplierMe?.legalName ?? supplierMe?.businessName ?? supplierMe?.name ?? "",
            ).trim() &&
              String(supplierMe?.registrationType ?? "").trim() &&
              String(supplierMe?.registrationCountryCode ?? "").trim(),
          );

        const addressDone =
          supplierApproved ||
          hasAddress(supplierMe?.registeredAddress) ||
          hasAddress(supplierMe?.pickupAddress);

        const requiredKinds: SupplierDocKind[] = [
          ...(isRegisteredBusiness(supplierMe?.registrationType)
            ? (["BUSINESS_REGISTRATION_CERTIFICATE"] as SupplierDocKind[])
            : []),
          "GOVERNMENT_ID",
          "PROOF_OF_ADDRESS",
        ];

        const docsDone =
          supplierApproved || requiredKinds.every((kind) => docSatisfied(docs, kind));

        const nextPath =
          supplierApproved || (contactDone && businessDone && addressDone && docsDone)
            ? null
            : getSupplierNextPath({ contactDone, businessDone, addressDone, docsDone });

        if (!alive) return;

        setState({
          loading: false,
          contactDone,
          businessDone,
          addressDone,
          docsDone,
          onboardingDone:
            supplierApproved || (contactDone && businessDone && addressDone && docsDone),
          nextPath,
        });
      } catch {
        if (!alive) return;
        setState({
          loading: false,
          contactDone: false,
          businessDone: false,
          addressDone: false,
          docsDone: false,
          onboardingDone: false,
          nextPath: "/supplier/verify-contact",
        });
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [hydrated, user?.id, user?.role]);

  return state;
}

/* ── Provider ──────────────────────────────────────────────────────── */

export function SupplierStageProvider({ children }: { children: React.ReactNode }) {
  const stage = useSupplierStageState();
  return (
    <SupplierStageContext.Provider value={stage}>
      {children}
    </SupplierStageContext.Provider>
  );
}
