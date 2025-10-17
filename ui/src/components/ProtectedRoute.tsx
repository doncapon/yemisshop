// src/components/ProtectedRoute.tsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import type { ReactNode } from 'react';

export type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER';

export default function ProtectedRoute({
  roles,
  children,
}: {
  roles?: Role[];
  children: ReactNode;
}) {
  // Select just what we need from the store
  const token = useAuthStore((s) => s.token);
  const role  = useAuthStore((s) => s.user?.role ?? null);

  const loc = useLocation();

  // Not logged in → go to login and preserve "from"
  if (!token) return <Navigate to="/login" state={{ from: loc }} replace />;

  // If roles are specified, enforce them
  if (roles && (!role || !roles.includes(role))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
