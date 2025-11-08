import * as React from "react";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { useModal } from "../ModalProvider";

/* ===========================
   Types expected by parent
=========================== */
export type VariantLite = { id: string; sku?: string | null };
export type SupplierLite = { id: string; name: string };

/* Expose a handle the parent can call */
export type SuppliersOfferManagerHandle = {
  saveAll: () => Promise<void>;
};

/* ===========================
   Local types
=========================== */
type OfferWire = {
  id: string;
  productId: string;
  supplierId: string;
  supplierName?: string;
  variantId?: string | null;
  variantSku?: string | null;
  sku?: string | null;
  price?: number | string | null;
  availableQty?: number | string | null;
  available?: number | string | null;
  qty?: number | string | null;
  stock?: number | string | null;
  isActive?: boolean | string | null;
  inStock?: boolean | string | null;
  leadDays?: number | string | null;
  notes?: string | null;
};

type RowDraft = {
  id?: string; // present = existing row
  supplierId: string;
  variantId: string | null;
  price: string;
  availableQty: string;
  isActive: boolean;
  leadDays?: string;
  notes?: string; // local only
};

type SuppliersOfferManagerProps = {
  productId: string;
  variants: VariantLite[];
  suppliers: SupplierLite[];
  token?: string | null;
  readOnly?: boolean;
  onChanged?: () => void;
};

/* ===========================
   Helpers
=========================== */
const toInt = (x: any, d = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
};
const toNum = (x: any, d = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
};
const truthy = (v: any, def = true) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|1|yes|y)$/i.test(v.trim());
  if (v == null) return def;
  return Boolean(v);
};
const availOf = (o: any) =>
  toInt(o?.availableQty ?? o?.available ?? o?.qty ?? o?.stock, 0);
const priceOf = (o: any) => toNum(o?.price, 0);

/**
 * Normalize a supplier-offer row into our RowDraft shape.
 * Be tolerant of different backend shapes for variant reference.
 */
function normalizeOffer(w: OfferWire | any): RowDraft {
  const rawVariantId =
    w.variantId ??
    w.variant_id ??
    (typeof w.variant === "string"
      ? w.variant
      : w.variant?.id);

  return {
    id: String(w.id),
    supplierId: String(w.supplierId),
    variantId: rawVariantId ? String(rawVariantId) : null,
    price: String(priceOf(w)),
    availableQty: String(availOf(w)),
    isActive: truthy(w.isActive, true),
    leadDays: w.leadDays != null ? String(w.leadDays) : "",
    notes: w.notes ?? "",
  };
}

/* ===========================
   API
=========================== */

async function listOffers(
  productId: string,
  token?: string | null
): Promise<OfferWire[]> {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const { data } = await api.get(
    `/api/admin/products/${productId}/supplier-offers`,
    { headers }
  );

  const arr = Array.isArray(data?.data) ? data.data : [];
  return arr as OfferWire[];
}

async function createOffer(
  productId: string,
  payload: any,
  token?: string | null
) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await api.post(
    `/api/admin/products/${productId}/supplier-offers`,
    payload,
    { headers }
  );
  return (res as any).data ?? res;
}

async function updateOffer(
  _productId: string, // kept for call sites, not used
  offerId: string,
  payload: any,
  token?: string | null
) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await api.patch(
    `/api/admin/supplier-offers/${offerId}`,
    payload,
    { headers }
  );
  return (res as any).data ?? res;
}

async function deleteOffer(
  productId: string,
  offerId: string,
  token?: string | null
) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await api.delete(
    `/api/admin/products/${productId}/supplier-offers/${offerId}`,
    { headers }
  );
  return (res as any).data ?? res;
}

/* ===========================
   Component
=========================== */

const SuppliersOfferManager = forwardRef<
  SuppliersOfferManagerHandle,
  SuppliersOfferManagerProps
>(({ productId, variants, suppliers, token, readOnly, onChanged }, ref) => {
  const { openModal } = useModal();
  const qc = useQueryClient();

  /* Load existing offers */
  const offersQ = useQuery({
    queryKey: ["admin", "products", productId, "supplier-offers"],
    enabled: !!productId,
    queryFn: async () => {
      const list = await listOffers(productId, token);
      return list.map(normalizeOffer);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = offersQ.data ?? [];

  /* Lookups */
  const variantSkuById = useMemo(() => {
    const m = new Map<string, string>();

    (variants || []).forEach((v) => {
      if (v?.id) m.set(String(v.id), v.sku || v.id);
    });

    (offersQ.data || []).forEach((o: any) => {
      const vid =
        o.variantId ??
        o.variant_id ??
        (typeof o.variant === "string"
          ? o.variant
          : o.variant?.id);
      const sku =
        o.variantSku ??
        o.variant?.sku ??
        (vid && m.get(String(vid)));
      if (vid && sku) {
        m.set(String(vid), String(sku));
      }
    });

    return m;
  }, [variants, offersQ.data]);

  /* New row */
  const [newRow, setNewRow] = useState<RowDraft>({
    supplierId: suppliers[0]?.id ?? "",
    variantId: null,
    price: "",
    availableQty: "",
    isActive: true,
    leadDays: "",
    notes: "",
  });

  /* Local edits */
  const [edits, setEdits] = useState<Record<string, RowDraft>>({});

  const mergeRow = (serverRow: RowDraft): RowDraft => {
    const draft = edits[serverRow.id!];
    if (!draft) return serverRow;
    return { ...serverRow, ...draft, id: serverRow.id };
  };

  const onEditChange = (id: string, patch: Partial<RowDraft>) => {
    setEdits((prev) => {
      const base: RowDraft =
        prev[id] ||
        (rows.find((r) => r.id === id) as RowDraft) || {
          id,
          supplierId: "",
          variantId: null,
          price: "",
          availableQty: "",
          isActive: true,
        };
      const next: RowDraft = { ...base, ...patch, id };
      return { ...prev, [id]: next };
    });
  };

  /* Mutations */

  const invalidateAll = async () => {
    await qc.invalidateQueries({
      queryKey: ["admin", "products", productId, "supplier-offers"],
    });
  };

  const createM = useMutation({
    mutationFn: async (draft: RowDraft) => {
      const payload = {
        productId,
        supplierId: draft.supplierId,
        variantId: draft.variantId || null,
        price: toNum(draft.price, 0),
        availableQty: toInt(draft.availableQty, 0),
        isActive: !!draft.isActive,
        leadDays:
          draft.leadDays != null && draft.leadDays !== ""
            ? toInt(draft.leadDays, 0)
            : undefined,
      };
      return await createOffer(productId, payload, token);
    },
  });

  const updateM = useMutation({
    mutationFn: async (draft: RowDraft) => {
      if (!draft.id) throw new Error("Missing offer id");
      const payload: any = {
        supplierId: draft.supplierId,
        variantId: draft.variantId || null,
        price: toNum(draft.price, 0),
        availableQty: toInt(draft.availableQty, 0),
        isActive: !!draft.isActive,
      };
      if (draft.leadDays != null && draft.leadDays !== "") {
        payload.leadDays = toInt(draft.leadDays, 0);
      }
      return await updateOffer(productId, draft.id!, payload, token);
    },
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => await deleteOffer(productId, id, token),
    onSuccess: async (_r, id) => {
      setEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await invalidateAll();
    },
    onError: (e: any) =>
      openModal({
        title: "Supplier Offers",
        message: e?.message || "Failed to delete offer",
      }),
  });

  /* Save-all implementation */
  const [saving, setSaving] = useState(false);
  async function saveAllInternal() {
    if (readOnly) return;
    setSaving(true);

    try {
      const editedExisting = Object.values(edits).filter(
        (d) => !!d.id && !!d.supplierId
      );

      const createCandidate =
        newRow.supplierId &&
          newRow.price.trim() !== "" &&
          newRow.availableQty.trim() !== ""
          ? { ...newRow }
          : null;

      const ops: Array<Promise<any>> = [];

      for (const d of editedExisting) {
        ops.push(
          updateM.mutateAsync({
            ...d,
            id: d.id!,
          })
        );
      }

      if (createCandidate) {
        ops.push(createM.mutateAsync(createCandidate));
      }

      const results = await Promise.allSettled(ops);
      const failed = results.filter((r) => r.status === "rejected");
      const created = createCandidate ? 1 : 0;
      const updated = editedExisting.length;

      if (failed.length > 0) {
        const reason = (failed[0] as PromiseRejectedResult).reason as any;
        openModal({
          title: "Supplier Offers",
          message:
            (reason?.response?.data?.error as string) ||
            reason?.message ||
            `Some changes failed to save (${failed.length}/${results.length}).`,
        });
      } else {
        alert(`Saved ${updated} update${updated === 1 ? "" : "s"}${created ? ` and ${created} new offer` : "" }.`,
        );
        setEdits({});
        // (optionally also reset newRow here if you want)
      }
    } finally {
      setSaving(false);
    }
  }


  useImperativeHandle(ref, () => ({
    saveAll: () => saveAllInternal(),
  }));

  /* Formatting */
  const ngn = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  });

  /* Render */
  return (
    <div
      className="p-4 md:p-5"
      onSubmitCapture={(e) => {
        // safety: if any nested element ever acts like a form submit,
        // don't let it bubble and reload / remount the page.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-3 py-2">Supplier</th>
              <th className="text-left px-3 py-2">Variant</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">Available</th>
              <th className="text-center px-3 py-2">Active</th>
              <th className="text-right px-3 py-2">Lead (days)</th>
              <th className="text-left px-3 py-2">Notes</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {offersQ.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-zinc-500">
                  Loading offers…
                </td>
              </tr>
            )}

            {!offersQ.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-zinc-500">
                  No supplier offers yet.
                </td>
              </tr>
            )}

            {!offersQ.isLoading &&
              rows.map((serverRow) => {
                const r = mergeRow(serverRow);
                return (
                  <tr key={r.id}>
                    {/* Supplier */}
                    <td className="px-3 py-2">
                      <select
                        className="border rounded-lg px-2 py-1 w-48"
                        value={r.supplierId}
                        onChange={(e) =>
                          onEditChange(r.id!, {
                            supplierId: e.target.value,
                          })
                        }
                        disabled={readOnly}
                      >
                        {suppliers.map((s, index) => (
                          <option
                            key={s.id || `${s.name}-${index}`}
                            value={s.id}
                          >
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Variant */}
                    <td className="px-3 py-2">
                      <select
                        className="border rounded-lg px-2 py-1 w-48"
                        value={r.variantId ?? ""}
                        onChange={(e) =>
                          onEditChange(r.id!, {
                            variantId: e.target.value || null,
                          })
                        }
                        disabled={readOnly}
                      >
                        <option value="">— None (generic) —</option>
                        {variants.map((v, index) => {
                          const key = v.id || v.sku || `variant-${index}`;
                          return (
                            <option key={key} value={v.id}>
                              {variantSkuById.get(v.id) || v.id || v.sku || key}
                            </option>
                          );
                        })}
                      </select>
                    </td>

                    {/* Price */}
                    <td className="px-3 py-2 text-right">
                      <input
                        className="border rounded-lg px-2 py-1 w-32 text-right"
                        inputMode="decimal"
                        value={r.price}
                        onChange={(e) =>
                          onEditChange(r.id!, {
                            price: e.target.value,
                          })
                        }
                        disabled={readOnly}
                      />
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {ngn.format(toNum(r.price, 0))}
                      </div>
                    </td>

                    {/* Available */}
                    <td className="px-3 py-2 text-right">
                      <input
                        className="border rounded-lg px-2 py-1 w-24 text-right"
                        inputMode="numeric"
                        value={r.availableQty}
                        onChange={(e) =>
                          onEditChange(r.id!, {
                            availableQty: e.target.value,
                          })
                        }
                        disabled={readOnly}
                      />
                    </td>

                    {/* Active */}
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!r.isActive}
                        onChange={(e) =>
                          onEditChange(r.id!, {
                            isActive: e.target.checked,
                          })
                        }
                        disabled={readOnly}
                      />
                    </td>

                    {/* Lead days */}
                    <td className="px-3 py-2 text-right">
                      <input
                        className="border rounded-lg px-2 py-1 w-20 text-right"
                        inputMode="numeric"
                        value={r.leadDays ?? ""}
                        onChange={(e) =>
                          onEditChange(r.id!, {
                            leadDays: e.target.value,
                          })
                        }
                        disabled={readOnly}
                      />
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-2">
                      <input
                        className="border rounded-lg px-2 py-1 w-64"
                        value={r.notes ?? ""}
                        onChange={(e) =>
                          onEditChange(r.id!, {
                            notes: e.target.value,
                          })
                        }
                        disabled={readOnly}
                      />
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2 text-right">
                      <button
                        className="px-2 py-1 rounded bg-rose-600 text-white"
                        onClick={() => {
                          if (readOnly) return;
                          deleteM.mutate(r.id!);
                        }}
                        disabled={
                          readOnly ||
                          deleteM.isPending ||
                          saving
                        }
                        title="Delete"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}

            {/* New row */}
            <tr className="bg-zinc-50/50">
              <td className="px-3 py-2">
                <select
                  className="border rounded-lg px-2 py-1 w-48"
                  value={newRow.supplierId}
                  onChange={(e) =>
                    setNewRow((n) => ({
                      ...n,
                      supplierId: e.target.value,
                    }))
                  }
                  disabled={readOnly}
                >
                  {suppliers.map((s, index) => (
                    <option
                      key={s.id || `${s.name}-${index}`}
                      value={s.id}
                    >
                      {s.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <select
                  className="border rounded-lg px-2 py-1 w-48"
                  value={newRow.variantId ?? ""}
                  onChange={(e) =>
                    setNewRow((n) => ({
                      ...n,
                      variantId: e.target.value || null,
                    }))
                  }
                  disabled={readOnly}
                >
                  <option value="">— None (generic) —</option>
                  {variants.map((v, index) => {
                    const key = v.id || v.sku || `variant-${index}`;
                    return (
                      <option key={key} value={v.id}>
                        {variantSkuById.get(v.id) || v.id || v.sku || key}
                      </option>
                    );
                  })}
                </select>
              </td>
              <td className="px-3 py-2 text-right">
                <input
                  className="border rounded-lg px-2 py-1 w-32 text-right"
                  inputMode="decimal"
                  value={newRow.price}
                  onChange={(e) =>
                    setNewRow((n) => ({
                      ...n,
                      price: e.target.value,
                    }))
                  }
                  disabled={readOnly}
                />
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {ngn.format(toNum(newRow.price, 0))}
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <input
                  className="border rounded-lg px-2 py-1 w-24 text-right"
                  inputMode="numeric"
                  value={newRow.availableQty}
                  onChange={(e) =>
                    setNewRow((n) => ({
                      ...n,
                      availableQty: e.target.value,
                    }))
                  }
                  disabled={readOnly}
                />
              </td>
              <td className="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={!!newRow.isActive}
                  onChange={(e) =>
                    setNewRow((n) => ({
                      ...n,
                      isActive: e.target.checked,
                    }))
                  }
                  disabled={readOnly}
                />
              </td>
              <td className="px-3 py-2 text-right">
                <input
                  className="border rounded-lg px-2 py-1 w-20 text-right"
                  inputMode="numeric"
                  value={newRow.leadDays ?? ""}
                  onChange={(e) =>
                    setNewRow((n) => ({
                      ...n,
                      leadDays: e.target.value,
                    }))
                  }
                  disabled={readOnly}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className="border rounded-lg px-2 py-1 w-64"
                  value={newRow.notes ?? ""}
                  onChange={(e) =>
                    setNewRow((n) => ({
                      ...n,
                      notes: e.target.value,
                    }))
                  }
                  disabled={readOnly}
                />
              </td>
              <td className="px-3 py-2 text-right">
                <span className="text-[11px] text-zinc-400">
                  Use “Save all”
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Totals */}
      {
        !offersQ.isLoading && rows.length > 0 && (
          <div className="mt-3 text-xs text-ink-soft">
            <strong>{rows.length}</strong>{" "}
            offer{rows.length === 1 ? "" : "s"} • Total available (active only):{" "}
            {rows
              .filter((r) => r.isActive)
              .reduce(
                (s, r) => s + toInt(r.availableQty, 0),
                0
              )
              .toLocaleString()}
          </div>
        )
      }

      {/* Save all button */}
      {
        !readOnly && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void saveAllInternal();
              }}
              disabled={saving || createM.isPending || updateM.isPending}
              className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save all changes"}
            </button>

          </div>
        )
      }
    </div >
  );
});

export default SuppliersOfferManager;
