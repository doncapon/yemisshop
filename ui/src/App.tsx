import * as React from "react";
import { useEffect, useMemo, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Route,
  Routes,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";

import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import ModalProvider from "./components/ModalProvider";
import ScrollToTop from "./components/ScrollToTop";
import AuthBootstrap from "./components/AuthBootstrap";
import SessionExpiredModal from "./components/SessionExpiredModal";
import RouteFallback from "./components/RouteFallback";

import { mergeGuestCartIntoUserCart, useAuthStore } from "./store/auth";
import { useIdleLogout } from "./hooks/useIdleLogout";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import api from "./api/client";

import {
  normRole,
  getAuthUserKey,
  normalizePathname,
  isPublicSupplierPath,
  defaultAuthedPathForRole,
  hasTempVerifySession,
} from "./lib/roles";
import { clearUserScopedBrowserStateForUserSwitch } from "./lib/storage";
import { SupplierStageProvider } from "./supplier/stage";

import {
  HomeRoute,
  AdminLayout,
  GuestOnlyPageGuard,
  LoginRouteGuard,
  RoleDashboardRoute,
  DashboardAsUser,
  ProfileAsUser,
  OrdersAsUser,
  WishlistAsUser,
} from "./components/guards/AuthGuards";
import {
  SupplierLayoutShell,
  SupplierVerifyContactRouteGuard,
  SupplierRestrictedPageGuard,
  SupplierSequentialStepGuard,
  SupplierEntryRoute,
  SupplierOrdersRouteGuard,
  SupplierRidersRoute,
} from "./components/guards/SupplierGuards";

import {
  ProductDetail,
  ProductReviews,
  Cart,
  Checkout,
  GoogleAuthCallback,
  Register,
  Verify,
  Profile,
  ForgotPassword,
  ResetPassword,
  Payment,
  PaymentCallback,
  Wishlist,
  Orders,
  ReceiptPage,
  ReturnsRefunds,
  UserDashboard,
  AccountSessions,
  RiderAcceptInvite,
  DataPrivacy,
  About,
  Contact,
  HelpCenter,
  Careers,
  CareersIndex,
  CareerJobDetail,
  TermsConditions,
  CookiesPage,
  UnsubscribeNewsletter,
  NotFound,
  SupplierRegister,
  SupplierProductsPage,
  SupplierAddProductsPage,
  SupplierEditProduct,
  SupplierPayoutsPage,
  SupplierSettingsPage,
  SupplierShippingPage,
  SupplierCatalogRequests,
  SupplierRefunds,
  SupplierCatalogOffers,
  SupplierBusinessDetails,
  SupplierOnboardingAddress,
  SupplierOnboardingDocuments,
  AdminDashboard,
  SettingsAdminPage,
  AdminApplicants,
  AdminOfferChangeRequests,
  AdminEmployeeDocuments,
  AdminEmployees,
  AdminCareersConfig,
  AdminCareersJobs,
  AdminEmployeeDetails,
  AdminNewsletterPage,
  AdminSupplierDocuments,
  AdminShipping,
  ResetGuard,
} from "./routes/lazy";

/* ─────────────────────────────────────────────────────────────────── */

const riderAllowPrefixes = ["/supplier/orders"];

export default function App() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const queryClient = useQueryClient();

  const isAuthed = !!user?.id;

  const nav = useNavigate();
  const loc = useLocation();

  const memoRiderPrefixes = useMemo(() => riderAllowPrefixes, []);

  const prevAuthedRef = React.useRef(false);
  const prevUserKeyRef = React.useRef<string>("");
  const lastAuthedPathRef = React.useRef<string>("/");

  useIdleLogout();

  const setUser = useAuthStore((s) => s.setUser);
  const setNeedsVerification = useAuthStore((s) => s.setNeedsVerification);

  /* ── Native deep-link handler (OAuth + Payment) ── */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function handleOAuthDeepLink(url: string) {
      const qIdx = url.indexOf("?");
      const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
      const ott = params.get("ott");
      const returnTo = params.get("returnTo") || "/";
      const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
      if (!ott) return;
      try {
        const res = await api.get("/api/auth/mobile-session", { params: { ott }, withCredentials: true });
        const profile = res.data?.profile ?? res.data?.data ?? res.data;
        if (!profile?.id) return;
        setUser(profile);
        setNeedsVerification(false);
        try { mergeGuestCartIntoUserCart(String(profile.id)); } catch {}
        queueMicrotask(() => window.dispatchEvent(new Event("cart:updated")));
        nav(safe, { replace: true });
      } catch { /* OTT invalid or expired — stay on current page */ }
    }

    async function handlePaymentDeepLink(url: string) {
      const qIdx = url.indexOf("?");
      const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
      const orderId = params.get("orderId");
      const reference = params.get("reference");
      const gateway = params.get("gateway") || "paystack";
      if (!orderId || !reference) return;
      try { await Browser.close(); } catch {}
      nav(
        `/payment-callback?orderId=${encodeURIComponent(orderId)}&reference=${encodeURIComponent(reference)}&gateway=${encodeURIComponent(gateway)}`,
        { replace: true }
      );
    }

    async function handleDeepLink(url: string) {
      if (url.startsWith("dayspring://auth/callback")) {
        await handleOAuthDeepLink(url);
      } else if (url.startsWith("dayspring://payment/callback")) {
        await handlePaymentDeepLink(url);
      }
    }

    let handle: { remove: () => void } | null = null;
    CapApp.addListener("appUrlOpen", ({ url }) => void handleDeepLink(url))
      .then((h) => { handle = h; });

    // Handle the case where the app was cold-started by the deep link
    CapApp.getLaunchUrl().then((res) => { if (res?.url) void handleDeepLink(res.url); }).catch(() => {});

    return () => { handle?.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Android keyboard: keep focused input visible ── */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // visualViewport.height is more reliable than innerHeight on Android —
    // it updates immediately when the keyboard appears with adjustResize.
    const getVH = () => window.visualViewport?.height ?? window.innerHeight;
    const baseH = getVH();

    const scrollInputIntoView = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;

      const currH = getVH();
      const kbH = Math.max(0, baseH - currH);

      // Pad the body so the window has enough scroll range to center the input.
      // (Without this, the page may be too short to scroll the input to center.)
      if (kbH > 50) {
        document.body.style.paddingBottom = `${kbH + 20}px`;
      }

      // One rAF lets the browser reflow the new paddingBottom before we read
      // getBoundingClientRect and call scrollTo.
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const targetY = window.scrollY + rect.top + rect.height / 2 - currH / 2;
        window.scrollTo({ top: Math.max(0, targetY), behavior: "instant" as ScrollBehavior });
      });
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      window.setTimeout(scrollInputIntoView, 350);
      window.setTimeout(scrollInputIntoView, 650);
    };

    const onResize = () => {
      const kbH = Math.max(0, baseH - getVH());
      if (kbH < 50) {
        document.body.style.paddingBottom = "";
        return;
      }
      window.setTimeout(scrollInputIntoView, 100);
    };

    document.addEventListener("focusin", onFocusIn, true);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
      document.body.style.paddingBottom = "";
    };
  }, []);

  /* ── User-switch: clear stale browser state ── */
  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthed || !user?.id) return;

    const currentUserKey = getAuthUserKey(user);
    if (!currentUserKey) return;

    let previousUserKey = "";
    try {
      previousUserKey = sessionStorage.getItem("auth:lastUserKey") || "";
    } catch {}

    if (!previousUserKey) {
      try {
        sessionStorage.setItem("auth:lastUserKey", currentUserKey);
      } catch {}
      return;
    }

    if (previousUserKey === currentUserKey) return;

    clearUserScopedBrowserStateForUserSwitch(currentUserKey);

    try {
      queryClient.clear();
    } catch {}

    const target = defaultAuthedPathForRole(user?.role);
    const currentFullPath = `${loc.pathname}${loc.search}`;
    const targetFullPath = String(target || "/");

    if (currentFullPath !== targetFullPath) {
      nav(targetFullPath, { replace: true });
      return;
    }

    if (loc.search || window.location.hash) {
      nav(targetFullPath, { replace: true });
    }
  }, [hydrated, isAuthed, user, user?.id, user?.role, loc.pathname, loc.search, nav, queryClient]);

  /* ── Reset scroll-lock / toasts on route change ── */
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
  }, [loc.pathname, loc.search]);

  /* ── Track last authenticated path / session-timeout marker ── */
  useEffect(() => {
    if (!hydrated) return;

    if (isAuthed) {
      const currentPath = `${loc.pathname}${loc.search}`;
      const guestOnlyPaths = new Set([
        "/login",
        "/register",
        "/register-supplier",
        "/forgot-password",
        "/reset-password",
      ]);

      if (!guestOnlyPaths.has(loc.pathname)) {
        lastAuthedPathRef.current = currentPath || "/";
      }

      prevAuthedRef.current = true;
      prevUserKeyRef.current = getAuthUserKey(user);
      return;
    }

    if (prevAuthedRef.current) {
      const previousUserKey = prevUserKeyRef.current;
      const previousPath = lastAuthedPathRef.current || "/";

      try {
        sessionStorage.setItem("auth:timedOutUserKey", previousUserKey);
        sessionStorage.setItem("auth:timedOutReturnTo", previousPath);
      } catch {}
    }

    prevAuthedRef.current = false;
    prevUserKeyRef.current = "";
  }, [hydrated, isAuthed, user?.id, user?.role, loc.pathname, loc.search]);

  /* ── Redirect unauthenticated users away from protected paths ── */
  useEffect(() => {
    if (!hydrated || user === undefined) return;
    if (isAuthed) return;

    const p = normalizePathname(loc.pathname);
    const hasTempVerify = hasTempVerifySession();

    if (p === "/supplier/verify-contact" && hasTempVerify) return;

    const isProtectedSupplierPath =
      (p === "/supplier" || p.startsWith("/supplier/")) && !isPublicSupplierPath(p);

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
      isProtectedSupplierPath ||
      p === "/rider" ||
      p.startsWith("/u/");

    if (!isProtectedPath) return;
    if (p === "/login") return;

    const returnTarget = `${loc.pathname}${loc.search}`;

    try {
      sessionStorage.setItem("auth:returnTo", returnTarget);
    } catch {}

    nav(`/login?from=${encodeURIComponent(returnTarget)}`, {
      replace: true,
      state: { from: returnTarget },
    });
  }, [hydrated, user, isAuthed, loc.pathname, loc.search, nav]);

  /* ── Redirect already-authed user away from /login ── */
  useEffect(() => {
    if (!hydrated || !isAuthed) return;
    if (loc.pathname !== "/login") return;

    const currentUserKey = getAuthUserKey(user);

    let timedOutUserKey = "";
    let timedOutReturnTo = "";
    let genericReturnTo = "";

    try {
      timedOutUserKey = sessionStorage.getItem("auth:timedOutUserKey") || "";
      timedOutReturnTo = sessionStorage.getItem("auth:timedOutReturnTo") || "";
      genericReturnTo = sessionStorage.getItem("auth:returnTo") || "";
    } catch {}

    const hasTimedOutUser = !!timedOutUserKey;
    const sameTimedOutUser =
      !!currentUserKey && !!timedOutUserKey && currentUserKey === timedOutUserKey;

    let target = defaultAuthedPathForRole(user?.role);

    if (sameTimedOutUser) {
      target = timedOutReturnTo || genericReturnTo || defaultAuthedPathForRole(user?.role);
    } else if (!hasTimedOutUser) {
      target = genericReturnTo || defaultAuthedPathForRole(user?.role);
    }

    try {
      sessionStorage.removeItem("auth:returnTo");
      sessionStorage.removeItem("auth:timedOutReturnTo");
      sessionStorage.removeItem("auth:timedOutUserKey");
    } catch {}

    nav(target, { replace: true });
  }, [hydrated, isAuthed, user, loc.pathname, nav]);

  /* ── Route tree ── */
  return (
    <ModalProvider>
      <SupplierStageProvider>
        <div className="min-h-screen flex flex-col">
          <AuthBootstrap />
          <SessionExpiredModal />

          <main className="w-full flex-1 bg-slate-50">
            <div className="max-w-7xl mx-auto">
              <Toaster position="top-right" />
              <ScrollToTop />

              <Suspense fallback={<RouteFallback label="Loading page…" full />}>
                <Routes>
                  {/* ── Public ── */}
                  <Route path="/" element={<HomeRoute />} />
                  <Route path="/products/:id" element={<ProductDetail />} />
                  <Route path="/products/:id/reviews" element={<ProductReviews />} />
                  <Route path="/cart" element={<Cart />} />
                  <Route path="/verify" element={<Verify />} />
                  <Route path="/privacy" element={<DataPrivacy />} />
                  <Route path="/payment" element={<Payment />} />
                  <Route path="/payment-callback" element={<PaymentCallback />} />
                  <Route path="/receipt/:paymentId" element={<ReceiptPage />} />
                  <Route path="/rider/accept" element={<RiderAcceptInvite />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/help" element={<HelpCenter />} />

                  {/* ── Auth ── */}
                  <Route path="/login" element={<LoginRouteGuard />} />
                  <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />

                  <Route
                    path="/register"
                    element={
                      <GuestOnlyPageGuard>
                        <Register />
                      </GuestOnlyPageGuard>
                    }
                  />
                  <Route
                    path="/register-supplier"
                    element={
                      <GuestOnlyPageGuard>
                        <SupplierRegister />
                      </GuestOnlyPageGuard>
                    }
                  />
                  <Route
                    path="/forgot-password"
                    element={
                      <GuestOnlyPageGuard>
                        <ForgotPassword />
                      </GuestOnlyPageGuard>
                    }
                  />
                  <Route
                    path="/reset-password"
                    element={
                      <GuestOnlyPageGuard>
                        <ResetGuard>
                          <ResetPassword />
                        </ResetGuard>
                      </GuestOnlyPageGuard>
                    }
                  />

                  {/* ── Protected shopper ── */}
                  <Route
                    path="/profile"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPPLIER", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <Profile />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/orders"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <Orders />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/returns-refunds"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <ReturnsRefunds />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/checkout"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <Checkout />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/wishlist"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <Wishlist />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/account/sessions"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <AccountSessions />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPPLIER", "SUPPLIER_RIDER", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <RoleDashboardRoute />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/customer-dashboard"
                    element={
                      <ProtectedRoute
                        roles={["SHOPPER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <UserDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/rider"
                    element={
                      <ProtectedRoute
                        roles={["SUPPLIER_RIDER", "SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN"]}
                      >
                        <Navigate to="/supplier/orders" replace />
                      </ProtectedRoute>
                    }
                  />

                  {/* ── Admin view-as ── */}
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

                  {/* ── Supplier onboarding ── */}
                  <Route
                    path="/supplier/verify-contact"
                    element={<SupplierVerifyContactRouteGuard />}
                  />
                  <Route
                    path="/supplier/onboarding"
                    element={
                      <ProtectedRoute
                        roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <SupplierSequentialStepGuard step="business">
                          <SupplierBusinessDetails />
                        </SupplierSequentialStepGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/supplier/onboarding/address"
                    element={
                      <ProtectedRoute
                        roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <SupplierSequentialStepGuard step="address">
                          <SupplierOnboardingAddress />
                        </SupplierSequentialStepGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/supplier/onboarding/documents"
                    element={
                      <ProtectedRoute
                        roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <SupplierSequentialStepGuard step="documents">
                          <SupplierOnboardingDocuments />
                        </SupplierSequentialStepGuard>
                      </ProtectedRoute>
                    }
                  />

                  {/* ── Supplier orders (outside nested layout) ── */}
                  <Route
                    path="/supplier/orders"
                    element={
                      <ProtectedRoute
                        roles={["SUPPLIER", "SUPPLIER_RIDER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                        riderAllowPrefixes={memoRiderPrefixes}
                      >
                        <SupplierOrdersRouteGuard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/supplier/orders/:orderId"
                    element={
                      <ProtectedRoute
                        roles={["SUPPLIER", "SUPPLIER_RIDER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                        riderAllowPrefixes={memoRiderPrefixes}
                      >
                        <SupplierOrdersRouteGuard />
                      </ProtectedRoute>
                    }
                  />

                  {/* ── Supplier dashboard (nested layout) ── */}
                  <Route
                    path="/supplier"
                    element={
                      <ProtectedRoute
                        roles={["SUPPLIER", "SUPPLIER_RIDER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                        riderAllowPrefixes={memoRiderPrefixes}
                      >
                        <SupplierLayoutShell />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<SupplierEntryRoute />} />

                    <Route
                      path="catalog-offers"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <SupplierCatalogOffers />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    />

                    <Route
                      path="products"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <Outlet />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    >
                      <Route index element={<SupplierProductsPage />} />
                      <Route path="add" element={<SupplierAddProductsPage />} />
                      <Route path=":id/edit" element={<SupplierEditProduct />} />
                    </Route>

                    <Route
                      path="refunds"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <SupplierRefunds />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="refund/:refundId"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <SupplierRefunds />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    />

                    <Route
                      path="riders"
                      element={
                        <ProtectedRoute
                          roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                        >
                          <SupplierRidersRoute />
                        </ProtectedRoute>
                      }
                    />

                    <Route
                      path="catalog-requests"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <SupplierCatalogRequests />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="payouts"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <SupplierPayoutsPage />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="shipping"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <SupplierShippingPage />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="settings"
                      element={
                        <ProtectedRoute roles={["SUPPLIER"]}>
                          <SupplierRestrictedPageGuard>
                            <SupplierSettingsPage />
                          </SupplierRestrictedPageGuard>
                        </ProtectedRoute>
                      }
                    />

                    <Route path="*" element={<Navigate to="/supplier" replace />} />
                  </Route>

                  {/* ── Admin ── */}
                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute
                        roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <AdminLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<AdminDashboard />} />
                    <Route path="supplier-documents" element={<AdminSupplierDocuments />} />
                    <Route path="offer-changes" element={<AdminOfferChangeRequests />} />
                    <Route path="newsletter" element={<AdminNewsletterPage />} />
                    <Route path="dashboard" element={<Navigate to="/admin" replace />} />
                    <Route path="shipping" element={<AdminShipping />} />
                    <Route
                      path="products"
                      element={<Navigate to="/admin?tab=products&pTab=manage" replace />}
                    />
                    <Route
                      path="products/moderation"
                      element={<Navigate to="/admin?tab=products&pTab=moderation" replace />}
                    />
                    <Route
                      path="orders"
                      element={<Navigate to="/admin?tab=transactions" replace />}
                    />
                    <Route path="applicants" element={<AdminApplicants />} />
                    <Route path="careers/jobs" element={<AdminCareersJobs />} />
                    <Route path="careers/config" element={<AdminCareersConfig />} />
                    <Route
                      path="employees/:employeeId/documents"
                      element={<AdminEmployeeDocuments />}
                    />
                    <Route path="employees" element={<AdminEmployees />} />
                    <Route path="employees/:employeeId" element={<AdminEmployeeDetails />} />
                    <Route
                      path="settings"
                      element={
                        <ProtectedRoute
                          roles={["SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                        >
                          <SettingsAdminPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="*" element={<Navigate to="/admin" replace />} />
                  </Route>

                  <Route
                    path="/admin/dashboard"
                    element={<Navigate to="/admin" replace />}
                  />

                  {/* ── Legal / misc ── */}
                  <Route path="/careers" element={<CareersIndex />} />
                  <Route path="/careers/:slug" element={<CareerJobDetail />} />
                  <Route path="/careers/apply" element={<Careers />} />
                  <Route path="/terms" element={<TermsConditions />} />
                  <Route path="/cookies" element={<CookiesPage />} />
                  <Route path="/unsubscribe" element={<UnsubscribeNewsletter />} />

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </div>
          </main>

          {!/^\/(login|register(-supplier)?|forgot-password|reset-password|verify)(\/|$)/.test(loc.pathname) && (
            <Footer />
          )}
        </div>
      </SupplierStageProvider>
    </ModalProvider>
  );
}
