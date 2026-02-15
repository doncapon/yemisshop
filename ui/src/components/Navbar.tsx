// src/components/Navbar.tsx
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "../store/auth";
import { performLogout } from "../utils/logout";
import NotificationsBell from "../components/notifications/NotificationsBell";
import DaySpringLogo from "../components/brand/DayspringLogo";
import { useCartCount } from "../hooks/useCartCount";
import api from "../api/client";

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

type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

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
  onPrefetch,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  badgeCount?: number;
  onPrefetch?: () => void;
}) {
  const count = Number(badgeCount || 0);

  return (
    <NavLink
      to={to}
      end={end}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
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
        <span
          className="
            absolute -top-1 -right-1
            grid place-items-center
            rounded-full bg-fuchsia-600 text-white font-semibold leading-none
            w-5 h-5 text-[10px]
            md:min-w-[20px] md:w-auto md:h-5 md:px-1.5
          "
        >
          {count > 9 ? "9+" : count}
        </span>
      )}

      <span className="hidden md:block absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 text-white text-[11px] px-2 py-1 opacity-0 group-hover:opacity-100 transition pointer-events-none">
        {label}
      </span>
    </NavLink>
  );
}

/* ---------------- Mobile menu UI helpers ---------------- */

function MobileMenuButton({
  icon,
  label,
  onClick,
  right,
  variant = "default",
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  right?: ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  const base =
    "w-full rounded-2xl border px-4 py-2.5 text-left inline-flex items-center gap-3 transition select-none";
  const text = "text-[14px] leading-5 font-semibold";
  const iconWrap = "w-5 h-5 inline-flex items-center justify-center shrink-0";
  const rightWrap = "ml-auto shrink-0";

  const styles =
    variant === "primary"
      ? "bg-zinc-900 text-white border-zinc-900 hover:opacity-95"
      : variant === "danger"
        ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
        : "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50";

  const iconColor = variant === "primary" ? "text-white" : "text-zinc-700";

  return (
    <button type="button" className={`${base} ${styles}`} onClick={onClick}>
      <span className={`${iconWrap} ${iconColor}`}>{icon}</span>
      <span className={text}>{label}</span>
      {right ? <span className={rightWrap}>{right}</span> : null}
    </button>
  );
}

export default function Navbar() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  const nav = useNavigate();
  const loc = useLocation();

  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickAway<HTMLDivElement>(() => setMenuOpen(false));

  // ✅ bootstrap once
  useEffect(() => {
    useAuthStore.getState().bootstrap().catch(() => null);
  }, []);

  const userRole = (user?.role ?? null) as Role | null;
  const userEmail = user?.email ?? null;

  const isSupplier = userRole === "SUPPLIER";
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";
  const isRider = userRole === "SUPPLIER_RIDER";

  const cartCount = useCartCount();

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
    performLogout("/", nav);
  }, [nav]);

  const brandHref = isRider ? "/supplier/orders" : "/";

  // ✅ close drawer on navigation
  useEffect(() => setMobileMoreOpen(false), [loc.pathname]);

  // ✅ Cookie-mode: logged in = we have a user in store
  const isLoggedIn = !!user?.id;

  const showShopNav = !isLoggedIn || (!isSupplier && !isSuperAdmin && !isRider);
  const showBuyerNav = isLoggedIn && !isSupplier && !isRider;
  const showSupplierNav = isLoggedIn && isSupplier && !isRider;
  const showRiderNav = isLoggedIn && isRider;

  // ✅ prevent background scroll when drawer is open
  useEffect(() => {
    if (!mobileMoreOpen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [mobileMoreOpen]);

  // ✅ verify cookie session with server so navbar never shows stale login
  const verifySession = useCallback(async () => {
    if (!useAuthStore.getState().user?.id) return;

    try {
      const { data } = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);
      if (data?.id) {
        useAuthStore.setState({ user: data });
      } else {
        useAuthStore.setState({ user: null });
      }
    } catch (e: any) {
      if (isAuthError(e)) {
        useAuthStore.setState({ user: null });
        setMenuOpen(false);
        setMobileMoreOpen(false);
      }
    }
  }, []);

  // ✅ Re-check on navigation
  useEffect(() => {
    verifySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);

  // ✅ Re-check when tab regains focus
  useEffect(() => {
    const onFocus = () => verifySession();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [verifySession]);

  // ✅ Prefetch wishlist so it shows instantly when opening Wishlist page
  const prefetchWishlist = useCallback(async () => {
    // If you are not logged in, no need to prefetch
    if (!useAuthStore.getState().user?.id) return;

    await qc.prefetchQuery({
      queryKey: ["wishlist"],
      queryFn: async () => {
        // Try /api/wishlist first, fallback to /api/favorites/mine
        try {
          const { data } = await api.get("/api/wishlist", AXIOS_COOKIE_CFG);
          if (Array.isArray((data as any)?.items)) return (data as any).items;
          if (Array.isArray((data as any)?.data)) return (data as any).data;
          if (Array.isArray(data)) return data;
          return [];
        } catch {
          const { data } = await api.get("/api/favorites/mine", AXIOS_COOKIE_CFG);
          if (Array.isArray((data as any)?.items)) return (data as any).items;
          if (Array.isArray((data as any)?.data)) return (data as any).data;
          if (Array.isArray(data)) return data;
          return [];
        }
      },
      staleTime: 15_000,
    });
  }, [qc]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 w-full border-b border-zinc-200 bg-white">
        <div className="w-full max-w-7xl mx-auto h-14 md:h-16 px-3 sm:px-4 md:px-8 flex items-center justify-between gap-2">
          {/* LEFT */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to={brandHref}
              className="inline-flex items-center hover:opacity-95 min-w-0 max-w-[52vw] xs:max-w-[56vw] sm:max-w-none overflow-hidden"
              aria-label="DaySpring home"
              title="DaySpring"
            >
              <span className="block origin-left scale-[0.92] xs:scale-95 sm:scale-100">
                <DaySpringLogo size={28} />
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-2 ml-2">
              {showRiderNav ? (
                <IconNavLink to="/supplier/orders" icon={<Truck size={18} />} label="Orders" />
              ) : (
                <>
                  <IconNavLink
                    to="/"
                    end
                    icon={showShopNav ? <LayoutGrid size={18} /> : <Home size={18} />}
                    label="Catalogue"
                  />

                  {showSupplierNav && (
                    <IconNavLink to="/supplier" end icon={<Store size={18} />} label="Supplier dashboard" />
                  )}

                  {isLoggedIn && isSuperAdmin && (
                    <IconNavLink
                      to="/supplier"
                      end
                      icon={<CheckCircle2 size={18} />}
                      label="Supplier dashboard"
                    />
                  )}

                  {isLoggedIn && !isSupplier && !isSuperAdmin && (
                    <IconNavLink to="/dashboard" end icon={<User size={18} />} label="Dashboard" />
                  )}

                  {showBuyerNav && (
                    <>
                      <IconNavLink
                        to="/cart"
                        icon={<ShoppingCart size={18} />}
                        label="Cart"
                        badgeCount={cartCount.distinct}
                      />
                      <IconNavLink
                        to="/wishlist"
                        end
                        icon={<Heart size={18} />}
                        label="Wishlist"
                        onPrefetch={prefetchWishlist}
                      />
                      <IconNavLink to="/orders" end icon={<Package size={18} />} label="Orders" />
                    </>
                  )}

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
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:block">
              <NotificationsBell placement="navbar" />
            </div>

            <div className="hidden md:flex items-center gap-2">
              {!isLoggedIn ? (
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
                          : "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50"
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
                  <div className="relative" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setMenuOpen((v) => !v)}
                      className="w-10 h-10 rounded-2xl grid place-items-center border border-zinc-200 bg-white text-zinc-900 font-semibold hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-fuchsia-100 transition"
                      aria-label="User menu"
                      title="Account"
                    >
                      {initials}
                    </button>

                    {menuOpen && (
                      <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden" role="menu">
                        <div className="px-3 py-3 border-b border-zinc-100 bg-zinc-50">
                          <div className="text-xs text-zinc-500">Signed in as</div>
                          <div className="text-sm font-semibold truncate text-zinc-900">
                            {displayName || userEmail || "User"}
                          </div>
                          {userEmail && <div className="text-[10px] text-zinc-500 truncate">{userEmail}</div>}
                        </div>

                        {isRider ? (
                          <nav className="py-1 text-sm">
                            <button
                              type="button"
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
                              type="button"
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
                              type="button"
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
                              type="button"
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
                                type="button"
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
                                type="button"
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
                              type="button"
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

            {/* Mobile */}
            <div className="md:hidden flex items-center gap-2 shrink-0">
              <NotificationsBell placement="navbar" />

              {showBuyerNav && (
                <NavLink
                  to="/wishlist"
                  onTouchStart={prefetchWishlist}
                  onMouseEnter={prefetchWishlist}
                  className={({ isActive }) =>
                    `inline-flex items-center justify-center w-10 h-10 rounded-2xl border border-zinc-200 bg-white transition ${
                      isActive ? "text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                    }`
                  }
                  aria-label="Wishlist"
                  title="Wishlist"
                >
                  <Heart size={18} />
                </NavLink>
              )}

              <button
                type="button"
                className="inline-flex items-center justify-center w-10 h-10 rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-fuchsia-100 transition"
                aria-label="Open menu"
                onClick={() => setMobileMoreOpen(true)}
                title="Menu"
              >
                <Menu size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile drawer */}
        {mobileMoreOpen && (
          <div className="md:hidden">
            <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setMobileMoreOpen(false)} />
            <div className="fixed inset-y-0 right-0 z-50 w-[88vw] max-w-sm bg-white border-l border-zinc-200 shadow-2xl flex flex-col">
              <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between shrink-0 relative">
                <div className="text-base font-semibold text-zinc-900">Menu</div>
                <button
                  type="button"
                  onClick={() => setMobileMoreOpen(false)}
                  aria-label="Close menu"
                  title="Close"
                  className="w-11 h-11 -mr-1 rounded-full border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 grid place-items-center active:scale-95 focus:outline-none focus:ring-4 focus:ring-fuchsia-100 touch-manipulation"
                >
                  <X size={18} className="pointer-events-none" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 overscroll-contain">
                <div className="grid gap-2">
                  {showRiderNav ? (
                    <>
                      <MobileMenuButton
                        icon={<Truck size={18} />}
                        label="Orders"
                        onClick={() => {
                          setMobileMoreOpen(false);
                          nav("/supplier/orders");
                        }}
                      />
                      <MobileMenuButton icon={<LogOut size={18} />} label="Logout" variant="danger" onClick={logout} />
                    </>
                  ) : (
                    <>
                      <MobileMenuButton
                        icon={<LayoutGrid size={18} />}
                        label="Catalogue"
                        onClick={() => {
                          setMobileMoreOpen(false);
                          nav("/");
                        }}
                      />

                      {showBuyerNav && (
                        <>
                          <MobileMenuButton
                            icon={<ShoppingCart size={18} />}
                            label="Cart"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/cart");
                            }}
                            right={
                              cartCount.totalQty > 0 ? (
                                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-fuchsia-600 text-[10px] font-semibold text-white flex items-center justify-center">
                                  {cartCount.totalQty > 9 ? "9+" : cartCount.totalQty}
                                </span>
                              ) : null
                            }
                          />

                          <MobileMenuButton
                            icon={<Heart size={18} />}
                            label="Wishlist"
                            onClick={() => {
                              prefetchWishlist();
                              setMobileMoreOpen(false);
                              nav("/wishlist");
                            }}
                          />
                        </>
                      )}

                      {showSupplierNav && (
                        <MobileMenuButton
                          icon={<Store size={18} />}
                          label="Supplier dashboard"
                          onClick={() => {
                            setMobileMoreOpen(false);
                            nav("/supplier");
                          }}
                        />
                      )}

                      {isLoggedIn && !isSupplier && !isSuperAdmin && !isRider && (
                        <MobileMenuButton
                          icon={<User size={18} />}
                          label="Dashboard"
                          onClick={() => {
                            setMobileMoreOpen(false);
                            nav("/dashboard");
                          }}
                        />
                      )}

                      {isAdmin && (
                        <>
                          <MobileMenuButton
                            icon={<Shield size={18} />}
                            label="Admin"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/admin");
                            }}
                          />
                          <MobileMenuButton
                            icon={<ClipboardList size={18} />}
                            label="Offer approvals"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/admin/offer-changes");
                            }}
                          />
                        </>
                      )}

                      <div className="h-px bg-zinc-100 my-2" />

                      {!isLoggedIn ? (
                        <>
                          <MobileMenuButton
                            icon={<Store size={18} />}
                            label="Supply"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/register-supplier");
                            }}
                          />
                          <MobileMenuButton
                            icon={<User size={18} />}
                            label="Login"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/login");
                            }}
                          />
                          <MobileMenuButton
                            icon={<CheckCircle2 size={18} />}
                            label="Register"
                            variant="primary"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/register");
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <MobileMenuButton
                            icon={<User size={18} />}
                            label="Edit profile"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/profile");
                            }}
                          />
                          <MobileMenuButton
                            icon={<Settings size={18} />}
                            label="Sessions"
                            onClick={() => {
                              setMobileMoreOpen(false);
                              nav("/account/sessions");
                            }}
                          />
                          {!isSupplier && (
                            <MobileMenuButton
                              icon={<Package size={18} />}
                              label="Purchase history"
                              onClick={() => {
                                setMobileMoreOpen(false);
                                nav("/orders");
                              }}
                            />
                          )}
                          <MobileMenuButton icon={<LogOut size={18} />} label="Logout" variant="danger" onClick={logout} />
                        </>
                      )}
                    </>
                  )}
                </div>

                <div className="h-6 pb-[env(safe-area-inset-bottom)]" />
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="h-14 md:h-16" />
      <div className="md:hidden h-2" />
      {!hydrated && <div className="sr-only">Loading session…</div>}
    </>
  );
}
