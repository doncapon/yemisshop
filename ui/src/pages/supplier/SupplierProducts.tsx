// src/pages/supplier/SupplierProducts.tsx
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Package, Plus, Search, SlidersHorizontal, Pencil } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta } from "../../hooks/useCatalogMeta";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

type SupplierProductListItem = {
  id: string;
  title: string;
  sku: string;
  price: number;
  status: string;
  inStock: boolean;
  imagesJson: string[];
  createdAt: string;
  categoryId?: string | null;
  brandId?: string | null;
  availableQty?: number;
};

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
}) {
  const cls =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] border ${cls}`}>
      {children}
    </span>
  );
}

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

export default function SupplierProductsPage() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s: any) => s.user?.role);
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const nav = useNavigate();
  const qc = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();

  const adminSupplierId = useMemo(() => {
    if (!isAdmin) return undefined;
    const v = String(searchParams.get("supplierId") ?? "").trim();
    return v || undefined;
  }, [isAdmin, searchParams]);

  // ✅ persist supplier selection across supplier pages
  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = String(searchParams.get("supplierId") ?? "").trim();
    const fromStore = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();

    if (fromUrl) {
      if (fromUrl !== fromStore) localStorage.setItem(ADMIN_SUPPLIER_KEY, fromUrl);
      return;
    }

    if (fromStore) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("supplierId", fromStore);
          return next;
        },
        { replace: true }
      );
    }
  }, [isAdmin, searchParams, setSearchParams]);

  const withSupplierCtx = (to: string) => {
    if (!adminSupplierId) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"ANY" | "PENDING" | "APPROVED" | "REJECTED" | "PUBLISHED">("ANY");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");

  const { categories, brands } = useCatalogMeta({ enabled: !!token });

  const productsQ = useQuery({
    queryKey: ["supplier", "products", { q, status, supplierId: adminSupplierId }],
    enabled: !!token && (!isAdmin || !!adminSupplierId),
    queryFn: async () => {
      const { data } = await api.get<{
        data: SupplierProductListItem[];
        total: number;
        meta?: { lowStockThreshold?: number };
      }>("/api/supplier/products", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        params: { q: q.trim() || undefined, status, take: 100, skip: 0, supplierId: adminSupplierId },
      });
      return data;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const lowStockThreshold = productsQ.data?.meta?.lowStockThreshold ?? 3;

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const brandNameById = useMemo(() => {
    const m = new Map<string, string>();
    brands.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [brands]);

  const filtered = useMemo(() => {
    const items = productsQ.data?.data ?? [];
    return items.filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (brandId && p.brandId !== brandId) return false;
      return true;
    });
  }, [productsQ.data, categoryId, brandId]);

  return (
    <SiteLayout>
      <SupplierLayout>
        {/* Admin hint if no supplier selected */}
        {isAdmin && !adminSupplierId && (
          <div className="mt-6 rounded-2xl border bg-amber-50 text-amber-900 border-amber-200 p-4 text-sm">
            Select a supplier on the dashboard first (Admin view) to inspect their products.
            <Link to="/supplier" className="ml-2 underline font-semibold">
              Go to dashboard
            </Link>
          </div>
        )}

        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl md:text-3xl font-bold tracking-tight"
            >
              Products
            </motion.h1>
            <p className="mt-1 text-sm text-white/80">Manage listings, stock, pricing and visibility.</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to={withSupplierCtx("/supplier/products/add")}
                className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
              >
                <Plus size={16} /> Add product
              </Link>
              <Link
                to={withSupplierCtx("/supplier")}
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
              >
                Back to dashboard <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <div className="p-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                <input
                  placeholder="Search by name, SKU, description…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full rounded-2xl border bg-white pl-9 pr-4 py-3 text-sm outline-none focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400 transition"
                />
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-3 text-sm hover:bg-black/5"
              >
                <SlidersHorizontal size={16} /> Filters
              </button>
            </div>

            <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full rounded-2xl border bg-white px-4 py-3 text-sm"
              >
                <option value="ANY">Any status</option>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="PUBLISHED">PUBLISHED</option>
                <option value="REJECTED">REJECTED</option>
              </select>

              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-2xl border bg-white px-4 py-3 text-sm"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="w-full rounded-2xl border bg-white px-4 py-3 text-sm"
              >
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          <Card>
            <div className="p-5 flex items-center gap-3">
              <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                <Package size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-zinc-500">Quick tip</div>
                <div className="text-sm font-semibold text-zinc-900">Keep stock updated</div>
                <div className="text-[11px] text-zinc-500">Low stock products may get de-prioritised.</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Table */}
        <div className="mt-4">
          <Card>
            <div className="px-5 py-4 border-b bg-white/70">
              <div className="text-sm font-semibold text-zinc-900">Your listings</div>
              <div className="text-xs text-zinc-500">
                {productsQ.isLoading ? "Loading…" : `${filtered.length} item(s)`}
              </div>
            </div>

            <div className="p-5 overflow-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500">
                    <th className="text-left font-semibold py-2">Product</th>
                    <th className="text-left font-semibold py-2">SKU</th>
                    <th className="text-left font-semibold py-2">Category</th>
                    <th className="text-left font-semibold py-2">Brand</th>
                    <th className="text-left font-semibold py-2">Status</th>
                    <th className="text-left font-semibold py-2">Stock</th>
                    <th className="text-left font-semibold py-2">Price</th>
                    <th className="text-left font-semibold py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-800">
                  {filtered.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-3 font-semibold">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{p.title}</span>

                          {typeof p.availableQty === "number" && p.availableQty <= lowStockThreshold && (
                            <Badge tone="warning">Low stock</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3">{p.sku}</td>
                      <td className="py-3">{p.categoryId ? categoryNameById.get(p.categoryId) ?? "—" : "—"}</td>
                      <td className="py-3">{p.brandId ? brandNameById.get(p.brandId) ?? "—" : "—"}</td>
                      <td className="py-3">
                        <span className="inline-flex px-2 py-1 rounded-full text-[11px] border bg-zinc-50 text-zinc-700 border-zinc-200">
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3">{p.inStock ? "In stock" : "Out"}</td>
                      <td className="py-3">₦{Number.isFinite(p.price) ? p.price.toLocaleString("en-NG") : "—"}</td>

                      <td className="py-3">
                        <button
                          type="button"
                          onClick={async () => {
                            qc.invalidateQueries({ queryKey: ["supplier", "product", p.id] });

                            await qc.prefetchQuery({
                              queryKey: ["supplier", "product", p.id],
                              queryFn: async () => {
                                const { data } = await api.get(`/api/supplier/products/${p.id}`, {
                                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                                  params: { supplierId: adminSupplierId },
                                });
                                return (data as any)?.data ?? (data as any);
                              },
                              staleTime: 0,
                            });

                            nav(withSupplierCtx(`/supplier/products/${p.id}/edit`));
                          }}
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs hover:bg-black/5"
                        >
                          <Pencil size={14} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!productsQ.isLoading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-zinc-500">
                        No products yet.{" "}
                        <Link className="underline" to={withSupplierCtx("/supplier/products/add")}>
                          Add one
                        </Link>
                        .
                      </td>
                    </tr>
                  )}

                  {productsQ.isError && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-rose-700">
                        Failed to load products.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
