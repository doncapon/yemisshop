import React, { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { AxiosError } from "axios";

type RiderRow = {
  id: string;
  name?: string | null;
  phone?: string | null;
  isActive?: boolean | null;
  active?: boolean | null;
  status?: string | null;
  user?: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
};

function toRiderArray(payload: any): RiderRow[] {
  if (Array.isArray(payload)) return payload as RiderRow[];
  if (Array.isArray(payload?.data)) return payload.data as RiderRow[];
  if (Array.isArray(payload?.data?.items)) return payload.data.items as RiderRow[];
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows as RiderRow[];
  if (Array.isArray(payload?.data?.results)) return payload.data.results as RiderRow[];
  if (Array.isArray(payload?.items)) return payload.items as RiderRow[];
  if (Array.isArray(payload?.rows)) return payload.rows as RiderRow[];
  if (Array.isArray(payload?.results)) return payload.results as RiderRow[];
  return [];
}

function isRiderActive(r: RiderRow) {
  if (typeof r?.isActive === "boolean") return r.isActive;
  if (typeof r?.active === "boolean") return r.active;

  const status = String(r?.status ?? "")
    .trim()
    .toUpperCase();

  if (!status) return true;
  if (["INACTIVE", "DISABLED", "SUSPENDED", "BLOCKED"].includes(status)) return false;
  return true;
}

function riderLabel(r: RiderRow) {
  return (
    r.name ||
    `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() ||
    r.user?.email ||
    r.phone ||
    r.id
  );
}

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
  const [searchParams] = useSearchParams();

  const supplierId = String(searchParams.get("supplierId") ?? "").trim() || undefined;

  const [sel, setSel] = useState<string>(currentRiderId ?? "");
  const [msg, setMsg] = useState<{ type: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    setSel(currentRiderId ?? "");
  }, [currentRiderId]);

  const ridersQ = useQuery<RiderRow[]>({
    queryKey: ["supplierRiders", supplierId ?? null],
    queryFn: async () => {
      const { data } = await api.get("/api/riders", {
        withCredentials: true,
        params: supplierId ? { supplierId } : undefined,
      });
      return toRiderArray(data);
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const assignM = useMutation({
    mutationFn: async () => {
      const chosen = String(sel ?? "").trim();

      if (!chosen) {
        const err: any = new Error("Please select a rider before assigning.");
        err.code = "NO_RIDER_SELECTED";
        throw err;
      }

      const { data } = await api.patch(
        `/api/supplier/orders/purchase-orders/${purchaseOrderId}/assign-rider`,
        { riderId: chosen },
        {
          withCredentials: true,
          params: supplierId ? { supplierId } : undefined,
        }
      );

      return data?.data ?? data;
    },
    onSuccess: async () => {
      setMsg({ type: "info", text: "Rider assigned." });
      await qc.invalidateQueries({ queryKey: ["supplierOrders"] });
      await qc.invalidateQueries({ queryKey: ["supplier", "orders"] });
      await qc.invalidateQueries({ queryKey: ["supplierRiders"] });
    },
    onError: (err: any) => {
      const e = err as AxiosError<any>;
      const text =
        err?.code === "NO_RIDER_SELECTED"
          ? String(err?.message || "Please select a rider.")
          : String(
              e?.response?.data?.error ||
                e?.response?.data?.message ||
                e?.message ||
                "Failed to assign rider"
            );
      setMsg({ type: "error", text });
    },
  });

  const riders = useMemo(() => {
    const rows = Array.isArray(ridersQ.data) ? ridersQ.data : [];
    return rows.filter((r) => r && String(r.id || "").trim() && isRiderActive(r));
  }, [ridersQ.data]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="min-w-[220px] rounded-xl border px-3 py-2 text-sm bg-white"
          value={sel}
          onChange={(e) => {
            setSel(e.target.value);
            if (msg?.type === "error") setMsg(null);
          }}
          disabled={disabled || ridersQ.isLoading}
          title="Assign rider"
        >
          <option value="">
            {ridersQ.isLoading
              ? "Loading riders…"
              : ridersQ.isError
                ? "Failed to load riders"
                : riders.length === 0
                  ? "No riders found"
                  : "Select a rider…"}
          </option>

          {riders.map((r) => (
            <option key={r.id} value={r.id}>
              {riderLabel(r)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            setMsg(null);
            if (!String(sel ?? "").trim()) {
              setMsg({ type: "error", text: "Please select a rider before assigning." });
              return;
            }
            assignM.mutate();
          }}
          disabled={disabled || assignM.isPending || ridersQ.isLoading}
          className="rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {assignM.isPending ? "Saving…" : "Assign"}
        </button>

        <Link
          to={
            supplierId
              ? `/supplier/riders?supplierId=${encodeURIComponent(supplierId)}`
              : "/supplier/riders"
          }
          className={[
            "inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold",
            "hover:bg-black/5 active:scale-[0.99] transition",
            disabled ? "pointer-events-none opacity-60" : "",
          ].join(" ")}
          title="Create a new rider"
        >
          <Plus size={16} />
          Add rider
        </Link>
      </div>

      {!ridersQ.isLoading && !ridersQ.isError && riders.length === 0 ? (
        <div className="text-[11px] text-amber-700">
          No active riders were returned by the API.
        </div>
      ) : null}

      {ridersQ.isError && !msg ? (
        <div className="text-[11px] text-rose-700">Failed to load riders.</div>
      ) : null}

      {msg?.text ? (
        <div
          className={`text-[11px] ${
            msg.type === "error" ? "text-rose-700" : "text-emerald-700"
          }`}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}