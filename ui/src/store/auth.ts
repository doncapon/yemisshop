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
  token: string | null;
  user: UserShape | null;

  needsVerification: boolean;
  hydrated: boolean;

  setAuth: (p: AuthPayload) => void;
  setNeedsVerification: (v: boolean) => void;
  clear: () => void;

  bootstrap: () => Promise<void>;
};

function safeSessionStorage() {
  try {
    if (typeof window === "undefined") return undefined as any;
    return window.sessionStorage;
  } catch {
    return undefined as any;
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: getAccessToken(),
      user: null,

      needsVerification: false,
      hydrated: false,

      setAuth: ({ token, user }) => {
        // ✅ token lives in sessionStorage + axios header
        setAccessToken(token);

        // ✅ also store token in zustand so Navbar updates immediately
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
        // mark hydrated (always)
        if (!get().hydrated) set({ hydrated: true });

        // Prefer token from api client/sessionStorage
        const t = getAccessToken();

        if (!t) {
          // no token => ensure clean state
          if (get().token || get().user) set({ token: null, user: null });
          return;
        }

        // ensure store token matches storage token
        if (get().token !== t) set({ token: t });

        // already have user? done.
        if (get().user?.id) return;

        // token exists but user missing => fetch /auth/me
        try {
          const r = await api.get("/api/auth/me");
          const me = r.data ?? null;

          if (me?.id) {
            set({ token: t, user: me });
          } else {
            get().clear();
          }
        } catch {
          // axios interceptor will clear token on /auth/me 401
          const still = getAccessToken();
          if (!still) set({ token: null, user: null });
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => safeSessionStorage()),

      // ✅ Persist token+user into sessionStorage so reload keeps login state
      partialize: (s) => ({
        token: s.token,
        user: s.user,
        needsVerification: s.needsVerification,
      }),

      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // ✅ ensure axios header matches persisted token
        setAccessToken(state.token ?? null);

        // ✅ mark hydrated
        state.hydrated = true;
      },
    }
  )
);
