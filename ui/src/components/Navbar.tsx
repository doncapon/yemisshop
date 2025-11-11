// src/components/Navbar.tsx
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useAuthStore } from "../store/auth";
import api from "../api/client";
import { hardResetApp } from "../utils/resetApp";

type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER";

type MeResponse = {
  id: string;
  email: string;
  role: Role;
  status: "PENDING" | "PARTIAL" | "VERIFIED";
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

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

export default function Navbar() {
  const token = useAuthStore((s) => s.token);
  const userRole = useAuthStore((s) => s.user?.role ?? null);
  const userEmail = useAuthStore((s) => s.user?.email ?? null);
  const clear = useAuthStore((s) => s.clear);
  const nav = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickAway<HTMLDivElement>(() => setMenuOpen(false));

  const [firstName, setFirstName] = useState<string | null>(null);
  const [middleName, setMiddleName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

  // Load /me when token changes
  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
      if (!token) {
        setFirstName(null);
        setMiddleName(null);
        setLastName(null);
        return;
      }
      try {
        const { data } = await api.get<MeResponse>("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!cancelled) {
          setFirstName(data.firstName?.trim() || null);
          setMiddleName(data.middleName?.trim() || null);
          setLastName(data.lastName?.trim() || null);
        }
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 401 || status === 403) {
          hardResetApp("/");
          return;
        }
        hardResetApp("/");
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
    clear();
    try {
      localStorage.removeItem("cart");
      localStorage.removeItem("auth");
    } catch {
      //
    }
    nav("/");
  }, [clear, nav]);

  const linkBase =
    "inline-flex items-center px-3 py-2 rounded-md text-sm font-medium transition";
  const linkInactive =
    "text-white/90 hover:bg-white/10";
  const linkActive =
    "text-white bg-white/20";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-primary-800/40 bg-primary-900/95 backdrop-blur">
      <div className="max-w-6xl mx-auto h-14 md:h-16 px-4 md:px-6 flex items-center gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="text-white text-lg font-bold tracking-tight hover:opacity-95"
            aria-label="DaySpring home"
          >
            DaySpring
          </Link>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-1 ml-3">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Catalogue
          </NavLink>

          {token && (
            <NavLink
              to="/dashboard"
              end
              className={({ isActive }) =>
                `${linkBase} ${isActive ? linkActive : linkInactive}`
              }
            >
              Dashboard
            </NavLink>
          )}

          <NavLink
            to="/cart"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Cart
          </NavLink>

          {token && (
            <NavLink
              to="/wishlist"
              end
              className={({ isActive }) =>
                `${linkBase} ${isActive ? linkActive : linkInactive}`
              }
            >
              Wishlist
            </NavLink>
          )}

          {token && (
            <NavLink
              to="/orders"
              end
              className={({ isActive }) =>
                `${linkBase} ${isActive ? linkActive : linkInactive}`
              }
            >
              Orders
            </NavLink>
          )}

          {(userRole === "ADMIN" || userRole === "SUPER_ADMIN") && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `${linkBase} ${isActive ? linkActive : linkInactive}`
              }
            >
              Admin
            </NavLink>
          )}
        </nav>

        {/* Spacer */}
        <div className="ml-auto" />

        {/* Desktop auth / avatar */}
        <div className="hidden md:flex items-center gap-3">
          {!token ? (
            <>
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `${linkBase} ${
                    isActive
                      ? "bg-white text-primary-900"
                      : "border border-white/25 text-white hover:bg-white/10"
                  }`
                }
              >
                Login
              </NavLink>
              <NavLink
                to="/register"
                className="inline-flex items-center px-3 py-2 rounded-md text-sm font-semibold text-primary-800 bg-white hover:bg-zinc-50 transition"
              >
                Register
              </NavLink>
            </>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full grid place-items-center border border-white/25 bg-white/10 text-white font-semibold hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/25 transition"
                aria-label="User menu"
              >
                {initials}
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden"
                  role="menu"
                >
                  <div className="px-3 py-3 border-b border-zinc-100 bg-zinc-50">
                    <div className="text-xs text-zinc-500">
                      Signed in as
                    </div>
                    <div className="text-sm font-medium truncate text-zinc-900">
                      {displayName || userEmail || "User"}
                    </div>
                    {userEmail && (
                      <div className="text-[10px] text-zinc-500 truncate">
                        {userEmail}
                      </div>
                    )}
                  </div>
                  <nav className="py-1 text-sm">
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition"
                      onClick={() => {
                        setMenuOpen(false);
                        nav("/profile");
                      }}
                      role="menuitem"
                    >
                      Edit Profile
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition"
                      onClick={() => {
                        setMenuOpen(false);
                        nav("/orders");
                      }}
                      role="menuitem"
                    >
                      Purchase history
                    </button>
                    {userRole === "SUPER_ADMIN" && (
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition"
                        onClick={() => {
                          setMenuOpen(false);
                          nav("/admin/settings");
                        }}
                        role="menuitem"
                      >
                        Admin Settings
                      </button>
                    )}
                    <div className="my-1 border-t border-zinc-100" />
                    <button
                      className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 transition"
                      onClick={logout}
                      role="menuitem"
                    >
                      Logout
                    </button>
                  </nav>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md border border-white/25 text-white hover:bg-white/10 focus:outline-none focus:ring-4 focus:ring-white/25 transition"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-primary-800/40 bg-primary-900/98 backdrop-blur">
          <div className="px-4 py-3 flex flex-col gap-1">
            <NavLink
              to="/"
              end
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `${linkBase} ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "text-white/90 hover:bg-white/10"
                }`
              }
            >
              Catalogue
            </NavLink>

            <NavLink
              to="/cart"
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `${linkBase} ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "text-white/90 hover:bg-white/10"
                }`
              }
            >
              Cart
            </NavLink>

            {token && (
              <NavLink
                to="/wishlist"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `${linkBase} ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "text-white/90 hover:bg-white/10"
                  }`
                }
              >
                Wishlist
              </NavLink>
            )}

            {token && (
              <NavLink
                to="/dashboard"
                end
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `${linkBase} ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "text-white/90 hover:bg-white/10"
                  }`
                }
              >
                Dashboard
              </NavLink>
            )}

            {(userRole === "ADMIN" || userRole === "SUPER_ADMIN") && (
              <NavLink
                to="/admin"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `${linkBase} ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "text-white/90 hover:bg-white/10"
                  }`
                }
              >
                Admin
              </NavLink>
            )}

            <div className="mt-2 border-t border-white/15 pt-2" />

            {!token ? (
              <div className="flex gap-2">
                <NavLink
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex-1 text-center ${linkBase} ${
                      isActive
                        ? "bg-white text-primary-900"
                        : "border border-white/25 text-white hover:bg-white/10"
                    }`
                  }
                >
                  Login
                </NavLink>
                <NavLink
                  to="/register"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 text-center inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-semibold text-primary-900 bg-white hover:bg-zinc-50 transition"
                >
                  Register
                </NavLink>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  className="w-full text-left px-3 py-2 rounded-md text-white/90 hover:bg-white/10"
                  onClick={() => {
                    setMobileOpen(false);
                    nav("/profile");
                  }}
                >
                  Edit Profile
                </button>
                <button
                  className="w-full text-left px-3 py-2 rounded-md text-white/90 hover:bg-white/10"
                  onClick={() => {
                    setMobileOpen(false);
                    nav("/orders");
                  }}
                >
                  Purchase history
                </button>
                {userRole === "SUPER_ADMIN" && (
                  <button
                    className="w-full text-left px-3 py-2 rounded-md text-white/90 hover:bg-white/10"
                    onClick={() => {
                      setMobileOpen(false);
                      nav("/admin/settings");
                    }}
                  >
                    Admin Settings
                  </button>
                )}
                <button
                  className="w-full text-left px-3 py-2 rounded-md text-red-200 hover:bg-red-500/10"
                  onClick={() => {
                    setMobileOpen(false);
                    logout();
                  }}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
