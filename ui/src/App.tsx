// src/App.tsx
import { Route, Routes, Navigate, Outlet } from "react-router-dom";
import { useEffect, useMemo } from "react";

import Footer from "./components/Footer.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";
import { ModalProvider } from "./components/ModalProvider";

import Catalog from "./pages/Catalog.tsx";
import ProductDetail from "./pages/ProductDetail.tsx";
import Cart from "./pages/Cart.tsx";
import Checkout from "./pages/Checkout.tsx";
import Login from "./pages/Login.tsx";
import Register from "./pages/Register.tsx";
import Verify from "./pages/VerifyEmail.tsx";
import Profile from "./pages/Profile.tsx";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Payment from "./pages/Payment.tsx";
import PaymentCallback from "./pages/PaymentCallback.tsx";
import Wishlist from "./pages/Wishlist.tsx";
import Orders from "./pages/Orders.tsx";
import ReceiptPage from "./pages/Receipts.tsx";
import ResetGuard from "./routes/ResetGuard.tsx";

import AdminDashboard from "./pages/admin/AdminDashboard.tsx";
import SettingsAdminPage from "./pages/admin/SettingsAdminPage.tsx";

import UserDashboard from "./pages/UserDashboard.tsx";
import SupplierRegister from "./pages/supplier/SupplierRegister.tsx";

import { useAuthStore } from "./store/auth";
import { scheduleTokenExpiryLogout } from "./utils/tokenWatcher";
import { useIdleLogout } from "./hooks/useIdleLogout";

// ✅ Supplier pages
import SupplierDashboard from "./pages/supplier/SupplierDashboard.tsx";
import SupplierProductsPage from "./pages/supplier/SupplierProducts.tsx";
import SupplierAddProductsPage from "./pages/supplier/SupplierAddProducts.tsx";
import SupplierEditProduct from "./pages/supplier/SupplierEditProduct.tsx";
import SupplierOrdersPage from "./pages/supplier/SupplierOrders.tsx";
import SupplierPayoutsPage from "./pages/supplier/SupplierPayouts.tsx";
import SupplierSettingsPage from "./pages/supplier/SupplierSettings.tsx";
import SupplierCatalogRequests from "./pages/supplier/SupplierCatalogRequests.tsx";
import SupplierSessions from "./pages/supplier/AccountSessions.tsx";

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

  const RoleDashboard = useMemo(() => {
    const r = (role || "").toUpperCase();
    if (r === "ADMIN" || r === "SUPER_ADMIN") return AdminDashboard;
    if (r === "SUPPLIER") return SupplierDashboard;
    return UserDashboard;
  }, [role]);

  // ✅ Idle logout (role-based)
  useIdleLogout();

  return (
    <ModalProvider>
      <div className="min-h-screen flex flex-col">
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
                path="/register-supplier"
                element={
                  useAuthStore.getState().token ? (
                    <Navigate to="/" replace />
                  ) : (
                    <SupplierRegister />
                  )
                }
              />
              <Route
                path="/reset-password"
                element={
                  <ResetGuard>
                    <ResetPassword />
                  </ResetGuard>
                }
              />

              <Route path="/account/sessions" element={<SupplierSessions />} />

              {/* Checkout (protected) */}
              <Route
                path="/checkout"
                element={
                  <ProtectedRoute roles={["SHOPPER", "SUPER_ADMIN"]}>
                    <Checkout />
                  </ProtectedRoute>
                }
              />

              {/* Wishlist (protected) */}
              <Route
                path="/wishlist"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN"]}>
                    <Wishlist />
                  </ProtectedRoute>
                }
              />

              {/* Role-based “/dashboard” */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPPLIER"]}>
                    <RoleDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Supplier area */}
              <Route
                path="/supplier"
                element={
                  <ProtectedRoute roles={["SUPPLIER", "SUPER_ADMIN"]}>
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

                <Route path="orders" element={<SupplierOrdersPage />} />
                <Route path="orders/:orderId" element={<SupplierOrdersPage />} />
                <Route path="catalog-requests" element={<SupplierCatalogRequests />} />
                <Route path="payouts" element={<SupplierPayoutsPage />} />
                <Route path="settings" element={<SupplierSettingsPage />} />
                <Route path="*" element={<Navigate to="/supplier" replace />} />
              </Route>

              {/* Admin area under /admin */}
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
                <Route
                  path="products"
                  element={<Navigate to="/admin?tab=products&pTab=manage" replace />}
                />
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
