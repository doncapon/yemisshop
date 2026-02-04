import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuthStore } from "../store/auth";

export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

type Props = {
  roles?: Role[];
  children: ReactNode;
  riderAllowPrefixes?: string[];
};

function normRole(role: any): Role | null {
  const r = String(role || "").trim().toUpperCase();
  if (!r) return null;

  // legacy/customer aliases → treat as SHOPPER
  if (r === "CUSTOMER" || r === "USER" || r === "BUYER") return "SHOPPER";

  if (r === "ADMIN") return "ADMIN";
  if (r === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (r === "SHOPPER") return "SHOPPER";
  if (r === "SUPPLIER") return "SUPPLIER";
  if (r === "SUPPLIER_RIDER") return "SUPPLIER_RIDER";
  return null;
}

export default function ProtectedRoute({ roles, children, riderAllowPrefixes }: Props) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const role = normRole(user?.role ?? null);

  const loc = useLocation();
  const path = loc.pathname || "/";

  if (!hydrated) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }

  // token exists but user not loaded yet → wait (prevents wrong redirects)
  if (!user) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (roles && (!role || !roles.includes(role))) {
    return <Navigate to="/" replace />;
  }

  if (role === "SUPPLIER_RIDER" && riderAllowPrefixes?.length) {
    const allowed = riderAllowPrefixes.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p));
    if (!allowed) return <Navigate to="/supplier/orders" replace />;
  }

  return <>{children}</>;
}
