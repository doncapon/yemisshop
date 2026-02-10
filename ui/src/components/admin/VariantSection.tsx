import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

/* ---------------- Debounce ---------------- */
function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ---------------- Small helpers ---------------- */
function toInt(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
}
function availOf(o: any): number {
  // tolerate different field names from various endpoints
  const a =
    (o && (o.availableQty ?? o.available ?? o.qty ?? o.stock)) ?? 0;
  return Math.max(0, toInt(a, 0));
}

/* ---------------- Admin product search (debounced) ---------------- */
function useAdminProductSearch(query: string, headers?: Record<string, string>) {
  const q = useDebounced(query, 300);
  return useQuery({
    queryKey: ["admin", "product-search", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const res = await api.get("/api/admin/products/search", { params: { q }, headers });
      const body = res.data;
      return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}

/* ---------------- Attribute & value types (loose) ---------------- */
type AdminAttr = {
  id: string;
  name: string;
  type?: "SELECT" | "MULTISELECT" | "TEXT" | string;
  values?: Array<{ id: string; name: string; code?: string | null; isActive?: boolean }>;
};

/* Build attributeSelections array expected by PATCH /products/:id */
function buildSelectionsFromLinked(linked: Record<string, string[]>) {
  const out: Array<{ attributeId: string; valueId?: string; valueIds?: string[] }> = [];
  for (const [attributeId, list] of Object.entries(linked)) {
    const clean = (list || []).filter(Boolean);
    if (clean.length === 1) out.push({ attributeId, valueId: clean[0] });
    else if (clean.length > 1) out.push({ attributeId, valueIds: clean });
  }
  return out;
}

export function VariantsSection() {
  const [q, setQ] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<null | { id: string; title: string }>(null);

  const [selValues, setSelValues] = useState<Record<string, string>>({});
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  // keep this checkbox for UX, but stock rendering now derives from offers:
  const [inStock, setInStock] = useState(true);

  const [showOptionsManager, setShowOptionsManager] = useState(true);

  // per-attribute local edits in options manager
  const [linked, setLinked] = useState<Record<string, string[]>>({});
  const [addingValueOfAttr, setAddingValueOfAttr] = useState<string | null>(null);
  const [newValueName, setNewValueName] = useState("");
  const [newValueCode, setNewValueCode] = useState("");

  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

  /* ---------------- Search (as you type) ---------------- */
  const searchQ = useAdminProductSearch(selectedProduct ? "" : q, authHeaders);
  const firstResult = (searchQ.data ?? [])[0];
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* ---------------- All attributes (global) ---------------- */
  const attrsAllQ = useQuery<AdminAttr[]>({
    queryKey: ["admin", "attributes", "all"],
    enabled: !!token && !!selectedProduct,
    queryFn: async () => {
      const res = await api.get("/api/admin/catalog/attributes", { headers: authHeaders });
      const body = res.data;
      // expect {data:[...]} or [...]
      return (Array.isArray(body) ? body : body?.data) ?? [];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  /* ---------------- Fetch product details (attributes + variants) ---------------- */
  const productQ = useQuery({
    queryKey: ["admin", "productVariants", selectedProduct?.id],
    enabled: !!token && !!selectedProduct?.id,
    queryFn: async () => {
      const res = await api.get(`/api/admin/products/${selectedProduct!.id}`, {
        params: { include: "attributes,variants" },
        headers: authHeaders,
      });
      const raw = res.data;
      return raw?.data ?? raw;
    },
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  /* ---------------- Fetch supplier offers for this product ---------------- */
  const offersQ = useQuery({
    queryKey: ["admin", "product", selectedProduct?.id, "offers"],
    enabled: !!token && !!selectedProduct?.id,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const pid = selectedProduct!.id;
      const hdr = authHeaders;
      // Try a few endpoints, accept any that returns an array
      const attempts = [
        `/api/admin/products/${pid}/supplier-offers`,
        `/api/products/${pid}/supplier-offers`,
        `/api/admin/supplier-offers?productId=${encodeURIComponent(pid)}`,
        `/api/admin/supplier-offers?productIds=${encodeURIComponent(pid)}`,
      ];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
          if (Array.isArray(arr)) return arr;
        } catch {
          // try next
        }
      }
      return [] as any[];
    },
  });

  // Build availability map per variantId from supplier offers
  const availByVariant: Record<string, number> = useMemo(() => {
    const map: Record<string, number> = {};
    const offers = (offersQ.data ?? []) as any[];
    for (const o of offers) {
      const vId = o.variantId ?? null;
      // we only care about variant rows in this table:
      if (!vId) continue;
      map[vId] = (map[vId] || 0) + availOf(o);
    }
    return map;
  }, [offersQ.data]);

  /* Seed linked map from server-returned selections (if available) */
  useEffect(() => {
    const p = productQ.data as any;
    if (!p) return;

    const map: Record<string, string[]> = {};

    // shape A: attributeSelections: [{attributeId,valueId? valueIds?}]
    if (Array.isArray(p.attributeSelections)) {
      for (const s of p.attributeSelections) {
        if (!s?.attributeId) continue;
        if (s.valueId) map[s.attributeId] = [s.valueId];
        else if (Array.isArray(s.valueIds)) map[s.attributeId] = s.valueIds.filter(Boolean);
      }
    }
    // shape B: attributeValues grouped [{ attribute: {id}, value:{id} }]
    else if (Array.isArray(p.attributeValues)) {
      for (const av of p.attributeValues) {
        const aid = av?.attribute?.id;
        const vid = av?.value?.id;
        if (!aid || !vid) continue;
        map[aid] = [...(map[aid] || []), vid];
      }
    }

    // only set if we actually found something (don’t clobber user edits)
    if (Object.keys(map).length) setLinked(map);
  }, [productQ.data]);

  /* ---------------- Mutations ---------------- */
  // Save the product's allowed options
  const saveOptions = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error("Pick a product first");
      const attributeSelections = buildSelectionsFromLinked(linked);
      await api.patch(
        `/api/admin/products/${selectedProduct.id}`,
        { attributeSelections },
        { headers: authHeaders }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "productVariants", selectedProduct?.id] });
    },
  });

  // Add a new value under an attribute
  const addValue = useMutation({
    mutationFn: async (attrId: string) => {
      const payload = { name: newValueName.trim(), code: newValueCode.trim() || undefined };
      if (!payload.name) throw new Error("Value name is required");
      await api.post(`/api/admin/catalog/attributes/${attrId}/values`, payload, { headers: authHeaders });
    },
    onSuccess: (_d, attrId) => {
      setNewValueName("");
      setNewValueCode("");
      setAddingValueOfAttr(null);
      // refresh attributes list
      qc.invalidateQueries({ queryKey: ["admin", "attributes", "all"] });
      // also refresh product (often mirrors names)
      qc.invalidateQueries({ queryKey: ["admin", "productVariants", selectedProduct?.id] });
      // keep it selected
      setLinked((prev) => ({ ...prev, [attrId]: prev[attrId] || [] }));
    },
  });

  const createVariant = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error("Pick a product first");
      const payload = {
        sku: sku.trim() || null,
        unitPrice: price.trim() ? Number(price) : null,
        // sending inStock is fine for now, but UI will render from offers availability
        inStock,
        optionValues: Object.entries(selValues).map(([attributeId, valueId]) => ({ attributeId, valueId })),
      };
      const { data } = await api.post(`/api/admin/products/${selectedProduct.id}/variants`, payload, { headers: authHeaders });
      return data;
    },
    onSuccess: () => {
      setSelValues({});
      setSku("");
      setPrice("");
      setInStock(true);
      qc.invalidateQueries({ queryKey: ["admin", "productVariants", selectedProduct?.id] });
      // also refresh offers so the availability map reflects any new variant links
      qc.invalidateQueries({ queryKey: ["admin", "product", selectedProduct?.id, "offers"] });
    },
  });

  const updateVariant = useMutation({
    mutationFn: async (v: { id: string; sku?: string | null; unitPrice?: number | null; inStock?: boolean }) => {
      const { data } = await api.put(`/api/admin/variants/${v.id}`, v, { headers: authHeaders });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "productVariants", selectedProduct?.id] });
      qc.invalidateQueries({ queryKey: ["admin", "product", selectedProduct?.id, "offers"] });
    },
  });

  const deleteVariant = useMutation({
    mutationFn: async (variantId: string) => {
      await api.delete(`/api/admin/variants/${variantId}`, { headers: authHeaders });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "productVariants", selectedProduct?.id] });
      qc.invalidateQueries({ queryKey: ["admin", "product", selectedProduct?.id, "offers"] });
    },
  });

  /* ---------------- Attributes visible in the composer ---------------- */
  const attrsForComposer: AdminAttr[] = useMemo(() => {
    const all = attrsAllQ.data ?? [];
    // Use only attributes that are linked on this product
    const ids = Object.keys(linked);
    if (!ids.length) return [];
    return all
      .filter((a) => ids.includes(a.id))
      .map((a) => {
        const allowed = new Set(linked[a.id] || []);
        return {
          ...a,
          values: (a.values || []).filter((v) => allowed.has(v.id)),
        };
      })
      .filter((a) => (a.values?.length ?? 0) > 0);
  }, [attrsAllQ.data, linked]);

  /* ------------- keyboard: Enter picks first search result ------------- */
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !selectedProduct && firstResult) {
      setSelectedProduct(firstResult);
      setQ("");
      e.preventDefault();
    }
  };

  const canCreate =
    !!selectedProduct &&
    attrsForComposer.length > 0 &&
    attrsForComposer.every((a: AdminAttr) => !!selValues[a.id]) &&
    !createVariant.isPending;

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-visible">
      <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
        <div>
          <h3 className="text-ink font-semibold">Variants</h3>
          <p className="text-xs text-ink-soft">First link options to the product, then create variant combinations.</p>
        </div>
      </div>

      <div className="p-4 md:p-5 space-y-5">
        {/* Product picker */}
        <div className="grid md:grid-cols-[1fr_auto] gap-2">
          {!selectedProduct ? (
            <>
              <input
                ref={inputRef}
                className="border rounded-lg px-3 py-2"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search product by name or SKU…"
              />
              <div className="text-sm text-ink-soft self-center">
                {searchQ.isFetching ? "Searching…" : searchQ.isError ? "Failed to search" : ""}
              </div>

              {q && searchQ.data && searchQ.data.length > 0 && (
                <div className="border rounded-lg max-h-64 overflow-auto col-span-full bg-white">
                  {searchQ.data.map((p: any) => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-black/5"
                      onClick={() => { setSelectedProduct(p); setQ(""); }}
                    >
                      <div className="font-medium">{p.title}</div>
                      {p.sku ? <div className="text-xs text-zinc-500">SKU: {p.sku}</div> : null}
                    </button>
                  ))}
                </div>
              )}

              {q && searchQ.isSuccess && (searchQ.data ?? []).length === 0 && (
                <div className="col-span-full text-xs text-ink-soft">No products found.</div>
              )}
            </>
          ) : (
            <div className="col-span-full flex items-center justify-between">
              <div className="text-sm">
                Managing <span className="font-semibold">{selectedProduct.title}</span>
              </div>
              <button
                className="px-2 py-1 rounded border"
                onClick={() => { setSelectedProduct(null); setLinked({}); setSelValues({}); }}
              >
                Change product
              </button>
            </div>
          )}
        </div>

        {/* Options Manager */}
        {!!selectedProduct && (
          <div className="rounded-xl border">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="font-medium">Options Manager</div>
              <button
                className="text-xs underline"
                onClick={() => setShowOptionsManager((s) => !s)}
              >
                {showOptionsManager ? "Hide" : "Show"}
              </button>
            </div>

            {showOptionsManager && (
              <div className="p-3 space-y-4">
                {attrsAllQ.isLoading ? (
                  <div className="text-sm text-ink-soft">Loading attributes…</div>
                ) : (attrsAllQ.data ?? []).length === 0 ? (
                  <div className="text-sm text-ink-soft">
                    No attributes defined yet. Create attributes & values in Catalog Settings.
                  </div>
                ) : (
                  <>
                    {(attrsAllQ.data ?? []).map((a) => {
                      const active = Array.isArray(linked[a.id]);
                      const selected = new Set(linked[a.id] || []);
                      const values = a.values || [];
                      return (
                        <div key={a.id} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={(e) =>
                                  setLinked((prev) => {
                                    const next = { ...prev };
                                    if (e.target.checked) next[a.id] = next[a.id] ?? [];
                                    else delete next[a.id];
                                    return next;
                                  })
                                }
                              />
                              <span className="font-medium">{a.name}</span>
                              {a.type ? <span className="text-xs text-ink-soft">({a.type})</span> : null}
                            </label>

                            <button
                              className="text-xs text-emerald-700 underline"
                              onClick={() => setAddingValueOfAttr((id) => (id === a.id ? null : a.id))}
                              title="Add a new value"
                            >
                              {addingValueOfAttr === a.id ? "Cancel" : "Add value"}
                            </button>
                          </div>

                          {/* Multi-select for allowed values */}
                          {active && (
                            <div className="mt-2">
                              {values.length === 0 ? (
                                <div className="text-xs text-ink-soft">No values yet.</div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {values.map((v) => {
                                    const on = selected.has(v.id);
                                    return (
                                      <button
                                        key={v.id}
                                        type="button"
                                        className={`px-2 py-1 rounded border text-sm ${on ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-black/5"}`}
                                        onClick={() =>
                                          setLinked((prev) => {
                                            const list = new Set(prev[a.id] || []);
                                            if (list.has(v.id)) list.delete(v.id);
                                            else list.add(v.id);
                                            return { ...prev, [a.id]: Array.from(list) };
                                          })
                                        }
                                        title={v.code ? `Code: ${v.code}` : undefined}
                                      >
                                        {v.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Inline add value */}
                          {addingValueOfAttr === a.id && (
                            <div className="mt-3 grid md:grid-cols-3 gap-2">
                              <input
                                className="border rounded-lg px-3 py-2"
                                placeholder="Value name"
                                value={newValueName}
                                onChange={(e) => setNewValueName(e.target.value)}
                              />
                              <input
                                className="border rounded-lg px-3 py-2"
                                placeholder="Code (optional)"
                                value={newValueCode}
                                onChange={(e) => setNewValueCode(e.target.value)}
                              />
                              <div className="text-right">
                                <button
                                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                                  disabled={addValue.isPending || !newValueName.trim()}
                                  onClick={() => addValue.mutate(a.id)}
                                >
                                  {addValue.isPending ? "Adding…" : "Add value"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className="text-right">
                      <button
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                        disabled={saveOptions.isPending}
                        onClick={() => saveOptions.mutate()}
                        title="Save allowed options to this product"
                      >
                        {saveOptions.isPending ? "Saving…" : "Save options to product"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Variant Composer */}
        {!!selectedProduct && (
          <div className="rounded-xl border p-3 space-y-3">
            {attrsForComposer.length === 0 ? (
              <div className="text-sm text-ink-soft">
                Link at least one attribute & some values in <b>Options Manager</b> to enable variant creation.
              </div>
            ) : (
              <>
                <div className="grid md:grid-cols-3 gap-3">
                  {attrsForComposer.map((a) => (
                    <div key={a.id}>
                      <div className="text-xs text-ink-soft mb-1">{a.name}</div>
                      <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={selValues[a.id] ?? ""}
                        onChange={(e) => setSelValues((s) => ({ ...s, [a.id]: e.target.value }))}
                      >
                        <option value="">— choose —</option>
                        {(a.values ?? []).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="grid md:grid-cols-4 gap-3">
                  <input
                    className="border rounded-lg px-3 py-2"
                    placeholder="SKU (optional)"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                  />
                  <input
                    className="border rounded-lg px-3 py-2"
                    placeholder="Price (optional)"
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />
                    In stock
                  </label>
                  <div className="text-right">
                    <button
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                      disabled={!canCreate}
                      onClick={() => createVariant.mutate()}
                    >
                      {createVariant.isPending ? "Adding…" : "Add variant"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Existing variants */}
        {!!selectedProduct && (
          <div className="border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="text-left px-3 py-2">Options</th>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Price</th>
                  <th className="text-left px-3 py-2">Stock</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(productQ.data?.variants ?? []).map((v: any) => {
                  const variantAvail = availByVariant[v.id]; // undefined if no offers data
                  const showInStock =
                    typeof variantAvail === "number"
                      ? variantAvail > 0
                      : !!v.inStock; // fallback if offers not loaded

                  return (
                    <tr key={v.id}>
                      <td className="px-3 py-2">
                        {(() => {
                          const parts = (v.options ?? [])
                            .filter(Boolean)
                            .map((o: any) => {
                              const attr =
                                o.attributeName ??
                                o.attribute?.name ??
                                o.attributeId ??
                                "—";
                              const val =
                                o.valueName ??
                                o.value?.name ??
                                o.valueId ??
                                "—";
                              return `${attr}: ${val}`;
                            });

                          return parts.length ? parts.join(" • ") : "—";
                        })()}
                      </td>

                      <td className="px-3 py-2">{v.sku || "—"}</td>
                      <td className="px-3 py-2">
                        {v.price != null ? `₦${Number(v.price).toLocaleString()}` : "— (uses product price)"}
                      </td>

                      <td className="px-3 py-2">
                        {showInStock ? "In stock" : "Out"}
                        {typeof variantAvail === "number" && (
                          <span className="ml-2 text-xs text-zinc-500">(avail: {variantAvail})</span>
                        )}
                      </td>

                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            className="px-2 py-1 rounded border"
                            onClick={() => {
                              const newSku = prompt("SKU", v.sku || "") ?? v.sku;
                              const newPriceStr = prompt("Price (leave empty to use product price)", v.unitPrice ?? "") ?? v.unitPrice;
                              const newPrice = newPriceStr === "" ? null : Number(newPriceStr);
                              // Keep supporting manual flag for now; computed stock still wins for display
                              const newStock = confirm("Set as IN STOCK? (Cancel = OUT)");
                              updateVariant.mutate({
                                id: v.id,
                                sku: newSku || null,
                                unitPrice: newPriceStr === "" ? null : newPrice,
                                inStock: newStock,
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-rose-600 text-white"
                            onClick={() => { if (confirm("Delete this variant?")) deleteVariant.mutate(v.id); }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(!productQ.data?.variants || productQ.data.variants.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                      No variants yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
