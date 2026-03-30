import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import {
  type AuthMeLite,
  type SupplierDocumentLite,
  type SupplierMeLite,
  evaluateSupplierVerificationGate,
} from "../utils/supplierVerificationGate";

export function useSupplierVerificationGate(enabled = true) {
  return useQuery({
    queryKey: ["supplier", "verification-gate"],
    enabled,
    queryFn: async () => {
      const [authRes, supplierRes, docsRes] = await Promise.all([
        api.get("/api/auth/me", { withCredentials: true }).catch(() => ({ data: {} })),
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