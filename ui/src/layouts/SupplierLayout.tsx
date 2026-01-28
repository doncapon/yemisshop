// src/layouts/SupplierLayout.tsx
import { NavLink } from "react-router-dom";
import { Package, ShoppingBag, Wallet, LayoutDashboard, Settings } from "lucide-react";

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  const linkBase =
    "inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition";
  const active = "bg-zinc-900 text-white border-zinc-900";
  const inactive = "bg-white/80 hover:bg-black/5 text-zinc-800 border-zinc-200";

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-100">
      {/* ✅ centered container */}
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 md:px-8">
        {/* Sub-nav */}
        <div className="pt-6">
          <div className="rounded-2xl border border-white/40 bg-white/80 backdrop-blur-md shadow-sm p-2 flex flex-wrap gap-2">
            <NavLink
              to="/supplier"
              end
              className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
            >
              <LayoutDashboard size={16} /> Overview
            </NavLink>

            <NavLink
              to="/supplier/products"
              className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
            >
              <Package size={16} /> Products
            </NavLink>

            <NavLink
              to="/supplier/orders"
              className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
            >
              <ShoppingBag size={16} /> Orders
            </NavLink>

            <NavLink
              to="/supplier/payouts"
              className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
            >
              <Wallet size={16} /> Payouts
            </NavLink>

            <NavLink
              to="/supplier/settings"
              className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
            >
              <Settings size={16} /> Settings
            </NavLink>
          </div>
        </div>

        {/* page content */}
        <div className="pb-10">{children}</div>
      </div>
    </div>
  );
}
