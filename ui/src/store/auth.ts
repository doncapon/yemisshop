// src/store/auth.ts
import { create } from 'zustand';
import api from '../api/client';

type Role = 'ADMIN' | 'SUPPLIER' | 'SHOPPER' | null;

type AuthState = {
  token: string | null;
  role: Role;
  email: string | null;

  setToken: (token: string | null) => void;
  setAuth: (token: string, role: Role, email: string | null) => void;
  clear: () => void;
};

// small helper: keep axios default header in sync
function setAxiosAuth(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export const useAuthStore = create<AuthState>((set) => {
  // hydrate from localStorage on first run
  const saved = (() => {
    try {
      const raw = localStorage.getItem('auth');
      return raw ? JSON.parse(raw) as Partial<AuthState> : {};
    } catch {
      return {};
    }
  })();

  // initialize axios header if token exists
  setAxiosAuth(saved.token ?? null);

  return {
    token: saved.token ?? null,
    role: (saved.role as Role) ?? null,
    email: saved.email ?? null,

    setToken: (token) => {
      setAxiosAuth(token);
      set((s) => {
        const next = { ...s, token };
        localStorage.setItem('auth', JSON.stringify(next));
        return next;
      });
    },

    setAuth: (token, role, email) => {
      setAxiosAuth(token);
      set(() => {
        const next = { token, role, email };
        localStorage.setItem('auth', JSON.stringify(next));
        return next as AuthState;
      });
    },

    clear: () => {
      setAxiosAuth(null);
      set(() => {
        const next = { token: null, role: null, email: null };
        localStorage.setItem('auth', JSON.stringify(next));
        return next as AuthState;
      });
    },
  };
});
