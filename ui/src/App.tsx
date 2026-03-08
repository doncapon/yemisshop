// src/App.tsx
import React, { useEffect, useMemo } from "react";
import { Route, Routes, Navigate, Outlet, useParams, useLocation, useNavigate } from "react-router-dom";

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
import AdminApplicants from "./pages/admin/AdminApplicants";
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
import toast from "react-hot-toast";

import DataPrivacy from "./pages/DataPrivacy";
import AuthBootstrap from "./components/AuthBootstrap";
import AdminOfferChangeRequests from "./pages/admin/AdminOfferChangeRequests";
import ScrollToTop from "./components/ScrollToTop";
import About from "./pages/AboutUs";
import Contact from "./pages/Contact";
import Careers from "./pages/Careers";
import AdminEmployeeDocuments from "./pages/admin/AdminEmployeeDocuments";
import AdminEmployees from "./pages/admin/AdminEmployees";
import AdminCareersConfig from "./pages/admin/AdminCareersConfig";
import AdminCareersJobs from "./pages/admin/AdminCareersJobs";
import CareersIndex from "./pages/CareersIndex";
import CareerJobDetail from "./pages/CareerJobDetail";
import AdminEmployeeDetails from "./pages/admin/AdminEmployeeDetails";
import ReturnsRefunds from "./pages/ReturnsRefunds";
import HelpCenter from "./pages/HelpCenter";
import TermsConditions from "./pages/TermsConditions";
import CookiesPage from "./pages/Cookies";
import UnsubscribeNewsletter from "./pages/UnsubscribeNewsletter";
import AdminNewsletterPage from "./pages/admin/AdminNewsletter";

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

function AdminLayout() {
  return <Outlet />;
}
function SupplierLayoutShell() {
  return <Outlet />;
}

/** Admin "view as" wrappers */
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
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  const isAuthed = !!user?.id;
  const roleNorm = normRole(user?.role);

  const nav = useNavigate();
  const loc = useLocation();

  const riderAllowPrefixes = useMemo(() => ["/supplier/orders"], []);

  const RoleDashboard = useMemo(() => {
    const r = roleNorm;
    if (r === "ADMIN" || r === "SUPER_ADMIN") return AdminDashboard;
    if (r === "SUPPLIER") return SupplierDashboard;
    if (r === "SUPPLIER_RIDER") return () => <Navigate to="/supplier/orders" replace />;
    return UserDashboard;
  }, [roleNorm]);

  useIdleLogout();

  /**
   * ✅ Safe cleanup on navigation:
   * - dismiss toasts
   * - unlock scroll
   * - remove pointer-events locks
   *
   * ❌ DO NOT delete portals/backdrops from the DOM here.
   * That can break Radix/Select/Dialog and cause weird click states.
   */
  useEffect(() => {
    try {
      toast.dismiss();
    } catch {}

    const b = document.body;
    const h = document.documentElement;

    b.style.overflow = "";
    b.style.position = "";
    b.style.top = "";
    b.style.left = "";
    b.style.right = "";
    b.style.width = "";
    b.style.paddingRight = "";
    b.style.pointerEvents = "";

    h.style.overflow = "";
    h.style.pointerEvents = "";

    b.classList.remove("overflow-hidden", "modal-open");

    try {
      (document.activeElement as any)?.blur?.();
    } catch {}
  }, [loc.key]);

  /**
   * If NOT authenticated and they access protected routes, send them to /login.
   */
  useEffect(() => {
    if (!hydrated) return;
    if (isAuthed) return;

    const p = loc.pathname;

    const isProtectedPath =
      p === "/checkout" ||
      p === "/orders" ||
      p === "/wishlist" ||
      p === "/profile" ||
      p === "/dashboard" ||
      p === "/customer-dashboard" ||
      p === "/account/sessions" ||
      p === "/admin" ||
      p.startsWith("/admin/") ||
      p === "/supplier" ||
      p.startsWith("/supplier/") ||
      p === "/rider" ||
      p.startsWith("/u/");

    if (!isProtectedPath) return;
    if (p === "/login") return;

    const target = `${loc.pathname}${loc.search}`;

    try {
      sessionStorage.setItem("auth:returnTo", target);
    } catch {}

    const qp = encodeURIComponent(target);
    nav(`/login?from=${qp}`, { replace: true, state: { from: target } });
  }, [hydrated, isAuthed, loc.pathname, loc.search, nav]);

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

              {/* Product detail is PUBLIC */}
              <Route path="/products/:id" element={<ProductDetail />} />

              <Route path="/cart" element={<Cart />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/privacy" element={<DataPrivacy />} />
              <Route path="/payment" element={<Payment />} />
              <Route path="/payment-callback" element={<PaymentCallback />} />
              <Route path="/receipt/:paymentId" element={<ReceiptPage />} />

              <Route path="/rider/accept" element={<RiderAcceptInvite />} />

              {/* ---------------- Auth / public content ---------------- */}
              <Route path="/login" element={<Login />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/help" element={<HelpCenter />} />

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
                path="/returns-refunds"
                element={
                  <ProtectedRoute roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <ReturnsRefunds />
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

              {/* Role-aware dashboard */}
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
                <Route path="newsletter" element={<AdminNewsletterPage />} />
                <Route path="dashboard" element={<Navigate to="/admin" replace />} />
                <Route path="products" element={<Navigate to="/admin?tab=products&pTab=manage" replace />} />
                <Route path="products/moderation" element={<Navigate to="/admin?tab=products&pTab=moderation" replace />} />
                <Route path="orders" element={<Navigate to="/admin?tab=transactions" replace />} />

                {/* Careers / HR routes */}
                <Route path="applicants" element={<AdminApplicants />} />
                <Route path="careers/jobs" element={<AdminCareersJobs />} />
                <Route path="careers/config" element={<AdminCareersConfig />} />
                <Route path="employees/:employeeId/documents" element={<AdminEmployeeDocuments />} />
                <Route path="employees" element={<AdminEmployees />} />
                <Route path="employees/:employeeId" element={<AdminEmployeeDetails />} />

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

              {/* Admin redirect helpers & fallbacks */}
              <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />

              {/* Public careers pages */}
              <Route path="/careers" element={<CareersIndex />} />
              <Route path="/careers/:slug" element={<CareerJobDetail />} />
              <Route path="/careers/apply" element={<Careers />} />

              <Route path="/terms" element={<TermsConditions />} />
              <Route path="/cookies" element={<CookiesPage />} />
              <Route path="/unsubscribe" element={<UnsubscribeNewsletter />} />

              {/* keep wildcard LAST */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>

        <Footer />
      </div>
    </ModalProvider>
  );
}