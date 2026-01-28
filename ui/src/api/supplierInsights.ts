import api from "./client";

export type SupplierInsightsDTO = {
  windowDays: number;
  topProduct: { title: string; revenue: number; units: number } | null;
  mostOrdered: { title: string; units: number } | null;
  refundRatePct: number;
  refunds: number;
  purchaseOrders: number;
  pendingPayouts: number;
};

export async function fetchSupplierDashboardInsights(): Promise<SupplierInsightsDTO> {
  const { data } = await api.get("/api/supplier/dashboard/insights");
  return data?.data;
}
