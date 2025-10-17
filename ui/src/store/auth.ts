// src/store/auth.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER';

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  // denormalized flags used across the app
  emailVerified?: boolean;
  phoneVerified?: boolean;
  // optional other fields your /me might return
  status?: 'PENDING' | 'PARTIAL' | 'VERIFIED';
  phone?: string | null;
};

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  /** for banners/UX nudges; not security-critical */
  needsVerification?: boolean;

  // actions
  setAuth: (payload: { token: string; user: AuthUser }) => void;
  /** Update only the user object (keeps existing token). Accepts partials. */
  setAuthUser: (patch: Partial<AuthUser> | ((prev: AuthUser) => AuthUser)) => void;
  setNeedsVerification?: (val: boolean) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      needsVerification: undefined,

      setAuth: ({ token, user }) => {
        set({ token, user });
      },

      setAuthUser: (patch) => {
        const prev = get().user;
        if (!prev) return; // nothing to update
        const next =
          typeof patch === 'function'
            ? (patch as (p: AuthUser) => AuthUser)(prev)
            : { ...prev, ...patch };
        set({ user: next });
      },

      setNeedsVerification: (val: boolean) => set({ needsVerification: val }),

      clear: () => {
        set({ token: null, user: null, needsVerification: undefined });
      },
    }),
    {
      name: 'auth', // your code references this key in localStorage
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // If you change the stored shape in the future, bump version and add a migrate
      // migrate: (persisted, from) => persisted,
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        needsVerification: state.needsVerification,
      }),
    }
  )
);

// Optional helpers (nice ergonomics)
export const getAuthToken = () => useAuthStore.getState().token;
export const getAuthUser = () => useAuthStore.getState().user;
