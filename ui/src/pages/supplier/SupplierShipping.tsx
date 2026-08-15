import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Save, Settings2 } from "lucide-react";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

type SupplierShippingCoverage = "LOCAL" | "REGIONAL" | "NATIONWIDE";

type SupplierEnvelope = {
  supplier: {
    id: string;
    name: string;
    shippingEnabled: boolean;
    shippingCoverage: SupplierShippingCoverage;
    pickupAddress?: {
      city?: string | null;
      state?: string | null;
      lga?: string | null;
      country?: string | null;
    } | null;
    registeredAddress?: {
      city?: string | null;
      state?: string | null;
      lga?: string | null;
      country?: string | null;
    } | null;
  };
};

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 rounded-xl bg-slate-100 p-2 text-slate-700">{icon}</div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function boolToYesNo(v: boolean) {
  return v ? "Yes" : "No";
}

export default function SupplierShipping() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data, isLoading, error } = useQuery<SupplierEnvelope>({
    queryKey: ["supplier-shipping-me"],
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/shipping/me", {
        withCredentials: true,
      });
      return data;
    },
    enabled: !!user,
  });

  const [settingsForm, setSettingsForm] = useState({
    shippingEnabled: true,
    shippingCoverage: "NATIONWIDE" as SupplierShippingCoverage,
  });

  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.supplier) return;

    setSettingsForm({
      shippingEnabled: !!data.supplier.shippingEnabled,
      shippingCoverage: data.supplier.shippingCoverage ?? "NATIONWIDE",
    });
  }, [data]);

  const settingsMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        shippingEnabled: settingsForm.shippingEnabled,
        shippingCoverage: settingsForm.shippingCoverage,
      };
      const { data } = await api.put("/api/supplier/shipping/me/settings", payload, {
        withCredentials: true,
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier-shipping-me"] });
      setSettingsErr(null);
      setSettingsMsg("Shipping settings saved.");
    },
    onError: (e: any) => {
      setSettingsMsg(null);
      setSettingsErr(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          e?.message ||
          "Failed to save shipping settings."
      );
    },
  });

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Shipping settings</h1>
              <p className="text-sm text-slate-500">
                Manage how your products are quoted and fulfilled at checkout.
              </p>
            </div>
            {data?.supplier ? (
              <div className="rounded-2xl border bg-white px-4 py-3 text-sm shadow-sm">
                <div className="font-semibold text-slate-900">{data.supplier.name}</div>
                <div className="mt-1 text-slate-500">
                  Shipping enabled: {boolToYesNo(!!data.supplier.shippingEnabled)}
                </div>
              </div>
            ) : null}
          </div>

          {isLoading ? (
            <Card className="p-8 text-sm text-slate-500">Loading shipping settings...</Card>
          ) : error ? (
            <Card className="border-amber-300 bg-amber-50 p-6 text-amber-900">
              Failed to load shipping settings.
            </Card>
          ) : !data ? (
            <Card className="p-8 text-sm text-slate-500">No shipping data found.</Card>
          ) : (
            <div className="grid gap-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-5">
                  <SectionTitle
                    icon={<Settings2 className="h-5 w-5" />}
                    title="Marketplace shipping controls"
                    subtitle="These settings decide how your products are quoted and fulfilled through GIGL."
                  />

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="flex items-center gap-3 rounded-2xl border p-4">
                      <input
                        type="checkbox"
                        checked={settingsForm.shippingEnabled}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            shippingEnabled: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-medium text-slate-700">
                        Shipping enabled
                      </span>
                    </label>

                    <div className="rounded-2xl border p-4">
                      <label htmlFor="shippingCoverage" className="text-sm font-medium text-slate-700">
                        Delivery coverage
                      </label>
                      <select
                        id="shippingCoverage"
                        value={settingsForm.shippingCoverage}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            shippingCoverage: e.target.value as SupplierShippingCoverage,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                      >
                        <option value="LOCAL">Local (my state only)</option>
                        <option value="REGIONAL">Regional (my zone)</option>
                        <option value="NATIONWIDE">Nationwide</option>
                      </select>
                    </div>

                    <div className="col-span-full rounded-2xl border border-blue-100 bg-blue-50 p-4">
                      <div className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">📦</span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Pickup options</p>
                          <p className="text-xs text-slate-600 mt-0.5">
                            Our logistics partner collects orders from your pickup address and
                            delivers to the customer — you never interact with them directly.{" "}
                            <span className="font-medium text-blue-700">GIG Logistics hub pickup</span>{" "}
                            is automatically available to your customers whenever DaySpring routes
                            shipping through GIGL — no setup needed from you.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {settingsErr && (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                      {settingsErr}
                    </div>
                  )}

                  {settingsMsg && !settingsErr && (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
                      {settingsMsg}
                    </div>
                  )}

                  <div className="mt-5 flex justify-end">
                    <button
                      onClick={() => {
                        setSettingsErr(null);
                        setSettingsMsg(null);
                        settingsMutation.mutate();
                      }}
                      disabled={settingsMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {settingsMutation.isPending ? "Saving..." : "Save settings"}
                    </button>
                  </div>
                </Card>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-5">
                  <SectionTitle
                    icon={<MapPin className="h-5 w-5" />}
                    title="Address and zone summary"
                    subtitle="Checkout shipping starts from your pickup address or your registered business address."
                  />

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">Pickup address</div>
                        <Link
                          to="/supplier/onboarding/address?requestPickupChange=1"
                          className="shrink-0 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100 transition"
                        >
                          Change
                        </Link>
                      </div>
                      <div className="text-sm text-slate-600">
                        {data.supplier.pickupAddress
                          ? `${data.supplier.pickupAddress.city || ""}, ${data.supplier.pickupAddress.state || ""}, ${data.supplier.pickupAddress.country || ""}`
                          : "No pickup address set"}
                      </div>
                    </div>

                    <div className="rounded-2xl border p-4">
                      <div className="mb-2 text-sm font-semibold text-slate-900">
                        Registered address
                      </div>
                      <div className="text-sm text-slate-600">
                        {data.supplier.registeredAddress
                          ? `${data.supplier.registeredAddress.city || ""}, ${data.supplier.registeredAddress.state || ""}, ${data.supplier.registeredAddress.country || ""}`
                          : "No registered address set"}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        Can't be self-edited — contact support if this needs to change.
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            </div>
          )}
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
