// src/components/admin/AdminCatalogRequestsSection.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

type CatalogRequestType = "BRAND" | "CATEGORY" | "ATTRIBUTE" | "ATTRIBUTE_VALUE";
type CatalogRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

type CatalogRequestRow = {
  id: string;
  type: CatalogRequestType;
  status: CatalogRequestStatus;
  payload: any;
  reason?: string | null;
  adminNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  supplier?: { id: string; name: string } | null;
};

type AdminCategory = {
  id: string;
  name: string;
  slug?: string | null;
  parentId?: string | null;
  isActive?: boolean;
};

type AdminBrand = {
  id: string;
  name: string;
  slug?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
};

type AdminAttribute = {
  id: string;
  name: string;
  type: "TEXT" | "SELECT" | "MULTISELECT" | string;
  placeholder?: string | null;
  isActive?: boolean;
  values?: Array<{ id: string; name: string; code?: string | null; isActive?: boolean }>;
};

function titleFromRequest(r: CatalogRequestRow) {
  const p = r.payload || {};
  if (r.type === "CATEGORY") return p?.name || p?.slug || "—";
  if (r.type === "BRAND") return p?.name || p?.slug || "—";
  if (r.type === "ATTRIBUTE") return p?.name || "—";
  if (r.type === "ATTRIBUTE_VALUE") return p?.name || p?.code || "—";
  return "—";
}

function badgeClass(status: CatalogRequestStatus) {
  if (status === "PENDING") return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "APPROVED") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  return "bg-rose-100 text-rose-800 border-rose-200";
}

function slugify(s: string) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function unwrapArray<T>(data: any): T[] {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

/** Try multiple URLs until one works (helps when your backend paths differ) */
async function getFirstWorking<T>(urls: string[], headers?: any): Promise<T[]> {
  for (const url of urls) {
    try {
      const { data } = await api.get(url, { headers });
      return unwrapArray<T>(data);
    } catch {
      // try next
    }
  }
  return [];
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-zinc-600 mb-1">{children}</label>;
}

function SmallHint({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-zinc-500 mt-1">{children}</div>;
}

/** -------- Memoized table to prevent re-render "twitch" while editing form -------- */
const RequestsTable = React.memo(function RequestsTable(props: {
  rows: CatalogRequestRow[];
  onEdit: (r: CatalogRequestRow) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  const { rows, onEdit, onApprove, onReject, busy } = props;

  // Preserve horizontal scroll position
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const scrollLeftRef = useRef(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onScroll = () => {
      scrollLeftRef.current = el.scrollLeft;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Restore scroll position after rows change (or parent re-render)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.scrollLeft = scrollLeftRef.current;
  }, [rows]);

  return (
    <div ref={wrapRef} className="border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="text-left px-3 py-2">Title</th>
            <th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">Supplier</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Created</th>
            <th className="text-right px-3 py-2">Actions</th>
          </tr>
        </thead>

        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 font-medium">{titleFromRequest(r)}</td>
              <td className="px-3 py-2">{r.type}</td>
              <td className="px-3 py-2">{r.supplier?.name ?? "—"}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center px-2 py-1 rounded-full border text-xs ${badgeClass(r.status)}`}>
                  {r.status}
                </span>
              </td>
              <td className="px-3 py-2 text-zinc-600">{new Date(r.createdAt).toLocaleString()}</td>

              <td className="px-3 py-2 text-right">
                <div className="inline-flex gap-2">
                  <button
                    type="button"
                    className="px-2 py-1 rounded border bg-white hover:bg-black/5"
                    onClick={() => onEdit(r)}
                    disabled={r.status !== "PENDING"}
                    title={r.status !== "PENDING" ? "Only pending requests can be edited" : "Edit request"}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
                    onClick={() => onApprove(r.id)}
                    disabled={r.status !== "PENDING" || busy}
                  >
                    Approve
                  </button>

                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-rose-600 text-white disabled:opacity-50"
                    onClick={() => onReject(r.id)}
                    disabled={r.status !== "PENDING" || busy}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-zinc-500">
                No catalog requests
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
});

export default function AdminCatalogRequestsSection() {
  const token = useAuthStore((s) => s.token);
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
  const qc = useQueryClient();

  const [editing, setEditing] = useState<CatalogRequestRow | null>(null);
  const [draftPayload, setDraftPayload] = useState<any>({});
  const [draftAdminNote, setDraftAdminNote] = useState<string>("");

  const [errMsg, setErrMsg] = useState<string>("");

  // for auto-slug without fighting user typing
  const [slugTouched, setSlugTouched] = useState(false);

  const requestsQ = useQuery<CatalogRequestRow[]>({
    queryKey: ["admin", "catalog-requests"],
    queryFn: async () => {
      const { data } = await api.get("/api/admin/catalog-requests", { headers: hdr });
      return unwrapArray<CatalogRequestRow>(data);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // ---- meta lists (for dropdowns) ----
  const categoriesQ = useQuery<AdminCategory[]>({
    queryKey: ["admin", "categories"],
    enabled: !!token,
    queryFn: () =>
      getFirstWorking<AdminCategory>(["/api/admin/categories", "/api/categories", "/api/catalog/categories"], hdr),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const brandsQ = useQuery<AdminBrand[]>({
    queryKey: ["admin", "brands"],
    enabled: !!token,
    queryFn: () => getFirstWorking<AdminBrand>(["/api/admin/brands", "/api/brands", "/api/catalog/brands"], hdr),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const attributesQ = useQuery<AdminAttribute[]>({
    queryKey: ["admin", "attributes"],
    enabled: !!token,
    queryFn: () =>
      getFirstWorking<AdminAttribute>(["/api/admin/attributes", "/api/attributes", "/api/catalog/attributes"], hdr),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const patchReq = useMutation({
    mutationFn: async (vars: { id: string; payload: any; adminNote?: string | null }) => {
      const { data } = await api.patch(
        `/api/admin/catalog-requests/${vars.id}`,
        { payload: vars.payload, adminNote: vars.adminNote ?? null },
        { headers: hdr }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "catalog-requests"] });
    },
  });

  const approveReq = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/api/admin/catalog-requests/${id}/approve`, {}, { headers: hdr });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "catalog-requests"] }),
  });

  const rejectReq = useMutation({
    mutationFn: async (vars: { id: string; adminNote?: string }) => {
      const { data } = await api.post(
        `/api/admin/catalog-requests/${vars.id}/reject`,
        { adminNote: vars.adminNote ?? null },
        { headers: hdr }
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "catalog-requests"] }),
  });

  const pending = useMemo(() => (requestsQ.data ?? []).filter((r) => r.status === "PENDING"), [requestsQ.data]);

  const activeCategories = useMemo(() => (categoriesQ.data ?? []).filter((c) => c.isActive !== false), [categoriesQ.data]);

  const activeBrands = useMemo(() => (brandsQ.data ?? []).filter((b) => b.isActive !== false), [brandsQ.data]);

  const activeAttributes = useMemo(
    () => (attributesQ.data ?? []).filter((a) => a.isActive !== false),
    [attributesQ.data]
  );

  const busy = approveReq.isPending || rejectReq.isPending || patchReq.isPending;

  const onEdit = useCallback((r: CatalogRequestRow) => {
    setEditing(r);
    setDraftPayload(r.payload ?? {});
    setDraftAdminNote(r.adminNote ?? "");
    setErrMsg("");
    setSlugTouched(false);
  }, []);

  const closeEdit = useCallback(() => {
    setEditing(null);
    setDraftPayload({});
    setDraftAdminNote("");
    setErrMsg("");
    setSlugTouched(false);
  }, []);

  function setPayload(key: string, value: any) {
    setDraftPayload((p: any) => ({ ...(p ?? {}), [key]: value }));
  }

  const canSave = useMemo(() => {
    if (!editing) return false;
    const p = draftPayload ?? {};
    if (editing.type === "CATEGORY") return !!(String(p.name || "").trim() && String(p.slug || "").trim());
    if (editing.type === "BRAND") return !!(String(p.name || "").trim() && String(p.slug || "").trim());
    if (editing.type === "ATTRIBUTE") return !!(String(p.name || "").trim() && String(p.type || "").trim());
    if (editing.type === "ATTRIBUTE_VALUE") return !!(String(p.name || "").trim() && String(p.attributeId || "").trim());
    return true;
  }, [editing, draftPayload]);

  const saveEdit = useCallback(async () => {
    if (!editing) return;

    setErrMsg("");
    try {
      await patchReq.mutateAsync({
        id: editing.id,
        payload: draftPayload,
        adminNote: draftAdminNote,
      });
      closeEdit();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Save failed";
      setErrMsg(String(msg));
    }
  }, [editing, patchReq, draftPayload, draftAdminNote, closeEdit]);

  // ---- Dropdown option lists ----
  const parentCategoryOptions = useMemo(() => {
    return activeCategories
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((c) => ({ id: c.id, name: c.name }));
  }, [activeCategories]);

  const brandOptions = useMemo(() => {
    return activeBrands
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((b) => ({ id: b.id, name: b.name }));
  }, [activeBrands]);

  const attributeOptions = useMemo(() => {
    return activeAttributes
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((a) => ({ id: a.id, label: `${a.name} (${a.type})`, name: a.name, type: a.type, placeholder: a.placeholder }));
  }, [activeAttributes]);

  // ---- Modal form body ----
  function renderFormBody() {
    if (!editing) return null;
    const p = draftPayload ?? {};

    if (editing.type === "CATEGORY") {
      const parentId = (p.parentId ?? "") as string;

      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Category name</FieldLabel>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={p.name ?? ""}
                onChange={(e) => {
                  const name = e.target.value;
                  setPayload("name", name);
                  if (!slugTouched) setPayload("slug", slugify(name));
                }}
                placeholder="e.g. Small Kitchen Appliances"
              />
            </div>

            <div>
              <FieldLabel>Slug</FieldLabel>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={p.slug ?? ""}
                onChange={(e) => {
                  setSlugTouched(true);
                  setPayload("slug", e.target.value);
                }}
                placeholder="e.g. small-kitchen-appliances"
              />
            </div>
          </div>

          {/* ✅ Parent Category Dropdown (names only) */}
          <div>
            <FieldLabel>Parent category (optional)</FieldLabel>
            <select
              className="w-full border rounded-xl px-3 py-2 bg-white"
              value={parentId || ""}
              onChange={(e) => {
                const id = e.target.value || "";
                if (!id) {
                  setPayload("parentId", null);
                  setPayload("parentCategoryName", null);
                  return;
                }
                const parent = activeCategories.find((c) => c.id === id);
                setPayload("parentId", id);
                setPayload("parentCategoryName", parent?.name ?? null);
              }}
            >
              <option value="">— None —</option>
              {parentCategoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <SmallHint>
              Loaded categories: <b>{activeCategories.length}</b>
              {activeCategories.length === 0 ? " (If this stays 0, your categories route is returning empty.)" : ""}
            </SmallHint>
          </div>
        </div>
      );
    }

    if (editing.type === "BRAND") {
      const pickedBrandId = (p.brandId ?? "") as string;

      return (
        <div className="space-y-4">
          {/* optional "pick existing brand" */}
          <div>
            <FieldLabel>Pick existing brand (optional)</FieldLabel>
            <select
              className="w-full border rounded-xl px-3 py-2 bg-white"
              value={pickedBrandId || ""}
              onChange={(e) => {
                const id = e.target.value || "";
                setPayload("brandId", id || null);
                if (!id) return;
                const existing = activeBrands.find((b) => b.id === id);
                if (!existing) return;
                setPayload("name", existing.name);
                setPayload("slug", existing.slug || slugify(existing.name));
                setPayload("logoUrl", existing.logoUrl || "");
                setSlugTouched(true);
              }}
            >
              <option value="">— None —</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            <SmallHint>
              Loaded brands: <b>{activeBrands.length}</b>
            </SmallHint>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Brand name</FieldLabel>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={p.name ?? ""}
                onChange={(e) => {
                  const name = e.target.value;
                  setPayload("name", name);
                  if (!slugTouched) setPayload("slug", slugify(name));
                }}
                placeholder="e.g. Nike"
              />
            </div>

            <div>
              <FieldLabel>Slug</FieldLabel>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={p.slug ?? ""}
                onChange={(e) => {
                  setSlugTouched(true);
                  setPayload("slug", e.target.value);
                }}
                placeholder="e.g. nike"
              />
            </div>
          </div>

          <div>
            <FieldLabel>Logo URL (optional)</FieldLabel>
            <input
              className="w-full border rounded-xl px-3 py-2"
              value={p.logoUrl ?? ""}
              onChange={(e) => setPayload("logoUrl", e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
      );
    }

    if (editing.type === "ATTRIBUTE") {
      const pickedAttrId = (p.attributeId ?? "") as string;

      return (
        <div className="space-y-4">
          {/* optional pick existing attribute */}
          <div>
            <FieldLabel>Pick existing attribute (optional)</FieldLabel>
            <select
              className="w-full border rounded-xl px-3 py-2 bg-white"
              value={pickedAttrId || ""}
              onChange={(e) => {
                const id = e.target.value || "";
                setPayload("attributeId", id || null);
                if (!id) return;
                const existing = activeAttributes.find((a) => a.id === id);
                if (!existing) return;
                setPayload("name", existing.name);
                setPayload("type", existing.type);
                setPayload("placeholder", existing.placeholder || "");
              }}
            >
              <option value="">— None —</option>
              {attributeOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>

            <SmallHint>
              Loaded attributes: <b>{activeAttributes.length}</b>
            </SmallHint>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Attribute name</FieldLabel>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={p.name ?? ""}
                onChange={(e) => setPayload("name", e.target.value)}
                placeholder="e.g. Material"
              />
            </div>

            <div>
              <FieldLabel>Type</FieldLabel>
              <select
                className="w-full border rounded-xl px-3 py-2 bg-white"
                value={p.type ?? "SELECT"}
                onChange={(e) => setPayload("type", e.target.value)}
              >
                <option value="TEXT">TEXT</option>
                <option value="SELECT">SELECT</option>
                <option value="MULTISELECT">MULTISELECT</option>
              </select>
            </div>
          </div>

          <div>
            <FieldLabel>Placeholder (optional)</FieldLabel>
            <input
              className="w-full border rounded-xl px-3 py-2"
              value={p.placeholder ?? ""}
              onChange={(e) => setPayload("placeholder", e.target.value)}
              placeholder="e.g. Choose material"
            />
          </div>
        </div>
      );
    }

    // ATTRIBUTE_VALUE
    const attrId = String(p.attributeId ?? "");
    const selectedAttr = activeAttributes.find((a) => a.id === attrId) || null;
    const valueOptions =
      (selectedAttr?.values ?? [])
        .filter((v) => v.isActive !== false)
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((v) => ({ id: v.id, label: v.code ? `${v.name} (${v.code})` : v.name, name: v.name, code: v.code })) ?? [];

    return (
      <div className="space-y-4">
        <div>
          <FieldLabel>Attribute</FieldLabel>
          <select
            className="w-full border rounded-xl px-3 py-2 bg-white"
            value={attrId || ""}
            onChange={(e) => {
              const id = e.target.value || "";
              setPayload("attributeId", id || null);
              const a = activeAttributes.find((x) => x.id === id);
              setPayload("attributeName", a?.name ?? null);
              // reset value suggestion fields when switching attribute
              setPayload("valueId", null);
            }}
          >
            <option value="">Select attribute…</option>
            {attributeOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <SmallHint>
            Loaded attributes: <b>{activeAttributes.length}</b>
          </SmallHint>
        </div>

        {selectedAttr && valueOptions.length > 0 && (
          <div>
            <FieldLabel>Pick existing value (optional)</FieldLabel>
            <select
              className="w-full border rounded-xl px-3 py-2 bg-white"
              value={String(p.valueId ?? "")}
              onChange={(e) => {
                const id = e.target.value || "";
                setPayload("valueId", id || null);
                if (!id) return;
                const existing = (selectedAttr.values ?? []).find((v) => v.id === id);
                if (!existing) return;
                setPayload("name", existing.name);
                setPayload("code", existing.code || "");
              }}
            >
              <option value="">— None —</option>
              {valueOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <SmallHint>
              Loaded values for “{selectedAttr.name}”: <b>{valueOptions.length}</b>
            </SmallHint>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <FieldLabel>Value name</FieldLabel>
            <input
              className="w-full border rounded-xl px-3 py-2"
              value={p.name ?? ""}
              onChange={(e) => setPayload("name", e.target.value)}
              placeholder="e.g. Cotton"
            />
          </div>

          <div>
            <FieldLabel>Code (optional)</FieldLabel>
            <input
              className="w-full border rounded-xl px-3 py-2"
              value={p.code ?? ""}
              onChange={(e) => setPayload("code", e.target.value)}
              placeholder="e.g. COT"
            />
          </div>
        </div>
      </div>
    );
  }

  const onApprove = useCallback(
    (id: string) => {
      approveReq.mutate(id);
    },
    [approveReq]
  );

  const onReject = useCallback(
    (id: string) => {
      rejectReq.mutate({ id, adminNote: "" });
    },
    [rejectReq]
  );

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b bg-white/70 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900">Catalog Requests</div>
          <div className="text-xs text-zinc-500">Approve supplier requests for categories, brands, attributes & values</div>
        </div>
        <div className="text-xs text-zinc-600">
          Pending: <b>{pending.length}</b>
        </div>
      </div>

      <div className="p-5 space-y-3">
        {requestsQ.isLoading && <div className="text-sm text-zinc-500">Loading…</div>}
        {requestsQ.isError && <div className="text-sm text-rose-600">Failed to load catalog requests</div>}

        <RequestsTable rows={requestsQ.data ?? []} onEdit={onEdit} onApprove={onApprove} onReject={onReject} busy={busy} />
      </div>

      {/* ---------- Edit Modal (form-based) ---------- */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold text-zinc-900">Edit request</div>
                <div className="text-xs text-zinc-500">
                  {editing.type} — {titleFromRequest(editing)}
                </div>
              </div>
              <button type="button" className="text-sm text-zinc-600 hover:underline" onClick={closeEdit}>
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-xs text-zinc-500">
                Fix fields, click <b>Save</b>, then click <b>Approve</b> on the row.
              </div>

              {/* ✅ Supplier note/reason (read-only) */}
              <div className="rounded-xl border bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500 mb-2">
                  Supplier note / reason {editing.supplier?.name ? `— ${editing.supplier.name}` : ""}
                </div>

                <FieldLabel>Reason</FieldLabel>
                <textarea
                  className="w-full min-h-[90px] border rounded-xl px-3 py-2 bg-white text-sm"
                  value={String(editing.reason ?? "")}
                  readOnly
                />

                <SmallHint>This is read-only and comes from the supplier request.</SmallHint>
              </div>

              {renderFormBody()}

              <div>
                <FieldLabel>Admin note (optional)</FieldLabel>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  value={draftAdminNote}
                  onChange={(e) => setDraftAdminNote(e.target.value)}
                  placeholder="e.g. corrected spelling; assigned parent"
                />
              </div>

              {errMsg && (
                <div className="text-xs text-rose-600 border border-rose-200 bg-rose-50 rounded-xl px-3 py-2">
                  {errMsg}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
              <button type="button" className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5" onClick={closeEdit}>
                Cancel
              </button>

              <button
                type="button"
                className="px-3 py-2 rounded-lg bg-zinc-900 text-white disabled:opacity-50"
                onClick={saveEdit}
                disabled={patchReq.isPending || !canSave}
                title={!canSave ? "Fill required fields before saving" : ""}
              >
                {patchReq.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
