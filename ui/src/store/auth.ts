// src/store/auth.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setAccessToken } from "../api/client";

export type Role =
  | "SHOPPER"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "SUPPLIER"
  | "SUPPLIER_RIDER";

export type User = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  middleName?: string | null;
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
  setUser: (u: User | null) => void;
  setNeedsVerification: (v: boolean) => void;

  logout: () => void;
  clear: () => void;
};

function looksLikeJwt(t: string | null) {
  return !!t && t.split(".").length === 3;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      hydrated: false,
      token: null,
      user: null,
      needsVerification: false,

      setHydrated: (v) => set({ hydrated: v }),

      setAuth: ({ token, user }) => {
        const jwt = looksLikeJwt(token) ? token : null;
        setAccessToken(jwt);
        set({ token: jwt, user });
      },

      setUser: (u) => set({ user: u }),

      setNeedsVerification: (v) => set({ needsVerification: v }),

      logout: () => {
        setAccessToken(null);
        set({ token: null, user: null, needsVerification: false });
      },

      clear: () => {
        setAccessToken(null);
        set({ token: null, user: null, needsVerification: false });
      },
    }),
    {
      name: "auth",
      partialize: (s) => ({
        token: s.token,
        user: s.user,
        needsVerification: s.needsVerification,
      }),

      // ✅ Persisted state should win on reload.
      // Also supports both persisted shapes:
      // - { state: {...}, version: n }
      // - plain {...}
      merge: (persisted: unknown, current: AuthState) => {
        const p = (persisted as any)?.state ?? persisted ?? {};
        return { ...current, ...(p as Partial<AuthState>) };
      },

      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);

        const t = state?.token ?? null;
        setAccessToken(looksLikeJwt(t) ? t : null);
      },
    }
  )
);
