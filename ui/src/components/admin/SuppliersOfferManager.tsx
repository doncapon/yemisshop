import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";

type VariantLite = { id: string; sku?: string | null };
type SupplierLite = { id: string; name: string };

type SupplierOffer = {
  id: string;
  supplierId: string;
  supplierName?: string;
  productId: string;
  variantId?: string | null;

  price: number | string;      // Decimal from API; render as number
  currency?: string;
  leadDays?: number | null;

  isActive: boolean;
  inStock: boolean;            // DB flag (may be stale)
  availableQty: number;        // <- authoritative

  createdAt?: string;
  updatedAt?: string;
};

function toInt(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : d;
}
function toMoney(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

const headersFor = (token?: string | null) =>
  token ? { Authorization: `Bearer ${token}` } : undefined;

function buildBodies(patch: any) {
  return [
    patch,                         // { ...fields }
    { data: patch },               // { data: { ...fields } }
    { ...patch, id: patch?.id },   // sometimes APIs want id echoed
  ];
}

async function tryMany<T>(fns: Array<() => Promise<T>>): Promise<T> {
  let lastErr: any;
  for (const fn of fns) {
    try { return await fn(); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function pickVariantId(o: any) {
  return (
    o.variantId ??
    o.productVariantId ??
    o.variant_id ??
    o.variant?.id ??
    null
  );
}
function pickSupplierName(o: any) {
  return o.supplier?.name ?? o.supplierName ?? o.supplier_name ?? "";
}

/** Fan out variantId so whatever the API expects will be present */
function withVariantAliases(patch: Partial<SupplierOffer>) {
  const vid = patch.variantId;
  if (vid === undefined) return patch;
  return {
    ...patch,
    variantId: vid,
    productVariantId: vid,
    variant_id: vid,
  };
}

/** Some APIs want fields omitted rather than null/"" */
function stripNullish<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const k in obj) {
    const v = obj[k];
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

export default function SuppliersOfferManager({
  productId,
  variants,
  suppliers,
  token,
  readOnly,
}: {
  productId: string;
  variants: VariantLite[];
  suppliers: SupplierLite[];
  token?: string | null;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const hdr = headersFor(token);

  /* ---------- Query: list offers for this product ---------- */
  const listQ = useQuery<SupplierOffer[]>({
    queryKey: ["admin", "supplier-offers", { productId }],
    enabled: !!productId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const tries = [
        `/api/admin/products/${productId}/supplier-offers`,
        `/api/admin/supplier-offers?productId=${encodeURIComponent(productId)}`,
        `/api/products/${productId}/supplier-offers`,
      ];
      for (const url of tries) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
          if (Array.isArray(arr)) {
            // normalize and ensure numbers
            return arr.map((o: any) => ({
              id: String(o.id),
              supplierId: String(o.supplierId ?? o.supplier_id ?? o.supplier?.id ?? ""),
              supplierName: pickSupplierName(o),
              productId: String(o.productId ?? o.product_id ?? o.product?.id ?? productId),
              variantId: pickVariantId(o),

              price: toMoney(o.price),
              currency: o.currency ?? "NGN",
              leadDays: o.leadDays ?? o.lead_days ?? null,

              isActive: Boolean(o.isActive ?? o.active),
              inStock: Boolean(o.inStock ?? o.in_stock),
              availableQty: toInt(o.availableQty ?? o.available_qty ?? o.qty_available, 0),

              createdAt: o.createdAt ?? o.created_at,
              updatedAt: o.updatedAt ?? o.updated_at,
            })) as SupplierOffer[];
          }
        } catch {
          /* try next */
        }
      }
      return [];
    },
  });

  /* ---------- Mutations (resilient) ---------- */
  const createM = useMutation({
    mutationFn: async (payload: Partial<SupplierOffer>) => {
      // Authoritative stock flag from availableQty
      const availableQty = toInt(payload.availableQty, 0);
      const base = {
        ...payload,
        productId,
        inStock: availableQty > 0,
        price: toMoney(payload.price),
        currency: payload.currency || "NGN",
      };
      const body = stripNullish(withVariantAliases(base));

      const hdr = headersFor(token);

      const urls: string[] = [
        // per-product first
        `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
        `/api/products/${encodeURIComponent(productId)}/supplier-offers`,
        // flat fallback
        `/api/admin/supplier-offers`,
        `/api/supplier-offers`,
      ];

      const bodies = buildBodies(body);

      return await tryMany(
        urls.flatMap((u) => bodies.map((b) => () => api.post(u, b, { headers: hdr })))
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "supplier-offers", { productId }] });
      // keep the rest of the UI fresh (avail sums, lists)
      qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] });
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
  });

  const updateM = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SupplierOffer> }) => {
      // keep inStock consistent with quantity
      const avail = patch.availableQty != null ? toInt(patch.availableQty, 0) : undefined;
      const base = avail == null ? patch : { ...patch, inStock: avail > 0 };
      const body = stripNullish(withVariantAliases(base));

      const hdr = headersFor(token);
      const idsafe = encodeURIComponent(id);
      const pid = encodeURIComponent(productId);

      const urls: string[] = [
        // per-product first
        `/api/admin/products/${pid}/supplier-offers/${idsafe}`,
        `/api/products/${pid}/supplier-offers/${idsafe}`,
        // flat resource
        `/api/admin/supplier-offers/${idsafe}`,
        `/api/supplier-offers/${idsafe}`,
        // some APIs expose a separate /status path
        `/api/admin/products/${pid}/supplier-offers/${idsafe}/status`,
        `/api/admin/supplier-offers/${idsafe}/status`,
        `/api/supplier-offers/${idsafe}/status`,
      ];

      const bodies = buildBodies(body);
      const methods: Array<"patch" | "put" | "post"> = ["patch", "put", "post"];

      return await tryMany(
        urls.flatMap((u) =>
          methods.flatMap((m) => bodies.map((b) => () => api[m](u, b, { headers: hdr })))
        )
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "supplier-offers", { productId }] });
      qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] });
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const hdr = headersFor(token);
      const idsafe = encodeURIComponent(id);
      const pid = encodeURIComponent(productId);

      const urls: string[] = [
        `/api/admin/products/${pid}/supplier-offers/${idsafe}`,
        `/api/products/${pid}/supplier-offers/${idsafe}`,
        `/api/admin/supplier-offers/${idsafe}`,
        `/api/supplier-offers/${idsafe}`,
      ];

      return await tryMany(urls.map((u) => () => api.delete(u, { headers: hdr })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "supplier-offers", { productId }] });
      qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] });
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
  });

  /* ---------- Local edit state ---------- */
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, Partial<SupplierOffer>>>({});
  const [addDraft, setAddDraft] = React.useState<Partial<SupplierOffer>>({
    supplierId: suppliers[0]?.id,
    variantId: null,
    price: 0,
    currency: "NGN",
    availableQty: 0,
    leadDays: undefined,
    isActive: true,
  });

  function startEdit(offer: SupplierOffer) {
    setOpenId(offer.id);
    setDrafts((d) => ({
      ...d,
      [offer.id]: {
        supplierId: offer.supplierId,
        variantId: offer.variantId ?? null,
        price: Number(offer.price),
        currency: offer.currency ?? "NGN",
        availableQty: Number(offer.availableQty),
        leadDays: offer.leadDays ?? undefined,
        isActive: offer.isActive,
        // do NOT carry inStock; we will derive and set on save
      },
    }));
  }
  function changeDraft(id: string, patch: Partial<SupplierOffer>) {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }));
  }
  function cancelEdit() {
    setOpenId(null);
  }

  /* ---------- UI helpers ---------- */
  const ngn = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  });
  const variantLabel = (vId?: string | null) =>
    vId ? (variants.find((v) => v.id === vId)?.sku || vId) : "—";

  /* ---------- Repair mismatched inStock flags (optional button) ---------- */
  const repairM = useMutation({
    mutationFn: async () => {
      const offers = listQ.data ?? [];
      const mismatches = offers.filter((o) => (o.availableQty > 0) !== o.inStock);
      await Promise.all(
        mismatches.map((o) =>
          api.patch(
            `/api/admin/supplier-offers/${o.id}`,
            { inStock: o.availableQty > 0 },
            { headers: hdr }
          )
        )
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "supplier-offers", { productId }] }),
  });

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="font-semibold">Supplier offers</h4>
          <p className="text-xs text-zinc-600">
            Manage price, <b>availableQty</b>, variant links, activity and lead time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-lg border"
            onClick={() =>
              setAddDraft({
                supplierId: suppliers[0]?.id,
                variantId: null,
                price: 0,
                currency: "NGN",
                availableQty: 0,
                leadDays: undefined,
                isActive: true,
              })
            }
            disabled={readOnly}
            title="Prepare a new offer below"
          >
            Add Offer
          </button>

          <button
            className="px-3 py-1.5 rounded-lg border"
            onClick={() => repairM.mutate()}
            disabled={repairM.isPending || readOnly}
            title="Force inStock = availableQty > 0 for all offers"
          >
            {repairM.isPending ? "Repairing…" : "Repair stock flags"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-3 py-2">Supplier</th>
              <th className="text-left px-3 py-2">Variant</th>
              <th className="text-left px-3 py-2">Price</th>
              <th className="text-left px-3 py-2">Avail.</th>
              <th className="text-left px-3 py-2">Stock</th>
              <th className="text-left px-3 py-2">Active</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {/* Existing offers */}
            {(listQ.data ?? []).map((o) => {
              const editing = openId === o.id;
              const d = drafts[o.id] || {};
              const computedInStock = (o.availableQty ?? 0) > 0; // <- authoritative

              return (
                <React.Fragment key={o.id}>
                  <tr>
                    <td className="px-3 py-2">{o.supplierName || (suppliers.find(s => s.id === o.supplierId)?.name) || "—"}</td>
                    <td className="px-3 py-2">{variantLabel(o.variantId)}</td>
                    <td className="px-3 py-2">{ngn.format(toMoney(o.price))}</td>
                    <td className="px-3 py-2">{toInt(o.availableQty, 0)}</td>

                    {/* Stock cell derived solely from availableQty */}
                    <td className="px-3 py-2">
                      {computedInStock ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-600" />
                          In
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700">
                          <span className="inline-block w-2 h-2 rounded-full bg-rose-600" />
                          Out
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2">{o.isActive ? "Yes" : "No"}</td>

                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          className="px-2 py-1 rounded border"
                          onClick={() => startEdit(o)}
                          disabled={readOnly}
                        >
                          Edit
                        </button>
                        <button
                          className="px-2 py-1 rounded bg-rose-600 text-white"
                          onClick={() => {
                            if (!readOnly && confirm("Delete this offer?")) deleteM.mutate(o.id);
                          }}
                          disabled={deleteM.isPending || readOnly}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>

                  {editing && (
                    <tr className="bg-zinc-50/50">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="grid md:grid-cols-6 gap-2 items-center">
                          <select
                            className="border rounded-lg px-2 py-1"
                            value={d.supplierId ?? o.supplierId}
                            onChange={(e) => changeDraft(o.id, { supplierId: e.target.value })}
                          >
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>

                          <select
                            className="border rounded-lg px-2 py-1"
                            value={(d.variantId ?? o.variantId) ?? ""}
                            onChange={(e) =>
                              changeDraft(o.id, { variantId: e.target.value || null })
                            }
                          >
                            <option value="">— base product —</option>
                            {variants.map((v) => (
                              <option key={v.id} value={v.id}>{v.sku || v.id}</option>
                            ))}
                          </select>

                          <input
                            className="border rounded-lg px-2 py-1"
                            placeholder="Price"
                            inputMode="decimal"
                            value={String(d.price ?? o.price ?? "")}
                            onChange={(e) => changeDraft(o.id, { price: e.target.value })}
                          />

                          <input
                            className="border rounded-lg px-2 py-1"
                            placeholder="Avail."
                            inputMode="numeric"
                            value={String(d.availableQty ?? o.availableQty ?? 0)}
                            onChange={(e) => changeDraft(o.id, { availableQty: toInt(e.target.value, 0) })}
                            title="Available quantity (authoritative for stock)"
                          />

                          <input
                            className="border rounded-lg px-2 py-1"
                            placeholder="Lead days"
                            inputMode="numeric"
                            value={String(d.leadDays ?? (o.leadDays ?? ""))}
                            onChange={(e) => changeDraft(o.id, { leadDays: toInt(e.target.value, 0) })}
                          />

                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(d.isActive ?? o.isActive)}
                              onChange={(e) => changeDraft(o.id, { isActive: e.target.checked })}
                            />
                            Active
                          </label>
                        </div>

                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button className="px-3 py-1.5 rounded-lg border" onClick={cancelEdit}>
                            Cancel
                          </button>
                          <button
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white"
                            onClick={() => {
                              const patch = drafts[o.id] || {};
                              const avail = toInt(patch.availableQty ?? o.availableQty, 0);
                              updateM.mutate({ id: o.id, patch: { ...patch, inStock: avail > 0 } });
                              setOpenId(null);
                            }}
                            disabled={updateM.isPending}
                          >
                            {updateM.isPending ? "Saving…" : "Save"}
                          </button>

                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* Add row */}
            <tr className="bg-white">
              <td className="px-3 py-2">
                <select
                  className="border rounded-lg px-2 py-1 w-full"
                  value={addDraft.supplierId ?? ""}
                  onChange={(e) => setAddDraft((d) => ({ ...d, supplierId: e.target.value }))}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <select
                  className="border rounded-lg px-2 py-1 w-full"
                  value={(addDraft.variantId ?? "") as any}
                  onChange={(e) =>
                    setAddDraft((d) => ({ ...d, variantId: e.target.value || null }))
                  }
                >
                  <option value="">— base product —</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.sku || v.id}</option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <input
                  className="border rounded-lg px-2 py-1 w-full"
                  placeholder="Price"
                  inputMode="decimal"
                  value={String(addDraft.price ?? "")}
                  onChange={(e) =>
                    setAddDraft((d) => ({ ...d, price: e.target.value }))
                  }
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className="border rounded-lg px-2 py-1 w-full"
                  placeholder="Avail."
                  inputMode="numeric"
                  value={String(addDraft.availableQty ?? 0)}
                  onChange={(e) =>
                    setAddDraft((d) => ({ ...d, availableQty: toInt(e.target.value, 0) }))
                  }
                  title="Available quantity (authoritative for stock)"
                />
              </td>
              <td className="px-3 py-2">
                {/* Display-only preview of computed stock */}
                {toInt(addDraft.availableQty, 0) > 0 ? "In" : "Out"}
              </td>
              <td className="px-3 py-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(addDraft.isActive)}
                    onChange={(e) => setAddDraft((d) => ({ ...d, isActive: e.target.checked }))}
                  />
                  Active
                </label>
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                  onClick={() => {
                    const payload = {
                      ...addDraft,
                      // ensure server gets consistent flag
                      inStock: toInt(addDraft.availableQty, 0) > 0,
                      price: toMoney(addDraft.price),
                      currency: addDraft.currency || "NGN",
                      productId,
                    };
                    createM.mutate(payload);
                  }}
                  disabled={createM.isPending || !addDraft.supplierId}
                >
                  {createM.isPending ? "Adding…" : "Add"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
