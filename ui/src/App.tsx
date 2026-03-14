import React, { useEffect, useMemo, useState } from "react";
import {
  Route,
  Routes,
  Navigate,
  Outlet,
  useParams,
  useLocation,
  useNavigate,
} from "react-router-dom";

import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";

import Catalog from "./pages/Catalog";
import ProductDetail from "./pages/ProductDetail";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Verify from "./pages/Verify";
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
import SupplierVerifyContact from "./pages/supplier/SupplierVerifyContact";
import SupplierBusinessDetails from "./pages/supplier/SupplierBusinessDetails";
import SupplierOnboardingAddress from "./pages/supplier/SupplierOnboardingAddress";
import SupplierOnboardingDocuments from "./pages/supplier/SupplierOnboardingDocuments";

import api from "./api/client";
import AdminSupplierDocuments from "./pages/admin/AdminSupplierDocuments";

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

function getAuthUserKey(user: any) {
  const id = String(user?.id ?? "").trim();
  const email = String(user?.email ?? "").trim().toLowerCase();
  return id || email || "";
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

/* -----------------------------
   Supplier onboarding routing
----------------------------- */

type SupplierDocKind =
  | "BUSINESS_REGISTRATION_CERTIFICATE"
  | "GOVERNMENT_ID"
  | "PROOF_OF_ADDRESS";

type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

type SupplierMeLite = {
  legalName?: string | null;
  name?: string | null;
  businessName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
  status?: string | null;
  kycStatus?: string | null;
  registeredAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
  pickupAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
};

type AuthMeLite = {
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

type SupplierStageState = {
  loading: boolean;
  contactDone: boolean;
  businessDone: boolean;
  addressDone: boolean;
  docsDone: boolean;
  onboardingDone: boolean;
  nextPath: string | null;
};

type SupplierStep = "verify" | "business" | "address" | "documents" | "dashboard";

function hasAddress(addr: any) {
  if (!addr) return false;
  return Boolean(
    String(addr.houseNumber ?? "").trim() ||
      String(addr.streetName ?? "").trim() ||
      String(addr.city ?? "").trim() ||
      String(addr.state ?? "").trim() ||
      String(addr.country ?? "").trim() ||
      String(addr.postCode ?? "").trim()
  );
}

function isRegisteredBusiness(registrationType?: string | null) {
  return String(registrationType ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS";
}

function docSatisfied(docs: SupplierDocumentLite[], kind: SupplierDocKind) {
  return docs.some((d) => {
    const k = String(d.kind ?? "").trim().toUpperCase();
    const s = String(d.status ?? "").trim().toUpperCase();
    return k === kind && (s === "PENDING" || s === "APPROVED");
  });
}

function isSupplierEffectivelyApproved(supplier?: SupplierMeLite | null) {
  const status = String(supplier?.status ?? "").trim().toUpperCase();
  const kycStatus = String(supplier?.kycStatus ?? "").trim().toUpperCase();

  const approvedStates = new Set([
    "APPROVED",
    "ACTIVE",
    "VERIFIED",
    "COMPLETED",
    "ENABLED",
  ]);

  return approvedStates.has(status) || approvedStates.has(kycStatus);
}

function getSupplierNextPath(stage: {
  contactDone: boolean;
  businessDone: boolean;
  addressDone: boolean;
  docsDone: boolean;
}) {
  if (!stage.contactDone) return "/supplier/verify-contact";
  if (!stage.businessDone) return "/supplier/onboarding";
  if (!stage.addressDone) return "/supplier/onboarding/address";
  if (!stage.docsDone) return "/supplier/onboarding/documents";
  return null;
}

function useSupplierStageState(): SupplierStageState {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  const [state, setState] = useState<SupplierStageState>({
    loading: true,
    contactDone: false,
    businessDone: false,
    addressDone: false,
    docsDone: false,
    onboardingDone: false,
    nextPath: null,
  });

  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (!hydrated) return;

      const role = normRole(user?.role);

      if (!user?.id || role !== "SUPPLIER") {
        if (!alive) return;
        setState({
          loading: false,
          contactDone: true,
          businessDone: true,
          addressDone: true,
          docsDone: true,
          onboardingDone: true,
          nextPath: null,
        });
        return;
      }

      try {
        const [authRes, supplierRes, docsRes] = await Promise.all([
          api.get("/api/auth/me", { withCredentials: true }),
          api.get("/api/supplier/me", { withCredentials: true }),
          api
            .get("/api/supplier/documents", { withCredentials: true })
            .catch(() => ({ data: { data: [] } })),
        ]);

        const authMe = ((authRes.data as any)?.data ??
          (authRes.data as any)?.user ??
          authRes.data ??
          {}) as AuthMeLite;

        const supplierMe = ((supplierRes.data as any)?.data ??
          supplierRes.data ??
          {}) as SupplierMeLite;

        const docsRaw = (docsRes as any)?.data?.data ?? (docsRes as any)?.data ?? [];
        const docs = Array.isArray(docsRaw) ? (docsRaw as SupplierDocumentLite[]) : [];

        const supplierApproved = isSupplierEffectivelyApproved(supplierMe);

        const contactDone =
          supplierApproved || (!!authMe?.emailVerified && !!authMe?.phoneVerified);

        const businessDone =
          supplierApproved ||
          Boolean(
            String(
              supplierMe?.legalName ??
                supplierMe?.businessName ??
                supplierMe?.name ??
                ""
            ).trim() &&
              String(supplierMe?.registrationType ?? "").trim() &&
              String(supplierMe?.registrationCountryCode ?? "").trim()
          );

        const addressDone =
          supplierApproved ||
          hasAddress(supplierMe?.registeredAddress) ||
          hasAddress(supplierMe?.pickupAddress);

        const requiredKinds: SupplierDocKind[] = [
          ...(isRegisteredBusiness(supplierMe?.registrationType)
            ? (["BUSINESS_REGISTRATION_CERTIFICATE"] as SupplierDocKind[])
            : []),
          "GOVERNMENT_ID",
          "PROOF_OF_ADDRESS",
        ];

        const docsDone =
          supplierApproved || requiredKinds.every((kind) => docSatisfied(docs, kind));

        const nextPath = supplierApproved
          ? null
          : getSupplierNextPath({
              contactDone,
              businessDone,
              addressDone,
              docsDone,
            });

        if (!alive) return;

        setState({
          loading: false,
          contactDone,
          businessDone,
          addressDone,
          docsDone,
          onboardingDone: supplierApproved || !nextPath,
          nextPath,
        });
      } catch {
        if (!alive) return;

        setState({
          loading: false,
          contactDone: false,
          businessDone: false,
          addressDone: false,
          docsDone: false,
          onboardingDone: false,
          nextPath: "/supplier/verify-contact",
        });
      }
    };

    void run();

    return () => {
      alive = false;
    };
  }, [hydrated, user?.id, user?.role]);

  return state;
}

function getRequiredPathForStep(step: SupplierStep, stage: SupplierStageState) {
  switch (step) {
    case "verify":
      return "/supplier/verify-contact";
    case "business":
      return stage.contactDone ? "/supplier/onboarding" : "/supplier/verify-contact";
    case "address":
      if (!stage.contactDone) return "/supplier/verify-contact";
      if (!stage.businessDone) return "/supplier/onboarding";
      return "/supplier/onboarding/address";
    case "documents":
      if (!stage.contactDone) return "/supplier/verify-contact";
      if (!stage.businessDone) return "/supplier/onboarding";
      if (!stage.addressDone) return "/supplier/onboarding/address";
      return "/supplier/onboarding/documents";
    case "dashboard":
      return stage.nextPath || "/supplier";
    default:
      return stage.nextPath || "/supplier";
  }
}

function SupplierRestrictedPageGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const location = useLocation();
  const stage = useSupplierStageState();

  const role = normRole(user?.role);

  if (!hydrated) return null;
  if (!user?.id || role !== "SUPPLIER") return <>{children}</>;
  if (stage.loading) return null;

  if (!stage.onboardingDone && stage.nextPath) {
    return (
      <Navigate
        to={stage.nextPath}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
}

function SupplierSequentialStepGuard({
  step,
  children,
}: {
  step: SupplierStep;
  children: React.ReactNode;
}) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const stage = useSupplierStageState();
  const location = useLocation();

  const role = normRole(user?.role);

  if (!hydrated) return null;
  if (!user?.id || role !== "SUPPLIER") return <>{children}</>;
  if (stage.loading) return null;

  const requiredPath = getRequiredPathForStep(step, stage);
  const currentPath = location.pathname;

  if (requiredPath !== currentPath) {
    return <Navigate to={requiredPath} replace state={{ from: currentPath }} />;
  }

  return <>{children}</>;
}

function SupplierEntryRoute() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const stage = useSupplierStageState();

  const role = normRole(user?.role);

  if (!hydrated) return null;

  if (!user?.id || role !== "SUPPLIER") return <SupplierDashboard />;
  if (stage.loading) return null;

  if (!stage.onboardingDone && stage.nextPath) {
    return <Navigate to={stage.nextPath} replace />;
  }

  return <SupplierDashboard />;
}

function RoleDashboardRoute() {
  const user = useAuthStore((s) => s.user);
  const roleNorm = normRole(user?.role);

  if (roleNorm === "SUPPLIER") {
    return (
      <SupplierRestrictedPageGuard>
        <SupplierDashboard />
      </SupplierRestrictedPageGuard>
    );
  }

  if (roleNorm === "SUPPLIER_RIDER") return <Navigate to="/supplier/orders" replace />;
  if (roleNorm === "ADMIN" || roleNorm === "SUPER_ADMIN") return <AdminDashboard />;
  return <UserDashboard />;
}

/** Role-aware landing page */
function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) return <Catalog />;

  const isAuthed = !!user?.id;
  const r = normRole(user?.role);

  if (isAuthed && r === "SUPPLIER") return <Navigate to="/supplier" replace />;
  if (isAuthed && r === "SUPPLIER_RIDER") return <Navigate to="/supplier/orders" replace />;

  return <Catalog />;
}

export default function App() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  const isAuthed = !!user?.id;

  const nav = useNavigate();
  const loc = useLocation();

  const riderAllowPrefixes = useMemo(() => ["/supplier/orders"], []);

  const prevAuthedRef = React.useRef(false);
  const prevUserKeyRef = React.useRef<string>("");
  const lastAuthedPathRef = React.useRef<string>("/");

  useIdleLogout();

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

  useEffect(() => {
    if (!hydrated) return;

    if (isAuthed) {
      const currentPath = `${loc.pathname}${loc.search}`;
      if (loc.pathname !== "/login") {
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
        sessionStorage.setItem(
          "auth:timedOutReturnTo",
          previousPath.startsWith("/checkout") ? "/cart" : previousPath
        );
      } catch {}
    }

    prevAuthedRef.current = false;
    prevUserKeyRef.current = "";
  }, [hydrated, isAuthed, user, loc.pathname, loc.search]);

  useEffect(() => {
    if (!hydrated) return;
    if (isAuthed) return;

    const p = loc.pathname;

    const publicSupplierPaths = new Set([
      "/register-supplier",
      "/supplier/verify-contact",
    ]);

    const isProtectedSupplierPath =
      (p === "/supplier" || p.startsWith("/supplier/")) &&
      !publicSupplierPaths.has(p);

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

    const rawTarget = `${loc.pathname}${loc.search}`;
    const returnTarget = p === "/checkout" ? "/cart" : rawTarget;

    try {
      sessionStorage.setItem("auth:returnTo", returnTarget);
    } catch {}

    const qp = encodeURIComponent(returnTarget);
    nav(`/login?from=${qp}`, { replace: true, state: { from: returnTarget } });
  }, [hydrated, isAuthed, loc.pathname, loc.search, nav]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("auth:returnTo");
      if (saved && saved.startsWith("/checkout")) {
        sessionStorage.setItem("auth:returnTo", "/cart");
      }
    } catch {}
  }, [loc.pathname]);

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

    const sameTimedOutUser =
      !!currentUserKey &&
      !!timedOutUserKey &&
      currentUserKey === timedOutUserKey;

    const target = sameTimedOutUser
      ? timedOutReturnTo || genericReturnTo || "/"
      : "/";

    try {
      sessionStorage.removeItem("auth:returnTo");
      sessionStorage.removeItem("auth:timedOutReturnTo");
      sessionStorage.removeItem("auth:timedOutUserKey");
    } catch {}

    nav(target, { replace: true });
  }, [hydrated, isAuthed, user, loc.pathname, nav]);

  return (
    <ModalProvider>
      <div className="min-h-screen flex flex-col">
        <AuthBootstrap />

        <main className="w-full flex-1 bg-slate-50">
          <div className="max-w-7xl mx-auto">
            <Toaster position="top-right" />
            <ScrollToTop />

            <Routes key={loc.key}>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/products/:id" element={<ProductDetail />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/privacy" element={<DataPrivacy />} />
              <Route path="/payment" element={<Payment />} />
              <Route path="/payment-callback" element={<PaymentCallback />} />
              <Route path="/receipt/:paymentId" element={<ReceiptPage />} />
              <Route path="/rider/accept" element={<RiderAcceptInvite />} />

              <Route path="/login" element={<Login />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/help" element={<HelpCenter />} />
              <Route
                path="/register"
                element={hydrated && isAuthed ? <Navigate to="/" replace /> : <Register />}
              />
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
                    <RoleDashboardRoute />
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
                  <ProtectedRoute
                    roles={["SUPPLIER_RIDER", "SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN"]}
                  >
                    <Navigate to="/supplier/orders" replace />
                  </ProtectedRoute>
                }
              />

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

              <Route path="/supplier/verify-contact" element={<SupplierVerifyContact />} />

              <Route
                path="/supplier/onboarding"
                element={
                  <ProtectedRoute roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <SupplierSequentialStepGuard step="business">
                      <SupplierBusinessDetails />
                    </SupplierSequentialStepGuard>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/supplier/onboarding/address"
                element={
                  <ProtectedRoute roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <SupplierSequentialStepGuard step="address">
                      <SupplierOnboardingAddress />
                    </SupplierSequentialStepGuard>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/supplier/onboarding/documents"
                element={
                  <ProtectedRoute roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <SupplierSequentialStepGuard step="documents">
                      <SupplierOnboardingDocuments />
                    </SupplierSequentialStepGuard>
                  </ProtectedRoute>
                }
              />

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
                  path="orders"
                  element={
                    <ProtectedRoute
                      roles={["SUPPLIER", "SUPPLIER_RIDER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                    >
                      {normRole(user?.role) === "SUPPLIER" ? (
                        <SupplierRestrictedPageGuard>
                          <SupplierOrdersPage />
                        </SupplierRestrictedPageGuard>
                      ) : (
                        <SupplierOrdersPage />
                      )}
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="orders/:orderId"
                  element={
                    <ProtectedRoute
                      roles={["SUPPLIER", "SUPPLIER_RIDER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                    >
                      {normRole(user?.role) === "SUPPLIER" ? (
                        <SupplierRestrictedPageGuard>
                          <SupplierOrdersPage />
                        </SupplierRestrictedPageGuard>
                      ) : (
                        <SupplierOrdersPage />
                      )}
                    </ProtectedRoute>
                  }
                />

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
                    <ProtectedRoute roles={["SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                      {normRole(user?.role) === "SUPPLIER" ? (
                        <SupplierRestrictedPageGuard>
                          <SupplierRiders />
                        </SupplierRestrictedPageGuard>
                      ) : (
                        <SupplierRiders />
                      )}
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

              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="supplier-documents" element={<AdminSupplierDocuments />} />
                <Route path="offer-changes" element={<AdminOfferChangeRequests />} />
                <Route path="newsletter" element={<AdminNewsletterPage />} />
                <Route path="dashboard" element={<Navigate to="/admin" replace />} />
                <Route path="products" element={<Navigate to="/admin?tab=products&pTab=manage" replace />} />
                <Route
                  path="products/moderation"
                  element={<Navigate to="/admin?tab=products&pTab=moderation" replace />}
                />
                <Route path="orders" element={<Navigate to="/admin?tab=transactions" replace />} />

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

              <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />

              <Route path="/careers" element={<CareersIndex />} />
              <Route path="/careers/:slug" element={<CareerJobDetail />} />
              <Route path="/careers/apply" element={<Careers />} />

              <Route path="/terms" element={<TermsConditions />} />
              <Route path="/cookies" element={<CookiesPage />} />
              <Route path="/unsubscribe" element={<UnsubscribeNewsletter />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>

        <Footer />
      </div>
    </ModalProvider>
  );
}