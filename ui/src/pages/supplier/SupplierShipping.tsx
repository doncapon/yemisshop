import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  MapPin,
  Package,
  Save,
  Plus,
  Trash2,
  Truck,
  Settings2,
  Layers,
  AlertCircle,
} from "lucide-react";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

type DeliveryServiceLevel = "STANDARD" | "EXPRESS" | "PICKUP_POINT" | "SAME_DAY";
type ShippingParcelClass = "STANDARD" | "FRAGILE" | "BULKY";
type SupplierShippingProfileMode =
  | "DEFAULT_PLATFORM"
  | "SUPPLIER_OVERRIDDEN"
  | "MANUAL_QUOTE";
type SupplierFulfillmentMode =
  | "SUPPLIER_SELF_SHIP"
  | "COURIER_DROPOFF"
  | "PLATFORM_LABEL"
  | "MANUAL_QUOTE";

type Zone = {
  id: string;
  code: string;
  name: string;
  country?: string;
  priority?: number;
};

type SupplierEnvelope = {
  supplier: {
    id: string;
    name: string;
    shippingEnabled: boolean;
    shipsNationwide: boolean;
    supportsDoorDelivery: boolean;
    supportsPickupPoint: boolean;
    defaultLeadDays: number | null;
    handlingFee: number | null;
    defaultServiceLevel: DeliveryServiceLevel | null;
    shippingProfileMode: SupplierShippingProfileMode;
    pickupAddressId?: string | null;
    registeredAddressId?: string | null;
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
    shippingProfile?: {
      id: string;
      originZoneCode: string | null;
      fulfillmentMode: SupplierFulfillmentMode;
      preferredCarrier: string | null;
      localFlatFee: number | null;
      nearbyFlatFee: number | null;
      nationwideBaseFee: number | null;
      defaultHandlingFee: number | null;
      isActive: boolean;
    } | null;
  };
  zones: Zone[];
  rateCards: RateCard[];
};

type RateCard = {
  id: string;
  supplierId: string;
  zoneId: string;
  zone: Zone;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  minWeightGrams: number;
  maxWeightGrams: number | null;
  volumetricDivisor: number | null;
  maxLengthCm: number | null;
  maxWidthCm: number | null;
  maxHeightCm: number | null;
  baseFee: number;
  perKgFee: number | null;
  remoteSurcharge: number | null;
  fuelSurcharge: number | null;
  handlingFee: number | null;
  currency: string;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

type RateCardForm = {
  zoneId: string;
  serviceLevel: DeliveryServiceLevel;
  parcelClass: ShippingParcelClass;
  minWeightGrams: string;
  maxWeightGrams: string;
  volumetricDivisor: string;
  maxLengthCm: string;
  maxWidthCm: string;
  maxHeightCm: string;
  baseFee: string;
  perKgFee: string;
  remoteSurcharge: string;
  fuelSurcharge: string;
  handlingFee: string;
  etaMinDays: string;
  etaMaxDays: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
};

const SERVICE_LEVELS: DeliveryServiceLevel[] = [
  "STANDARD",
  "EXPRESS",
  "PICKUP_POINT",
  "SAME_DAY",
];

const PARCEL_CLASSES: ShippingParcelClass[] = ["STANDARD", "FRAGILE", "BULKY"];

const PROFILE_MODES: SupplierShippingProfileMode[] = [
  "DEFAULT_PLATFORM",
  "SUPPLIER_OVERRIDDEN",
  "MANUAL_QUOTE",
];

const FULFILLMENT_MODES: SupplierFulfillmentMode[] = [
  "SUPPLIER_SELF_SHIP",
  "COURIER_DROPOFF",
  "PLATFORM_LABEL",
  "MANUAL_QUOTE",
];

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

function toInputDateTime(v?: string | null) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function emptyRateCardForm(zones: Zone[]): RateCardForm {
  return {
    zoneId: zones[0]?.id || "",
    serviceLevel: "STANDARD",
    parcelClass: "STANDARD",
    minWeightGrams: "0",
    maxWeightGrams: "",
    volumetricDivisor: "",
    maxLengthCm: "",
    maxWidthCm: "",
    maxHeightCm: "",
    baseFee: "",
    perKgFee: "",
    remoteSurcharge: "",
    fuelSurcharge: "",
    handlingFee: "",
    etaMinDays: "",
    etaMaxDays: "",
    isActive: true,
    startsAt: "",
    endsAt: "",
  };
}

function moneyOrBlank(v?: number | null) {
  return v == null ? "" : String(v);
}

function numOrNull(v: string) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
    shipsNationwide: true,
    supportsDoorDelivery: true,
    supportsPickupPoint: false,
    defaultLeadDays: "",
    handlingFee: "",
    defaultServiceLevel: "STANDARD" as DeliveryServiceLevel,
    shippingProfileMode: "DEFAULT_PLATFORM" as SupplierShippingProfileMode,
  });

  const [profileForm, setProfileForm] = useState({
    originZoneCode: "",
    fulfillmentMode: "SUPPLIER_SELF_SHIP" as SupplierFulfillmentMode,
    preferredCarrier: "",
    localFlatFee: "",
    nearbyFlatFee: "",
    nationwideBaseFee: "",
    defaultHandlingFee: "",
    isActive: true,
  });

  const [rateForm, setRateForm] = useState<RateCardForm>(emptyRateCardForm([]));
  const [editingRateId, setEditingRateId] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.supplier) return;

    setSettingsForm({
      shippingEnabled: !!data.supplier.shippingEnabled,
      shipsNationwide: !!data.supplier.shipsNationwide,
      supportsDoorDelivery: !!data.supplier.supportsDoorDelivery,
      supportsPickupPoint: !!data.supplier.supportsPickupPoint,
      defaultLeadDays:
        data.supplier.defaultLeadDays == null ? "" : String(data.supplier.defaultLeadDays),
      handlingFee: moneyOrBlank(data.supplier.handlingFee),
      defaultServiceLevel:
        data.supplier.defaultServiceLevel ?? ("STANDARD" as DeliveryServiceLevel),
      shippingProfileMode: data.supplier.shippingProfileMode,
    });

    setProfileForm({
      originZoneCode: data.supplier.shippingProfile?.originZoneCode ?? "",
      fulfillmentMode:
        data.supplier.shippingProfile?.fulfillmentMode ?? "SUPPLIER_SELF_SHIP",
      preferredCarrier: data.supplier.shippingProfile?.preferredCarrier ?? "",
      localFlatFee: moneyOrBlank(data.supplier.shippingProfile?.localFlatFee),
      nearbyFlatFee: moneyOrBlank(data.supplier.shippingProfile?.nearbyFlatFee),
      nationwideBaseFee: moneyOrBlank(data.supplier.shippingProfile?.nationwideBaseFee),
      defaultHandlingFee: moneyOrBlank(
        data.supplier.shippingProfile?.defaultHandlingFee
      ),
      isActive: data.supplier.shippingProfile?.isActive ?? true,
    });

    setRateForm((prev) =>
      prev.zoneId
        ? prev
        : emptyRateCardForm(data.zones || [])
    );
  }, [data]);

  const zoneMap = useMemo(() => {
    return new Map((data?.zones || []).map((z) => [z.id, z]));
  }, [data?.zones]);

  const settingsMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        shippingEnabled: settingsForm.shippingEnabled,
        shipsNationwide: settingsForm.shipsNationwide,
        supportsDoorDelivery: settingsForm.supportsDoorDelivery,
        supportsPickupPoint: settingsForm.supportsPickupPoint,
        defaultLeadDays: numOrNull(settingsForm.defaultLeadDays),
        handlingFee: numOrNull(settingsForm.handlingFee),
        defaultServiceLevel: settingsForm.defaultServiceLevel || null,
        shippingProfileMode: settingsForm.shippingProfileMode,
      };
      const { data } = await api.put("/api/supplier/shipping/me/settings", payload, {
        withCredentials: true,
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier-shipping-me"] });
      alert("Shipping settings saved.");
    },
    onError: (e: any) => {
      alert(e?.response?.data?.error || e?.message || "Failed to save shipping settings.");
    },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        originZoneCode: profileForm.originZoneCode || null,
        fulfillmentMode: profileForm.fulfillmentMode,
        preferredCarrier: profileForm.preferredCarrier.trim() || null,
        localFlatFee: numOrNull(profileForm.localFlatFee),
        nearbyFlatFee: numOrNull(profileForm.nearbyFlatFee),
        nationwideBaseFee: numOrNull(profileForm.nationwideBaseFee),
        defaultHandlingFee: numOrNull(profileForm.defaultHandlingFee),
        isActive: profileForm.isActive,
      };
      const { data } = await api.put("/api/supplier/shipping/me/profile", payload, {
        withCredentials: true,
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier-shipping-me"] });
      alert("Shipping profile saved.");
    },
    onError: (e: any) => {
      alert(e?.response?.data?.error || e?.message || "Failed to save shipping profile.");
    },
  });

  const saveRateMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        zoneId: rateForm.zoneId,
        serviceLevel: rateForm.serviceLevel,
        parcelClass: rateForm.parcelClass,
        minWeightGrams: Number(rateForm.minWeightGrams || 0),
        maxWeightGrams: numOrNull(rateForm.maxWeightGrams),
        volumetricDivisor: numOrNull(rateForm.volumetricDivisor),
        maxLengthCm: numOrNull(rateForm.maxLengthCm),
        maxWidthCm: numOrNull(rateForm.maxWidthCm),
        maxHeightCm: numOrNull(rateForm.maxHeightCm),
        baseFee: Number(rateForm.baseFee || 0),
        perKgFee: numOrNull(rateForm.perKgFee),
        remoteSurcharge: numOrNull(rateForm.remoteSurcharge),
        fuelSurcharge: numOrNull(rateForm.fuelSurcharge),
        handlingFee: numOrNull(rateForm.handlingFee),
        etaMinDays: numOrNull(rateForm.etaMinDays),
        etaMaxDays: numOrNull(rateForm.etaMaxDays),
        isActive: rateForm.isActive,
        startsAt: rateForm.startsAt ? new Date(rateForm.startsAt).toISOString() : null,
        endsAt: rateForm.endsAt ? new Date(rateForm.endsAt).toISOString() : null,
      };

      if (editingRateId) {
        const { data } = await api.put(
          `/api/supplier/shipping/me/rate-cards/${editingRateId}`,
          payload,
          { withCredentials: true }
        );
        return data;
      }

      const { data } = await api.post("/api/supplier/shipping/me/rate-cards", payload, {
        withCredentials: true,
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier-shipping-me"] });
      setEditingRateId(null);
      setRateForm(emptyRateCardForm(data?.zones || []));
      alert("Rate card saved.");
    },
    onError: (e: any) => {
      alert(e?.response?.data?.error || e?.message || "Failed to save rate card.");
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/supplier/shipping/me/rate-cards/${id}`, {
        withCredentials: true,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier-shipping-me"] });
      alert("Rate card deleted.");
    },
    onError: (e: any) => {
      alert(e?.response?.data?.error || e?.message || "Failed to delete rate card.");
    },
  });

  const startEditRate = (r: RateCard) => {
    setEditingRateId(r.id);
    setRateForm({
      zoneId: r.zoneId,
      serviceLevel: r.serviceLevel,
      parcelClass: r.parcelClass,
      minWeightGrams: String(r.minWeightGrams ?? 0),
      maxWeightGrams: r.maxWeightGrams == null ? "" : String(r.maxWeightGrams),
      volumetricDivisor: r.volumetricDivisor == null ? "" : String(r.volumetricDivisor),
      maxLengthCm: r.maxLengthCm == null ? "" : String(r.maxLengthCm),
      maxWidthCm: r.maxWidthCm == null ? "" : String(r.maxWidthCm),
      maxHeightCm: r.maxHeightCm == null ? "" : String(r.maxHeightCm),
      baseFee: String(r.baseFee ?? ""),
      perKgFee: r.perKgFee == null ? "" : String(r.perKgFee),
      remoteSurcharge: r.remoteSurcharge == null ? "" : String(r.remoteSurcharge),
      fuelSurcharge: r.fuelSurcharge == null ? "" : String(r.fuelSurcharge),
      handlingFee: r.handlingFee == null ? "" : String(r.handlingFee),
      etaMinDays: r.etaMinDays == null ? "" : String(r.etaMinDays),
      etaMaxDays: r.etaMaxDays == null ? "" : String(r.etaMaxDays),
      isActive: !!r.isActive,
      startsAt: toInputDateTime(r.startsAt),
      endsAt: toInputDateTime(r.endsAt),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetRateForm = () => {
    setEditingRateId(null);
    setRateForm(emptyRateCardForm(data?.zones || []));
  };

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
                    subtitle="These settings decide whether platform rates or your own rates take priority."
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

                    <label className="flex items-center gap-3 rounded-2xl border p-4">
                      <input
                        type="checkbox"
                        checked={settingsForm.shipsNationwide}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            shipsNationwide: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-medium text-slate-700">
                        Ships nationwide
                      </span>
                    </label>

                    <label className="flex items-center gap-3 rounded-2xl border p-4">
                      <input
                        type="checkbox"
                        checked={settingsForm.supportsDoorDelivery}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            supportsDoorDelivery: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-medium text-slate-700">
                        Supports door delivery
                      </span>
                    </label>

                    <label className="flex items-center gap-3 rounded-2xl border p-4">
                      <input
                        type="checkbox"
                        checked={settingsForm.supportsPickupPoint}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            supportsPickupPoint: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-medium text-slate-700">
                        Supports pickup point
                      </span>
                    </label>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Shipping mode
                      </label>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={settingsForm.shippingProfileMode}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            shippingProfileMode: e.target.value as SupplierShippingProfileMode,
                          }))
                        }
                      >
                        {PROFILE_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Default service level
                      </label>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={settingsForm.defaultServiceLevel}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            defaultServiceLevel: e.target.value as DeliveryServiceLevel,
                          }))
                        }
                      >
                        {SERVICE_LEVELS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Default lead days
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={settingsForm.defaultLeadDays}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            defaultLeadDays: e.target.value,
                          }))
                        }
                        placeholder="e.g. 2"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Supplier handling fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={settingsForm.handlingFee}
                        onChange={(e) =>
                          setSettingsForm((s) => ({
                            ...s,
                            handlingFee: e.target.value,
                          }))
                        }
                        placeholder="e.g. 500"
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex justify-end">
                    <button
                      onClick={() => settingsMutation.mutate()}
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
                    icon={<Truck className="h-5 w-5" />}
                    title="Shipping profile"
                    subtitle="Use this for supplier-priority pricing, flat fees, and fulfillment behavior."
                  />

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Fulfillment mode
                      </label>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={profileForm.fulfillmentMode}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            fulfillmentMode: e.target.value as SupplierFulfillmentMode,
                          }))
                        }
                      >
                        {FULFILLMENT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Origin zone
                      </label>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={profileForm.originZoneCode}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            originZoneCode: e.target.value,
                          }))
                        }
                      >
                        <option value="">Auto from pickup/registered address</option>
                        {data.zones.map((z) => (
                          <option key={z.code} value={z.code}>
                            {z.name} ({z.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Preferred carrier
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={profileForm.preferredCarrier}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            preferredCarrier: e.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                    </div>

                    <label className="flex items-center gap-3 rounded-2xl border p-4">
                      <input
                        type="checkbox"
                        checked={profileForm.isActive}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            isActive: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-medium text-slate-700">
                        Profile active
                      </span>
                    </label>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Local flat fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={profileForm.localFlatFee}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            localFlatFee: e.target.value,
                          }))
                        }
                        placeholder="Same-zone delivery"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Nearby flat fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={profileForm.nearbyFlatFee}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            nearbyFlatFee: e.target.value,
                          }))
                        }
                        placeholder="Nearby-zone delivery"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Nationwide base fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={profileForm.nationwideBaseFee}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            nationwideBaseFee: e.target.value,
                          }))
                        }
                        placeholder="Fallback for wider delivery"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Default handling fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={profileForm.defaultHandlingFee}
                        onChange={(e) =>
                          setProfileForm((s) => ({
                            ...s,
                            defaultHandlingFee: e.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-600">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4" />
                      <div>
                        In <strong>SUPPLIER_OVERRIDDEN</strong> mode, your supplier rate cards and
                        profile flat fees are used first. Platform rates only act as fallback.
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex justify-end">
                    <button
                      onClick={() => profileMutation.mutate()}
                      disabled={profileMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {profileMutation.isPending ? "Saving..." : "Save profile"}
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
                      <div className="mb-2 text-sm font-semibold text-slate-900">Pickup address</div>
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
                    </div>
                  </div>
                </Card>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-5">
                  <SectionTitle
                    icon={<Layers className="h-5 w-5" />}
                    title={editingRateId ? "Edit supplier rate card" : "Create supplier rate card"}
                    subtitle="Set destination-zone rates for weight bands and parcel classes."
                  />

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Zone</label>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.zoneId}
                        onChange={(e) =>
                          setRateForm((s) => ({ ...s, zoneId: e.target.value }))
                        }
                      >
                        {(data.zones || []).map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name} ({z.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Service level
                      </label>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.serviceLevel}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            serviceLevel: e.target.value as DeliveryServiceLevel,
                          }))
                        }
                      >
                        {SERVICE_LEVELS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Parcel class
                      </label>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.parcelClass}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            parcelClass: e.target.value as ShippingParcelClass,
                          }))
                        }
                      >
                        {PARCEL_CLASSES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-center gap-3 rounded-2xl border p-4">
                      <input
                        type="checkbox"
                        checked={rateForm.isActive}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            isActive: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-medium text-slate-700">Rate active</span>
                    </label>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Min weight (g)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.minWeightGrams}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            minWeightGrams: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Max weight (g)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.maxWeightGrams}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            maxWeightGrams: e.target.value,
                          }))
                        }
                        placeholder="Leave blank for open-ended"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Base fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.baseFee}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            baseFee: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Per-kg fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.perKgFee}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            perKgFee: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Remote surcharge (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.remoteSurcharge}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            remoteSurcharge: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Fuel surcharge (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.fuelSurcharge}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            fuelSurcharge: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Handling fee (NGN)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.handlingFee}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            handlingFee: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Volumetric divisor
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.volumetricDivisor}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            volumetricDivisor: e.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        ETA min days
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.etaMinDays}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            etaMinDays: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        ETA max days
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.etaMaxDays}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            etaMaxDays: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Starts at
                      </label>
                      <input
                        type="datetime-local"
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.startsAt}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            startsAt: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Ends at
                      </label>
                      <input
                        type="datetime-local"
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.endsAt}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            endsAt: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Max length (cm)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.maxLengthCm}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            maxLengthCm: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Max width (cm)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.maxWidthCm}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            maxWidthCm: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Max height (cm)
                      </label>
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={rateForm.maxHeightCm}
                        onChange={(e) =>
                          setRateForm((s) => ({
                            ...s,
                            maxHeightCm: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap justify-end gap-3">
                    {editingRateId ? (
                      <button
                        onClick={resetRateForm}
                        className="rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700"
                      >
                        Cancel edit
                      </button>
                    ) : null}

                    <button
                      onClick={() => saveRateMutation.mutate()}
                      disabled={saveRateMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {editingRateId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      {saveRateMutation.isPending
                        ? "Saving..."
                        : editingRateId
                        ? "Update rate card"
                        : "Create rate card"}
                    </button>
                  </div>
                </Card>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="overflow-hidden">
                  <div className="border-b p-5">
                    <SectionTitle
                      icon={<Package className="h-5 w-5" />}
                      title="Your supplier rate cards"
                      subtitle="These are used first when you are in SUPPLIER_OVERRIDDEN mode."
                    />
                  </div>

                  {(data.rateCards || []).length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">
                      No supplier rate cards yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-4 py-3 font-medium">Zone</th>
                            <th className="px-4 py-3 font-medium">Service</th>
                            <th className="px-4 py-3 font-medium">Class</th>
                            <th className="px-4 py-3 font-medium">Weight band</th>
                            <th className="px-4 py-3 font-medium">Base fee</th>
                            <th className="px-4 py-3 font-medium">Per kg</th>
                            <th className="px-4 py-3 font-medium">ETA</th>
                            <th className="px-4 py-3 font-medium">Active</th>
                            <th className="px-4 py-3 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.rateCards.map((r) => (
                            <tr key={r.id} className="border-t">
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-900">
                                  {r.zone?.name || zoneMap.get(r.zoneId)?.name || "Zone"}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {r.zone?.code || zoneMap.get(r.zoneId)?.code || ""}
                                </div>
                              </td>
                              <td className="px-4 py-3">{r.serviceLevel}</td>
                              <td className="px-4 py-3">{r.parcelClass}</td>
                              <td className="px-4 py-3">
                                {r.minWeightGrams}g
                                {" - "}
                                {r.maxWeightGrams == null ? "open" : `${r.maxWeightGrams}g`}
                              </td>
                              <td className="px-4 py-3">NGN {r.baseFee.toLocaleString()}</td>
                              <td className="px-4 py-3">
                                {r.perKgFee == null ? "—" : `NGN ${r.perKgFee.toLocaleString()}`}
                              </td>
                              <td className="px-4 py-3">
                                {r.etaMinDays == null && r.etaMaxDays == null
                                  ? "—"
                                  : `${r.etaMinDays ?? 0}-${r.etaMaxDays ?? r.etaMinDays ?? 0}d`}
                              </td>
                              <td className="px-4 py-3">
                                {r.isActive ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                    <BadgeCheck className="h-3.5 w-3.5" />
                                    Active
                                  </span>
                                ) : (
                                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                    Inactive
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => startEditRate(r)}
                                    className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-700"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      const ok = window.confirm(
                                        "Delete this supplier rate card?"
                                      );
                                      if (ok) deleteRateMutation.mutate(r.id);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </motion.div>
            </div>
          )}
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}