import { lazy } from "react";
import type { ComponentType } from "react";

/**
 * Wraps React.lazy so that a "Failed to fetch dynamically imported module" error
 * (caused by stale chunk hashes after a new deploy) triggers a one-time hard
 * reload. A sessionStorage timestamp guard prevents infinite reload loops.
 */
function lazyWithChunkReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy((): Promise<{ default: T }> =>
    factory().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      const isChunkError =
        msg.includes("dynamically imported module") ||
        msg.includes("Importing a module script failed") ||
        msg.includes("Failed to fetch");

      if (isChunkError) {
        const lastReload = Number(sessionStorage.getItem("chunk_reload_ts") ?? 0);
        if (Date.now() - lastReload > 10_000) {
          sessionStorage.setItem("chunk_reload_ts", String(Date.now()));
          window.location.reload();
          return new Promise<{ default: T }>(() => {}); // suspend while reloading
        }
      }
      throw e;
    }),
  );
}

/* ── Shopper / public ── */
export const Catalog = lazyWithChunkReload(() => import("../pages/Catalog"));
export const ProductDetail = lazyWithChunkReload(() => import("../pages/ProductDetail"));
export const ProductReviews = lazyWithChunkReload(() => import("../pages/ProductReviews"));
export const Cart = lazyWithChunkReload(() => import("../pages/Cart"));
export const Checkout = lazyWithChunkReload(() => import("../pages/Checkout"));
export const Verify = lazyWithChunkReload(() => import("../pages/Verify"));
export const Payment = lazyWithChunkReload(() => import("../pages/Payment"));
export const PaymentCallback = lazyWithChunkReload(() => import("../pages/PaymentCallback"));
export const ReceiptPage = lazyWithChunkReload(() => import("../pages/Receipts"));
export const RiderAcceptInvite = lazyWithChunkReload(() => import("../pages/RiderAcceptInvite"));
export const Wishlist = lazyWithChunkReload(() => import("../pages/Wishlist"));
export const Orders = lazyWithChunkReload(() => import("../pages/Orders"));
export const Profile = lazyWithChunkReload(() => import("../pages/Profile"));
export const ReturnsRefunds = lazyWithChunkReload(() => import("../pages/ReturnsRefunds"));
export const UserDashboard = lazyWithChunkReload(() => import("../pages/UserDashboard"));
export const AccountSessions = lazyWithChunkReload(() => import("../pages/supplier/AccountSessions"));

/* ── Auth ── */
export const Login = lazyWithChunkReload(() => import("../pages/Login"));
export const Register = lazyWithChunkReload(() => import("../pages/Register"));
export const ForgotPassword = lazyWithChunkReload(() => import("../pages/ForgotPassword"));
export const ResetPassword = lazyWithChunkReload(() => import("../pages/ResetPassword"));
export const GoogleAuthCallback = lazyWithChunkReload(() => import("../pages/GoogleAuthCallback"));

/* ── Info / legal ── */
export const DataPrivacy = lazyWithChunkReload(() => import("../pages/DataPrivacy"));
export const About = lazyWithChunkReload(() => import("../pages/AboutUs"));
export const Contact = lazyWithChunkReload(() => import("../pages/Contact"));
export const HelpCenter = lazyWithChunkReload(() => import("../pages/HelpCenter"));
export const Careers = lazyWithChunkReload(() => import("../pages/Careers"));
export const CareersIndex = lazyWithChunkReload(() => import("../pages/CareersIndex"));
export const CareerJobDetail = lazyWithChunkReload(() => import("../pages/CareerJobDetail"));
export const TermsConditions = lazyWithChunkReload(() => import("../pages/TermsConditions"));
export const CookiesPage = lazyWithChunkReload(() => import("../pages/Cookies"));
export const UnsubscribeNewsletter = lazyWithChunkReload(() => import("../pages/UnsubscribeNewsletter"));
export const NotFound = lazyWithChunkReload(() => import("../pages/NotFound"));

/* ── Admin ── */
export const AdminDashboard = lazyWithChunkReload(() => import("../pages/admin/AdminDashboard"));
export const SettingsAdminPage = lazyWithChunkReload(() => import("../pages/admin/SettingsAdminPage"));
export const AdminApplicants = lazyWithChunkReload(() => import("../pages/admin/AdminApplicants"));
export const AdminOfferChangeRequests = lazyWithChunkReload(
  () => import("../pages/admin/AdminOfferChangeRequests"),
);
export const AdminEmployeeDocuments = lazyWithChunkReload(
  () => import("../pages/admin/AdminEmployeeDocuments"),
);
export const AdminEmployees = lazyWithChunkReload(() => import("../pages/admin/AdminEmployees"));
export const AdminCareersConfig = lazyWithChunkReload(() => import("../pages/admin/AdminCareersConfig"));
export const AdminCareersJobs = lazyWithChunkReload(() => import("../pages/admin/AdminCareersJobs"));
export const AdminEmployeeDetails = lazyWithChunkReload(
  () => import("../pages/admin/AdminEmployeeDetails"),
);
export const AdminNewsletterPage = lazyWithChunkReload(() => import("../pages/admin/AdminNewsletter"));
export const AdminSupplierDocuments = lazyWithChunkReload(
  () => import("../pages/admin/AdminSupplierDocuments"),
);
export const AdminShipping = lazyWithChunkReload(() => import("../pages/admin/AdminShipping"));

/* ── Supplier ── */
export const SupplierDashboard = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierDashboard"),
);
export const SupplierRegister = lazyWithChunkReload(() => import("../pages/supplier/SupplierRegister"));
export const SupplierProductsPage = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierProducts"),
);
export const SupplierAddProductsPage = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierAddProducts"),
);
export const SupplierEditProduct = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierEditProduct"),
);
export const SupplierOrdersPage = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierOrders"),
);
export const SupplierPayoutsPage = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierPayouts"),
);
export const SupplierSettingsPage = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierSettings"),
);
export const SupplierShippingPage = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierShipping"),
);
export const SupplierCatalogRequests = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierCatalogRequests"),
);
export const SupplierRefunds = lazyWithChunkReload(() => import("../pages/supplier/SupplierRefunds"));
export const SupplierRiders = lazyWithChunkReload(() => import("../pages/supplier/SupplierRiders"));
export const SupplierCatalogOffers = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierCatalogOffers"),
);
export const SupplierVerifyContact = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierVerifyContact"),
);
export const SupplierBusinessDetails = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierBusinessDetails"),
);
export const SupplierOnboardingAddress = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierOnboardingAddress"),
);
export const SupplierOnboardingDocuments = lazyWithChunkReload(
  () => import("../pages/supplier/SupplierOnboardingDocuments"),
);

/* ── Misc routes ── */
export { default as ResetGuard } from "./ResetGuard";
