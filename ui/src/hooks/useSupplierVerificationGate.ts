import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { useAuthStore } from "../store/auth";
import {
  type AuthMeLite,
  type SupplierDocumentLite,
  type SupplierMeLite,
  evaluateSupplierVerificationGate,
} from "../utils/supplierVerificationGate";

function isAuthExpiredError(e: any) {
  const status = Number(e?.response?.status);
  return status === 401 || status === 403;
}

export function useSupplierVerificationGate(enabled = true) {
  return useQuery({
    queryKey: ["supplier", "verification-gate"],
    enabled,
    queryFn: async () => {
      const [authRes, supplierRes, docsRes] = await Promise.all([
        api.get("/api/auth/me", { withCredentials: true }).catch((e) => {
          // A real session expiry is not "unverified" — clear the auth store so
          // route guards send the user to /login instead of showing a stale
          // "complete verification" lock screen.
          if (isAuthExpiredError(e)) useAuthStore.getState().markSessionExpired();
          return { data: {} };
        }),
        api.get("/api/supplier/me", { withCredentials: true }).catch(() => ({ data: {} })),
        api
          .get("/api/supplier/documents", { withCredentials: true })
          .catch(() => ({ data: { data: [] } })),
      ]);

      const authPayload = authRes.data as any;
      const authMe = (
        authPayload?.data?.user ??
        authPayload?.user ??
        authPayload?.data ??
        authPayload ??
        {}
      ) as AuthMeLite;

      const supplierPayload = supplierRes.data as any;
      const supplierMe = (
        supplierPayload?.data ??
        supplierPayload?.supplier ??
        supplierPayload ??
        {}
      ) as SupplierMeLite;

      const rawDocs = (docsRes as any)?.data?.data ?? (docsRes as any)?.data ?? [];
      const docs = Array.isArray(rawDocs) ? (rawDocs as SupplierDocumentLite[]) : [];

      return {
        authMe,
        supplierMe,
        docs,
        gate: evaluateSupplierVerificationGate({
          authMe,
          supplierMe,
          docs,
        }),
      };
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}