import api from "./client";

export type SupplierDashboardSummaryDTO = {
  supplierId: string;
  liveProducts: number;
  lowStock: number;
  pendingOrders: number;
  shippedToday: number;
  balance: number;
  paidOutTotal: number;
  rating: number;
  currency: string;
};

export async function fetchSupplierDashboardSummary(): Promise<SupplierDashboardSummaryDTO> {
  const res = await api.get("/api/supplier/dashboard/summary");
  return res.data?.data;
}
