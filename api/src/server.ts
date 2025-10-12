// src/server.ts (or index.ts)
import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import paymentsRouter from './routes/payments.js';
import profileRouter from './routes/profile.js';
import authRouter from './routes/auth.js';
import productsRouter from './routes/products.js';
import ordersRouter from './routes/orders.js';
import wishlistRouter from './routes/wishlist.js';
import favoritesRouter from './routes/favorites.js';


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

/* 2) JSON body for normal routes */
app.use(express.json());

/* 3) Auth & profile */
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);

/* 4) Payments:
   - Mount normal JSON endpoints at /api/payments
   - Keep a dedicated raw-body route for the webhook
*/
app.use('/api/payments', paymentsRouter); // e.g. /init, /verify (expects JSON)
app.post(
  '/api/payments/webhook',
  express.raw({ type: '*/*' }),          // raw body only here
  paymentsRouter                         // router should handle POST /webhook
);


// 5) products
app.use('/api/products', productsRouter);

// 6) orders
app.use('/api/orders', ordersRouter);


//7) wishlist
app.use('/api/wishlist', wishlistRouter);

// 8) favourites
app.use('/api/favorites', favoritesRouter);


app.listen(env.port, () => {
  console.log(`API on http://localhost:${env.port}`);
});
