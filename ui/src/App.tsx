import * as React from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  Suspense,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import ModalProvider from "./components/ModalProvider";
import { Toaster } from "react-hot-toast";
import toast from "react-hot-toast";
import ScrollToTop from "./components/ScrollToTop";
import AuthBootstrap from "./components/AuthBootstrap";
import SessionExpiredModal from "./components/SessionExpiredModal";

import { useAuthStore } from "./store/auth";
import { useIdleLogout } from "./hooks/useIdleLogout";
import api from "./api/client";

/* -----------------------------
   Lazy-loaded pages
----------------------------- */
const Catalog = React.lazy(() => import("./pages/Catalog"));
const ProductDetail = React.lazy(() => import("./pages/ProductDetail"));
const ProductReviews = React.lazy(() => import("./pages/ProductReviews"));
const Cart = React.lazy(() => import("./pages/Cart"));
const Checkout = React.lazy(() => import("./pages/Checkout"));
const Login = React.lazy(() => import("./pages/Login"));
const GoogleAuthCallback = React.lazy(() => import("./pages/GoogleAuthCallback"));
const Register = React.lazy(() => import("./pages/Register"));
const Verify = React.lazy(() => import("./pages/Verify"));
const Profile = React.lazy(() => import("./pages/Profile"));
const ForgotPassword = React.lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = React.lazy(() => import("./pages/ResetPassword"));
const Payment = React.lazy(() => import("./pages/Payment"));
const PaymentCallback = React.lazy(() => import("./pages/PaymentCallback"));
const Wishlist = React.lazy(() => import("./pages/Wishlist"));
const Orders = React.lazy(() => import("./pages/Orders"));
const ReceiptPage = React.lazy(() => import("./pages/Receipts"));
const ResetGuard = React.lazy(() => import("./routes/ResetGuard"));

const AdminDashboard = React.lazy(() => import("./pages/admin/AdminDashboard"));
const SettingsAdminPage = React.lazy(() => import("./pages/admin/SettingsAdminPage"));
const AdminApplicants = React.lazy(() => import("./pages/admin/AdminApplicants"));
const AdminOfferChangeRequests = React.lazy(
  () => import("./pages/admin/AdminOfferChangeRequests")
);
const AdminEmployeeDocuments = React.lazy(
  () => import("./pages/admin/AdminEmployeeDocuments")
);
const AdminEmployees = React.lazy(() => import("./pages/admin/AdminEmployees"));
const AdminCareersConfig = React.lazy(
  () => import("./pages/admin/AdminCareersConfig")
);
const AdminCareersJobs = React.lazy(() => import("./pages/admin/AdminCareersJobs"));
const AdminEmployeeDetails = React.lazy(
  () => import("./pages/admin/AdminEmployeeDetails")
);
const AdminNewsletterPage = React.lazy(
  () => import("./pages/admin/AdminNewsletter")
);
const AdminSupplierDocuments = React.lazy(
  () => import("./pages/admin/AdminSupplierDocuments")
);
const AdminShipping = React.lazy(() => import("./pages/admin/AdminShipping"));

const UserDashboard = React.lazy(() => import("./pages/UserDashboard"));
const SupplierRegister = React.lazy(() => import("./pages/supplier/SupplierRegister"));
const SupplierDashboard = React.lazy(
  () => import("./pages/supplier/SupplierDashboard")
);
const SupplierProductsPage = React.lazy(
  () => import("./pages/supplier/SupplierProducts")
);
const SupplierAddProductsPage = React.lazy(
  () => import("./pages/supplier/SupplierAddProducts")
);
const SupplierEditProduct = React.lazy(
  () => import("./pages/supplier/SupplierEditProduct")
);
const SupplierOrdersPage = React.lazy(
  () => import("./pages/supplier/SupplierOrders")
);
const SupplierPayoutsPage = React.lazy(
  () => import("./pages/supplier/SupplierPayouts")
);
const SupplierSettingsPage = React.lazy(
  () => import("./pages/supplier/SupplierSettings")
);
const SupplierShippingPage = React.lazy(
  () => import("./pages/supplier/SupplierShipping")
);
const SupplierCatalogRequests = React.lazy(
  () => import("./pages/supplier/SupplierCatalogRequests")
);
const AccountSessions = React.lazy(
  () => import("./pages/supplier/AccountSessions")
);
const SupplierRefunds = React.lazy(() => import("./pages/supplier/SupplierRefunds"));
const SupplierRiders = React.lazy(() => import("./pages/supplier/SupplierRiders"));
const SupplierCatalogOffers = React.lazy(
  () => import("./pages/supplier/SupplierCatalogOffers")
);
const SupplierVerifyContact = React.lazy(
  () => import("./pages/supplier/SupplierVerifyContact")
);
const SupplierBusinessDetails = React.lazy(
  () => import("./pages/supplier/SupplierBusinessDetails")
);
const SupplierOnboardingAddress = React.lazy(
  () => import("./pages/supplier/SupplierOnboardingAddress")
);
const SupplierOnboardingDocuments = React.lazy(
  () => import("./pages/supplier/SupplierOnboardingDocuments")
);

const RiderAcceptInvite = React.lazy(() => import("./pages/RiderAcceptInvite"));

const DataPrivacy = React.lazy(() => import("./pages/DataPrivacy"));
const About = React.lazy(() => import("./pages/AboutUs"));
const Contact = React.lazy(() => import("./pages/Contact"));
const Careers = React.lazy(() => import("./pages/Careers"));
const CareersIndex = React.lazy(() => import("./pages/CareersIndex"));
const CareerJobDetail = React.lazy(() => import("./pages/CareerJobDetail"));
const ReturnsRefunds = React.lazy(() => import("./pages/ReturnsRefunds"));
const HelpCenter = React.lazy(() => import("./pages/HelpCenter"));
const TermsConditions = React.lazy(() => import("./pages/TermsConditions"));
const CookiesPage = React.lazy(() => import("./pages/Cookies"));
const UnsubscribeNewsletter = React.lazy(
  () => import("./pages/UnsubscribeNewsletter")
);
const NotFound = React.lazy(() => import("./pages/NotFound"));

/* -----------------------------
   Small shared fallback
----------------------------- */
function RouteFallback({
  label = "Loading…",
  full = false,
}: {
  label?: string;
  full?: boolean;
}) {
  return (
    <div
      className={`${full ? "min-h-[60vh]" : "min-h-[40vh]"} flex items-center justify-center px-4`}
    >
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

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

function getTempVerifyToken() {
  try {
    return localStorage.getItem("tempToken") || "";
  } catch {
    return "";
  }
}

function hasTempVerifySession() {
  return !!String(getTempVerifyToken()).trim();
}

function normalizePathname(path: string) {
  const p = String(path || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  return p.replace(/\/+$/, "") || "/";
}

function isPublicSupplierPath(pathname: string) {
  const p = normalizePathname(pathname);
  return p === "/register-supplier" || p === "/supplier/verify-contact";
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

const SupplierStageContext = createContext<SupplierStageState | null>(null);

function useSupplierStage() {
  const ctx = useContext(SupplierStageContext);
  if (!ctx) {
    return {
      loading: false,
      contactDone: true,
      businessDone: true,
      addressDone: true,
      docsDone: true,
      onboardingDone: true,
      nextPath: null,
    } satisfies SupplierStageState;
  }
  return ctx;
}

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

        const docs = normalizeSupplierDocsLite((docsRes as any)?.data);
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

        const nextPath =
          supplierApproved || (contactDone && businessDone && addressDone && docsDone)
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
          onboardingDone: supplierApproved || (contactDone && businessDone && addressDone && docsDone),
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

function SupplierStageProvider({ children }: { children: React.ReactNode }) {
  const stage = useSupplierStageState();
  return (
    <SupplierStageContext.Provider value={stage}>
      {children}
    </SupplierStageContext.Provider>
  );
}


function SupplierVerifyContactRouteGuard() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!hydrated) {
    return <RouteFallback label="Loading verification…" />;
  }

  // Full session already exists
  if (user?.id) {
    return <SupplierVerifyContact />;
  }

  // Temporary verification session exists
  if (hasTempVerifySession()) {
    return <SupplierVerifyContact />;
  }

  return (
    <Navigate
      to={`/login?from=${encodeURIComponent(
        `${location.pathname}${location.search}`
      )}`}
      replace
      state={{ from: `${location.pathname}${location.search}` }}
    />
  );
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
  const stage = useSupplierStage();

  const role = normRole(user?.role);

  if (!hydrated) {
    return <RouteFallback label="Loading supplier access…" />;
  }

  if (!user?.id) {
    return (
      <Navigate
        to={`/login?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (role !== "SUPPLIER") return <>{children}</>;

  if (stage.loading) {
    return <RouteFallback label="Loading supplier access…" />;
  }

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
  const stage = useSupplierStage();
  const location = useLocation();

  const role = normRole(user?.role);

  if (!hydrated) {
    return <RouteFallback label="Loading supplier onboarding…" />;
  }

  if (!user?.id) {
    return (
      <Navigate
        to={`/login?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (role !== "SUPPLIER") return <>{children}</>;

  if (stage.loading) {
    return <RouteFallback label="Loading supplier onboarding…" />;
  }

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
  const stage = useSupplierStage();

  const role = normRole(user?.role);

  if (!hydrated) {
    return <RouteFallback label="Opening supplier dashboard…" />;
  }

  if (!user?.id) {
    return <Navigate to="/login?from=%2Fsupplier" replace state={{ from: "/supplier" }} />;
  }

  if (role === "SUPPLIER_RIDER") {
    return <Navigate to="/supplier/orders" replace />;
  }

  if (role === "ADMIN" || role === "SUPER_ADMIN") {
    return <SupplierDashboard />;
  }

  if (role !== "SUPPLIER") {
    return <Navigate to="/" replace />;
  }

  if (stage.loading) {
    return <RouteFallback label="Opening supplier dashboard…" />;
  }

  if (stage.nextPath) {
    return <Navigate to={stage.nextPath} replace />;
  }

  return <SupplierDashboard />;
}

function SupplierOrdersRouteGuard() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const role = normRole(user?.role);

  if (!hydrated) {
    return <RouteFallback label="Loading orders…" full />;
  }

  if (!user?.id) {
    return <Navigate to="/login?from=%2Fsupplier%2Forders" replace />;
  }

  if (
    role !== "SUPPLIER" &&
    role !== "SUPPLIER_RIDER" &&
    role !== "ADMIN" &&
    role !== "SUPER_ADMIN"
  ) {
    return <Navigate to="/" replace />;
  }

  if (role === "SUPPLIER") {
    return (
      <SupplierRestrictedPageGuard>
        <SupplierOrdersPage />
      </SupplierRestrictedPageGuard>
    );
  }

  return <SupplierOrdersPage />;
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

function normalizeSupplierDocsLite(raw: unknown): SupplierDocumentLite[] {
  const source = raw as
    | {
      data?: {
        data?: SupplierDocumentLite[];
        documents?: SupplierDocumentLite[];
      } | SupplierDocumentLite[];
      documents?: SupplierDocumentLite[];
    }
    | SupplierDocumentLite[]
    | null;

  const candidates: unknown[] = [
    source && typeof source === "object" && "data" in source
      ? (source as { data?: unknown }).data &&
      typeof (source as { data?: unknown }).data === "object" &&
      (source as { data?: { data?: SupplierDocumentLite[] } }).data?.data
      : undefined,
    source && typeof source === "object" && "data" in source
      ? (source as { data?: { documents?: SupplierDocumentLite[] } }).data?.documents
      : undefined,
    source && typeof source === "object" && "data" in source
      ? (source as { data?: unknown }).data
      : undefined,
    source && typeof source === "object" && "documents" in source
      ? (source as { documents?: SupplierDocumentLite[] }).documents
      : undefined,
    source,
  ];

  for (const item of candidates) {
    if (Array.isArray(item)) {
      return item as SupplierDocumentLite[];
    }
  }

  return [];
}

/** Role-aware landing page */
function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const stage = useSupplierStage();

  if (!hydrated) {
    return <Catalog />;
  }

  const isAuthed = !!user?.id;
  const r = normRole(user?.role);

  if (!isAuthed && hasTempVerifySession()) {
    return <Navigate to="/supplier/verify-contact" replace />;
  }

  if (isAuthed && r === "SUPPLIER") {
    if (stage.loading) {
      return <RouteFallback label="Opening supplier area…" />;
    }
    return <Navigate to={stage.nextPath || "/supplier"} replace />;
  }

  if (isAuthed && r === "SUPPLIER_RIDER") {
    return <Navigate to="/supplier/orders" replace />;
  }

  return <Catalog />;
}
function defaultAuthedPathForRole(role: unknown) {
  const r = normRole(role);
  if (r === "SUPPLIER") return "/supplier";
  if (r === "SUPPLIER_RIDER") return "/supplier/orders";
  if (r === "ADMIN" || r === "SUPER_ADMIN") return "/admin";
  return "/";
}

const PRESERVE_LOCAL_STORAGE_EXACT = new Set([
  "auth-storage",
  "persist:auth-storage",
  "auth:lastUserKey",
  "theme",
  "appearance",
  "accent_color",
]);

const PRESERVE_SESSION_STORAGE_EXACT = new Set([
  "auth:lastUserKey",
]);

function shouldPreserveLocalStorageKey(key: string) {
  const k = String(key || "").trim();
  if (!k) return true;

  if (PRESERVE_LOCAL_STORAGE_EXACT.has(k)) return true;

  if (
    k === "auth" ||
    k.startsWith("auth-storage") ||
    k.startsWith("persist:auth") ||
    k.startsWith("zustand-auth") ||
    k.startsWith("supabase.auth")
  ) {
    return true;
  }

  return false;
}

function shouldPreserveSessionStorageKey(key: string) {
  const k = String(key || "").trim();
  if (!k) return true;

  if (PRESERVE_SESSION_STORAGE_EXACT.has(k)) return true;

  return false;
}

function clearStorageBucket(
  storage: Storage,
  shouldPreserve: (key: string) => boolean
) {
  const keysToRemove: string[] = [];

  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (shouldPreserve(key)) continue;
    keysToRemove.push(key);
  }

  for (const key of keysToRemove) {
    try {
      storage.removeItem(key);
    } catch {
      //
    }
  }
}

function clearUserScopedBrowserStateForUserSwitch(nextUserKey: string) {
  try {
    clearStorageBucket(window.localStorage, shouldPreserveLocalStorageKey);
  } catch {
    //
  }

  try {
    clearStorageBucket(window.sessionStorage, shouldPreserveSessionStorageKey);
  } catch {
    //
  }

  try {
    sessionStorage.setItem("auth:lastUserKey", nextUserKey);
  } catch {
    //
  }

  try {
    window.dispatchEvent(
      new CustomEvent("app:user-switched", {
        detail: { userKey: nextUserKey },
      })
    );
  } catch {
    //
  }
}

function GuestOnlyPageGuard({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  if (!hydrated) return <RouteFallback label="Loading…" />;

  if (user?.id) {
    return <Navigate to={defaultAuthedPathForRole(user?.role)} replace />;
  }

  return <>{children}</>;
}

/**
 * Special case for /login:
 * when already authenticated, do not render Login.
 * App-level redirect effect will send the user to the right return target.
 */
function LoginRouteGuard() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  if (!hydrated) return <RouteFallback label="Loading…" />;
  if (user?.id) return null;

  return <Login />;
}

export default function App() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const queryClient = useQueryClient();

  const isAuthed = !!user?.id;

  const nav = useNavigate();
  const loc = useLocation();

  const riderAllowPrefixes = useMemo(() => ["/supplier/orders"], []);

  const prevAuthedRef = React.useRef(false);
  const prevUserKeyRef = React.useRef<string>("");
  const lastAuthedPathRef = React.useRef<string>("/");

  useIdleLogout();

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthed || !user?.id) return;

    const currentUserKey = getAuthUserKey(user);
    if (!currentUserKey) return;

    let previousUserKey = "";

    try {
      previousUserKey = sessionStorage.getItem("auth:lastUserKey") || "";
    } catch {
      //
    }

    if (!previousUserKey) {
      try {
        sessionStorage.setItem("auth:lastUserKey", currentUserKey);
      } catch {
        //
      }
      return;
    }

    if (previousUserKey === currentUserKey) {
      return;
    }

    clearUserScopedBrowserStateForUserSwitch(currentUserKey);

    try {
      queryClient.clear();
    } catch {
      //
    }

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
  }, [
    hydrated,
    isAuthed,
    user,
    user?.id,
    user?.role,
    loc.pathname,
    loc.search,
    nav,
    queryClient,
  ]);

  useEffect(() => {
    try {
      toast.dismiss();
    } catch { }

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
    } catch { }
  }, [loc.pathname, loc.search]);

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
        sessionStorage.setItem(
          "auth:timedOutReturnTo",
          previousPath.startsWith("/checkout") ? "/cart" : previousPath
        );
      } catch { }
    }

    prevAuthedRef.current = false;
    prevUserKeyRef.current = "";
  }, [hydrated, isAuthed, user?.id, user?.role, loc.pathname, loc.search]);

  useEffect(() => {
    if (!hydrated || user === undefined) return;
    if (isAuthed) return;

    const p = normalizePathname(loc.pathname);
    const hasTempVerify = hasTempVerifySession();

    // Allow supplier verify page when temp verification token exists.
    if (p === "/supplier/verify-contact" && hasTempVerify) {
      return;
    }

    const isProtectedSupplierPath =
      (p === "/supplier" || p.startsWith("/supplier/")) &&
      !isPublicSupplierPath(p);

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
    } catch { }

    const qp = encodeURIComponent(returnTarget);

    nav(`/login?from=${qp}`, {
      replace: true,
      state: { from: returnTarget },
    });
  }, [hydrated, user, isAuthed, loc.pathname, loc.search, nav]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("auth:returnTo");
      if (saved && saved.startsWith("/checkout")) {
        sessionStorage.setItem("auth:returnTo", "/cart");
      }
    } catch { }
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
    } catch { }

    const hasTimedOutUser = !!timedOutUserKey;
    const sameTimedOutUser =
      !!currentUserKey &&
      !!timedOutUserKey &&
      currentUserKey === timedOutUserKey;

    let target = defaultAuthedPathForRole(user?.role);

    if (sameTimedOutUser) {
      target = timedOutReturnTo || genericReturnTo || defaultAuthedPathForRole(user?.role);
    } else if (!hasTimedOutUser) {
      target = genericReturnTo || defaultAuthedPathForRole(user?.role);
    } else {
      target = defaultAuthedPathForRole(user?.role);
    }

    try {
      sessionStorage.removeItem("auth:returnTo");
      sessionStorage.removeItem("auth:timedOutReturnTo");
      sessionStorage.removeItem("auth:timedOutUserKey");
    } catch { }

    nav(target, { replace: true });
  }, [hydrated, isAuthed, user, loc.pathname, nav]);

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

                  <Route path="/login" element={<LoginRouteGuard />} />
                  <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/help" element={<HelpCenter />} />

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

                  <Route
                    path="/profile"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SHOPPER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPPLIER",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
                      >
                        <Profile />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/orders"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SHOPPER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
                      >
                        <Orders />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/returns-refunds"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SHOPPER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
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
                        roles={[
                          "SHOPPER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
                      >
                        <Wishlist />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/account/sessions"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SHOPPER",
                          "SUPPLIER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
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
                      <ProtectedRoute
                        roles={[
                          "SHOPPER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
                      >
                        <UserDashboard />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/rider"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SUPPLIER_RIDER",
                          "SUPPLIER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                        ]}
                      >
                        <Navigate to="/supplier/orders" replace />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/u/:userId/dashboard"
                    element={
                      <ProtectedRoute
                        roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <DashboardAsUser />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/u/:userId/profile"
                    element={
                      <ProtectedRoute
                        roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <ProfileAsUser />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/u/:userId/orders"
                    element={
                      <ProtectedRoute
                        roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <OrdersAsUser />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/u/:userId/wishlist"
                    element={
                      <ProtectedRoute
                        roles={["ADMIN", "SUPER_ADMIN", "SUPERADMIN", "SUPER ADMIN"]}
                      >
                        <WishlistAsUser />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/supplier/verify-contact"
                    element={<SupplierVerifyContactRouteGuard />}
                  />

                  <Route
                    path="/supplier/onboarding"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SUPPLIER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
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
                        roles={[
                          "SUPPLIER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
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
                        roles={[
                          "SUPPLIER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
                      >
                        <SupplierSequentialStepGuard step="documents">
                          <SupplierOnboardingDocuments />
                        </SupplierSequentialStepGuard>
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/supplier/orders"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SUPPLIER",
                          "SUPPLIER_RIDER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
                        riderAllowPrefixes={riderAllowPrefixes}
                      >
                        <SupplierOrdersRouteGuard />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/supplier/orders/:orderId"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SUPPLIER",
                          "SUPPLIER_RIDER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
                        riderAllowPrefixes={riderAllowPrefixes}
                      >
                        <SupplierOrdersRouteGuard />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/supplier"
                    element={
                      <ProtectedRoute
                        roles={[
                          "SUPPLIER",
                          "SUPPLIER_RIDER",
                          "ADMIN",
                          "SUPER_ADMIN",
                          "SUPERADMIN",
                          "SUPER ADMIN",
                        ]}
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
                          roles={[
                            "SUPPLIER",
                            "ADMIN",
                            "SUPER_ADMIN",
                            "SUPERADMIN",
                            "SUPER ADMIN",
                          ]}
                        >
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
                    <Route
                      path="employees/:employeeId"
                      element={<AdminEmployeeDetails />}
                    />

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

          <Footer />
        </div>
      </SupplierStageProvider>
    </ModalProvider>
  );
}