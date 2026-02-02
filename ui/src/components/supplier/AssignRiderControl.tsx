import React, { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";

type RiderRow = {
  id: string;
  name?: string | null;
  phone?: string | null;
  isActive: boolean;
  user?: { email?: string | null; firstName?: string | null; lastName?: string | null };
};

export function AssignRiderControl({
  purchaseOrderId,
  currentRiderId,
  disabled,
}: {
  purchaseOrderId: string;
  currentRiderId?: string | null;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string>(currentRiderId ?? "");
  const [msg, setMsg] = useState<{ type: "info" | "error"; text: string } | null>(null);

  // keep local select in sync if parent changes currentRiderId after refetch
  useEffect(() => {
    setSel(currentRiderId ?? "");
  }, [currentRiderId]);

  const ridersQ = useQuery({
    queryKey: ["supplierRiders"],
    queryFn: async () => {
      const { data } = await api.get("/api/riders");
      return (data?.data ?? []) as RiderRow[];
    },
  });

  const assignM = useMutation({
    mutationFn: async () => {
      const chosen = String(sel ?? "").trim();

      // ✅ block "Unassigned" submit
      if (!chosen) {
        const err: any = new Error("Please select a rider before assigning.");
        err.code = "NO_RIDER_SELECTED";
        throw err;
      }

      const { data } = await api.patch(
        `/api/supplier/orders/purchase-orders/${purchaseOrderId}/assign-rider`,
        { riderId: chosen }
      );

      return data?.data;
    },
    onSuccess: () => {
      setMsg({ type: "info", text: "Rider assigned." });
      qc.invalidateQueries({ queryKey: ["supplierOrders"] });
      qc.invalidateQueries({ queryKey: ["supplier", "orders"] }); // in case your list uses this key
    },
    onError: (err: any) => {
      const text =
        err?.code === "NO_RIDER_SELECTED"
          ? String(err?.message || "Please select a rider.")
          : String(err?.response?.data?.error || err?.message || "Failed to assign rider");
      setMsg({ type: "error", text });
    },
  });

  const riders = useMemo(() => (ridersQ.data ?? []).filter((r) => r.isActive), [ridersQ.data]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          className="rounded-xl border px-3 py-2 text-sm bg-white"
          value={sel}
          onChange={(e) => {
            setSel(e.target.value);
            if (msg?.type === "error") setMsg(null); // clear error once user changes selection
          }}
          disabled={disabled || ridersQ.isLoading}
          title="Assign rider"
        >
          <option value="">Select a rider…</option>
          {riders.map((r) => {
            const label =
              r.name ||
              `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() ||
              r.user?.email ||
              r.id;
            return (
              <option key={r.id} value={r.id}>
                {label}
              </option>
            );
          })}
        </select>

        <button
          type="button"
          onClick={() => {
            setMsg(null);

            // ✅ quick pre-check (so mutation doesn't even start)
            if (!String(sel ?? "").trim()) {
              setMsg({ type: "error", text: "Please select a rider before assigning." });
              return;
            }

            assignM.mutate();
          }}
          disabled={disabled || assignM.isPending}
          className="rounded-xl border px-3 py-2 text-sm font-semibold bg-black text-white disabled:opacity-50"
        >
          {assignM.isPending ? "Saving…" : "Assign"}
        </button>
      </div>

      {msg?.text ? (
        <div className={`text-[11px] ${msg.type === "error" ? "text-rose-700" : "text-emerald-700"}`}>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
