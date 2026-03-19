import React, { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/auth";

type Props = {
  children: React.ReactNode;
  roles?: string[];
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

export default function ProtectedRoute({
  children,
  roles,
  riderAllowPrefixes,
}: Props) {
  const location = useLocation();

  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  const userRole = normRole(user?.role);

  const allowedSet = useMemo(() => {
    console.log("[ProtectedRoute]", {
      path: `${location.pathname}${location.search}`,
      hydrated,
      user,
      roles,
      riderAllowPrefixes,
    });
    const arr = Array.isArray(roles) ? roles : [];
    return new Set(arr.map(normRole).filter(Boolean));
  }, [roles]);

  if (!hydrated) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center px-4">
        <div className="text-sm text-zinc-500">Loading access…</div>
      </div>
    );
  }

  const isAuthed = !!user?.id;

  if (!isAuthed) {
    const from = `${location.pathname}${location.search}`;
    const qp = encodeURIComponent(from);

    try {
      sessionStorage.setItem("auth:returnTo", from);
    } catch { }

    return <Navigate to={`/login?from=${qp}`} replace state={{ from }} />;
  }

  if (
    userRole === "SUPPLIER_RIDER" &&
    Array.isArray(riderAllowPrefixes) &&
    riderAllowPrefixes.length > 0
  ) {
    const ok = riderAllowPrefixes.some((p) => location.pathname.startsWith(p));
    if (!ok) return <Navigate to="/supplier/orders" replace />;
  }

  if (userRole === "SUPER_ADMIN") {
    return <>{children}</>;
  }

  if (allowedSet.size > 0 && !allowedSet.has(userRole)) {
    if (userRole === "SUPPLIER") return <Navigate to="/supplier" replace />;
    if (userRole === "SUPPLIER_RIDER") return <Navigate to="/supplier/orders" replace />;
    if (userRole === "ADMIN") return <Navigate to="/admin" replace />;
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}