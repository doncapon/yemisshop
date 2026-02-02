import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuthStore } from "../store/auth";

export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

type Props = {
  roles?: Role[];
  children: ReactNode;

  /**
   * Optional: if provided, SUPPLIER_RIDER can only access these path prefixes.
   * Example: ["/supplier/orders", "/supplier/refunds"]
   */
  riderAllowPrefixes?: string[];
};

function normRole(role: any): Role | null {
  const r = String(role || "").trim().toUpperCase();
  if (!r) return null;

  // Only accept known roles
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
  const roleRaw = useAuthStore((s) => s.user?.role ?? null);
  const role = normRole(roleRaw);

  const loc = useLocation();
  const path = loc.pathname || "/";

  // Don’t decide until hydration finishes
  if (!hydrated) return null;

  // Not logged in → go to login and preserve "from"
  if (!token) {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }

  // If roles are specified, enforce them
  if (roles && (!role || !roles.includes(role))) {
    return <Navigate to="/" replace />;
  }

  // Optional: path-level restriction for riders
  if (role === "SUPPLIER_RIDER" && riderAllowPrefixes?.length) {
    const allowed = riderAllowPrefixes.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p));
    if (!allowed) {
      // Send riders to orders as the "home" page
      return <Navigate to="/supplier/orders" replace />;
    }
  }

  return <>{children}</>;
}
