// src/components/Navbar.tsx
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { useAuthStore } from "../store/auth";
import { performLogout } from "../utils/logout";
import NotificationsBell from "./notifications/NotificationsBell";

import {
  Home,
  LayoutGrid,
  ShoppingCart,
  Heart,
  Package,
  Shield,
  CheckCircle2,
  Truck,
  Store,
  User,
  Menu,
  X,
  LogOut,
  Settings,
  ClipboardList,
} from "lucide-react";

import DaySpringLogo from "./brand/DayspringLogo";
import { useCartCount } from "../hooks/useCartCount";

type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

function useClickAway<T extends HTMLElement>(onAway: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onAway();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onAway]);
  return ref;
}

function IconNavLink({
  to,
  end,
  icon,
  label,
  onClick,
  disabled,
  badgeCount,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  badgeCount?: number;
}) {
  const count = Number(badgeCount || 0);

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => {
        const base =
          "group relative inline-flex items-center justify-center rounded-xl border px-2.5 py-2 transition select-none";
        const active = "bg-zinc-900 text-white border-zinc-900 shadow-sm";
        const idle = "bg-white/80 text-zinc-700 border-zinc-200 hover:bg-zinc-50";
        const dis = "opacity-50 pointer-events-none";
        return `${base} ${isActive ? active : idle} ${disabled ? dis : ""}`;
      }}
      aria-label={label}
      title={label}
    >
      <span className="inline-flex items-center justify-center">{icon}</span>

      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-fuchsia-600 text-[10px] font-semibold text-white flex items-center justify-center">
          {count > 9 ? "9+" : count}
        </span>
      )}

      <span className="hidden md:block absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 text-white text-[11px] px-2 py-1 opacity-0 group-hover:opacity-100 transition pointer-events-none">
        {label}
      </span>
    </NavLink>
  );
}

export default function Navbar() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const userRole = (user?.role ?? null) as Role | null;
  const userEmail = user?.email ?? null;

  const nav = useNavigate();
  const loc = useLocation();

  const isSupplier = userRole === "SUPPLIER";
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";
  const isRider = userRole === "SUPPLIER_RIDER";

  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickAway<HTMLDivElement>(() => setMenuOpen(false));

  // Cart counts
  const { distinct: cartItemsCount, totalQty: cartTotalQty } = useCartCount();

  // Display name from store (Option A token auth: store is the source of truth)
  const firstName = user?.firstName?.trim() || null;
  const middleName = (user as any)?.middleName?.trim?.() || null;
  const lastName = user?.lastName?.trim() || null;

  const displayName = useMemo(() => {
    const f = firstName?.trim();
    const l = lastName?.trim();
    const m = middleName?.trim();
    if (f && l) {
      const mid = m ? ` ${m[0].toUpperCase()}.` : "";
      return `${f}${mid} ${l}`;
    }
    return null;
  }, [firstName, middleName, lastName]);

  const initials = useMemo(() => {
    const f = (firstName?.trim()?.[0] || "").toUpperCase();
    const l = (lastName?.trim()?.[0] || "").toUpperCase();
    const init = `${f}${l}`.trim();
    return init || "U";
  }, [firstName, lastName]);

  const logout = useCallback(() => {
    setMenuOpen(false);
    setMobileMoreOpen(false);
    performLogout("/");
  }, []);

  // Riders should land on orders
  const brandHref = isRider ? "/supplier/orders" : "/";

  // Close mobile more when route changes
  useEffect(() => setMobileMoreOpen(false), [loc.pathname]);

  // Nav visibility
  const showShopNav = !token || (!isSupplier && !isSuperAdmin && !isRider);
  const showBuyerNav = !!token && !isSupplier && !isRider;
  const showSupplierNav = !!token && isSupplier && !isRider;
  const showRiderNav = !!token && isRider;

  // Badge standard: show distinct items
  const cartBadge = cartItemsCount;

  return (
    <>
      {/* Fixed top header */}
      <header className="fixed top-0 left-0 right-0 z-50 w-full border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="w-full max-w-7xl mx-auto h-14 md:h-16 px-4 md:px-8 flex items-center gap-3">
          {/* Brand */}
          <Link
            to={brandHref}
            className="inline-flex items-center hover:opacity-95"
            aria-label="DaySpring home"
          >
            <DaySpringLogo size={28} />
          </Link>

          {/* Desktop icon nav */}
          <nav className="hidden md:flex items-center gap-2 ml-2">
            {showRiderNav ? (
              <IconNavLink to="/supplier/orders" icon={<Truck size={18} />} label="Orders" />
            ) : (
              <>
                {/* Catalogue/Home */}
                <IconNavLink
                  to="/"
                  end
                  icon={showShopNav ? <LayoutGrid size={18} /> : <Home size={18} />}
                  label="Catalogue"
                />

                {/* Dashboards */}
                {showSupplierNav && (
                  <IconNavLink to="/supplier" end icon={<Store size={18} />} label="Supplier dashboard" />
                )}

                {token && isSuperAdmin && (
                  <IconNavLink
                    to="/supplier"
                    end
                    icon={<CheckCircle2 size={18} />}
                    label="Supplier dashboard"
                  />
                )}

                {token && !isSupplier && !isSuperAdmin && (
                  <IconNavLink to="/dashboard" end icon={<User size={18} />} label="Dashboard" />
                )}

                {/* Buyer nav */}
                {showBuyerNav && (
                  <>
                    <IconNavLink
                      to="/cart"
                      icon={<ShoppingCart size={18} />}
                      label={cartBadge > 0 ? `Cart (${cartBadge})` : "Cart"}
                      badgeCount={cartBadge}
                    />
                    <IconNavLink to="/wishlist" end icon={<Heart size={18} />} label="Wishlist" />
                    <IconNavLink to="/orders" end icon={<Package size={18} />} label="Orders" />
                  </>
                )}

                {/* Admin */}
                {isAdmin && <IconNavLink to="/admin" icon={<Shield size={18} />} label="Admin" />}
                {isAdmin && (
                  <IconNavLink
                    to="/admin/offer-changes"
                    icon={<ClipboardList size={18} />}
                    label="Offer approvals"
                  />
                )}
              </>
            )}
          </nav>

          <div className="ml-auto" />

          {/* Right cluster */}
          <div className="flex items-center gap-2">
            {/* Desktop bell */}
            <div className="hidden md:block">
              <NotificationsBell placement="navbar" />
            </div>

            {/* Auth buttons (desktop) */}
            <div className="hidden md:flex items-center gap-2">
              {!token ? (
                <>
                  <NavLink
                    to="/register-supplier"
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 transition"
                    title="Become a supplier"
                  >
                    <Store size={16} />
                    <span className="hidden lg:inline">Supply</span>
                  </NavLink>

                  <NavLink
                    to="/login"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${
                        isActive
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "bg-white/80 text-zinc-900 border-zinc-200 hover:bg-zinc-50"
                      }`
                    }
                    title="Login"
                  >
                    <User size={16} />
                    <span className="hidden lg:inline">Login</span>
                  </NavLink>

                  <NavLink
                    to="/register"
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-sm font-semibold hover:opacity-90 transition"
                    title="Register"
                  >
                    <CheckCircle2 size={16} />
                    <span className="hidden lg:inline">Register</span>
                  </NavLink>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  {/* avatar menu */}
                  <div className="relative" ref={menuRef}>
                    <button
                      onClick={() => setMenuOpen((v) => !v)}
                      className="w-10 h-10 rounded-2xl grid place-items-center border border-zinc-200 bg-white/80 text-zinc-900 font-semibold hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-fuchsia-100 transition"
                      aria-label="User menu"
                      title="Account"
                    >
                      {initials}
                    </button>

                    {menuOpen && (
                      <div
                        className="absolute right-0 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden"
                        role="menu"
                      >
                        <div className="px-3 py-3 border-b border-zinc-100 bg-zinc-50">
                          <div className="text-xs text-zinc-500">Signed in as</div>
                          <div className="text-sm font-semibold truncate text-zinc-900">
                            {displayName || userEmail || "User"}
                          </div>
                          {userEmail && (
                            <div className="text-[10px] text-zinc-500 truncate">{userEmail}</div>
                          )}
                          {isRider && <div className="mt-1 text-[10px] text-zinc-500">Role: Rider</div>}
                          {showBuyerNav && cartBadge > 0 && (
                            <div className="mt-1 text-[10px] text-zinc-500">
                              Cart: {cartItemsCount} items • {cartTotalQty} units
                            </div>
                          )}
                        </div>

                        {isRider ? (
                          <nav className="py-1 text-sm">
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                              onClick={() => {
                                setMenuOpen(false);
                                nav("/supplier/orders");
                              }}
                              role="menuitem"
                            >
                              <Truck size={16} />
                              Orders
                            </button>

                            <div className="my-1 border-t border-zinc-100" />
                            <button
                              className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 transition inline-flex items-center gap-2"
                              onClick={logout}
                              role="menuitem"
                            >
                              <LogOut size={16} />
                              Logout
                            </button>
                          </nav>
                        ) : (
                          <nav className="py-1 text-sm">
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                              onClick={() => {
                                setMenuOpen(false);
                                nav("/profile");
                              }}
                              role="menuitem"
                            >
                              <User size={16} />
                              Edit Profile
                            </button>

                            <button
                              className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                              onClick={() => {
                                setMenuOpen(false);
                                nav("/account/sessions");
                              }}
                              role="menuitem"
                            >
                              <Settings size={16} />
                              Sessions
                            </button>

                            {!isSupplier && (
                              <button
                                className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                                onClick={() => {
                                  setMenuOpen(false);
                                  nav("/orders");
                                }}
                                role="menuitem"
                              >
                                <Package size={16} />
                                Purchase history
                              </button>
                            )}

                            {userRole === "SUPER_ADMIN" && (
                              <button
                                className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                                onClick={() => {
                                  setMenuOpen(false);
                                  nav("/admin/settings");
                                }}
                                role="menuitem"
                              >
                                <Shield size={16} />
                                Admin Settings
                              </button>
                            )}

                            <div className="my-1 border-t border-zinc-100" />
                            <button
                              className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 transition inline-flex items-center gap-2"
                              onClick={logout}
                              role="menuitem"
                            >
                              <LogOut size={16} />
                              Logout
                            </button>
                          </nav>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile: bell + more */}
            <div className="md:hidden flex items-center gap-2">
              <NotificationsBell placement="navbar" />
              <button
                className="inline-flex items-center justify-center w-10 h-10 rounded-2xl border border-zinc-200 bg-white/80 text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-fuchsia-100 transition"
                aria-label="Open menu"
                onClick={() => setMobileMoreOpen(true)}
                title="Menu"
              >
                <Menu size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile top drawer ("More") */}
        {mobileMoreOpen && (
          <div className="md:hidden">
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setMobileMoreOpen(false)} />
            <div className="fixed z-50 top-0 right-0 left-0 border-b border-zinc-200 bg-white/95 backdrop-blur">
              <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
                <div className="font-semibold text-zinc-900">Menu</div>
                <button
                  className="w-10 h-10 rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  onClick={() => setMobileMoreOpen(false)}
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-w-7xl mx-auto px-4 pb-4">
                {showRiderNav ? (
                  <div className="grid gap-2">
                    <button
                      className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                      onClick={() => nav("/supplier/orders")}
                    >
                      <Truck size={18} />
                      Supplier Orders
                    </button>

                    <button
                      className="w-full rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-left text-red-700 inline-flex items-center gap-2"
                      onClick={logout}
                    >
                      <LogOut size={18} />
                      Logout
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <button
                      className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                      onClick={() => nav("/")}
                    >
                      <LayoutGrid size={18} />
                      Catalogue
                    </button>

                    {showBuyerNav && (
                      <button
                        className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2 justify-between"
                        onClick={() => nav("/cart")}
                      >
                        <span className="inline-flex items-center gap-2">
                          <ShoppingCart size={18} />
                          Cart
                        </span>

                        {cartBadge > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-fuchsia-600 text-[10px] font-semibold text-white flex items-center justify-center">
                            {cartBadge > 9 ? "9+" : cartBadge}
                          </span>
                        )}
                      </button>
                    )}

                    {showSupplierNav && (
                      <button
                        className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                        onClick={() => nav("/supplier")}
                      >
                        <Store size={18} />
                        Supplier dashboard
                      </button>
                    )}

                    {token && !isSupplier && !isSuperAdmin && (
                      <button
                        className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                        onClick={() => nav("/dashboard")}
                      >
                        <User size={18} />
                        Dashboard
                      </button>
                    )}

                    {isAdmin && (
                      <>
                        <button
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                          onClick={() => nav("/admin")}
                        >
                          <Shield size={18} />
                          Admin
                        </button>
                        <button
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                          onClick={() => nav("/admin/offer-changes")}
                        >
                          <ClipboardList size={18} />
                          Offer approvals
                        </button>
                      </>
                    )}

                    <div className="h-px bg-zinc-100 my-2" />

                    {!token ? (
                      <div className="grid gap-2">
                        <button
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                          onClick={() => nav("/register-supplier")}
                        >
                          <Store size={18} />
                          Supply
                        </button>

                        <button
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                          onClick={() => nav("/login")}
                        >
                          <User size={18} />
                          Login
                        </button>

                        <button
                          className="w-full rounded-2xl bg-zinc-900 text-white px-3 py-3 text-left inline-flex items-center gap-2"
                          onClick={() => nav("/register")}
                        >
                          <CheckCircle2 size={18} />
                          Register
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <button
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                          onClick={() => nav("/profile")}
                        >
                          <User size={18} />
                          Edit profile
                        </button>

                        <button
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                          onClick={() => nav("/account/sessions")}
                        >
                          <Settings size={18} />
                          Sessions
                        </button>

                        {!isSupplier && (
                          <button
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left inline-flex items-center gap-2"
                            onClick={() => nav("/orders")}
                          >
                            <Package size={18} />
                            Purchase history
                          </button>
                        )}

                        <button
                          className="w-full rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-left text-red-700 inline-flex items-center gap-2"
                          onClick={logout}
                        >
                          <LogOut size={18} />
                          Logout
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Spacer so fixed header doesn't cover page content */}
      <div className="h-14 md:h-16" />

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 bg-white/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-around">
          {showRiderNav ? (
            <>
              <NavLink
                to="/supplier/orders"
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${
                    isActive ? "text-zinc-900" : "text-zinc-500"
                  }`
                }
              >
                <Truck size={20} />
                <span className="text-[10px]">Orders</span>
              </NavLink>

              <button
                className="flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-zinc-500"
                onClick={() => setMobileMoreOpen(true)}
              >
                <Menu size={20} />
                <span className="text-[10px]">More</span>
              </button>
            </>
          ) : (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${
                    isActive ? "text-zinc-900" : "text-zinc-500"
                  }`
                }
              >
                <LayoutGrid size={20} />
                <span className="text-[10px]">Shop</span>
              </NavLink>

              {showBuyerNav ? (
                <>
                  <NavLink
                    to="/cart"
                    className={({ isActive }) =>
                      `relative flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${
                        isActive ? "text-zinc-900" : "text-zinc-500"
                      }`
                    }
                    aria-label={cartBadge > 0 ? `Cart (${cartBadge})` : "Cart"}
                  >
                    <div className="relative">
                      <ShoppingCart size={20} />
                      {cartBadge > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-fuchsia-600 text-[10px] font-semibold text-white flex items-center justify-center">
                          {cartBadge > 9 ? "9+" : cartBadge}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px]">Cart</span>
                  </NavLink>

                  <NavLink
                    to="/wishlist"
                    className={({ isActive }) =>
                      `flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${
                        isActive ? "text-zinc-900" : "text-zinc-500"
                      }`
                    }
                  >
                    <Heart size={20} />
                    <span className="text-[10px]">Wish</span>
                  </NavLink>

                  <NavLink
                    to="/orders"
                    className={({ isActive }) =>
                      `flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${
                        isActive ? "text-zinc-900" : "text-zinc-500"
                      }`
                    }
                  >
                    <Package size={20} />
                    <span className="text-[10px]">Orders</span>
                  </NavLink>
                </>
              ) : (
                <>
                  {token && isSupplier && (
                    <NavLink
                      to="/supplier"
                      end
                      className={({ isActive }) =>
                        `flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${
                          isActive ? "text-zinc-900" : "text-zinc-500"
                        }`
                      }
                    >
                      <Store size={20} />
                      <span className="text-[10px]">Supplier</span>
                    </NavLink>
                  )}

                  {isAdmin && (
                    <NavLink
                      to="/admin"
                      className={({ isActive }) =>
                        `flex flex-col items-center gap-1 px-3 py-1 rounded-xl ${
                          isActive ? "text-zinc-900" : "text-zinc-500"
                        }`
                      }
                    >
                      <Shield size={20} />
                      <span className="text-[10px]">Admin</span>
                    </NavLink>
                  )}
                </>
              )}

              <button
                className="flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-zinc-500"
                onClick={() => setMobileMoreOpen(true)}
              >
                <Menu size={20} />
                <span className="text-[10px]">More</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Spacer so bottom nav doesn't cover content */}
      <div className="md:hidden h-16" />
    </>
  );
}
