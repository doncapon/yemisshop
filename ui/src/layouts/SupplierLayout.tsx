import React, { useEffect, useMemo } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import {
  Package,
  ShoppingBag,
  Wallet,
  LayoutDashboard,
  Settings,
  Users,
  BadgeCheck,
  ShieldCheck,
  MapPin,
  FileText,
} from "lucide-react";
import { useAuthStore } from "../store/auth";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

type SupplierMeLite = {
  legalName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
  registeredAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
  pickupAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
};

type AuthMeLite = {
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

function hasAddress(addr: any) {
  if (!addr) return false;
  return Boolean(
    String(addr.houseNumber ?? "").trim() ||
      String(addr.streetName ?? "").trim() ||
      String(addr.city ?? "").trim() ||
      String(addr.state ?? "").trim() ||
      String(addr.country ?? "").trim() ||
      String(addr.postCode ?? "").trim()
  );
}

function isRegisteredBusiness(registrationType?: string | null) {
  return String(registrationType ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS";
}

function docSatisfied(docs: SupplierDocumentLite[], kind: string) {
  return docs.some((d) => {
    const k = String(d.kind ?? "").trim().toUpperCase();
    const s = String(d.status ?? "").trim().toUpperCase();
    return k === kind && (s === "PENDING" || s === "APPROVED");
  });
}

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore((s: any) => s.hydrated);
  const roleRaw = useAuthStore((s: any) => s.user?.role);

  const role = normRole(roleRaw);
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isRider = role === "SUPPLIER_RIDER";
  const isSupplier = role === "SUPPLIER";

  const [searchParams, setSearchParams] = useSearchParams();

  const urlSupplierId = useMemo(() => {
    const v = String(searchParams.get("supplierId") ?? "").trim();
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();
    return v || undefined;
  }, []);

  const adminSupplierId = isAdmin ? urlSupplierId ?? storedSupplierId : undefined;

  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = String(searchParams.get("supplierId") ?? "").trim();
    const fromStore = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();

    if (fromUrl) {
      if (fromUrl !== fromStore) localStorage.setItem(ADMIN_SUPPLIER_KEY, fromUrl);
      return;
    }

    if (fromStore) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("supplierId", fromStore);
          return next;
        },
        { replace: true }
      );
    }
  }, [isAdmin, searchParams, setSearchParams]);

  const withSupplierCtx = (to: string) => {
    if (!isAdmin || !adminSupplierId) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  const onboardingQ = useQuery({
    queryKey: ["supplier", "layout", "onboarding-state"],
    enabled: hydrated && isSupplier && !isAdmin && !isRider,
    queryFn: async () => {
      const [authRes, supplierRes, docsRes] = await Promise.all([
        api.get("/api/auth/me", { withCredentials: true }),
        api.get("/api/supplier/me", { withCredentials: true }),
        api
          .get("/api/supplier/documents", { withCredentials: true })
          .catch(() => ({ data: { data: [] } })),
      ]);

      const authMe = ((authRes.data as any)?.data ??
        (authRes.data as any)?.user ??
        authRes.data ??
        {}) as AuthMeLite;

      const supplierMe = ((supplierRes.data as any)?.data ??
        supplierRes.data ??
        {}) as SupplierMeLite;

      const rawDocs = (docsRes as any)?.data?.data ?? (docsRes as any)?.data ?? [];
      const docs = Array.isArray(rawDocs) ? (rawDocs as SupplierDocumentLite[]) : [];

      const contactDone = !!authMe?.emailVerified && !!authMe?.phoneVerified;

      const businessDone = Boolean(
        String(supplierMe?.legalName ?? "").trim() &&
          String(supplierMe?.registrationType ?? "").trim() &&
          String(supplierMe?.registrationCountryCode ?? "").trim()
      );

      const addressDone =
        hasAddress(supplierMe?.registeredAddress) || hasAddress(supplierMe?.pickupAddress);

      const requiredKinds = [
        ...(isRegisteredBusiness(supplierMe?.registrationType)
          ? ["BUSINESS_REGISTRATION_CERTIFICATE"]
          : []),
        "GOVERNMENT_ID",
        "PROOF_OF_ADDRESS",
      ];

      const docsDone = requiredKinds.every((kind) => docSatisfied(docs, kind));
      const onboardingDone = contactDone && businessDone && addressDone && docsDone;

      const nextPath = !contactDone
        ? "/supplier/verify-contact"
        : !businessDone
        ? "/supplier/onboarding"
        : !addressDone
        ? "/supplier/onboarding/address"
        : !docsDone
        ? "/supplier/onboarding/documents"
        : "/supplier";

      return {
        contactDone,
        businessDone,
        addressDone,
        docsDone,
        onboardingDone,
        nextPath,
      };
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const onboarding = onboardingQ.data;
  const showOnboardingNav = isSupplier && !isAdmin && !isRider && !!onboarding && !onboarding.onboardingDone;

  const linkBase =
    "inline-flex items-center gap-1.5 rounded-full border transition whitespace-nowrap " +
    "px-3 py-2 text-sm font-medium " +
    "max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[12px]";

  const active = "bg-zinc-900 text-white border-zinc-900";
  const inactive = "bg-white/80 hover:bg-black/5 text-zinc-800 border-zinc-200";

  const iconClass = "shrink-0 text-zinc-700";
  const iconSize = 14;

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-100">
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 md:px-8">
        <div className="pt-3 sm:pt-6">
          {!isRider ? (
            <>
              <div className="rounded-2xl border border-white/40 bg-white/80 backdrop-blur-md shadow-sm px-2 py-2">
                <div className="flex items-center gap-2 overflow-x-auto flex-nowrap">
                  <NavLink
                    to={withSupplierCtx("/supplier")}
                    end
                    className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                  >
                    <LayoutDashboard className={iconClass} size={iconSize} />
                    <span>Overview</span>
                  </NavLink>

                  {showOnboardingNav ? (
                    <>
                      <NavLink
                        to="/supplier/verify-contact"
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <BadgeCheck className={iconClass} size={iconSize} />
                        <span>Contact</span>
                      </NavLink>

                      <NavLink
                        to="/supplier/onboarding"
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <ShieldCheck className={iconClass} size={iconSize} />
                        <span>Business</span>
                      </NavLink>

                      <NavLink
                        to="/supplier/onboarding/address"
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <MapPin className={iconClass} size={iconSize} />
                        <span>Address</span>
                      </NavLink>

                      <NavLink
                        to="/supplier/onboarding/documents"
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <FileText className={iconClass} size={iconSize} />
                        <span>Documents</span>
                      </NavLink>
                    </>
                  ) : (
                    <>
                      <NavLink
                        to={withSupplierCtx("/supplier/products")}
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <Package className={iconClass} size={iconSize} />
                        <span>Products</span>
                      </NavLink>

                      <NavLink
                        to={withSupplierCtx("/supplier/orders")}
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <ShoppingBag className={iconClass} size={iconSize} />
                        <span>Orders</span>
                      </NavLink>

                      <NavLink
                        to={withSupplierCtx("/supplier/payouts")}
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <Wallet className={iconClass} size={iconSize} />
                        <span>Payouts</span>
                      </NavLink>

                      <NavLink
                        to={withSupplierCtx("/supplier/riders")}
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <Users className={iconClass} size={iconSize} />
                        <span>Riders</span>
                      </NavLink>

                      <NavLink
                        to={withSupplierCtx("/supplier/settings")}
                        className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                      >
                        <Settings className={iconClass} size={iconSize} />
                        <span>Settings</span>
                      </NavLink>
                    </>
                  )}
                </div>
              </div>

              {showOnboardingNav ? (
                <div className="mt-2 text-[11px] sm:text-xs text-zinc-600">
                  Complete onboarding to unlock products, orders, payouts, riders and settings.
                </div>
              ) : null}

              {isAdmin && !adminSupplierId ? (
                <div className="mt-2 text-[11px] sm:text-xs text-zinc-600">
                  Admin view: select a supplier on the Supplier Dashboard first (or add <b>?supplierId=...</b>).
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-white/40 bg-white/80 backdrop-blur-md shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[12px] sm:text-sm font-semibold text-zinc-900">Rider portal</div>
                <NavLink
                  to={withSupplierCtx("/supplier/orders")}
                  className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
                >
                  <ShoppingBag className={iconClass} size={iconSize} /> Orders
                </NavLink>
              </div>
              <div className="mt-1 text-[11px] sm:text-xs text-zinc-600">
                Riders can only access assigned orders.
              </div>
            </div>
          )}
        </div>

        <div className="pb-10">{children}</div>
      </div>
    </div>
  );
}