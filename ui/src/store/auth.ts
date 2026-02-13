// src/store/auth.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import api, { getAccessToken, setAccessToken, clearAccessToken } from "../api/client.js";

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
      token: getAccessToken(),
      user: null,

      needsVerification: false,
      hydrated: false,

      setAuth: ({ token, user }) => {
        // ✅ sync token everywhere (axios + session/local storage)
        setAccessToken(token);

        set({
          token: token ?? null,
          user: user ?? null,
          hydrated: true,
        });
      },

      setNeedsVerification: (v) => set({ needsVerification: !!v }),

      clear: () => {
        clearAccessToken();
        set({ token: null, user: null, needsVerification: false, hydrated: true });
      },

      bootstrap: async () => {
        // ✅ mark hydrated even if nothing else happens
        if (!get().hydrated) set({ hydrated: true });

        const t = getAccessToken();

        // no token => logged out
        if (!t) {
          if (get().token || get().user) set({ token: null, user: null });
          return;
        }

        // ensure store token matches
        if (get().token !== t) set({ token: t });

        // if we already have user, done
        if (get().user?.id) return;

        // fetch /auth/me to populate user
        try {
          const r = await api.get("/api/auth/me");
          const me = r.data ?? null;

          if (me?.id) {
            set({ token: t, user: me });
          } else {
            get().clear();
          }
        } catch {
          // axios interceptor clears token on /auth/me 401
          const still = getAccessToken();
          if (!still) set({ token: null, user: null });
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => safeLocalStorage()),

      // ✅ IMPORTANT: persist token + user so Navbar can reflect login after refresh
      partialize: (s) => ({
        token: s.token,
        user: s.user,
        needsVerification: s.needsVerification,
      }),

      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // ✅ ensure axios header + sessionStorage/localStorage token match persisted token
        setAccessToken(state.token ?? null);

        // ✅ mark hydrated
        state.hydrated = true;
      },
    }
  )
);
