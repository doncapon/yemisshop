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
import { useIdleLogout } from "./hooks/useIdleLogout";

import SupplierDashboard from "./pages/supplier/SupplierDashboard";
import SupplierProductsPage from "./pages/supplier/SupplierProducts";
import SupplierAddProductsPage from "./pages/supplier/SupplierAddProducts";
import SupplierEditProduct from "./pages/supplier/SupplierEditProduct";
import SupplierOrdersPage from "./pages/supplier/SupplierOrders";
import SupplierPayoutsPage from "./pages/supplier/SupplierPayouts";
import SupplierSettingsPage from "./pages/supplier/SupplierSettings";
import SupplierCatalogRequests from "./pages/supplier/SupplierCatalogRequests";
import AccountSessions from "./pages/supplier/AccountSessions";
import SupplierRefunds from "./pages/supplier/SupplierRefunds";
import SupplierRiders from "./pages/supplier/SupplierRiders";
import SupplierCatalogOffers from "./pages/supplier/SupplierCatalogOffers";

import RiderAcceptInvite from "./pages/RiderAcceptInvite";

import ModalProvider from "./components/ModalProvider";
import { Toaster } from "react-hot-toast";
import DataPrivacy from "./pages/DataPrivacy";
import AuthBootstrap from "./components/AuthBootstrap";
import AdminOfferChangeRequests from "./pages/admin/AdminOfferChangeRequests";
import ScrollToTop from "./components/ScrollToTop";

function AdminLayout() {
  return <Outlet />;
}

function SupplierLayoutShell() {
  return <Outlet />;
}

/** ✅ Role-aware landing page (cookie auth: user in store means authed) */
function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const isAuthed = !!user;
  const r = String(user?.role || "").toUpperCase();

  // If logged-in supplier, land them on supplier catalog offers
  if (isAuthed && r === "SUPPLIER") return <Navigate to="/supplier/catalog-offers" replace />;

  // Keep riders off public catalog after login
  if (isAuthed && r === "SUPPLIER_RIDER") return <Navigate to="/supplier/orders" replace />;

  return <Catalog />;
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);

  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const isAuthed = !!user;

  // ✅ Cookie-auth bootstrap: should call /api/auth/me (withCredentials) and set user
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // ❌ Removed token expiry watcher: cookie sessions don’t have client JWT expiry to watch

  // ✅ riders can ONLY access supplier orders routes inside /supplier
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
        <AuthBootstrap />
        <main className="w-full flex-1 bg-slate-50">
          <div className="max-w-7xl mx-auto">
            <Toaster position="top-right" />
            <ScrollToTop />
            <Routes>
              {/* ---------------- Public site ---------------- */}
              <Route path="/" element={<HomeRoute />} />
              <Route path="/product/:id" element={<ProductDetail />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/privacy" element={<DataPrivacy />} />
              <Route path="/payment" element={<Payment />} />
              <Route path="/payment-callback" element={<PaymentCallback />} />
              <Route path="/receipt/:paymentId" element={<ReceiptPage />} />

              {/* Public rider invite accept (MUST be top-level) */}
              <Route path="/rider/accept" element={<RiderAcceptInvite />} />

              {/* ---------------- Auth ---------------- */}
              <Route path="/login" element={isAuthed ? <Navigate to="/" replace /> : <Login />} />
              <Route path="/register" element={isAuthed ? <Navigate to="/" replace /> : <Register />} />
              <Route path="/register-supplier" element={isAuthed ? <Navigate to="/" replace /> : <SupplierRegister />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route
                path="/reset-password"
                element={
                  <ResetGuard>
                    <ResetPassword />
                  </ResetGuard>
                }
              />

              {/* ---------------- Shared protected ---------------- */}
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

              <Route
                path="/account/sessions"
                element={
                  <ProtectedRoute roles={["SHOPPER", "SUPPLIER", "ADMIN", "SUPER_ADMIN"]}>
                    <AccountSessions />
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

                {/* ✅ Catalog Offers now lives inside supplier area */}
                <Route
                  path="catalog-offers"
                  element={
                    <ProtectedRoute roles={["SUPPLIER"]}>
                      <SupplierCatalogOffers />
                    </ProtectedRoute>
                  }
                />

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
                <Route path="offer-changes" element={<AdminOfferChangeRequests />} />

                <Route index element={<AdminDashboard />} />
                <Route path="dashboard" element={<Navigate to="/admin" replace />} />
                <Route path="products" element={<Navigate to="/admin?tab=products&pTab=manage" replace />} />
                <Route path="products/moderation" element={<Navigate to="/admin?tab=products&pTab=moderation" replace />} />
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
