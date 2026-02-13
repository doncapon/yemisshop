// src/store/auth.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import api, { getAccessToken, setAccessToken, clearAccessToken } from "../api/client";

export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

export type UserShape = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

type AuthPayload = { token: string | null; user: UserShape | null };

export type AuthState = {
  token: string | null; // kept in-memory + synced from sessionStorage
  user: UserShape | null;

  needsVerification: boolean;
  hydrated: boolean;

  setAuth: (p: AuthPayload) => void;
  setNeedsVerification: (v: boolean) => void;
  clear: () => void;

  // ✅ now exists; call this once on app load
  bootstrap: () => Promise<void>;
};

function safeLocalStorage() {
  try {
    if (typeof window === "undefined") return undefined as any;
    return window.localStorage;
  } catch {
    return undefined as any;
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: getAccessToken(), // ✅ pick up token from sessionStorage if already there
      user: null,

      needsVerification: false,
      hydrated: false,

      setAuth: ({ token, user }) => {
        // ✅ 1) persist token to sessionStorage + axios header
        setAccessToken(token);

        // ✅ 2) store token for Navbar reactivity
        set({
          token: token ?? null,
          user: user ?? null,
        });
      },

      setNeedsVerification: (v) => set({ needsVerification: !!v }),

      clear: () => {
        clearAccessToken();
        set({ token: null, user: null, needsVerification: false });
      },

      bootstrap: async () => {
        // ✅ mark hydrated even if nothing to do
        set({ hydrated: true });

        // If we already have a user, just ensure token is synced
        const currentToken = getAccessToken();
        if (currentToken && !get().token) set({ token: currentToken });

        // If there's no token, ensure state is clean
        if (!currentToken) {
          if (get().token || get().user) set({ token: null, user: null });
          return;
        }

        // If token exists but user missing, try fetch /auth/me
        if (!get().user) {
          try {
            const r = await api.get("/api/auth/me");
            const me = r.data ?? null;

            if (me?.id) {
              set({ token: currentToken, user: me });
            } else {
              // invalid token -> clear
              get().clear();
            }
          } catch {
            // /auth/me 401 already clears token in axios interceptor
            const t = getAccessToken();
            if (!t) set({ token: null, user: null });
          }
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => safeLocalStorage()),
      // ✅ DO NOT persist token (token lives in sessionStorage)
      partialize: (s) => ({
        user: s.user,
        needsVerification: s.needsVerification,
      }),
      onRehydrateStorage: () => (state) => {
        // called after rehydrate
        if (state) {
          // ✅ grab token from sessionStorage and put into store
          const t = getAccessToken();
          state.token = t;
          state.hydrated = true;
        }
      },
    }
  )
);
