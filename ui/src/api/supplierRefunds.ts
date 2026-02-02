// src/api/supplierRefunds.ts
import api from "./client"; // adjust path if yours is ../../api/client

export type RefundStatus =
  | "REQUESTED"
  | "SUPPLIER_REVIEW"
  | "SUPPLIER_ACCEPTED"
  | "SUPPLIER_REJECTED"
  | "ESCALATED"
  | "APPROVED"
  | "REJECTED"
  | "REFUNDED"
  | "CLOSED";

export type SupplierRefundRow = {
  id: string;

  orderId: string;
  purchaseOrderId: string;

  supplierId?: string | null;
  status: RefundStatus;

  reason?: string | null;

  requestedAt?: string;
  supplierRespondedAt?: string | null;
  adminResolvedAt?: string | null;
  processedAt?: string | null;

  supplierResponse?: string | null;
  supplierNote?: string | null;

  itemsAmount?: number | string | null;
  taxAmount?: number | string | null;
  serviceFeeBaseAmount?: number | string | null;
  serviceFeeCommsAmount?: number | string | null;
  serviceFeeGatewayAmount?: number | string | null;
  totalAmount?: number | string | null;

  provider?: string | null;
  providerReference?: string | null;
  providerStatus?: string | null;

  order?: { id: string; status?: string | null; createdAt?: string; userId?: string };
  purchaseOrder?: { id: string; status?: string | null; payoutStatus?: string | null; supplierId?: string };
  requestedBy?: { id: string; firstName: string; lastName: string; email?: string | null };

  items?: Array<{
    id: string;
    qty: number;
    orderItem?: { id: string; title?: string; quantity?: number; unitPrice?: number | string };
  }>;

  events?: Array<{ id: string; type: string; message?: string | null; createdAt: string }>;
};

export async function fetchSupplierRefunds(params?: {
  q?: string;
  status?: string;
  take?: number;
  skip?: number;
}) {
  const { data } = await api.get<{ data: SupplierRefundRow[]; meta?: any }>(
    "/api/supplier/refunds",
    { params }
  );
  return data;
}

export async function supplierRefundAction(
  id: string,
  payload: { action: "ACCEPT" | "REJECT" | "ESCALATE"; note?: string }
) {
  const { data } = await api.patch(`/api/supplier/refunds/${encodeURIComponent(id)}`, payload);
  return data;
}
