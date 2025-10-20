import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import productRoutes from './routes/products.js';
import supplierRoutes from './routes/suppliers.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import poRoutes from './routes/purchaseOrders.js';

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/purchase-orders', poRoutes);

app.get('/api/admin/payments', (req, res, next) => {
  // forward to compat alias
  req.url = '/admin/compat-alias' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  (paymentRoutes as any).handle(req, res, next);
});


app.use(errorHandler);
export default app;
