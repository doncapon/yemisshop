// src/components/ProtectedRoute.tsx
import React, { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/auth";

type Props = {
  children: React.ReactNode;

  /**
   * ✅ Allowed roles (normalized comparison).
   * Accepts string[] so callers can pass aliases like ["SUPER_ADMIN", "SUPERADMIN"].
   * If omitted, any authenticated user can access.
   */
  roles?: string[];

  /**
   * ✅ For supplier rider: allow only certain route prefixes even if rider is included in roles.
   * Example: ["/supplier/orders"]
   */
  riderAllowPrefixes?: string[];
};

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");

  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  if (r === "SUPERUSER") r = "SUPER_USER";

  return r;
}

export default function ProtectedRoute({ children, roles, riderAllowPrefixes }: Props) {
  const location = useLocation();

  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  // ✅ wait for auth bootstrap so we don't "flash redirect"
  if (!hydrated) return <>{children}</>;

  const isAuthed = !!user?.id;

  if (!isAuthed) {
    const from = `${location.pathname}${location.search}`;
    const qp = encodeURIComponent(from);

    // ✅ store in sessionStorage so refresh keeps it
    try {
      sessionStorage.setItem("auth:returnTo", from);
    } catch {}

    // ✅ send BOTH: state + querystring
    return <Navigate to={`/login?from=${qp}`} replace state={{ from }} />;
  }

  const userRole = normRole(user?.role);

  // ✅ Rider route restrictions
  if (userRole === normRole("SUPPLIER_RIDER") && Array.isArray(riderAllowPrefixes) && riderAllowPrefixes.length > 0) {
    const ok = riderAllowPrefixes.some((p) => location.pathname.startsWith(p));
    if (!ok) return <Navigate to="/supplier/orders" replace />;
  }

  // ✅ SUPER_ADMIN override: allow everywhere by default
  if (userRole === "SUPER_ADMIN") {
    return <>{children}</>;
  }

  const allowedSet = useMemo(() => {
    const arr = Array.isArray(roles) ? roles : [];
    return new Set(arr.map(normRole).filter(Boolean));
  }, [roles]);

  // ✅ If no roles specified, allow any authed user
  if (allowedSet.size > 0 && !allowedSet.has(userRole)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
