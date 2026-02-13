// src/store/auth.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setAccessToken as setAxiosAccessToken } from "../api/client";

export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

export type AuthedUser = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

export type AuthState = {
  token: string | null;
  user: AuthedUser | null;
  needsVerification: boolean;

  // used in your Login.tsx already
  hydrated: boolean;

  // actions
  setAuth: (payload: { token: string | null; user: AuthedUser | null }) => void;
  setNeedsVerification: (v: boolean) => void;
  clear: () => void;

  // ✅ add this so Navbar can call it
  bootstrap: () => void;
};

function looksLikeJwt(t: string | null) {
  return !!t && t.split(".").length === 3;
}

function readSessionToken(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const t = window.sessionStorage.getItem("access_token");
    return looksLikeJwt(t) ? t : null;
  } catch {
    return null;
  }
}

function writeSessionToken(token: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (token && looksLikeJwt(token)) window.sessionStorage.setItem("access_token", token);
    else window.sessionStorage.removeItem("access_token");
  } catch {
    /* ignore */
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      needsVerification: false,
      hydrated: false,

      setAuth: ({ token, user }) => {
        const safeToken = looksLikeJwt(token) ? token : null;

        // keep axios in sync (Bearer)
        setAxiosAccessToken(safeToken);

        // keep sessionStorage in sync (Option A)
        writeSessionToken(safeToken);

        // update store (Navbar reacts immediately)
        set({ token: safeToken, user: user ?? null });
      },

      setNeedsVerification: (v) => set({ needsVerification: !!v }),

      clear: () => {
        setAxiosAccessToken(null);
        writeSessionToken(null);
        set({ token: null, user: null, needsVerification: false });
      },

      // ✅ Rehydrate token from sessionStorage once
      bootstrap: () => {
        const t = readSessionToken();
        if (t && !get().token) {
          setAxiosAccessToken(t);
          set({ token: t });
        }
        set({ hydrated: true });
      },
    }),
    {
      name: "auth_store_v1",
      // ✅ don't persist token (token lives in sessionStorage)
      partialize: (s) => ({
        user: s.user,
        needsVerification: s.needsVerification,
      }),
    }
  )
);

// ✅ auto-bootstrap once on module import
try {
  const st = useAuthStore.getState();
  if (!st.hydrated) st.bootstrap();
} catch {
  /* ignore */
}
