// src/api/adminActivities.ts
import api from '../api/client';

export type AdminActivity = {
  id: string;
  orderId: string;
  type: string;
  message?: string | null;
  meta?: any;
  createdAt: string;
  order?: { id: string; status: string; total: string; createdAt: string; userId: string };
};

export async function fetchActivities(params: {
  q?: string;
  type?: string;
  orderId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}, token?: string | null) {
  const { data } = await api.get<{
    data: AdminActivity[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>('/api/admin/order-activities', {
    params,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return data;
}
