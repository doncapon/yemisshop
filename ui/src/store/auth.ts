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
      token: getAccessToken(), // token comes from sessionStorage
      user: null,

      needsVerification: false,
      hydrated: false,

      setAuth: ({ token, user }) => {
        // 1) sync axios + sessionStorage
        setAccessToken(token);

        // 2) update zustand state immediately (Navbar reacts)
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
        // always mark hydrated
        if (!get().hydrated) set({ hydrated: true });

        // re-check token from sessionStorage
        const t = getAccessToken();

        if (!t) {
          if (get().token || get().user) set({ token: null, user: null });
          return;
        }

        // keep zustand token synced with sessionStorage token
        if (get().token !== t) set({ token: t });

        // if user exists already, done
        if (get().user?.id) return;

        // token exists but user missing -> fetch /auth/me
        try {
          const r = await api.get("/api/auth/me");
          const me = r.data ?? null;

          if (me?.id) {
            set({ token: t, user: me });
          } else {
            get().clear();
          }
        } catch {
          // /auth/me 401 is handled by axios interceptor -> token cleared
          const still = getAccessToken();
          if (!still) set({ token: null, user: null });
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => safeLocalStorage()),
      // do NOT persist token (token is sessionStorage)
      partialize: (s) => ({
        user: s.user,
        needsVerification: s.needsVerification,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.token = getAccessToken();
        state.hydrated = true;
      },
    }
  )
);
