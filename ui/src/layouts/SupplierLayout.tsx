// src/layouts/SupplierLayout.tsx
import React, { useEffect, useMemo } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { Package, ShoppingBag, Wallet, LayoutDashboard, Settings } from "lucide-react";
import { useAuthStore } from "../store/auth";

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s: any) => s.user?.role);
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isRider = role === "SUPPLIER_RIDER";

  const [searchParams, setSearchParams] = useSearchParams();

  const urlSupplierId = useMemo(() => {
    const v = String(searchParams.get("supplierId") ?? "").trim();
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();
    return v || undefined;
  }, []);

  const adminSupplierId = isAdmin ? (urlSupplierId ?? storedSupplierId) : undefined;

  // Keep URL in sync (admin) so moving around maintains selection
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
    if (!isAdmin || !adminSupplierId) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  const linkBase =
    "inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition";
  const active = "bg-zinc-900 text-white border-zinc-900";
  const inactive = "bg-white/80 hover:bg-black/5 text-zinc-800 border-zinc-200";

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-100">
      {/* ✅ centered container */}
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 md:px-8">
        {/* Sub-nav (HIDE/REDUCE for riders) */}
        <div className="pt-6">
          {!isRider ? (
            <>
              <div className="rounded-2xl border border-white/40 bg-white/80 backdrop-blur-md shadow-sm p-2 flex flex-wrap gap-2">
                <NavLink
                  to={withSupplierCtx("/supplier")}
                  end
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <LayoutDashboard size={16} /> Overview
                </NavLink>

                <NavLink
                  to={withSupplierCtx("/supplier/products")}
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <Package size={16} /> Products
                </NavLink>

                <NavLink
                  to={withSupplierCtx("/supplier/orders")}
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <ShoppingBag size={16} /> Orders
                </NavLink>

                <NavLink
                  to={withSupplierCtx("/supplier/payouts")}
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <Wallet size={16} /> Payouts
                </NavLink>

                <NavLink
                  to={withSupplierCtx("/supplier/riders")}
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <Wallet size={16} /> Riders
                </NavLink>

                <NavLink
                  to={withSupplierCtx("/supplier/settings")}
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <Settings size={16} /> Settings
                </NavLink>
              </div>

              {/* Admin hint */}
              {isAdmin && !adminSupplierId ? (
                <div className="mt-2 text-xs text-zinc-600">
                  Admin view: select a supplier on the Supplier Dashboard first (or add <b>?supplierId=...</b>).
                </div>
              ) : null}
            </>
          ) : (
            // Rider minimal header (optional): keep it clean, no menus they can't control
            <div className="rounded-2xl border border-white/40 bg-white/80 backdrop-blur-md shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-semibold text-zinc-900">Rider portal</div>
                <NavLink
                  to={withSupplierCtx("/supplier/orders")}
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <ShoppingBag size={16} /> Orders
                </NavLink>
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                Riders can only access assigned orders.
              </div>
            </div>
          )}
        </div>

        {/* page content */}
        <div className="pb-10">{children}</div>
      </div>
    </div>
  );
}
