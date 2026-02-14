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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      bootstrapping: false,

      user: null,
      needsVerification: false,

      sessionExpired: false,

      setUser: (u) => set({ user: u, sessionExpired: false }),
      setNeedsVerification: (v) => set({ needsVerification: !!v }),

      markSessionExpired: () => {
        // ✅ clear persisted user so "enabled: !!userId" stops everywhere
        set({ user: null, needsVerification: false, sessionExpired: true });
      },

      clear: () => set({ user: null, needsVerification: false, sessionExpired: false }),

      bootstrap: async () => {
        if (get().bootstrapping) return;
        set({ bootstrapping: true });

        try {
          const r = await api.get("/api/auth/me", { withCredentials: true }); // ✅ cookie auth
          const me = r.data as AuthUser | null;

          if (me?.id) set({ user: me, sessionExpired: false });
          else set({ user: null, sessionExpired: false });
        } catch (e: any) {
          // ✅ if cookie expired / invalid, clear user and stop "authed" queries from running
          if (is401(e)) {
            set({ user: null, needsVerification: false, sessionExpired: true });
          }
          // If API unreachable or other error, don't hard-fail; leave whatever is there.
          // But DO mark hydrated.
        } finally {
          set({ hydrated: true, bootstrapping: false });
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => window.sessionStorage), // same-tab persistence
      partialize: (s) => ({
        user: s.user,
        needsVerification: s.needsVerification,
        sessionExpired: s.sessionExpired, // ✅ persist so spam doesn't resume after refresh in same tab
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);
