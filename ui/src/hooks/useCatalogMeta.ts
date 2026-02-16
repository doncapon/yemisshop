// src/hooks/useCatalogMeta.ts
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

export type CatalogCategory = {
  id: string;
  name: string;
  slug?: string | null;
  parentId?: string | null;
  position?: number | null;
  isActive?: boolean;
};

export type CatalogBrand = {
  id: string;
  name: string;
  slug?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
};

export type CatalogAttributeValue = {
  id: string;
  attributeId: string;
  name: string;
  code?: string | null;
  position?: number | null;
  isActive: boolean;
};

export type CatalogAttribute = {
  id: string;
  name: string;
  // Prisma schema uses String, so keep TS tolerant
  type: "TEXT" | "SELECT" | "MULTISELECT" | string;
  placeholder?: string | null;
  isActive: boolean;
  values?: CatalogAttributeValue[];
};

type ApiListResponse<T> = { data: T[] } | T[];

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function toArray<T>(resp: ApiListResponse<T>): T[] {
  // resp can be { data: [...] } or raw [...]
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray((resp as any).data)) return (resp as any).data;
  return [];
}

/**
 * Tries endpoints in order until one succeeds.
 * - If endpoint returns 404, try next.
 * - If endpoint returns 401/403, try next (useful when suppliers hit admin endpoints).
 * - For other errors, rethrow to surface real issues.
 *
 * ✅ Cookie-mode: always sends cookies (no Authorization header)
 */
async function getFirstWorking<T>(urls: string[]): Promise<T[]> {
  let lastErr: any = null;

  for (const url of urls) {
    try {
      const res = await api.get<ApiListResponse<T>>(url, AXIOS_COOKIE_CFG);
      return toArray<T>(res.data);
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;

      // try next endpoint for "not found" and "not allowed"
      if (status === 404 || status === 401 || status === 403) continue;

      // otherwise this is a real failure: surface it
      throw e;
    }
  }

  // If everything failed with only 404/401/403, return empty (safe)
  // You could also throw lastErr if you want to force visibility.
  return [];
}

export function useCatalogMeta(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;

  /**
   * IMPORTANT:
   * Suppliers should use /api/catalog/* (read-only).
   * Only Admin UI should call /api/admin/*.
   *
   * If you still want fallback for admin screen, you can add it there,
   * but keep supplier hook clean to avoid constant 403 noise.
   */
  const categoriesQ = useQuery<CatalogCategory[], Error>({
    queryKey: ["catalog-meta", "categories"],
    enabled,
    queryFn: () => getFirstWorking<CatalogCategory>(["/api/catalog/categories"]),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const brandsQ = useQuery<CatalogBrand[], Error>({
    queryKey: ["catalog-meta", "brands"],
    enabled,
    queryFn: () => getFirstWorking<CatalogBrand>(["/api/catalog/brands"]),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const attributesQ = useQuery<CatalogAttribute[], Error>({
    queryKey: ["catalog-meta", "attributes"],
    enabled,
    queryFn: () => getFirstWorking<CatalogAttribute>(["/api/catalog/attributes"]),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const categories = useMemo(() => {
    const list = categoriesQ.data ?? [];
    return list.filter((c) => c.isActive !== false);
  }, [categoriesQ.data]);

  const brands = useMemo(() => {
    const list = brandsQ.data ?? [];
    return list.filter((b) => b.isActive !== false);
  }, [brandsQ.data]);

  const attributes = useMemo(() => {
    const list = attributesQ.data ?? [];
    return list
      .filter((a) => a.isActive !== false)
      .map((a) => ({
        ...a,
        values: (a.values ?? []).filter((v) => v.isActive !== false),
      }));
  }, [attributesQ.data]);

  const isLoading =
    categoriesQ.isLoading || brandsQ.isLoading || attributesQ.isLoading;

  const isError = categoriesQ.isError || brandsQ.isError || attributesQ.isError;

  return {
    categoriesQ,
    brandsQ,
    attributesQ,
    categories,
    brands,
    attributes,
    isLoading,
    isError,
  };
}
