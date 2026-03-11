import React, { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth";
import api from "../api/client";

type Props = {
  children: React.ReactNode;

  /**
   * Allowed roles (normalized comparison).
   * Accepts aliases like ["SUPER_ADMIN", "SUPERADMIN"].
   * If omitted, any authenticated user can access.
   */
  roles?: string[];

  /**
   * For supplier rider: allow only certain route prefixes even if rider is included in roles.
   * Example: ["/supplier/orders"]
   */
  riderAllowPrefixes?: string[];
};

type AuthMeLite = {
  id?: string;
  role?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

type SupplierMeLite = {
  id?: string;
  supplierId?: string;
  legalName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
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

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");

  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  if (r === "SUPERUSER") r = "SUPER_USER";

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

export default function ProtectedRoute({
  children,
  roles,
  riderAllowPrefixes,
}: Props) {
  const location = useLocation();

  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) return <>{children}</>;

  const isAuthed = !!user?.id;

  if (!isAuthed) {
    const from = `${location.pathname}${location.search}`;
    const qp = encodeURIComponent(from);

    try {
      sessionStorage.setItem("auth:returnTo", from);
    } catch {}

    return <Navigate to={`/login?from=${qp}`} replace state={{ from }} />;
  }

  const userRole = normRole(user?.role);

  if (
    userRole === normRole("SUPPLIER_RIDER") &&
    Array.isArray(riderAllowPrefixes) &&
    riderAllowPrefixes.length > 0
  ) {
    const ok = riderAllowPrefixes.some((p) => location.pathname.startsWith(p));
    if (!ok) return <Navigate to="/supplier/orders" replace />;
  }

  if (userRole === "SUPER_ADMIN") {
    return <>{children}</>;
  }

  const allowedSet = useMemo(() => {
    const arr = Array.isArray(roles) ? roles : [];
    return new Set(arr.map(normRole).filter(Boolean));
  }, [roles]);

  if (allowedSet.size > 0 && !allowedSet.has(userRole)) {
    return <Navigate to="/" replace />;
  }

  const supplierOnboardingQ = useQuery({
    queryKey: ["protected-route", "supplier-onboarding"],
    enabled: userRole === "SUPPLIER",
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
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

      const onboardingDone = contactDone && businessDone && addressDone && docsDone;

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
        contactDone,
        businessDone,
        addressDone,
        docsDone,
        onboardingDone,
        nextPath,
      };
    },
  });

  if (userRole === "SUPPLIER") {
    if (supplierOnboardingQ.isLoading) {
      return (
        <div className="min-h-[40vh] flex items-center justify-center px-4">
          <div className="text-sm text-zinc-500">Checking supplier access…</div>
        </div>
      );
    }

    const onboarding = supplierOnboardingQ.data;
    const onboardingDone = !!onboarding?.onboardingDone;

    if (!onboardingDone) {
      const path = location.pathname;

      const allowedWhileOnboarding = [
        "/supplier",
        "/dashboard",
        "/supplier/verify-contact",
        "/supplier/onboarding",
        "/supplier/onboarding/address",
        "/supplier/onboarding/documents",
        "/account/sessions",
        "/profile",
      ];

      const isAllowed = allowedWhileOnboarding.some((p) => path === p || path.startsWith(`${p}/`));

      if (!isAllowed) {
        return <Navigate to={onboarding?.nextPath || "/supplier/verify-contact"} replace />;
      }
    }
  }

  return <>{children}</>;
}