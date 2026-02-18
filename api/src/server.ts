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

/* -------------------- SEO helpers (bot HTML for /product/:id) -------------------- */

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
  const env =
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    "https://dayspringhouse.com";

  if (/^https?:\/\//i.test(env)) return env.replace(/\/$/, "");

  const proto = req.headers["x-forwarded-proto"]
    ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
    : req.protocol;

  const host = req.headers["x-forwarded-host"]
    ? String(req.headers["x-forwarded-host"]).split(",")[0].trim()
    : req.get("host");

  return `${proto}://${host}`.replace(/\/$/, "");
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:", "https:"],
      },
    },
  })
);

function resolveAbsoluteImage(req: express.Request, raw?: string | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${req.protocol}:${s}`;
  const origin = getSiteOrigin(req);
  if (s.startsWith("/")) return `${origin}${s}`;
  return `${origin}/${s}`;
}

function buildProductHtml(params: {
  title: string;
  description: string;
  canonical: string;
  imageUrl?: string;
  price?: number | null;
  inStock?: boolean;
  brandName?: string | null;
}) {
  const title = escapeHtml(params.title);
  const desc = escapeHtml(params.description);
  const canonical = escapeHtml(params.canonical);
  const img = params.imageUrl ? escapeHtml(params.imageUrl) : "";
  const brand = params.brandName ? escapeHtml(params.brandName) : "";

  const price =
    typeof params.price === "number" &&
      Number.isFinite(params.price) &&
      params.price > 0
      ? String(params.price)
      : "";

  const availability = params.inStock
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";

  const jsonLd: any = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: params.title,
    description: params.description,
    url: params.canonical,
    ...(params.imageUrl ? { image: [params.imageUrl] } : {}),
    ...(brand ? { brand: { "@type": "Brand", name: params.brandName } } : {}),
    ...(price
      ? {
        offers: {
          "@type": "Offer",
          priceCurrency: "NGN",
          price,
          availability,
          url: params.canonical,
        },
      }
      : {}),
  };

  // ✅ IMPORTANT: do NOT HTML-escape JSON-LD, or crawlers/tools can’t parse it properly.
  // Only make it safe against accidental "</script>" issues by escaping "<".
  const jsonLdSafe = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title} | DaySpring</title>
  <meta name="description" content="${desc}" />
  <link rel="canonical" href="${canonical}" />

  <meta property="og:site_name" content="DaySpring" />
  <meta property="og:type" content="product" />
  <meta property="og:title" content="${title} | DaySpring" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:url" content="${canonical}" />
  ${img ? `<meta property="og:image" content="${img}" />` : ""}

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title} | DaySpring" />
  <meta name="twitter:description" content="${desc}" />
  ${img ? `<meta name="twitter:image" content="${img}" />` : ""}

  <script type="application/ld+json">${jsonLdSafe}</script>
</head>
<body>
  <noscript>DaySpring product page. Enable JavaScript to view the full experience.</noscript>
  <div id="root"></div>
</body>
</html>`;
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
// IMPORTANT: raw MUST be before express.json()
app.post("/api/payments/webhook", express.raw({ type: "*/*" }), (req, res, next) => {
  return (paymentsRouter as any)(req, res, next);
});

/* ------------------------------ Common middleware ------------------------------ */
app.use(cookieParser());

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(
  helmet({
    // Good defaults; strict CSP below is only for /api
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);

/**
 * ✅ Strict CSP ONLY for /api routes (so it doesn't break the SPA)
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

// HSTS in production only
if (process.env.NODE_ENV === "production") {
  app.use(
    helmet.hsts({
      maxAge: 60 * 60 * 24 * 365,
      includeSubDomains: true,
      preload: false,
    })
  );
}

// Permissions-Policy
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

/* ------------------------------ Serve Frontend (SPA) + SEO endpoints ------------------------------ */

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
const UI_DIST_DIR = pickFirstExistingDir([
  process.env.UI_DIST_DIR, // ✅ recommended in prod
  path.resolve(process.cwd(), "../ui/dist"), // monorepo: /api -> ../ui/dist
  path.resolve(process.cwd(), "ui/dist"), // if ui is nested
  path.resolve(process.cwd(), "dist"), // if you copy dist here
  path.resolve(process.cwd(), "public"), // alternative
]);

/* ------------------------------ robots.txt + sitemap.xml ALWAYS (not dependent on UI build) ------------------------------ */

// robots.txt (serve from dist if present, else default)
app.get("/robots.txt", (req, res) => {
  const origin = getSiteOrigin(req);

  if (UI_DIST_DIR) {
    const p = path.join(UI_DIST_DIR, "robots.txt");
    if (fs.existsSync(p)) return res.sendFile(p);
  }

  res
    .status(200)
    .type("text/plain")
    .send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
});

// sitemap.xml (dynamic)
let sitemapCache: { xml: string; at: number } | null = null;
const SITEMAP_TTL_MS = 10 * 60 * 1000;

app.get("/sitemap.xml", async (req, res) => {
  try {
    const now = Date.now();
    if (sitemapCache && now - sitemapCache.at < SITEMAP_TTL_MS) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).send(sitemapCache.xml);
    }

    const origin = getSiteOrigin(req);

    const products = await prisma.product.findMany({
      where: { isDeleted: false },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      products
        .map((p) => {
          const loc = `${origin}/product/${encodeURIComponent(String(p.id))}`;
          const lastmod = p.updatedAt ? new Date(p.updatedAt).toISOString() : "";
          return (
            `  <url>\n` +
            `    <loc>${escapeHtml(loc)}</loc>\n` +
            (lastmod ? `    <lastmod>${escapeHtml(lastmod)}</lastmod>\n` : "") +
            `  </url>`
          );
        })
        .join("\n") +
      `\n</urlset>\n`;

    sitemapCache = { xml, at: now };
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(xml);
  } catch (e: any) {
    console.error("sitemap.xml error:", e?.message ?? e);
    return res.status(500).type("text/plain").send("sitemap error");
  }
});

/**
 * ✅ Bot-friendly /product/:id HTML
 * - Bots OR __seo=1 get real title + JSON-LD Product
 * - Humans (no __seo=1) fall through to SPA when UI_DIST_DIR exists
 *
 * ✅ CRITICAL: Vary by User-Agent so caches never mix bot/human HTML
 */
app.get("/product/:id", async (req, res, next) => {
  // ✅ prevents CDN/proxy caching the SPA HTML for Googlebot (or vice versa)
  res.setHeader("Vary", "User-Agent");

  try {
    const forceSeo = String(req.query.__seo ?? "") === "1";
    const wantsSeo = forceSeo || isBot(req);

    // Humans: let SPA handle it if UI is present
    if (!wantsSeo) {
      if (UI_DIST_DIR) return next();
      return res.status(404).type("text/plain").send("Not Found");
    }

    // Bots: never cache (keeps titles fresh)
    res.setHeader("Cache-Control", "no-store");

    const origin = getSiteOrigin(req);
    const id = String(req.params.id || "").trim();
    const canonical = `${origin}/product/${encodeURIComponent(id)}`;

    const row = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        retailPrice: true,
        inStock: true,
        imagesJson: true,
        brand: { select: { name: true } },

        // ✅ your Product -> variants relation field is ProductVariant (not "variants")
        ProductVariant: {
          select: { imagesJson: true, retailPrice: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!row) {
      res.setHeader("X-DaySpring-SEO", "product-404");
      return res.status(404).type("text/html").send(
        buildProductHtml({
          title: "Product not found",
          description: "This product does not exist on DaySpring.",
          canonical,
          imageUrl: "",
          price: null,
          inStock: false,
          brandName: null,
        })
      );
    }

    const title = normalizeWhitespace(String(row.title ?? "Product"));
    const desc =
      normalizeWhitespace(String(row.description ?? "")).slice(0, 155) ||
      `Buy ${title} on DaySpring.`;

    const productImgs = Array.isArray(row.imagesJson) ? row.imagesJson : [];
    const v0 = Array.isArray((row as any).ProductVariant)
      ? (row as any).ProductVariant[0]
      : null;
    const variantImgs = v0 && Array.isArray(v0.imagesJson) ? v0.imagesJson : [];

    const imgRaw = String(productImgs[0] ?? variantImgs[0] ?? "").trim();
    const imgAbs = imgRaw ? resolveAbsoluteImage(req, imgRaw) : "";

    const pRetail =
      row.retailPrice != null && Number.isFinite(Number(row.retailPrice))
        ? Number(row.retailPrice)
        : null;

    const vRetail =
      v0?.retailPrice != null && Number.isFinite(Number(v0.retailPrice))
        ? Number(v0.retailPrice)
        : null;

    const priceRaw = pRetail ?? vRetail ?? null;

    res.setHeader("X-DaySpring-SEO", forceSeo ? "product-force" : "product-bot");

    return res.status(200).type("text/html").send(
      buildProductHtml({
        title,
        description: desc,
        canonical,
        imageUrl: imgAbs || "",
        price: priceRaw,
        inStock: row.inStock !== false,
        brandName: row.brand?.name ?? null,
      })
    );
  } catch (e: any) {
    console.error("SEO product route error:", e?.message ?? e);
    return next(e);
  }
});



if (UI_DIST_DIR) {
  console.log("Serving SPA from:", UI_DIST_DIR);

  // Serve built assets
  app.use(
    express.static(UI_DIST_DIR, {
      index: false,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    })
  );

  // SPA fallback: any non-API route returns index.html
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();

    // ✅ protect product routes from cache poisoning (very important with UA-based SEO)
    if (req.path.startsWith("/product/")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Vary", "User-Agent");
    }

    return res.sendFile(path.join(UI_DIST_DIR, "index.html"));
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

import { ZodError } from "zod";

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Invalid request",
      detail: err.issues.map((i) => i.message).join(", "),
    });
  }

  return res.status(500).json({
    error: "Something went wrong",
    detail: "Please try again later.",
  });
});


const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`API on http://${HOST}:${PORT}`);
});
