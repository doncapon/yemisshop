import React, { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth";
import api from "../api/client";

type Props = {
  children: React.ReactNode;
  roles?: string[];
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
  legalName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
  registeredAddress?: any;
  pickupAddress?: any;
};

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
    addr.houseNumber ||
    addr.streetName ||
    addr.city ||
    addr.state ||
    addr.country ||
    addr.postCode
  );
}

function isRegisteredBusiness(registrationType?: string | null) {
  return String(registrationType ?? "").toUpperCase() === "REGISTERED_BUSINESS";
}

function docSatisfied(docs: SupplierDocumentLite[], kind: string) {
  return docs.some((d) => {
    const k = String(d.kind ?? "").toUpperCase();
    const s = String(d.status ?? "").toUpperCase();
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

  const userRole = normRole(user?.role);

  /* ✅ CRITICAL FIX: wait for auth properly */
  if (!hydrated || user === undefined) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="text-sm text-zinc-500">Loading session...</div>
      </div>
    );
  }

  const isAuthed = !!user?.id;

  /* 🔐 Not authenticated */
  if (!isAuthed) {
    const from = `${location.pathname}${location.search}`;
    const qp = encodeURIComponent(from);

    try {
      sessionStorage.setItem("auth:returnTo", from);
    } catch { }

    return <Navigate to={`/login?from=${qp}`} replace />;
  }

  /* 🚴 Rider restriction */
  if (
    userRole === "SUPPLIER_RIDER" &&
    riderAllowPrefixes?.length
  ) {
    const ok = riderAllowPrefixes.some((p) =>
      location.pathname.startsWith(p)
    );
    if (!ok) return <Navigate to="/supplier/orders" replace />;
  }

  /* 👑 Super admin bypass */
  if (userRole === "SUPER_ADMIN") return <>{children}</>;

  /* 🎯 Role check */
  const allowedSet = useMemo(() => {
    return new Set((roles || []).map(normRole));
  }, [roles]);

  if (allowedSet.size > 0 && !allowedSet.has(userRole)) {
    return <Navigate to="/" replace />;
  }

  /* 🧠 Supplier onboarding check */
  const supplierOnboardingQ = useQuery({
    queryKey: ["supplier-onboarding"],
    enabled: userRole === "SUPPLIER",
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const [authRes, supplierRes, docsRes] = await Promise.all([
        api.get("/api/auth/me", { withCredentials: true }),
        api.get("/api/supplier/me", { withCredentials: true }),
        api
          .get("/api/supplier/documents", { withCredentials: true })
          .catch(() => ({ data: { data: [] } })),
      ]);

      const authMe = authRes.data?.data ?? {};
      const supplierMe = supplierRes.data?.data ?? {};
      const docs = docsRes.data?.data ?? [];

      const contactDone = !!authMe.emailVerified && !!authMe.phoneVerified;

      const businessDone = Boolean(
        supplierMe.legalName &&
        supplierMe.registrationType &&
        supplierMe.registrationCountryCode
      );

      const addressDone =
        hasAddress(supplierMe.registeredAddress) ||
        hasAddress(supplierMe.pickupAddress);

      const requiredKinds = [
        ...(isRegisteredBusiness(supplierMe.registrationType)
          ? ["BUSINESS_REGISTRATION_CERTIFICATE"]
          : []),
        "GOVERNMENT_ID",
        "PROOF_OF_ADDRESS",
      ];

      const docsDone = requiredKinds.every((k) =>
        docSatisfied(docs, k)
      );

      const onboardingDone =
        contactDone && businessDone && addressDone && docsDone;

      const nextPath = !contactDone
        ? "/supplier/verify-contact"
        : !businessDone
          ? "/supplier/onboarding"
          : !addressDone
            ? "/supplier/onboarding/address"
            : !docsDone
              ? "/supplier/onboarding/documents"
              : "/supplier";

      return { onboardingDone, nextPath };
    },
  });

  /* 🔥 CRITICAL FIX: do NOT redirect while loading */
  if (userRole === "SUPPLIER" && supplierOnboardingQ.isLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="text-sm text-zinc-500">
          Preparing supplier dashboard...
        </div>
      </div>
    );
  }

  if (userRole === "SUPPLIER") {
    const onboarding = supplierOnboardingQ.data;

    if (!onboarding?.onboardingDone) {
      const path = location.pathname;

      const allowed = [
        "/supplier",
        "/supplier/verify-contact",
        "/supplier/onboarding",
        "/supplier/onboarding/address",
        "/supplier/onboarding/documents",
      ];

      const isAllowed = allowed.some((p) =>
        path.startsWith(p)
      );

      if (!isAllowed) {
        return <Navigate to={onboarding?.nextPath || "/supplier/verify-contact"} replace />;
      }
    }
  }

  return <>{children}</>;
}