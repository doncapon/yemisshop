import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import SiteLayout from "../layouts/SiteLayout.js";
import StatusDot from "../components/StatusDot.js";
import { useModal } from "../components/ModalProvider";
import { upsertCartLine } from "../utils/cartModel";

/* ---------------- “Silver” UI helpers ---------------- */
const SILVER_BORDER = "border border-zinc-200/80";
const SILVER_SHADOW_SM = "shadow-[0_8px_20px_rgba(148,163,184,0.18)]";
const SILVER_SHADOW_MD = "shadow-[0_12px_30px_rgba(148,163,184,0.22)]";
const SILVER_SHADOW_LG = "shadow-[0_18px_60px_rgba(148,163,184,0.30)]";

const CARD_2XL = `rounded-2xl ${SILVER_BORDER} bg-white ${SILVER_SHADOW_MD}`;
const CARD_XL = `rounded-xl ${SILVER_BORDER} bg-white ${SILVER_SHADOW_SM}`;

/* ---------------- Mobile typography helpers ---------------- */
const T_BASE = "text-[12px] sm:text-sm";
const T_SM = "text-[11px] sm:text-xs";
const T_XS = "text-[10px] sm:text-[11px]";
const T_LABEL = "text-[10px] sm:text-xs text-ink-soft";
const INP = "text-[12px] sm:text-sm";
const BTN = "text-[12px] sm:text-sm";
const BTN_XS = "text-[11px] sm:text-xs";

/* ---------------- Cookie auth helpers ---------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };
const OTP_HEADER_NAME = "x-otp-token";

function isAuthError(e: any) {
  const status = e?.response?.status;
  return status === 401 || status === 403;
}

/* ---------------- Types ---------------- */
type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | string;

type SupplierAllocationRow = {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  amount?: number | string | null;
  status?: string | null;
  purchaseOrderId?: string | null;
};

type PurchaseOrderRow = {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  status?: string | null;
  supplierAmount?: number | string | null;
  subtotal?: number | string | null;
  platformFee?: number | string | null;
  createdAt?: string | null;
  deliveredAt?: string | null;
  deliveryOtpVerifiedAt?: string | null;
  paidOutAt?: string | null;
  payoutStatus?: string | null;
};

type OrderRow = {
  id: string;
  userEmail?: string | null;
  status?: string;
  total?: number | string | null;
  tax?: number | string | null;
  subtotal?: number | string | null;
  serviceFeeTotal?: number | string | null;
  gatewayFeeTotal?: number | string | null;
  commsCostTotal?: number | string | null;
  commissionTotal?: number | string | null;
  createdAt?: string;
  complaintWindowDays?: number | null;
  items?: OrderItem[];
  payment?: PaymentRow | null;
  payments?: PaymentRow[];
  paidAmount?: number | string | null;
  metrics?: {
    revenue?: number | string | null;
    cogs?: number | string | null;
    profit?: number | string | null;
    gatewayFee?: number | string | null;
    gatewayFees?: number | string | null;
    comms?: number | string | null;
    commsCost?: number | string | null;
    serviceFee?: number | string | null;
    serviceFeeTotal?: number | string | null;
    commission?: number | string | null;
    commissionTotal?: number | string | null;
  };
  user?: { email?: string | null } | null;
  purchaseOrders?: PurchaseOrderRow[];
};
type PaymentRow = {
  id: string;
  status: string;
  provider?: string | null;
  reference?: string | null;
  amount?: number | string | null;
  createdAt?: string;
  allocations?: SupplierAllocationRow[];
};

type OrderItem = {
  id: string;
  productId?: string | null;
  title?: string | null;
  unitPrice?: number | string | null;
  quantity?: number | string | null;
  lineTotal?: number | string | null;
  status?: string | null;
  product?: {
    id?: string | null;
    title?: string | null;
    slug?: string | null;
    href?: string | null;
    url?: string | null;
    path?: string | null;
    image?: string | null;
    imagesJson?: string[] | null;
  } | null;
  chosenSupplierId?: string | null;
  chosenSupplierUnitPrice?: number | string | null;
  selectedOptions?: Array<{ attribute?: string; value?: string }> | any;
  variant?: {
    id: string;
    productId?: string | null;
    sku?: string | null;
    imagesJson?: string[] | null;
  } | null;

  qty?: number | string | null;
  price?: number | string | null;
  total?: number | string | null;
  subtotal?: number | string | null;
  productTitle?: string | null;
  options?: any;
  selectedOptionsJson?: any;
  productVariant?: any;

  href?: string | null;
  url?: string | null;
  path?: string | null;
};

type OrdersEnvelope = {
  rows: OrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  serverPagination: boolean;
};

type OtpPurpose = "PAY_ORDER" | "CANCEL_ORDER" | "REFUND_ORDER";

type OtpState =
  | { open: false }
  | {
    open: true;
    orderId: string;
    purpose: OtpPurpose;
    requestId: string;
    expiresAt: number;
    channelHint?: string | null;
    otp: string;
    busy: boolean;
    error?: string | null;
    onSuccess: (otpToken: string) => Promise<void> | void;
  };

type RefundReason =
  | "NOT_RECEIVED"
  | "DAMAGED"
  | "WRONG_ITEM"
  | "NOT_AS_DESCRIBED"
  | "CHANGED_MIND"
  | "OTHER";

type OrderFilterStatus =
  | "ALL"
  | "PENDING"
  | "AWAITING FULFILLMENT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED";

type RefundDraft = {
  orderId: string;
  purchaseOrderId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  reason: RefundReason;
  message: string;
  mode: "ALL" | "SOME";
  selectedItemIds: Record<string, boolean>;
  selectedQtyByItemId: Record<string, number>;
  evidenceByItemId: Record<string, string[]>;
  uploadingByItemId: Record<string, boolean>;
  busy: boolean;
  error?: string | null;
};

type RefundEventRow = {
  id: string;
  type?: string | null;
  message?: string | null;
  createdAt?: string | null;
};

type RefundItemRow = {
  id: string;
  orderItem?: {
    id: string;
    title?: string | null;
    quantity?: number | string | null;
    unitPrice?: number | string | null;
  } | null;
};

type RefundRow = {
  id: string;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  supplierId?: string | null;
  status?: string | null;

  reason?: string | null;
  meta?: any | null;

  itemsAmount?: number | string | null;
  taxAmount?: number | string | null;
  serviceFeeBaseAmount?: number | string | null;
  serviceFeeCommsAmount?: number | string | null;
  serviceFeeGatewayAmount?: number | string | null;
  totalAmount?: number | string | null;

  createdAt?: string | null;
  requestedAt?: string | null;
  processedAt?: string | null;
  paidAt?: string | null;
  adminResolvedAt?: string | null;
  supplierRespondedAt?: string | null;

  supplierNote?: string | null;
  supplierResponse?: string | null;
  adminNote?: string | null;
  adminDecision?: string | null;
  provider?: string | null;
  providerReference?: string | null;
  providerStatus?: string | null;

  supplier?: { id: string; name?: string | null } | null;
  purchaseOrder?: { id: string; status?: string | null; payoutStatus?: string | null } | null;
  events?: RefundEventRow[];
  items?: RefundItemRow[];
  evidenceUrls?: string[];
};

const REFUND_REASONS_REQUIRING_EVIDENCE = new Set<RefundReason>([
  "DAMAGED",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "OTHER",
]);

function refundReasonRequiresEvidence(reason?: RefundReason | string | null): boolean {
  return REFUND_REASONS_REQUIRING_EVIDENCE.has(
    String(reason || "").trim().toUpperCase() as RefundReason
  );
}

function normalizeUploadedUrls(payload: any): string[] {
  const raw =
    payload?.urls ??
    payload?.files ??
    payload?.data ??
    payload?.items ??
    payload?.uploads ??
    [];

  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return list
    .map((item: any) => {
      if (typeof item === "string") return item;
      return (
        item?.url ??
        item?.secure_url ??
        item?.src ??
        item?.path ??
        item?.location ??
        item?.uploadedUrl ??
        null
      );
    })
    .filter((v: any): v is string => !!String(v || "").trim())
    .map((v: string) => String(v).trim());
}

/* ---------------- Refund normalization ---------------- */
function normalizeRefunds(payload: any): RefundRow[] {
  const list =
    Array.isArray(payload?.data) ? payload.data :
      Array.isArray(payload) ? payload :
        payload ? [payload] :
          [];

  return list.map((item: any) => normalizeRefund(item));
}

function getSelectedRefundItemIds(draft: RefundDraft, items: OrderItem[]): string[] {
  if (draft.mode === "ALL") {
    return items.map((it) => String(it.id)).filter(Boolean);
  }

  return Object.keys(draft.selectedItemIds || {}).filter((id) => draft.selectedItemIds[id]);
}

function hasEvidenceForItem(draft: RefundDraft, itemId: string): boolean {
  return Array.isArray(draft.evidenceByItemId?.[itemId]) && draft.evidenceByItemId[itemId].length > 0;
}

function allSelectedItemsHaveEvidence(draft: RefundDraft, items: OrderItem[]): boolean {
  const selectedIds = getSelectedRefundItemIds(draft, items);
  if (!selectedIds.length) return false;
  return selectedIds.every((id) => hasEvidenceForItem(draft, id));
}

function getOrderItemQty(it: OrderItem): number {
  return Math.max(1, Number(it.quantity ?? it.qty ?? 1) || 1);
}

function clampRefundQty(raw: any, max: number): number {
  const n = Math.floor(Number(raw) || 0);
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

function getSelectedRefundLines(
  draft: RefundDraft,
  items: OrderItem[]
): Array<{ itemId: string; qty: number }> {
  if (draft.mode === "ALL") {
    return items
      .map((it) => {
        const itemId = String(it.id || "").trim();
        const maxQty = getOrderItemQty(it);
        return itemId ? { itemId, qty: maxQty } : null;
      })
      .filter((row): row is { itemId: string; qty: number } => !!row && row.qty > 0);
  }

  return items
    .map((it) => {
      const itemId = String(it.id || "").trim();
      const checked = !!draft.selectedItemIds?.[itemId];
      const maxQty = getOrderItemQty(it);
      const qty = clampRefundQty(draft.selectedQtyByItemId?.[itemId], maxQty);

      if (!itemId || !checked || qty <= 0) return null;
      return { itemId, qty };
    })
    .filter((row): row is { itemId: string; qty: number } => !!row);
}

function getSelectedRefundItemIdsFromLines(
  draft: RefundDraft,
  items: OrderItem[]
): string[] {
  return getSelectedRefundLines(draft, items).map((row) => row.itemId);
}

function allSelectedRefundQtyValid(draft: RefundDraft, items: OrderItem[]): boolean {
  const lines = getSelectedRefundLines(draft, items);
  if (!lines.length) return false;

  const itemMap = new Map(items.map((it) => [String(it.id), it]));
  return lines.every((row) => {
    const it = itemMap.get(row.itemId);
    if (!it) return false;
    const maxQty = getOrderItemQty(it);
    return row.qty > 0 && row.qty <= maxQty;
  });
}

function allSelectedItemsHaveEvidenceForLines(draft: RefundDraft, items: OrderItem[]): boolean {
  const selectedIds = getSelectedRefundItemIdsFromLines(draft, items);
  if (!selectedIds.length) return false;
  return selectedIds.every((id) => hasEvidenceForItem(draft, id));
}

function normalizeRefund(r: any): RefundRow {
  const evidenceUrls =
    Array.isArray(r?.evidenceUrls)
      ? r.evidenceUrls
      : Array.isArray(r?.meta?.evidenceUrls)
        ? r.meta.evidenceUrls
        : [];

  return {
    id: String(r?.id ?? ""),
    orderId: r?.orderId ? String(r.orderId) : r?.order?.id ? String(r.order.id) : null,
    purchaseOrderId:
      r?.purchaseOrderId
        ? String(r.purchaseOrderId)
        : r?.purchaseOrder?.id
          ? String(r.purchaseOrder.id)
          : null,
    supplierId:
      r?.supplierId
        ? String(r.supplierId)
        : r?.supplier?.id
          ? String(r.supplier.id)
          : null,

    status: r?.status ?? null,
    reason: r?.reason ?? null,
    meta: r?.meta ?? null,

    itemsAmount: r?.itemsAmount ?? null,
    taxAmount: r?.taxAmount ?? null,
    serviceFeeBaseAmount: r?.serviceFeeBaseAmount ?? null,
    serviceFeeCommsAmount: r?.serviceFeeCommsAmount ?? null,
    serviceFeeGatewayAmount: r?.serviceFeeGatewayAmount ?? null,
    totalAmount: r?.totalAmount ?? null,

    createdAt: r?.createdAt ?? null,
    requestedAt: r?.requestedAt ?? null,
    processedAt: r?.processedAt ?? null,
    paidAt: r?.paidAt ?? null,
    adminResolvedAt: r?.adminResolvedAt ?? null,
    supplierRespondedAt: r?.supplierRespondedAt ?? null,

    supplierNote: r?.supplierNote ?? null,
    supplierResponse: r?.supplierResponse ?? null,
    adminNote: r?.adminNote ?? null,
    adminDecision: r?.adminDecision ?? null,
    provider: r?.provider ?? null,
    providerReference: r?.providerReference ?? null,
    providerStatus: r?.providerStatus ?? null,

    evidenceUrls,

    supplier: r?.supplier
      ? {
        id: String(r.supplier.id ?? ""),
        name: r.supplier.name ?? null,
      }
      : null,

    purchaseOrder: r?.purchaseOrder
      ? {
        id: String(r.purchaseOrder.id ?? ""),
        status: r.purchaseOrder.status ?? null,
        payoutStatus: r.purchaseOrder.payoutStatus ?? null,
      }
      : null,

    events: Array.isArray(r?.events)
      ? r.events.map((e: any) => ({
        id: String(e?.id ?? ""),
        type: e?.type ?? null,
        message: e?.message ?? null,
        createdAt: e?.createdAt ?? null,
      }))
      : [],

    items: Array.isArray(r?.items)
      ? r.items.map((it: any) => ({
        id: String(it?.id ?? ""),
        orderItem: it?.orderItem
          ? {
            id: String(it.orderItem.id ?? ""),
            title: it.orderItem.title ?? null,
            quantity: it.orderItem.quantity ?? null,
            unitPrice: it.orderItem.unitPrice ?? null,
          }
          : null,
      }))
      : [],
  };
}

function upper(v: any) {
  return String(v || "").trim().toUpperCase();
}

function firstValidDate(...values: any[]): string | null {
  for (const raw of values) {
    if (!raw) continue;
    const d = new Date(String(raw));
    if (!Number.isNaN(+d)) return d.toISOString();
  }
  return null;
}

function latestMatchingRefundEventDate(refund: RefundRow, patterns: string[]): string | null {
  const events = Array.isArray(refund.events) ? refund.events : [];
  const hits = events
    .filter((e) => {
      const hay = `${e?.type || ""} ${e?.message || ""}`.toUpperCase();
      return patterns.some((p) => hay.includes(p));
    })
    .map((e) => {
      const raw = e?.createdAt;
      if (!raw) return null;
      const d = new Date(String(raw));
      return Number.isNaN(+d) ? null : d;
    })
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime());

  return hits.length ? hits[0].toISOString() : null;
}

function pickMoney(...values: any[]): number {
  for (const v of values) {
    const n = fmtN(v);
    if (n > 0) return n;
  }
  return 0;
}

function getRefundItemsAmount(refund: RefundRow): number {
  return fmtN(refund.itemsAmount);
}

function getRefundTaxAmount(refund: RefundRow): number {
  return fmtN(refund.taxAmount);
}

function getRefundServiceFeeAmount(refund: RefundRow): number {
  return (
    fmtN(refund.serviceFeeBaseAmount) +
    fmtN(refund.serviceFeeCommsAmount) +
    fmtN(refund.serviceFeeGatewayAmount)
  );
}

function getRefundAmount(refund: RefundRow): number {
  return fmtN(refund.totalAmount);
}

function getRefundPaidOutAt(refund: RefundRow): string | null {
  return refund.paidAt || null;
}

function isRefundPaidToCustomer(refund: RefundRow): boolean {
  return !!refund.paidAt || upper(refund.status) === "REFUNDED";
}

function isRefundOpenStatus(status?: string | null): boolean {
  return [
    "REQUESTED",
    "SUPPLIER_REVIEW",
    "SUPPLIER_ACCEPTED",
    "SUPPLIER_REJECTED",
    "ESCALATED",
    "APPROVED",
  ].includes(upper(status));
}

function getRefundFinancialLabel(refund: RefundRow): string {
  if (refund.paidAt) return "Paid to customer";
  if (upper(refund.status) === "REFUNDED") return "Refunded";
  if (isRefundOpenStatus(refund.status)) return "In progress";
  if (upper(refund.status) === "REJECTED") return "Rejected";
  if (upper(refund.status) === "CLOSED") return "Closed";
  return upper(refund.status || "—").replace(/_/g, " ");
}


function getRefundTaxPolicyLabel() {
  return "VAT is already included in supplier item prices and is not refunded separately.";
}
function getRefundsForPurchaseOrder(po: PurchaseOrderRow, refunds: RefundRow[]): RefundRow[] {
  const poId = String(po?.id || "").trim();
  if (!poId) return [];

  return refunds.filter((r) => {
    const refundPoId = String(r.purchaseOrderId ?? r.purchaseOrder?.id ?? r.meta?.purchaseOrderId ?? "").trim();
    return refundPoId === poId;
  });
}

function getRefundsForOrder(order: OrderRow, refunds: RefundRow[]): RefundRow[] {
  const orderId = String(order?.id || "").trim();
  const poIds = new Set(
    (Array.isArray(order?.purchaseOrders) ? order.purchaseOrders : [])
      .map((po) => String(po?.id || "").trim())
      .filter(Boolean)
  );

  return refunds.filter((r) => {
    const refundOrderId = String(r.orderId ?? r.meta?.orderId ?? "").trim();
    const refundPoId = String(r.purchaseOrderId ?? r.purchaseOrder?.id ?? r.meta?.purchaseOrderId ?? "").trim();
    return refundOrderId === orderId || (refundPoId && poIds.has(refundPoId));
  });
}

/* ---------------- Utils ---------------- */
const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});



function getComplaintWindowDays(details: OrderRow): number | null {
  const candidates = [
    details?.complaintWindowDays,
    (details as any)?.refundRequestWindowDays,
    (details as any)?.refund_window_days,
    (details as any)?.meta?.complaintWindowDays,
    (details as any)?.meta?.refundRequestWindowDays,
    (details as any)?.settings?.complaintWindowDays,
  ];

  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      return Math.floor(n);
    }
  }

  return null;
}

function isPurchaseOrderDeliveredForRefund(po: PurchaseOrderRow | null | undefined): boolean {
  if (!po) return false;

  const poStatus = String(po.status || "").trim().toUpperCase();
  const deliveredAt = po.deliveredAt ? new Date(String(po.deliveredAt)) : null;
  const otpVerifiedAt = po.deliveryOtpVerifiedAt ? new Date(String(po.deliveryOtpVerifiedAt)) : null;

  const hasDeliveredDate =
    !!deliveredAt && !Number.isNaN(+deliveredAt);

  const hasOtpDeliveredDate =
    !!otpVerifiedAt && !Number.isNaN(+otpVerifiedAt);

  if (poStatus === "DELIVERED" && (hasDeliveredDate || hasOtpDeliveredDate)) {
    return true;
  }

  if (hasDeliveredDate || hasOtpDeliveredDate) {
    return true;
  }

  return false;
}

function getRefundBaseDate(details: OrderRow): Date | null {
  const purchaseOrders = Array.isArray(details.purchaseOrders) ? details.purchaseOrders : [];
  if (!purchaseOrders.length) return null;

  const deliveredDates = purchaseOrders
    .map((po) => {
      if (!isPurchaseOrderDeliveredForRefund(po)) return null;

      const raw = po?.deliveredAt || po?.deliveryOtpVerifiedAt || null;
      if (!raw) return null;

      const d = new Date(String(raw));
      return Number.isNaN(+d) ? null : d;
    })
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime());

  if (!deliveredDates.length) {
    return null;
  }

  // Use the latest delivered PO so the complaint window starts
  // after the whole order is effectively delivered.
  return deliveredDates[0];
}

function isWithinComplaintWindow(details: OrderRow): boolean {
  const baseDate = getRefundBaseDate(details);
  if (!baseDate) return false;

  const windowDays = getComplaintWindowDays(details);
  if (windowDays == null || windowDays <= 0) return false;

  const cutoff = baseDate.getTime() + windowDays * 24 * 60 * 60 * 1000;
  return Date.now() <= cutoff;
}

function hasOpenRefundForPurchaseOrder(purchaseOrderId: string, refunds: RefundRow[]): boolean {
  const poid = String(purchaseOrderId || "").trim();
  if (!poid) return false;

  return refunds.some((r) => {
    const refundPoId = String(
      r.purchaseOrderId ??
      r.purchaseOrder?.id ??
      r.meta?.purchaseOrderId ??
      ""
    ).trim();

    if (refundPoId !== poid) return false;

    const st = String(r.status || "").trim().toUpperCase();
    return [
      "REQUESTED",
      "SUPPLIER_REVIEW",
      "SUPPLIER_ACCEPTED",
      "SUPPLIER_REJECTED",
      "ESCALATED",
      "APPROVED",
      "PROCESSING",
    ].includes(st);
  });
}

function getItemsForPurchaseOrder(details: OrderRow, po: PurchaseOrderRow): OrderItem[] {
  const items = Array.isArray(details.items) ? details.items : [];
  const supplierId = String(po?.supplierId || "").trim();
  const purchaseOrderId = String(po?.id || "").trim();

  if (!supplierId && !purchaseOrderId) return [];

  return items.filter((it: any) => {
    const itemSupplierId = String(
      it?.chosenSupplierId ??
      it?.supplierId ??
      it?.supplier?.id ??
      ""
    ).trim();

    const itemPoId = String(
      it?.purchaseOrderId ??
      it?.poId ??
      ""
    ).trim();

    if (purchaseOrderId && itemPoId) {
      return itemPoId === purchaseOrderId;
    }

    if (supplierId && itemSupplierId) {
      return itemSupplierId === supplierId;
    }

    return false;
  });
}


function getPurchaseOrderDisplayStatus(po: {
  status?: string | null;
  payoutStatus?: string | null;
}) {
  const status = String(po?.status || "").toUpperCase();
  const payoutStatus = String(po?.payoutStatus || "").toUpperCase();

  if (status === "REFUND_REQUESTED" && payoutStatus === "REFUNDED") {
    return "REFUNDED";
  }

  return status || "—";
}

function getRefundBaseDateForPo(po: PurchaseOrderRow | null | undefined): Date | null {
  if (!po) return null;

  const raw = po.deliveredAt || po.deliveryOtpVerifiedAt || null;
  if (!raw) return null;

  const d = new Date(String(raw));
  return Number.isNaN(+d) ? null : d;
}

function isWithinComplaintWindowForPo(details: OrderRow, po: PurchaseOrderRow): boolean {
  const baseDate = getRefundBaseDateForPo(po);
  if (!baseDate) return false;

  const windowDays = getComplaintWindowDays(details);
  if (windowDays == null || windowDays <= 0) return false;

  const cutoff = baseDate.getTime() + windowDays * 24 * 60 * 60 * 1000;
  return Date.now() <= cutoff;
}

function canRequestRefundForPo(
  details: OrderRow,
  po: PurchaseOrderRow,
  latestPayment: PaymentRow | null,
  refunds: RefundRow[] = []
): boolean {
  const orderId = String(details.id || "").trim();
  const orderStatus = String(details.status || "").trim().toUpperCase();
  const purchaseOrderId = String(po?.id || "").trim();

  if (!orderId || !purchaseOrderId) return false;

  if (["REFUNDED", "CANCELED", "CANCELLED"].includes(orderStatus)) {
    return false;
  }

  const poStatus = String(po?.status || "").trim().toUpperCase();
  if (["REFUNDED", "CANCELED", "CANCELLED"].includes(poStatus)) {
    return false;
  }

  if (hasOpenRefundForPurchaseOrder(purchaseOrderId, refunds)) {
    return false;
  }

  const isPaidEffective =
    isPaidStatus(details.status) ||
    isPaidStatus(latestPayment?.status);

  if (!isPaidEffective) {
    return false;
  }

  if (!isPurchaseOrderDeliveredForRefund(po)) {
    return false;
  }

  const poItems = getItemsForPurchaseOrder(details, po);
  if (!poItems.length) {
    return false;
  }

  return isWithinComplaintWindowForPo(details, po);
}

function hasOpenRefundForOrder(orderId: string, refunds: RefundRow[]): boolean {
  const oid = String(orderId || "").trim();
  if (!oid) return false;

  return refunds.some((r) => {
    if (String(r.orderId || "").trim() !== oid) return false;

    const st = String(r.status || "").trim().toUpperCase();
    return [
      "REQUESTED",
      "SUPPLIER_REVIEW",
      "SUPPLIER_ACCEPTED",
      "SUPPLIER_REJECTED",
      "ESCALATED",
      "APPROVED",
      "PROCESSING",
    ].includes(st);
  });
}

function canRequestRefundAsCustomer(
  details: OrderRow,
  latestPayment: PaymentRow | null,
  refunds: RefundRow[] = []
): boolean {
  const orderId = String(details.id || "").trim();
  const orderStatus = String(details.status || "").trim().toUpperCase();

  if (!orderId) return false;

  if (["REFUNDED", "CANCELED", "CANCELLED"].includes(orderStatus)) {
    return false;
  }

  if (hasOpenRefundForOrder(orderId, refunds)) {
    return false;
  }

  const isPaidEffective =
    isPaidStatus(details.status) ||
    isPaidStatus(latestPayment?.status);

  if (!isPaidEffective) {
    return false;
  }

  const purchaseOrders = Array.isArray(details.purchaseOrders) ? details.purchaseOrders : [];
  if (!purchaseOrders.length) {
    return false;
  }

  // Be strict: if any PO is not delivered yet, do not show refund request.
  const allPurchaseOrdersDelivered = purchaseOrders.every((po) =>
    isPurchaseOrderDeliveredForRefund(po)
  );

  if (!allPurchaseOrdersDelivered) {
    return false;
  }

  const complaintWindowDays = getComplaintWindowDays(details);
  if (complaintWindowDays == null || complaintWindowDays <= 0) {
    return false;
  }

  return isWithinComplaintWindow(details);
}


const fmtN = (n?: number | string | null) => {
  if (n == null) return 0;
  if (typeof n === "number") return Number.isFinite(n) ? n : 0;
  const cleaned = String(n).replace(/[^\d.-]/g, "");
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : 0;
};

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(+d)
    ? String(s)
    : d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
};

function getPurchaseOrderDeliveryDate(po?: PurchaseOrderRow | null): Date | null {
  if (!po) return null;

  const raw = po.deliveredAt || po.deliveryOtpVerifiedAt || null;
  if (!raw) return null;

  const d = new Date(String(raw));
  return Number.isNaN(+d) ? null : d;
}

function getPurchaseOrderDeliveryDisplay(po?: PurchaseOrderRow | null): string | null {
  const d = getPurchaseOrderDeliveryDate(po);
  return d ? fmtDate(d.toISOString()) : null;
}

function getOrderFinalDeliveryDate(order?: OrderRow | null): Date | null {
  if (!order) return null;

  const purchaseOrders = Array.isArray(order.purchaseOrders) ? order.purchaseOrders : [];
  if (!purchaseOrders.length) return null;

  const deliveredDates = purchaseOrders
    .map((po) => getPurchaseOrderDeliveryDate(po))
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime());

  return deliveredDates.length ? deliveredDates[0] : null;
}

function getOrderFinalDeliveryDisplay(order?: OrderRow | null): string | null {
  const d = getOrderFinalDeliveryDate(order);
  return d ? fmtDate(d.toISOString()) : null;
}

const todayYMD = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const toYMD = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");

/* ---------------- Shared helpers ---------------- */
function firstNonEmptyString(...values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function safePathFromUrlLike(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (raw.startsWith("/")) return raw;

  try {
    const u = new URL(raw);
    return `${u.pathname || ""}${u.search || ""}${u.hash || ""}`;
  } catch {
    return raw;
  }
}

/* ---------------- Shared helpers ---------------- */
function getProductHref(it: OrderItem): string {
  const directHref = firstNonEmptyString(
    it.href,
    it.url,
    it.path,
    it.product?.href,
    it.product?.url,
    it.product?.path
  );

  if (directHref) {
    return safePathFromUrlLike(directHref);
  }

  const productRef = firstNonEmptyString(
    it.productId,
    it.product?.id,
    it.product?.slug,
    it.variant?.productId,
    it.productVariant?.productId,
    it.productVariant?.product?.id,
    it.productVariant?.product?.slug
  );

  if (!productRef) return "";

  const params = new URLSearchParams();

  const variantId = firstNonEmptyString(
    it.variant?.id,
    it.productVariant?.id
  );
  if (variantId) params.set("variantId", variantId);

  const selectedOptions = normalizeSelectedOptionsForDisplay(
    it.selectedOptions ?? it.options ?? it.selectedOptionsJson
  );
  if (selectedOptions.length) {
    params.set("selectedOptions", JSON.stringify(selectedOptions));
  }

  const qs = params.toString();
  return `/products/${encodeURIComponent(productRef)}${qs ? `?${qs}` : ""}`;
}



function getFirstImageFromOrderItem(it: OrderItem): string | null {
  const candidates: any[] = [
    it.product?.image,
    ...(Array.isArray(it.variant?.imagesJson) ? it.variant.imagesJson : []),
    ...(Array.isArray(it.product?.imagesJson) ? it.product.imagesJson : []),
    it.productVariant?.image,
    ...(Array.isArray(it.productVariant?.imagesJson) ? it.productVariant.imagesJson : []),
    ...(Array.isArray(it.productVariant?.images) ? it.productVariant.images : []),
  ];

  for (const raw of candidates) {
    const s = String(raw || "").trim();
    if (!s) continue;

    // If image is already absolute, keep it
    if (/^https?:\/\//i.test(s)) return s;

    // Keep root-relative paths too; cart page can resolve them later
    if (s.startsWith("/")) return s;

    // Common fallback for bare upload paths
    return `/${s.replace(/^\/+/, "")}`;
  }

  return null;
}

function buildOptionsKey(
  selectedOptions: Array<{ attribute: string; value: string }>
): string {
  return [...(selectedOptions || [])]
    .map((opt) => {
      const attribute = String(opt.attribute || "").trim();
      const value = String(opt.value || "").trim();
      return attribute || value ? `${attribute}:${value}` : "";
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

function buildBuyAgainCartLine(it: OrderItem) {
  const qty = Math.max(1, Number(it.quantity ?? it.qty ?? 1) || 1);
  const unitPrice = fmtN(it.unitPrice ?? it.price);
  const title = (it.title || it.product?.title || "Product").toString().trim();

  const selectedOptions = normalizeSelectedOptionsForDisplay(
    it.selectedOptions ?? it.options ?? it.selectedOptionsJson
  );

  const productId = firstNonEmptyString(
    it.productId,
    it.product?.id,
    it.variant?.productId,
    it.productVariant?.productId,
    it.productVariant?.product?.id
  );

  const variantId = firstNonEmptyString(
    it.variant?.id,
    it.productVariant?.id
  ) || undefined;

  const imageSnapshot = getFirstImageFromOrderItem(it);
  const optionsKey = variantId ? buildOptionsKey(selectedOptions) : "";

  return {
    kind: variantId ? ("VARIANT" as const) : ("BASE" as const),
    productId,
    variantId,
    qty,
    optionsKey,

    selectedOptions,
    titleSnapshot: title,
    imageSnapshot,
    unitPriceCache: unitPrice,
  };
}

function isPaidStatus(status?: string | null): boolean {
  const s = String(status || "").trim().toUpperCase();
  return ["PAID", "VERIFIED", "SUCCESS", "SUCCESSFUL", "COMPLETED", "FUNDED"].includes(s);
}

function latestPaymentOf(o: OrderRow): PaymentRow | null {
  const list: PaymentRow[] = Array.isArray(o.payments) ? [...o.payments] : o.payment ? [o.payment] : [];
  if (list.length === 0) return null;

  const paid = list.find((p) => isPaidStatus(p.status));
  if (paid) return paid;

  return list
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
}

function receiptKeyFromPayment(p?: PaymentRow | null): string | null {
  if (!p) return null;
  const ref = (p.reference || "").toString().trim();
  if (ref) return ref;
  const id = (p.id || "").toString().trim();
  return id || null;
}

function extractItems(raw: any): any[] {
  if (!raw) return [];
  const candidates = [
    raw.items,
    raw.orderItems,
    raw.orderLines,
    raw.lines,
    raw.OrderItem,
    raw.OrderLine,
    raw.order_item,
    raw.order_items,
    raw.order_lines,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function cryptoFallbackId(it: any) {
  try {
    return btoa(JSON.stringify([it?.productId, it?.variantId, it?.title, it?.sku, it?.price])).slice(0, 12);
  } catch {
    return String(Math.random()).slice(2);
  }
}
function normalizeItem(it: any): OrderItem {
  const id = String(it?.id ?? it?.orderItemId ?? it?.lineId ?? cryptoFallbackId(it));

  const quantity =
    it?.quantity ??
    it?.qty ??
    it?.count ??
    (it?.lineQuantity != null ? it.lineQuantity : undefined);

  const unitPrice =
    it?.unitPrice ??
    it?.price ??
    it?.customerUnitPrice ??
    it?.unit_amount ??
    it?.unit_amount_value ??
    undefined;

  const lineTotal =
    it?.lineTotal ??
    it?.total ??
    it?.subtotal ??
    it?.line_amount ??
    undefined;

  const product = it?.product ?? it?.Product ?? it?.itemProduct ?? null;
  const rawVariant = it?.variant ?? it?.productVariant ?? it?.Variant ?? null;

  const resolvedProductId = firstNonEmptyString(
    it?.productId,
    product?.id,
    rawVariant?.productId,
    it?.productVariant?.productId,
    it?.product?.productId,
    it?.Product?.id
  ) || null;

  const productTitle =
    it?.productTitle ??
    it?.title ??
    product?.title ??
    product?.name ??
    null;

  let selectedOptions: any =
    it?.selectedOptions ??
    it?.options ??
    it?.selectedOptionsJson ??
    it?.variantOptions ??
    null;

  if (typeof selectedOptions === "string") {
    try {
      selectedOptions = JSON.parse(selectedOptions);
    } catch {
      // ignore invalid JSON
    }
  }

  return {
    id,
    productId: resolvedProductId,
    title: it?.title ?? productTitle ?? null,
    unitPrice: unitPrice ?? null,
    quantity: quantity ?? null,
    lineTotal: lineTotal ?? null,
    status: it?.status ?? null,

    product: product
      ? {
        id: product?.id ? String(product.id) : null,
        title: product?.title ?? product?.name ?? null,
        slug: product?.slug ?? null,
        href: product?.href ?? null,
        url: product?.url ?? null,
        path: product?.path ?? null,
        image:
          product?.image ??
          product?.imageUrl ??
          product?.thumbnail ??
          null,
        imagesJson: product?.imagesJson ?? product?.images ?? null,
      }
      : null,

    chosenSupplierId: it?.chosenSupplierId ?? it?.supplierId ?? null,
    chosenSupplierUnitPrice: it?.chosenSupplierUnitPrice ?? it?.supplierUnitPrice ?? null,
    selectedOptions,

    variant: rawVariant
      ? {
        id: String(rawVariant?.id ?? ""),
        productId: rawVariant?.productId ? String(rawVariant.productId) : null,
        sku: rawVariant?.sku ?? null,
        imagesJson: rawVariant?.imagesJson ?? rawVariant?.images ?? null,
      }
      : null,

    qty: it?.qty ?? null,
    price: it?.price ?? null,
    total: it?.total ?? null,
    subtotal: it?.subtotal ?? null,
    productTitle: productTitle ?? null,
    options: it?.options ?? null,
    selectedOptionsJson: it?.selectedOptionsJson ?? null,
    productVariant: it?.productVariant ?? null,

    href: it?.href ?? it?.url ?? it?.path ?? null,
    url: it?.url ?? null,
    path: it?.path ?? null,
  };
}

function normalizeOrder(raw: any): OrderRow {
  const itemsRaw = extractItems(raw);
  const items = itemsRaw.map(normalizeItem);

  const userEmail =
    raw?.userEmail ??
    raw?.user?.email ??
    raw?.User?.email ??
    raw?.email ??
    raw?.customerEmail ??
    null;

  const payments: any[] =
    (Array.isArray(raw?.payments) && raw.payments) ||
    (Array.isArray(raw?.Payments) && raw.Payments) ||
    (Array.isArray(raw?.payment) && raw.payment) ||
    [];

  const payment: any = raw?.payment ?? raw?.Payment ?? (payments.length ? payments[0] : null);
  const purchaseOrdersRaw = Array.isArray(raw?.purchaseOrders) ? raw.purchaseOrders : [];

  const purchaseOrders: PurchaseOrderRow[] = purchaseOrdersRaw.map((po: any) => ({
    id: String(po?.id ?? ""),
    supplierId: String(po?.supplierId ?? ""),
    supplierName: po?.supplier?.name ?? po?.supplierName ?? null,
    status: po?.status ?? null,
    supplierAmount: po?.supplierAmount ?? null,
    subtotal: po?.subtotal ?? null,
    platformFee: po?.platformFee ?? null,
    createdAt: po?.createdAt ?? null,
    deliveredAt: po?.deliveredAt ?? null,
    deliveryOtpVerifiedAt: po?.deliveryOtpVerifiedAt ?? null,
    payoutStatus: po?.payoutStatus ?? null,
    paidOutAt: po?.paidOutAt ?? null,
  }));

  return {
    id: String(raw?.id ?? ""),
    userEmail,
    status: raw?.status ?? raw?.orderStatus ?? null,
    total: raw?.total ?? raw?.amountTotal ?? raw?.grandTotal ?? null,
    serviceFeeTotal:
      raw?.serviceFeeTotal ??
      raw?.service_fee_total ??
      raw?.serviceFeeTotalNGN ??
      raw?.service_fee ??
      raw?.checkoutServiceFee ??
      raw?.checkout_service_fee ??
      payment?.serviceFeeTotal ??
      payment?.service_fee_total ??
      null,
    gatewayFeeTotal:
      raw?.gatewayFeeTotal ??
      raw?.gateway_fee_total ??
      raw?.gatewayFee ??
      raw?.gateway_fee ??
      payment?.gatewayFeeTotal ??
      payment?.gateway_fee_total ??
      payment?.gatewayFee ??
      payment?.gateway_fee ??
      null,
    commsCostTotal:
      raw?.commsCostTotal ??
      raw?.comms_cost_total ??
      raw?.commsTotal ??
      raw?.comms_total ??
      raw?.commsCost ??
      raw?.comms_cost ??
      raw?.comms ??
      null,
    commissionTotal:
      raw?.commissionTotal ??
      raw?.commission_total ??
      raw?.platformFeeTotal ??
      raw?.platform_fee_total ??
      raw?.platformFee ??
      raw?.platform_fee ??
      raw?.marginTotal ??
      raw?.margin_total ??
      raw?.margin ??
      null,
    subtotal: raw?.subtotal ?? raw?.subTotal ?? raw?.itemsSubtotal ?? null,
    tax: raw?.tax ?? raw?.vat ?? null,
    createdAt: raw?.createdAt ?? raw?.created_at ?? raw?.placedAt ?? null,
    complaintWindowDays:
      raw?.complaintWindowDays ??
      raw?.refundRequestWindowDays ??
      raw?.refund_window_days ??
      raw?.meta?.complaintWindowDays ??
      raw?.meta?.refundRequestWindowDays ??
      raw?.refundMeta?.complaintWindowDays ??
      raw?.settings?.complaintWindowDays ??
      null,
    items,
    payments: payments.length
      ? payments.map((p) => ({
        id: String(p?.id ?? ""),
        status: String(p?.status ?? ""),
        provider: p?.provider ?? null,
        reference: p?.reference ?? p?.ref ?? null,
        amount: p?.amount ?? null,
        createdAt: p?.createdAt ?? p?.created_at ?? null,
        allocations: Array.isArray(p?.allocations)
          ? p.allocations.map((a: any) => ({
            id: String(a?.id ?? ""),
            supplierId: String(a?.supplierId ?? ""),
            supplierName: a?.supplier?.name ?? a?.supplierNameSnapshot ?? null,
            amount: a?.amount ?? null,
            status: a?.status ?? null,
            purchaseOrderId: a?.purchaseOrderId ?? null,
          }))
          : [],
      }))
      : undefined,
    payment: payment
      ? {
        id: String(payment?.id ?? ""),
        status: String(payment?.status ?? ""),
        provider: payment?.provider ?? null,
        reference: payment?.reference ?? payment?.ref ?? null,
        amount: payment?.amount ?? null,
        createdAt: payment?.createdAt ?? payment?.created_at ?? null,
      }
      : null,
    paidAmount: raw?.paidAmount ?? raw?.paid_amount ?? null,
    metrics: raw?.metrics ?? null,
    purchaseOrders,
  };
}

function normalizeOrders(payload: any): OrderRow[] {
  const list =
    (Array.isArray(payload) && payload) ||
    (payload && Array.isArray(payload.data) && payload.data) ||
    (payload && Array.isArray(payload.orders) && payload.orders) ||
    (payload && Array.isArray(payload.results) && payload.results) ||
    [];
  return list.map(normalizeOrder);
}

function readPaginationMeta(payload: any) {
  const total =
    payload?.total ??
    payload?.count ??
    payload?.meta?.total ??
    payload?.meta?.count ??
    payload?.pagination?.total ??
    payload?.paging?.total ??
    payload?.pageInfo?.total ??
    null;

  const page =
    payload?.page ??
    payload?.currentPage ??
    payload?.meta?.page ??
    payload?.meta?.currentPage ??
    payload?.pagination?.page ??
    payload?.paging?.page ??
    payload?.pageInfo?.page ??
    null;

  const pageSize =
    payload?.pageSize ??
    payload?.limit ??
    payload?.perPage ??
    payload?.meta?.pageSize ??
    payload?.meta?.limit ??
    payload?.meta?.perPage ??
    payload?.pagination?.pageSize ??
    payload?.pagination?.limit ??
    payload?.paging?.pageSize ??
    payload?.paging?.limit ??
    payload?.pageInfo?.pageSize ??
    payload?.pageInfo?.limit ??
    null;

  const totalPages =
    payload?.totalPages ??
    payload?.pages ??
    payload?.meta?.totalPages ??
    payload?.meta?.pages ??
    payload?.pagination?.totalPages ??
    payload?.pagination?.pages ??
    payload?.paging?.totalPages ??
    payload?.pageInfo?.totalPages ??
    null;

  const hasMeta =
    total != null ||
    page != null ||
    pageSize != null ||
    totalPages != null ||
    !!payload?.meta?.pagination ||
    !!payload?.pagination ||
    !!payload?.paging ||
    !!payload?.pageInfo;

  return {
    total: total != null ? Number(total) : null,
    page: page != null ? Number(page) : null,
    pageSize: pageSize != null ? Number(pageSize) : null,
    totalPages: totalPages != null ? Number(totalPages) : null,
    hasMeta,
  };
}

function normalizeOrdersEnvelope(payload: any, requestedPage: number, requestedPageSize: number): OrdersEnvelope {
  const rows = normalizeOrders(payload);
  const meta = readPaginationMeta(payload);

  if (meta.hasMeta) {
    const total = Math.max(0, Number(meta.total ?? rows.length) || 0);
    const pageSize = Math.max(1, Number(meta.pageSize ?? requestedPageSize) || requestedPageSize);
    const page = Math.max(1, Number(meta.page ?? requestedPage) || requestedPage);
    const totalPages =
      Math.max(1, Number(meta.totalPages ?? Math.ceil(total / pageSize)) || Math.ceil(total / pageSize));

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages,
      serverPagination: true,
    };
  }

  return {
    rows,
    total: rows.length,
    page: requestedPage,
    pageSize: requestedPageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / requestedPageSize)),
    serverPagination: false,
  };
}

function orderServiceRevenue(o: OrderRow): number {
  const candidates = [
    o.serviceFeeTotal,
    (o as any).serviceFee,
    (o as any).service_fee_total,
    (o as any).service_fee,
    (o as any).checkoutServiceFee,
    (o as any).checkout_service_fee,
    o.metrics?.serviceFee,
    o.metrics?.serviceFeeTotal,
  ];

  for (const v of candidates) {
    const n = fmtN(v);
    if (n !== 0) return n;
  }
  return 0;
}

function orderSupplierBasePriceTotal(o: OrderRow): number {
  const fromItems = (o.items || []).reduce((sum, it) => {
    const qty = Math.max(1, Number(it.quantity ?? it.qty ?? 1) || 1);
    const supplierBaseUnit = fmtN(it.chosenSupplierUnitPrice);
    return sum + supplierBaseUnit * qty;
  }, 0);

  if (fromItems > 0) return fromItems;

  const fromPurchaseOrders = (o.purchaseOrders || []).reduce((sum, po) => {
    return sum + fmtN(po.subtotal);
  }, 0);

  return fromPurchaseOrders;
}

function orderSupplierPayoutTotal(o: OrderRow): number {
  const poSupplierAmount = (o.purchaseOrders || []).reduce((sum, po) => {
    return sum + fmtN(po.supplierAmount);
  }, 0);
  if (poSupplierAmount > 0) return poSupplierAmount;

  const allocationAmount = (o.payments || [])
    .flatMap((p) => p.allocations || [])
    .reduce((sum, a) => sum + fmtN(a.amount), 0);
  if (allocationAmount > 0) return allocationAmount;

  const itemSupplierAmount = (o.items || []).reduce((sum, it) => {
    const qty = Math.max(1, Number(it.quantity ?? it.qty ?? 1) || 1);
    const supplierUnit = fmtN(it.chosenSupplierUnitPrice);
    return sum + supplierUnit * qty;
  }, 0);
  if (itemSupplierAmount > 0) return itemSupplierAmount;

  return 0;
}

function orderCommissionRevenue(o: OrderRow, marginPercent: number): number {
  const supplierBaseTotal = orderSupplierBasePriceTotal(o);
  if (supplierBaseTotal <= 0) return 0;
  return supplierBaseTotal * (marginPercent / 100);
}

function computeOrderPlatformProfit(o: OrderRow, marginPercent: number): number {
  const commission = orderCommissionRevenue(o, marginPercent);
  const serviceFee = orderServiceRevenue(o);
  return commission + serviceFee;
}

function orderGatewayCost(o: OrderRow): number {
  const candidates = [
    o.gatewayFeeTotal,
    (o as any).gatewayFee,
    (o as any).gateway_fee_total,
    (o as any).gateway_fee,
    o.metrics?.gatewayFee,
    o.metrics?.gatewayFees,
  ];

  for (const v of candidates) {
    const n = fmtN(v);
    if (n !== 0) return n;
  }
  return 0;
}

function orderCommsCost(o: OrderRow): number {
  const candidates = [
    o.commsCostTotal,
    (o as any).commsCost,
    (o as any).comms_cost_total,
    (o as any).comms_total,
    (o as any).comms,
    o.metrics?.comms,
    o.metrics?.commsCost,
  ];

  for (const v of candidates) {
    const n = fmtN(v);
    if (n !== 0) return n;
  }
  return 0;
}

function normalizeSelectedOptionsForDisplay(input: any): Array<{ attribute: string; value: string }> {
  let raw = input;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return arr
    .map((opt: any) => {
      const attribute =
        opt?.attribute ??
        opt?.attributeName ??
        opt?.name ??
        opt?.label ??
        opt?.key ??
        "";
      const value =
        opt?.value ??
        opt?.valueName ??
        opt?.option ??
        opt?.text ??
        opt?.labelValue ??
        "";
      return {
        attribute: String(attribute || "").trim(),
        value: String(value || "").trim(),
      };
    })
    .filter((x) => x.attribute || x.value);
}

function getOrderSupplierSummary(order: OrderRow) {
  const purchaseOrders = Array.isArray(order.purchaseOrders) ? order.purchaseOrders : [];

  const uniqueSuppliers = Array.from(
    new Map(
      purchaseOrders.map((po) => [
        String(po.supplierId || po.supplierName || po.id || ""),
        {
          supplierId: String(po.supplierId || ""),
          supplierName: po.supplierName || po.supplierId || "Supplier",
        },
      ])
    ).values()
  );

  return {
    count: uniqueSuppliers.length,
    names: uniqueSuppliers.map((s) => s.supplierName).filter(Boolean),
    purchaseOrders,
  };
}

/* ---------------- Pagination UI ---------------- */
const PAGE_SIZE = 10;

function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);

  return debounced;
}

const Pagination = React.memo(function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const go = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    onChange(p);
  };

  const pages: number[] = [];
  const maxButtons = 5;
  let start = Math.max(1, page - 2);
  let end = Math.min(totalPages, start + maxButtons - 1);
  if (end - start + 1 < maxButtons) start = Math.max(1, end - maxButtons + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="mt-3 flex items-center justify-center gap-1.5 sm:gap-2">
      <button
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} bg-white disabled:opacity-40`}
      >
        Prev
      </button>

      {start > 1 && (
        <>
          <button
            onClick={() => go(1)}
            className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${page === 1 ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"
              }`}
          >
            1
          </button>
          {start > 2 && <span className={`px-1 ${T_XS} text-ink-soft`}>…</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          onClick={() => go(p)}
          className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${p === page ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-black/5"
            }`}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className={`px-1 ${T_XS} text-ink-soft`}>…</span>}
          <button
            onClick={() => go(totalPages)}
            className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${page === totalPages ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"
              }`}
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} bg-white disabled:opacity-40`}
      >
        Next
      </button>
    </div>
  );
});

const OrdersFilterBar = React.memo(function OrdersFilterBar({
  qInput,
  setQInput,
  statusFilter,
  setStatusFilter,
  from,
  setFrom,
  to,
  setTo,
  minTotal,
  setMinTotal,
  maxTotal,
  setMaxTotal,
  setPage,
  setExpandedId,
  refreshing,
  queriesEnabled,
  onRefresh,
  onClear,
  isTodayActive,
  onToggleToday,
  totalItems,
  pageStart,
  pageEnd,
  searchInputRef,
  onSearchFocus,
  onSearchBlur,
  onSearchSelect,
}: {
  qInput: string;
  setQInput: React.Dispatch<React.SetStateAction<string>>;
  statusFilter: OrderFilterStatus;
  setStatusFilter: React.Dispatch<React.SetStateAction<OrderFilterStatus>>;

  from: string;
  setFrom: React.Dispatch<React.SetStateAction<string>>;
  to: string;
  setTo: React.Dispatch<React.SetStateAction<string>>;
  minTotal: string;
  setMinTotal: React.Dispatch<React.SetStateAction<string>>;
  maxTotal: string;
  setMaxTotal: React.Dispatch<React.SetStateAction<string>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
  refreshing: boolean;
  queriesEnabled: boolean;
  onRefresh: () => void;
  onClear: () => void;
  isTodayActive: boolean;
  onToggleToday: () => void;
  totalItems: number;
  pageStart: number;
  pageEnd: number;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  onSearchSelect?: (start: number | null, end: number | null) => void;
}) {
  const [draftSearch, setDraftSearch] = useState(qInput);
  const isFocusedRef = useRef(false);
  const debouncedDraftSearch = useDebouncedValue(draftSearch, 250);

  useEffect(() => {
    if (!isFocusedRef.current && draftSearch !== qInput) {
      setDraftSearch(qInput);
    }
  }, [qInput, draftSearch]);

  useEffect(() => {
    if (debouncedDraftSearch !== qInput) {
      setQInput(debouncedDraftSearch);
    }
  }, [debouncedDraftSearch, qInput, setQInput]);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4">
          <label className={T_LABEL}>Search</label>
          <input
            ref={searchInputRef}
            value={draftSearch}
            onFocus={() => {
              isFocusedRef.current = true;
              onSearchFocus?.();
            }}
            onBlur={() => {
              isFocusedRef.current = false;
              onSearchBlur?.();
            }}
            onSelect={(e) => onSearchSelect?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
            onKeyUp={(e) => onSearchSelect?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
            onClick={(e) => onSearchSelect?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
            onChange={(e) => {
              const next = e.target.value;
              onSearchSelect?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
              setDraftSearch(next);
            }}
            placeholder="Order ID, user, item, payment ref…"
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-2">
          <label className={T_LABEL}>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1);
              setExpandedId(null);
            }}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          >
            <option value="ALL">All</option>
            <option value="DELIVERED">Delivered</option>
            <option value="PENDING">Pending/Created</option>
            <option value="AWAITING FULFILLMENT">Awaiting Fulfillment/Paid</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELED">Canceled</option>
            <option value="REFUNDED">Refunded</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label className={T_LABEL}>From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
              setExpandedId(null);
            }}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-3">
          <label className={T_LABEL}>To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
              setExpandedId(null);
            }}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-2">
          <label className={T_LABEL}>Min ₦</label>
          <input
            type="number"
            min={0}
            value={minTotal}
            onChange={(e) => {
              setMinTotal(e.target.value);
              setPage(1);
              setExpandedId(null);
            }}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-2">
          <label className={T_LABEL}>Max ₦</label>
          <input
            type="number"
            min={0}
            value={maxTotal}
            onChange={(e) => {
              setMaxTotal(e.target.value);
              setPage(1);
              setExpandedId(null);
            }}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5`}
          onClick={onRefresh}
          disabled={!queriesEnabled}
        >
          Refresh
        </button>

        <button
          className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5`}
          onClick={onClear}
        >
          Clear
        </button>

        <button
          type="button"
          aria-pressed={isTodayActive}
          onClick={onToggleToday}
          className={`rounded-lg px-3 py-2 ${BTN} border transition ${isTodayActive
            ? "bg-zinc-900 text-white border-zinc-900"
            : `bg-white ${SILVER_BORDER} hover:bg-black/5`
            }`}
        >
          Today
        </button>

        <div className={`ml-auto ${T_SM} text-ink-soft`}>
          {totalItems > 0 ? <>Showing {pageStart}-{pageEnd} of {totalItems}</> : "No matching orders"}
        </div>
      </div>
    </>
  );
});


function getOrderFilterBucket(
  o: OrderRow
): Exclude<OrderFilterStatus, "ALL"> {
  const orderStatus = String(o.status || "").trim().toUpperCase();
  const latestPayment = latestPaymentOf(o);
  const paymentStatus = String(latestPayment?.status || "").trim().toUpperCase();

  const purchaseOrders = Array.isArray(o.purchaseOrders) ? o.purchaseOrders : [];
  const hasPurchaseOrders = purchaseOrders.length > 0;

  const poStatuses = purchaseOrders.map((po) => String(po.status || "").trim().toUpperCase());

  const hasReleasedPayout = purchaseOrders.some((po) => {
    const payout = String(po.payoutStatus || "").trim().toUpperCase();
    return payout === "RELEASED" || payout === "PAID";
  });

  const allPurchaseOrdersDelivered =
    hasPurchaseOrders &&
    purchaseOrders.every((po) => isPurchaseOrderDeliveredForRefund(po));

  const anyPurchaseOrderInFulfillment = purchaseOrders.some((po) => {
    const s = String(po.status || "").trim().toUpperCase();
    return [
      "PENDING",
      "CONFIRMED",
      "PROCESSING",
      "PACKED",
      "SHIPPED",
      "OUT_FOR_DELIVERY",
    ].includes(s);
  });

  const isRefunded =
    orderStatus === "REFUNDED" ||
    paymentStatus === "REFUNDED";

  if (isRefunded) return "REFUNDED";

  const isCanceled =
    ["CANCELED", "CANCELLED"].includes(orderStatus);

  if (isCanceled) return "CANCELED";

  const isFailed =
    ["FAILED", "FAILURE", "ABANDONED"].includes(paymentStatus) ||
    ["PAYMENT_FAILED", "FAILED"].includes(orderStatus);

  if (isFailed) return "FAILED";

  const isDelivered =
    orderStatus === "DELIVERED" ||
    allPurchaseOrdersDelivered ||
    hasReleasedPayout;

  if (isDelivered) return "DELIVERED";

  const isPaidEffective =
    isPaidStatus(orderStatus) ||
    isPaidStatus(paymentStatus) ||
    orderStatus === "FUNDED";

  const isAwaitingFulfillment =
    isPaidEffective &&
    (
      ["FUNDED", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY"].includes(orderStatus) ||
      anyPurchaseOrderInFulfillment ||
      (hasPurchaseOrders && !allPurchaseOrdersDelivered)
    );

  if (isAwaitingFulfillment) return "AWAITING FULFILLMENT";

  return "PENDING";
}



/* ---------------- Page ---------------- */
export default function OrdersPage() {
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const initialPage = Math.max(1, Number(searchParams.get("page") || 1) || 1);
  const [page, setPage] = useState(initialPage);

  const initialQ = (searchParams.get("q") || searchParams.get("orderId") || "").trim();
  const [qInput, setQInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);

  const [statusFilter, setStatusFilter] = useState<OrderFilterStatus>(
    (((searchParams.get("status") || "ALL").toUpperCase() as OrderFilterStatus) || "ALL")
  );

  const [from, setFrom] = useState(searchParams.get("from") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [minTotal, setMinTotal] = useState(searchParams.get("minTotal") || "");
  const [maxTotal, setMaxTotal] = useState(searchParams.get("maxTotal") || "");

  const [otpModal, setOtpModal] = useState<OtpState>({ open: false });

  const pendingUrlSyncRef = useRef(false);

  const { openModal, closeModal } = useModal();

  const showErrorModal = (title: string, message: any) => {
    openModal({
      title,
      message:
        typeof message === "string" ? (
          message
        ) : (
          <div className={`${T_BASE} text-zinc-700`}>{String(message)}</div>
        ),
      size: "sm",
    });
  };

  const showSuccessModal = (title: string, message: any) => {
    openModal({
      title,
      message:
        typeof message === "string" ? (
          message
        ) : (
          <div className={`${T_BASE} text-zinc-700`}>{String(message)}</div>
        ),
      size: "sm",
    });
  };

  /* ----- Auth / Role ----- */
  const storeUser = useAuthStore((s) => s.user);
  const storeRole = (storeUser?.role || "") as Role;
  const storeUserId = useAuthStore((s) => s.user?.id ?? null);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const orderAnchorRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingAnchorOrderIdRef = useRef<string | null>(null);

  const meQ = useQuery({
    queryKey: ["me-min"],
    enabled: authHydrated,
    queryFn: async () => {
      const res = await api.get("/api/profile/me", AXIOS_COOKIE_CFG);
      return (res.data?.data ?? res.data ?? null) as { role?: Role; id?: string } | null;
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const authReady = authHydrated && (meQ.isSuccess || meQ.isError);

  const sessionUser = useMemo(() => {
    if (meQ.data?.id) {
      return {
        ...(storeUser ?? {}),
        ...meQ.data,
      };
    }
    return storeUser ?? null;
  }, [meQ.data, storeUser]);

  const isSessionAuthenticated = !!sessionUser?.id || !!storeUserId;

  const role: Role = (sessionUser?.role || storeRole || "SHOPPER") as Role;

  const isSuperAdmin = role === "SUPER_ADMIN";
  const isAdmin = role === "ADMIN" || isSuperAdmin;
  const isMetricsRole = isSuperAdmin;
  const isSupplier = String(role || "").toUpperCase() === "SUPPLIER";

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const ignoreNextUrlSyncRef = useRef(false);
  const ignoreNextStateToUrlRef = useRef(false);
  const lastUrlSignatureRef = useRef("");
  const searchFocusedRef = useRef(false);
  const selectionRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  const meStatus = (meQ.error as any)?.response?.status;

  const mustLogin =
    authReady &&
    !isSessionAuthenticated &&
    (meStatus === 401 || meStatus === 403);

  const mustGoSupplier = authReady && !mustLogin && isSupplier;
  const queriesEnabled = authReady && isSessionAuthenticated && !mustGoSupplier;

  /* ---------------- Sorting ---------------- */
  type SortKey = "id" | "user" | "items" | "total" | "status" | "date";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });

  function isPaidAllocationStatus(status?: string | null): boolean {
    return String(status || "").trim().toUpperCase() === "PAID";
  }

  function isPurchaseOrderSupplierPaid(po: PurchaseOrderRow, order: OrderRow): boolean {
    const poPayout = String(po.payoutStatus || "").trim().toUpperCase();
    if (poPayout === "RELEASED" || poPayout === "PAID") return true;

    const allocations = (order.payments || []).flatMap((p) => p.allocations || []);
    return allocations.some(
      (a) =>
        String(a.purchaseOrderId || "").trim() === String(po.id || "").trim() &&
        isPaidAllocationStatus(a.status)
    );
  }

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "date" ? "desc" : "asc" }
    );
  };

  /* ---------------- Search focus preservation ---------------- */


  const handleSearchFocus = useCallback(() => {
    searchFocusedRef.current = true;
  }, []);

  const commitStateToUrl = useCallback(() => {
    const current = new URLSearchParams(location.search);
    const next = new URLSearchParams(location.search);

    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");

    next.delete("orderId");
    next.delete("open");

    if (from) next.set("from", from);
    else next.delete("from");

    if (to) next.set("to", to);
    else next.delete("to");

    if (minTotal.trim()) next.set("minTotal", minTotal.trim());
    else next.delete("minTotal");

    if (maxTotal.trim()) next.set("maxTotal", maxTotal.trim());
    else next.delete("maxTotal");

    if (statusFilter !== "ALL") next.set("status", statusFilter);
    else next.delete("status");

    next.set("page", String(page));

    const currentStr = current.toString();
    const nextStr = next.toString();

    if (currentStr !== nextStr) {
      lastUrlSignatureRef.current = JSON.stringify({
        q: q.trim(),
        from,
        to,
        minTotal: minTotal.trim(),
        maxTotal: maxTotal.trim(),
        status: statusFilter,
        page,
      });

      setSearchParams(next, { replace: true, preventScrollReset: true });
    }
  }, [
    location.search,
    q,
    from,
    to,
    minTotal,
    maxTotal,
    statusFilter,
    page,
    setSearchParams,
  ]);


  const handleSearchBlur = useCallback(() => {
    window.requestAnimationFrame(() => {
      const el = searchInputRef.current;
      searchFocusedRef.current = !!el && document.activeElement === el;

      if (!searchFocusedRef.current && pendingUrlSyncRef.current) {
        pendingUrlSyncRef.current = false;
        commitStateToUrl();
      }
    });
  }, [commitStateToUrl]);

  const handleSearchSelect = useCallback((start: number | null, end: number | null) => {
    selectionRef.current = { start, end };
  }, []);

  /* ---------------- Debounced search commit ---------------- */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = qInput.trim();
      const prev = q.trim();

      if (next !== prev) {
        ignoreNextUrlSyncRef.current = true;
        setQ(next);
        setPage(1);
        setExpandedId(null);
      }
    }, 250);

    return () => window.clearTimeout(t);
  }, [qInput, q]);

  /* ----- Orders ----- */
  const ordersQ = useQuery<OrdersEnvelope>({
    queryKey: [
      "orders",
      isAdmin ? "admin" : "mine",
      {
        page,
        pageSize: PAGE_SIZE,
        q: q.trim(),
        status: statusFilter,
        from: toYMD(from),
        to: toYMD(to),
        minTotal: minTotal.trim(),
        maxTotal: maxTotal.trim(),
        sortKey: sort.key,
        sortDir: sort.dir,
      },
    ],
    enabled: queriesEnabled,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<OrdersEnvelope> => {
      const shouldClientFilterStatus = statusFilter !== "ALL";

      const requestPage = shouldClientFilterStatus ? 1 : page;
      const requestPageSize = shouldClientFilterStatus ? 500 : PAGE_SIZE;

      const params = new URLSearchParams();
      params.set("page", String(requestPage));
      params.set("pageSize", String(requestPageSize));
      params.set("limit", String(requestPageSize));
      params.set("sortBy", sort.key);
      params.set("sortDir", sort.dir);

      const qv = q.trim();
      if (qv) params.set("q", qv);
      if (toYMD(from)) params.set("from", toYMD(from)!);
      if (toYMD(to)) params.set("to", toYMD(to)!);
      if (minTotal.trim()) params.set("minTotal", minTotal.trim());
      if (maxTotal.trim()) params.set("maxTotal", maxTotal.trim());

      const url = isAdmin ? "/api/orders" : "/api/orders/mine";
      const res = await api.get(`${url}?${params.toString()}`, AXIOS_COOKIE_CFG);

      const normalized = normalizeOrdersEnvelope(res.data, requestPage, requestPageSize);

      if (shouldClientFilterStatus) {
        return {
          ...normalized,
          page: 1,
          pageSize: requestPageSize,
          total: normalized.rows.length,
          totalPages: Math.max(1, Math.ceil(normalized.rows.length / requestPageSize)),
          serverPagination: false,
        };
      }

      return normalized;
    },
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const mustLoginFromData =
    authReady &&
    !isSessionAuthenticated &&
    ((ordersQ.isError && isAuthError(ordersQ.error)) ||
      (meQ.isError && isAuthError(meQ.error)));

  /* ---- expanded row from ?open= ---- */
  const openId = useMemo(() => searchParams.get("open") || "", [searchParams]);
  useEffect(() => {
    if (openId) setExpandedId(openId);
  }, [openId]);

  const serverEnvelope = ordersQ.data;
  const serverRows = serverEnvelope?.rows || [];
  const serverPagination = !!serverEnvelope?.serverPagination;

  const colSpan = isAdmin ? 7 : 6;

  /* ---------------- URL -> state sync without clobbering focus ---------------- */
  useEffect(() => {
    if (ignoreNextUrlSyncRef.current) {
      ignoreNextUrlSyncRef.current = false;
      return;
    }

    const sp = new URLSearchParams(location.search);

    const qpQ = (sp.get("q") || sp.get("orderId") || "").trim();
    const qpFrom = sp.get("from") || "";
    const qpTo = sp.get("to") || "";
    const qpMinTotal = sp.get("minTotal") || "";
    const qpMaxTotal = sp.get("maxTotal") || "";
    const qpStatus =
      ((sp.get("status") || "ALL").toUpperCase() as OrderFilterStatus);

    const qpPage = Math.max(1, Number(sp.get("page") || 1) || 1);

    const sig = JSON.stringify({
      q: qpQ,
      from: qpFrom,
      to: qpTo,
      minTotal: qpMinTotal,
      maxTotal: qpMaxTotal,
      status: qpStatus,
      page: qpPage,
    });

    if (sig === lastUrlSignatureRef.current) return;
    lastUrlSignatureRef.current = sig;

    ignoreNextStateToUrlRef.current = true;

    setQ((prev) => (prev === qpQ ? prev : qpQ));
    if (!searchFocusedRef.current) {
      setQInput((prev) => (prev === qpQ ? prev : qpQ));
    }
    setFrom((prev) => (prev === qpFrom ? prev : qpFrom));
    setTo((prev) => (prev === qpTo ? prev : qpTo));
    setMinTotal((prev) => (prev === qpMinTotal ? prev : qpMinTotal));
    setMaxTotal((prev) => (prev === qpMaxTotal ? prev : qpMaxTotal));
    setStatusFilter((prev) => (prev === qpStatus ? prev : qpStatus));
    setPage((prev) => (prev === qpPage ? prev : qpPage));
  }, [location.search]);

  /* ---- auto-open exact orderId from URL ---- */

  const didAutoOpenRef = useRef(false);

  useEffect(() => {
    if (!queriesEnabled) return;
    if (didAutoOpenRef.current) return;

    const oid = (searchParams.get("orderId") || "").trim();
    if (!oid) return;
    if (!serverRows.length) return;

    const exact = serverRows.find((o) => String(o.id) === oid);
    if (!exact) return;

    didAutoOpenRef.current = true;
    setExpandedId(oid);
  }, [serverRows, searchParams, queriesEnabled]);

  const onBuyAgain = (it: OrderItem) => {
    const productId = firstNonEmptyString(
      it.productId,
      it.product?.id,
      it.variant?.productId,
      it.productVariant?.productId,
      it.productVariant?.product?.id
    );

    if (!productId) {
      showErrorModal(
        "Unavailable",
        "This item no longer has a valid product reference, so it cannot be bought again."
      );
      return;
    }

    try {
      const line = buildBuyAgainCartLine(it);
      upsertCartLine(line as any);
      nav("/checkout");
    } catch (e: any) {
      showErrorModal(
        "Could not add item",
        e?.message || "Could not prepare this item for checkout."
      );
    }
  };

  const orderDetailQ = useQuery({
    queryKey: ["order-detail", expandedId, isAdmin],
    enabled: queriesEnabled && !!expandedId,
    queryFn: async () => {
      if (!expandedId) return null;

      const tryUrls = isAdmin
        ? [`/api/orders/${expandedId}`, `/api/admin/orders/${expandedId}`, `/api/orders/admin/${expandedId}`]
        : [`/api/orders/${expandedId}`, `/api/orders/mine/${expandedId}`];

      let lastErr: any = null;
      for (const url of tryUrls) {
        try {
          const res = await api.get(url, AXIOS_COOKIE_CFG);
          const payload = res.data?.order ?? res.data?.data ?? res.data;
          return normalizeOrder(payload);
        } catch (e) {
          lastErr = e;
          if (isAuthError(e)) throw e;
        }
      }

      console.warn("Order detail fetch failed for", expandedId, lastErr);
      return null;
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const refundsQ = useQuery<RefundRow[]>({
    queryKey: ["refunds", isAdmin ? "all" : "mine"],
    enabled: queriesEnabled,
    queryFn: async () => {
      const tryUrls = isAdmin
        ? ["/api/refunds", "/api/admin/refunds"]
        : ["/api/refunds/mine", "/api/refunds"];

      let lastErr: any = null;
      for (const url of tryUrls) {
        try {
          const { data } = await api.get(url, AXIOS_COOKIE_CFG);
          return normalizeRefunds(data);
        } catch (e: any) {
          lastErr = e;
          if (isAuthError(e)) throw e;
        }
      }

      console.warn("Refund fetch failed", lastErr);
      return [] as RefundRow[];
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const refunds: RefundRow[] = Array.isArray(refundsQ.data) ? refundsQ.data : [];
  /* ---------------- Filter Bar helpers ---------------- */
  const clearFilters = useCallback(() => {
    searchFocusedRef.current = false;
    setQ("");
    setQInput("");
    setStatusFilter("ALL");
    setFrom("");
    setTo("");
    setMinTotal("");
    setMaxTotal("");
    setPage(1);
    setExpandedId(null);

    const sp = new URLSearchParams(searchParams);
    sp.delete("q");
    sp.delete("orderId");
    sp.delete("open");
    sp.delete("from");
    sp.delete("to");
    sp.delete("minTotal");
    sp.delete("maxTotal");
    sp.delete("status");
    sp.set("page", "1");
    setSearchParams(sp, { replace: true, preventScrollReset: true });
  }, [searchParams, setSearchParams]);
  const pricingSettingsQ = useQuery({
    queryKey: ["admin", "settings", "pricing-public-orders"],
    enabled: queriesEnabled && isMetricsRole,
    queryFn: async () => {
      const { data } = await api.get("/api/settings/public", AXIOS_COOKIE_CFG);
      return {
        marginPercent:
          Number(
            data?.marginPercent ??
            data?.pricingMarkupPercent ??
            data?.platformMarginPercent ??
            0
          ) || 0,
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const marginPercent = Number(pricingSettingsQ.data?.marginPercent ?? 0) || 0;

  const tdy = todayYMD();
  const isTodayActive = from === tdy && to === tdy;
  const toggleToday = useCallback(() => {
    if (isTodayActive) {
      setFrom("");
      setTo("");
    } else {
      setFrom(tdy);
      setTo(tdy);
    }
    setPage(1);
    setExpandedId(null);
  }, [isTodayActive, tdy]);

  /* ---------------- Derived: filtered + sorted ---------------- */
  const filteredSorted = useMemo(() => {
    const qnorm = q.trim().toLowerCase();
    const dateFrom = from ? new Date(from).getTime() : null;
    const dateTo = to ? new Date(to + "T23:59:59.999").getTime() : null;
    const min = minTotal ? Number(minTotal) : null;
    const max = maxTotal ? Number(maxTotal) : null;

    const list = serverRows.filter((o) => {
      if (qnorm) {
        const pool: string[] = [];
        pool.push(o.id || "");
        if (o.userEmail) pool.push(o.userEmail);

        (o.items || []).forEach((it) => {
          if (it.title) pool.push(String(it.title));
          if (it.product?.title) pool.push(String(it.product.title));
        });

        const lp = latestPaymentOf(o);
        if (lp?.reference) pool.push(lp.reference);

        const hit = pool.some((s) => s.toLowerCase().includes(qnorm));
        if (!hit) return false;
      }

      if (statusFilter !== "ALL") {
        const bucket = getOrderFilterBucket(o);
        if (bucket !== statusFilter) return false;
      }

      if (from || to) {
        const ts = o.createdAt ? new Date(o.createdAt).getTime() : 0;
        if (dateFrom != null && ts < dateFrom) return false;
        if (dateTo != null && ts > dateTo) return false;
      }

      const totalNum = fmtN(o.total);
      if (min != null && totalNum < min) return false;
      if (max != null && totalNum > max) return false;

      return true;
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    const ordered = [...list].sort((a, b) => {
      const s = sort.key;

      if (s === "date") {
        const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return (av - bv) * dir;
      }

      if (s === "total") return (fmtN(a.total) - fmtN(b.total)) * dir;
      if (s === "items") return ((a.items || []).length - (b.items || []).length) * dir;

      if (s === "status") {
        const aBucket = getOrderFilterBucket(a);
        const bBucket = getOrderFilterBucket(b);
        return aBucket.localeCompare(bBucket, undefined, { sensitivity: "base" }) * dir;
      }

      if (s === "user") {
        return (
          String(a.userEmail || "").localeCompare(String(b.userEmail || ""), undefined, {
            sensitivity: "base",
          }) * dir
        );
      }

      return String(a.id).localeCompare(String(b.id), undefined, { sensitivity: "base" }) * dir;
    });

    return ordered;
  }, [serverRows, q, statusFilter, from, to, minTotal, maxTotal, sort.key, sort.dir]);
  useEffect(() => {
    if (ignoreNextStateToUrlRef.current) {
      ignoreNextStateToUrlRef.current = false;
      return;
    }

    if (searchFocusedRef.current) {
      pendingUrlSyncRef.current = true;
      return;
    }

    commitStateToUrl();
  }, [commitStateToUrl]);

  const handleRefresh = useCallback(async () => {
    try {
      setManualRefreshing(true);
      await ordersQ.refetch();
    } finally {
      setManualRefreshing(false);
    }
  }, [ordersQ]);


  const handleDesktopPageChange = useCallback((p: number) => {
    if (p === page) return;
    ignoreNextUrlSyncRef.current = true;
    setExpandedId(null);
    setPage(p);
  }, [page]);

  const handleMobilePageChange = useCallback((p: number) => {
    if (p === page) return;
    ignoreNextUrlSyncRef.current = true;
    setExpandedId(null);
    setPage(p);
  }, [page]);

  useEffect(() => {
    setPage((prev) => (prev === 1 ? prev : 1));
  }, [q, statusFilter, from, to, minTotal, maxTotal, sort.key, sort.dir]);

  const totalItems = serverPagination ? serverEnvelope?.total || 0 : filteredSorted.length;

  const totalPages = serverPagination
    ? Math.max(1, serverEnvelope?.totalPages || 1)
    : Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));

  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pageStart = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd =
    totalItems === 0
      ? 0
      : Math.min(totalItems, (currentPage - 1) * PAGE_SIZE + PAGE_SIZE);

  const visibleRefunds = useMemo(() => {
    const visibleOrderIds = new Set(filteredSorted.map((o) => String(o.id || "").trim()));
    const visiblePoIds = new Set(
      filteredSorted.flatMap((o) =>
        (Array.isArray(o.purchaseOrders) ? o.purchaseOrders : [])
          .map((po) => String(po.id || "").trim())
          .filter(Boolean)
      )
    );

    return refunds.filter((r) => {
      const orderId = String(r.orderId ?? "").trim();
      const poId = String(r.purchaseOrderId ?? r.purchaseOrder?.id ?? "").trim();
      return (orderId && visibleOrderIds.has(orderId)) || (poId && visiblePoIds.has(poId));
    });
  }, [refunds, filteredSorted]);

  const refundMetrics = useMemo(() => {
    let totalRefunds = 0;
    let totalPaidToCustomer = 0;
    let openCount = 0;
    let paidToCustomerCount = 0;

    for (const r of visibleRefunds) {
      const amount = getRefundAmount(r);
      totalRefunds += amount;

      if (isRefundOpenStatus(r.status)) {
        openCount += 1;
      }

      if (isRefundPaidToCustomer(r)) {
        totalPaidToCustomer += amount;
        paidToCustomerCount += 1;
      }
    }

    return {
      count: visibleRefunds.length,
      totalRefunds,
      totalPaidToCustomer,
      openCount,
      paidToCustomerCount,
    };
  }, [visibleRefunds]);

  const paginated = useMemo(() => {
    if (serverPagination) return filteredSorted;
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredSorted.slice(start, start + PAGE_SIZE);
  }, [serverPagination, filteredSorted, currentPage]);

  const loading = !authReady || (ordersQ.isLoading && !ordersQ.data);
  const refreshing = manualRefreshing;
  const backgroundFetching = ordersQ.isFetching && !!ordersQ.data;

  /* ---------------- Metrics ---------------- */
  const profitRangeQ = useQuery({
    queryKey: ["metrics", "profit-summary", { from: toYMD(from), to: toYMD(to) }],
    enabled: queriesEnabled && isMetricsRole,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (toYMD(from)) params.set("from", toYMD(from)!);
      if (toYMD(to)) params.set("to", toYMD(to)!);

      const { data } = await api.get(
        `/api/admin/metrics/profit-summary${params.toString() ? `?${params.toString()}` : ""}`,
        AXIOS_COOKIE_CFG
      );

      return data as {
        revenuePaid: number | string;
        refunds: number | string;
        revenueNet: number | string;
        gatewayFees: number | string;
        taxCollected: number | string;
        commsNet: number | string;
        grossProfit: number | string;
        grossProfitSafe?: number | string;
        today?: { grossProfit: number | string; grossProfitSafe?: number | string };
        range: { from: string; to: string };
      };
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    retry: false,
  });

  const aggregates = useMemo(() => {
    if (!isMetricsRole) return null;

    let revenuePaid = 0;
    let supplierBaseRevenue = 0;
    let supplierPayouts = 0;
    let commissionRevenue = 0;
    let serviceRevenue = 0;

    for (const o of filteredSorted) {
      const realized = isPaidStatus(o.status) || fmtN(o.paidAmount) > 0;
      if (!realized) continue;

      const metricsRevenue = fmtN(o.metrics?.revenue);
      const paidAmount = fmtN(o.paidAmount);

      if (metricsRevenue > 0) revenuePaid += metricsRevenue;
      else if (paidAmount > 0) revenuePaid += paidAmount;
      else revenuePaid += fmtN(o.total);

      const supplierBase = orderSupplierBasePriceTotal(o);
      const payout = orderSupplierPayoutTotal(o);
      const commission = orderCommissionRevenue(o, marginPercent);
      const serviceFee = orderServiceRevenue(o);

      supplierBaseRevenue += supplierBase;
      supplierPayouts += payout;
      commissionRevenue += commission;
      serviceRevenue += serviceFee;
    }

    const refundsTotal = refundMetrics.totalRefunds;
    const refundsPaidToCustomer = refundMetrics.totalPaidToCustomer;

    const revenueNet = revenuePaid - refundsPaidToCustomer;
    const grossProfit = commissionRevenue + serviceRevenue - refundsPaidToCustomer;

    return {
      revenuePaid,
      refundsTotal,
      refundsPaidToCustomer,
      revenueNet,
      supplierBaseRevenue,
      supplierPayouts,
      commissionRevenue,
      serviceRevenue,
      grossProfit,
    };
  }, [filteredSorted, isMetricsRole, marginPercent, refundMetrics]);

  const grossProfit = useMemo(() => {
    if (!isMetricsRole) return 0;
    return aggregates?.grossProfit ?? 0;
  }, [isMetricsRole, aggregates]);

  /* ---------------- Actions ---------------- */
  const onToggle = useCallback((id: string) => {
    setExpandedId((curr) => {
      const next = curr === id ? null : id;
      pendingAnchorOrderIdRef.current = curr === id ? null : id;
      return next;
    });
  }, []);

  const closeOtp = () => setOtpModal({ open: false });

  const otpReqKey = (orderId: string, purpose: OtpPurpose) => `otp:req:${orderId}:${purpose}`;

  const loadPendingOtp = (orderId: string, purpose: OtpPurpose) => {
    try {
      const raw = sessionStorage.getItem(otpReqKey(orderId, purpose));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const expiresAt = Number(obj?.expiresAt || 0);
      const requestId = String(obj?.requestId || "");
      const channelHint = obj?.channelHint ?? null;

      if (!requestId || !expiresAt) return null;

      if (Date.now() >= expiresAt) {
        sessionStorage.removeItem(otpReqKey(orderId, purpose));
        return null;
      }

      return { requestId, expiresAt, channelHint };
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const id = pendingAnchorOrderIdRef.current;
    if (!id) return;

    if (!expandedId || expandedId !== id) {
      pendingAnchorOrderIdRef.current = null;
      return;
    }

    const el = orderAnchorRefs.current[id];
    if (!el) return;

    pendingAnchorOrderIdRef.current = null;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const viewportH = window.innerHeight || 0;

        // Only nudge when the clicked order row/card is already on screen.
        const isVisible =
          rect.bottom > 0 &&
          rect.top < viewportH;

        if (!isVisible) return;

        // Always move DOWN a bit so the expanded content below comes into view.
        window.scrollBy({
          top: 140,
          behavior: "smooth",
        });
      });
    });
  }, [expandedId]);

  const savePendingOtp = (
    orderId: string,
    purpose: OtpPurpose,
    data: { requestId: string; expiresAt: number; channelHint?: string | null }
  ) => {
    sessionStorage.setItem(otpReqKey(orderId, purpose), JSON.stringify(data));
  };

  const clearPendingOtp = (orderId: string, purpose: OtpPurpose) => {
    sessionStorage.removeItem(otpReqKey(orderId, purpose));
  };

  const requestOtp = async (orderId: string, purpose: OtpPurpose) => {
    const { data } = await api.post(
      `/api/orders/${encodeURIComponent(orderId)}/otp/request`,
      { purpose },
      { ...AXIOS_COOKIE_CFG, headers: { "Content-Type": "application/json" } }
    );

    const expiresInSec = Number(data?.expiresInSec ?? 300);
    const expiresAt = Date.now() + Math.max(30, expiresInSec) * 1000;

    const out = {
      requestId: String(data?.requestId ?? ""),
      expiresAt,
      channelHint: data?.channelHint ?? null,
    };

    if (out.requestId) savePendingOtp(orderId, purpose, out);
    return out;
  };

  const verifyOtp = async (orderId: string, requestId: string, purpose: OtpPurpose, otp: string) => {
    const { data } = await api.post(
      `/api/orders/${encodeURIComponent(orderId)}/otp/verify`,
      { purpose, requestId, otp },
      { ...AXIOS_COOKIE_CFG, headers: { "Content-Type": "application/json" } }
    );

    const otpToken = String(data?.token ?? "");
    if (!otpToken) throw new Error("OTP verified but no token returned.");
    return otpToken;
  };

  const withOtp = async (
    orderId: string,
    purpose: OtpPurpose,
    onSuccess: (otpToken: string) => Promise<void> | void
  ) => {
    try {
      const pending = loadPendingOtp(orderId, purpose);
      if (pending) {
        setOtpModal({
          open: true,
          orderId,
          purpose,
          requestId: pending.requestId,
          expiresAt: pending.expiresAt,
          channelHint: pending.channelHint,
          otp: "",
          busy: false,
          error: null,
          onSuccess,
        });
        return;
      }

      const r = await requestOtp(orderId, purpose);
      if (!r.requestId) throw new Error("Failed to request OTP.");

      setOtpModal({
        open: true,
        orderId,
        purpose,
        requestId: r.requestId,
        expiresAt: r.expiresAt,
        channelHint: r.channelHint,
        otp: "",
        busy: false,
        error: null,
        onSuccess,
      });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || "Could not send OTP");
    }
  };

  const onPay = (orderId: string) => {
    withOtp(orderId, "PAY_ORDER", async (otpToken) => {
      sessionStorage.setItem(`otp:${orderId}:PAY_ORDER`, otpToken);
      nav(`/payment?orderId=${encodeURIComponent(orderId)}`);
    });
  };

  const canCancel = (details: OrderRow, latestPayment: PaymentRow | null) => {
    const st = String(details.status || "").toUpperCase();
    const paymentStatus = String(latestPayment?.status || "").toUpperCase();
    const isPaidEffective =
      isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);

    if (isPaidEffective) return false;
    if (["CANCELED", "CANCELLED", "REFUNDED"].includes(st)) return false;

    if (!["PENDING", "CREATED"].includes(st)) return false;

    if (
      paymentStatus &&
      !["PENDING", "CREATED", "INITIATED"].includes(paymentStatus)
    ) {
      return false;
    }

    return true;
  };

  const onCancel = async (orderId: string) => {
    const ok = window.confirm("Cancel this order? This can only be done before payment/fulfillment.");
    if (!ok) return;

    withOtp(orderId, "CANCEL_ORDER", async (otpToken) => {
      try {
        const url = isAdmin
          ? `/api/admin/orders/${encodeURIComponent(orderId)}/cancel`
          : `/api/orders/${encodeURIComponent(orderId)}/cancel`;

        await api.post(url, {}, { ...AXIOS_COOKIE_CFG, headers: { [OTP_HEADER_NAME]: otpToken } });

        await ordersQ.refetch();
        setExpandedId(null);
        closeOtp();
      } catch (e: any) {
        if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
        else alert(e?.response?.data?.error || "Could not cancel order");
      }
    });
  };

  const canRefund = (details: OrderRow, latestPayment: PaymentRow | null) => {
    if (!isAdmin) return false;

    const orderSt = String(details.status || "").toUpperCase();
    const paySt = String(latestPayment?.status || "").toUpperCase();

    if (orderSt === "REFUNDED" || paySt === "REFUNDED") return false;

    const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);
    return isPaidEffective;
  };

  const onRefund = async (orderId: string) => {
    if (!isAdmin) return;

    const ok = window.confirm("Refund this order? This will initiate a refund for the latest paid payment.");
    if (!ok) return;

    withOtp(orderId, "REFUND_ORDER", async (otpToken) => {
      try {
        await api.post(
          `/api/admin/orders/${encodeURIComponent(orderId)}/refund`,
          {},
          { ...AXIOS_COOKIE_CFG, headers: { [OTP_HEADER_NAME]: otpToken } }
        );

        await ordersQ.refetch();
        setExpandedId(null);
        closeOtp();
      } catch (e: any) {
        if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
        else alert(e?.response?.data?.error || "Could not refund order");
      }
    });
  };

  /* ---------------- Customer Refund ---------------- */
  const submitCustomerRefund = async (draft: RefundDraft, items: OrderItem[]) => {
    const selectedLines = getSelectedRefundLines(draft, items);
    const selectedItemIds = selectedLines.map((row) => row.itemId);

    if (!selectedLines.length) {
      throw new Error("Please select at least one item quantity to refund.");
    }

    const payload: any = {
      orderId: draft.orderId,
      purchaseOrderId: draft.purchaseOrderId,
      reason: draft.reason,
      message: draft.message,
      note: draft.message,
      mode: draft.mode,

      // New preferred payload
      itemQuantities: selectedLines.map((row) => ({
        itemId: row.itemId,
        qty: row.qty,
      })),

      // Legacy compatibility
      itemIds: selectedItemIds,
    };

    const evidence = selectedLines
      .map((row) => ({
        itemId: row.itemId,
        qty: row.qty,
        urls: Array.isArray(draft.evidenceByItemId?.[row.itemId])
          ? draft.evidenceByItemId[row.itemId]
          : [],
      }))
      .filter((row) => row.urls.length > 0);

    if (evidence.length > 0) {
      payload.evidence = evidence;
    }

    const tryUrls = ["/api/refunds", "/api/refunds/request", "/api/orders/refund-request"];

    let lastErr: any = null;
    for (const url of tryUrls) {
      try {
        await api.post(url, payload, {
          ...AXIOS_COOKIE_CFG,
          headers: { "Content-Type": "application/json" },
        });
        return true;
      } catch (e: any) {
        lastErr = e;
        if (isAuthError(e)) throw e;
      }
    }

    console.warn("Customer refund submit failed", lastErr);
    throw lastErr || new Error("Could not submit refund request");
  };

  const onCustomerRefund = (details: OrderRow, po: PurchaseOrderRow) => {
    if (isAdmin) return;

    const orderId = String(details.id || "");
    const purchaseOrderId = String(po?.id || "");
    const supplierId = String(po?.supplierId || "").trim() || null;
    const supplierName = po?.supplierName ?? null;

    if (!orderId || !purchaseOrderId) return;

    const poItems = getItemsForPurchaseOrder(details, po);

    const initialSelectedItemIds = poItems.reduce<Record<string, boolean>>((acc, it) => {
      acc[String(it.id)] = true;
      return acc;
    }, {});

    const initialSelectedQtyByItemId = poItems.reduce<Record<string, number>>((acc, it) => {
      acc[String(it.id)] = getOrderItemQty(it);
      return acc;
    }, {});

    const initial: RefundDraft = {
      orderId,
      purchaseOrderId,
      supplierId,
      supplierName,
      reason: "NOT_RECEIVED",
      message: "",
      mode: "ALL",
      selectedItemIds: initialSelectedItemIds,
      selectedQtyByItemId: initialSelectedQtyByItemId,
      evidenceByItemId: {},
      uploadingByItemId: {},
      busy: false,
      error: null,
    };

    const RefundModal = () => {
      const [draft, setDraft] = useState<RefundDraft>(initial);

      const items = poItems;
      const canPickSome = items.length > 0;
      const needsEvidence = refundReasonRequiresEvidence(draft.reason);
      const selectedLines = getSelectedRefundLines(draft, items);
      const selectedItemIds = selectedLines.map((row) => row.itemId);
      const allRequiredEvidenceProvided =
        !needsEvidence || allSelectedItemsHaveEvidenceForLines(draft, items);
      const hasValidSelectedQty = allSelectedRefundQtyValid(draft, items);

      const toggleItem = (id: string, checked?: boolean) => {
        setDraft((s) => {
          const nextChecked = typeof checked === "boolean" ? checked : !s.selectedItemIds[id];
          const currentQty = s.selectedQtyByItemId?.[id] ?? 0;
          const item = items.find((x) => String(x.id) === String(id));
          const maxQty = item ? getOrderItemQty(item) : 1;

          return {
            ...s,
            selectedItemIds: { ...s.selectedItemIds, [id]: nextChecked },
            selectedQtyByItemId: {
              ...s.selectedQtyByItemId,
              [id]: nextChecked ? Math.max(1, clampRefundQty(currentQty || 1, maxQty)) : 0,
            },
            error: null,
          };
        });
      };

      const changeItemQty = (id: string, nextRaw: any) => {
        setDraft((s) => {
          const item = items.find((x) => String(x.id) === String(id));
          const maxQty = item ? getOrderItemQty(item) : 1;
          const nextQty = clampRefundQty(nextRaw, maxQty);

          return {
            ...s,
            selectedQtyByItemId: {
              ...s.selectedQtyByItemId,
              [id]: nextQty,
            },
            selectedItemIds: {
              ...s.selectedItemIds,
              [id]: nextQty > 0,
            },
            error: null,
          };
        });
      };

      const onPickEvidenceFilesForItem = async (itemId: string, fileList: FileList | null) => {
        const files = Array.from(fileList || []).filter(Boolean);
        if (!files.length) return;

        try {
          setDraft((s) => ({
            ...s,
            uploadingByItemId: { ...s.uploadingByItemId, [itemId]: true },
            error: null,
          }));

          const imageFiles = files.filter((f) => String(f.type || "").startsWith("image/"));
          if (!imageFiles.length) {
            throw new Error("Please select image files only.");
          }

          const urls = await uploadRefundEvidence(imageFiles);

          setDraft((s) => ({
            ...s,
            uploadingByItemId: { ...s.uploadingByItemId, [itemId]: false },
            evidenceByItemId: {
              ...s.evidenceByItemId,
              [itemId]: Array.from(
                new Set([
                  ...((s.evidenceByItemId && s.evidenceByItemId[itemId]) || []),
                  ...urls,
                ])
              ),
            },
          }));
        } catch (e: any) {
          setDraft((s) => ({
            ...s,
            uploadingByItemId: { ...s.uploadingByItemId, [itemId]: false },
            error: e?.response?.data?.error || e?.message || "Could not upload evidence",
          }));
        }
      };

      const removeEvidenceForItemAt = (itemId: string, idx: number) => {
        setDraft((s) => ({
          ...s,
          evidenceByItemId: {
            ...s.evidenceByItemId,
            [itemId]: ((s.evidenceByItemId && s.evidenceByItemId[itemId]) || []).filter((_, i) => i !== idx),
          },
        }));
      };

      const totalRefundQty = selectedLines.reduce((sum, row) => sum + row.qty, 0);

      return (
        <div className="space-y-3">
          <div className="text-xs text-ink-soft">
            Refund for order <span className="font-mono">{orderId}</span>
          </div>

          <div className="text-xs text-ink-soft">
            Purchase order: <span className="font-mono">{purchaseOrderId}</span>
            {supplierName ? <> • Supplier: <span className="font-medium text-zinc-700">{supplierName}</span></> : null}
          </div>

          <div>
            <label className={T_LABEL}>Reason</label>
            <select
              value={draft.reason}
              onChange={(e) =>
                setDraft((s) => ({
                  ...s,
                  reason: e.target.value as RefundReason,
                  error: null,
                }))
              }
              className={`mt-1 w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
            >
              <option value="NOT_RECEIVED">Not received</option>
              <option value="DAMAGED">Damaged</option>
              <option value="WRONG_ITEM">Wrong item</option>
              <option value="NOT_AS_DESCRIBED">Not as described</option>
              <option value="CHANGED_MIND">Changed mind</option>
              <option value="OTHER">Other</option>
            </select>

            {needsEvidence ? (
              <div className="mt-1 text-xs text-amber-700">
                Evidence images are required for each selected item.
              </div>
            ) : null}
          </div>

          <div>
            <label className={T_LABEL}>Message (optional)</label>
            <textarea
              value={draft.message}
              onChange={(e) => setDraft((s) => ({ ...s, message: e.target.value }))}
              rows={3}
              className={`mt-1 w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
              placeholder="Tell us what went wrong…"
            />
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
            {getRefundTaxPolicyLabel()}
          </div>

          {canPickSome && (
            <div className="space-y-2">
              <label className={T_LABEL}>Refund scope</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 ${BTN_XS} border ${draft.mode === "ALL"
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : `bg-white ${SILVER_BORDER}`
                    }`}
                  onClick={() =>
                    setDraft((s) => ({
                      ...s,
                      mode: "ALL",
                      selectedItemIds: items.reduce<Record<string, boolean>>((acc, it) => {
                        acc[String(it.id)] = true;
                        return acc;
                      }, {}),
                      selectedQtyByItemId: items.reduce<Record<string, number>>((acc, it) => {
                        acc[String(it.id)] = getOrderItemQty(it);
                        return acc;
                      }, {}),
                      error: null,
                    }))
                  }
                >
                  All PO items
                </button>

                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 ${BTN_XS} border ${draft.mode === "SOME"
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : `bg-white ${SILVER_BORDER}`
                    }`}
                  onClick={() =>
                    setDraft((s) => ({
                      ...s,
                      mode: "SOME",
                      error: null,
                    }))
                  }
                >
                  Select items / qty
                </button>
              </div>

              <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                Selected refund quantity: <b>{totalRefundQty}</b>
              </div>

              {draft.mode === "SOME" && (
                <div className={`rounded-xl ${SILVER_BORDER} p-2 max-h-72 overflow-auto`}>
                  {items.map((it) => {
                    const itemId = String(it.id);
                    const maxQty = getOrderItemQty(it);
                    const checked = !!draft.selectedItemIds[itemId];
                    const qty = clampRefundQty(draft.selectedQtyByItemId?.[itemId], maxQty);
                    const title = (it.title || it.product?.title || "—").toString();

                    return (
                      <div key={itemId} className="rounded-lg border border-zinc-200/70 bg-white px-3 py-2 mb-2 last:mb-0">
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleItem(itemId, e.target.checked)}
                            className="mt-1"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-zinc-900 truncate">{title}</div>
                            <div className="text-xs text-ink-soft">
                              Ordered qty {maxQty} • {ngn.format(fmtN(it.unitPrice))}
                            </div>
                          </div>

                          <div className="shrink-0 w-[110px]">
                            <label className="block text-[10px] text-zinc-500 mb-1">Refund qty</label>
                            <input
                              type="number"
                              min={0}
                              max={maxQty}
                              value={checked ? qty : 0}
                              disabled={!checked}
                              onChange={(e) => changeItemQty(itemId, e.target.value)}
                              className={`w-full rounded-lg border px-2 py-1.5 text-sm ${!checked ? "bg-zinc-100 text-zinc-400" : "bg-white"}`}
                            />
                          </div>
                        </div>

                        {checked && qty > 0 ? (
                          <div className="mt-2 text-[11px] text-emerald-700">
                            Refunding {qty} of {maxQty}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {draft.mode === "SOME" && !hasValidSelectedQty && (
                <div className="text-xs text-amber-700">
                  Select at least one item and set a refund quantity greater than 0.
                </div>
              )}
            </div>
          )}

          {needsEvidence && selectedItemIds.length > 0 && (
            <div className="space-y-2">
              <label className={T_LABEL}>
                Item evidence <span className="text-rose-600">*</span>
              </label>

              <div className="space-y-3">
                {items
                  .filter((it) => selectedItemIds.includes(String(it.id)))
                  .map((it) => {
                    const itemId = String(it.id);
                    const itemTitle = (it.title || it.product?.title || "—").toString();
                    const urls = draft.evidenceByItemId?.[itemId] || [];
                    const uploading = !!draft.uploadingByItemId?.[itemId];
                    const selectedQty =
                      draft.mode === "ALL"
                        ? getOrderItemQty(it)
                        : clampRefundQty(draft.selectedQtyByItemId?.[itemId], getOrderItemQty(it));

                    return (
                      <div key={itemId} className={`rounded-xl ${SILVER_BORDER} p-3 bg-zinc-50`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-900 truncate">{itemTitle}</div>
                            <div className="text-xs text-ink-soft">
                              Refund qty {selectedQty} of {getOrderItemQty(it)} • {ngn.format(fmtN(it.unitPrice))}
                            </div>
                          </div>

                          <div className="shrink-0">
                            {urls.length > 0 ? (
                              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                Evidence added
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                Required
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-[11px] sm:text-xs hover:bg-black/5">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                void onPickEvidenceFilesForItem(itemId, e.target.files);
                                e.currentTarget.value = "";
                              }}
                              disabled={uploading || draft.busy}
                            />
                            {uploading ? "Uploading…" : "Add images"}
                          </label>

                          <div className={`${T_XS} text-ink-soft`}>
                            Upload at least one image for this item
                          </div>
                        </div>

                        {urls.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {urls.map((url, idx) => (
                              <div
                                key={`${itemId}-${url}-${idx}`}
                                className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white"
                              >
                                <a href={url} target="_blank" rel="noreferrer" className="block">
                                  <img
                                    src={url}
                                    alt={`Evidence ${idx + 1}`}
                                    className="h-24 w-full object-cover"
                                  />
                                </a>

                                <button
                                  type="button"
                                  onClick={() => removeEvidenceForItemAt(itemId, idx)}
                                  disabled={draft.busy || uploading}
                                  className="absolute right-1 top-1 rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium text-white hover:bg-black/80 disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {urls.length === 0 && !uploading && (
                          <div className="mt-2 text-xs text-rose-600">
                            Please upload at least one image for this item.
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {draft.error && <div className="text-xs text-rose-600">{draft.error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              className={`rounded-xl ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5`}
              onClick={() => closeModal()}
              disabled={draft.busy}
            >
              Cancel
            </button>

            <button
              className={`rounded-xl bg-zinc-900 text-white px-3 py-2 ${BTN} disabled:opacity-50`}
              disabled={
                draft.busy ||
                Object.values(draft.uploadingByItemId || {}).some(Boolean) ||
                !draft.orderId ||
                !draft.purchaseOrderId ||
                !hasValidSelectedQty ||
                (needsEvidence && !allRequiredEvidenceProvided)
              }
              onClick={async () => {
                try {
                  if (!hasValidSelectedQty) {
                    setDraft((s) => ({
                      ...s,
                      error: "Please select at least one item quantity to refund.",
                    }));
                    return;
                  }

                  if (needsEvidence && !allRequiredEvidenceProvided) {
                    setDraft((s) => ({
                      ...s,
                      error: "Please upload at least one evidence image for each selected item.",
                    }));
                    return;
                  }

                  setDraft((s) => ({ ...s, busy: true, error: null }));

                  await submitCustomerRefund(draft, items);

                  closeModal();
                  showSuccessModal(
                    "Refund requested",
                    "Your refund request has been submitted for this supplier shipment."
                  );
                  refundsQ.refetch?.();
                  orderDetailQ.refetch?.();
                } catch (e: any) {
                  if (isAuthError(e)) {
                    nav("/login", { replace: true, state: { from: location.pathname + location.search } });
                    return;
                  }
                  setDraft((s) => ({
                    ...s,
                    busy: false,
                    error: e?.response?.data?.error || e?.message || "Could not submit refund request",
                  }));
                }
              }}
            >
              Submit request
            </button>
          </div>
        </div>
      );
    };

    openModal({
      title: "Request refund",
      message: <RefundModal />,
      size: "md",
    });
  };

  const viewReceipt = (key: string) => nav(`/receipt/${encodeURIComponent(key)}`);

  const downloadReceipt = async (key: string) => {
    try {
      const res = await api.get(`/api/payments/${encodeURIComponent(key)}/receipt.pdf`, {
        ...AXIOS_COOKIE_CFG,
        responseType: "blob",
      });

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${key}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
      else alert(e?.response?.data?.error || "Could not download receipt.");
    }
  };

  const printReceipt = async (key: string) => {
    try {
      const res = await api.get(`/api/payments/${encodeURIComponent(key)}/receipt.pdf`, {
        ...AXIOS_COOKIE_CFG,
        responseType: "blob",
      });

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const w = window.open(url, "_blank");
      if (w) {
        const onLoad = () => {
          try {
            w.focus();
            w.print();
          } catch { }
        };
        w.addEventListener("load", onLoad, { once: true });
      }

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
      else alert(e?.response?.data?.error || "Could not open receipt for print.");
    }
  };


  const uploadRefundEvidence = useCallback(async (files: File[]) => {
    if (!files.length) return [];

    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }

    const res = await api.post("/api/uploads", form, {
      ...AXIOS_COOKIE_CFG,
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    const urls = normalizeUploadedUrls(res.data);
    if (!urls.length) {
      throw new Error("Upload succeeded but no file URL was returned.");
    }

    return urls;
  }, []);

  const openRefundsSummary = useCallback(() => {
    const rows = [...visibleRefunds].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    openModal({
      title: isAdmin ? "Refunds summary" : "My refunds",
      size: "lg",
      message: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Total refunds</div>
              <div className="font-semibold">{ngn.format(refundMetrics.totalRefunds)}</div>
              <div className={`${T_XS} text-ink-soft`}>{refundMetrics.count} refund(s)</div>
            </div>

            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Paid to customer</div>
              <div className="font-semibold">{ngn.format(refundMetrics.totalPaidToCustomer)}</div>
              <div className={`${T_XS} text-ink-soft`}>{refundMetrics.paidToCustomerCount} settled</div>
            </div>

            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Open refunds</div>
              <div className="font-semibold">{refundMetrics.openCount}</div>
              <div className={`${T_XS} text-ink-soft`}>Still in progress</div>
            </div>
          </div>

          <div className={`overflow-hidden ${CARD_XL}`}>
            <div className="px-4 py-3 border-b border-zinc-200/70 flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">Refund entries</div>
              <div className={`${T_XS} text-ink-soft`}>
                Customer payout is based on refund paidAt / REFUNDED status
              </div>
            </div>

            <div className="divide-y divide-zinc-200/70 max-h-[60vh] overflow-auto">
              {rows.length === 0 && (
                <div className="px-4 py-5 text-sm text-ink-soft">No refunds in this filtered view.</div>
              )}

              {rows.map((r) => {
                const amount = getRefundAmount(r);
                const paidOutAt = getRefundPaidOutAt(r);

                return (
                  <div key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900">
                          Refund <span className="font-mono">{r.id}</span>
                        </div>
                        <div className={`${T_XS} text-ink-soft`}>
                          Order: <span className="font-mono">{r.orderId || "—"}</span>
                          {" • "}
                          PO: <span className="font-mono">{r.purchaseOrderId || r.purchaseOrder?.id || "—"}</span>
                          {r.supplier?.name ? <> {" • "} Supplier: <b>{r.supplier.name}</b></> : null}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-semibold">{ngn.format(amount)}</div>
                        <div className={`${T_XS} text-ink-soft`}>{getRefundFinancialLabel(r)}</div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                        Status: {String(r.status || "—").replace(/_/g, " ")}
                      </span>

                      {paidOutAt ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Customer paid: {fmtDate(paidOutAt)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Customer payout pending
                        </span>
                      )}
                    </div>
                    {(r.reason || r.adminNote || r.supplierNote || r.supplierResponse) && (
                      <div className={`mt-2 ${T_XS} text-zinc-600`}>
                        {r.reason ? <b>{String(r.reason).replace(/_/g, " ")}</b> : null}
                        {r.reason && (r.adminNote || r.supplierNote || r.supplierResponse) ? " • " : null}
                        {r.adminNote || r.supplierNote || r.supplierResponse || ""}
                      </div>
                    )}

                    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                      {getRefundTaxPolicyLabel()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ),
    });
  }, [visibleRefunds, refundMetrics, isAdmin, openModal]);

  /* ---------------- Redirects ---------------- */
  if (mustLogin || mustLoginFromData) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (mustGoSupplier) {
    return <Navigate to="/supplier/orders" replace />;
  }


  function canShowCancelButtonForUser(
    order: OrderRow,
    latestPayment: PaymentRow | null,
    isAdmin: boolean
  ) {
    if (!canCancel(order, latestPayment)) return false;

    if (isAdmin) return true;

    const purchaseOrders = Array.isArray(order?.purchaseOrders)
      ? order.purchaseOrders
      : [];

    if (!purchaseOrders.length) {
      return true;
    }

    const hasAdvancedPo = purchaseOrders.some((po) => {
      const poStatus = String(po?.status ?? "").toUpperCase();
      return !["PENDING", "CREATED", "CANCELED", "CANCELLED"].includes(poStatus);
    });

    if (hasAdvancedPo) return false;

    return true;
  }

  /* ---------------- Render ---------------- */
  return (
    <SiteLayout>
      <div className={`max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 ${T_BASE}`}>
        <div className="mb-3 md:mb-4 flex flex-col gap-3 min-[768px]:flex-row min-[768px]:items-start min-[768px]:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] leading-[1.05] sm:text-2xl md:text-3xl font-semibold text-ink">
              {isAdmin ? "All Orders" : "My Orders"}
            </h1>
            <p className={`mt-1 max-w-[22rem] ${T_SM} text-ink-soft`}>
              {isAdmin ? "Manage all customer orders." : "Your recent purchase history."}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 min-[768px]:hidden">
            <button
              onClick={() => setFiltersOpen(true)}
              className={`min-w-0 rounded-2xl ${SILVER_BORDER} px-3 py-3 ${BTN_XS} bg-white ${SILVER_SHADOW_SM} font-medium`}
            >
              Filters
            </button>
            <button
              onClick={openRefundsSummary}
              className={`min-w-0 rounded-2xl ${SILVER_BORDER} px-3 py-3 ${BTN_XS} bg-white ${SILVER_SHADOW_SM} font-medium`}
              disabled={!queriesEnabled}
            >
              Refunds{refundMetrics.count ? ` (${refundMetrics.count})` : ""}
            </button>
            <button
              onClick={handleRefresh}
              className={`min-w-0 rounded-2xl ${SILVER_BORDER} px-3 py-3 ${BTN_XS} bg-white ${SILVER_SHADOW_SM} font-medium`}
              disabled={!queriesEnabled}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className={`mb-4 p-4 hidden min-[768px]:block ${CARD_2XL}`}>
          <OrdersFilterBar
            qInput={qInput}
            setQInput={setQInput}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
            minTotal={minTotal}
            setMinTotal={setMinTotal}
            maxTotal={maxTotal}
            setMaxTotal={setMaxTotal}
            setPage={setPage}
            setExpandedId={setExpandedId}
            refreshing={refreshing}
            queriesEnabled={queriesEnabled}
            onRefresh={handleRefresh}
            onClear={clearFilters}
            isTodayActive={isTodayActive}
            onToggleToday={toggleToday}
            totalItems={totalItems}
            pageStart={pageStart}
            pageEnd={pageEnd}
            searchInputRef={searchInputRef}
            onSearchFocus={handleSearchFocus}
            onSearchBlur={handleSearchBlur}
            onSearchSelect={handleSearchSelect}
          />
        </div>

        <div className="hidden min-[768px]:flex items-center gap-2">
          <button
            className={`inline-flex items-center gap-2 rounded-lg ${SILVER_BORDER} bg-white hover:bg-black/5 px-3 py-2 ${BTN} ${SILVER_SHADOW_SM}`}
            onClick={openRefundsSummary}
            disabled={!queriesEnabled}
          >
            {isAdmin ? "Refunds" : "My Refunds"}
            {refundMetrics.count ? ` (${refundMetrics.count})` : ""}
          </button>
        </div>

        {filtersOpen && (
          <div className="fixed inset-0 z-40 min-[768px]:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setFiltersOpen(false)} />
            <div className={`absolute inset-y-0 left-0 w-[84%] max-w-xs p-4 ${CARD_2XL} rounded-none rounded-r-2xl`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Filter orders</h2>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className={`${BTN_XS} text-ink-soft px-2 py-1 rounded-lg hover:bg-black/5`}
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                <OrdersFilterBar
                  qInput={qInput}
                  setQInput={setQInput}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                  from={from}
                  setFrom={setFrom}
                  to={to}
                  setTo={setTo}
                  minTotal={minTotal}
                  setMinTotal={setMinTotal}
                  maxTotal={maxTotal}
                  setMaxTotal={setMaxTotal}
                  setPage={setPage}
                  setExpandedId={setExpandedId}
                  refreshing={refreshing}
                  queriesEnabled={queriesEnabled}
                  onRefresh={handleRefresh}
                  onClear={clearFilters}
                  isTodayActive={isTodayActive}
                  onToggleToday={toggleToday}
                  totalItems={totalItems}
                  pageStart={pageStart}
                  pageEnd={pageEnd}
                />
              </div>
            </div>
          </div>
        )}

        {isMetricsRole && aggregates && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Revenue (net)</div>
              <div className="font-semibold">{ngn.format(aggregates.revenueNet)}</div>
              <div className={`${T_XS} text-ink-soft`}>
                Paid {ngn.format(aggregates.revenuePaid)} • Paid refunds {ngn.format(aggregates.refundsPaidToCustomer)}
              </div>
            </div>

            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Total Refunds</div>
              <div className="font-semibold">{ngn.format(aggregates.refundsTotal)}</div>
              <div className={`${T_XS} text-ink-soft`}>
                Paid out {ngn.format(aggregates.refundsPaidToCustomer)} • {refundMetrics.count} refund(s)
              </div>
            </div>

            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Commission Revenue</div>
              <div className="font-semibold">{ngn.format(aggregates.commissionRevenue)}</div>
              <div className={`${T_XS} text-ink-soft`}>
                Margin {marginPercent.toFixed(2)}% • Supplier payouts {ngn.format(aggregates.supplierPayouts)}
              </div>
            </div>

            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Platform Profit</div>
              <div className="font-semibold">{ngn.format(grossProfit)}</div>
              <div className={`${T_XS} text-ink-soft`}>
                Commission + service fee - paid refunds
              </div>
            </div>
          </div>
        )}

        {/* Desktop Orders table */}
        <div className={`overflow-hidden mt-4 hidden md:block ${CARD_2XL}`}>
          <div className="px-4 md:px-5 py-3 border-b border-zinc-200/70 flex items-center justify-between">
            <div className="text-sm text-ink-soft">
              {loading
                ? "Loading…"
                : totalItems
                  ? `Showing ${pageStart}-${pageEnd} of ${totalItems} orders`
                  : "No orders match your filters."}
            </div>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200/80 bg-white hover:bg-black/5 px-3 py-2 text-sm shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
              disabled={!queriesEnabled}
            >
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-ink">
                  <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("id")}>
                    Order
                  </th>
                  {isAdmin && (
                    <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("user")}>
                      User
                    </th>
                  )}
                  <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("items")}>
                    Items
                  </th>
                  <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("total")}>
                    Total
                  </th>
                  <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("status")}>
                    Status
                  </th>
                  <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort("date")}>
                    Date
                  </th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200/70">
                {loading && (
                  <>
                    <SkeletonRow cols={colSpan} mode="table" />
                    <SkeletonRow cols={colSpan} mode="table" />
                    <SkeletonRow cols={colSpan} mode="table" />
                  </>
                )}

                {!loading && paginated.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-6 text-center text-zinc-500">
                      No orders match your filters.
                    </td>
                  </tr>
                )}

                {!loading &&
                  paginated.map((o) => {
                    const isOpen = expandedId === o.id;
                    const details: OrderRow = isOpen && orderDetailQ.data?.id === o.id ? (orderDetailQ.data as any) : o;

                    const latestPayment = latestPaymentOf(details);
                    const receiptKey = receiptKeyFromPayment(latestPayment);

                    const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);
                    const isPendingOrCreated =
                      !isPaidEffective && ["PENDING", "CREATED"].includes(String(details.status || "").toUpperCase());

                    const canShowReceipt = !!receiptKey && isPaidEffective;
                    const canCancelThis = canCancel(details, latestPayment);
                    const canShowCancelThis = canShowCancelButtonForUser(details, latestPayment, isAdmin);

                    return (
                      <React.Fragment key={o.id}>
                        <tr
                          ref={(node) => {
                            orderAnchorRefs.current[o.id] = node;
                          }}
                          className={`hover:bg-black/5 cursor-pointer ${isOpen ? "bg-amber-50/50" : ""}`}
                          onClick={() => onToggle(o.id)}
                          aria-expanded={isOpen}
                        >
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                                ▶
                              </span>
                              <span className="font-mono">{o.id}</span>
                            </div>
                          </td>

                          {isAdmin && <td className="px-3 py-3">{details.userEmail || "—"}</td>}

                          <td className="px-3 py-3">
                            {Array.isArray(details.items) && details.items.length > 0 ? (
                              <div className="space-y-1">
                                {details.items.slice(0, 3).map((it) => {
                                  const name = (it.title || it.product?.title || "—").toString();
                                  const qty = Number(it.quantity ?? 1);
                                  const unit = fmtN(it.unitPrice);
                                  return (
                                    <div key={it.id} className="text-ink">
                                      <span className="font-medium">{name}</span>
                                      <span className="text-ink-soft">{`  •  ${qty} × ${ngn.format(unit)}`}</span>
                                    </div>
                                  );
                                })}
                                {details.items.length > 3 && (
                                  <div className="text-xs text-ink-soft">+ {details.items.length - 3} more…</div>
                                )}
                              </div>
                            ) : isOpen && orderDetailQ.isFetching ? (
                              <span className="text-ink-soft text-xs">Loading items…</span>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td className="px-3 py-3">{ngn.format(fmtN(details.total))}</td>

                          <td className="px-3 py-3">
                            <StatusDot label={getOrderFilterBucket(details)} />
                          </td>

                          <td className="px-3 py-3">{fmtDate(details.createdAt)}</td>

                          <td className="px-3 py-3">
                            <button
                              className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs ${isPaidEffective
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                : isPendingOrCreated
                                  ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                                  : "bg-white border-zinc-200/80 hover:bg-black/5 text-ink-soft"
                                }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggle(o.id);
                              }}
                            >
                              {isOpen ? "Hide details" : "View details"}
                            </button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr>
                            <td colSpan={colSpan} className="p-0">
                              <div className="px-4 md:px-6 py-4 bg-white border-t border-zinc-200/70">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="text-sm">
                                    <div>
                                      <span className="text-ink-soft">Order:</span>{" "}
                                      <span className="font-mono">{details.id}</span>
                                    </div>
                                    <div className="text-ink-soft">
                                      Placed: {fmtDate(details.createdAt)} • Status: <b>{getOrderFilterBucket(details)}</b>
                                      {getOrderFinalDeliveryDisplay(details) ? (
                                        <>
                                          {" "}• Delivered: <b>{getOrderFinalDeliveryDisplay(details)}</b>
                                        </>
                                      ) : null}
                                    </div>
                                    {latestPayment && (
                                      <div className="text-ink-soft">
                                        Payment: <b>{latestPayment.status}</b>
                                        {latestPayment.reference && (
                                          <>
                                            {" "}
                                            • Ref: <span className="font-mono">{latestPayment.reference}</span>
                                          </>
                                        )}
                                        {latestPayment.amount != null && <> • {ngn.format(fmtN(latestPayment.amount))}</>}
                                      </div>
                                    )}

                                    {isMetricsRole && (() => {
                                      const orderRefunds = getRefundsForOrder(details, refunds);
                                      const orderRefundPaid = orderRefunds.reduce(
                                        (sum, r) => sum + (isRefundPaidToCustomer(r) ? getRefundAmount(r) : 0),
                                        0
                                      );
                                      const orderRefundImpact = orderRefundPaid;
                                      const orderBaseProfit = computeOrderPlatformProfit(details, marginPercent);

                                      return (
                                        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                                          <div className="font-semibold text-zinc-900 mb-1">Platform profit</div>
                                          <div>Commission: {ngn.format(orderCommissionRevenue(details, marginPercent))}</div>
                                          <div>Service fee: {ngn.format(orderServiceRevenue(details))}</div>
                                          <div>Gateway: {ngn.format(orderGatewayCost(details))}</div>
                                          <div>Comms: {ngn.format(orderCommsCost(details))}</div>
                                          <div>Refund paid to customer: {ngn.format(orderRefundPaid)}</div>
                                          <div className="font-semibold text-zinc-900">
                                            Profit: {ngn.format(orderBaseProfit - orderRefundImpact)}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    {isPendingOrCreated && (
                                      <button
                                        className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-xs md:text-sm hover:bg-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.18)]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onPay(details.id);
                                        }}
                                      >
                                        Pay now
                                      </button>
                                    )}

                                    {canShowCancelThis && (
                                      <button
                                        className="rounded-lg border border-zinc-200/80 px-4 py-2 text-xs md:text-sm hover:bg-black/5 text-rose-600 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onCancel(details.id);
                                        }}
                                      >
                                        Cancel order
                                      </button>
                                    )}

                                    {canShowReceipt && (
                                      <>
                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            viewReceipt(receiptKey);
                                          }}
                                        >
                                          View receipt
                                        </button>

                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            downloadReceipt(receiptKey);
                                          }}
                                        >
                                          Download PDF
                                        </button>

                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            printReceipt(receiptKey);
                                          }}
                                        >
                                          Print
                                        </button>
                                      </>
                                    )}

                                    {canRefund(details, latestPayment) && (
                                      <button
                                        className="rounded-lg border border-zinc-200/80 px-4 py-2 text-xs md:text-sm hover:bg-black/5 text-indigo-700 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRefund(details.id);
                                        }}
                                      >
                                        Refund
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {Array.isArray(details.purchaseOrders) && details.purchaseOrders.length > 0 && (
                                  <div className={`mt-4 overflow-hidden ${CARD_XL}`}>
                                    <div className="px-4 py-3 border-b border-zinc-200/70 flex items-center justify-between">
                                      <div className="text-sm font-semibold text-ink">Supplier fulfillment</div>
                                      <div className="text-xs text-ink-soft">
                                        {getOrderSupplierSummary(details).count} supplier(s)
                                      </div>
                                    </div>

                                    <div className="divide-y divide-zinc-200/70">
                                      {details.purchaseOrders.map((po) => {
                                        const supplierPaid = isPurchaseOrderSupplierPaid(po, details);
                                        const canRefundThisPo =
                                          !isAdmin && canRequestRefundForPo(details, po, latestPayment, refunds);

                                        const poHasOpenRefund = hasOpenRefundForPurchaseOrder(String(po.id || ""), refunds);
                                        const poRefunds = getRefundsForPurchaseOrder(po, refunds);
                                        const poRefundPaidAt = poRefunds
                                          .map((r) => getRefundPaidOutAt(r))
                                          .filter(Boolean)
                                          .sort()
                                          .reverse()[0] || null;

                                        return (
                                          <div
                                            key={po.id}
                                            className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-700"
                                          >
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="font-medium text-zinc-900">
                                                {po.supplierName || po.supplierId || "Supplier"}
                                              </span>
                                              <span>•</span>
                                              <span>
                                                PO: <span className="font-mono">{po.id}</span>
                                              </span>
                                              {getPurchaseOrderDeliveryDisplay(po) ? (
                                                <>
                                                  <span>•</span>
                                                  <span>
                                                    Delivered: <b>{getPurchaseOrderDeliveryDisplay(po)}</b>
                                                  </span>
                                                </>
                                              ) : null}
                                              {po.status ? (
                                                <>
                                                  <span>•</span>
                                                  <span>{getPurchaseOrderDisplayStatus(po)}</span>
                                                </>
                                              ) : null}
                                              {po.payoutStatus && isAdmin ? (
                                                <>
                                                  <span>•</span>
                                                  <span>Payout: <b>{po.payoutStatus}</b></span>
                                                </>
                                              ) : null}
                                              {supplierPaid ? (
                                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                  Supplier paid
                                                </span>
                                              ) : null}
                                              {poHasOpenRefund ? (
                                                <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                                                  Refund in progress
                                                </span>
                                              ) : null}

                                              {poRefundPaidAt ? (
                                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                  Customer refunded
                                                </span>
                                              ) : null}
                                            </div>

                                            {canRefundThisPo ? (
                                              <button
                                                className="rounded-lg border border-zinc-200/80 px-3 py-2 text-xs hover:bg-black/5 text-indigo-700 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  onCustomerRefund(details, po);
                                                }}
                                              >
                                                Request refund
                                              </button>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                <div className={`mt-4 overflow-hidden ${CARD_XL}`}>
                                  <div className="px-4 py-3 border-b border-zinc-200/70 flex items-center justify-between">
                                    <div className="text-sm font-semibold text-ink">Order items</div>
                                    <div className="text-xs text-ink-soft">
                                      {Array.isArray(details.items) ? details.items.length : 0} item(s)
                                    </div>
                                  </div>

                                  <div className="divide-y divide-zinc-200/70">
                                    {orderDetailQ.isFetching && (!details.items || details.items.length === 0) && (
                                      <div className="px-4 py-4 text-sm text-ink-soft">Loading order items…</div>
                                    )}

                                    {(!details.items || details.items.length === 0) && !orderDetailQ.isFetching && (
                                      <div className="px-4 py-4 text-sm text-ink-soft">No items found for this order.</div>
                                    )}

                                    {(details.items || []).map((it) => {
                                      const itemTitle = (it.title || it.product?.title || "—").toString();
                                      const qty = Math.max(1, Number(it.quantity ?? it.qty ?? 1) || 1);
                                      const unit = fmtN(it.unitPrice ?? it.price);
                                      const total =
                                        it.lineTotal != null || it.total != null || it.subtotal != null
                                          ? fmtN(it.lineTotal ?? it.total ?? it.subtotal)
                                          : unit * qty;
                                      const options = normalizeSelectedOptionsForDisplay(
                                        it.selectedOptions ?? it.options ?? it.selectedOptionsJson
                                      );
                                      const productHref = getProductHref(it);
                                      const thumb = getFirstImageFromOrderItem(it);

                                      return (
                                        <div key={it.id} className="px-4 py-4">
                                          <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0 flex flex-1 items-start gap-3">
                                              <div className="shrink-0">
                                                {thumb ? (
                                                  <img
                                                    src={thumb}
                                                    alt={itemTitle}
                                                    className="h-14 w-14 rounded-xl border border-zinc-200/80 bg-zinc-50 object-cover"
                                                  />
                                                ) : (
                                                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50 text-[10px] text-zinc-400">
                                                    No image
                                                  </div>
                                                )}
                                              </div>

                                              <div className="min-w-0 flex-1">
                                                {productHref ? (
                                                  <Link
                                                    to={productHref}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="inline-flex items-center gap-1.5 font-semibold text-blue-600 break-words underline decoration-blue-400 underline-offset-2 hover:text-blue-700 hover:decoration-blue-600 transition"
                                                  >
                                                    {itemTitle}
                                                    <svg
                                                      xmlns="http://www.w3.org/2000/svg"
                                                      viewBox="0 0 24 24"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      strokeWidth="2"
                                                      className="w-3.5 h-3.5 opacity-70"
                                                    >
                                                      <path d="M7 17L17 7" />
                                                      <path d="M7 7h10v10" />
                                                    </svg>
                                                  </Link>
                                                ) : (
                                                  <div className="font-medium text-ink break-words">{itemTitle}</div>
                                                )}

                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                                                  <span>Qty: {qty}</span>
                                                  <span>•</span>
                                                  <span>Unit: {ngn.format(unit)}</span>
                                                  {it.variant?.sku ? (
                                                    <>
                                                      <span>•</span>
                                                      <span>SKU: {it.variant.sku}</span>
                                                    </>
                                                  ) : null}
                                                </div>

                                                {options.length > 0 && (
                                                  <div className="mt-2 flex flex-wrap gap-2">
                                                    {options.map((opt, idx) => (
                                                      <span
                                                        key={`${it.id}-opt-${idx}`}
                                                        className="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700"
                                                      >
                                                        {opt.attribute && opt.value
                                                          ? `${opt.attribute}: ${opt.value}`
                                                          : opt.attribute || opt.value}
                                                      </span>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            </div>

                                            <div className="shrink-0 text-right min-w-[132px]">
                                              <div className="text-xs text-ink-soft">Line total</div>
                                              <div className="font-semibold text-ink">{ngn.format(total)}</div>

                                              {it.productId && (
                                                <button
                                                  className="mt-2 inline-flex items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-xs hover:bg-black/5 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    onBuyAgain(it);
                                                  }}
                                                >
                                                  Buy Again
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="px-4 md:px-5 pb-4">
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onChange={handleDesktopPageChange}
            />
          </div>
        </div>

        {/* Mobile Orders list */}
        <div className="mt-3 space-y-3 md:hidden">
          {loading && (
            <>
              <SkeletonRow mode="card" />
              <SkeletonRow mode="card" />
              <SkeletonRow mode="card" />
            </>
          )}

          {!loading && paginated.length === 0 && (
            <div className={`${CARD_2XL} py-6 px-4 text-center text-zinc-500 ${T_SM}`}>
              No orders match your filters.
            </div>
          )}

          {!loading &&
            paginated.map((o) => {
              const isOpen = expandedId === o.id;
              const details: OrderRow =
                isOpen && (orderDetailQ.data as any)?.id === o.id ? (orderDetailQ.data as any) : o;

              const latestPayment = latestPaymentOf(details);
              const receiptKey = receiptKeyFromPayment(latestPayment);

              const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);
              const isPendingOrCreated =
                !isPaidEffective && ["PENDING", "CREATED"].includes(String(details.status || "").toUpperCase());

              const firstItemTitle = details.items?.[0]?.title || details.items?.[0]?.product?.title || "";
              const canShowCancelThis = canShowCancelButtonForUser(details, latestPayment, isAdmin);

              return (
                <div
                  key={o.id}
                  ref={(node) => {
                    orderAnchorRefs.current[o.id] = node;
                  }}
                  className={`${CARD_2XL} overflow-hidden`}
                >
                  <div
                    key={o.id}
                    className={`${CARD_2XL} p-3 flex flex-col gap-2`}
                    onClick={() => setExpandedId((curr) => (curr === o.id ? null : o.id))}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-wide text-ink-soft">Order ID</div>
                        <div className="mt-0.5 font-mono text-[11px] leading-5 text-ink truncate">
                          {details.id}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <StatusDot label={getOrderFilterBucket(details)} />
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 items-start">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ink leading-5 break-words">
                          {firstItemTitle
                            ? firstItemTitle.toString().slice(0, 52) +
                            (details.items && details.items.length > 1 ? ` +${details.items.length - 1}` : "")
                            : isOpen && orderDetailQ.isFetching
                              ? "Loading items…"
                              : `${details.items?.length || 0} item(s)`}
                        </div>
                        <div className="mt-1 text-[11px] leading-5 text-ink-soft">
                          Placed {fmtDate(details.createdAt)}
                        </div>
                        {getOrderFinalDeliveryDisplay(details) ? (
                          <div className="text-[11px] leading-5 text-ink-soft">
                            Delivered {getOrderFinalDeliveryDisplay(details)}
                          </div>
                        ) : null}
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[10px] uppercase tracking-wide text-ink-soft">Total</div>
                        <div className="mt-0.5 text-[18px] font-semibold text-ink">
                          {ngn.format(fmtN(details.total))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {isPendingOrCreated && (
                        <button
                          className="rounded-xl bg-emerald-600 text-white px-3 py-2 text-[11px] font-medium shadow-[0_10px_24px_rgba(16,185,129,0.18)]"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPay(details.id);
                          }}
                        >
                          Pay
                        </button>
                      )}

                      {canShowCancelThis && (
                        <button
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCancel(details.id);
                          }}
                        >
                          Cancel
                        </button>
                      )}

                      {receiptKey && isPaidEffective && (
                        <button
                          className={`rounded-xl ${SILVER_BORDER} bg-white px-3 py-2 text-[11px] font-medium ${SILVER_SHADOW_SM}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            viewReceipt(receiptKey);
                          }}
                        >
                          Receipt
                        </button>
                      )}

                      <button
                        className={`rounded-xl ${SILVER_BORDER} bg-white px-3 py-2 text-[11px] font-medium hover:bg-black/5`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle(details.id);
                        }}
                      >
                        {isOpen ? "Hide details" : "Details"}
                      </button>
                    </div>
                  </div>

                  {isMetricsRole && (
                    <div className="border-t border-zinc-200/70 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                      <div className="font-semibold text-zinc-900 mb-1">Platform profit</div>
                      <div>Commission: {ngn.format(orderCommissionRevenue(details, marginPercent))}</div>
                      <div>Service fee: {ngn.format(orderServiceRevenue(details))}</div>
                      <div>Gateway: {ngn.format(orderGatewayCost(details))}</div>
                      <div>Comms: {ngn.format(orderCommsCost(details))}</div>
                      <div className="font-semibold text-zinc-900">
                        Profit: {ngn.format(computeOrderPlatformProfit(details, marginPercent))}
                      </div>
                    </div>
                  )}

                  {isOpen && (
                    <div className="border-t border-zinc-200/70 bg-white px-3 py-3 space-y-3">
                      {Array.isArray(details.purchaseOrders) && details.purchaseOrders.length > 0 && (
                        <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50 p-3">
                          <div className="mb-2 text-[11px] font-semibold text-zinc-900">Supplier fulfillment</div>
                          <div className="space-y-2">
                            {details.purchaseOrders.map((po) => {
                              const supplierPaid = isPurchaseOrderSupplierPaid(po, details);
                              const canRefundThisPo =
                                !isAdmin && canRequestRefundForPo(details, po, latestPayment, refunds);

                              const poHasOpenRefund = hasOpenRefundForPurchaseOrder(String(po.id || ""), refunds);
                              const poRefunds = getRefundsForPurchaseOrder(po, refunds);
                              const poRefundPaidAt = poRefunds
                                .map((r) => getRefundPaidOutAt(r))
                                .filter(Boolean)
                                .sort()
                                .reverse()[0] || null;

                              return (
                                <div key={po.id} className="rounded-xl border border-zinc-200/70 bg-white px-3 py-2">
                                  <div className="text-[10px] leading-5 text-zinc-700">
                                    <div className="font-medium text-zinc-900">
                                      {po.supplierName || po.supplierId || "Supplier"}
                                    </div>
                                    <div className="mt-0.5">
                                      PO: <span className="font-mono">{po.id}</span>
                                    </div>
                                    {getPurchaseOrderDeliveryDisplay(po) ? (
                                      <div>Delivered: {getPurchaseOrderDeliveryDisplay(po)}</div>
                                    ) : null}
                                    <div>{getPurchaseOrderDisplayStatus(po)}</div>
                                    {supplierPaid ? (
                                      <div className="font-semibold text-emerald-700">Supplier paid</div>
                                    ) : null}
                                    {poHasOpenRefund ? (
                                      <div className="font-semibold text-indigo-700">Refund in progress</div>
                                    ) : null}
                                    {poRefundPaidAt ? (
                                      <div className="font-semibold text-emerald-700">Customer refunded</div>
                                    ) : null}
                                  </div>

                                  {canRefundThisPo ? (
                                    <div className="mt-2 flex justify-end">
                                      <button
                                        className={`rounded-lg ${SILVER_BORDER} px-3 py-1.5 ${BTN_XS} bg-white hover:bg-black/5 text-indigo-700`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onCustomerRefund(details, po);
                                        }}
                                      >
                                        Request refund
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50 overflow-hidden">
                        <div className="flex items-center justify-between border-b border-zinc-200/70 px-3 py-2.5">
                          <div className="text-[11px] font-semibold text-ink">Order items</div>
                          <div className="text-[10px] text-ink-soft">
                            {Array.isArray(details.items) ? details.items.length : 0} item(s)
                          </div>
                        </div>

                        <div className="space-y-2 p-2">
                          {orderDetailQ.isFetching && (!details.items || details.items.length === 0) && (
                            <div className="px-2 py-3 text-[11px] text-ink-soft">Loading order items…</div>
                          )}

                          {(!details.items || details.items.length === 0) && !orderDetailQ.isFetching && (
                            <div className="px-2 py-3 text-[11px] text-ink-soft">No items found for this order.</div>
                          )}

                          {(details.items || []).map((it) => {
                            const itemTitle = (it.title || it.product?.title || "—").toString();
                            const qty = Math.max(1, Number(it.quantity ?? it.qty ?? 1) || 1);
                            const total =
                              it.lineTotal != null || it.total != null || it.subtotal != null
                                ? fmtN(it.lineTotal ?? it.total ?? it.subtotal)
                                : fmtN(it.unitPrice ?? it.price) * qty;
                            const options = normalizeSelectedOptionsForDisplay(
                              it.selectedOptions ?? it.options ?? it.selectedOptionsJson
                            );
                            const productHref = getProductHref(it);
                            const thumb = getFirstImageFromOrderItem(it);

                            return (
                              <div key={it.id} className="rounded-xl border border-zinc-200/70 bg-white p-2.5">
                                <div className="flex items-start gap-2.5">
                                  <div className="shrink-0">
                                    {thumb ? (
                                      <img
                                        src={thumb}
                                        alt={itemTitle}
                                        className="h-12 w-12 rounded-lg border border-zinc-200/80 bg-white object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-200/80 bg-white text-[9px] text-zinc-400">
                                        No image
                                      </div>
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    {productHref ? (
                                      <Link
                                        to={productHref}
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 break-words underline decoration-blue-400 underline-offset-2"
                                      >
                                        {itemTitle}
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          className="w-3 h-3 opacity-70"
                                        >
                                          <path d="M7 17L17 7" />
                                          <path d="M7 7h10v10" />
                                        </svg>
                                      </Link>
                                    ) : (
                                      <div className="text-[12px] font-medium text-ink break-words">
                                        {itemTitle}
                                      </div>
                                    )}

                                    <div className="mt-1 text-[10px] leading-5 text-ink-soft">
                                      Qty {qty} • {ngn.format(fmtN(it.unitPrice ?? it.price))}
                                      {it.variant?.sku ? ` • SKU ${it.variant.sku}` : ""}
                                    </div>

                                    {options.length > 0 && (
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {options.map((opt, idx) => (
                                          <span
                                            key={`${it.id}-mobile-opt-${idx}`}
                                            className="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-700"
                                          >
                                            {opt.attribute && opt.value
                                              ? `${opt.attribute}: ${opt.value}`
                                              : opt.attribute || opt.value}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    <div className="mt-2 flex items-center justify-between gap-2">
                                      <div className="text-[11px]">
                                        <div className="text-zinc-500">Total</div>
                                        <div className="font-semibold text-ink">{ngn.format(total)}</div>
                                      </div>

                                      {it.productId && (
                                        <button
                                          className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-1.5 text-[11px] font-medium hover:bg-black/5`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onBuyAgain(it);
                                          }}
                                        >
                                          Buy Again
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onChange={handleMobilePageChange}
          />
        </div>

        {/* OTP modal */}
        {otpModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-4">
            <div className="absolute inset-0 bg-black/40" />
            <div className={`relative w-full max-w-md rounded-2xl bg-white p-4 ${SILVER_BORDER} ${SILVER_SHADOW_LG}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Enter OTP</div>
                  <div className={`${T_SM} text-ink-soft mt-1`}>
                    {otpModal.channelHint ? `We sent a code (${otpModal.channelHint}).` : "We sent a code to your phone/email."}
                  </div>
                </div>
                <button className={`${BTN_XS} text-ink-soft px-2 py-1 rounded-lg hover:bg-black/5`} onClick={closeOtp}>
                  Close
                </button>
              </div>

              <div className="mt-3">
                <label className={T_LABEL}>OTP code</label>
                <input
                  value={otpModal.otp}
                  onChange={(e) =>
                    setOtpModal((s) =>
                      !s.open ? s : { ...s, otp: e.target.value.replace(/\D/g, "").slice(0, 6), error: null }
                    )
                  }
                  inputMode="numeric"
                  autoFocus
                  className={`mt-1 w-full ${SILVER_BORDER} rounded-xl px-3 py-2 text-[14px] sm:text-base tracking-widest`}
                  placeholder="123456"
                />
                {!!otpModal.error && <div className="mt-2 text-[11px] text-rose-600">{otpModal.error}</div>}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  disabled={otpModal.busy || otpModal.otp.length < 4}
                  className={`flex-1 rounded-xl bg-zinc-900 text-white px-3 py-2 ${BTN} disabled:opacity-50`}
                  onClick={async () => {
                    if (!otpModal.open) return;
                    try {
                      setOtpModal((s) => (!s.open ? s : { ...s, busy: true, error: null }));
                      const otpToken = await verifyOtp(
                        otpModal.orderId,
                        otpModal.requestId,
                        otpModal.purpose,
                        otpModal.otp
                      );
                      clearPendingOtp(otpModal.orderId, otpModal.purpose);
                      await otpModal.onSuccess(otpToken);
                      closeOtp();
                    } catch (e: any) {
                      setOtpModal((s) =>
                        !s.open
                          ? s
                          : {
                            ...s,
                            busy: false,
                            error: e?.response?.data?.error || e?.message || "Invalid or expired OTP",
                          }
                      );
                    }
                  }}
                >
                  Verify
                </button>

                <button
                  disabled={otpModal.busy}
                  className={`rounded-xl ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5 disabled:opacity-50`}
                  onClick={async () => {
                    if (!otpModal.open) return;
                    try {
                      setOtpModal((s) => (!s.open ? s : { ...s, busy: true, error: null }));
                      const r = await requestOtp(otpModal.orderId, otpModal.purpose);
                      setOtpModal((s) =>
                        !s.open
                          ? s
                          : {
                            ...s,
                            busy: false,
                            requestId: r.requestId,
                            expiresAt: r.expiresAt,
                            channelHint: r.channelHint,
                            otp: "",
                          }
                      );
                    } catch (e: any) {
                      setOtpModal((s) =>
                        !s.open ? s : { ...s, busy: false, error: e?.response?.data?.error || "Could not resend OTP" }
                      );
                    }
                  }}
                >
                  Resend
                </button>
              </div>

              <div className={`mt-3 ${T_XS} text-ink-soft`}>
                Tip: If you don’t receive the code within ~30 seconds, tap Resend.
              </div>
            </div>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
/* ---------------- Small bits ---------------- */
function SkeletonRow({
  cols = 5,
  mode = "table",
}: {
  cols?: number;
  mode?: "table" | "card";
}) {
  if (mode === "card") {
    return (
      <div className={`${CARD_2XL} p-3 animate-pulse`}>
        <div className="h-3 w-1/2 bg-zinc-200 rounded" />
        <div className="mt-3 h-3 w-3/4 bg-zinc-200 rounded" />
        <div className="mt-2 h-3 w-2/3 bg-zinc-200 rounded" />
        <div className="mt-4 h-8 w-24 bg-zinc-200 rounded" />
      </div>
    );
  }

  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 rounded bg-zinc-200" />
        </td>
      ))}
    </tr>
  );
}