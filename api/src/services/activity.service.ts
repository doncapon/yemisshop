// src/services/activity.service.ts
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';


export type ActivityType =
  | 'ORDER_CREATED'
  | 'STATUS_CHANGE'
  | 'PAYMENT_INIT'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_PAID'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_VERIFY_PENDING'
  | 'PAYMENT_RESUME'
  | 'NOTE';



/** Use this inside a transaction (pass `tx`) to avoid FK / visibility issues */
export async function logOrderActivityTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  type: ActivityType,
  message?: string,
  meta?: unknown
) {
  return tx.orderActivity.create({
    data: { orderId, type, message, meta: meta as any },
  });
}

/** Convenience wrapper for out-of-transaction usage (background jobs, etc.) */
export async function logOrderActivity(
  orderId: string,
  type: ActivityType,
  message?: string,
  meta?: unknown
) {
  return prisma.orderActivity.create({
    data: { orderId, type, message, meta: meta as any },
  });
}
