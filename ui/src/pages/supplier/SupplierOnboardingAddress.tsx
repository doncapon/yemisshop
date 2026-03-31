// src/pages/supplier/SupplierOnboardingAddress.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  Store,
  Truck,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";
import { NIGERIAN_STATES, STATE_TO_LGAS } from "../../constants/nigeriaLocations";

type AddressDto = {
  id?: string;
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lga?: string | null;
  directionsNote?: string | null;
  landmark?: string | null;
};

type SupplierMe = {
  id: string;
  supplierId?: string;
  name?: string | null;
  businessName?: string | null;
  registeredAddress?: AddressDto | null;
  pickupAddress?: AddressDto | null;
  pickupContactName?: string | null;
  pickupContactPhone?: string | null;
  pickupInstructions?: string | null;
  shippingEnabled?: boolean | null;
  shipsNationwide?: boolean | null;
  supportsDoorDelivery?: boolean | null;
  supportsPickupPoint?: boolean | null;
  status?: string | null;
  kycStatus?: string | null;
  documents?: unknown[] | null;
  verificationDocuments?: unknown[] | null;
  identityDocumentUrl?: string | null;
  proofOfAddressUrl?: string | null;
  cacDocumentUrl?: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type AddressState = {
  houseNumber: string;
  streetName: string;
  postCode: string;
  town: string;
  city: string;
  state: string;
  country: string;
  lga: string;
  landmark: string;
  directionsNote: string;
};

type PickupMetaState = {
  pickupContactName: string;
  pickupContactPhone: string;
  pickupInstructions: string;
  shippingEnabled: boolean;
  shipsNationwide: boolean;
  supportsDoorDelivery: boolean;
  supportsPickupPoint: boolean;
};

type AddressDraft = {
  registered: AddressState;
  pickup: AddressState;
  pickupMeta: PickupMetaState;
  sameAsRegistered: boolean;
};

type CountryOption = {
  code: string;
  name: string;
};

const ADDRESS_DRAFT_KEY = "supplier-onboarding-address-draft";

const EMPTY_ADDRESS: AddressState = {
  houseNumber: "",
  streetName: "",
  postCode: "",
  town: "",
  city: "",
  state: "",
  country: "Nigeria",
  lga: "",
  landmark: "",
  directionsNote: "",
};

const EMPTY_PICKUP_META: PickupMetaState = {
  pickupContactName: "",
  pickupContactPhone: "",
  pickupInstructions: "",
  shippingEnabled: true,
  shipsNationwide: true,
  supportsDoorDelivery: true,
  supportsPickupPoint: false,
};

function pickString(v: unknown): string {
  return String(v ?? "").trim();
}

function boolOrDefault(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function addressHasMinimum(addr: {
  streetName: string;
  city: string;
  state: string;
  country: string;
}): boolean {
  return Boolean(
    addr.streetName.trim() &&
      addr.city.trim() &&
      addr.state.trim() &&
      addr.country.trim()
  );
}

function safeReadAddressDraft(): AddressDraft | null {
  try {
    const raw = sessionStorage.getItem(ADDRESS_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as AddressDraft;
  } catch {
    return null;
  }
}

function resolveCountryName(
  value: string | null | undefined,
  countries: CountryOption[]
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return countries[0]?.name || "Nigeria";

  const byName = countries.find((c) => c.name.toLowerCase() === raw.toLowerCase());
  if (byName) return byName.name;

  const byCode = countries.find((c) => c.code.toLowerCase() === raw.toLowerCase());
  if (byCode) return byCode.name;

  return raw;
}

function countryValueToCodeOrName(
  value: string,
  countries: CountryOption[]
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const byName = countries.find((c) => c.name.toLowerCase() === raw.toLowerCase());
  if (byName) return byName.code;

  const byCode = countries.find((c) => c.code.toLowerCase() === raw.toLowerCase());
  if (byCode) return byCode.code;

  return raw;
}

function normalizeAddressDto(
  addr: AddressDto | null | undefined,
  countries: CountryOption[]
): AddressState {
  return {
    houseNumber: pickString(addr?.houseNumber),
    streetName: pickString(addr?.streetName),
    postCode: pickString(addr?.postCode),
    town: pickString(addr?.town),
    city: pickString(addr?.city),
    state: pickString(addr?.state),
    country: resolveCountryName(addr?.country, countries),
    lga: pickString(addr?.lga),
    landmark: pickString(addr?.landmark),
    directionsNote: pickString(addr?.directionsNote),
  };
}

function normalizePickupMeta(s: SupplierMe | null | undefined): PickupMetaState {
  return {
    pickupContactName: pickString(s?.pickupContactName),
    pickupContactPhone: pickString(s?.pickupContactPhone),
    pickupInstructions: pickString(s?.pickupInstructions),
    shippingEnabled: boolOrDefault(s?.shippingEnabled, true),
    shipsNationwide: boolOrDefault(s?.shipsNationwide, true),
    supportsDoorDelivery: boolOrDefault(s?.supportsDoorDelivery, true),
    supportsPickupPoint: boolOrDefault(s?.supportsPickupPoint, false),
  };
}

function addressesEqual(a: AddressState, b: AddressState): boolean {
  return (
    pickString(a.houseNumber) === pickString(b.houseNumber) &&
    pickString(a.streetName) === pickString(b.streetName) &&
    pickString(a.postCode) === pickString(b.postCode) &&
    pickString(a.town) === pickString(b.town) &&
    pickString(a.city) === pickString(b.city) &&
    pickString(a.state) === pickString(b.state) &&
    pickString(a.country).toLowerCase() === pickString(b.country).toLowerCase() &&
    pickString(a.lga) === pickString(b.lga) &&
    pickString(a.landmark) === pickString(b.landmark) &&
    pickString(a.directionsNote) === pickString(b.directionsNote)
  );
}

function pickupMetaEqual(a: PickupMetaState, b: PickupMetaState): boolean {
  return (
    pickString(a.pickupContactName) === pickString(b.pickupContactName) &&
    pickString(a.pickupContactPhone) === pickString(b.pickupContactPhone) &&
    pickString(a.pickupInstructions) === pickString(b.pickupInstructions) &&
    a.shippingEnabled === b.shippingEnabled &&
    a.shipsNationwide === b.shipsNationwide &&
    a.supportsDoorDelivery === b.supportsDoorDelivery &&
    a.supportsPickupPoint === b.supportsPickupPoint
  );
}

function supplierHasDocuments(s: SupplierMe | null): boolean {
  if (!s) return false;
  return Boolean(
    (Array.isArray(s.documents) && s.documents.length > 0) ||
      (Array.isArray(s.verificationDocuments) &&
        s.verificationDocuments.length > 0) ||
      s.identityDocumentUrl ||
      s.proofOfAddressUrl ||
      s.cacDocumentUrl
  );
}

function isAddressMeaningfullyPresent(addr: AddressDto | null | undefined): boolean {
  return Boolean(
    pickString(addr?.houseNumber) ||
      pickString(addr?.streetName) ||
      pickString(addr?.postCode) ||
      pickString(addr?.town) ||
      pickString(addr?.city) ||
      pickString(addr?.state) ||
      pickString(addr?.country) ||
      pickString(addr?.lga) ||
      pickString(addr?.landmark) ||
      pickString(addr?.directionsNote)
  );
}

function isVerifiedSupplier(supplier: SupplierMe | null): boolean {
  const status = String(supplier?.status ?? "").trim().toUpperCase();
  const kycStatus = String(supplier?.kycStatus ?? "").trim().toUpperCase();

  return (
    status === "APPROVED" ||
    status === "ACTIVE" ||
    status === "VERIFIED" ||
    status === "COMPLETED" ||
    status === "ENABLED" ||
    kycStatus === "APPROVED" ||
    kycStatus === "VERIFIED" ||
    kycStatus === "COMPLETED"
  );
}

function normalizeStateKey(input: string): string {
  return String(input ?? "").trim().toLowerCase();
}

function getCanonicalStateName(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  const matched = NIGERIAN_STATES.find(
    (s) => normalizeStateKey(s) === normalizeStateKey(raw)
  );

  return matched || raw;
}

function getLgaOptionsForState(stateValue: string): string[] {
  const canonicalState = getCanonicalStateName(stateValue);
  if (!canonicalState) return [];

  const direct = (STATE_TO_LGAS as Record<string, string[]>)[canonicalState];
  if (Array.isArray(direct)) return direct;

  const foundKey = Object.keys(STATE_TO_LGAS).find(
    (k) => normalizeStateKey(k) === normalizeStateKey(canonicalState)
  );

  if (!foundKey) return [];
  const list = (STATE_TO_LGAS as Record<string, string[]>)[foundKey];
  return Array.isArray(list) ? list : [];
}

function isNigeriaCountry(country: string): boolean {
  const v = String(country ?? "").trim().toLowerCase();
  return v === "nigeria" || v === "ng";
}

type AddressSectionProps = {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  value: AddressState;
  countries: CountryOption[];
  onFieldChange: (
    key: keyof AddressState
  ) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => void;
};

function AddressFieldsSection({
  title,
  subtitle,
  icon,
  value,
  countries,
  onFieldChange,
}: AddressSectionProps): React.ReactElement {
  const nigeria = isNigeriaCountry(value.country);
  const stateOptions = NIGERIAN_STATES;
  const lgaOptions = useMemo(() => getLgaOptionsForState(value.state), [value.state]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl bg-zinc-100 p-3">{icon}</div>
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <p className="text-sm text-zinc-600">{subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            House number
          </label>
          <input
            value={value.houseNumber}
            onChange={onFieldChange("houseNumber")}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            placeholder="House number"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Street name
          </label>
          <input
            value={value.streetName}
            onChange={onFieldChange("streetName")}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            placeholder="Street name"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Town / Area
          </label>
          <input
            value={value.town}
            onChange={onFieldChange("town")}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            placeholder="Town / Area"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            City
          </label>
          <input
            value={value.city}
            onChange={onFieldChange("city")}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            placeholder="City"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Country
          </label>
          <select
            value={value.country}
            onChange={onFieldChange("country")}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
          >
            {countries.length === 0 && <option value="Nigeria">Loading countries...</option>}
            {countries.map((c) => (
              <option key={c.code} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            State
          </label>

          {nigeria ? (
            <select
              value={getCanonicalStateName(value.state)}
              onChange={onFieldChange("state")}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            >
              <option value="">Select state</option>
              {stateOptions.map((stateName) => (
                <option key={stateName} value={stateName}>
                  {stateName}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={value.state}
              onChange={onFieldChange("state")}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
              placeholder="State"
            />
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Post code
          </label>
          <input
            value={value.postCode}
            onChange={onFieldChange("postCode")}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            placeholder="Post code"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            LGA
          </label>

          {nigeria ? (
            <select
              value={value.lga}
              onChange={onFieldChange("lga")}
              disabled={!value.state}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 md:text-sm"
            >
              <option value="">{value.state ? "Select LGA" : "Select state first"}</option>
              {lgaOptions.map((lga) => (
                <option key={lga} value={lga}>
                  {lga}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={value.lga}
              onChange={onFieldChange("lga")}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
              placeholder="LGA / County / Region"
            />
          )}
        </div>

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Landmark
          </label>
          <input
            value={value.landmark}
            onChange={onFieldChange("landmark")}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            placeholder="Nearby landmark"
          />
        </div>

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Directions note
          </label>
          <textarea
            value={value.directionsNote}
            onChange={onFieldChange("directionsNote")}
            className="min-h-[100px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
            placeholder="Helpful directions for finding this address"
          />
        </div>
      </div>
    </div>
  );
}

export default function SupplierOnboardingAddress(): React.ReactElement {
  const nav = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [supplier, setSupplier] = useState<SupplierMe | null>(null);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [draftRestored, setDraftRestored] = useState<boolean>(false);

  const [sameAsRegistered, setSameAsRegistered] = useState<boolean>(true);
  const [registered, setRegistered] = useState<AddressState>(EMPTY_ADDRESS);
  const [pickup, setPickup] = useState<AddressState>(EMPTY_ADDRESS);
  const [pickupMeta, setPickupMeta] = useState<PickupMetaState>(EMPTY_PICKUP_META);

  const hasHydratedRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);

  const setRegisteredField =
    (key: keyof AddressState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ): void => {
      const nextValue = e.target.value;

      setRegistered((s) => {
        const next = { ...s, [key]: nextValue };

        if (key === "country") {
          if (!isNigeriaCountry(nextValue)) {
            next.state = "";
            next.lga = "";
          } else {
            next.country = "Nigeria";
          }
        }

        if (key === "state") {
          next.state = getCanonicalStateName(nextValue);
          const nextLgas = getLgaOptionsForState(next.state);
          if (!nextLgas.includes(next.lga)) next.lga = "";
        }

        return next;
      });

      setSaveState("idle");
      setErr(null);
    };

  const setPickupField =
    (key: keyof AddressState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ): void => {
      const nextValue = e.target.value;

      setPickup((s) => {
        const next = { ...s, [key]: nextValue };

        if (key === "country") {
          if (!isNigeriaCountry(nextValue)) {
            next.state = "";
            next.lga = "";
          } else {
            next.country = "Nigeria";
          }
        }

        if (key === "state") {
          next.state = getCanonicalStateName(nextValue);
          const nextLgas = getLgaOptionsForState(next.state);
          if (!nextLgas.includes(next.lga)) next.lga = "";
        }

        return next;
      });

      setSaveState("idle");
      setErr(null);
    };

  const setPickupMetaField =
    (key: keyof PickupMetaState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ): void => {
      const value: string | boolean =
        e.target instanceof HTMLInputElement && e.target.type === "checkbox"
          ? e.target.checked
          : e.target.value;

      setPickupMeta((s) => ({
        ...s,
        [key]: value as PickupMetaState[typeof key],
      }));
      setSaveState("idle");
      setErr(null);
    };

  useEffect(() => {
    let mounted = true;

    api
      .get("/api/public/supplier-registration-countries")
      .then((res: { data?: { data?: CountryOption[] } }) => {
        if (!mounted) return;
        const items = Array.isArray(res.data?.data) ? res.data.data : [];
        setCountries(items.length ? items : [{ code: "NG", name: "Nigeria" }]);
      })
      .catch(() => {
        if (!mounted) return;
        setCountries([{ code: "NG", name: "Nigeria" }]);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const hydrateFromSupplier = useCallback(
    (s: SupplierMe, replace = false): void => {
      const savedRegistered = normalizeAddressDto(s.registeredAddress, countries);
      const rawSavedPickup = normalizeAddressDto(s.pickupAddress, countries);
      const pickupExists = isAddressMeaningfullyPresent(s.pickupAddress);
      const inferredSameAsRegistered =
        !pickupExists || addressesEqual(savedRegistered, rawSavedPickup);
      const savedPickup = inferredSameAsRegistered ? savedRegistered : rawSavedPickup;
      const savedPickupMeta = normalizePickupMeta(s);

      setRegistered((prev) =>
        replace
          ? {
              ...savedRegistered,
              state: getCanonicalStateName(savedRegistered.state),
            }
          : {
              houseNumber: pickString(savedRegistered.houseNumber || prev.houseNumber),
              streetName: pickString(savedRegistered.streetName || prev.streetName),
              postCode: pickString(savedRegistered.postCode || prev.postCode),
              town: pickString(savedRegistered.town || prev.town),
              city: pickString(savedRegistered.city || prev.city),
              state: getCanonicalStateName(savedRegistered.state || prev.state),
              country: pickString(savedRegistered.country || prev.country || "Nigeria"),
              lga: pickString(savedRegistered.lga || prev.lga),
              landmark: pickString(savedRegistered.landmark || prev.landmark),
              directionsNote: pickString(
                savedRegistered.directionsNote || prev.directionsNote
              ),
            }
      );

      setPickup((prev) =>
        replace
          ? {
              ...savedPickup,
              state: getCanonicalStateName(savedPickup.state),
            }
          : {
              houseNumber: pickString(savedPickup.houseNumber || prev.houseNumber),
              streetName: pickString(savedPickup.streetName || prev.streetName),
              postCode: pickString(savedPickup.postCode || prev.postCode),
              town: pickString(savedPickup.town || prev.town),
              city: pickString(savedPickup.city || prev.city),
              state: getCanonicalStateName(savedPickup.state || prev.state),
              country: pickString(savedPickup.country || prev.country || "Nigeria"),
              lga: pickString(savedPickup.lga || prev.lga),
              landmark: pickString(savedPickup.landmark || prev.landmark),
              directionsNote: pickString(savedPickup.directionsNote || prev.directionsNote),
            }
      );

      setPickupMeta((prev) =>
        replace
          ? savedPickupMeta
          : {
              pickupContactName: pickString(
                savedPickupMeta.pickupContactName || prev.pickupContactName
              ),
              pickupContactPhone: pickString(
                savedPickupMeta.pickupContactPhone || prev.pickupContactPhone
              ),
              pickupInstructions: pickString(
                savedPickupMeta.pickupInstructions || prev.pickupInstructions
              ),
              shippingEnabled: savedPickupMeta.shippingEnabled,
              shipsNationwide: savedPickupMeta.shipsNationwide,
              supportsDoorDelivery: savedPickupMeta.supportsDoorDelivery,
              supportsPickupPoint: savedPickupMeta.supportsPickupPoint,
            }
      );

      setSameAsRegistered((prev) => (replace ? inferredSameAsRegistered : prev));
    },
    [countries]
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setErr(null);

      const { data } = await api.get("/api/supplier/me", {
        withCredentials: true,
      });

      const s = (data?.data || data) as SupplierMe;
      setSupplier(s);

      const draft = safeReadAddressDraft();
      if (draft) {
        setRegistered({
          ...draft.registered,
          state: getCanonicalStateName(draft.registered.state),
          lga: pickString(draft.registered.lga),
        });
        setPickup({
          ...draft.pickup,
          state: getCanonicalStateName(draft.pickup.state),
          lga: pickString(draft.pickup.lga),
        });
        setPickupMeta(draft.pickupMeta);
        setSameAsRegistered(Boolean(draft.sameAsRegistered));
        setDraftRestored(true);
      } else {
        hydrateFromSupplier(s, true);
        setDraftRestored(false);
      }

      hasHydratedRef.current = true;
    } catch (e: unknown) {
      const error = e as {
        response?: { data?: { error?: string; message?: string } };
      };
      setErr(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          "Could not load supplier addresses."
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateFromSupplier]);

  useEffect(() => {
    void load();
  }, [load, location.key]);

  useEffect(() => {
    const onFocus = (): void => {
      void load();
    };
    const onPageShow = (): void => {
      void load();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [load]);

  useEffect(() => {
    if (loading) return;

    try {
      const draft: AddressDraft = {
        registered,
        pickup,
        pickupMeta,
        sameAsRegistered,
      };
      sessionStorage.setItem(ADDRESS_DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [loading, registered, pickup, pickupMeta, sameAsRegistered]);

  useEffect(() => {
    if (!countries.length) return;

    setRegistered((prev) => {
      const nextCountry = resolveCountryName(prev.country, countries);
      const nigeria = isNigeriaCountry(nextCountry);
      const nextState = nigeria ? getCanonicalStateName(prev.state) : prev.state;
      const nextLgas = nigeria ? getLgaOptionsForState(nextState) : [];
      const nextLga = nigeria && prev.lga && !nextLgas.includes(prev.lga) ? "" : prev.lga;

      return {
        ...prev,
        country: nextCountry,
        state: nextState,
        lga: nextLga,
      };
    });

    setPickup((prev) => {
      const nextCountry = resolveCountryName(prev.country, countries);
      const nigeria = isNigeriaCountry(nextCountry);
      const nextState = nigeria ? getCanonicalStateName(prev.state) : prev.state;
      const nextLgas = nigeria ? getLgaOptionsForState(nextState) : [];
      const nextLga = nigeria && prev.lga && !nextLgas.includes(prev.lga) ? "" : prev.lga;

      return {
        ...prev,
        country: nextCountry,
        state: nextState,
        lga: nextLga,
      };
    });
  }, [countries]);

  useEffect(() => {
    if (!isNigeriaCountry(registered.country)) return;

    const lgas = getLgaOptionsForState(registered.state);
    if (registered.lga && !lgas.includes(registered.lga)) {
      setRegistered((prev) => ({ ...prev, lga: "" }));
    }
  }, [registered.country, registered.state, registered.lga]);

  useEffect(() => {
    if (!isNigeriaCountry(pickup.country)) return;

    const lgas = getLgaOptionsForState(pickup.state);
    if (pickup.lga && !lgas.includes(pickup.lga)) {
      setPickup((prev) => ({ ...prev, lga: "" }));
    }
  }, [pickup.country, pickup.state, pickup.lga]);

  const effectivePickup = useMemo<AddressState>(
    () => (sameAsRegistered ? registered : pickup),
    [sameAsRegistered, registered, pickup]
  );

  const savedRegistered = useMemo<AddressState>(
    () => normalizeAddressDto(supplier?.registeredAddress, countries),
    [supplier, countries]
  );

  const rawSavedPickup = useMemo<AddressState>(
    () => normalizeAddressDto(supplier?.pickupAddress, countries),
    [supplier, countries]
  );

  const savedSameAsRegistered = useMemo<boolean>(() => {
    if (!supplier) return true;
    const pickupExists = isAddressMeaningfullyPresent(supplier.pickupAddress);
    return !pickupExists || addressesEqual(savedRegistered, rawSavedPickup);
  }, [supplier, savedRegistered, rawSavedPickup]);

  const savedPickup = useMemo<AddressState>(
    () => (savedSameAsRegistered ? savedRegistered : rawSavedPickup),
    [savedSameAsRegistered, savedRegistered, rawSavedPickup]
  );

  const savedPickupMeta = useMemo<PickupMetaState>(
    () => normalizePickupMeta(supplier),
    [supplier]
  );

  const savedRegisteredComplete = useMemo<boolean>(
    () => addressHasMinimum(savedRegistered),
    [savedRegistered]
  );

  const savedPickupComplete = useMemo<boolean>(
    () => addressHasMinimum(savedPickup),
    [savedPickup]
  );

  const draftRegisteredComplete = useMemo<boolean>(
    () => addressHasMinimum(registered),
    [registered]
  );

  const draftPickupComplete = useMemo<boolean>(
    () => addressHasMinimum(effectivePickup),
    [effectivePickup]
  );

  const savedAddressDone = useMemo<boolean>(
    () => savedRegisteredComplete && (savedSameAsRegistered ? true : savedPickupComplete),
    [savedRegisteredComplete, savedSameAsRegistered, savedPickupComplete]
  );

  const draftAddressDone = useMemo<boolean>(
    () => draftRegisteredComplete && draftPickupComplete,
    [draftRegisteredComplete, draftPickupComplete]
  );

  const registeredDirty = useMemo<boolean>(
    () => !addressesEqual(registered, savedRegistered),
    [registered, savedRegistered]
  );

  const pickupDirty = useMemo<boolean>(() => {
    if (sameAsRegistered) return false;
    return !addressesEqual(pickup, savedPickup);
  }, [sameAsRegistered, pickup, savedPickup]);

  const pickupMetaDirty = useMemo<boolean>(
    () => !pickupMetaEqual(pickupMeta, savedPickupMeta),
    [pickupMeta, savedPickupMeta]
  );

  const sameAsDirty = useMemo<boolean>(
    () => sameAsRegistered !== savedSameAsRegistered,
    [sameAsRegistered, savedSameAsRegistered]
  );

  const addressDirty = registeredDirty || pickupDirty || pickupMetaDirty || sameAsDirty;
  const hasUnsavedChanges = addressDirty;

  const verifiedSupplier = useMemo<boolean>(
    () => isVerifiedSupplier(supplier),
    [supplier]
  );

  const missingSavedRegisteredFields = useMemo<string[]>(() => {
    const items: string[] = [];
    if (!pickString(savedRegistered.streetName)) items.push("Registered street name");
    if (!pickString(savedRegistered.city)) items.push("Registered city");
    if (!pickString(savedRegistered.state)) items.push("Registered state");
    if (!pickString(savedRegistered.country)) items.push("Registered country");
    return items;
  }, [savedRegistered]);

  const missingSavedPickupFields = useMemo<string[]>(() => {
    if (savedSameAsRegistered) return [];
    const items: string[] = [];
    if (!pickString(savedPickup.streetName)) items.push("Pickup street name");
    if (!pickString(savedPickup.city)) items.push("Pickup city");
    if (!pickString(savedPickup.state)) items.push("Pickup state");
    if (!pickString(savedPickup.country)) items.push("Pickup country");
    return items;
  }, [savedPickup, savedSameAsRegistered]);

  const liveRegisteredComplete = draftRegisteredComplete;
  const livePickupComplete = draftPickupComplete;

  const canProceedToDocuments = useMemo<boolean>(() => {
    return verifiedSupplier || (draftAddressDone && !loading);
  }, [verifiedSupplier, draftAddressDone, loading]);

  const docsDone = useMemo<boolean>(() => supplierHasDocuments(supplier), [supplier]);

  const progress = useMemo<{
    items: { key: string; label: string; done: boolean }[];
    doneCount: number;
    total: number;
    pct: number;
  }>(() => {
    const items = [
      { key: "registered", label: "Registered address", done: liveRegisteredComplete },
      {
        key: "pickup",
        label: "Pickup address",
        done: sameAsRegistered ? liveRegisteredComplete : livePickupComplete,
      },
    ];

    const doneCount = items.filter((x) => x.done).length;
    const pct = Math.round((doneCount / items.length) * 100);

    return { items, doneCount, total: items.length, pct };
  }, [liveRegisteredComplete, livePickupComplete, sameAsRegistered]);

  const save = useCallback(async (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;

    const request = (async (): Promise<boolean> => {
      try {
        setSaveState("saving");
        setErr(null);

        const payload = {
          registeredAddress: {
            houseNumber: registered.houseNumber.trim() || null,
            streetName: registered.streetName.trim() || null,
            postCode: registered.postCode.trim() || null,
            town: registered.town.trim() || null,
            city: registered.city.trim() || null,
            state: registered.state.trim() || null,
            country:
              countryValueToCodeOrName(registered.country, countries) ||
              registered.country.trim() ||
              null,
            lga: registered.lga.trim() || null,
            landmark: registered.landmark.trim() || null,
            directionsNote: registered.directionsNote.trim() || null,
          },
          pickupAddress: sameAsRegistered
            ? {
                houseNumber: registered.houseNumber.trim() || null,
                streetName: registered.streetName.trim() || null,
                postCode: registered.postCode.trim() || null,
                town: registered.town.trim() || null,
                city: registered.city.trim() || null,
                state: registered.state.trim() || null,
                country:
                  countryValueToCodeOrName(registered.country, countries) ||
                  registered.country.trim() ||
                  null,
                lga: registered.lga.trim() || null,
                landmark: registered.landmark.trim() || null,
                directionsNote: registered.directionsNote.trim() || null,
              }
            : {
                houseNumber: pickup.houseNumber.trim() || null,
                streetName: pickup.streetName.trim() || null,
                postCode: pickup.postCode.trim() || null,
                town: pickup.town.trim() || null,
                city: pickup.city.trim() || null,
                state: pickup.state.trim() || null,
                country:
                  countryValueToCodeOrName(pickup.country, countries) ||
                  pickup.country.trim() ||
                  null,
                lga: pickup.lga.trim() || null,
                landmark: pickup.landmark.trim() || null,
                directionsNote: pickup.directionsNote.trim() || null,
              },

          pickupContactName: pickupMeta.pickupContactName.trim() || null,
          pickupContactPhone: pickupMeta.pickupContactPhone.trim() || null,
          pickupInstructions: pickupMeta.pickupInstructions.trim() || null,

          shippingEnabled: pickupMeta.shippingEnabled,
          shipsNationwide: pickupMeta.shipsNationwide,
          supportsDoorDelivery: pickupMeta.supportsDoorDelivery,
          supportsPickupPoint: pickupMeta.supportsPickupPoint,
        };

        const { data } = await api.put("/api/supplier/me", payload, {
          withCredentials: true,
        });

        const s = (data?.data || data) as SupplierMe;
        setSupplier(s);
        hydrateFromSupplier(s, true);
        setSaveState("saved");

        try {
          sessionStorage.removeItem(ADDRESS_DRAFT_KEY);
        } catch {}

        return true;
      } catch (e: unknown) {
        const error = e as {
          response?: { data?: { error?: string; message?: string } };
        };
        setSaveState("error");
        setErr(
          error?.response?.data?.error ||
            error?.response?.data?.message ||
            "Could not save address details."
        );
        return false;
      } finally {
        savePromiseRef.current = null;
      }
    })();

    savePromiseRef.current = request;
    return request;
  }, [registered, countries, sameAsRegistered, pickup, pickupMeta, hydrateFromSupplier]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    if (loading) return;
    if (verifiedSupplier) return;
    if (!hasUnsavedChanges) return;
    if (saveState === "saving") return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void save();
    }, 800);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    loading,
    verifiedSupplier,
    hasUnsavedChanges,
    saveState,
    save,
    registered,
    pickup,
    pickupMeta,
    sameAsRegistered,
  ]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const saveAndNext = async (): Promise<void> => {
    setErr(null);

    if (verifiedSupplier) {
      nav("/supplier/onboarding/documents");
      return;
    }

    if (!draftAddressDone) {
      setErr("Please complete all required address details before continuing.");
      return;
    }

    if (hasUnsavedChanges || saveState === "saving" || saveState === "error") {
      const ok = await save();
      if (!ok) return;
    }

    nav("/supplier/onboarding/documents");
  };

  const goBack = () => nav("/supplier/onboarding");

  const goToBusinessTab = (): void => {
    nav("/supplier/onboarding");
  };

  const goToDocumentsTab = async (): Promise<void> => {
    await saveAndNext();
  };

  const canClickBusinessTab = true;
  const canClickDocumentsTab = canProceedToDocuments || docsDone || verifiedSupplier;

  const autosaveStatusText =
    saveState === "saving"
      ? "Saving changes…"
      : saveState === "saved"
      ? "All changes saved"
      : saveState === "error"
      ? "Autosave failed"
      : hasUnsavedChanges
      ? "Unsaved changes"
      : "Up to date";

  const stepBase =
    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm transition";
  const stepDone = "border-emerald-200 bg-emerald-50 text-emerald-700";
  const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
  const stepLocked = "border-zinc-100 bg-zinc-50 text-zinc-400";
  const stepClickable = "cursor-pointer hover:bg-zinc-50";
  const stepButtonBase = "w-full text-left";

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
        <div className="px-3 py-6 sm:px-4 sm:py-10">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            <div className="space-y-4">
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">
                  Add your supplier addresses
                </h1>
                <p className="mt-2 text-sm text-zinc-600">
                  Set your registered and pickup address details before continuing to documents.
                </p>
                {draftRestored && (
                  <p className="mt-2 text-xs text-emerald-700">
                    Restored your unsaved address draft.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <div
                  className={`${stepBase} ${stepDone}`}
                  aria-current={undefined}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    1
                  </span>
                  <span>Register</span>
                </div>

                <div
                  className={`${stepBase} ${stepDone}`}
                  aria-current={undefined}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    2
                  </span>
                  <span>Verify email / phone</span>
                </div>

                <button
                  type="button"
                  onClick={goToBusinessTab}
                  disabled={!canClickBusinessTab}
                  className={`${stepButtonBase} ${stepBase} ${stepDone} ${
                    canClickBusinessTab ? stepClickable : "cursor-not-allowed"
                  }`}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    3
                  </span>
                  <span>Business details</span>
                </button>

                <div
                  className={`${stepBase} ${stepActive}`}
                  aria-current="step"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    4
                  </span>
                  <span>Address details</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void goToDocumentsTab();
                  }}
                  disabled={!canClickDocumentsTab}
                  className={`${stepButtonBase} ${stepBase} ${
                    canClickDocumentsTab ? stepDone : stepLocked
                  } ${canClickDocumentsTab ? stepClickable : "cursor-not-allowed"}`}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    5
                  </span>
                  <span>Documents</span>
                </button>

                <div
                  className={`${stepBase} ${stepLocked}`}
                  aria-current={undefined}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    *
                  </span>
                  <span>Dashboard access</span>
                </div>
              </div>
            </div>

            {err && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {err}
              </div>
            )}

            {hasUnsavedChanges && !verifiedSupplier && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Changes are being saved automatically. You can continue now and this page will save before moving on.
              </div>
            )}

            {addressDirty && draftAddressDone && !savedAddressDone && !verifiedSupplier && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Address details look complete. Continuing will save them immediately.
              </div>
            )}

            {!verifiedSupplier && !savedRegisteredComplete && missingSavedRegisteredFields.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Registered address is still missing:{" "}
                {missingSavedRegisteredFields.join(", ")}.
              </div>
            )}

            {!verifiedSupplier &&
              !savedSameAsRegistered &&
              !savedPickupComplete &&
              missingSavedPickupFields.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Pickup address is still missing:{" "}
                  {missingSavedPickupFields.join(", ")}.
                </div>
              )}

            <div className="rounded-[28px] border border-white/70 bg-white/95 p-4 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 md:p-8">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="space-y-4 xl:col-span-2">
                  <AddressFieldsSection
                    title="Registered address"
                    subtitle="This is your business or legal registered address."
                    icon={<Building2Fallback />}
                    value={registered}
                    countries={countries}
                    onFieldChange={setRegisteredField}
                  />

                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="rounded-xl bg-zinc-100 p-3">
                        <Truck className="h-5 w-5 text-zinc-700" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-zinc-900">
                          Pickup address
                        </h2>
                        <p className="text-sm text-zinc-600">
                          This is where pickups or dispatches happen.
                        </p>
                      </div>
                    </div>

                    <label className="mb-4 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={sameAsRegistered}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setSameAsRegistered(e.target.checked);
                          setSaveState("idle");
                          setErr(null);
                        }}
                        className="h-4 w-4 rounded border-zinc-300"
                      />
                      <span className="text-sm font-medium text-zinc-700">
                        Pickup address is the same as registered address
                      </span>
                    </label>

                    {!sameAsRegistered && (
                      <AddressFieldsSection
                        title="Pickup address details"
                        subtitle="Enter the separate pickup or dispatch location."
                        icon={<Truck className="h-5 w-5 text-zinc-700" />}
                        value={pickup}
                        countries={countries}
                        onFieldChange={setPickupField}
                      />
                    )}
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="rounded-xl bg-zinc-100 p-3">
                        <Store className="h-5 w-5 text-zinc-700" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-zinc-900">
                          Pickup and shipping preferences
                        </h2>
                        <p className="text-sm text-zinc-600">
                          Add operational details for deliveries and collections.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                          Pickup contact name
                        </label>
                        <input
                          value={pickupMeta.pickupContactName}
                          onChange={setPickupMetaField("pickupContactName")}
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
                          placeholder="Pickup contact name"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                          Pickup contact phone
                        </label>
                        <input
                          value={pickupMeta.pickupContactPhone}
                          onChange={setPickupMetaField("pickupContactPhone")}
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
                          placeholder="Pickup contact phone"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                          Pickup instructions
                        </label>
                        <textarea
                          value={pickupMeta.pickupInstructions}
                          onChange={setPickupMetaField("pickupInstructions")}
                          className="min-h-[100px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm"
                          placeholder="Extra pickup notes for riders or logistics teams"
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={pickupMeta.shippingEnabled}
                          onChange={setPickupMetaField("shippingEnabled")}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">Shipping enabled</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={pickupMeta.shipsNationwide}
                          onChange={setPickupMetaField("shipsNationwide")}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">Ships nationwide</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={pickupMeta.supportsDoorDelivery}
                          onChange={setPickupMetaField("supportsDoorDelivery")}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">Supports door delivery</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={pickupMeta.supportsPickupPoint}
                          onChange={setPickupMetaField("supportsPickupPoint")}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">Supports pickup point</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                    <h2 className="text-base font-semibold text-zinc-900">
                      Address progress
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      Continue once your live address details are complete.
                    </p>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full rounded-full bg-zinc-900 transition-all"
                        style={{ width: `${progress.pct}%` }}
                      />
                    </div>

                    <p className="mt-2 text-sm text-zinc-700">
                      {progress.doneCount} of {progress.total} completed
                    </p>

                    <div className="mt-4 space-y-2">
                      {progress.items.map((item) => (
                        <div
                          key={item.key}
                          className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2"
                        >
                          <span className="text-sm text-zinc-700">{item.label}</span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              item.done
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {item.done ? "Done" : "Pending"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                    <h3 className="text-sm font-semibold text-zinc-900">
                      What happens next
                    </h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      After your address changes are saved, continue to upload required supplier documents.
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        void saveAndNext();
                      }}
                      disabled={!canProceedToDocuments}
                      className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Continue to documents
                    </button>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                    <h3 className="text-sm font-semibold text-zinc-900">
                      Current supplier status
                    </h3>
                    <div className="mt-3 space-y-2 text-sm text-zinc-700">
                      <div className="flex items-center justify-between">
                        <span>Supplier status</span>
                        <span className="font-medium">{supplier?.status || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>KYC status</span>
                        <span className="font-medium">{supplier?.kycStatus || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Business name</span>
                        <span className="font-medium">
                          {supplier?.businessName || supplier?.name || "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </button>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm ${
                      saveState === "error"
                        ? "text-rose-600"
                        : saveState === "saving"
                        ? "text-amber-700"
                        : "text-zinc-600"
                    }`}
                  >
                    {autosaveStatusText}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      void saveAndNext();
                    }}
                    disabled={!canProceedToDocuments}
                    className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Next step
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {loading && (
              <div className="text-center text-sm text-zinc-500">
                Loading address details…
              </div>
            )}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

function Building2Fallback(): React.ReactElement {
  return <MapPin className="h-5 w-5 text-zinc-700" />;
}