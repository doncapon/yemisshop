// api/src/routes/refunds.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany, notifyUser } from "../services/notifications.service.js";
import { syncProductInStockCacheTx } from "../services/inventory.service.js";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";
import { Prisma } from "@prisma/client";
import { ps, toKobo } from "../lib/paystack.js";


const router = Router();

function normRole(r?: string) {
  return String(r || "").toUpperCase();
}

function normStr(v: any) {
  return String(v ?? "").trim();
}

function isAdmin(role?: string) {
  return ["ADMIN", "SUPER_ADMIN"].includes(String(role || "").toUpperCase());
}

function upper(s?: any) {
  return normStr(s).toUpperCase();
}

function toDecimal(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return new Prisma.Decimal(0);
  return new Prisma.Decimal(n);
}

function toPositiveInt(value: any, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v > 0 ? v : fallback;
}

function uniqStrings(values: any[]): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
    )
  );
}

const REFUND_REASONS_REQUIRING_EVIDENCE = new Set([
  "DAMAGED",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "OTHER",
]);

function refundReasonRequiresEvidence(reason?: any) {
  return REFUND_REASONS_REQUIRING_EVIDENCE.has(upper(reason));
}

function normalizeUrlList(values: any): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return uniqStrings(
    list
      .map((v: any) => String(v ?? "").trim())
      .filter(Boolean)
  );
}

/**
 * Accepts either:
 * body.evidence = [{ itemId, urls: [...] }]
 * or
 * body.evidenceByItemId = { [itemId]: string[] }
 */
function pickRefundEvidenceByItemId(body: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  const fromArray = Array.isArray(body?.evidence) ? body.evidence : [];
  for (const row of fromArray) {
    const itemId = normStr(row?.itemId ?? row?.orderItemId ?? row?.id);
    if (!itemId) continue;
    const urls = normalizeUrlList(row?.urls ?? row?.evidenceUrls ?? row?.images ?? []);
    if (urls.length) out[itemId] = urls;
  }

  const mapInput = body?.evidenceByItemId;
  if (mapInput && typeof mapInput === "object" && !Array.isArray(mapInput)) {
    for (const [rawItemId, rawUrls] of Object.entries(mapInput)) {
      const itemId = normStr(rawItemId);
      if (!itemId) continue;
      const urls = normalizeUrlList(rawUrls);
      if (urls.length) {
        out[itemId] = uniqStrings([...(out[itemId] || []), ...urls]);
      }
    }
  }

  return out;
}


function getOrderItemFullQty(it: any) {
  const n = Number(it?.quantity ?? it?.qty ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function getOrderItemUnitPriceDecimal(it: any) {
  if (it?.unitPrice != null) return toDecimal(it.unitPrice);

  const qty = getOrderItemFullQty(it);
  const lineTotal = toDecimal(it?.lineTotal ?? 0);

  if (qty > 0 && lineTotal.gt(0)) {
    return decimalRoundMoney(lineTotal.div(new Prisma.Decimal(qty)));
  }

  return new Prisma.Decimal(0);
}

function clampRequestedRefundQty(raw: any, maxQty: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const v = Math.floor(n);
  if (v < 0) return 0;
  if (v > maxQty) return maxQty;
  return v;
}

/**
 * Accepts:
 * body.itemQuantities = [{ itemId, qty }]
 * body.items = [{ itemId|orderItemId|id, qty }]
 *
 * Returns: [{ itemId, qty }]
 */
function pickRefundItemQuantities(body: any): Array<{ itemId: string; qty: number }> {
  const direct = Array.isArray(body?.itemQuantities) ? body.itemQuantities : [];
  const fallbackItems = Array.isArray(body?.items) ? body.items : [];

  const rows = [...direct, ...fallbackItems]
    .map((row: any) => {
      const itemId = normStr(row?.itemId ?? row?.orderItemId ?? row?.id);
      const qty = Math.floor(Number(row?.qty ?? row?.quantity ?? 0) || 0);
      if (!itemId || qty <= 0) return null;
      return { itemId, qty };
    })
    .filter(Boolean) as Array<{ itemId: string; qty: number }>;

  const merged = new Map<string, number>();
  for (const row of rows) {
    merged.set(row.itemId, Math.max(merged.get(row.itemId) || 0, row.qty));
  }

  return Array.from(merged.entries()).map(([itemId, qty]) => ({ itemId, qty }));
}

function countEvidenceUrls(evidenceByItemId: Record<string, string[]>) {
  return Object.values(evidenceByItemId || {}).reduce((sum, urls) => {
    return sum + (Array.isArray(urls) ? urls.length : 0);
  }, 0);
}

async function getAdminUserIds() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
    select: { id: true },
  });
  return admins.map((a: { id: string }) => a.id);
}


/* ---------------- Paystack refund / payout helpers ---------------- */

function onlyDigits(v: any) {
  return String(v ?? "").replace(/\D/g, "");
}

function safeRefPart(v: any) {
  return String(v ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 40);
}

function buildCustomerRefundTransferReference(refundId: string) {
  return `refund_${safeRefPart(refundId)}_${Date.now()}`;
}

async function getLatestPaidPaymentForRefundTx(tx: any, orderId: string) {
  return tx.payment.findFirst({
    where: {
      orderId: String(orderId),
      status: "PAID" as any,
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      orderId: true,
      reference: true,
      provider: true,
      providerTxId: true,
      amount: true,
      paidAt: true,
      channel: true,
      providerPayload: true,
      order: {
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      },
    },
  });
}

async function createPaystackRefundForPayment(args: {
  paymentReference: string;
  amount: number;
  note?: string | null;
  refundId: string;
}) {
  const payload: any = {
    transaction: String(args.paymentReference),
    amount: toKobo(args.amount),
    currency: "NGN",
    merchant_note: args.note || `Refund ${args.refundId}`,
    customer_note: args.note || `Refund ${args.refundId}`,
  };

  const resp = await ps.post("/refund", payload);
  return resp?.data?.data ?? resp?.data ?? null;
}

async function upsertCustomerRefundPayoutTx(
  tx: any,
  args: {
    refundId: string;
    userId: string;
    accountName: string;
    accountNumber: string;
    bankCode: string;
    bankName?: string | null;
    recipientCode?: string | null;
    transferReference?: string | null;
    transferStatus?: string | null;
    providerPayload?: any;
  }
) {
  const existing = await tx.customerRefundPayout.findUnique({
    where: { refundId: String(args.refundId) },
    select: { id: true },
  });

  const data = {
    refundId: String(args.refundId),
    userId: String(args.userId),
    accountName: String(args.accountName).trim(),
    accountNumber: onlyDigits(args.accountNumber),
    bankCode: String(args.bankCode).trim(),
    bankName: args.bankName ? String(args.bankName).trim() : null,
    recipientCode: args.recipientCode ?? undefined,
    transferReference: args.transferReference ?? undefined,
    transferStatus: args.transferStatus ?? undefined,
    providerPayload: args.providerPayload ?? undefined,
  };

  if (existing?.id) {
    return tx.customerRefundPayout.update({
      where: { refundId: String(args.refundId) },
      data,
    });
  }

  return tx.customerRefundPayout.create({ data });
}

async function ensureCustomerRefundRecipientCodeTx(
  tx: any,
  args: {
    refundId: string;
    userId: string;
    accountName: string;
    accountNumber: string;
    bankCode: string;
    bankName?: string | null;
  }
) {
  const existing = await tx.customerRefundPayout.findUnique({
    where: { refundId: String(args.refundId) },
    select: {
      id: true,
      recipientCode: true,
      accountName: true,
      accountNumber: true,
      bankCode: true,
      bankName: true,
      userId: true,
    },
  });

  const accountName = String(args.accountName || existing?.accountName || "").trim();
  const accountNumber = onlyDigits(args.accountNumber || existing?.accountNumber || "");
  const bankCode = String(args.bankCode || existing?.bankCode || "").trim();
  const bankName =
    String(args.bankName || existing?.bankName || "").trim() || null;

  if (!accountName || !accountNumber || !bankCode) {
    throw new Error("Missing customer refund payout bank details");
  }

  if (existing?.recipientCode) {
    return {
      recipientCode: String(existing.recipientCode),
      payoutRow: existing,
    };
  }

  const resp = await ps.post("/transferrecipient", {
    type: "nuban",
    name: accountName,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: "NGN",
  });

  const recipientCode =
    resp?.data?.data?.recipient_code ||
    resp?.data?.data?.recipientCode ||
    null;

  if (!recipientCode) {
    throw new Error("Could not create Paystack transfer recipient for customer refund");
  }

  const payoutRow = await upsertCustomerRefundPayoutTx(tx, {
    refundId: String(args.refundId),
    userId: String(args.userId),
    accountName,
    accountNumber,
    bankCode,
    bankName,
    recipientCode: String(recipientCode),
    providerPayload: resp?.data ?? null,
  });

  return {
    recipientCode: String(recipientCode),
    payoutRow,
  };
}

async function initiateCustomerRefundTransferTx(
  tx: any,
  args: {
    refundId: string;
    userId: string;
    amount: number;
    recipientCode: string;
    note?: string | null;
  }
) {
  const transferReference = buildCustomerRefundTransferReference(args.refundId);

  const resp = await ps.post("/transfer", {
    source: "balance",
    amount: toKobo(args.amount),
    recipient: String(args.recipientCode),
    reason: args.note || `Customer refund ${args.refundId}`,
    reference: transferReference,
  });

  const transferData = resp?.data?.data ?? null;
  const transferStatus = String(
    transferData?.status ??
    resp?.data?.status ??
    "pending"
  ).trim();

  await tx.customerRefundPayout.update({
    where: { refundId: String(args.refundId) },
    data: {
      transferReference,
      transferStatus,
      providerPayload: resp?.data ?? undefined,
    },
  });

  return {
    transferReference,
    transferStatus,
    transferData,
    raw: resp?.data ?? null,
  };
}

async function markRefundCompletedTx(
  tx: any,
  args: {
    refundId: string;
    actorUserId?: string | null;
    note?: string | null;
    provider: string;
    providerReference?: string | null;
    providerStatus?: string | null;
    providerPayload?: any;
  }
) {
  const refund = await tx.refund.findUnique({
    where: { id: String(args.refundId) },
    select: {
      id: true,
      status: true,
      orderId: true,
      purchaseOrderId: true,
      supplierId: true,
      requestedByUserId: true,
      totalAmount: true,
      meta: true,
    },
  });

  if (!refund) throw new Error("Refund not found");

  const currentStatus = upper(refund.status);

  if (currentStatus === "REFUNDED") {
    await reconcileRefundSideEffectsTx(tx, {
      refundId: refund.id,
      actorUserId: args.actorUserId ?? null,
      note: args.note || "Reconciled already-refunded record",
    });

    const existing = await tx.refund.findUnique({ where: { id: refund.id } });

    return {
      refund: existing,
      meta: refund,
      alreadyRefunded: true,
    };
  }

  if (!["APPROVED"].includes(currentStatus)) {
    throw new Error(`Cannot complete refund from status: ${refund.status}`);
  }

  const refundedAt = new Date();

  // 1) Mark the refund as refunded first.
  await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: "REFUNDED" as any,
      paidAt: refundedAt,
      processedAt: refundedAt,
      provider: args.provider,
      providerReference: args.providerReference ?? undefined,
      providerStatus: args.providerStatus ?? "SUCCESS",
      meta: {
        ...((refund.meta as any) || {}),
        settlement: {
          provider: args.provider,
          providerReference: args.providerReference ?? null,
          providerStatus: args.providerStatus ?? "SUCCESS",
          providerPayload: args.providerPayload ?? null,
          completedAt: refundedAt.toISOString(),
          note: args.note ?? null,
          actorUserId: args.actorUserId ?? null,
          amount: refund.totalAmount ?? null,
          purchaseOrderId: refund.purchaseOrderId ?? null,
          supplierId: refund.supplierId ?? null,
          supplierLiabilityAmount:
            (refund.meta as any)?.liability?.supplierLiabilityAmount ?? null,
          platformLiabilityAmount:
            (refund.meta as any)?.liability?.platformLiabilityAmount ?? null,
          shippingAmount:
            (refund.meta as any)?.shippingAmount ?? null,
        },
      },
    },
  });

  // 2) Reconcile side effects after refund status is REFUNDED.
  const reconciliation = await reconcileRefundSideEffectsTx(tx, {
    refundId: refund.id,
    actorUserId: args.actorUserId ?? null,
    note: args.note || "Refund marked refunded",
  });

  const purchaseOrderUpdated = !!reconciliation?.purchaseOrderUpdated;
  const allocationsUpdated = Number(reconciliation?.allocationsUpdated || 0);

  // 3) Write final settlement metadata including reconciliation results.
  const updated = await tx.refund.update({
    where: { id: refund.id },
    data: {
      meta: {
        ...((refund.meta as any) || {}),
        settlement: {
          provider: args.provider,
          providerReference: args.providerReference ?? null,
          providerStatus: args.providerStatus ?? "SUCCESS",
          providerPayload: args.providerPayload ?? null,
          completedAt: refundedAt.toISOString(),
          note: args.note ?? null,
          actorUserId: args.actorUserId ?? null,
          amount: refund.totalAmount ?? null,
          purchaseOrderId: refund.purchaseOrderId ?? null,
          supplierId: refund.supplierId ?? null,
          purchaseOrderUpdated,
          allocationsUpdated,
          supplierLiabilityAmount:
            (refund.meta as any)?.liability?.supplierLiabilityAmount ?? null,
          platformLiabilityAmount:
            (refund.meta as any)?.liability?.platformLiabilityAmount ?? null,
          shippingAmount:
            (refund.meta as any)?.shippingAmount ?? null,
        },
      },
    },
    include: {
      purchaseOrder: true,
      supplier: true,
      requestedBy: true,
      items: { include: { orderItem: true } },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  // 4) Audit event
  await tx.refundEvent.create({
    data: {
      refundId: refund.id,
      type: "REFUND_PAID",
      message: args.note || "Refund marked as completed.",
      meta: {
        adminId: args.actorUserId ?? null,
        provider: args.provider,
        providerReference: args.providerReference ?? null,
        providerStatus: args.providerStatus ?? "SUCCESS",
        amount: refund.totalAmount ?? null,
        purchaseOrderId: refund.purchaseOrderId ?? null,
        supplierId: refund.supplierId ?? null,
        allocationsUpdated,
        purchaseOrderUpdated,
        supplierLiabilityAmount:
          (refund.meta as any)?.liability?.supplierLiabilityAmount ?? null,
        platformLiabilityAmount:
          (refund.meta as any)?.liability?.platformLiabilityAmount ?? null,
        shippingAmount:
          (refund.meta as any)?.shippingAmount ?? null,
      },
    },
  });

  return {
    refund: updated,
    meta: refund,
    alreadyRefunded: false,
    purchaseOrderUpdated,
    allocationsUpdated,
  };
}

function isRefundOpenStatus(status: any) {
  const s = String(status ?? "").toUpperCase();
  return [
    "REQUESTED",
    "SUPPLIER_REVIEW",
    "SUPPLIER_ACCEPTED",
    "SUPPLIER_REJECTED",
    "ESCALATED",
    "APPROVED",
  ].includes(s);
}

function pickRefundReason(body: any) {
  return normStr(
    body?.reason ??
    body?.refundReason ??
    body?.message ??
    body?.note ??
    body?.description
  );
}

function pickRefundItemIds(body: any): string[] {
  const direct = Array.isArray(body?.itemIds) ? body.itemIds : [];
  const orderItemIds = Array.isArray(body?.orderItemIds) ? body.orderItemIds : [];
  const itemsFromObjects = Array.isArray(body?.items)
    ? body.items.map((x: any) => x?.orderItemId ?? x?.id)
    : [];

  return uniqStrings([...direct, ...orderItemIds, ...itemsFromObjects]);
}

function pickRefundPurchaseOrderId(body: any) {
  return normStr(body?.purchaseOrderId ?? body?.poId ?? "");
}


async function createCustomerRefundRequestTx(
  tx: any,
  args: {
    actorId: string;
    role: string;
    body: any;
  }
) {
  const actorId = normStr(args.actorId);
  const role = normRole(args.role);
  const body = args.body ?? {};

  if (!actorId) throw new Error("Unauthorized");
  if (role === "SUPPLIER" || isAdmin(role)) {
    throw new Error("Only customers can create refund requests here.");
  }

  const orderId = normStr(body?.orderId);
  if (!orderId) throw new Error("Missing orderId");

  const reason = pickRefundReason(body);
  if (!reason) throw new Error("Please provide a refund reason.");

  const requestedPurchaseOrderId = pickRefundPurchaseOrderId(body);
  const requestedItemIds = pickRefundItemIds(body);
  const requestedItemQuantities = pickRefundItemQuantities(body);
  const evidenceByItemIdInput = pickRefundEvidenceByItemId(body);

  const order = await tx.order.findFirst({
    where: { id: orderId, userId: actorId },
    select: {
      id: true,
      userId: true,
      status: true,
      total: true,
      subtotal: true,
      tax: true,
      serviceFeeBase: true,
      serviceFeeComms: true,
      serviceFeeGateway: true,
      serviceFeeTotal: true,
      items: {
        select: {
          id: true,
          title: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          orderId: true,
          chosenSupplierId: true,
        },
      },
      purchaseOrders: {
        select: {
          id: true,
          supplierId: true,
          status: true,
          payoutStatus: true,
          subtotal: true,
          shippingFeeChargedToCustomer: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error("Order not found.");
  }

  const allOrderItems = Array.isArray(order.items) ? order.items : [];
  if (!allOrderItems.length) {
    throw new Error("This order has no refundable items.");
  }

  const itemById = new Map(
    allOrderItems.map((it: any) => [String(it.id), it])
  );

  let selectedOrderItems = allOrderItems;

  if (requestedItemIds.length) {
    selectedOrderItems = allOrderItems.filter((it: any) =>
      requestedItemIds.includes(String(it.id))
    );

    if (!selectedOrderItems.length) {
      throw new Error("Selected refund items were not found on this order.");
    }
  }

  const qtyRows =
    requestedItemQuantities.length > 0
      ? requestedItemQuantities
      : selectedOrderItems.map((it: any) => ({
        itemId: String(it.id),
        qty: getOrderItemFullQty(it),
      }));

  const selectedQtyByItemId: Record<string, number> = {};

  for (const row of qtyRows) {
    const item = itemById.get(String(row.itemId));
    if (!item) continue;

    const fullQty = getOrderItemFullQty(item);
    const qty = clampRequestedRefundQty(row.qty, fullQty);

    if (qty <= 0) continue;
    selectedQtyByItemId[String(row.itemId)] = qty;
  }

  const selectedItemIdsFromQty = Object.keys(selectedQtyByItemId);
  if (!selectedItemIdsFromQty.length) {
    throw new Error("Please select at least one refund item quantity.");
  }

  selectedOrderItems = allOrderItems.filter((it: any) =>
    selectedItemIdsFromQty.includes(String(it.id))
  );

  if (!selectedOrderItems.length) {
    throw new Error("Selected refund items were not found on this order.");
  }

  const supplierIds = uniqStrings(
    selectedOrderItems.map((it: any) => it?.chosenSupplierId)
  );

  let supplierId: string | null = null;
  if (supplierIds.length === 1) {
    supplierId = supplierIds[0];
  } else if (supplierIds.length > 1) {
    throw new Error("Refund items must belong to a single supplier shipment.");
  }

  let purchaseOrderId: string | null = null;
  let purchaseOrder: any | null = null;

  if (requestedPurchaseOrderId) {
    const po = (order.purchaseOrders || []).find(
      (x: any) => String(x.id) === requestedPurchaseOrderId
    );
    if (!po) {
      throw new Error("Selected purchase order was not found on this order.");
    }
    purchaseOrder = po;
    purchaseOrderId = String(po.id);
    supplierId = String(po.supplierId ?? supplierId ?? "");
  } else if (supplierId) {
    const matchedPo = (order.purchaseOrders || []).find(
      (x: any) => String(x.supplierId) === String(supplierId)
    );
    if (matchedPo?.id) {
      purchaseOrder = matchedPo;
      purchaseOrderId = String(matchedPo.id);
    }
  }

  if (purchaseOrderId) {
    const poSupplierId = String(purchaseOrder?.supplierId ?? "");
    const invalidPoItem = selectedOrderItems.find(
      (it: any) => String(it?.chosenSupplierId ?? "") !== poSupplierId
    );
    if (invalidPoItem) {
      throw new Error("Selected refund items do not all belong to the selected purchase order.");
    }
  }

  const existingRefunds = await tx.refund.findMany({
    where: {
      orderId,
      requestedByUserId: actorId,
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
    },
    select: {
      id: true,
      status: true,
      items: {
        select: {
          orderItemId: true,
          qty: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const existingOpen = existingRefunds.find((r: any) =>
    isRefundOpenStatus(r?.status)
  );

  if (existingOpen) {
    throw new Error("A refund request already exists for this order.");
  }

  const alreadyRefundedQtyByItemId: Record<string, number> = {};
  for (const refund of existingRefunds) {
    for (const item of refund.items || []) {
      const itemId = String(item.orderItemId || "");
      const qty = Math.max(0, Number(item.qty || 0));
      if (!itemId || qty <= 0) continue;
      alreadyRefundedQtyByItemId[itemId] =
        (alreadyRefundedQtyByItemId[itemId] || 0) + qty;
    }
  }

  for (const it of selectedOrderItems) {
    const itemId = String(it.id);
    const orderedQty = getOrderItemFullQty(it);
    const requestedQty = clampRequestedRefundQty(selectedQtyByItemId[itemId], orderedQty);
    const alreadyRefundedQty = Math.max(0, Number(alreadyRefundedQtyByItemId[itemId] || 0));

    if (requestedQty <= 0) {
      throw new Error("Please select a valid refund quantity.");
    }

    if (requestedQty + alreadyRefundedQty > orderedQty) {
      throw new Error(
        `Refund quantity exceeds purchased quantity for item "${String(it.title || itemId)}".`
      );
    }
  }

  const selectedItemIdSet = new Set(selectedItemIdsFromQty);

  const evidenceByItemId: Record<string, string[]> = {};
  for (const [rawItemId, urls] of Object.entries(evidenceByItemIdInput || {})) {
    const itemId = normStr(rawItemId);
    if (!itemId || !selectedItemIdSet.has(itemId)) continue;
    const cleanUrls = normalizeUrlList(urls);
    if (cleanUrls.length) {
      evidenceByItemId[itemId] = cleanUrls;
    }
  }

  if (refundReasonRequiresEvidence(reason)) {
    const missingEvidenceItem = selectedOrderItems.find((it: any) => {
      const itemId = String(it.id);
      return !Array.isArray(evidenceByItemId[itemId]) || evidenceByItemId[itemId].length === 0;
    });

    if (missingEvidenceItem) {
      throw new Error(
        "Please upload at least one evidence image for each selected refund item."
      );
    }
  }

  const faultParty = inferFaultPartyFromReason(reason, body?.faultParty);

  const financials = buildRefundFinancials({
    order,
    purchaseOrder,
    allOrderItems,
    selectedOrderItems,
    selectedQtyByItemId,
    supplierId,
    reason,
    faultParty,
  });

  const created = await tx.refund.create({
    data: {
      orderId,
      purchaseOrderId: purchaseOrderId || undefined,
      supplierId: supplierId || undefined,
      requestedByUserId: actorId,
      status: "REQUESTED" as any,
      reason,
      faultParty,
      itemsAmount: financials.itemsAmount,
      taxAmount: financials.taxAmount,
      serviceFeeBaseAmount: financials.serviceFeeBaseAmount,
      serviceFeeCommsAmount: financials.serviceFeeCommsAmount,
      serviceFeeGatewayAmount: financials.serviceFeeGatewayAmount,
      totalAmount: financials.totalAmount,
      providerReference:
        normStr(body?.providerReference || body?.reference || "") || undefined,
      meta: {
        customerNote: normStr(body?.note || body?.customerNote || body?.message || "") || null,
        requestedMode: normStr(body?.mode || "") || null,
        evidenceByItemId,
        evidenceItemIds: Object.keys(evidenceByItemId),
        evidenceCount: countEvidenceUrls(evidenceByItemId),
        selectedQtyByItemId,

        shippingAmount: financials.shippingAmount.toFixed(2),
        liability: {
          faultParty,
          fullCustomerRefund: financials.liability.fullCustomerRefund,
          supplierLiabilityAmount: financials.liability.supplierLiabilityAmount.toFixed(2),
          platformLiabilityAmount: financials.liability.platformLiabilityAmount.toFixed(2),
          itemShareOfOrder: financials.liability.itemShareOfOrder.toFixed(6),
          itemShareOfPo: financials.liability.itemShareOfPo.toFixed(6),
          fullPoSelected: financials.liability.fullPoSelected,
        },
      },
    } as any,
    select: {
      id: true,
      orderId: true,
      purchaseOrderId: true,
      supplierId: true,
      requestedByUserId: true,
      status: true,
      reason: true,
      faultParty: true,
      itemsAmount: true,
      taxAmount: true,
      serviceFeeBaseAmount: true,
      serviceFeeCommsAmount: true,
      serviceFeeGatewayAmount: true,
      totalAmount: true,
      createdAt: true,
      meta: true,
    },
  });

  if (selectedOrderItems.length) {
    await tx.refundItem.createMany({
      data: selectedOrderItems.map((it: any) => ({
        refundId: created.id,
        orderItemId: String(it.id),
        qty: clampRequestedRefundQty(
          selectedQtyByItemId[String(it.id)],
          getOrderItemFullQty(it)
        ),
      })),
      skipDuplicates: true,
    });
  }

  await tx.refundEvent.create({
    data: {
      refundId: created.id,
      type: "CUSTOMER_REQUESTED",
      message: reason,
      meta: {
        orderId,
        purchaseOrderId,
        supplierId,
        itemCount: selectedOrderItems.length,
        itemIds: selectedOrderItems.map((it: any) => String(it.id)),
        itemQuantities: selectedOrderItems.map((it: any) => ({
          itemId: String(it.id),
          qty: clampRequestedRefundQty(
            selectedQtyByItemId[String(it.id)],
            getOrderItemFullQty(it)
          ),
        })),
        evidenceRequired: refundReasonRequiresEvidence(reason),
        evidenceItemIds: Object.keys(evidenceByItemId),
        evidenceCount: countEvidenceUrls(evidenceByItemId),
        faultParty,
        financials: {
          itemsAmount: financials.itemsAmount.toFixed(2),
          taxAmount: financials.taxAmount.toFixed(2),
          shippingAmount: financials.shippingAmount.toFixed(2),
          serviceFeeBaseAmount: financials.serviceFeeBaseAmount.toFixed(2),
          serviceFeeCommsAmount: financials.serviceFeeCommsAmount.toFixed(2),
          serviceFeeGatewayAmount: financials.serviceFeeGatewayAmount.toFixed(2),
          totalAmount: financials.totalAmount.toFixed(2),
          supplierLiabilityAmount: financials.liability.supplierLiabilityAmount.toFixed(2),
          platformLiabilityAmount: financials.liability.platformLiabilityAmount.toFixed(2),
        },
      },
    },
  });

  if (purchaseOrderId) {
    try {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: "REFUND_REQUESTED" as any,
        },
      });
    } catch {
      //
    }
  }

  return {
    refund: created,
    selectedOrderItems,
    selectedQtyByItemId,
    supplierId,
    purchaseOrderId,
  };
}

const FULL_REFUND_REASONS = new Set([
  "DAMAGED",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "NOT_RECEIVED",
]);

type FaultParty = "SUPPLIER" | "PLATFORM" | "CUSTOMER" | "SHARED" | "UNKNOWN";

function normalizeFaultParty(v: any): FaultParty {
  const s = upper(v);
  if (s === "SUPPLIER") return "SUPPLIER";
  if (s === "PLATFORM") return "PLATFORM";
  if (s === "CUSTOMER") return "CUSTOMER";
  if (s === "SHARED") return "SHARED";
  return "UNKNOWN";
}

function inferFaultPartyFromReason(reason: any, explicit?: any): FaultParty {
  const given = normalizeFaultParty(explicit);
  if (given !== "UNKNOWN") return given;

  const r = upper(reason);

  if (["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "NOT_RECEIVED"].includes(r)) {
    return "SUPPLIER";
  }

  if (r === "CHANGED_MIND") {
    return "CUSTOMER";
  }

  return "UNKNOWN";
}

function isFullCustomerRefundReason(reason: any, faultParty: FaultParty) {
  if (faultParty === "SUPPLIER" || faultParty === "PLATFORM") return true;
  return FULL_REFUND_REASONS.has(upper(reason));
}

function decimalMax(v: Prisma.Decimal | number | string | null | undefined, min = 0) {
  const d = v instanceof Prisma.Decimal ? v : toDecimal(v);
  const m = new Prisma.Decimal(min);
  return d.lessThan(m) ? m : d;
}

function decimalSafeDiv(a: Prisma.Decimal, b: Prisma.Decimal) {
  if (b.eq(0)) return new Prisma.Decimal(0);
  return a.div(b);
}

function decimalRoundMoney(v: Prisma.Decimal) {
  return new Prisma.Decimal(v.toFixed(2));
}

function prorationAmount(total: any, numerator: Prisma.Decimal, denominator: Prisma.Decimal) {
  const t = toDecimal(total);
  if (t.lte(0) || numerator.lte(0) || denominator.lte(0)) {
    return new Prisma.Decimal(0);
  }
  return decimalRoundMoney(t.mul(decimalSafeDiv(numerator, denominator)));
}

function sumLineTotals(
  items: any[],
  qtyByItemId?: Record<string, number>
): Prisma.Decimal {
  return (items || []).reduce((sum: Prisma.Decimal, it: any) => {
    const itemId = String(it?.id ?? "");
    const fullQty = getOrderItemFullQty(it);
    const requestedQty = qtyByItemId?.[itemId];

    const qty =
      requestedQty != null
        ? clampRequestedRefundQty(requestedQty, fullQty)
        : fullQty;

    if (qty <= 0) return sum;

    const unitPrice = getOrderItemUnitPriceDecimal(it);
    const lineTotal = decimalRoundMoney(unitPrice.mul(new Prisma.Decimal(qty)));

    return sum.plus(lineTotal);
  }, new Prisma.Decimal(0));
}

function getOrderItemsForSupplier(orderItems: any[], supplierId?: string | null) {
  const sid = normStr(supplierId);
  if (!sid) return [];
  return (orderItems || []).filter((it: any) => normStr(it?.chosenSupplierId) === sid);
}

function allSelectedItemsMatch(ids: string[], items: any[]) {
  const selected = new Set((ids || []).map((x) => String(x)));
  const target = (items || []).map((it: any) => String(it?.id)).filter(Boolean);
  if (!target.length) return false;
  return target.every((id) => selected.has(id));
}

function buildRefundFinancials(args: {
  order: any;
  purchaseOrder: any | null;
  allOrderItems: any[];
  selectedOrderItems: any[];
  selectedQtyByItemId: Record<string, number>;
  supplierId?: string | null;
  reason: string;
  faultParty: FaultParty;
}) {
  const {
    order,
    purchaseOrder,
    allOrderItems,
    selectedOrderItems,
    selectedQtyByItemId,
    supplierId,
    reason,
    faultParty,
  } = args;

  const itemsAmount = decimalRoundMoney(
    sumLineTotals(selectedOrderItems, selectedQtyByItemId)
  );

  const orderSubtotal = decimalMax(order?.subtotal ?? order?.total ?? 0);

  // VAT is already embedded in supplier/customer pricing, so do not refund separately.
  const taxAmount = new Prisma.Decimal(0);

  const orderServiceFeeBase = decimalMax(order?.serviceFeeBase ?? 0);
  const orderServiceFeeComms = decimalMax(order?.serviceFeeComms ?? 0);
  const orderServiceFeeGateway = decimalMax(order?.serviceFeeGateway ?? 0);

  const poItems = getOrderItemsForSupplier(allOrderItems, supplierId);

  const poSubtotal = decimalMax(
    purchaseOrder?.subtotal ?? sumLineTotals(poItems)
  );

  const poShippingCharged = decimalMax(purchaseOrder?.shippingFeeChargedToCustomer ?? 0);

  const selectedItemIds = selectedOrderItems.map((it: any) => String(it.id));

  const fullPoSelected =
    allSelectedItemsMatch(selectedItemIds, poItems) &&
    poItems.every((it: any) => {
      const itemId = String(it?.id ?? "");
      const fullQty = getOrderItemFullQty(it);
      const selectedQty = clampRequestedRefundQty(
        selectedQtyByItemId?.[itemId],
        fullQty
      );
      return selectedQty === fullQty;
    });

  const itemShareOfOrder = decimalSafeDiv(itemsAmount, orderSubtotal);
  const itemShareOfPo = decimalSafeDiv(itemsAmount, poSubtotal);

  let serviceFeeBaseAmount = new Prisma.Decimal(0);
  let serviceFeeCommsAmount = new Prisma.Decimal(0);
  let serviceFeeGatewayAmount = new Prisma.Decimal(0);
  let shippingAmount = new Prisma.Decimal(0);

  const fullCustomerRefund = isFullCustomerRefundReason(reason, faultParty);

  if (fullCustomerRefund) {
    serviceFeeBaseAmount = prorationAmount(orderServiceFeeBase, itemsAmount, orderSubtotal);
    serviceFeeCommsAmount = prorationAmount(orderServiceFeeComms, itemsAmount, orderSubtotal);
    serviceFeeGatewayAmount = prorationAmount(orderServiceFeeGateway, itemsAmount, orderSubtotal);

    shippingAmount = fullPoSelected
      ? decimalRoundMoney(poShippingCharged)
      : prorationAmount(poShippingCharged, itemsAmount, poSubtotal);
  }

  const totalAmount = decimalRoundMoney(
    itemsAmount
      .plus(taxAmount)
      .plus(serviceFeeBaseAmount)
      .plus(serviceFeeCommsAmount)
      .plus(serviceFeeGatewayAmount)
      .plus(shippingAmount)
  );

  let supplierLiabilityAmount = new Prisma.Decimal(0);
  let platformLiabilityAmount = new Prisma.Decimal(0);

  if (faultParty === "SUPPLIER") {
    supplierLiabilityAmount = decimalRoundMoney(itemsAmount.plus(shippingAmount));
    platformLiabilityAmount = decimalRoundMoney(
      totalAmount.minus(supplierLiabilityAmount)
    );
  } else if (faultParty === "PLATFORM") {
    supplierLiabilityAmount = new Prisma.Decimal(0);
    platformLiabilityAmount = decimalRoundMoney(totalAmount);
  } else if (faultParty === "CUSTOMER") {
    supplierLiabilityAmount = new Prisma.Decimal(0);
    platformLiabilityAmount = decimalRoundMoney(totalAmount);
  } else if (faultParty === "SHARED") {
    supplierLiabilityAmount = decimalRoundMoney(itemsAmount.plus(shippingAmount.div(2)));
    platformLiabilityAmount = decimalRoundMoney(
      totalAmount.minus(supplierLiabilityAmount)
    );
  } else {
    supplierLiabilityAmount = decimalRoundMoney(itemsAmount);
    platformLiabilityAmount = decimalRoundMoney(
      totalAmount.minus(supplierLiabilityAmount)
    );
  }

  return {
    itemsAmount,
    taxAmount,
    serviceFeeBaseAmount,
    serviceFeeCommsAmount,
    serviceFeeGatewayAmount,
    shippingAmount,
    totalAmount,
    liability: {
      faultParty,
      fullCustomerRefund,
      supplierLiabilityAmount: decimalRoundMoney(supplierLiabilityAmount),
      platformLiabilityAmount: decimalRoundMoney(platformLiabilityAmount),
      itemShareOfOrder: decimalRoundMoney(itemShareOfOrder),
      itemShareOfPo: decimalRoundMoney(itemShareOfPo),
      fullPoSelected,
    },
  };
}

/**
 * POST /api/refunds
 * POST /api/refunds/request
 */
async function handleCreateRefundRequest(req: any, res: any) {
  const actorId = normStr(req.user?.id);
  const role = normRole(req.user?.role);

  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      return createCustomerRefundRequestTx(tx, {
        actorId,
        role,
        body: req.body,
      });
    });

    if (out.refund.requestedByUserId) {
      await notifyUser(out.refund.requestedByUserId, {
        type: "REFUND_REQUESTED",
        title: "Refund request submitted",
        body: `Your refund request for order ${out.refund.orderId} has been submitted.`,
        data: {
          refundId: out.refund.id,
          orderId: out.refund.orderId,
          purchaseOrderId: out.refund.purchaseOrderId ?? null,
        },
      });
    }

    if (out.supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: out.supplierId },
        select: { id: true, userId: true, name: true },
      });

      if (supplier?.userId) {
        await notifyUser(supplier.userId, {
          type: "REFUND_REQUESTED",
          title: "Refund request received",
          body: `A customer submitted a refund request for order ${out.refund.orderId}.`,
          data: {
            refundId: out.refund.id,
            orderId: out.refund.orderId,
            purchaseOrderId: out.purchaseOrderId ?? null,
          },
        });
      }
    }

    const adminUserIds = await getAdminUserIds();
    await notifyMany(adminUserIds, {
      type: "REFUND_REQUESTED",
      title: "New refund request",
      body: `A refund request was submitted for order ${out.refund.orderId}.`,
      data: {
        refundId: out.refund.id,
        orderId: out.refund.orderId,
        purchaseOrderId: out.purchaseOrderId ?? null,
      },
    });

    return res.status(201).json({
      ok: true,
      data: out.refund,
      meta: {
        created: true,
        purchaseOrderId: out.purchaseOrderId ?? null,
        supplierId: out.supplierId ?? null,
        itemCount: out.selectedOrderItems.length,
        itemQuantities: out.selectedOrderItems.map((it: any) => ({
          itemId: String(it.id),
          qty: Number(out.selectedQtyByItemId?.[String(it.id)] || 0),
        })),
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error: e?.message || "Failed to submit refund request",
    });
  }
}

router.post("/", requireAuth, handleCreateRefundRequest);
router.post("/request", requireAuth, handleCreateRefundRequest);

/**
 * GET /api/refunds
 */
router.get("/", requireAuth, async (req: any, res) => {
  const actorId = normStr(req.user?.id);
  const role = normRole(req.user?.role);

  if (!actorId) return res.status(401).json({ error: "Unauthorized" });

  const q = normStr(req.query.q).toLowerCase();
  const status = normStr(req.query.status).toUpperCase();

  const pageRaw = req.query.page;
  const pageSizeRaw = req.query.pageSize;

  const hasPageMode = pageRaw !== undefined || pageSizeRaw !== undefined;

  const page = hasPageMode ? toPositiveInt(pageRaw, 1) : 1;
  const pageSize = Math.min(100, toPositiveInt(pageSizeRaw, 20));

  const take = hasPageMode
    ? pageSize
    : Math.min(100, Math.max(1, Number(req.query.take ?? 50)));

  const skip = hasPageMode
    ? (page - 1) * pageSize
    : Math.max(0, Number(req.query.skip ?? 0));

  const resolvedPage = hasPageMode ? page : Math.floor(skip / Math.max(1, take)) + 1;
  const resolvedPageSize = hasPageMode ? pageSize : take;

  const where: any = {};

  if (status) {
    where.status = status;
  }

  if (isAdmin(role)) {
    if (q) {
      where.OR = [
        { orderId: { contains: q, mode: "insensitive" } },
        { purchaseOrderId: { contains: q, mode: "insensitive" } },
        { supplierId: { contains: q, mode: "insensitive" } },
        { providerReference: { contains: q, mode: "insensitive" } },
      ];
    }
  } else if (role === "SUPPLIER") {
    const supplier = await prisma.supplier.findFirst({
      where: { userId: actorId },
      select: { id: true },
    });

    if (!supplier?.id) {
      return res.status(403).json({ error: "Supplier account not found" });
    }

    where.supplierId = supplier.id;

    if (q) {
      where.AND = [
        { supplierId: supplier.id },
        {
          OR: [
            { orderId: { contains: q, mode: "insensitive" } },
            { purchaseOrderId: { contains: q, mode: "insensitive" } },
            { providerReference: { contains: q, mode: "insensitive" } },
          ],
        },
      ];
      delete where.supplierId;
    }
  } else {
    where.requestedByUserId = actorId;

    if (q) {
      where.AND = [
        { requestedByUserId: actorId },
        {
          OR: [
            { orderId: { contains: q, mode: "insensitive" } },
            { purchaseOrderId: { contains: q, mode: "insensitive" } },
            { providerReference: { contains: q, mode: "insensitive" } },
          ],
        },
      ];
      delete where.requestedByUserId;
    }
  }

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            status: true,
            createdAt: true,
            total: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            payoutStatus: true,
            supplierId: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            userId: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        adminResolvedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: {
            orderItem: {
              select: {
                id: true,
                title: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
              },
            },
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 8,
        },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));

  return res.json({
    ok: true,
    data: rows,
    meta: {
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      totalPages,
      take,
      skip,
      role,
    },
  });
});

/**
 * GET /api/refunds/mine
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  const actorId = normStr(req.user?.id);
  const role = normRole(req.user?.role);

  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (role === "SUPPLIER" || isAdmin(role)) {
    return res.json({
      ok: true,
      data: [],
      meta: {
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        take: 20,
        skip: 0,
        role,
      },
    });
  }

  const q = normStr(req.query.q).toLowerCase();
  const status = normStr(req.query.status).toUpperCase();

  const pageRaw = req.query.page;
  const pageSizeRaw = req.query.pageSize;

  const hasPageMode = pageRaw !== undefined || pageSizeRaw !== undefined;

  const page = hasPageMode ? toPositiveInt(pageRaw, 1) : 1;
  const pageSize = Math.min(100, toPositiveInt(pageSizeRaw, 20));

  const take = hasPageMode
    ? pageSize
    : Math.min(100, Math.max(1, Number(req.query.take ?? req.query.limit ?? 50)));

  const skip = hasPageMode
    ? (page - 1) * pageSize
    : Math.max(0, Number(req.query.skip ?? 0));

  const resolvedPage = hasPageMode ? page : Math.floor(skip / Math.max(1, take)) + 1;
  const resolvedPageSize = hasPageMode ? pageSize : take;

  const where: any = {
    requestedByUserId: actorId,
  };

  if (status) {
    where.status = status;
  }

  if (q) {
    where.AND = [
      { requestedByUserId: actorId },
      {
        OR: [
          { orderId: { contains: q, mode: "insensitive" } },
          { purchaseOrderId: { contains: q, mode: "insensitive" } },
          { providerReference: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
    delete where.requestedByUserId;
  }

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            status: true,
            createdAt: true,
            total: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            payoutStatus: true,
            supplierId: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            userId: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        adminResolvedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: {
            orderItem: {
              select: {
                id: true,
                title: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
              },
            },
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 8,
        },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));

  return res.json({
    ok: true,
    data: rows,
    meta: {
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      totalPages,
      take,
      skip,
      role,
    },
  });
});


async function reconcileRefundSideEffectsTx(
  tx: any,
  args: {
    refundId: string;
    actorUserId?: string | null;
    note?: string | null;
  }
) {
  const refund = await tx.refund.findUnique({
    where: { id: args.refundId },
    select: {
      id: true,
      orderId: true,
      purchaseOrderId: true,
      supplierId: true,
      status: true,
      totalAmount: true,
      meta: true,
    },
  });

  if (!refund) {
    throw new Error("Refund not found");
  }

  const refundStatus = String(refund.status ?? "").toUpperCase();

  if (refundStatus !== "REFUNDED") {
    return {
      refundId: refund.id,
      skipped: true,
      reason: `Refund status is ${refund.status}, not REFUNDED`,
    };
  }

  const supplierLiabilityAmount = Number(
    (refund.meta as any)?.liability?.supplierLiabilityAmount ??
    refund.totalAmount ??
    0
  );

  let purchaseOrderUpdated = false;

  if (refund.purchaseOrderId) {
    try {
      await tx.purchaseOrder.update({
        where: { id: String(refund.purchaseOrderId) },
        data: {
          payoutStatus: "REFUNDED" as any,
        },
      });
      purchaseOrderUpdated = true;
    } catch {
      //
    }
  }

  let allocationsUpdated = 0;

  if (refund.purchaseOrderId) {
    try {
      const result = await tx.supplierPaymentAllocation.updateMany({
        where: {
          purchaseOrderId: String(refund.purchaseOrderId),
          status: { in: ["PENDING", "HELD", "APPROVED"] as any },
        },
        data: {
          status: "FAILED" as any,
        },
      });

      allocationsUpdated = Number(result?.count || 0);
    } catch {
      //
    }
  }

  let ledgerCreated = false;

  if (refund.supplierId && supplierLiabilityAmount > 0) {
    try {
      const existingLedger = await tx.supplierLedgerEntry.findFirst({
        where: {
          supplierId: String(refund.supplierId),
          referenceType: "REFUND" as any,
          referenceId: String(refund.id),
        },
        select: { id: true },
      });

      if (!existingLedger) {
        await tx.supplierLedgerEntry.create({
          data: {
            supplierId: String(refund.supplierId),
            type: "DEBIT" as any,
            amount: new Prisma.Decimal(supplierLiabilityAmount),
            currency: "NGN",
            referenceType: "REFUND",
            referenceId: String(refund.id),
            reason: "Refund reversal",
            meta: {
              refundId: refund.id,
              orderId: refund.orderId,
              purchaseOrderId: refund.purchaseOrderId ?? null,
              note: args.note ?? null,
              actorUserId: args.actorUserId ?? null,
              customerRefundTotalAmount: refund.totalAmount ?? null,
              supplierLiabilityAmount,
              platformLiabilityAmount:
                (refund.meta as any)?.liability?.platformLiabilityAmount ?? null,
            },
          },
        });

        ledgerCreated = true;
      }
    } catch {
      //
    }
  }

  let orderUpdated = false;

  try {
    const orderRefunds = await tx.refund.findMany({
      where: { orderId: String(refund.orderId) },
      select: { id: true, status: true },
    });

    const hasAnyRefunds = orderRefunds.length > 0;
    const allRefundsCompleted =
      hasAnyRefunds &&
      orderRefunds.every((r: any) => String(r.status ?? "").toUpperCase() === "REFUNDED");

    if (allRefundsCompleted) {
      await tx.order.update({
        where: { id: String(refund.orderId) },
        data: {
          status: "REFUNDED" as any,
        },
      });
      orderUpdated = true;
    }
  } catch {
    //
  }

  try {
    await tx.refundEvent.create({
      data: {
        refundId: String(refund.id),
        type: "REFUND_RECONCILED",
        message: args.note || "Refund reconciliation completed.",
        meta: {
          actorUserId: args.actorUserId ?? null,
          orderId: refund.orderId,
          purchaseOrderId: refund.purchaseOrderId ?? null,
          supplierId: refund.supplierId ?? null,
          purchaseOrderUpdated,
          allocationsUpdated,
          ledgerCreated,
          orderUpdated,
          supplierLiabilityAmount,
          platformLiabilityAmount:
            (refund.meta as any)?.liability?.platformLiabilityAmount ?? null,
        },
      },
    });
  } catch {
    //
  }

  return {
    refundId: refund.id,
    purchaseOrderUpdated,
    allocationsUpdated,
    ledgerCreated,
    orderUpdated,
    skipped: false,
  };
}


function maskAccountNumber(v: any) {
  const s = onlyDigits(v);
  if (s.length <= 4) return s;
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

async function getRefundForPayoutAccessTx(tx: any, refundId: string) {
  return tx.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true,
      orderId: true,
      requestedByUserId: true,
      supplierId: true,
      status: true,
      totalAmount: true,
      requestedBy: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
}

function canEditRefundPayoutDetails(args: {
  actorId: string;
  actorRole: string;
  refund: any;
}) {
  if (!args.actorId || !args.refund) return false;
  if (isAdmin(args.actorRole)) return true;
  return String(args.refund.requestedByUserId || "") === String(args.actorId || "");
}

/**
 * PATCH /api/refunds/:id/decision
 * body: { decision: "APPROVE"|"REJECT", note? }
 */
router.patch("/:id/decision", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Admin only" });

  const id = normStr(req.params.id);
  const decision = upper(req.body?.decision);
  const note = normStr(req.body?.note) || null;

  if (!["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({ error: "Invalid decision" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          supplierId: true,
          requestedByUserId: true,
        },
      });

      if (!refund) throw new Error("Refund not found");

      const currentStatus = upper(refund.status);

      if (decision === "APPROVE" && currentStatus === "APPROVED") {
        const existing = await tx.refund.findUnique({ where: { id } });
        return {
          r2: existing,
          refund,
          alreadyInTargetState: true,
          decision,
        };
      }

      if (decision === "REJECT" && currentStatus === "REJECTED") {
        const existing = await tx.refund.findUnique({ where: { id } });
        return {
          r2: existing,
          refund,
          alreadyInTargetState: true,
          decision,
        };
      }

      if (currentStatus === "APPROVED" && decision === "REJECT") {
        throw new Error("Cannot reject a refund that is already approved");
      }

      if (currentStatus === "REJECTED" && decision === "APPROVE") {
        throw new Error("Cannot approve a refund that is already rejected");
      }

      const allowed = new Set([
        "SUPPLIER_REVIEW",
        "SUPPLIER_ACCEPTED",
        "SUPPLIER_REJECTED",
        "ESCALATED",
        "REQUESTED",
      ]);

      if (!allowed.has(currentStatus)) {
        throw new Error(`Cannot decide refund from status: ${refund.status}`);
      }

      const nextStatus = decision === "APPROVE" ? ("APPROVED" as any) : ("REJECTED" as any);

      const r2 = await tx.refund.update({
        where: { id },
        data: {
          status: nextStatus,
          adminResolvedAt: new Date(),
          adminResolvedById: req.user?.id ?? null,
          adminDecision: decision,
          adminNote: note ?? undefined,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundId: id,
          type: decision === "APPROVE" ? "ADMIN_APPROVED" : "ADMIN_REJECTED",
          message: note ?? undefined,
          meta: { adminId: req.user?.id, decision },
        },
      });

      return {
        r2,
        refund,
        alreadyInTargetState: false,
        decision,
      };
    });

    const refundRow = updated.r2;
    const refundMeta = updated.refund;

    if (!updated.alreadyInTargetState) {
      if (refundMeta.requestedByUserId) {
        await notifyUser(refundMeta.requestedByUserId, {
          type: "REFUND_STATUS_CHANGED",
          title: "Refund updated",
          body:
            decision === "APPROVE"
              ? `Your refund was approved for order ${refundMeta.orderId}.`
              : `Your refund was rejected for order ${refundMeta.orderId}.`,
          data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
        });
      }

      if (refundMeta.supplierId) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: refundMeta.supplierId },
          select: { userId: true, name: true },
        });
        if (supplier?.userId) {
          await notifyUser(supplier.userId, {
            type: "REFUND_STATUS_CHANGED",
            title: "Refund updated",
            body:
              decision === "APPROVE"
                ? `Admin approved a refund on order ${refundMeta.orderId}.`
                : `Admin rejected a refund on order ${refundMeta.orderId}.`,
            data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
          });
        }
      }

      const adminUserIds = await getAdminUserIds();
      await notifyMany(adminUserIds, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund decision recorded",
        body: `Admin ${decision} for refund on order ${refundMeta.orderId}.`,
        data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
      });
    }

    return res.json({
      ok: true,
      data: refundRow,
      meta: {
        alreadyInTargetState: updated.alreadyInTargetState,
      },
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to record decision" });
  }
});

/**
 * POST /api/refunds/:id/approve
 */
router.post("/:id/approve", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = normStr(req.params.id);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          supplierId: true,
          requestedByUserId: true,
        },
      });

      if (!refund) {
        throw new Error("Refund not found");
      }

      const currentStatus = upper(refund.status);

      if (currentStatus === "APPROVED") {
        const existing = await tx.refund.findUnique({ where: { id } });
        return { refund: existing, meta: refund, alreadyApproved: true };
      }

      if (
        !["REQUESTED", "SUPPLIER_REVIEW", "SUPPLIER_ACCEPTED", "ESCALATED"].includes(
          currentStatus
        )
      ) {
        throw new Error(`Cannot approve refund from status: ${refund.status}`);
      }

      const refundItems = await tx.refundItem.findMany({
        where: { refundId: id },
        select: {
          id: true,
          qty: true,
          orderItemId: true,
          orderItem: {
            select: {
              id: true,
              orderId: true,
              productId: true,
              variantId: true,
              quantity: true,
              chosenSupplierProductOfferId: true,
              chosenSupplierVariantOfferId: true,
            },
          },
        },
      });

      const approvedRefund = await tx.refund.update({
        where: { id },
        data: {
          status: "APPROVED" as any,
          adminResolvedAt: new Date(),
          adminResolvedById: String(req.user?.id),
          adminDecision: req.body?.adminDecision
            ? String(req.body.adminDecision)
            : "APPROVED",
          adminNote: req.body?.adminNote ? String(req.body.adminNote) : undefined,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundId: id,
          type: "ADMIN_APPROVED",
          message: "Refund approved",
          meta: {
            adminId: req.user?.id,
            adminDecision: req.body?.adminDecision ?? "APPROVED",
            adminNote: req.body?.adminNote ?? null,
          },
        },
      });

      if (refund.purchaseOrderId) {
        try {
          await tx.purchaseOrder.update({
            where: { id: refund.purchaseOrderId },
            data: {
              status: "REFUND_REQUESTED" as any,
            },
          });
        } catch {
          //
        }
      }

      for (const ri of refundItems) {
        const oi = ri.orderItem;
        if (!oi) continue;

        const restoreQty = Math.max(0, Number(ri.qty ?? oi.quantity ?? 0));
        if (restoreQty <= 0) continue;

        if (oi.chosenSupplierVariantOfferId) {
          const updatedVariantOffer = await tx.supplierVariantOffer.update({
            where: { id: String(oi.chosenSupplierVariantOfferId) },
            data: {
              availableQty: { increment: restoreQty },
              inStock: true,
            },
            select: {
              id: true,
              availableQty: true,
              productId: true,
              variantId: true,
            },
          });

          const variantProductId = updatedVariantOffer.productId
            ? String(updatedVariantOffer.productId)
            : oi.productId
              ? String(oi.productId)
              : null;

          if (variantProductId) {
            await recomputeProductStockTx(tx, variantProductId);
            await syncProductInStockCacheTx(tx, variantProductId);
          }
        } else if (oi.chosenSupplierProductOfferId) {
          const updatedBaseOffer = await tx.supplierProductOffer.update({
            where: { id: String(oi.chosenSupplierProductOfferId) },
            data: {
              availableQty: { increment: restoreQty },
              inStock: true,
            },
            select: {
              id: true,
              availableQty: true,
              productId: true,
            },
          });

          const baseProductId = updatedBaseOffer.productId
            ? String(updatedBaseOffer.productId)
            : oi.productId
              ? String(oi.productId)
              : null;

          if (baseProductId) {
            await recomputeProductStockTx(tx, baseProductId);
            await syncProductInStockCacheTx(tx, baseProductId);
          }
        } else if (oi.productId) {
          await recomputeProductStockTx(tx, String(oi.productId));
          await syncProductInStockCacheTx(tx, String(oi.productId));
        }
      }

      return {
        refund: approvedRefund,
        meta: refund,
        alreadyApproved: false,
      };
    });

    const refundMeta = updated.meta;

    if (!updated.alreadyApproved) {
      if (refundMeta.requestedByUserId) {
        await notifyUser(refundMeta.requestedByUserId, {
          type: "REFUND_STATUS_CHANGED",
          title: "Refund approved",
          body: `Your refund has been approved for order ${refundMeta.orderId}.`,
          data: {
            refundId: refundMeta.id,
            orderId: refundMeta.orderId,
            status: "APPROVED",
          },
        });
      }

      if (refundMeta.supplierId) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: refundMeta.supplierId },
          select: { userId: true, name: true },
        });

        if (supplier?.userId) {
          await notifyUser(supplier.userId, {
            type: "REFUND_STATUS_CHANGED",
            title: "Refund approved",
            body: `A refund has been approved for order ${refundMeta.orderId}.`,
            data: {
              refundId: refundMeta.id,
              orderId: refundMeta.orderId,
              status: "APPROVED",
            },
          });
        }
      }

      const adminUserIds = await getAdminUserIds();
      await notifyMany(adminUserIds, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund approved",
        body: `Refund approved for order ${refundMeta.orderId}.`,
        data: {
          refundId: refundMeta.id,
          orderId: refundMeta.orderId,
          status: "APPROVED",
        },
      });
    }

    return res.json({
      ok: true,
      data: updated.refund,
      meta: {
        inventoryRestored: !updated.alreadyApproved,
        alreadyApproved: updated.alreadyApproved,
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error: e?.message || "Failed to approve refund",
    });
  }
});


/**
 * POST /api/refunds/:id/mark-refunded
 * Marks an approved refund as actually refunded to the customer.
 *
 * This is the point where money is considered returned.
 * Use this after gateway refund success or confirmed manual payout.
 */
router.post("/:id/mark-refunded", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = normStr(req.params.id);
  const mode = upper(req.body?.mode || "AUTO");
  const note = normStr(req.body?.note) || null;

  const payoutInput = {
    accountName: normStr(req.body?.payout?.accountName ?? req.body?.accountName),
    accountNumber: onlyDigits(req.body?.payout?.accountNumber ?? req.body?.accountNumber),
    bankCode: normStr(req.body?.payout?.bankCode ?? req.body?.bankCode),
    bankName: normStr(req.body?.payout?.bankName ?? req.body?.bankName) || null,
  };

  try {
    const out = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          supplierId: true,
          requestedByUserId: true,
          totalAmount: true,
          provider: true,
          providerReference: true,
          providerStatus: true,
        },
      });

      if (!refund) {
        throw new Error("Refund not found");
      }

      const currentStatus = upper(refund.status);

      if (currentStatus === "REFUNDED") {
        return markRefundCompletedTx(tx, {
          refundId: id,
          actorUserId: req.user?.id ?? null,
          note: note || "Reconciled already-refunded record",
          provider: String(refund.provider || "PAYSTACK"),
          providerReference: refund.providerReference ?? null,
          providerStatus: refund.providerStatus ?? "SUCCESS",
          providerPayload: undefined,
        });
      }

      if (!["APPROVED"].includes(currentStatus)) {
        throw new Error(`Cannot mark refunded from status: ${refund.status}`);
      }

      const payment = await getLatestPaidPaymentForRefundTx(tx, refund.orderId);
      if (!payment?.reference) {
        throw new Error("Could not find original paid payment for this refund");
      }

      const refundAmount = Number(refund.totalAmount ?? 0);
      if (!(refundAmount > 0)) {
        throw new Error("Refund amount must be greater than zero");
      }

      let finalProvider = "PAYSTACK";
      let finalProviderReference: string | null = null;
      let finalProviderStatus: string | null = null;
      let finalProviderPayload: any = null;
      let settlementMode: "PROVIDER_REFUND" | "BANK_TRANSFER" | null = null;

      const shouldTryProviderRefund =
        mode === "AUTO" || mode === "PROVIDER_REFUND";

      const shouldAllowBankFallback =
        mode === "AUTO" || mode === "BANK_TRANSFER";

      let providerRefundError: any = null;

      if (shouldTryProviderRefund) {
        try {
          const paystackRefund = await createPaystackRefundForPayment({
            paymentReference: String(payment.reference),
            amount: refundAmount,
            note,
            refundId: refund.id,
          });

          settlementMode = "PROVIDER_REFUND";
          finalProvider = "PAYSTACK";
          finalProviderReference = String(
            paystackRefund?.reference ??
            paystackRefund?.transaction_reference ??
            paystackRefund?.id ??
            payment.reference
          );
          finalProviderStatus = String(
            paystackRefund?.status ?? "SUCCESS"
          ).toUpperCase();
          finalProviderPayload = paystackRefund;
        } catch (e: any) {
          providerRefundError = e;
          if (!shouldAllowBankFallback) {
            throw new Error(
              e?.response?.data?.message ||
              e?.response?.data?.error ||
              e?.message ||
              "Paystack refund failed"
            );
          }
        }
      }

      if (!settlementMode && shouldAllowBankFallback) {
        if (
          !payoutInput.accountName ||
          !payoutInput.accountNumber ||
          !payoutInput.bankCode
        ) {
          const baseError =
            providerRefundError?.response?.data?.message ||
            providerRefundError?.response?.data?.error ||
            providerRefundError?.message ||
            null;

          throw new Error(
            baseError
              ? `Provider refund failed (${baseError}) and no customer bank fallback details were supplied`
              : "Customer bank fallback details are required for bank transfer refund"
          );
        }

        const recipient = await ensureCustomerRefundRecipientCodeTx(tx, {
          refundId: refund.id,
          userId: String(payment.order?.userId || refund.requestedByUserId),
          accountName: payoutInput.accountName,
          accountNumber: payoutInput.accountNumber,
          bankCode: payoutInput.bankCode,
          bankName: payoutInput.bankName,
        });

        const transfer = await initiateCustomerRefundTransferTx(tx, {
          refundId: refund.id,
          userId: String(payment.order?.userId || refund.requestedByUserId),
          amount: refundAmount,
          recipientCode: recipient.recipientCode,
          note,
        });

        settlementMode = "BANK_TRANSFER";
        finalProvider = "PAYSTACK_TRANSFER";
        finalProviderReference = transfer.transferReference;
        finalProviderStatus = String(transfer.transferStatus || "PENDING").toUpperCase();
        finalProviderPayload = transfer.raw;
      }

      if (!settlementMode) {
        throw new Error("Refund settlement mode could not be determined");
      }

      const completed = await markRefundCompletedTx(tx, {
        refundId: refund.id,
        actorUserId: req.user?.id ?? null,
        note:
          note ||
          (settlementMode === "PROVIDER_REFUND"
            ? "Refund completed via Paystack refund"
            : "Refund completed via Paystack transfer"),
        provider: finalProvider,
        providerReference: finalProviderReference,
        providerStatus: finalProviderStatus,
        providerPayload: finalProviderPayload,
      });

      return {
        ...completed,
        settlementMode,
      };
    });

    const refundMeta = out.meta;

    if (!out.alreadyRefunded) {
      if (refundMeta.requestedByUserId) {
        await notifyUser(refundMeta.requestedByUserId, {
          type: "REFUND_STATUS_CHANGED",
          title: "Refund completed",
          body: `Your refund for order ${refundMeta.orderId} has been completed.`,
          data: {
            refundId: refundMeta.id,
            orderId: refundMeta.orderId,
            purchaseOrderId: refundMeta.purchaseOrderId ?? null,
            status: "REFUNDED",
          },
        });
      }

      if (refundMeta.supplierId) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: refundMeta.supplierId },
          select: { userId: true, name: true },
        });

        if (supplier?.userId) {
          await notifyUser(supplier.userId, {
            type: "REFUND_STATUS_CHANGED",
            title: "Refund completed",
            body: `A refund has been completed for order ${refundMeta.orderId}.`,
            data: {
              refundId: refundMeta.id,
              orderId: refundMeta.orderId,
              purchaseOrderId: refundMeta.purchaseOrderId ?? null,
              status: "REFUNDED",
            },
          });
        }
      }

      const adminUserIds = await getAdminUserIds();
      await notifyMany(adminUserIds, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund completed",
        body: `Refund completed for order ${refundMeta.orderId}.`,
        data: {
          refundId: refundMeta.id,
          orderId: refundMeta.orderId,
          purchaseOrderId: refundMeta.purchaseOrderId ?? null,
          status: "REFUNDED",
        },
      });
    }

    return res.json({
      ok: true,
      data: out.refund,
      meta: {
        alreadyRefunded: out.alreadyRefunded,
        purchaseOrderUpdated: out.purchaseOrderUpdated,
        allocationsUpdated: out.allocationsUpdated,
        settlementMode: (out as any).settlementMode ?? "PROVIDER_REFUND",
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error:
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to mark refund as refunded",
    });
  }
});

router.post("/:id/reconcile", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = normStr(req.params.id);

  try {
    const out = await prisma.$transaction(async (tx) => {
      await reconcileRefundSideEffectsTx(tx, {
        refundId: id,
        actorUserId: req.user?.id ?? null,
        note: "Manual reconciliation",
      });

      const refund = await tx.refund.findUnique({
        where: { id },
        include: {
          purchaseOrder: {
            select: {
              id: true,
              status: true,
              payoutStatus: true,
            },
          },
        },
      });

      return refund;
    });

    return res.json({
      ok: true,
      data: out,
      meta: {
        reconciled: true,
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error: e?.message || "Failed to reconcile refund",
    });
  }
});

/**
 * GET /api/refunds/:id/payout-details
 * Customer sees own payout details for this refund.
 * Admin can also view.
 */
router.get("/:id/payout-details", requireAuth, async (req: any, res) => {
  const refundId = normStr(req.params.id);
  const actorId = normStr(req.user?.id);
  const actorRole = normRole(req.user?.role);

  if (!refundId) {
    return res.status(400).json({ error: "Missing refund id" });
  }
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const refund = await getRefundForPayoutAccessTx(tx, refundId);
      if (!refund) throw new Error("Refund not found");

      if (!canEditRefundPayoutDetails({ actorId, actorRole, refund })) {
        const err: any = new Error("Forbidden");
        err.status = 403;
        throw err;
      }

      const payout = await tx.customerRefundPayout.findUnique({
        where: { refundId },
        select: {
          id: true,
          refundId: true,
          userId: true,
          accountName: true,
          accountNumber: true,
          bankCode: true,
          bankName: true,
          recipientCode: true,
          transferReference: true,
          transferStatus: true,
          providerPayload: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { refund, payout };
    });

    return res.json({
      ok: true,
      data: out.payout
        ? {
          id: out.payout.id,
          refundId: out.payout.refundId,
          userId: out.payout.userId,
          accountName: out.payout.accountName,
          accountNumberMasked: maskAccountNumber(out.payout.accountNumber),
          bankCode: out.payout.bankCode,
          bankName: out.payout.bankName,
          recipientCode: out.payout.recipientCode,
          transferReference: out.payout.transferReference,
          transferStatus: out.payout.transferStatus,
          createdAt: out.payout.createdAt,
          updatedAt: out.payout.updatedAt,
        }
        : null,
    });
  } catch (e: any) {
    return res.status(e?.status || 400).json({
      error: e?.message || "Failed to fetch refund payout details",
    });
  }
});


async function handleUpsertRefundPayoutDetails(req: any, res: any) {
  const refundId = normStr(req.params.id);
  const actorId = normStr(req.user?.id);
  const actorRole = normRole(req.user?.role);

  if (!refundId) {
    return res.status(400).json({ error: "Missing refund id" });
  }
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const accountName = normStr(req.body?.accountName);
  const accountNumber = onlyDigits(req.body?.accountNumber);
  const bankCode = normStr(req.body?.bankCode);
  const bankName = normStr(req.body?.bankName) || null;

  if (!accountName) {
    return res.status(400).json({ error: "accountName is required" });
  }
  if (!accountNumber || accountNumber.length < 10) {
    return res.status(400).json({ error: "Valid accountNumber is required" });
  }
  if (!bankCode) {
    return res.status(400).json({ error: "bankCode is required" });
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const refund = await getRefundForPayoutAccessTx(tx, refundId);
      if (!refund) throw new Error("Refund not found");

      if (!canEditRefundPayoutDetails({ actorId, actorRole, refund })) {
        const err: any = new Error("Forbidden");
        err.status = 403;
        throw err;
      }

      const payoutUserId = isAdmin(actorRole)
        ? String(refund.requestedByUserId || actorId)
        : actorId;

      const saved = await upsertCustomerRefundPayoutTx(tx, {
        refundId,
        userId: payoutUserId,
        accountName,
        accountNumber,
        bankCode,
        bankName,
      });

      await tx.refundEvent.create({
        data: {
          refundId,
          type: "CUSTOMER_PAYOUT_DETAILS_CAPTURED",
          message: "Customer refund payout details saved",
          meta: {
            actorUserId: actorId,
            actorRole,
            bankCode,
            bankName,
            accountName,
            accountNumberMasked: maskAccountNumber(accountNumber),
          },
        },
      });

      return { refund, saved };
    });

    return res.json({
      ok: true,
      data: {
        id: out.saved.id,
        refundId: out.saved.refundId,
        userId: out.saved.userId,
        accountName: out.saved.accountName,
        accountNumberMasked: maskAccountNumber(out.saved.accountNumber),
        bankCode: out.saved.bankCode,
        bankName: out.saved.bankName,
        recipientCode: out.saved.recipientCode,
        transferReference: out.saved.transferReference,
        transferStatus: out.saved.transferStatus,
        createdAt: out.saved.createdAt,
        updatedAt: out.saved.updatedAt,
      },
    });
  } catch (e: any) {
    return res.status(e?.status || 400).json({
      error: e?.message || "Failed to save refund payout details",
    });
  }
}

router.post("/:id/payout-details", requireAuth, handleUpsertRefundPayoutDetails);
router.put("/:id/payout-details", requireAuth, handleUpsertRefundPayoutDetails);


export default router;