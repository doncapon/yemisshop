import React, { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

type Props = {
  orderId: string;
  purchaseOrderId?: string | null; // optional if you do PO-specific refunds
  onDone?: () => void;
  onClose?: () => void;
};

const reasons = [
  "Item not received",
  "Wrong item delivered",
  "Damaged item",
  "Not as described",
  "Late delivery",
  "Other",
];

export default function CustomerRefundModalContent({
  orderId,
  purchaseOrderId,
  onDone,
  onClose,
}: Props) {
  const { token } = useAuthStore();

  const [reason, setReason] = useState(reasons[0]);
  const [message, setMessage] = useState("");
  const [evidence, setEvidence] = useState(""); // urls comma/newline separated

  const evidenceUrls = useMemo(() => {
    const arr = evidence
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : null;
  }, [evidence]);

  const m = useMutation({
    mutationFn: async () => {
      // ✅ Use the Refund-based endpoint you implement for customers.
      // If you already use /api/refunds for RefundRequest, change accordingly.
      const { data } = await api.post(
        "/api/refunds",
        {
          orderId,
          purchaseOrderId: purchaseOrderId ?? undefined,
          reason,
          message: message || undefined,
          evidenceUrls: evidenceUrls ?? undefined,
        },
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      return data;
    },
    onSuccess: () => {
      onDone?.();
      onClose?.();
    },
  });

  return (
    <div className="space-y-3">
      <div className="text-sm text-zinc-700">
        Request a refund for <b>{orderId}</b>.
      </div>

      <label className="block">
        <div className="text-xs text-zinc-600 mb-1">Reason</div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 bg-white text-sm"
        >
          {reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <div className="text-xs text-zinc-600 mb-1">Message (optional)</div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="w-full border rounded-lg px-3 py-2 bg-white text-sm"
          placeholder="Describe what happened…"
        />
      </label>

      <label className="block">
        <div className="text-xs text-zinc-600 mb-1">Evidence URLs (optional)</div>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={3}
          className="w-full border rounded-lg px-3 py-2 bg-white text-sm"
          placeholder="Paste image/video links (comma or newline separated)"
        />
      </label>

      {m.isError ? (
        <div className="text-sm text-rose-600">
          {(m.error as any)?.response?.data?.error || (m.error as any)?.message || "Failed to submit refund."}
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5 text-sm"
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={m.isPending}
          onClick={() => m.mutate()}
          className="px-3 py-2 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-60 text-sm"
        >
          {m.isPending ? "Submitting…" : "Submit refund"}
        </button>
      </div>
    </div>
  );
}
