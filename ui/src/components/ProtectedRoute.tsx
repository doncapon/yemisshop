import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import type { ReactNode } from 'react'


export default function ProtectedRoute({ roles, children }: { roles?: string[]; children: ReactNode }) {
  const { token, role } = useAuthStore()
  const loc = useLocation()


  if (!token) return <Navigate to="/login" state={{ from: loc }} replace />
  if (roles && role && !roles.includes(role)) return <Navigate to="/" replace />


  return <>{children}</>
}