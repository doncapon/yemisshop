// src/store/auth.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setAccessToken } from "../api/client";

export type Role =
  | "ADMIN"
  | "SUPER_ADMIN"
  | "SHOPPER"
  | "SUPPLIER"
  | "SUPPLIER_RIDER";

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

  // ✅ NEW: use this when /me succeeded via cookie but we don’t want Bearer
  setCookieSession: (user: User) => void;

  setNeedsVerification: (v: boolean) => void;

  logout: () => void;
  clear: () => void;
};

const COOKIE_SESSION_TOKEN = "__cookie__";

function looksLikeJwt(t: string | null) {
  // JWT has 3 dot-separated parts
  return !!t && t.split(".").length === 3;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      hydrated: false,
      token: null,
      user: null,
      needsVerification: false,

      setHydrated: (v: any) => set({ hydrated: v }),

      setAuth: ({ token, user }: { token: string; user: User }) => {
        // Only apply Bearer header if it’s a real JWT
        setAccessToken(looksLikeJwt(token) ? token : null);
        set({ token, user });
      },

      setCookieSession: (user: User) => {
        // Cookie auth should NOT set Authorization header
        setAccessToken(null);
        set({ token: COOKIE_SESSION_TOKEN, user });
      },

      setNeedsVerification: (v: any) => set({ needsVerification: v }),

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

      merge: (persisted: any, current: any) => {
        const p = persisted ?? {};
        const c = current ?? {};
        if (c.token && !p.token) return { ...p, ...c };
        return { ...c, ...p };
      },

      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);

        const t = state?.token ?? null;
        // Don’t ever put "__cookie__" into Authorization header
        setAccessToken(looksLikeJwt(t) ? t : null);
      },
    }
  )
);
