import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setAccessToken } from '../api/client';

export type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER';

export type User = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

type AuthState = {
  hydrated: boolean;
  token: string | null;
  user: User | null;
  needsVerification: boolean;

  setHydrated: (v: boolean) => void;
  setAuth: (p: { token: string; user: User }) => void;
  setNeedsVerification: (v: boolean) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      token: null,
      user: null,
      needsVerification: false,

      setHydrated: (v) => set({ hydrated: v }),

      setAuth: ({ token, user }) => {
        setAccessToken(token);          // sync axios/localStorage
        set({ token, user });
      },

      setNeedsVerification: (v) => set({ needsVerification: v }),

      clear: () => {
        setAccessToken(null);
        set({ token: null, user: null, needsVerification: false });
      },
    }),
    {
      name: 'auth',
      partialize: (s) => ({
        token: s.token,
        user: s.user,
        needsVerification: s.needsVerification,
      }),
      // When rehydration from storage is done, mark hydrated = true
      onRehydrateStorage: () => (state) => {
        queueMicrotask(() => state?.setHydrated(true));
      },
    }
  )
);
