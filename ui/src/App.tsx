// src/App.tsx
import { Route, Routes, Navigate, Outlet } from 'react-router-dom';
import { useEffect, useMemo } from 'react';

import Navbar from './components/Navbar.tsx';
import Footer from './components/Footer.tsx';
import ProtectedRoute from './components/ProtectedRoute.tsx';
import { ModalProvider } from './components/ModalProvider';

import Catalog from './pages/Catalog.tsx';
import ProductDetail from './pages/ProductDetail.tsx';
import Cart from './pages/Cart.tsx';
import Checkout from './pages/Checkout.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import Verify from './pages/VerifyEmail.tsx';
import Profile from './pages/Profile.tsx';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Payment from './pages/Payment.tsx';
import PaymentCallback from './pages/PaymentCallback.tsx';
import Wishlist from './pages/Wishlist.tsx';
import Orders from './pages/Orders.tsx';
import ReceiptPage from './pages/Receipts.tsx';
import ResetGuard from './routes/ResetGuard.tsx';

import AdminDashboard from './pages/admin/AdminDashboard.tsx';
import SettingsAdminPage from './pages/admin/SettingsAdminPage.tsx';

import UserDashboard from './pages/UserDashboard.tsx';
import { useAuthStore } from './store/auth';
import { scheduleTokenExpiryLogout } from './utils/tokenWatcher';

// Optional shell for /admin (handy if you add a sidebar/header later)
function AdminLayout() {
  return <Outlet />;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const clear = useAuthStore((s) => s.clear);
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    scheduleTokenExpiryLogout(token, () => {
      clear();
      try { localStorage.clear(); sessionStorage.clear?.(); } catch { /* no-op */ }
      window.location.replace('/login');
    });
  }, [token, clear]);

  // Role-based dashboard for /dashboard
  const RoleDashboard = useMemo(() => {
    const r = (role || '').toUpperCase();
    if (r === 'ADMIN' || r === 'SUPER_ADMIN') return AdminDashboard;
    return UserDashboard; // default for SHOPPER/other
  }, [role]);

  return (
    <ModalProvider>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="w-full px-4 md:px-8 flex-1 bg-primary-100">
          <div className="max-w-7xl mx-auto">
            <Routes>
              {/* Public site */}
              <Route path="/" element={<Catalog />} />
              <Route path="/product/:id" element={<ProductDetail />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/payment" element={<Payment />} />
              <Route path="/payment-callback" element={<PaymentCallback />} />
              <Route path="/receipt/:paymentId" element={<ReceiptPage />} />

              {/* Auth */}
              <Route
                path="/login"
                element={useAuthStore.getState().token ? <Navigate to="/" replace /> : <Login />}
              />
              <Route
                path="/register"
                element={useAuthStore.getState().token ? <Navigate to="/" replace /> : <Register />}
              />
              <Route
                path="/reset-password"
                element={
                  <ResetGuard>
                    <ResetPassword />
                  </ResetGuard>
                }
              />

              {/* Checkout (protected) */}
              <Route
                path="/checkout"
                element={
                  <ProtectedRoute roles={['SHOPPER', 'SUPER_ADMIN']}>
                    <Checkout />
                  </ProtectedRoute>
                }
              />

              {/* Wishlist (protected) */}
              <Route
                path="/wishlist"
                element={
                  <ProtectedRoute roles={['SHOPPER', 'ADMIN', 'SUPER_ADMIN']}>
                    <Wishlist />
                  </ProtectedRoute>
                }
              />

              {/* Role-based “/dashboard” */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={['SHOPPER', 'ADMIN', 'SUPER_ADMIN']}>
                    <RoleDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Admin area under /admin */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={['ADMIN', 'SUPER_ADMIN']}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                {/* /admin → AdminDashboard (let it pick default section/tab if none provided) */}
                <Route index element={<AdminDashboard />} />

                {/* Keep /admin/dashboard working; canonical is /admin */}
                <Route path="dashboard" element={<Navigate to="/admin" replace />} />

                {/* ========= Virtual sub-pages → redirect to /admin?tab=<section>&pTab=<inner> ========= */}

                {/* Products main/manage */}
                <Route
                  path="products"
                  element={<Navigate to="/admin?tab=products&pTab=manage" replace />}
                />

                {/* Products moderation (uses your ModerationGrid inside AdminDashboard) */}
                <Route
                  path="products/moderation"
                  element={<Navigate to="/admin?tab=products&pTab=moderation" replace />}
                />

                {/* Orders list (inner tab name can be whatever your AdminDashboard expects; 'list' is common) */}
                {/* Redirect orders → transactions (valid tab) */}
                <Route
                  path="orders"
                  element={<Navigate to="/admin?tab=transactions" replace />}
                />


                {/* Settings (still a dedicated page) */}
                <Route
                  path="settings"
                  element={
                    <ProtectedRoute roles={['SUPER_ADMIN']}>
                      <SettingsAdminPage />
                    </ProtectedRoute>
                  }
                />

                {/* Unknown admin subpaths → admin home */}
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Route>

              {/* Legacy redirect for any old links to /admin/dashboard */}
              <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />

              {/* 404 -> home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
        <Footer />
      </div>
    </ModalProvider>
  );
}
