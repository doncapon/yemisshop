// src/jobs/payoutRelease.job.ts
import { prisma } from "../lib/prisma.js";
import { SupplierPaymentStatus } from "@prisma/client";

const OPEN_REFUND_REQUEST_STATUSES = [
  "REQUESTED",
  "SUPPLIER_REVIEW",
  "SUPPLIER_ACCEPTED",
  "ESCALATED",
  "APPROVED",
] as const;

const OPEN_DISPUTE_STATUSES = ["OPEN", "SUPPLIER_RESPONSE", "ESCALATED"] as const;

const OPEN_REFUND_STATUSES = [
  "REQUESTED",
  "SUPPLIER_REVIEW",
  "SUPPLIER_ACCEPTED",
  "ESCALATED",
  "APPROVED",
] as const;

const DEFAULT_BATCH_SIZE = 25;
const MAX_DETAIL_ROWS = 100;

function asDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
}

function pushDetail(
  summary: {
    details: Array<{
      allocationId: string;
      purchaseOrderId: string | null;
      action: "released" | "skipped" | "failed";
      reason?: string;
    }>;
  },
  row: {
    allocationId: string;
    purchaseOrderId: string | null;
    action: "released" | "skipped" | "failed";
    reason?: string;
  }
) {
  if (summary.details.length < MAX_DETAIL_ROWS) {
    summary.details.push(row);
  }
}

function isSupplierPayoutReady(s: {
  isPayoutEnabled?: boolean | null;
  accountNumber?: string | null;
  accountName?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  bankCountry?: string | null;
  bankVerificationStatus?: string | null;
}) {
  const enabled = s.isPayoutEnabled !== false;
  const accNum = !!(s.accountNumber ?? null);
  const accName = !!(s.accountName ?? null);
  const bank = !!(s.bankCode ?? s.bankName ?? null);
  const country = s.bankCountry == null ? true : !!s.bankCountry;
  const verified = s.bankVerificationStatus === "VERIFIED";

  return enabled && verified && accNum && accName && bank && country;
}

async function getOtpVerifiedSetForPOs(purchaseOrderIds: string[]): Promise<Set<string>> {
  if (!purchaseOrderIds.length) return new Set<string>();

  const rows = await prisma.purchaseOrderDeliveryOtp.findMany({
    where: {
      purchaseOrderId: { in: purchaseOrderIds },
      verifiedAt: { not: null },
    },
    select: {
      purchaseOrderId: true,
    },
  });

  return new Set(rows.map((r) => String(r.purchaseOrderId)));
}

async function getBlockedPOIds(purchaseOrderIds: string[]): Promise<Set<string>> {
  if (!purchaseOrderIds.length) return new Set<string>();

  const [refundRequests, disputes, refunds] = await Promise.all([
    prisma.refundRequest.findMany({
      where: {
        purchaseOrderId: { in: purchaseOrderIds },
        status: { in: [...OPEN_REFUND_REQUEST_STATUSES] as any },
      },
      select: { purchaseOrderId: true },
    }),
    prisma.disputeCase.findMany({
      where: {
        purchaseOrderId: { in: purchaseOrderIds },
        status: { in: [...OPEN_DISPUTE_STATUSES] as any },
      },
      select: { purchaseOrderId: true },
    }),
    prisma.refund.findMany({
      where: {
        purchaseOrderId: { in: purchaseOrderIds },
        status: { in: [...OPEN_REFUND_STATUSES] as any },
      },
      select: { purchaseOrderId: true },
    }),
  ]);

  const blocked = new Set<string>();

  for (const row of refundRequests) blocked.add(String(row.purchaseOrderId));
  for (const row of disputes) blocked.add(String(row.purchaseOrderId));
  for (const row of refunds) blocked.add(String(row.purchaseOrderId));

  return blocked;
}

type ReleaseSummary = {
  scanned: number;
  released: number;
  skipped: number;
  failed: number;
  details: Array<{
    allocationId: string;
    purchaseOrderId: string | null;
    action: "released" | "skipped" | "failed";
    reason?: string;
  }>;
};

export async function releaseDueHeldPayoutsOnce(batchSize = DEFAULT_BATCH_SIZE): Promise<ReleaseSummary> {
  const now = new Date();

  const summary: ReleaseSummary = {
    scanned: 0,
    released: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const dueAllocs = await prisma.supplierPaymentAllocation.findMany({
    where: {
      status: "HELD" as SupplierPaymentStatus,
      holdUntil: { lte: now },
      purchaseOrderId: { not: null },
    },
    orderBy: [{ holdUntil: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(batchSize, 100)),
    select: {
      id: true,
      supplierId: true,
      orderId: true,
      paymentId: true,
      purchaseOrderId: true,
      amount: true,
      holdUntil: true,
      createdAt: true,
      purchaseOrder: {
        select: {
          id: true,
          supplierId: true,
          status: true,
          payoutStatus: true,
          paidOutAt: true,
          payoutHoldUntil: true,
          deliveredAt: true,
          supplier: {
            select: {
              id: true,
              isPayoutEnabled: true,
              accountNumber: true,
              accountName: true,
              bankCode: true,
              bankName: true,
              bankCountry: true,
              bankVerificationStatus: true,
            },
          },
        },
      },
    },
  });

  summary.scanned = dueAllocs.length;

  if (!dueAllocs.length) {
    return summary;
  }

  const purchaseOrderIds = dueAllocs
    .map((a) => String(a.purchaseOrderId ?? ""))
    .filter(Boolean);

  const [blockedPOIds, otpVerifiedPOIds] = await Promise.all([
    getBlockedPOIds(purchaseOrderIds),
    getOtpVerifiedSetForPOs(purchaseOrderIds),
  ]);

  for (const alloc of dueAllocs) {
    try {
      const poId = alloc.purchaseOrderId ? String(alloc.purchaseOrderId) : null;

      if (!poId) {
        summary.failed++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: null,
          action: "failed",
          reason: "allocation_has_no_purchase_order",
        });
        continue;
      }

      const po = alloc.purchaseOrder;
      if (!po) {
        summary.failed++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: poId,
          action: "failed",
          reason: "purchase_order_not_found",
        });
        continue;
      }

      const poStatus = String(po.status || "").toUpperCase();
      if (poStatus !== "DELIVERED") {
        summary.skipped++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: poId,
          action: "skipped",
          reason: `po_not_delivered_${poStatus.toLowerCase()}`,
        });
        continue;
      }

      const latestHoldUntil = asDate(alloc.holdUntil);
      if (latestHoldUntil && latestHoldUntil > now) {
        summary.skipped++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: poId,
          action: "skipped",
          reason: "hold_not_due",
        });
        continue;
      }

      const hasDeliveryProof = !!po.deliveredAt || otpVerifiedPOIds.has(poId);
      if (!hasDeliveryProof) {
        summary.skipped++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: poId,
          action: "skipped",
          reason: "no_delivery_proof",
        });
        continue;
      }

      if (blockedPOIds.has(poId)) {
        summary.skipped++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: poId,
          action: "skipped",
          reason: "open_complaint_or_refund",
        });
        continue;
      }

      if (!po.supplier || !isSupplierPayoutReady(po.supplier)) {
        summary.skipped++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: poId,
          action: "skipped",
          reason: "supplier_not_payout_ready",
        });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const latestAlloc = await tx.supplierPaymentAllocation.findUnique({
          where: { id: alloc.id },
          select: {
            id: true,
            status: true,
            releasedAt: true,
            holdUntil: true,
            purchaseOrderId: true,
          },
        });

        if (!latestAlloc) {
          const err: any = new Error("allocation_disappeared");
          err.code = "ALLOC_MISSING";
          throw err;
        }

        if (latestAlloc.status === SupplierPaymentStatus.PAID) {
          const err: any = new Error("already_paid");
          err.code = "ALREADY_PAID";
          throw err;
        }

        if (latestAlloc.status !== SupplierPaymentStatus.HELD) {
          const err: any = new Error(`status_${String(latestAlloc.status).toLowerCase()}`);
          err.code = "STATUS_CHANGED";
          throw err;
        }

        const latestAllocHoldUntil = asDate(latestAlloc.holdUntil);
        if (latestAllocHoldUntil && latestAllocHoldUntil > now) {
          const err: any = new Error("hold_not_due");
          err.code = "HOLD_NOT_DUE";
          throw err;
        }

        const releasedAt = new Date();

        await tx.supplierPaymentAllocation.update({
          where: { id: latestAlloc.id },
          data: {
            status: SupplierPaymentStatus.PAID,
            releasedAt,
            holdUntil: null,
          } as any,
        });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            payoutStatus: "RELEASED" as any,
            paidOutAt: releasedAt,
            payoutHoldUntil: null,
          },
        });
      });

      summary.released++;
      pushDetail(summary, {
        allocationId: alloc.id,
        purchaseOrderId: poId,
        action: "released",
      });
    } catch (err: any) {
      const reason = String(err?.message || "unknown_error");

      if (
        reason === "already_paid" ||
        reason === "hold_not_due" ||
        reason.startsWith("status_")
      ) {
        summary.skipped++;
        pushDetail(summary, {
          allocationId: alloc.id,
          purchaseOrderId: alloc.purchaseOrderId ? String(alloc.purchaseOrderId) : null,
          action: "skipped",
          reason,
        });
        continue;
      }

      summary.failed++;
      pushDetail(summary, {
        allocationId: alloc.id,
        purchaseOrderId: alloc.purchaseOrderId ? String(alloc.purchaseOrderId) : null,
        action: "failed",
        reason,
      });
    }
  }

  return summary;
}