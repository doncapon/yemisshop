// src/services/activity.service.ts
import { prisma } from '../lib/prisma.js';

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
