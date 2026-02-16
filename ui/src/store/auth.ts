// src/store/auth.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import api from "../api/client";

export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

export type AuthUser = {
  id: string;
  email: string;

  role: Role;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  status?: string | null;
};

type AuthState = {
  hydrated: boolean;
  bootstrapping: boolean;

  user: AuthUser | null;
  needsVerification: boolean;

  // ✅ NEW: set when we detect 401 so components can stop polling/retrying
  sessionExpired: boolean;

  setUser: (u: AuthUser | null) => void;
  setNeedsVerification: (v: boolean) => void;

  // ✅ NEW: mark session expired (clears user + flips sessionExpired)
  markSessionExpired: () => void;

  clear: () => void;

  bootstrap: () => Promise<void>;
};

const is401 = (e: any) => Number(e?.response?.status) === 401;

/** ✅ Single source of truth role normalizer (matches backend guard style) */
function normRole(role: unknown): Role {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");

  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  if (r === "SUPERUSER") r = "SUPER_USER"; // not part of Role union but kept in case

  // clamp to known union values to avoid runtime surprises
  if (r === "ADMIN") return "ADMIN";
  if (r === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (r === "SUPPLIER") return "SUPPLIER";
  if (r === "SUPPLIER_RIDER") return "SUPPLIER_RIDER";
  return "SHOPPER";
}

function normalizeUser(u: AuthUser | null): AuthUser | null {
  if (!u?.id) return null;
  return { ...u, role: normRole((u as any).role) };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      bootstrapping: false,

      user: null,
      needsVerification: false,

      sessionExpired: false,

      setUser: (u) => set({ user: normalizeUser(u), sessionExpired: false }),
      setNeedsVerification: (v) => set({ needsVerification: !!v }),

      markSessionExpired: () => {
        set({ user: null, needsVerification: false, sessionExpired: true });
      },

      clear: () => set({ user: null, needsVerification: false, sessionExpired: false }),

      bootstrap: async () => {
        if (get().bootstrapping) return;
        set({ bootstrapping: true });

        try {
          const r = await api.get("/api/auth/me", { withCredentials: true }); // ✅ cookie auth
          const me = r.data as AuthUser | null;

          if (me?.id) set({ user: normalizeUser(me), sessionExpired: false });
          else set({ user: null, sessionExpired: false });
        } catch (e: any) {
          if (is401(e)) {
            set({ user: null, needsVerification: false, sessionExpired: true });
          }
          // other errors: keep state but still hydrate
        } finally {
          set({ hydrated: true, bootstrapping: false });
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => window.sessionStorage),
      partialize: (s) => ({
        user: s.user,
        needsVerification: s.needsVerification,
        sessionExpired: s.sessionExpired,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);
