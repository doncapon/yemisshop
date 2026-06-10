import { Navigate, Outlet, useParams } from "react-router-dom";
import { useAuthStore } from "../../store/auth";
import {
  normRole,
  hasTempVerifySession,
  defaultAuthedPathForRole,
} from "../../lib/roles";
import { useSupplierStage } from "../../supplier/stage";
import RouteFallback from "../RouteFallback";
import {
  Login,
  Catalog,
  AdminDashboard,
  UserDashboard,
  SupplierDashboard,
  Profile,
  Orders,
  Wishlist,
} from "../../routes/lazy";
import { SupplierRestrictedPageGuard } from "./SupplierGuards";

/* ── Layout shells ─────────────────────────────────────────────────── */

export function AdminLayout() {
  return <Outlet />;
}

/* ── Admin "view-as" wrappers ──────────────────────────────────────── */

export function DashboardAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <UserDashboard {...({ adminUserId: userId } as any)} />;
}

export function ProfileAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <Profile {...({ adminUserId: userId } as any)} />;
}

export function OrdersAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <Orders {...({ adminUserId: userId } as any)} />;
}

export function WishlistAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <Wishlist {...({ adminUserId: userId } as any)} />;
}

/* ── Role-aware home ───────────────────────────────────────────────── */

export function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const stage = useSupplierStage();

  if (!hydrated) return <Catalog />;

  const isAuthed = !!user?.id;
  const r = normRole(user?.role);

  if (!isAuthed && hasTempVerifySession()) {
    return <Navigate to="/supplier/verify-contact" replace />;
  }

  if (isAuthed && r === "SUPPLIER") {
    if (stage.loading) return <RouteFallback label="Opening supplier area…" />;
    return <Navigate to={stage.nextPath || "/supplier"} replace />;
  }

  if (isAuthed && r === "SUPPLIER_RIDER") {
    return <Navigate to="/supplier/orders" replace />;
  }

  return <Catalog />;
}

/* ── Role-aware dashboard ──────────────────────────────────────────── */

export function RoleDashboardRoute() {
  const user = useAuthStore((s) => s.user);
  const roleNorm = normRole(user?.role);

  if (roleNorm === "SUPPLIER_RIDER") return <Navigate to="/supplier/orders" replace />;
  if (roleNorm === "ADMIN" || roleNorm === "SUPER_ADMIN") return <AdminDashboard />;
  if (roleNorm === "SUPPLIER") {
    return (
      <SupplierRestrictedPageGuard>
        <SupplierDashboard />
      </SupplierRestrictedPageGuard>
    );
  }
  return <UserDashboard />;
}

/* ── Guest-only guard ──────────────────────────────────────────────── */

export function GuestOnlyPageGuard({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  if (!hydrated) return <RouteFallback label="Loading…" />;
  if (user?.id) return <Navigate to={defaultAuthedPathForRole(user?.role)} replace />;

  return <>{children}</>;
}

/* ── Login route guard ─────────────────────────────────────────────── */

/**
 * When already authenticated, render nothing and let the App-level
 * redirect effect send the user to the correct return target.
 */
export function LoginRouteGuard() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  if (!hydrated) return <RouteFallback label="Loading…" />;
  if (user?.id) return null;

  return <Login />;
}
