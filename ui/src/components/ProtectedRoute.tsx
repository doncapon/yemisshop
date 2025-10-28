import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../store/auth';

export type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER';

export default function ProtectedRoute({
  roles,
  children,
}: {
  roles?: Role[];
  children: ReactNode;
}) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token    = useAuthStore((s) => s.token);
  const role     = useAuthStore((s) => s.user?.role ?? null);
  const loc = useLocation();

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

  return <>{children}</>;
}
