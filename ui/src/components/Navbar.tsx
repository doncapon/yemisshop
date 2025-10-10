// src/components/Navbar.tsx
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/auth';
import api from '../api/client';

type MeResponse = {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPPLIER' | 'SHOPPER';
  status: 'PENDING' | 'PARTIAL' | 'VERIFIED';
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
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onAway]);
  return ref;
}

export default function Navbar() {
  const { token, role, userEmail, clear } = useAuthStore();
  const nav = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickAway<HTMLDivElement>(() => setMenuOpen(false));

  // Names from /api/auth/me
  const [firstName, setFirstName] = useState<string | null>(null);
  const [middleName, setMiddleName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

  // Fetch name details when token is present
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
        const { data } = await api.get<MeResponse>('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Prefer explicit first/last/middle; fallback to splitting `name`
        let f = data.firstName?.trim();
        let m = data.middleName?.trim();
        let l = data.lastName?.trim();

        if ((!f && !l) && data.name) {
          const parts = data.name.trim().split(/\s+/);
          f = parts[0] || '';
          l = parts.length > 1 ? parts[parts.length - 1] : '';
        }

        if (!cancelled) {
          setFirstName(f || null);
          setMiddleName(m || null);
          setLastName(l || null);
        }
      } catch {
        if (!cancelled) {
          setFirstName(null);
          setMiddleName(null);
          setLastName(null);
        }
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
      const mid = m ? ` ${m[0].toUpperCase()}.` : '';
      return `${f}${mid} ${l}`;
    }
    if (f) return f;
    if (l) return l;
    return userEmail || 'Account';
  }, [firstName, middleName, lastName, userEmail]);

  const initials = useMemo(() => {
    const f = (firstName?.trim()?.[0] || '').toUpperCase();
    const l = (lastName?.trim()?.[0] || '').toUpperCase();
    const init = `${f}${l}`.trim();
    return init || (userEmail?.[0]?.toUpperCase() ?? 'U');
  }, [firstName, lastName, userEmail]);

  const logout = useCallback(() => {
    clear();
    if (localStorage.getItem('cart')) {localStorage.removeItem('cart')};
    nav('/');
  }, [clear, nav]);

  const linkBase =
    'inline-flex items-center px-3 py-2 rounded-md text-sm font-medium transition';
  const linkInactive = 'text-ink-invert/90 hover:bg-white/10';
  const linkActive = 'text-ink-invert bg-white/15';

  return (
    <header className="sticky top-0 z-40 w-full border-b border-primary-700/40 bg-primary-700/95 backdrop-blur">
      <div className="max-w-7xl mx-auto h-16 px-4 md:px-6 flex items-center gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-ink-invert text-lg font-bold tracking-tight hover:opacity-95"
            aria-label="YemiShop home"
          >
            YemiShop
          </Link>
        </div>

        {/* Primary nav (desktop) */}
        <nav className="hidden md:flex gap-1 ml-2">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${linkBase} ${isActive ? linkActive : linkInactive}`
            }
          >
            Catalogue
          </NavLink>
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
              to="/dashboard"
              end
              className={({ isActive }) =>
                `${linkBase} ${isActive ? linkActive : linkInactive}`
              }
            >
              Dashboard
            </NavLink>
          )}
          {role === 'ADMIN' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `${linkBase} ${isActive ? linkActive : linkInactive}`
              }
            >
              Admin
            </NavLink>
          )}
          {role === 'SUPPLIER' && (
            <NavLink
              to="/supplier"
              className={({ isActive }) =>
                `${linkBase} ${isActive ? linkActive : linkInactive}`
              }
            >
              Supplier
            </NavLink>
          )}
        </nav>

        {/* Spacer */}
        <div className="ml-auto" />

        {/* Auth / Avatar */}
        <div className="hidden md:flex items-center gap-3">
          {!token ? (
            <>
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `${linkBase} ${isActive ? 'bg-white text-primary-800' : 'border border-white/15 text-white hover:bg-white/10'}`
                }
              >
                Login
              </NavLink>
              <NavLink
                to="/register"
                className="inline-flex items-center px-3 py-2 rounded-md text-sm font-semibold text-primary-700 bg-white hover:bg-zinc-50 transition"
              >
                Register
              </NavLink>
            </>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full grid place-items-center border border-white/20 bg-white/10 text-white font-semibold hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/25 transition"
                aria-label="User menu"
              >
                {initials}
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
                  role="menu"
                >
                  <div className="px-3 py-3 border-b border-border/80 bg-surface-soft">
                    <div className="text-sm text-ink-soft">Signed in as</div>
                    <div className="text-sm font-medium truncate text-ink">
                      {displayName}
                    </div>
                    <div className="text-xs opacity-70 truncate">{userEmail}</div>
                  </div>
                  <nav className="py-1 text-sm">
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-black/5 transition"
                      onClick={() => {
                        setMenuOpen(false);
                        nav('/profile');
                      }}
                      role="menuitem"
                    >
                      Edit Profile
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-black/5 transition"
                      onClick={() => {
                        setMenuOpen(false);
                        nav('/orders');
                      }}
                      role="menuitem"
                    >
                      Purchase history
                    </button>
                    <div className="my-1 border-t border-border" />
                    <button
                      className="w-full text-left px-3 py-2 text-danger hover:bg-red-50 transition"
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

        {/* Mobile controls */}
        <button
          className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md border border-white/20 text-white/95 hover:bg-white/10 focus:outline-none focus:ring-4 focus:ring-white/25 transition"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {/* simple icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-primary-700/40 bg-primary-700/95 backdrop-blur">
          <div className="px-4 py-3 flex flex-col gap-1">
            <NavLink
              to="/"
              end
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `${linkBase} ${isActive ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'}`
              }
            >
              Catalogue
            </NavLink>
            <NavLink
              to="/cart"
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `${linkBase} ${isActive ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'}`
              }
            >
              Cart
            </NavLink>
              
            <NavLink
              to="/wishlist"
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `${linkBase} ${isActive ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'}`
              }
            >
              Wishlist
            </NavLink>


            {token && (
              <NavLink
                to="/dashboard"
                end
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `${linkBase} ${isActive ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'}`
                }
              >
                Dashboard
              </NavLink>
            )}
            {role === 'ADMIN' && (
              <NavLink
                to="/admin"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `${linkBase} ${isActive ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'}`
                }
              >
                Admin
              </NavLink>
            )}
            {role === 'SUPPLIER' && (
              <NavLink
                to="/supplier"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `${linkBase} ${isActive ? 'bg-white/20 text-white' : 'text-white/90 hover:bg-white/10'}`
                }
              >
                Supplier
              </NavLink>
            )}

            <div className="mt-2 border-t border-white/15 pt-2" />

            {!token ? (
              <div className="flex gap-2">
                <NavLink
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex-1 text-center ${linkBase} ${isActive ? 'bg-white text-primary-800' : 'border border-white/20 text-white hover:bg-white/10'}`
                  }
                >
                  Login
                </NavLink>
                <NavLink
                  to="/register"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 text-center inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-semibold text-primary-700 bg-white hover:bg-zinc-50 transition"
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
                    nav('/profile');
                  }}
                >
                  Edit Profile
                </button>
                <button
                  className="w-full text-left px-3 py-2 rounded-md text-white/90 hover:bg-white/10"
                  onClick={() => {
                    setMobileOpen(false);
                    nav('/orders');
                  }}
                >
                  Purchase history
                </button>
                <button
                  className="w-full text-left px-3 py-2 rounded-md text-red-100 hover:bg-white/10"
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
