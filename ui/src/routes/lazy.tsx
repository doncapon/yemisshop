import { lazy } from "react";

/* ── Shopper / public ── */
export const Catalog = lazy(() => import("../pages/Catalog"));
export const ProductDetail = lazy(() => import("../pages/ProductDetail"));
export const ProductReviews = lazy(() => import("../pages/ProductReviews"));
export const Cart = lazy(() => import("../pages/Cart"));
export const Checkout = lazy(() => import("../pages/Checkout"));
export const Verify = lazy(() => import("../pages/Verify"));
export const Payment = lazy(() => import("../pages/Payment"));
export const PaymentCallback = lazy(() => import("../pages/PaymentCallback"));
export const ReceiptPage = lazy(() => import("../pages/Receipts"));
export const RiderAcceptInvite = lazy(() => import("../pages/RiderAcceptInvite"));
export const Wishlist = lazy(() => import("../pages/Wishlist"));
export const Orders = lazy(() => import("../pages/Orders"));
export const Profile = lazy(() => import("../pages/Profile"));
export const ReturnsRefunds = lazy(() => import("../pages/ReturnsRefunds"));
export const UserDashboard = lazy(() => import("../pages/UserDashboard"));
export const AccountSessions = lazy(() => import("../pages/supplier/AccountSessions"));

/* ── Auth ── */
export const Login = lazy(() => import("../pages/Login"));
export const Register = lazy(() => import("../pages/Register"));
export const ForgotPassword = lazy(() => import("../pages/ForgotPassword"));
export const ResetPassword = lazy(() => import("../pages/ResetPassword"));
export const GoogleAuthCallback = lazy(() => import("../pages/GoogleAuthCallback"));

/* ── Info / legal ── */
export const DataPrivacy = lazy(() => import("../pages/DataPrivacy"));
export const About = lazy(() => import("../pages/AboutUs"));
export const Contact = lazy(() => import("../pages/Contact"));
export const HelpCenter = lazy(() => import("../pages/HelpCenter"));
export const Careers = lazy(() => import("../pages/Careers"));
export const CareersIndex = lazy(() => import("../pages/CareersIndex"));
export const CareerJobDetail = lazy(() => import("../pages/CareerJobDetail"));
export const TermsConditions = lazy(() => import("../pages/TermsConditions"));
export const CookiesPage = lazy(() => import("../pages/Cookies"));
export const UnsubscribeNewsletter = lazy(() => import("../pages/UnsubscribeNewsletter"));
export const NotFound = lazy(() => import("../pages/NotFound"));

/* ── Admin ── */
export const AdminDashboard = lazy(() => import("../pages/admin/AdminDashboard"));
export const SettingsAdminPage = lazy(() => import("../pages/admin/SettingsAdminPage"));
export const AdminApplicants = lazy(() => import("../pages/admin/AdminApplicants"));
export const AdminOfferChangeRequests = lazy(
  () => import("../pages/admin/AdminOfferChangeRequests"),
);
export const AdminEmployeeDocuments = lazy(
  () => import("../pages/admin/AdminEmployeeDocuments"),
);
export const AdminEmployees = lazy(() => import("../pages/admin/AdminEmployees"));
export const AdminCareersConfig = lazy(() => import("../pages/admin/AdminCareersConfig"));
export const AdminCareersJobs = lazy(() => import("../pages/admin/AdminCareersJobs"));
export const AdminEmployeeDetails = lazy(
  () => import("../pages/admin/AdminEmployeeDetails"),
);
export const AdminNewsletterPage = lazy(() => import("../pages/admin/AdminNewsletter"));
export const AdminSupplierDocuments = lazy(
  () => import("../pages/admin/AdminSupplierDocuments"),
);
export const AdminShipping = lazy(() => import("../pages/admin/AdminShipping"));

/* ── Supplier ── */
export const SupplierDashboard = lazy(
  () => import("../pages/supplier/SupplierDashboard"),
);
export const SupplierRegister = lazy(() => import("../pages/supplier/SupplierRegister"));
export const SupplierProductsPage = lazy(
  () => import("../pages/supplier/SupplierProducts"),
);
export const SupplierAddProductsPage = lazy(
  () => import("../pages/supplier/SupplierAddProducts"),
);
export const SupplierEditProduct = lazy(
  () => import("../pages/supplier/SupplierEditProduct"),
);
export const SupplierOrdersPage = lazy(
  () => import("../pages/supplier/SupplierOrders"),
);
export const SupplierPayoutsPage = lazy(
  () => import("../pages/supplier/SupplierPayouts"),
);
export const SupplierSettingsPage = lazy(
  () => import("../pages/supplier/SupplierSettings"),
);
export const SupplierShippingPage = lazy(
  () => import("../pages/supplier/SupplierShipping"),
);
export const SupplierCatalogRequests = lazy(
  () => import("../pages/supplier/SupplierCatalogRequests"),
);
export const SupplierRefunds = lazy(() => import("../pages/supplier/SupplierRefunds"));
export const SupplierRiders = lazy(() => import("../pages/supplier/SupplierRiders"));
export const SupplierCatalogOffers = lazy(
  () => import("../pages/supplier/SupplierCatalogOffers"),
);
export const SupplierVerifyContact = lazy(
  () => import("../pages/supplier/SupplierVerifyContact"),
);
export const SupplierBusinessDetails = lazy(
  () => import("../pages/supplier/SupplierBusinessDetails"),
);
export const SupplierOnboardingAddress = lazy(
  () => import("../pages/supplier/SupplierOnboardingAddress"),
);
export const SupplierOnboardingDocuments = lazy(
  () => import("../pages/supplier/SupplierOnboardingDocuments"),
);

/* ── Misc routes ── */
export { default as ResetGuard } from "./ResetGuard";
