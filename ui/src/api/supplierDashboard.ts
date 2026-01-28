import api from "./client";

export type SupplierDashboardSummaryDTO = {
  supplierId: string;
  liveProducts: number;
  lowStock: number;
  pendingOrders: number;
  shippedToday: number;
  balance: number;
  rating: number;
  currency: "NGN" | string;
};

export async function fetchSupplierDashboardSummary(): Promise<SupplierDashboardSummaryDTO> {
  const { data } = await api.get("/api/supplier/dashboard/summary");
  return data?.data;
}
