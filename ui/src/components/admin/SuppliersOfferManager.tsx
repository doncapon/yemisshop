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

function normalizeOffer(w: OfferWire | any): RowDraft {
  const rawVariantId =
    w.variantId ??
    w.variant_id ??
    (typeof w.variant === "string" ? w.variant : w.variant?.id);

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
  _productId: string,
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
        (typeof o.variant === "string" ? o.variant : o.variant?.id);
      const sku =
        o.variantSku ?? o.variant?.sku ?? (vid && m.get(String(vid)));
      if (vid && sku) {
        m.set(String(vid), String(sku));
      }
    });

    return m;
  }, [variants, offersQ.data]);

  /* Helpers */
  const makeBlankDraft = (): RowDraft => ({
    supplierId: suppliers[0]?.id ?? "",
    variantId: null,
    price: "",
    availableQty: "",
    isActive: true,
    leadDays: "",
    notes: "",
  });

  /* Local edits for existing rows */
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

  /* Draft rows for new offers */
  const [drafts, setDrafts] = useState<RowDraft[]>([makeBlankDraft()]);

  const onDraftChange = (index: number, patch: Partial<RowDraft>) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => {
      if (prev.length === 1) {
        // If it's the only one, reset instead of removing
        return [makeBlankDraft()];
        }
      return prev.filter((_, i) => i !== index);
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
      alert(
        e?.message || "Failed to delete offer",
      ),
  });

  /* Save-all implementation (sequential for clearer failures) */
  const [saving, setSaving] = useState(false);

  async function saveAllInternal() {
    if (readOnly || saving) return;
    setSaving(true);

    try {
      const editedExisting = Object.values(edits).filter(
        (d) => !!d.id && !!d.supplierId
      );

      const createCandidates = drafts
        .map((d) => ({
          ...d,
          supplierId: d.supplierId?.trim(),
          price: d.price?.trim(),
          availableQty: d.availableQty?.trim(),
        }))
        .filter(
          (d) =>
            d.supplierId &&
            d.price !== "" &&
            d.availableQty !== ""
        );

      if (editedExisting.length === 0 && createCandidates.length === 0) {
        alert( "No changes to save.",
        );
        return;
      }

      const errors: string[] = [];
      let updated = 0;
      let created = 0;

      // Run updates sequentially
      for (const d of editedExisting) {
        try {
          await updateM.mutateAsync({ ...d, id: d.id! });
          updated += 1;
        } catch (e: any) {
          console.error("Update failed for offer", d.id, e);
          const msg =
            e?.response?.data?.error ||
            e?.message ||
            "Failed to update an offer.";
          errors.push(msg);
        }
      }

      // Run creates sequentially
      for (const d of createCandidates) {
        try {
          await createM.mutateAsync(d);
          created += 1;
        } catch (e: any) {
          console.error("Create failed for draft", d, e);
          const msg =
            e?.response?.data?.error ||
            e?.message ||
            "Failed to create an offer.";
          errors.push(msg);
        }
      }

      if (errors.length > 0) {
        alert(
            errors.length === 1
              ? errors[0]
              : `Some changes failed:\n- ${errors.join("\n- ")}`,
        );
      } else {
        alert(`Saved ${updated} update${updated === 1 ? "" : "s"}${
            created
              ? ` and ${created} new offer${created === 1 ? "" : "s"}`
              : ""
          }.`,
        );
        setEdits({});
        setDrafts([makeBlankDraft()]);
        await invalidateAll();
        onChanged?.();
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
        // Safety: block any accidental form submit bubbling
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

            {!offersQ.isLoading &&
              rows.length === 0 &&
              drafts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-zinc-500">
                    No supplier offers yet.
                  </td>
                </tr>
              )}

            {/* Existing offers */}
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
                        type="button"
                        className="px-2 py-1 rounded bg-rose-600 text-white text-xs"
                        onClick={() => {
                          if (readOnly) return;
                          deleteM.mutate(r.id!);
                        }}
                        disabled={
                          readOnly || deleteM.isPending || saving
                        }
                        title="Delete"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}

            {/* Draft offers */}
            {!readOnly &&
              drafts.map((d, index) => {
                const hasContent =
                  (d.price && d.price.trim() !== "") ||
                  (d.availableQty && d.availableQty.trim() !== "") ||
                  (d.leadDays && d.leadDays.trim() !== "") ||
                  (d.notes && d.notes.trim() !== "");
                return (
                  <tr key={`draft-${index}`} className="bg-zinc-50/40">
                    <td className="px-3 py-2">
                      <select
                        className="border rounded-lg px-2 py-1 w-48"
                        value={d.supplierId}
                        onChange={(e) =>
                          onDraftChange(index, {
                            supplierId: e.target.value,
                          })
                        }
                      >
                        {suppliers.map((s, i) => (
                          <option
                            key={s.id || `${s.name}-${i}`}
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
                        value={d.variantId ?? ""}
                        onChange={(e) =>
                          onDraftChange(index, {
                            variantId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">— None (generic) —</option>
                        {variants.map((v, i) => {
                          const key = v.id || v.sku || `variant-${i}`;
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
                        value={d.price}
                        onChange={(e) =>
                          onDraftChange(index, {
                            price: e.target.value,
                          })
                        }
                      />
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {ngn.format(toNum(d.price, 0))}
                      </div>
                    </td>

                    <td className="px-3 py-2 text-right">
                      <input
                        className="border rounded-lg px-2 py-1 w-24 text-right"
                        inputMode="numeric"
                        value={d.availableQty}
                        onChange={(e) =>
                          onDraftChange(index, {
                            availableQty: e.target.value,
                          })
                        }
                      />
                    </td>

                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!d.isActive}
                        onChange={(e) =>
                          onDraftChange(index, {
                            isActive: e.target.checked,
                          })
                        }
                      />
                    </td>

                    <td className="px-3 py-2 text-right">
                      <input
                        className="border rounded-lg px-2 py-1 w-20 text-right"
                        inputMode="numeric"
                        value={d.leadDays ?? ""}
                        onChange={(e) =>
                          onDraftChange(index, {
                            leadDays: e.target.value,
                          })
                        }
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        className="border rounded-lg px-2 py-1 w-64"
                        value={d.notes ?? ""}
                        onChange={(e) =>
                          onDraftChange(index, {
                            notes: e.target.value,
                          })
                        }
                      />
                    </td>

                    <td className="px-3 py-2 text-right">
                      {(hasContent || drafts.length > 1) && (
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-rose-50 text-rose-600 text-xs"
                          onClick={() => removeDraft(index)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

            {/* Add-offer button row */}
            {!readOnly && (
              <tr className="bg-zinc-50/60">
                <td colSpan={8} className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((prev) => [...prev, makeBlankDraft()])
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-dashed border-emerald-500 text-emerald-700 text-xs hover:bg-emerald-50"
                  >
                    + Add offer
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      {!offersQ.isLoading && rows.length > 0 && (
        <div className="mt-3 text-xs text-ink-soft">
          <strong>{rows.length}</strong>{" "}
          offer{rows.length === 1 ? "" : "s"} • Total available (active only):{" "}
          {rows
            .filter((r) => r.isActive)
            .reduce((s, r) => s + toInt(r.availableQty, 0), 0)
            .toLocaleString()}
        </div>
      )}

      {/* Save all button */}
      {!readOnly && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void saveAllInternal()}
            disabled={saving || createM.isPending || updateM.isPending}
            className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save all changes"}
          </button>
        </div>
      )}
    </div>
  );
});

export default SuppliersOfferManager;
