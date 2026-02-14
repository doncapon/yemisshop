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

  setUser: (u: AuthUser | null) => void;
  setNeedsVerification: (v: boolean) => void;
  clear: () => void;

  bootstrap: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      bootstrapping: false,

      user: null,
      needsVerification: false,

      setUser: (u) => set({ user: u }),
      setNeedsVerification: (v) => set({ needsVerification: !!v }),

      clear: () => set({ user: null, needsVerification: false }),

      bootstrap: async () => {
        if (get().bootstrapping) return;
        set({ bootstrapping: true });

        try {
          const r = await api.get("/api/auth/me"); // ✅ cookie auth
          const me = r.data as AuthUser | null;

          if (me?.id) set({ user: me });
          else set({ user: null });
        } catch {
          // If API unreachable, don't hard-fail; just mark hydrated.
        } finally {
          set({ hydrated: true, bootstrapping: false });
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => window.sessionStorage), // same-tab persistence
      partialize: (s) => ({ user: s.user, needsVerification: s.needsVerification }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);
