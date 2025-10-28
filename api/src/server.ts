// src/server.ts
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import * as fs from 'fs';

import { env } from './config/env.js';

// 🔑 auth middleware (the one you showed earlier)
import { attachUser } from './middleware/auth.js';

// Routers
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import productsRouter from './routes/products.js';
import ordersRouter from './routes/orders.js';
import wishlistRouter from './routes/wishlist.js';
import favoritesRouter from './routes/favorites.js';

import adminRouter from './routes/admin.js';
import adminCatalogRouter from './routes/adminCatalog.js';
import adminCategoriesRouter from './routes/adminCategories.js';
import adminBrandsRouter from './routes/adminBrands.js';
import adminAttributesRouter from './routes/adminAttributes.js';
import adminProductsRouter from './routes/adminProducts.js';
import adminSuppliers from './routes/adminSuppliers.js';
import adminActivitiesRouter from './routes/adminActivities.js';
import adminOrdersRouter from './routes/adminOrders.js';
import adminReports from './routes/adminReports.js';
import adminBanks from './routes/adminBanks.js';
import settings from './routes/settings.js';
import adminOrderComms from './routes/adminOrderComms.js';

import uploadsRouter from './routes/uploads.js';
import paymentsRouter from './routes/payments.js';
import adminMetricsRouter from './routes/adminMetrics.js';
import availabiltyRouter from './routes/availability.js'
import supplierOffersList from './routes/supplierOfferList.js'
import publicProductOffers from './routes/productOffers.js';

const app = express();

/* 1) CORS first */
const allowedOrigins = [
  'http://localhost:5173',
  process.env.APP_URL ?? '',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.options('*', cors());

/* 2) Common middleware */
app.use(cookieParser());      // so attachUser can read cookies if you ever set them
app.use(express.json());      // JSON body for normal routes

/* 3) 🔑 Auth attach — MUST be before any router that uses requireAuth */
app.use(attachUser);

/* 4) Health (handy for debugging) */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

/* 5) Auth & profile */
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);

/* 6) Admin modules */
app.use('/api/admin', adminRouter);
app.use('/api/admin/catalog', adminCatalogRouter);
app.use('/api/admin/categories', adminCategoriesRouter);
app.use('/api/admin/brands', adminBrandsRouter);
app.use('/api/admin/attributes', adminAttributesRouter);
app.use('/api/admin/products', adminProductsRouter);
app.use('/api/admin/suppliers', adminSuppliers);
app.use('/api/admin/order-activities', adminActivitiesRouter);
app.use('/api/admin/orders', adminOrdersRouter);
app.use('/api/admin/reports', adminReports);
app.use('/api/admin/banks', adminBanks);
app.use('/api/settings', settings);
app.use('/api/admin/orders', adminOrderComms); // if this is a separate subrouter under the same path, consider nesting inside adminOrdersRouter to avoid route clashes
app.use('/api/admin/metrics', adminMetricsRouter);
app.use('/api', availabiltyRouter);
/* 7) Payments: JSON endpoints + raw webhook */
app.use('/api', publicProductOffers);
app.use('/api/payments', paymentsRouter); // e.g. /init, /verify


app.post(
  '/api/payments/webhook',
  express.raw({ type: '*/*' }), // raw body only here
  paymentsRouter                 // router should handle POST /webhook
);

/* 8) Public uploads */
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', index: false }));
app.use('/api/uploads', uploadsRouter);
app.use('/api', supplierOffersList);

/* 9) Domain routes */
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/favorites', favoritesRouter);

/* 10) Error handler */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // turn on extra logs via AUTH_DEBUG=true to see jwt failures from attachUser
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(env.port, () => {
  console.log(`API on http://localhost:${env.port}`);
});
