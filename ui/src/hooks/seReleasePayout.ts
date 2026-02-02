// src/hooks/useReleasePayout.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

export function useAdminReleasePayout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (purchaseOrderId: string) => {
      const { data } = await api.post(`/api/admin/payouts/purchase-orders/${purchaseOrderId}/release`);
      return data;
    },
    onSuccess: async (_data, purchaseOrderId) => {
      // adjust these keys to your actual PO queries
      await qc.invalidateQueries({ queryKey: ["adminPurchaseOrders"] });
      await qc.invalidateQueries({ queryKey: ["purchaseOrder", purchaseOrderId] });
    },
  });
}

export function useSupplierReleasePayout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (purchaseOrderId: string) => {
      const { data } = await api.post(`/api/supplier/payouts/purchase-orders/${purchaseOrderId}/release`);
      return data;
    },
    onSuccess: async (_data, purchaseOrderId) => {
      await qc.invalidateQueries({ queryKey: ["supplierPurchaseOrders"] });
      await qc.invalidateQueries({ queryKey: ["purchaseOrder", purchaseOrderId] });
      await qc.invalidateQueries({ queryKey: ["supplierPayoutSummary"] });
      await qc.invalidateQueries({ queryKey: ["supplierPayoutLedger"] });
      await qc.invalidateQueries({ queryKey: ["supplierPayoutHistory"] });
    },
  });
}
