// api/src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import helmet from "helmet";
import * as fs from "fs";

// ✅ Prisma (adjust path if yours differs)
import { prisma } from "./lib/prisma.js";

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

/* -------------------- SEO helpers (Option A) -------------------- */

const BOT_UA =
  /(googlebot|bingbot|duckduckbot|yandexbot|baiduspider|slurp|facebookexternalhit|twitterbot|linkedinbot|pinterest|whatsapp|telegrambot|discordbot)/i;

function isBot(req: express.Request) {
  const ua = String(req.headers["user-agent"] || "");
  return BOT_UA.test(ua);
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeWhitespace(s: string) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function getSiteOrigin(req: express.Request) {
  // Prefer your canonical domain if set
  const env = process.env.APP_URL || process.env.FRONTEND_URL || "https://dayspringhouse.com";
  if (/^https?:\/\//i.test(env)) return env.replace(/\/$/, "");

  const proto = req.headers["x-forwarded-proto"]
    ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
    : req.protocol;

  const host = req.headers["x-forwarded-host"]
    ? String(req.headers["x-forwarded-host"]).split(",")[0].trim()
    : req.get("host");

  return `${proto}://${host}`.replace(/\/$/, "");
}

function resolveAbsoluteImage(req: express.Request, raw?: string | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${req.protocol}:${s}`;
  const origin = getSiteOrigin(req);
  if (s.startsWith("/")) return `${origin}${s}`;
  return `${origin}/${s}`;
}

function applyPlaceholders(
  templateHtml: string,
  vars: {
    title: string;
    desc: string;
    canonical: string;
    ogType: string;
    ogTitle: string;
    ogDesc: string;
    ogUrl: string;
    ogImage: string;
    twTitle: string;
    twDesc: string;
    twImage: string;
  }
) {
  // Important: escape values for HTML attributes/text
  const safe = {
    title: escapeHtml(vars.title),
    desc: escapeHtml(vars.desc),
    canonical: escapeHtml(vars.canonical),
    ogType: escapeHtml(vars.ogType),
    ogTitle: escapeHtml(vars.ogTitle),
    ogDesc: escapeHtml(vars.ogDesc),
    ogUrl: escapeHtml(vars.ogUrl),
    ogImage: escapeHtml(vars.ogImage),
    twTitle: escapeHtml(vars.twTitle),
    twDesc: escapeHtml(vars.twDesc),
    twImage: escapeHtml(vars.twImage),
  };

  return templateHtml
    .replaceAll("__DS_TITLE__", safe.title)
    .replaceAll("__DS_DESC__", safe.desc)
    .replaceAll("__DS_CANONICAL__", safe.canonical)
    .replaceAll("__DS_OG_TYPE__", safe.ogType)
    .replaceAll("__DS_OG_TITLE__", safe.ogTitle)
    .replaceAll("__DS_OG_DESC__", safe.ogDesc)
    .replaceAll("__DS_OG_URL__", safe.ogUrl)
    .replaceAll("__DS_OG_IMAGE__", safe.ogImage)
    .replaceAll("__DS_TW_TITLE__", safe.twTitle)
    .replaceAll("__DS_TW_DESC__", safe.twDesc)
    .replaceAll("__DS_TW_IMAGE__", safe.twImage);
}

/* -------------------- CORS -------------------- */
const normalizeOrigin = (s: string) => s.replace(/\/$/, "");

const allowedOrigins = [
  process.env.APP_URL,
  process.env.FRONTEND_URL,
  "https://dayspringhouse.com",
  "https://www.dayspringhouse.com",
  "http://localhost:5173",
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
  return (paymentsRouter as any)(req, res, next);
});

/* ------------------------------ Common middleware ------------------------------ */
app.use(cookieParser());

// Request logger (helps diagnose 500s fast)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(
  helmet({
    // Good defaults; we’ll override CSP below (only for /api)
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);

/**
 * ✅ IMPORTANT (Option A):
 * Strict CSP ONLY for /api routes (otherwise it breaks the SPA).
 */
const apiCsp = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'none'"],
    scriptSrc: ["'none'"],
    styleSrc: ["'none'"],
    imgSrc: ["'none'"],
    connectSrc: ["'self'"],
    upgradeInsecureRequests: [],
  },
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return apiCsp(req, res, next);
  return next();
});

// If you serve over HTTPS, enable HSTS in production only
if (process.env.NODE_ENV === "production") {
  app.use(
    helmet.hsts({
      maxAge: 60 * 60 * 24 * 365,
      includeSubDomains: true,
      preload: false,
    })
  );
}

// ---------------- Permissions-Policy ----------------
const PERMISSIONS_POLICY =
  "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), " +
  "display-capture=(), document-domain=(), encrypted-media=(), execution-while-not-rendered=(), " +
  "execution-while-out-of-viewport=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), " +
  "hid=(), identity-credentials-get=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), " +
  "midi=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), " +
  "screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()";

app.use((_, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
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

/* ------------------------------ Serve Frontend (SPA) ------------------------------ */
/**
 * ✅ Option A: Serve the Vite build from this same Express server.
 * You must ensure the UI build exists at runtime (index.html present),
 * e.g. copy ui/dist into the deployed container / filesystem.
 */
const pickFirstExistingDir = (dirs: Array<string | undefined | null>) => {
  for (const d of dirs) {
    if (!d) continue;
    const dir = String(d);
    const indexFile = path.join(dir, "index.html");
    try {
      if (fs.existsSync(indexFile)) return dir;
    } catch {
      // ignore
    }
  }
  return null;
};

// Try env first, then common monorepo locations.
const UI_DIST_DIR =
  pickFirstExistingDir([
    process.env.UI_DIST_DIR, // ✅ recommended in prod
    path.resolve(process.cwd(), "../ui/dist"), // monorepo: /api -> ../ui/dist
    path.resolve(process.cwd(), "ui/dist"), // if ui is nested
    path.resolve(process.cwd(), "dist"), // if you copy dist here
    path.resolve(process.cwd(), "public"), // alternative
  ]);

if (UI_DIST_DIR) {
  console.log("Serving SPA from:", UI_DIST_DIR);

  // Cache index.html template (contains placeholders)
  const INDEX_PATH = path.join(UI_DIST_DIR, "index.html");
  let INDEX_CACHE: string | null = null;

  const readIndexTemplate = () => {
    if (INDEX_CACHE) return INDEX_CACHE;
    INDEX_CACHE = fs.readFileSync(INDEX_PATH, "utf8");
    return INDEX_CACHE;
  };

  const defaultSeo = (req: express.Request) => {
    const origin = getSiteOrigin(req);
    return {
      title: "DaySpring — Shop products in Nigeria",
      desc: "Buy quality products on DaySpring. Fast delivery and trusted suppliers.",
      canonical: `${origin}/`,
      ogType: "website",
      ogTitle: "DaySpring House — Shop",
      ogDesc:
        "DaySpring House — shop quality products in Nigeria. Browse our catalogue, add to cart, and checkout securely.",
      ogUrl: `${origin}/`,
      ogImage: `${origin}/og-image.jpg`, // if missing, it's okay; change to a real image if you have one
      twTitle: "DaySpring House — Shop",
      twDesc:
        "DaySpring House — shop quality products in Nigeria. Browse our catalogue, add to cart, and checkout securely.",
      twImage: `${origin}/og-image.jpg`,
    };
  };

  /**
   * ✅ Bot-friendly SEO for product pages:
   * Serve the SAME index.html, but with placeholders replaced for bots.
   * Humans still get SPA index.html.
   */
  app.get("/product/:id", async (req, res, next) => {
    try {
      if (!isBot(req)) return next();

      const id = String(req.params.id || "").trim();
      if (!id) return next();

      const origin = getSiteOrigin(req);
      const canonical = `${origin}/product/${encodeURIComponent(id)}`;

      // Fetch minimal fields for SEO.
      // Use findFirst + isDeleted guard to avoid indexing deleted products.
      const row: any = await prisma.product.findFirst({
        where: { id, isDeleted: false as any } as any,
        select: {
          id: true,
          title: true,
          description: true,
          inStock: true,
          retailPrice: true,
          price: true, // legacy fallback
          imagesJson: true,
          brand: { select: { name: true } },
          variants: { select: { imagesJson: true }, take: 1 },
        } as any,
      });

      const tpl = readIndexTemplate();
      const base = defaultSeo(req);

      if (!row) {
        const html404 = applyPlaceholders(tpl, {
          ...base,
          title: "Product not found | DaySpring",
          desc: "This product does not exist on DaySpring.",
          canonical,
          ogType: "website",
          ogTitle: "Product not found | DaySpring",
          ogDesc: "This product does not exist on DaySpring.",
          ogUrl: canonical,
          // keep default image
          ogImage: base.ogImage,
          twTitle: "Product not found | DaySpring",
          twDesc: "This product does not exist on DaySpring.",
          twImage: base.twImage,
        });

        return res.status(404).type("text/html").send(html404);
      }

      const titleBase = normalizeWhitespace(String(row.title ?? "Product"));
      const desc =
        normalizeWhitespace(String(row.description ?? "")).slice(0, 155) ||
        `Buy ${titleBase} on DaySpring.`;

      const images: string[] = Array.isArray(row.imagesJson) ? row.imagesJson : [];
      const variantImg =
        Array.isArray(row.variants?.[0]?.imagesJson) ? row.variants[0].imagesJson[0] : "";

      const imgRaw = images[0] || variantImg || "";
      const imgAbs = imgRaw ? resolveAbsoluteImage(req, imgRaw) : base.ogImage;

      const pageTitle = `${titleBase} | DaySpring`;

      const html = applyPlaceholders(tpl, {
        ...base,
        title: pageTitle,
        desc,
        canonical,
        ogType: "product",
        ogTitle: pageTitle,
        ogDesc: desc,
        ogUrl: canonical,
        ogImage: imgAbs,
        twTitle: pageTitle,
        twDesc: desc,
        twImage: imgAbs,
      });

      return res.status(200).type("text/html").send(html);
    } catch (e: any) {
      console.error("Bot SEO /product/:id error:", e?.message ?? e);
      return next();
    }
  });

  // Serve assets
  app.use(
    express.static(UI_DIST_DIR, {
      index: false,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    })
  );

  // SPA fallback: any non-API route should return index.html
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    return res.sendFile(INDEX_PATH);
  });
} else {
  console.warn(
    "UI_DIST_DIR not found (no index.html). SPA routes like /product/:id will 404 unless served elsewhere."
  );
}

/* ------------------------------ 404 handler ------------------------------ */
app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not Found", path: req.originalUrl });
  }
  return res.status(404).send("Not Found");
});

/* ------------------------------ Error handler ------------------------------ */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({ error: "Internal server error", message: err?.message ?? String(err) });
});

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`API on http://${HOST}:${PORT}`);
});
