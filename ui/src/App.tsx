// src/App.tsx
import { Route, Routes, Navigate, Outlet } from "react-router-dom";
import { useEffect, useMemo } from "react";

import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";

import Catalog from "./pages/Catalog";
import ProductDetail from "./pages/ProductDetail";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Verify from "./pages/VerifyEmail";
import Profile from "./pages/Profile";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Payment from "./pages/Payment";
import PaymentCallback from "./pages/PaymentCallback";
import Wishlist from "./pages/Wishlist";
import Orders from "./pages/Orders";
import ReceiptPage from "./pages/Receipts";
import ResetGuard from "./routes/ResetGuard";

import AdminDashboard from "./pages/admin/AdminDashboard";
import SettingsAdminPage from "./pages/admin/SettingsAdminPage";

import UserDashboard from "./pages/UserDashboard";
import SupplierRegister from "./pages/supplier/SupplierRegister";

import { useAuthStore } from "./store/auth";
import { scheduleTokenExpiryLogout } from "./utils/tokenWatcher";
import { useIdleLogout } from "./hooks/useIdleLogout";

import SupplierDashboard from "./pages/supplier/SupplierDashboard";
import SupplierProductsPage from "./pages/supplier/SupplierProducts";
import SupplierAddProductsPage from "./pages/supplier/SupplierAddProducts";
import SupplierEditProduct from "./pages/supplier/SupplierEditProduct";
import SupplierOrdersPage from "./pages/supplier/SupplierOrders";
import SupplierPayoutsPage from "./pages/supplier/SupplierPayouts";
import SupplierSettingsPage from "./pages/supplier/SupplierSettings";
import SupplierCatalogRequests from "./pages/supplier/SupplierCatalogRequests";
import SupplierSessions from "./pages/supplier/AccountSessions";
import SupplierRefunds from "./pages/supplier/SupplierRefunds";
import SupplierRiders from "./pages/supplier/SupplierRiders";

import RiderAcceptInvite from "./pages/RiderAcceptInvite";

import ModalProvider from "./components/ModalProvider";

function AdminLayout() {
  return <Outlet />;
}

function SupplierLayoutShell() {
  return <Outlet />;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const clear = useAuthStore((s) => s.clear);
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    scheduleTokenExpiryLogout(token, () => {
      clear();
      try {
        localStorage.clear();
        sessionStorage.clear?.();
      } catch {
        /* no-op */
      }
      window.location.replace("/login");
    });
  }, [token, clear]);

  const riderAllowPrefixes = useMemo(() => ["/supplier/orders"], []);

  const RoleDashboard = useMemo(() => {
    const r = String(role || "").toUpperCase();
    if (r === "ADMIN" || r === "SUPER_ADMIN") return AdminDashboard;
    if (r === "SUPPLIER") return SupplierDashboard;
    if (r === "SUPPLIER_RIDER") return () => <Navigate to="/supplier/orders" replace />;
    return UserDashboard;
  }, [role]);

  useIdleLogout();

  return (
    <ModalProvider>
      <div className="min-h-screen flex flex-col">
        <main className="w-full px-4 md:px-8 flex-1 bg-primary-100">
          <div className="max-w-7xl mx-auto">
            <Routes>
              {/* ---------------- Public site ---------------- */}
              <Route path="/" element={<Catalog />} />
              <Route path="/product/:id" element={<ProductDetail />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/verify" element={<Verify />} />

              {/* Public rider invite accept (MUST be top-level) */}
              <Route path="/rider/accept" element={<RiderAcceptInvite />} />

              {/* ---------------- Auth ---------------- */}
              <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
              <Route path="/register" element={token ? <Navigate to="/" replace /> : <Register />} />
              <Route path="/register-supplier" element={token ? <Navigate to="/" replace /> : <SupplierRegister />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route
                path="/reset-password"
                element={
                  <ResetGuard>
                    <ResetPassword />
                  </ResetGuard>
                }
              />

              {/* ---------------- Shopper protected ---------------- */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPPLIER"]}>
                    <Profile />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/orders"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN"]}>
                    <Orders />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/checkout"
                element={
                  <ProtectedRoute roles={["SHOPPER", "SUPER_ADMIN"]}>
                    <Checkout />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/wishlist"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN"]}>
                    <Wishlist />
                  </ProtectedRoute>
                }
              />

              <Route path="/payment" element={<Payment />} />
              <Route path="/payment-callback" element={<PaymentCallback />} />
              <Route path="/receipt/:paymentId" element={<ReceiptPage />} />

              {/* Sessions should be protected */}
              <Route
                path="/account/sessions"
                element={
                  <ProtectedRoute roles={["SHOPPER", "SUPPLIER", "ADMIN", "SUPER_ADMIN"]}>
                    <SupplierSessions />
                  </ProtectedRoute>
                }
              />

              {/* Role-based “/dashboard” */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPPLIER", "SUPPLIER_RIDER"]}>
                    <RoleDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Optional rider entry point (after login) */}
              <Route
                path="/rider"
                element={
                  <ProtectedRoute roles={["SUPPLIER_RIDER", "SUPPLIER", "ADMIN", "SUPER_ADMIN"]}>
                    <Navigate to="/supplier/orders" replace />
                  </ProtectedRoute>
                }
              />

              {/* ---------------- Supplier area ---------------- */}
              <Route
                path="/supplier"
                element={
                  <ProtectedRoute
                    roles={["SUPPLIER", "SUPPLIER_RIDER", "ADMIN", "SUPER_ADMIN"]}
                    riderAllowPrefixes={riderAllowPrefixes}
                  >
                    <SupplierLayoutShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<SupplierDashboard />} />

                <Route path="products" element={<Outlet />}>
                  <Route index element={<SupplierProductsPage />} />
                  <Route path="add" element={<SupplierAddProductsPage />} />
                  <Route path=":id/edit" element={<SupplierEditProduct />} />
                </Route>

                {/* ✅ Riders allowed here via riderAllowPrefixes */}
                <Route path="orders" element={<SupplierOrdersPage />} />
                <Route path="orders/:orderId" element={<SupplierOrdersPage />} />

                <Route path="refunds" element={<SupplierRefunds />} />
                <Route path="refund/:refundId" element={<SupplierRefunds />} />

                {/* Riders management page */}
                <Route
                  path="riders"
                  element={
                    <ProtectedRoute roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN"]}>
                      <SupplierRiders />
                    </ProtectedRoute>
                  }
                />

                <Route path="catalog-requests" element={<SupplierCatalogRequests />} />
                <Route path="payouts" element={<SupplierPayoutsPage />} />
                <Route path="settings" element={<SupplierSettingsPage />} />

                <Route path="*" element={<Navigate to="/supplier" replace />} />
              </Route>

              {/* ---------------- Admin area ---------------- */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={["ADMIN", "SUPER_ADMIN"]}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="dashboard" element={<Navigate to="/admin" replace />} />
                <Route path="products" element={<Navigate to="/admin?tab=products&pTab=manage" replace />} />
                <Route
                  path="products/moderation"
                  element={<Navigate to="/admin?tab=products&pTab=moderation" replace />}
                />
                <Route path="orders" element={<Navigate to="/admin?tab=transactions" replace />} />
                <Route
                  path="settings"
                  element={
                    <ProtectedRoute roles={["SUPER_ADMIN"]}>
                      <SettingsAdminPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Route>

              <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>

        <Footer />
      </div>
    </ModalProvider>
  );
}
