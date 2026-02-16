import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { useToast } from "../ToastProvider.js";

/* ---------------- helpers ---------------- */
function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function useAdminProductSearch(query: string, enabled: boolean) {
  const q = useDebounced(query, 250);
  return useQuery({
    queryKey: ["admin", "product-search", q],
    enabled: enabled && q.trim().length >= 2,
    queryFn: async () => {
      const { data } = await api.get("/api/admin/products/search", {
        withCredentials: true,
        params: { q },
      });
      return Array.isArray(data) ? data : data?.data ?? [];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/* ---------------- types (loose to match your payloads) ---------------- */
type AdminAttribute = {
  id: string;
  name: string;
  type: "TEXT" | "SELECT" | "MULTISELECT" | string;
  values?: { id: string; name: string; code?: string | null }[];
};

type ProductDetailResp = {
  id: string;
  title: string;
  price?: number;
  attributes?: AdminAttribute[];
  variants?: any[];
  attributeSelections?: Array<
    | { attributeId: string; valueId: string }
    | { attributeId: string; valueIds: string[] }
    | { attributeId: string; text: string }
  >;
};

/* ---------------- main component ---------------- */
export default function AdminProductAttributes() {
  const toast = useToast();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [product, setProduct] = useState<{ id: string; title: string } | null>(null);

  const searchQ = useAdminProductSearch(q, !product);

  const prodQ = useQuery<ProductDetailResp>({
    queryKey: ["admin", "product-attr", product?.id],
    enabled: !!product?.id,
    queryFn: async () => {
      const { data } = await api.get(`/api/admin/products/${product!.id}`, {
        withCredentials: true,
        params: { include: "attributes,variants" },
      });
      return (data?.data ?? data) as ProductDetailResp;
    },
    placeholderData: (prev) => prev,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  /* --------- local form state (normalized) --------- */
  const initialSelections = useMemo(() => {
    const m: Record<string, { kind: "TEXT" | "SELECT_MULTI"; valueIds?: string[]; text?: string }> = {};
    const sel = prodQ.data?.attributeSelections || [];
    for (const s of sel) {
      const aId = (s as any).attributeId;
      if (!aId) continue;

      if (Array.isArray((s as any).valueIds)) {
        m[aId] = { kind: "SELECT_MULTI", valueIds: [...(s as any).valueIds] };
      } else if ((s as any).valueId) {
        m[aId] = { kind: "SELECT_MULTI", valueIds: [(s as any).valueId] };
      } else if (typeof (s as any).text === "string") {
        m[aId] = { kind: "TEXT", text: (s as any).text };
      }
    }
    return m;
  }, [prodQ.data?.attributeSelections]);

  const [selectState, setSelectState] = useState<Record<string, string[]>>({});
  const [textState, setTextState] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!prodQ.data) return;
    const sel: Record<string, string[]> = {};
    const txt: Record<string, string> = {};
    for (const [aId, v] of Object.entries(initialSelections)) {
      if (v.kind === "TEXT") txt[aId] = v.text ?? "";
      else sel[aId] = v.valueIds ?? [];
    }
    setSelectState(sel);
    setTextState(txt);
  }, [prodQ.data, initialSelections]);

  /* --------- save links --------- */
  const save = useMutation({
    mutationFn: async () => {
      if (!product?.id) throw new Error("Pick a product");
      const attributes = (prodQ.data?.attributes ?? []) as AdminAttribute[];

      const attributeSelections: any[] = [];
      for (const a of attributes) {
        if (a.type === "TEXT") {
          const t = (textState[a.id] ?? "").trim();
          if (t) attributeSelections.push({ attributeId: a.id, text: t });
          continue;
        }

        const chosen = selectState[a.id] ?? [];
        if (a.type === "SELECT") {
          if (chosen[0]) attributeSelections.push({ attributeId: a.id, valueId: chosen[0] });
        } else {
          if (chosen.length) attributeSelections.push({ attributeId: a.id, valueIds: chosen });
        }
      }

      await api.put(
        `/api/admin/products/${product.id}`,
        { attributeSelections },
        { withCredentials: true }
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "product-attr", product?.id] });
      const prodId = product?.id;
      window.dispatchEvent(new CustomEvent("product-attributes-changed", { detail: { prodId } }));
      toast.push({ title: "Attributes", message: "Links saved.", duration: 1800 });
    },
    onError: (e: any) => {
      toast.push({
        title: "Attributes",
        message: e?.response?.data?.error || "Failed to save attribute links.",
        duration: 2600,
      });
    },
  });

  /* ------------------- UI helpers ------------------- */
  const attrs = (prodQ.data?.attributes ?? []) as AdminAttribute[];

  const toggleValue = (attributeId: string, valueId: string, multi: boolean) => {
    setSelectState((curr) => {
      const list = curr[attributeId] ?? [];
      if (!multi) {
        // single-select: click again to clear
        if (list[0] === valueId) return { ...curr, [attributeId]: [] };
        return { ...curr, [attributeId]: [valueId] };
      }
      const has = list.includes(valueId);
      return { ...curr, [attributeId]: has ? list.filter((x) => x !== valueId) : [...list, valueId] };
    });
  };

  // neutralize # anchors if any leak in
  const neutralizeHash = (evt: React.SyntheticEvent) => {
    const el = (evt.target as HTMLElement)?.closest?.('a[href="#"]');
    if (el) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  /* ------------------- render ------------------- */
  return (
    <div
      className="rounded-2xl border bg-white shadow-sm overflow-visible"
      onSubmitCapture={(e) => e.preventDefault()}
      onClickCapture={neutralizeHash}
      onMouseDownCapture={neutralizeHash}
    >
      <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
        <div>
          <h3 className="text-ink font-semibold">Link Product → Attributes</h3>
          <p className="text-xs text-ink-soft">
            Attach SELECT / MULTISELECT / TEXT attributes to a product for filters/specs.
          </p>
        </div>
      </div>

      <div className="p-4 md:p-5 space-y-5">
        {/* Product picker */}
        {!product ? (
          <div className="grid md:grid-cols-[1fr_auto] gap-2">
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Search product by title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="text-sm text-ink-soft self-center">
              {searchQ.isFetching ? "Searching…" : searchQ.isError ? "Failed to search" : ""}
            </div>

            {q && searchQ.isSuccess && (searchQ.data?.length ?? 0) > 0 && (
              <div className="col-span-full border rounded-lg max-h-72 overflow-auto bg-white">
                {(searchQ.data ?? []).map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-black/5"
                    onClick={() => {
                      setProduct({ id: String(p.id), title: String(p.title) });
                      setQ("");
                    }}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
            )}

            {q && searchQ.isSuccess && (searchQ.data?.length ?? 0) === 0 && (
              <div className="col-span-full text-xs text-ink-soft">No products found.</div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              Managing <span className="font-semibold">{product.title}</span>
            </div>
            <button
              type="button"
              className="px-2 py-1 rounded border"
              onClick={() => {
                setProduct(null);
                setQ("");
                setSelectState({});
                setTextState({});
              }}
            >
              Change product
            </button>
          </div>
        )}

        {/* Attribute editor */}
        {!!product && (
          <>
            <div className="rounded-xl border p-3">
              {prodQ.isLoading ? (
                <div className="text-sm text-ink-soft">Loading attributes…</div>
              ) : attrs.length === 0 ? (
                <div className="text-sm text-ink-soft">
                  This product has no available attributes yet. Create attributes &amp; values under
                  <strong> Catalog → Attributes</strong>, then return here.
                </div>
              ) : (
                <div className="grid gap-4">
                  {attrs.map((a) => {
                    const multi = a.type === "MULTISELECT";
                    const selected = selectState[a.id] ?? [];
                    return (
                      <div key={a.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">
                            {a.name} <span className="text-xs text-zinc-500">({a.type})</span>
                          </div>
                          {a.type !== "TEXT" && (
                            <button
                              type="button"
                              className="text-xs text-zinc-600 underline"
                              onClick={() => setSelectState((s) => ({ ...s, [a.id]: [] }))}
                            >
                              Clear
                            </button>
                          )}
                        </div>

                        {a.type === "TEXT" ? (
                          <input
                            className="mt-2 w-full border rounded-lg px-3 py-2"
                            placeholder={`Enter ${a.name}…`}
                            value={textState[a.id] ?? ""}
                            onChange={(e) => setTextState((s) => ({ ...s, [a.id]: e.target.value }))}
                          />
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(a.values ?? []).map((v) => {
                              const active = selected.includes(v.id);
                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => toggleValue(a.id, v.id, multi)}
                                  className={`px-2 py-1 rounded-full border text-sm ${
                                    active
                                      ? "bg-zinc-900 text-white border-zinc-900"
                                      : "bg-white hover:bg-zinc-50"
                                  }`}
                                  title={v.code ? `${v.name} (${v.code})` : v.name}
                                >
                                  {v.name}
                                </button>
                              );
                            })}
                            {(a.values ?? []).length === 0 && (
                              <span className="text-xs text-zinc-500">No values</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="px-3 py-2 rounded-lg border"
                onClick={() => {
                  setSelectState({});
                  setTextState({});
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                disabled={save.isPending || attrs.length === 0}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : "Save links"}
              </button>
            </div>

            {/* Read-only preview of current variants (helps admins understand impact) */}
            {(prodQ.data?.variants?.length ?? 0) > 0 && (
              <div className="rounded-xl border p-3">
                <div className="text-sm font-medium mb-2">Existing variants (preview)</div>
                <div className="space-y-2">
                  {(prodQ.data?.variants ?? []).map((v: any) => (
                    <div key={v.id} className="text-sm border rounded-lg px-3 py-2">
                      <div className="font-mono text-xs">SKU: {v.sku || "—"}</div>
                      <div className="text-xs text-zinc-600">
                        {(v.options ?? [])
                          .map((o: any) => {
                            const aName = o.attributeName || o.attribute?.name || "—";
                            const vName = o.valueName || o.value?.name || "—";
                            return `${aName}: ${vName}`;
                          })
                          .join(" • ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
