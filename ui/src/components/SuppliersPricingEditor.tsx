import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

/* ---------- types ---------- */
type Supplier = {
  id: string;
  name: string;
  contactEmail?: string | null;
  whatsappPhone?: string | null;
};

type Variant = {
  id: string;
  sku: string;
};

type Offer = {
  id: string;
  supplierId: string;
  productId: string;
  variantId?: string | null;

  unitPrice: number | string;
  currency: string; // e.g. 'NGN'
  inStock: boolean;
  leadDays?: number | null;
  isActive: boolean;

  // Optional if backend expands relations
  variant?: { id: string; sku?: string | null } | null;
};

const fmtMoney = (n: number, cur = "NGN") => {
  try {
    return new Intl.NumberFormat(cur === "NGN" ? "en-NG" : undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${cur} ${n.toLocaleString()}`;
  }
};

/* ---------- component ---------- */
export function SuppliersPricingEditor({
  productId,
  variants: variantsProp, // <-- optional variants from parent
  readOnly = false,
}: {
  productId: string;
  variants?: Variant[];
  readOnly?: boolean;
}) {
  const qc = useQueryClient();

  // Fetch offers for THIS productId
  const offersQ = useQuery<Offer[]>({
    queryKey: ["admin", "products", productId, "offers"],
    enabled: !!productId,
    queryFn: async () => {
      // ✅ Cookie auth: no Authorization header
      const { data } = await api.get<{ data: Offer[] }>(`/api/admin/products/${productId}/offers`);
      return Array.isArray((data as any)?.data) ? (data as any).data : [];
    },
    staleTime: 30_000,
  });

  // Fetch suppliers (for dropdown)
  const suppliersQ = useQuery<Supplier[]>({
    queryKey: ["admin", "suppliers", "for-offers"],
    queryFn: async () => {
      // ✅ Cookie auth: no Authorization header
      const { data } = await api.get<{ data: Supplier[] }>(`/api/admin/suppliers`);
      return Array.isArray((data as any)?.data) ? (data as any).data : [];
    },
    staleTime: 60_000,
  });

  // Fetch variants only if parent didn't pass them
  const variantsQ = useQuery<Variant[]>({
    queryKey: ["admin", "products", productId, "variants"],
    enabled: !!productId && !variantsProp,
    queryFn: async () => {
      // ✅ Cookie auth: no Authorization header
      const { data } = await api.get<{ data: Variant[] }>(`/api/admin/products/${productId}/variants`);
      return Array.isArray((data as any)?.data) ? (data as any).data : [];
    },
    staleTime: 60_000,
  });

  const variants = variantsProp ?? variantsQ.data ?? [];
  const suppliers = suppliersQ.data || [];
  const offers = offersQ.data || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "products", productId, "offers"] });
  };

  /* ---------- mutations ---------- */
  const createOffer = useMutation({
    mutationFn: async (payload: Partial<Offer>) => {
      // ✅ Cookie auth: no Authorization header
      const { data } = await api.post(`/api/admin/products/${productId}/offers`, payload);
      return data;
    },
    onSuccess: invalidate,
  });

  const updateOffer = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<Offer> & { id: string }) => {
      // ✅ Cookie auth: no Authorization header
      const { data } = await api.put(`/api/admin/products/${productId}/offers/${id}`, payload);
      return data;
    },
    onSuccess: invalidate,
  });

  const deleteOffer = useMutation({
    mutationFn: async (id: string) => {
      // ✅ Cookie auth: no Authorization header
      const { data } = await api.delete(`/api/admin/products/${productId}/offers/${id}`);
      return data;
    },
    onSuccess: invalidate,
  });

  /* ---------- add row state ---------- */
  const [newOffer, setNewOffer] = useState<{
    supplierId?: string;
    variantId?: string | null;
    price?: string; // UI field
    currency?: string;
    inStock?: boolean;
    leadDays?: number | "";
    isActive?: boolean;
  }>({
    currency: "NGN",
    inStock: true,
    isActive: true,
  });

  const cheapest = useMemo(() => {
    if (!offers.length) return null;
    const cand = offers.filter((o) => o.isActive && o.inStock);
    if (!cand.length) return null;
    return cand.slice().sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice))[0];
  }, [offers]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="grow">
          <div className="text-sm text-ink-soft">
            Managing supplier offers for <span className="font-mono">{productId}</span>
          </div>
          {cheapest && (
            <div className="text-xs text-emerald-700 mt-1">
              Cheapest active:{" "}
              <b>{suppliers.find((s) => s.id === cheapest.supplierId)?.name || cheapest.supplierId}</b>
              {" • "}
              {fmtMoney(Number(cheapest.unitPrice), cheapest.currency || "NGN")}
              {(() => {
                const vSku = cheapest.variant?.sku || variants.find((v) => v.id === cheapest.variantId)?.sku;
                return vSku ? ` (SKU ${vSku})` : "";
              })()}
            </div>
          )}
        </div>
      </div>

      {/* table */}
      <div className="rounded-xl border overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-3 py-2">Supplier</th>
              <th className="text-left px-3 py-2">Scope</th>
              <th className="text-left px-3 py-2">Price</th>
              <th className="text-left px-3 py-2">Stock</th>
              <th className="text-left px-3 py-2">Lead (days)</th>
              <th className="text-left px-3 py-2">Active</th>
              {!readOnly && <th className="text-right px-3 py-2">Actions</th>}
            </tr>
          </thead>

          <tbody className="divide-y">
            {offersQ.isLoading && (
              <tr>
                <td className="px-3 py-3" colSpan={7}>
                  Loading…
                </td>
              </tr>
            )}

            {!offersQ.isLoading && offers.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-zinc-500" colSpan={7}>
                  No supplier offers yet.
                </td>
              </tr>
            )}

            {offers.map((of) => {
              const sup = suppliers.find((s) => s.id === of.supplierId);
              const sku = of.variant?.sku || variants.find((v) => v.id === of.variantId)?.sku;
              const priceN = Number(of.unitPrice);
              return (
                <tr key={of.id}>
                  <td className="px-3 py-2">{sup?.name || of.supplierId}</td>
                  <td className="px-3 py-2">{sku ? `Variant: ${sku}` : "Product-wide"}</td>
                  <td className="px-3 py-2">{fmtMoney(priceN, of.currency || "NGN")}</td>
                  <td className="px-3 py-2">{of.inStock ? "In stock" : "Out"}</td>
                  <td className="px-3 py-2">{of.leadDays ?? "—"}</td>
                  <td className="px-3 py-2">{of.isActive ? "Yes" : "No"}</td>

                  {!readOnly && (
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          className="rounded-lg border px-3 py-1.5 hover:bg-black/5"
                          onClick={() =>
                            updateOffer.mutate({
                              id: of.id,
                              isActive: !of.isActive,
                            })
                          }
                        >
                          {of.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          className="rounded-lg border px-3 py-1.5 hover:bg-black/5 text-rose-700"
                          onClick={() => {
                            if (confirm("Delete this offer?")) deleteOffer.mutate(of.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {!readOnly && (
              <tr className="bg-zinc-50/40">
                <td className="px-3 py-2">
                  <select
                    className="border rounded-lg px-2 py-1 w-44"
                    value={newOffer.supplierId || ""}
                    onChange={(e) => setNewOffer((o) => ({ ...o, supplierId: e.target.value || undefined }))}
                  >
                    <option value="">Select supplier…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="px-3 py-2">
                  <select
                    className="border rounded-lg px-2 py-1 w-44"
                    value={newOffer.variantId || ""}
                    onChange={(e) => setNewOffer((o) => ({ ...o, variantId: e.target.value || undefined }))}
                  >
                    <option value="">Product-wide</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <select
                      className="border rounded-lg px-2 py-1"
                      value={newOffer.currency || "NGN"}
                      onChange={(e) => setNewOffer((o) => ({ ...o, currency: e.target.value }))}
                    >
                      <option value="NGN">NGN</option>
                      <option value="USD">USD</option>
                    </select>

                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="border rounded-lg px-2 py-1 w-28"
                      value={newOffer.price ?? ""}
                      onChange={(e) => setNewOffer((o) => ({ ...o, price: e.target.value }))} // ✅ FIX
                    />
                  </div>
                </td>

                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!newOffer.inStock}
                    onChange={(e) => setNewOffer((o) => ({ ...o, inStock: e.target.checked }))}
                  />
                </td>

                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className="border rounded-lg px-2 py-1 w-24"
                    value={newOffer.leadDays ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNewOffer((o) => ({ ...o, leadDays: v === "" ? "" : Number(v) }));
                    }}
                  />
                </td>

                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!newOffer.isActive}
                    onChange={(e) => setNewOffer((o) => ({ ...o, isActive: e.target.checked }))}
                  />
                </td>

                <td className="px-3 py-2 text-right">
                  <button
                    className="rounded-lg bg-zinc-900 text-white px-3 py-1.5 disabled:opacity-50"
                    disabled={createOffer.isPending}
                    onClick={() => {
                      if (!newOffer.supplierId || !newOffer.price) {
                        alert("Supplier and price are required");
                        return;
                      }

                      createOffer.mutate(
                        {
                          supplierId: newOffer.supplierId,
                          variantId: newOffer.variantId || undefined,
                          unitPrice: Number(newOffer.price),
                          currency: newOffer.currency || "NGN",
                          inStock: !!newOffer.inStock,
                          leadDays: newOffer.leadDays === "" ? undefined : Number(newOffer.leadDays),
                          isActive: !!newOffer.isActive,
                        },
                        {
                          onSuccess: () => {
                            setNewOffer({
                              currency: "NGN",
                              inStock: true,
                              isActive: true,
                            });
                          },
                        }
                      );
                    }}
                  >
                    {createOffer.isPending ? "Adding…" : "Add offer"}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
