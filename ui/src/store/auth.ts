// src/store/auth.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import api from "../api/client";
import { clearAccessToken, getAccessToken, setAccessToken } from "../api/client";

export type Role = "SHOPPER" | "ADMIN" | "SUPER_ADMIN" | "SUPPLIER" | "SUPPLIER_RIDER";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  middleName?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

export type AuthState = {
  token: string | null;
  user: AuthUser | null;
  needsVerification: boolean;

  // hydration flag (prevents UI flicker/loops)
  hydrated: boolean;

  // actions
  setAuth: (p: { token: string | null; user: AuthUser | null }) => void;
  setNeedsVerification: (v: boolean) => void;
  clear: () => void;

  // ✅ you referenced this earlier — now it exists
  bootstrap: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      needsVerification: false,
      hydrated: false,

      setAuth: ({ token, user }) => {
        // ✅ sync axios + sessionStorage
        setAccessToken(token);

        set({
          token,
          user,
          needsVerification: false,
        });
      },

      setNeedsVerification: (v) => set({ needsVerification: !!v }),

      clear: () => {
        clearAccessToken();
        set({
          token: null,
          user: null,
          needsVerification: false,
        });
      },

      bootstrap: async () => {
        // 1) Mark hydrated at the end, no matter what
        try {
          // 2) Pull token from sessionStorage (NOT localStorage)
          const t = getAccessToken();
          if (!t) {
            set({ hydrated: true, token: null, user: null });
            return;
          }

          // ✅ sync token into store so Navbar reacts
          set({ token: t });

          // 3) If we already have a user in persisted store, keep it.
          // But still verify token by calling /me in the background.
          try {
            const r = await api.get("/api/auth/me");
            const me = r.data;

            if (!me) {
              // token invalid
              get().clear();
              set({ hydrated: true });
              return;
            }

            set({
              user: {
                id: String(me.id ?? ""),
                email: String(me.email ?? ""),
                role: (me.role ?? "SHOPPER") as Role,
                firstName: me.firstName ?? null,
                lastName: me.lastName ?? null,
                middleName: (me as any).middleName ?? null,
                emailVerified: !!me.emailVerified,
                phoneVerified: !!me.phoneVerified,
              },
              hydrated: true,
            });
          } catch {
            // If /me fails temporarily, still mark hydrated so UI works
            set({ hydrated: true });
          }
        } catch {
          set({ hydrated: true });
        }
      },
    }),
    {
      name: "auth_store_v1",
      // ✅ Persist only non-sensitive fields in localStorage.
      // Token stays in sessionStorage via api client.
      partialize: (s) => ({
        user: s.user,
        needsVerification: s.needsVerification,
      }),
    }
  )
);
