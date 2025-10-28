// src/App.tsx
import { Route, Routes, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar.tsx';
import Catalog from './pages/Catalog.tsx';
import ProductDetail from './pages/ProductDetail.tsx';
import Cart from './pages/Cart.tsx';
import Checkout from './pages/Checkout.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import AdminDashboard from './pages/admin/AdminDashboard.tsx';
import UserDashboard from './pages/UserDashboard.tsx';
import ProtectedRoute from './components/ProtectedRoute.tsx';
import Verify from './pages/VerifyEmail.tsx';
import Profile from './pages/Profile.tsx';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Footer from './components/Footer.tsx';
import Payment from './pages/Payment.tsx';
import PaymentCallback from './pages/PaymentCallback.tsx';
import Wishlist from './pages/Wishlist.tsx';
import Orders from './pages/Orders.tsx';
import { ModalProvider } from './components/ModalProvider';
import { useAuthStore } from './store/auth';
import { useEffect, useMemo } from 'react';
import { scheduleTokenExpiryLogout } from './utils/tokenWatcher';
import ResetGuard from './routes/ResetGuard.tsx';
import ReceiptPage from './pages/Receipts.tsx';
import SettingsAdminPage from './pages/admin/SettingsAdminPage.tsx';

export default function App() {
  const token = useAuthStore((s) => s.token);
  const clear = useAuthStore((s) => s.clear);
  const role = useAuthStore((s) => s.user?.role); // 👈 get current role

  useEffect(() => {
    scheduleTokenExpiryLogout(token, () => {
      clear();
      try { localStorage.clear(); sessionStorage.clear?.(); } catch { /* no-op */ }
      window.location.replace('/login');
    });
  }, [token, clear]);

  // 👇 Decide which dashboard to render for the /dashboard route
  const RoleDashboard = useMemo(() => {
    const r = (role || '').toUpperCase();
    if (r === 'ADMIN' || r === 'SUPER_ADMIN') return AdminDashboard;
    // default to user dashboard for SHOPPER, or anything else
    return UserDashboard;
  }, [role]);

  return (
    <ModalProvider>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="w-full px-4 md:px-8 flex-1 bg-primary-100">
          <div className="max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<Catalog />} />
              <Route path="/product/:id" element={<ProductDetail />} />
              <Route path="/cart" element={<Cart />} />

              <Route
                path="/login"
                element={useAuthStore.getState().token ? <Navigate to="/" replace /> : <Login />}
              />
              <Route
                path="/register"
                element={useAuthStore.getState().token ? <Navigate to="/" replace /> : <Register />}
              />

              <Route path="/verify" element={<Verify />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/payment" element={<Payment />} />
              <Route path="/reset-password" element={<ResetGuard><ResetPassword /></ResetGuard>} />
              <Route path="/payment-callback" element={<PaymentCallback />} />
              <Route path="/receipt/:paymentId" element={<ReceiptPage />} />

              <Route
                path="/checkout"
                element={
                  <ProtectedRoute roles={['SHOPPER', 'SUPER_ADMIN']}>
                    <Checkout />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/admin"
              >
                {/* default /admin -> dashboard */}
                <Route index element={<Navigate to="dashboard" replace />} />

                <Route path="dashboard" element={<AdminDashboard />} />
                <Route
                  path="settings"
                  element={
                    <ProtectedRoute roles={['SUPER_ADMIN']}>
                      <SettingsAdminPage />
                    </ProtectedRoute>
                  }
                />

                {/* optional: 404 for admin-only space */}
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Route>


              <Route
                path="/wishlist"
                element={
                  <ProtectedRoute roles={['SHOPPER', 'ADMIN', 'SUPER_ADMIN']}>
                    <Wishlist />
                  </ProtectedRoute>
                }
              />

              {/* 👇 Role-based dashboard selection */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={['SHOPPER', 'ADMIN', 'SUPER_ADMIN']}>
                    <RoleDashboard />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
        <Footer />
      </div>
    </ModalProvider>
  );
}
