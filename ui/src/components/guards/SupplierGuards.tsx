import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/auth";
import { normRole, hasTempVerifySession } from "../../lib/roles";
import {
  useSupplierStage,
  type SupplierStageState,
  type SupplierStep,
} from "../../supplier/stage";
import RouteFallback from "../RouteFallback";
import {
  SupplierVerifyContact,
  SupplierDashboard,
  SupplierOrdersPage,
  SupplierRiders,
} from "../../routes/lazy";

/* ── Layout shell ──────────────────────────────────────────────────── */

export function SupplierLayoutShell() {
  return <Outlet />;
}

/* ── Verify-contact guard ──────────────────────────────────────────── */

export function SupplierVerifyContactRouteGuard() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!hydrated) return <RouteFallback label="Loading verification…" />;

  if (user?.id) return <SupplierVerifyContact />;

  if (hasTempVerifySession()) return <SupplierVerifyContact />;

  return (
    <Navigate
      to={`/login?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
      replace
      state={{ from: `${location.pathname}${location.search}` }}
    />
  );
}

/* ── Sequential step guard ─────────────────────────────────────────── */

function getRequiredPathForStep(step: SupplierStep, stage: SupplierStageState) {
  switch (step) {
    case "verify":
      return "/supplier/verify-contact";
    case "business":
      return stage.contactDone ? "/supplier/onboarding" : "/supplier/verify-contact";
    case "address":
      if (!stage.contactDone) return "/supplier/verify-contact";
      if (!stage.businessDone) return "/supplier/onboarding";
      return "/supplier/onboarding/address";
    case "documents":
      if (!stage.contactDone) return "/supplier/verify-contact";
      if (!stage.businessDone) return "/supplier/onboarding";
      if (!stage.addressDone) return "/supplier/onboarding/address";
      return "/supplier/onboarding/documents";
    case "dashboard":
      return stage.nextPath || "/supplier";
    default:
      return stage.nextPath || "/supplier";
  }
}

export function SupplierSequentialStepGuard({
  step,
  children,
}: {
  step: SupplierStep;
  children: React.ReactNode;
}) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const stage = useSupplierStage();
  const location = useLocation();

  const role = normRole(user?.role);

  if (!hydrated) return <RouteFallback label="Loading supplier onboarding…" />;

  if (!user?.id) {
    return (
      <Navigate
        to={`/login?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (role !== "SUPPLIER") return <>{children}</>;

  if (stage.loading) return <RouteFallback label="Loading supplier onboarding…" />;

  const requiredPath = getRequiredPathForStep(step, stage);
  if (requiredPath !== location.pathname) {
    return <Navigate to={requiredPath} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

/* ── Restricted page guard ─────────────────────────────────────────── */

export function SupplierRestrictedPageGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const location = useLocation();
  const stage = useSupplierStage();

  const role = normRole(user?.role);

  if (!hydrated) return <RouteFallback label="Loading supplier access…" />;

  if (!user?.id) {
    return (
      <Navigate
        to={`/login?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (role !== "SUPPLIER") return <>{children}</>;

  if (stage.loading) return <RouteFallback label="Loading supplier access…" />;

  if (!stage.onboardingDone && stage.nextPath) {
    return (
      <Navigate
        to={stage.nextPath}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
}

/* ── Entry route ───────────────────────────────────────────────────── */

export function SupplierEntryRoute() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const stage = useSupplierStage();

  const role = normRole(user?.role);

  if (!hydrated) return <RouteFallback label="Opening supplier dashboard…" />;

  if (!user?.id) {
    return <Navigate to="/login?from=%2Fsupplier" replace state={{ from: "/supplier" }} />;
  }

  if (role === "SUPPLIER_RIDER") return <Navigate to="/supplier/orders" replace />;
  if (role === "ADMIN" || role === "SUPER_ADMIN") return <SupplierDashboard />;
  if (role !== "SUPPLIER") return <Navigate to="/" replace />;

  if (stage.loading) return <RouteFallback label="Opening supplier dashboard…" />;

  if (stage.nextPath) return <Navigate to={stage.nextPath} replace />;

  return <SupplierDashboard />;
}

/* ── Orders route guard ────────────────────────────────────────────── */

export function SupplierOrdersRouteGuard() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const role = normRole(user?.role);

  if (!hydrated) return <RouteFallback label="Loading orders…" full />;

  if (!user?.id) return <Navigate to="/login?from=%2Fsupplier%2Forders" replace />;

  if (
    role !== "SUPPLIER" &&
    role !== "SUPPLIER_RIDER" &&
    role !== "ADMIN" &&
    role !== "SUPER_ADMIN"
  ) {
    return <Navigate to="/" replace />;
  }

  if (role === "SUPPLIER") {
    return (
      <SupplierRestrictedPageGuard>
        <SupplierOrdersPage />
      </SupplierRestrictedPageGuard>
    );
  }

  return <SupplierOrdersPage />;
}

/* ── Riders route (inline role check) ─────────────────────────────── */

export function SupplierRidersRoute() {
  const user = useAuthStore((s) => s.user);
  return normRole(user?.role) === "SUPPLIER" ? (
    <SupplierRestrictedPageGuard>
      <SupplierRiders />
    </SupplierRestrictedPageGuard>
  ) : (
    <SupplierRiders />
  );
}
