// src/App.tsx
import { Route, Routes, Navigate, Outlet, useParams } from "react-router-dom";
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

/* -----------------------------
   Role normalization + aliases
----------------------------- */

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

/* ----------------------------- */

function AdminLayout() {
  return <Outlet />;
}
function SupplierLayoutShell() {
  return <Outlet />;
}

/**
 * Admin "view as" wrappers.
 * These pass a userId param down so pages can optionally fetch/render for that user.
 * (Requires those pages to support a prop OR read route param; your current pages cast any)
 */
function DashboardAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <UserDashboard {...({ adminUserId: userId } as any)} />;
}
function ProfileAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <Profile {...({ adminUserId: userId } as any)} />;
}
function OrdersAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <Orders {...({ adminUserId: userId } as any)} />;
}
function WishlistAsUser() {
  const { userId } = useParams<{ userId: string }>();
  return <Wishlist {...({ adminUserId: userId } as any)} />;
}

/** ✅ Role-aware landing page */
function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) return <Catalog />;

  const isAuthed = !!user?.id;
  const r = normRole(user?.role);

  if (isAuthed && r === "SUPPLIER") return <Navigate to="/supplier/catalog-offers" replace />;
  if (isAuthed && r === "SUPPLIER_RIDER") return <Navigate to="/supplier/orders" replace />;

  return <Catalog />;
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  const isAuthed = !!user?.id;
  const roleNorm = normRole(user?.role);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const riderAllowPrefixes = useMemo(() => ["/supplier/orders"], []);

  const RoleDashboard = useMemo(() => {
    const r = roleNorm;

    if (r === "ADMIN" || r === "SUPER_ADMIN") return AdminDashboard;
    if (r === "SUPPLIER") return SupplierDashboard;
    if (r === "SUPPLIER_RIDER") return () => <Navigate to="/supplier/orders" replace />;
    return UserDashboard;
  }, [roleNorm]);

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

              <Route path="/rider/accept" element={<RiderAcceptInvite />} />

              {/* ---------------- Auth ---------------- */}
              <Route path="/login" element={hydrated && isAuthed ? <Navigate to="/" replace /> : <Login />} />
              <Route path="/register" element={hydrated && isAuthed ? <Navigate to="/" replace /> : <Register />} />
              <Route
                path="/register-supplier"
                element={hydrated && isAuthed ? <Navigate to="/" replace /> : <SupplierRegister />}
              />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route
                path="/reset-password"
                element={
                  <ResetGuard>
                    <ResetPassword />
                  </ResetGuard>
                }
              />

              {/* ---------------- Shared protected (self) ---------------- */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPPLIER", "SUPERADMIN", "SUPER ADMIN"]}>
                    <Profile />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/orders"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <Orders />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/checkout"
                element={
                  <ProtectedRoute roles={["SHOPPER", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <Checkout />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/wishlist"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <Wishlist />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/account/sessions"
                element={
                  <ProtectedRoute roles={["SHOPPER", "SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <AccountSessions />
                  </ProtectedRoute>
                }
              />

              {/* ✅ Your normal role-aware dashboard */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute
                    roles={[
                      "SHOPPER",
                      "ADMIN",
                      "SUPER_ADMIN",
                      "SUPPLIER",
                      "SUPPLIER_RIDER",
                      "SUPERADMIN",
                      "SUPER ADMIN",
                    ]}
                  >
                    <RoleDashboard />
                  </ProtectedRoute>
                }
              />

              {/* ✅ Dedicated shopper dashboard that Admin/Super can open */}
              <Route
                path="/customer-dashboard"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <UserDashboard />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/rider"
                element={
                  <ProtectedRoute roles={["SUPPLIER_RIDER", "SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN"]}>
                    <Navigate to="/supplier/orders" replace />
                  </ProtectedRoute>
                }
              />

              {/* ---------------- Admin "view as user" ---------------- */}
              <Route
                path="/u/:userId/dashboard"
                element={
                  <ProtectedRoute roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <DashboardAsUser />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/u/:userId/profile"
                element={
                  <ProtectedRoute roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <ProfileAsUser />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/u/:userId/orders"
                element={
                  <ProtectedRoute roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <OrdersAsUser />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/u/:userId/wishlist"
                element={
                  <ProtectedRoute roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <WishlistAsUser />
                  </ProtectedRoute>
                }
              />

              {/* ---------------- Supplier area ---------------- */}
              <Route
                path="/supplier"
                element={
                  <ProtectedRoute
                    roles={["SUPPLIER", "SUPPLIER_RIDER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                    riderAllowPrefixes={riderAllowPrefixes}
                  >
                    <SupplierLayoutShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<SupplierDashboard />} />

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

                <Route path="orders" element={<SupplierOrdersPage />} />
                <Route path="orders/:orderId" element={<SupplierOrdersPage />} />

                <Route path="refunds" element={<SupplierRefunds />} />
                <Route path="refund/:refundId" element={<SupplierRefunds />} />

                <Route
                  path="riders"
                  element={
                    <ProtectedRoute roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
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
                  <ProtectedRoute roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<AdminDashboard />} />

                <Route path="offer-changes" element={<AdminOfferChangeRequests />} />
                <Route path="dashboard" element={<Navigate to="/admin" replace />} />
                <Route path="products" element={<Navigate to="/admin?tab=products&pTab=manage" replace />} />
                <Route path="products/moderation" element={<Navigate to="/admin?tab=products&pTab=moderation" replace />} />
                <Route path="orders" element={<Navigate to="/admin?tab=transactions" replace />} />
                <Route
                  path="settings"
                  element={
                    <ProtectedRoute roles={["SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
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
