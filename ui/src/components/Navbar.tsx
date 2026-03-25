// src/components/Navbar.tsx
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "../store/auth";
import NotificationsBell from "../components/notifications/NotificationsBell";
import DaySpringLogo from "../components/brand/DayspringLogo";
import api from "../api/client";
import { readCartLines, writeCartLines } from "../utils/cartModel";
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
  RotateCcw,
} from "lucide-react";
import { performLogout } from "../utils/logout";

type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

const AXIOS_COOKIE_CFG = { withCredentials: true as const };
const CART_MERGE_SESSION_KEY = "cart:mergedForUser:v1";

type GuestCartLine = {
  productId?: string;
  variantId?: string | null;
  kind?: "BASE" | "VARIANT";
  qty?: number;
  selectedOptions?: any;
  optionsKey?: string;
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
};

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

function safeInt(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function getCartQtyFromStorage(): number {
  try {
    const lines = readCartLines();
    return (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
      const qty = Math.max(0, Number((line as any)?.qty) || 0);
      return sum + qty;
    }, 0);
  } catch {
    return 0;
  }
}

function clearCartStorageAndBroadcast() {
  try {
    writeCartLines([] as any);
  } catch {
    //
  }

  try {
    window.dispatchEvent(new Event("cart:updated"));
  } catch {
    //
  }
}

function readGuestCartLines(): GuestCartLine[] {
  try {
    const raw = readCartLines();
    return Array.isArray(raw) ? (raw as GuestCartLine[]) : [];
  } catch {
    return [];
  }
}

function normalizeGuestCartForMerge(lines: GuestCartLine[]) {
  return lines
    .map((line) => {
      const productId = String(line?.productId ?? "").trim();
      if (!productId) return null;

      const variantId =
        line?.variantId == null || String(line.variantId).trim() === ""
          ? null
          : String(line.variantId).trim();

      const kind: "BASE" | "VARIANT" =
        line?.kind === "BASE" || line?.kind === "VARIANT"
          ? line.kind
          : variantId
            ? "VARIANT"
            : "BASE";

      return {
        productId,
        variantId,
        kind,
        qty: Math.max(1, safeInt(line?.qty, 1)),
        selectedOptions: Array.isArray(line?.selectedOptions)
          ? line.selectedOptions
          : line?.selectedOptions
            ? [line.selectedOptions]
            : [],
        optionsKey: String(line?.optionsKey ?? ""),
        titleSnapshot:
          line?.titleSnapshot == null ? null : String(line.titleSnapshot),
        imageSnapshot:
          line?.imageSnapshot == null ? null : String(line.imageSnapshot),
        unitPriceCache:
          line?.unitPriceCache == null || !Number.isFinite(Number(line.unitPriceCache))
            ? null
            : Number(line.unitPriceCache),
      };
    })
    .filter(Boolean);
}

function buildMergeFingerprint(lines: GuestCartLine[]) {
  const normalized = normalizeGuestCartForMerge(lines).sort((a: any, b: any) => {
    const ak = `${a.productId}|${a.variantId ?? ""}|${a.kind}|${a.optionsKey}|${a.qty}`;
    const bk = `${b.productId}|${b.variantId ?? ""}|${b.kind}|${b.optionsKey}|${b.qty}`;
    return ak.localeCompare(bk);
  });

  return JSON.stringify(normalized);
}

function getMergedSessionValue(userId: string) {
  try {
    return sessionStorage.getItem(`${CART_MERGE_SESSION_KEY}:${userId}`) || "";
  } catch {
    return "";
  }
}

function setMergedSessionValue(userId: string, fingerprint: string) {
  try {
    sessionStorage.setItem(`${CART_MERGE_SESSION_KEY}:${userId}`, fingerprint);
  } catch {
    //
  }
}

function clearMergedSessionValue(userId?: string | null) {
  if (!userId) return;
  try {
    sessionStorage.removeItem(`${CART_MERGE_SESSION_KEY}:${userId}`);
  } catch {
    //
  }
}

function useClickAway<T extends HTMLElement>(onAway: () => void) {
  const ref = useRef<T | null>(null);
  const onAwayRef = useRef(onAway);

  useEffect(() => {
    onAwayRef.current = onAway;
  }, [onAway]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) onAwayRef.current?.();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return ref;
}

function isExternalHref(to: string) {
  return /^(https?:)?\/\//i.test(String(to || ""));
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
  hardNavigate = false,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  badgeCount?: number;
  onPrefetch?: () => void;
  hardNavigate?: boolean;
}) {
  const count = Number(badgeCount || 0);

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (disabled) {
        e.preventDefault();
        return;
      }

      onClick?.();

      if (!hardNavigate || !isExternalHref(to)) return;

      e.preventDefault();
      window.location.assign(to);
    },
    [disabled, onClick, hardNavigate, to]
  );

  return (
    <NavLink
      to={to}
      end={end}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onClick={handleClick}
      className={({ isActive }) => {
        const base =
          "group relative inline-flex items-center justify-center rounded-xl border px-2.5 py-2 transition select-none";
        const active = "bg-zinc-900 text-white border-zinc-900 shadow-sm";
        const idle = "bg-white/80 text-zinc-700 border-zinc-200 hover:bg-zinc-50";
        const dis = "opacity-50 pointer-events-none";
        return `${base} ${isActive ? active : idle} ${disabled ? dis : ""}`;
      }}
      aria-label={label}
    >
      <span className="inline-flex items-center justify-center pointer-events-none">{icon}</span>

      {count > 0 && (
        <span
          className="
            pointer-events-none
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
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  const loc = useLocation();
  const pathname = loc.pathname.toLowerCase();

  const isLoginPage =
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";

  const isRegisterPage =
    pathname === "/register" ||
    pathname.startsWith("/register/");

  const isSupplierRegisterPage =
    pathname === "/register-supplier" ||
    pathname.startsWith("/register-supplier/");

  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartQty, setCartQty] = useState<number>(() => getCartQtyFromStorage());
  const [cartSyncing, setCartSyncing] = useState(false);

  const closeUserMenu = useCallback(() => setMenuOpen(false), []);
  const menuRef = useClickAway<HTMLDivElement>(closeUserMenu);

  const userRole = (user?.role ?? null) as Role | null;
  const userEmail = user?.email ?? null;
  const roleNorm = normRole(userRole);

  const isSupplier = roleNorm === "SUPPLIER";
  const isSuperAdmin = roleNorm === "SUPER_ADMIN";
  const isAdmin = roleNorm === "ADMIN" || roleNorm === "SUPER_ADMIN";
  const isRider = roleNorm === "SUPPLIER_RIDER";

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

  const hardGo = useCallback(
    (to: string) => {
      setMenuOpen(false);
      setMobileMoreOpen(false);

      if (isExternalHref(to)) {
        window.location.assign(to);
        return;
      }

      navigate(to);
    },
    [navigate]
  );

  const syncGuestCartQty = useCallback(() => {
    const nextQty = getCartQtyFromStorage();
    setCartQty((prev) => (prev === nextQty ? prev : nextQty));
  }, []);

  const fetchServerCartQty = useCallback(async () => {
    if (!useAuthStore.getState().user?.id) return 0;

    try {
      const { data } = await api.get("/api/cart/summary", AXIOS_COOKIE_CFG);
      const totalQty = Math.max(0, Number(data?.totalQty || 0));
      setCartQty((prev) => (prev === totalQty ? prev : totalQty));
      return totalQty;
    } catch (e: any) {
      if (isAuthError(e)) {
        setCartQty(0);
        return 0;
      }
      throw e;
    }
  }, []);

  const syncCartQty = useCallback(async () => {
    const currentUser = useAuthStore.getState().user;
    if (!currentUser?.id) {
      syncGuestCartQty();
      return;
    }
    await fetchServerCartQty();
  }, [fetchServerCartQty, syncGuestCartQty]);

  const mergeGuestCartIntoServerOnce = useCallback(async () => {
    const currentUser = useAuthStore.getState().user;
    const userId = String(currentUser?.id ?? "").trim();

    if (!userId) {
      syncGuestCartQty();
      return;
    }

    const guestLines = readGuestCartLines();
    const guestQty = guestLines.reduce((sum, line) => sum + Math.max(0, safeInt(line?.qty, 0)), 0);

    if (!guestQty) {
      await fetchServerCartQty();
      setMergedSessionValue(userId, "EMPTY");
      return;
    }

    const fingerprint = buildMergeFingerprint(guestLines);
    const alreadyMerged = getMergedSessionValue(userId);

    if (alreadyMerged && alreadyMerged === fingerprint) {
      await fetchServerCartQty();
      return;
    }

    const payload = normalizeGuestCartForMerge(guestLines);
    if (!payload.length) {
      clearCartStorageAndBroadcast();
      await fetchServerCartQty();
      setMergedSessionValue(userId, "EMPTY_NORMALIZED");
      return;
    }

    setCartSyncing(true);

    try {
      await api.post(
        "/api/cart/merge",
        { items: payload },
        AXIOS_COOKIE_CFG
      );

      clearCartStorageAndBroadcast();
      setMergedSessionValue(userId, fingerprint);
      await fetchServerCartQty();
    } catch (e) {
      // Keep local cart intact if merge fails.
      syncGuestCartQty();
      throw e;
    } finally {
      setCartSyncing(false);
    }
  }, [fetchServerCartQty, syncGuestCartQty]);

  const logout = useCallback(async () => {
    setMenuOpen(false);
    setMobileMoreOpen(false);

    const currentUserId = String(useAuthStore.getState().user?.id ?? "").trim() || null;
    const target = `${loc.pathname}${loc.search}`;

    try {
      sessionStorage.setItem("auth:returnTo", target);
    } catch {
      //
    }

    clearMergedSessionValue(currentUserId);
    clearCartStorageAndBroadcast();
    setCartQty(0);

    try {
      useAuthStore.setState({ user: null });
    } catch {
      //
    }

    try {
      window.dispatchEvent(new Event("auth:logout"));
    } catch {
      //
    }

    const qp = encodeURIComponent(target);
    await performLogout(`/login?from=${qp}`);
  }, [loc.pathname, loc.search]);

  const brandHref = isRider ? "/supplier/orders" : "/";

  useEffect(() => setMobileMoreOpen(false), [loc.pathname]);

  const isLoggedIn = !!user?.id;

  const showShopNav = !isLoggedIn || (!isSupplier && !isSuperAdmin && !isRider);
  const showBuyerNav = isLoggedIn && !isSupplier && !isRider;
  const showCartDesktop = !isSupplier && !isRider;
  const showSupplierNav = isLoggedIn && isSupplier && !isRider;
  const showRiderNav = isLoggedIn && isRider;
  const showCartMobile = !isSupplier && !isRider;

  useEffect(() => {
    if (!hydrated) return;

    if (!user?.id) {
      syncGuestCartQty();
      return;
    }

    void mergeGuestCartIntoServerOnce();
  }, [hydrated, user?.id, mergeGuestCartIntoServerOnce, syncGuestCartQty]);

  useEffect(() => {
    const onCartUpdated = () => {
      void syncCartQty();
    };

    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.toLowerCase().includes("cart")) {
        void syncCartQty();
      }
      if (e.key && e.key.startsWith(CART_MERGE_SESSION_KEY)) {
        void syncCartQty();
      }
    };

    const onFocus = () => {
      void syncCartQty();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void syncCartQty();
      }
    };

    window.addEventListener("cart:updated", onCartUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("cart:updated", onCartUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncCartQty]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [mobileMoreOpen]);

  const [forced, setForced] = useState(() => {
    try {
      return sessionStorage.getItem("auth:forcedLogout") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "auth:forcedLogout") setForced(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const verifySession = useCallback(async () => {
    if (forced) return;

    const st = useAuthStore.getState();
    if (!st.hydrated) return;
    if (!st.user?.id) return;

    try {
      const res = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);
      const data = res?.data?.data ?? res?.data ?? null;

      if (data?.id) {
        useAuthStore.setState({
          user: {
            ...(st.user ?? {}),
            ...data,
          },
        });
      }
    } catch (e: any) {
      if (!isAuthError(e)) return;
    }
  }, [forced]);

  useEffect(() => {
    const onFocus = () => void verifySession();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [verifySession]);

  useEffect(() => {
    const onLogout = () => {
      setMenuOpen(false);
      setMobileMoreOpen(false);
      clearCartStorageAndBroadcast();
      setCartQty(0);
    };

    window.addEventListener("auth:logout", onLogout as EventListener);

    return () => {
      window.removeEventListener("auth:logout", onLogout as EventListener);
    };
  }, []);

  const prefetchWishlist = useCallback(async () => {
    if (!useAuthStore.getState().user?.id) return;

    await qc.prefetchQuery({
      queryKey: ["wishlist"],
      queryFn: async () => {
        try {
          const { data } = await api.get("/wishlist", AXIOS_COOKIE_CFG);
          if (Array.isArray((data as any)?.items)) return (data as any).items;
          if (Array.isArray((data as any)?.data)) return (data as any).data;
          if (Array.isArray(data)) return data;
          return [];
        } catch (e: any) {
          if (isAuthError(e)) return [];
          const { data } = await api.get("/favorites/mine", AXIOS_COOKIE_CFG);
          if (Array.isArray((data as any)?.items)) return (data as any).items;
          if (Array.isArray((data as any)?.data)) return (data as any).data;
          if (Array.isArray(data)) return data;
          return [];
        }
      },
      staleTime: 15_000,
    });
  }, [qc]);

  if (forced) return null;

  const returnsHref = "/returns-refunds";

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 w-full border-b border-zinc-200 bg-white">
        <div className="w-full max-w-7xl mx-auto h-14 md:h-16 px-3 sm:px-4 md:px-8 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <a
              href={brandHref}
              onClick={(e) => {
                e.preventDefault();
                hardGo(brandHref);
              }}
              className="inline-flex items-center hover:opacity-95 min-w-0 max-w-[52vw] xs:max-w-[56vw] sm:max-w-none overflow-hidden"
              aria-label="DaySpring home"
              title="DaySpring"
            >
              <span className="block origin-left scale-[0.92] xs:scale-95 sm:scale-100 pointer-events-none">
                <DaySpringLogo size={28} />
              </span>
            </a>

            <nav className="hidden md:flex items-center gap-2 ml-2">
              {showRiderNav ? (
                <IconNavLink to="/supplier/orders" end icon={<Truck size={18} />} label="Orders" />
              ) : (
                <>
                  <IconNavLink
                    to={isSupplier ? "/supplier/catalog-offers" : "/"}
                    end={!isSupplier}
                    icon={showShopNav ? <LayoutGrid size={18} /> : <Home size={18} />}
                    label="Products"
                  />

                  {showSupplierNav && (
                    <IconNavLink to="/supplier" end icon={<Store size={18} />} label="Supplier dashboard" />
                  )}

                  {isLoggedIn && isSuperAdmin && (
                    <IconNavLink to="/supplier" end icon={<CheckCircle2 size={18} />} label="Supplier dashboard" />
                  )}

                  {isLoggedIn && !isSupplier && !isSuperAdmin && !isRider && (
                    <IconNavLink to="/dashboard" end icon={<User size={18} />} label="Dashboard" />
                  )}

                  {isLoggedIn && isSuperAdmin && (
                    <IconNavLink to="/customer-dashboard" end icon={<User size={18} />} label="Customer dashboard" />
                  )}

                  {!showRiderNav && showCartDesktop && (
                    <IconNavLink
                      to="/cart"
                      end
                      icon={<ShoppingCart size={18} />}
                      label="Cart"
                      badgeCount={cartQty}
                    />
                  )}

                  {showBuyerNav && (
                    <>
                      <IconNavLink
                        to="/wishlist"
                        end
                        icon={<Heart size={18} />}
                        label="Wishlist"
                        onPrefetch={prefetchWishlist}
                      />
                      <IconNavLink to="/orders" end icon={<Package size={18} />} label="Orders" />
                      <IconNavLink
                        to={returnsHref}
                        end
                        icon={<RotateCcw size={18} />}
                        label="Returns"
                      />
                    </>
                  )}

                  {isAdmin && (
                    <IconNavLink
                      to="/admin/offer-changes"
                      end
                      icon={<ClipboardList size={18} />}
                      label="Offer approvals"
                    />
                  )}

                  {isAdmin && (
                    <IconNavLink
                      to="/admin/shipping"
                      end
                      icon={<Truck size={18} />}
                      label="Shipping"
                    />
                  )}

                  {isAdmin && (
                    <IconNavLink
                      to="/admin"
                      end
                      icon={<Shield size={18} />}
                      label="Admin"
                    />
                  )}
                </>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:block">
              <NotificationsBell placement="navbar" />
            </div>

            <div className="hidden md:flex items-center gap-2">
              {!isLoggedIn ? (
                <>
                  <button
                    type="button"
                    onClick={() => hardGo("/register-supplier")}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${isSupplierRegisterPage
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50"
                      }`}
                    title="Become a supplier"
                  >
                    <Store size={16} />
                    <span className="hidden lg:inline">Become a supplier</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const target = `${loc.pathname}${loc.search}`;
                      const qp = encodeURIComponent(target);
                      hardGo(`/login?from=${qp}`);
                    }}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${isLoginPage
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50"
                      }`}
                    title="Login"
                  >
                    <User size={16} />
                    <span className="hidden lg:inline">Login</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => hardGo("/register")}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${isRegisterPage
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50"
                      }`}
                    title="Register"
                  >
                    <CheckCircle2 size={16} />
                    <span className="hidden lg:inline">Register</span>
                  </button>
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
                      <div
                        className="absolute right-0 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden"
                        role="menu"
                      >
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
                              onClick={() => hardGo("/supplier/orders")}
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
                              onClick={() => hardGo("/profile")}
                              role="menuitem"
                            >
                              <User size={16} />
                              Edit Profile
                            </button>

                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                              onClick={() => hardGo("/account/sessions")}
                              role="menuitem"
                            >
                              <Settings size={16} />
                              Sessions
                            </button>

                            {isSuperAdmin && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                                onClick={() => hardGo("/customer-dashboard")}
                                role="menuitem"
                              >
                                <User size={16} />
                                Customer dashboard
                              </button>
                            )}

                            {!isSupplier && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                                onClick={() => hardGo("/orders")}
                                role="menuitem"
                              >
                                <Package size={16} />
                                Purchase history
                              </button>
                            )}

                            {!isSupplier && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                                onClick={() => hardGo(returnsHref)}
                                role="menuitem"
                              >
                                <RotateCcw size={16} />
                                Returns &amp; refunds
                              </button>
                            )}

                            {roleNorm === "SUPER_ADMIN" && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition inline-flex items-center gap-2"
                                onClick={() => hardGo("/admin/settings")}
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

            <div className="md:hidden flex items-center gap-2 shrink-0">
              <NotificationsBell placement="navbar" />

              {showCartMobile && (
                <NavLink
                  to="/cart"
                  end
                  onClick={(e) => {
                    e.preventDefault();
                    hardGo("/cart");
                  }}
                  className={({ isActive }) =>
                    `relative inline-flex items-center justify-center w-10 h-10 rounded-2xl border border-zinc-200 bg-white transition ${isActive ? "text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                    }`
                  }
                  aria-label="Cart"
                  title="Cart"
                >
                  <ShoppingCart size={18} className="pointer-events-none" />
                  {cartQty > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-fuchsia-600 text-[10px] font-semibold text-white flex items-center justify-center">
                      {cartQty > 9 ? "9+" : cartQty}
                    </span>
                  )}
                </NavLink>
              )}

              <button
                type="button"
                className="inline-flex items-center justify-center w-10 h-10 rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-fuchsia-100 transition"
                aria-label="Open menu"
                onClick={() => setMobileMoreOpen(true)}
                title="Menu"
              >
                <Menu size={18} className="pointer-events-none" />
              </button>
            </div>
          </div>
        </div>

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
                        onClick={() => hardGo("/supplier/orders")}
                      />
                      <MobileMenuButton icon={<LogOut size={18} />} label="Logout" variant="danger" onClick={logout} />
                    </>
                  ) : (
                    <>
                      <MobileMenuButton
                        icon={<LayoutGrid size={18} />}
                        label="Products"
                        onClick={() => hardGo(isSupplier ? "/supplier/catalog-offers" : "/")}
                      />

                      {showBuyerNav && (
                        <MobileMenuButton
                          icon={<Heart size={18} />}
                          label="Wishlist"
                          onClick={() => {
                            void prefetchWishlist();
                            hardGo("/wishlist");
                          }}
                        />
                      )}

                      {showBuyerNav && (
                        <MobileMenuButton
                          icon={<Package size={18} />}
                          label="Orders"
                          onClick={() => hardGo("/orders")}
                        />
                      )}

                      {showBuyerNav && (
                        <MobileMenuButton
                          icon={<RotateCcw size={18} />}
                          label="Returns & refunds"
                          onClick={() => hardGo(returnsHref)}
                        />
                      )}

                      {showSupplierNav && (
                        <MobileMenuButton
                          icon={<Store size={18} />}
                          label="Supplier dashboard"
                          onClick={() => hardGo("/supplier")}
                        />
                      )}

                      {isLoggedIn && isSuperAdmin && (
                        <MobileMenuButton
                          icon={<User size={18} />}
                          label="Customer dashboard"
                          onClick={() => hardGo("/customer-dashboard")}
                        />
                      )}

                      {isLoggedIn && !isSupplier && !isSuperAdmin && !isRider && (
                        <MobileMenuButton
                          icon={<User size={18} />}
                          label="Dashboard"
                          onClick={() => hardGo("/dashboard")}
                        />
                      )}

                      {isAdmin && (
                        <>
                          <MobileMenuButton
                            icon={<ClipboardList size={18} />}
                            label="Offer approvals"
                            onClick={() => hardGo("/admin/offer-changes")}
                          />

                          <MobileMenuButton
                            icon={<Truck size={18} />}
                            label="Shipping"
                            onClick={() => hardGo("/admin/shipping")}
                          />

                          <MobileMenuButton
                            icon={<Shield size={18} />}
                            label="Admin"
                            onClick={() => hardGo("/admin")}
                          />
                        </>
                      )}
                      <div className="h-px bg-zinc-100 my-2" />

                      {!isLoggedIn ? (
                        <>
                          <MobileMenuButton
                            icon={<Store size={18} />}
                            label="Become a supplier"
                            onClick={() => hardGo("/register-supplier")}
                          />
                          <MobileMenuButton
                            icon={<User size={18} />}
                            label="Login"
                            onClick={() => {
                              const target = `${loc.pathname}${loc.search}`;
                              const qp = encodeURIComponent(target);
                              hardGo(`/login?from=${qp}`);
                            }}
                          />
                          <MobileMenuButton
                            icon={<CheckCircle2 size={18} />}
                            label="Register"
                            variant="primary"
                            onClick={() => hardGo("/register")}
                          />
                        </>
                      ) : (
                        <>
                          <MobileMenuButton
                            icon={<User size={18} />}
                            label="Edit profile"
                            onClick={() => hardGo("/profile")}
                          />
                          <MobileMenuButton
                            icon={<Settings size={18} />}
                            label="Sessions"
                            onClick={() => hardGo("/account/sessions")}
                          />
                          <MobileMenuButton
                            icon={<LogOut size={18} />}
                            label="Logout"
                            variant="danger"
                            onClick={logout}
                          />
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
      {!hydrated && <div className="sr-only">Loading session…</div>}
      {cartSyncing && <div className="sr-only">Syncing cart…</div>}
    </>
  );
}