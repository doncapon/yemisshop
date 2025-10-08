// src/components/Navbar.tsx
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useState, useMemo, useRef, useEffect } from 'react';
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
  name?: string | null; // fallback if your API still returns a combined name
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

  const [open, setOpen] = useState(false);
  const menuRef = useClickAway<HTMLDivElement>(() => setOpen(false));

  // Local names fetched from /api/auth/me
  const [firstName, setFirstName] = useState<string | null>(null);
  const [middleName, setMiddleName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

  // Fetch first/last name from the backend whenever we have a token
  useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      if (!token) {
        setFirstName(null);
        setLastName(null);
        setMiddleName(null);
        return;
      }
      try {
        const { data } = await api.get<MeResponse>('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        // Prefer explicit first/last; if missing, try splitting combined name
        let f = data.firstName?.trim() || '';
        let l = data.lastName?.trim() || '';
        if (!f && !l && data.name) {
          const parts = data.name.trim().split(/\s+/);
          f = parts[0] || '';
          l = parts.length > 1 ? parts[parts.length - 1] : '';
        }
        if (!cancelled) {
          setFirstName(f || null);
          setLastName(l || null);
        }
      } catch {
        if (!cancelled) {
          setFirstName(null);
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
    const m = middleName != undefined? middleName?.trim()[0] + "." : "";
    const l = lastName?.trim();

    const mr = (m != '.' && m != undefined )? m : '';

    if(f && l) return f + " " +mr+" "+ l;
  }, [firstName, lastName, middleName]);

  const initials = useMemo(() => {
    const f = (firstName?.trim()?.[0] || '').toUpperCase();
    const l = (lastName?.trim()?.[0] || '').toUpperCase();
    if (f || l) return `${f}${l}`;
  }, [firstName, lastName]);

  const logout = () => {
    clear();
    nav('/');
  };

  return (
    <header className="w-full border-b bg-accent-500">
      <div className="max-w-7xl mx-auto  h-16 flex items-center gap-4">
        <Link to="/" className="font-bold text-lg">YemiShop</Link>

        <nav className="flex gap-4">
          
          <NavLink className="text-white" to="/" end>Catalogue</NavLink>
          <NavLink className="text-white" to="/cart">Cart</NavLink>
          {token && <NavLink className="text-white" to="/dashboard" end>Dashboard </NavLink>}
          {role === 'ADMIN' && <NavLink className="text-white" to="/admin">Admin</NavLink>}
          {role === 'SUPPLIER' && <NavLink className="text-white" to="/supplier">Supplier</NavLink>}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {!token ? (
            <>
              <NavLink className="text-white" to="/login">Login</NavLink>
              <NavLink className="text-white" to="/register">Register</NavLink>
            </>
          ) : (
            <div className="relative" ref={menuRef}>
             <button
                onClick={() => setOpen((v) => !v)}
                className="w-9 h-9 rounded-full grid place-items-center border bg-black text-white font-semibold"
                aria-label="User menu"
              >
                {initials}
              </button>

              {open && (
                <div className="absolute right-0 mt-2 w-70 border rounded shadow bg-black text-white">
                  <div className="px-3 py-2 text-sm border-b">
                    <div className="font-medium truncate">{displayName}</div>
                    <div className="opacity-60 truncate">{userEmail}</div>
                  </div>
                  <nav className="py-1 text-sm">
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-black/5"
                      onClick={() => {
                        setOpen(false);
                        nav('/profile');
                      }}
                    >
                      Edit Profile
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg黑/5"
                      onClick={() => {
                        setOpen(false);
                        nav('/orders');
                      }}
                    >
                      Purchase history
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-black/5 text-red-600"
                      onClick={logout}
                    >
                      Logout
                    </button>
                  </nav>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
