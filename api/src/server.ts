// src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import * as fs from "fs";

// 🔑 auth middleware
import { attachUser } from "./middleware/auth.js";

// Routers
import authRouter from "./routes/auth.js";
import authSessionRouter from "./routes/authSessions.js";
import profileRouter from "./routes/profile.js";
import productsRouter from "./routes/products.js";
import ordersRouter from "./routes/orders.js";
import orderOtpRouter from "./routes/orderOtp.js";
import purchaseOrdersRouter from "./routes/purchaseOrders.js";
import purchaseOrderDeliveryOtpRouter from "./routes/purchaseOrderDeliveryOtp.js";

import wishlistRouter from "./routes/wishlist.js";
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

const app = express();

/**
 * ✅ MUST be early (before auth/cookies).
 * Railway sits behind a proxy, and secure cookies / req.ip / protocol depend on this.
 */
app.set("trust proxy", 1);

/* 1) CORS first (must allow credentials + exact origin) */
const allowedOrigins = new Set(
  [
    process.env.APP_URL, // e.g. https://dayspring-a.up.railway.app
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean) as string[]
);

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    // Allow server-to-server / curl / Postman (no Origin)
    if (!origin) return cb(null, true);

    if (allowedOrigins.has(origin)) return cb(null, true);

    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Device-Name"],
};

app.use(cors(corsOptions));
// ✅ preflight must use SAME options (credentials + allowed origin)
app.options("*", cors(corsOptions));

/* 2) Common middleware */
app.use(cookieParser());
app.use(express.json());

/* 3) 🔑 Auth attach — MUST be before any router that uses requireAuth */
app.use(attachUser);

/* 4) Health */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* 5) Auth & profile */
app.use("/api/auth", authRouter);
app.use("/api/auth", authSessionRouter);
app.use("/api/profile", profileRouter);

/* 6) Admin modules */
app.use("/api/admin", adminRouter);
app.use("/api/admin/catalog", adminCatalogRouter);
app.use("/api/admin/categories", adminCategoriesRouter);
app.use("/api/admin/brands", adminBrandsRouter);
app.use("/api/admin/attributes", adminAttributesRouter);
app.use("/api/admin/products", adminProductsRouter);

app.use("/api/supplier/payouts", supplierPayouts);
app.use("/api/supplier/dashboard", supplierDashboardRouter);

// ✅ mount supplier-offers in ONE canonical place (prevents route clashes)
app.use("/api/admin", adminSupplierOffersRouter);

app.use("/api/admin/suppliers", adminSuppliers);
app.use("/api/suppliers", suppliers);
app.use("/api/supplier", suppliers);

app.use("/api/admin/order-activities", adminActivitiesRouter);
app.use("/api/admin/orders", adminOrdersRouter);

app.use("/api/purchase-orders", purchaseOrdersRouter);
app.use("/api/orders", purchaseOrderDeliveryOtpRouter);

app.use("/api/admin/reports", adminReports);
app.use("/api/banks", banks);
app.use("/api/settings", settings);
app.use("/api/admin/orders", adminOrderComms);
app.use("/api/admin/metrics", adminMetricsRouter);
app.use("/api/admin/variants", adminVariantsRouter);
app.use("/api", availabiltyRouter);

app.use("/api/admin", adminCatalogMeta);

/* 7) Payments: JSON endpoints + raw webhook */
app.use("/api", publicProductOffers);
app.use("/api/payments", paymentsRouter);
app.use("/api/cart", cartRouter);
app.use("/api/supplier/products", supplierProducts);
app.use("/api/supplier/orders", supplierOrders);

app.use("/api", deliveryOtpRouter);
app.use("/api/supplier/payouts", supplierPayoutsAction);

app.post("/api/payments/webhook", express.raw({ type: "*/*" }), paymentsRouter);

/* 8) Public uploads */
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "30d", index: false }));
app.use("/api/uploads", uploadsRouter);

app.use("/api", supplierOffersList);

/* 9) Domain routes */
app.use("/api/products", productsRouter);
app.use("/api/orders", orderOtpRouter);
app.use("/api/orders", ordersRouter);

app.use("/api/wishlist", wishlistRouter);
app.use("/api/favorites", favoritesRouter);
app.use("/api/catalog", catalogRoutes);

app.use("/api/integrations/dojah", dojahRouter);

app.use("/api/supplier/catalog-requests", supplierCatalogRequests);
app.use("/api/admin/catalog-requests", adminCatalogRequests);
app.use("/api/admin/payouts", adminPayouts);

app.use("/api/refunds", refundsRouter);
app.use("/api/supplier/refunds", supplierRefundsRouter);
app.use("/api/admin/refunds", adminRefundsRouter);

app.use("/api/disputes", disputesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/riders", ridersRouter);
app.use("/api/privacy", privacyRouter);
app.use("/api/supplier/catalog", supplierCatalogOffers);
app.use("/api/admin/offer-change-requests", adminOfferChangeRequests);

/* 10) Single error handler (keep ONE) */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.status && err?.payload) return res.status(err.status).json(err.payload);

  console.error(err);
  res.status(500).json({
    error: "Internal server error",
    message: err?.message ?? String(err),
  });
});

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";
app.listen(port, host, () => {
  console.log(`API on http://${host}:${port}`);
});
