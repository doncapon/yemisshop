// api/src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import * as fs from "fs";

// Routers
import authRouter from "./routes/auth.js";
import authSessionRouter from "./routes/authSessions.js";
import profileRouter from "./routes/profile.js";
import productsRouter from "./routes/products.js";
import ordersRouter from "./routes/orders.js";
import orderOtpRouter from "./routes/orderOtp.js";
import purchaseOrdersRouter from "./routes/purchaseOrders.js";
import purchaseOrderDeliveryOtpRouter from "./routes/purchaseOrderDeliveryOtp.js";

import favoritesRouter from "./routes/favorites.js";

import adminRouter from "./routes/admin.js";
import adminCatalogRouter from "./routes/adminCatalog.js";
import adminCategoriesRouter from "./routes/adminCategories.js";
import adminBrandsRouter from "./routes/adminBrands.js";
import adminAttributesRouter from "./routes/adminAttributes.js";
import adminProductsRouter from "./routes/adminProducts.js";
import adminSuppliers from "./routes/adminSuppliers.js";
import suppliers from "./routes/suppliers.js";
import adminActivitiesRouter from "./routes/adminActivities.js";
import adminOrdersRouter from "./routes/adminOrders.js";
import adminReports from "./routes/adminReports.js";
import banks from "./routes/banks.js";
import adminVariantsRouter from "./routes/adminVariants.js";
import settings from "./routes/settings.js";
import adminOrderComms from "./routes/adminOrderComms.js";

import uploadsRouter from "./routes/uploads.js";
import paymentsRouter from "./routes/payments.js";
import cartRouter from "./routes/carts.js";
import adminMetricsRouter from "./routes/adminMetrics.js";
import availabiltyRouter from "./routes/availability.js";
import supplierOffersList from "./routes/supplierOfferList.js";
import publicProductOffers from "./routes/productOffers.js";
import adminSupplierOffersRouter from "./routes/adminSupplierOffers.js";
import supplierOrders from "./routes/supplierOrders.js";
import supplierPayouts from "./routes/supplierPayouts.js";
import catalogRoutes from "./routes/catalog.js";

import supplierProducts from "./routes/supplierProducts.js";
import supplierCatalogRequests from "./routes/supplierCatalogRequests.js";
import supplierDashboardRouter from "./routes/supplierDashboard.js";

import adminCatalogRequests from "./routes/adminCatalogRequests.js";
import adminCatalogMeta from "./routes/adminCatalogMeta.js";

import dojahRouter from "./routes/dojahProxy.js";
import deliveryOtpRouter from "./routes/deliveryOtp.js";

import supplierPayoutsAction from "./routes/supplierPayoutsAction.js";
import adminPayouts from "./routes/adminPayouts.js";

import refundsRouter from "./routes/refunds.js";
import supplierRefundsRouter from "./routes/supplierRefunds.js";
import adminRefundsRouter from "./routes/adminRefunds.js";
import disputesRouter from "./routes/disputes.js";
import notificationsRouter from "./routes/notifications.js";
import ridersRouter from "./routes/riders.js";
import privacyRouter from "./routes/privacy.js";
import supplierCatalogOffers from "./routes/supplierCatalogOffers.js";
import adminOfferChangeRequests from "./routes/adminOfferChangeRequests.js";
import adminUsersRouter from "./routes/adminUsers.js";

const app = express();
app.set("trust proxy", 1);

/* -------------------- CORS -------------------- */
const normalizeOrigin = (s: string) => s.replace(/\/$/, "");

const allowedOrigins = [
  process.env.APP_URL,
  process.env.FRONTEND_URL,
  "https://dayspringhouse.com",
  "https://www.dayspringhouse.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]
  .filter(Boolean)
  .map((x) => normalizeOrigin(String(x)));

const isAllowed = (origin: string) => {
  const o = normalizeOrigin(origin);
  if (allowedOrigins.includes(o)) return true;
  if (/^https:\/\/.+\.pages\.dev$/.test(o)) return true;
  if (/^https:\/\/.+\.netlify\.app$/.test(o)) return true;
  return false;
};

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (isAllowed(origin)) return cb(null, true);
    console.error("CORS blocked:", origin, "allowed:", allowedOrigins);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-OTP-Token"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* ------------------------------ Webhook raw body (before json) ------------------------------ */
// IMPORTANT: if you verify signatures, raw MUST be before express.json()
app.post("/api/payments/webhook", express.raw({ type: "*/*" }), (req, res, next) => {
  // hand off to your payments router (it must have a POST /webhook handler)
  return (paymentsRouter as any)(req, res, next);
});

/* ------------------------------ Common middleware ------------------------------ */
app.use(cookieParser());

// Request logger (helps diagnose 500s fast)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json({ limit: "2mb" }));

/* -------------------------------- Health -------------------------------- */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ------------------------------ Auth & profile ------------------------------ */
app.use("/api/auth", authRouter);
app.use("/api/auth", authSessionRouter);
app.use("/api/profile", profileRouter);

/* ------------------------------ Admin modules ------------------------------ */
app.use("/api/admin", adminRouter);
app.use("/api/admin/catalog", adminCatalogRouter);
app.use("/api/admin/categories", adminCategoriesRouter);
app.use("/api/admin/brands", adminBrandsRouter);
app.use("/api/admin/attributes", adminAttributesRouter);
app.use("/api/admin/products", adminProductsRouter);

// ✅ mount supplier-offers in ONE canonical place
app.use("/api/admin", adminSupplierOffersRouter);

app.use("/api/admin/suppliers", adminSuppliers);
app.use("/api/admin/order-activities", adminActivitiesRouter);
app.use("/api/admin/orders", adminOrdersRouter);
app.use("/api/admin/reports", adminReports);
app.use("/api/admin/orders", adminOrderComms);
app.use("/api/admin/metrics", adminMetricsRouter);
app.use("/api/admin/variants", adminVariantsRouter);
app.use("/api/admin", adminCatalogMeta);
app.use("/api/admin/catalog-requests", adminCatalogRequests);
app.use("/api/admin/payouts", adminPayouts);
app.use("/api/admin/refunds", adminRefundsRouter);
app.use("/api/admin/offer-change-requests", adminOfferChangeRequests);
app.use("/api/admin", adminUsersRouter);

/* ---------------- Supplier routes ---------------- */
app.use("/api/suppliers", suppliers);
app.use("/api/supplier", suppliers);
app.use("/api/supplier/payouts", supplierPayouts);
app.use("/api/supplier/payouts", supplierPayoutsAction);
app.use("/api/supplier/dashboard", supplierDashboardRouter);
app.use("/api/supplier/products", supplierProducts);
app.use("/api/supplier/orders", supplierOrders);
app.use("/api/supplier/catalog-requests", supplierCatalogRequests);
app.use("/api/supplier/refunds", supplierRefundsRouter);
app.use("/api/supplier/catalog", supplierCatalogOffers);

/* ---------------- Payments + public offers ---------------- */
app.use("/api", publicProductOffers);
app.use("/api/payments", paymentsRouter);
app.use("/api/cart", cartRouter);

/* ------------------------------ Other routes ------------------------------ */
app.use("/api/purchase-orders", purchaseOrdersRouter);

// ⚠️ This looks suspicious: purchaseOrderDeliveryOtpRouter is mounted under /api/orders in your original.
// If that router is really for purchase-orders, mount it correctly; otherwise keep as-is.
// app.use("/api/orders", purchaseOrderDeliveryOtpRouter);
app.use("/api/orders", purchaseOrderDeliveryOtpRouter);

app.use("/api", availabiltyRouter);
app.use("/api/banks", banks);
app.use("/api/settings", settings);
app.use("/api", deliveryOtpRouter);
app.use("/api", supplierOffersList);

app.use("/api/products", productsRouter);
app.use("/api/orders", orderOtpRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/favorites", favoritesRouter);
app.use("/api/catalog", catalogRoutes);

app.use("/api/integrations/dojah", dojahRouter);

app.use("/api/refunds", refundsRouter);
app.use("/api/disputes", disputesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/riders", ridersRouter);
app.use("/api/privacy", privacyRouter);

/* ------------------------------ Uploads ------------------------------ */
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "30d", index: false }));
app.use("/api/uploads", uploadsRouter);

/* ------------------------------ 404 handler ------------------------------ */
app.use((req, res) => {
  res.status(404).json({ error: "Not Found", path: req.originalUrl });
});

/* ------------------------------ Error handler ------------------------------ */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({ error: "Internal server error", message: err?.message ?? String(err) });
});

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";
app.listen(port, host, () => {
  console.log(`API on http://${host}:${port}`);
});
