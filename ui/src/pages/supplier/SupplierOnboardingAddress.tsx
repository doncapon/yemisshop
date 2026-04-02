// src/pages/supplier/SupplierOnboardingAddress.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  Store,
  Truck,
  Building2,
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

type SupplierDocument = {
  id?: string;
  kind?: string | null;
  status?: string | null;
  storageKey?: string | null;
  originalFilename?: string | null;
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

type AddressFieldKey = keyof AddressState;
type PickupMetaFieldKey = keyof PickupMetaState;

type InputRef = React.RefObject<HTMLInputElement | null>;
type TextareaRef = React.RefObject<HTMLTextAreaElement | null>;
type SelectRef = React.RefObject<HTMLSelectElement | null>;
type InputOrSelectRef = React.RefObject<HTMLInputElement | HTMLSelectElement | null>;

type AddressFieldRefs = {
  houseNumber: InputRef;
  streetName: InputRef;
  postCode: InputRef;
  town: InputRef;
  city: InputRef;
  state: InputOrSelectRef;
  country: SelectRef;
  lga: InputOrSelectRef;
  landmark: InputRef;
  directionsNote: TextareaRef;
};

type PickupMetaRefs = {
  pickupContactName: InputRef;
  pickupContactPhone: InputRef;
  pickupInstructions: TextareaRef;
  shippingEnabled: InputRef;
  shipsNationwide: InputRef;
  supportsDoorDelivery: InputRef;
  supportsPickupPoint: InputRef;
};

type FieldRefsMap = {
  registered: AddressFieldRefs;
  pickup: AddressFieldRefs;
  pickupMeta: PickupMetaRefs;
};

type FieldErrors = Partial<
  Record<
    | `registered.${AddressFieldKey}`
    | `pickup.${AddressFieldKey}`
    | `pickupMeta.${PickupMetaFieldKey}`,
    string
  >
>;

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

function normalizeCountryDisplay(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "ng" || lower === "nigeria") return "Nigeria";
  return raw;
}

function countriesEqual(a: string, b: string): boolean {
  return normalizeCountryDisplay(a).toLowerCase() === normalizeCountryDisplay(b).toLowerCase();
}

function addressHasMinimum(addr: {
  houseNumber: string;
  streetName: string;
  city: string;
  state: string;
  country: string;
}): boolean {
  return Boolean(
    addr.houseNumber.trim() &&
      addr.streetName.trim() &&
      addr.city.trim() &&
      addr.state.trim() &&
      normalizeCountryDisplay(addr.country).trim()
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

function normalizeAddressDto(addr: AddressDto | null | undefined): AddressState {
  return {
    houseNumber: pickString(addr?.houseNumber),
    streetName: pickString(addr?.streetName),
    postCode: pickString(addr?.postCode),
    town: pickString(addr?.town),
    city: pickString(addr?.city),
    state: pickString(addr?.state),
    country: normalizeCountryDisplay(pickString(addr?.country)) || "Nigeria",
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
    countriesEqual(a.country, b.country) &&
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

function supplierHasInlineDocuments(s: SupplierMe | null): boolean {
  if (!s) return false;
  return Boolean(
    (Array.isArray(s.documents) && s.documents.length > 0) ||
      (Array.isArray(s.verificationDocuments) && s.verificationDocuments.length > 0) ||
      s.identityDocumentUrl ||
      s.proofOfAddressUrl ||
      s.cacDocumentUrl
  );
}

function normalizeDocumentsPayload(raw: any): SupplierDocument[] {
  const candidates = [
    raw?.data?.data,
    raw?.data?.documents,
    raw?.data,
    raw?.documents,
    raw,
  ];

  for (const item of candidates) {
    if (Array.isArray(item)) return item as SupplierDocument[];
  }

  return [];
}

function hasFetchedDocuments(docs: SupplierDocument[]): boolean {
  return Array.isArray(docs) && docs.length > 0;
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

function lgasContain(options: string[], value: string): boolean {
  return options.some((item) => normalizeStateKey(item) === normalizeStateKey(value));
}

function hasDigit(value: string): boolean {
  return /\d/.test(String(value ?? ""));
}

function isOnlyDigits(value: string): boolean {
  const trimmed = String(value ?? "").trim();
  return !!trimmed && /^\d+$/.test(trimmed);
}

type AddressSectionProps = {
  sectionKey: "registered" | "pickup";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  value: AddressState;
  countries: CountryOption[];
  fieldRefs: AddressFieldRefs;
  errors: FieldErrors;
  isReadOnly: boolean;
  onFieldChange: (
    key: keyof AddressState
  ) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => void;
};

function AddressFieldsSection({
  sectionKey,
  title,
  subtitle,
  icon,
  value,
  countries,
  fieldRefs,
  errors,
  isReadOnly,
  onFieldChange,
}: AddressSectionProps): React.ReactElement {
  const nigeria = isNigeriaCountry(value.country);
  const stateOptions = NIGERIAN_STATES;
  const lgaOptions = useMemo(() => getLgaOptionsForState(value.state), [value.state]);

  const fieldClass = (field: AddressFieldKey) =>
    `w-full rounded-2xl border bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm ${
      errors[`${sectionKey}.${field}`]
        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200"
        : "border-slate-300"
    } ${
      isReadOnly
        ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0"
        : ""
    }`;

  const renderError = (field: AddressFieldKey) =>
    !isReadOnly && errors[`${sectionKey}.${field}`] ? (
      <p className="mt-1.5 text-xs text-rose-600">{errors[`${sectionKey}.${field}`]}</p>
    ) : null;

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
            ref={fieldRefs.houseNumber}
            value={value.houseNumber}
            onChange={onFieldChange("houseNumber")}
            disabled={isReadOnly}
            readOnly={isReadOnly}
            className={fieldClass("houseNumber")}
            placeholder="House number"
          />
          {renderError("houseNumber")}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Street name
          </label>
          <input
            ref={fieldRefs.streetName}
            value={value.streetName}
            onChange={onFieldChange("streetName")}
            disabled={isReadOnly}
            readOnly={isReadOnly}
            className={fieldClass("streetName")}
            placeholder="Street name"
          />
          {renderError("streetName")}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Town / Area
          </label>
          <input
            ref={fieldRefs.town}
            value={value.town}
            onChange={onFieldChange("town")}
            disabled={isReadOnly}
            readOnly={isReadOnly}
            className={fieldClass("town")}
            placeholder="Town / Area"
          />
          {renderError("town")}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            City
          </label>
          <input
            ref={fieldRefs.city}
            value={value.city}
            onChange={onFieldChange("city")}
            disabled={isReadOnly}
            readOnly={isReadOnly}
            className={fieldClass("city")}
            placeholder="City"
          />
          {renderError("city")}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Country
          </label>
          <select
            ref={fieldRefs.country}
            value={normalizeCountryDisplay(value.country) || "Nigeria"}
            onChange={onFieldChange("country")}
            disabled={isReadOnly}
            className={fieldClass("country")}
          >
            {countries.length === 0 && <option value="Nigeria">Loading countries...</option>}
            {countries.map((c) => (
              <option key={c.code} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          {renderError("country")}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            State
          </label>

          {nigeria ? (
            <select
              ref={fieldRefs.state as SelectRef}
              value={getCanonicalStateName(value.state)}
              onChange={onFieldChange("state")}
              disabled={isReadOnly}
              className={fieldClass("state")}
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
              ref={fieldRefs.state as InputRef}
              value={value.state}
              onChange={onFieldChange("state")}
              disabled={isReadOnly}
              readOnly={isReadOnly}
              className={fieldClass("state")}
              placeholder="State"
            />
          )}
          {renderError("state")}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Post code
          </label>
          <input
            ref={fieldRefs.postCode}
            value={value.postCode}
            onChange={onFieldChange("postCode")}
            disabled={isReadOnly}
            readOnly={isReadOnly}
            className={fieldClass("postCode")}
            placeholder="Post code"
          />
          {renderError("postCode")}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            LGA
          </label>

          {nigeria ? (
            <select
              ref={fieldRefs.lga as SelectRef}
              value={value.lga}
              onChange={onFieldChange("lga")}
              disabled={isReadOnly || !value.state}
              className={`${fieldClass("lga")} disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500`}
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
              ref={fieldRefs.lga as InputRef}
              value={value.lga}
              onChange={onFieldChange("lga")}
              disabled={isReadOnly}
              readOnly={isReadOnly}
              className={fieldClass("lga")}
              placeholder="LGA / County / Region"
            />
          )}
          {renderError("lga")}
        </div>

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Landmark <span className="text-zinc-400 font-normal">(optional)</span>
          </label>
          <input
            ref={fieldRefs.landmark}
            value={value.landmark}
            onChange={onFieldChange("landmark")}
            disabled={isReadOnly}
            readOnly={isReadOnly}
            className={fieldClass("landmark")}
            placeholder="Nearby landmark"
          />
          {renderError("landmark")}
        </div>

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">
            Directions note <span className="text-zinc-400 font-normal">(optional)</span>
          </label>
          <textarea
            ref={fieldRefs.directionsNote}
            value={value.directionsNote}
            onChange={onFieldChange("directionsNote")}
            disabled={isReadOnly}
            readOnly={isReadOnly}
            className={`${fieldClass("directionsNote")} min-h-[100px] resize-y`}
            placeholder="Helpful directions for finding this address"
          />
          {renderError("directionsNote")}
        </div>
      </div>
    </div>
  );
}

export default function SupplierOnboardingAddress(): React.ReactElement {
  const nav = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [supplier, setSupplier] = useState<SupplierMe | null>(null);
  const [supplierDocuments, setSupplierDocuments] = useState<SupplierDocument[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [draftRestored, setDraftRestored] = useState<boolean>(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isContinuing, setIsContinuing] = useState<boolean>(false);
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [documentsLockedOnLoad, setDocumentsLockedOnLoad] = useState<boolean>(false);

  const [sameAsRegistered, setSameAsRegistered] = useState<boolean>(true);
  const [registered, setRegistered] = useState<AddressState>(EMPTY_ADDRESS);
  const [pickup, setPickup] = useState<AddressState>(EMPTY_ADDRESS);
  const [pickupMeta, setPickupMeta] = useState<PickupMetaState>(EMPTY_PICKUP_META);

  const hasHydratedRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);

  const fieldRefs = useRef<FieldRefsMap>({
    registered: {
      houseNumber: React.createRef<HTMLInputElement>(),
      streetName: React.createRef<HTMLInputElement>(),
      postCode: React.createRef<HTMLInputElement>(),
      town: React.createRef<HTMLInputElement>(),
      city: React.createRef<HTMLInputElement>(),
      state: React.createRef<HTMLInputElement | HTMLSelectElement>(),
      country: React.createRef<HTMLSelectElement>(),
      lga: React.createRef<HTMLInputElement | HTMLSelectElement>(),
      landmark: React.createRef<HTMLInputElement>(),
      directionsNote: React.createRef<HTMLTextAreaElement>(),
    },
    pickup: {
      houseNumber: React.createRef<HTMLInputElement>(),
      streetName: React.createRef<HTMLInputElement>(),
      postCode: React.createRef<HTMLInputElement>(),
      town: React.createRef<HTMLInputElement>(),
      city: React.createRef<HTMLInputElement>(),
      state: React.createRef<HTMLInputElement | HTMLSelectElement>(),
      country: React.createRef<HTMLSelectElement>(),
      lga: React.createRef<HTMLInputElement | HTMLSelectElement>(),
      landmark: React.createRef<HTMLInputElement>(),
      directionsNote: React.createRef<HTMLTextAreaElement>(),
    },
    pickupMeta: {
      pickupContactName: React.createRef<HTMLInputElement>(),
      pickupContactPhone: React.createRef<HTMLInputElement>(),
      pickupInstructions: React.createRef<HTMLTextAreaElement>(),
      shippingEnabled: React.createRef<HTMLInputElement>(),
      shipsNationwide: React.createRef<HTMLInputElement>(),
      supportsDoorDelivery: React.createRef<HTMLInputElement>(),
      supportsPickupPoint: React.createRef<HTMLInputElement>(),
    },
  });

  const clearFieldError = useCallback((key: keyof FieldErrors) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const scrollToField = useCallback((key: keyof FieldErrors) => {
    const [section, field] = String(key).split(".") as [
      "registered" | "pickup" | "pickupMeta",
      string
    ];

    const refs = fieldRefs.current;

    const ref =
      section === "pickupMeta"
        ? refs.pickupMeta[field as PickupMetaFieldKey]
        : section === "pickup"
        ? refs.pickup[field as AddressFieldKey]
        : refs.registered[field as AddressFieldKey];

    const el = ref?.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        try {
          el.focus();
        } catch {}
      }, 220);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const buildAddressErrors = useCallback(
    (section: "registered" | "pickup", value: AddressState): FieldErrors => {
      const errors: FieldErrors = {};

      if (!pickString(value.houseNumber)) {
        errors[`${section}.houseNumber`] = "House number is required.";
      } else if (!hasDigit(value.houseNumber)) {
        errors[`${section}.houseNumber`] =
          "House number must contain at least one number.";
      }

      if (!pickString(value.streetName)) {
        errors[`${section}.streetName`] = "Street name is required.";
      } else if (isOnlyDigits(value.streetName)) {
        errors[`${section}.streetName`] = "Street name cannot be numbers only.";
      }

      if (!pickString(value.city)) {
        errors[`${section}.city`] = "City is required.";
      } else if (isOnlyDigits(value.city)) {
        errors[`${section}.city`] = "City cannot be numbers only.";
      }

      if (!pickString(value.state)) {
        errors[`${section}.state`] = "State is required.";
      } else if (!isNigeriaCountry(value.country) && isOnlyDigits(value.state)) {
        errors[`${section}.state`] = "State cannot be numbers only.";
      }

      if (!normalizeCountryDisplay(value.country)) {
        errors[`${section}.country`] = "Country is required.";
      }

      if (isNigeriaCountry(value.country) && pickString(value.state)) {
        const canonical = getCanonicalStateName(value.state);
        const lgaOptions = getLgaOptionsForState(canonical);

        if (!canonical || !NIGERIAN_STATES.some((s) => s === canonical)) {
          errors[
            `${section}.state`
          ] = `“${value.state}” is not a valid Nigerian state. Please select a valid state.`;
        }

        if (
          pickString(value.lga) &&
          lgaOptions.length > 0 &&
          !lgasContain(lgaOptions, value.lga)
        ) {
          errors[`${section}.lga`] = `LGA “${value.lga}” does not belong to state “${canonical}”.`;
        }
      }

      if (pickString(value.postCode) && !/^[A-Za-z0-9 -]+$/.test(value.postCode)) {
        errors[`${section}.postCode`] = "Post code contains invalid characters.";
      }

      return errors;
    },
    []
  );

  const validateForm = useCallback((): { valid: boolean; errors: FieldErrors } => {
    let errors: FieldErrors = {
      ...buildAddressErrors("registered", registered),
    };

    if (!sameAsRegistered) {
      errors = {
        ...errors,
        ...buildAddressErrors("pickup", pickup),
      };
    }

    if (!sameAsRegistered && addressesEqual(registered, pickup)) {
      errors["pickup.streetName"] =
        "Pickup address matches the registered address exactly. Tick 'same as registered' or enter a different pickup address.";
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }, [buildAddressErrors, pickup, registered, sameAsRegistered]);

  const currentValidation = useMemo(() => validateForm(), [validateForm]);

  const buildSpecificErrorSummary = useCallback((errors: FieldErrors): string => {
    const orderedKeys = Object.keys(errors) as (keyof FieldErrors)[];
    if (orderedKeys.length === 0) {
      return "Please complete or correct the highlighted address fields before continuing.";
    }

    const firstKey = orderedKeys[0];
    const firstMessage = errors[firstKey];

    if (!firstMessage) {
      return "Please complete or correct the highlighted address fields before continuing.";
    }

    const [section] = String(firstKey).split(".") as [
      "registered" | "pickup" | "pickupMeta",
      string
    ];

    const prefix =
      section === "registered"
        ? "Registered address error"
        : section === "pickup"
        ? "Pickup address error"
        : "Pickup settings error";

    if (orderedKeys.length === 1) {
      return `${prefix}: ${firstMessage}`;
    }

    return `${prefix}: ${firstMessage} (${orderedKeys.length - 1} more issue${
      orderedKeys.length - 1 === 1 ? "" : "s"
    }).`;
  }, []);

  const docsDone = useMemo<boolean>(() => {
    return supplierHasInlineDocuments(supplier) || hasFetchedDocuments(supplierDocuments);
  }, [supplier, supplierDocuments]);

  const documentsLocked = documentsLockedOnLoad;

  const setRegisteredField =
    (key: keyof AddressState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ): void => {
      if (documentsLocked) return;

      const nextValue = e.target.value;

      setRegistered((s) => {
        const next = { ...s, [key]: nextValue };

        if (key === "country") {
          next.country = normalizeCountryDisplay(nextValue) || "Nigeria";
          if (!isNigeriaCountry(next.country)) {
            next.state = "";
            next.lga = "";
          }
        }

        if (key === "state") {
          next.state = getCanonicalStateName(nextValue);
          const nextLgas = getLgaOptionsForState(next.state);
          if (!nextLgas.includes(next.lga)) next.lga = "";
        }

        return next;
      });

      clearFieldError(`registered.${key}`);
      if (key === "country" || key === "state") clearFieldError("registered.lga");
      if (saveState !== "saving") setSaveState("idle");
      if (err) setErr(null);
      if (lastSaveError) setLastSaveError(null);
    };

  const setPickupField =
    (key: keyof AddressState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ): void => {
      if (documentsLocked) return;

      const nextValue = e.target.value;

      setPickup((s) => {
        const next = { ...s, [key]: nextValue };

        if (key === "country") {
          next.country = normalizeCountryDisplay(nextValue) || "Nigeria";
          if (!isNigeriaCountry(next.country)) {
            next.state = "";
            next.lga = "";
          }
        }

        if (key === "state") {
          next.state = getCanonicalStateName(nextValue);
          const nextLgas = getLgaOptionsForState(next.state);
          if (!nextLgas.includes(next.lga)) next.lga = "";
        }

        return next;
      });

      clearFieldError(`pickup.${key}`);
      if (key === "country" || key === "state") clearFieldError("pickup.lga");
      if (saveState !== "saving") setSaveState("idle");
      if (err) setErr(null);
      if (lastSaveError) setLastSaveError(null);
    };

  const setPickupMetaField =
    (key: keyof PickupMetaState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ): void => {
      if (documentsLocked) return;

      const value: string | boolean =
        e.target instanceof HTMLInputElement && e.target.type === "checkbox"
          ? e.target.checked
          : e.target.value;

      setPickupMeta((s) => ({
        ...s,
        [key]: value as PickupMetaState[typeof key],
      }));
      clearFieldError(`pickupMeta.${key}`);
      if (saveState !== "saving") setSaveState("idle");
      if (err) setErr(null);
      if (lastSaveError) setLastSaveError(null);
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
    (
      s: SupplierMe,
      options?: {
        replace?: boolean;
        preserveSameAsRegisteredChoice?: boolean;
      }
    ): void => {
      const replace = Boolean(options?.replace);
      const preserveSameAsRegisteredChoice = Boolean(
        options?.preserveSameAsRegisteredChoice
      );

      const savedRegistered = normalizeAddressDto(s.registeredAddress);
      const rawSavedPickup = normalizeAddressDto(s.pickupAddress);
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
              country: normalizeCountryDisplay(savedRegistered.country) || "Nigeria",
            }
          : {
              houseNumber: pickString(savedRegistered.houseNumber || prev.houseNumber),
              streetName: pickString(savedRegistered.streetName || prev.streetName),
              postCode: pickString(savedRegistered.postCode || prev.postCode),
              town: pickString(savedRegistered.town || prev.town),
              city: pickString(savedRegistered.city || prev.city),
              state: getCanonicalStateName(savedRegistered.state || prev.state),
              country:
                normalizeCountryDisplay(savedRegistered.country || prev.country) || "Nigeria",
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
              country: normalizeCountryDisplay(savedPickup.country) || "Nigeria",
            }
          : {
              houseNumber: pickString(savedPickup.houseNumber || prev.houseNumber),
              streetName: pickString(savedPickup.streetName || prev.streetName),
              postCode: pickString(savedPickup.postCode || prev.postCode),
              town: pickString(savedPickup.town || prev.town),
              city: pickString(savedPickup.city || prev.city),
              state: getCanonicalStateName(savedPickup.state || prev.state),
              country:
                normalizeCountryDisplay(savedPickup.country || prev.country) || "Nigeria",
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

      if (!preserveSameAsRegisteredChoice) {
        setSameAsRegistered((prev) => (replace ? inferredSameAsRegistered : prev));
      }
    },
    []
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setErr(null);
      setLastSaveError(null);

      const [supplierRes, docsRes] = await Promise.allSettled([
        api.get("/api/supplier/me", {
          withCredentials: true,
        }),
        api.get("/api/supplier/documents", {
          withCredentials: true,
        }),
      ]);

      if (supplierRes.status !== "fulfilled") {
        throw supplierRes.reason;
      }

      const supplierData = (supplierRes.value.data?.data || supplierRes.value.data) as SupplierMe;
      setSupplier(supplierData);

      const fetchedDocs =
        docsRes.status === "fulfilled"
          ? normalizeDocumentsPayload(docsRes.value.data)
          : [];

      setSupplierDocuments(fetchedDocs);

      const lockedFromInitialLoad =
        supplierHasInlineDocuments(supplierData) || hasFetchedDocuments(fetchedDocs);
      setDocumentsLockedOnLoad(lockedFromInitialLoad);

      const draft = safeReadAddressDraft();
      const shouldUseDraft = draft && !lockedFromInitialLoad;

      if (shouldUseDraft) {
        setRegistered({
          ...draft.registered,
          state: getCanonicalStateName(draft.registered.state),
          lga: pickString(draft.registered.lga),
          country: normalizeCountryDisplay(draft.registered.country) || "Nigeria",
        });
        setPickup({
          ...draft.pickup,
          state: getCanonicalStateName(draft.pickup.state),
          lga: pickString(draft.pickup.lga),
          country: normalizeCountryDisplay(draft.pickup.country) || "Nigeria",
        });
        setPickupMeta(draft.pickupMeta);
        setSameAsRegistered(Boolean(draft.sameAsRegistered));
        setDraftRestored(true);
      } else {
        hydrateFromSupplier(supplierData, {
          replace: true,
          preserveSameAsRegisteredChoice: false,
        });
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
  }, [load]);

  useEffect(() => {
    const onPageShow = (): void => {
      void load();
    };

    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [load]);

  useEffect(() => {
    if (loading) return;
    if (documentsLocked) return;

    try {
      const draft: AddressDraft = {
        registered,
        pickup,
        pickupMeta,
        sameAsRegistered,
      };
      sessionStorage.setItem(ADDRESS_DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [loading, registered, pickup, pickupMeta, sameAsRegistered, documentsLocked]);

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
    () => normalizeAddressDto(supplier?.registeredAddress),
    [supplier]
  );

  const rawSavedPickup = useMemo<AddressState>(
    () => normalizeAddressDto(supplier?.pickupAddress),
    [supplier]
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
    if (!pickString(savedRegistered.houseNumber)) items.push("Registered house number");
    if (!pickString(savedRegistered.streetName)) items.push("Registered street name");
    if (!pickString(savedRegistered.city)) items.push("Registered city");
    if (!pickString(savedRegistered.state)) items.push("Registered state");
    if (!normalizeCountryDisplay(savedRegistered.country)) items.push("Registered country");
    return items;
  }, [savedRegistered]);

  const missingSavedPickupFields = useMemo<string[]>(() => {
    if (savedSameAsRegistered) return [];
    const items: string[] = [];
    if (!pickString(savedPickup.houseNumber)) items.push("Pickup house number");
    if (!pickString(savedPickup.streetName)) items.push("Pickup street name");
    if (!pickString(savedPickup.city)) items.push("Pickup city");
    if (!pickString(savedPickup.state)) items.push("Pickup state");
    if (!normalizeCountryDisplay(savedPickup.country)) items.push("Pickup country");
    return items;
  }, [savedPickup, savedSameAsRegistered]);

  const liveRegisteredComplete = documentsLocked
    ? savedRegisteredComplete || draftRegisteredComplete
    : draftRegisteredComplete;

  const livePickupComplete = documentsLocked
    ? savedPickupComplete || draftPickupComplete
    : draftPickupComplete;

  const canProceedToDocuments = useMemo<boolean>(() => {
    if (documentsLocked) return true;
    return verifiedSupplier || (currentValidation.valid && !loading);
  }, [documentsLocked, verifiedSupplier, currentValidation.valid, loading]);

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
    if (documentsLocked) return true;
    if (savePromiseRef.current) return savePromiseRef.current;

    const request = (async (): Promise<boolean> => {
      try {
        setSaveState("saving");
        setLastSaveError(null);

        const payload = {
          registeredAddress: {
            houseNumber: registered.houseNumber.trim() || null,
            streetName: registered.streetName.trim() || null,
            postCode: registered.postCode.trim() || null,
            town: registered.town.trim() || null,
            city: registered.city.trim() || null,
            state: registered.state.trim() || null,
            country:
              countryValueToCodeOrName(normalizeCountryDisplay(registered.country), countries) ||
              normalizeCountryDisplay(registered.country) ||
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
                  countryValueToCodeOrName(
                    normalizeCountryDisplay(registered.country),
                    countries
                  ) ||
                  normalizeCountryDisplay(registered.country) ||
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
                  countryValueToCodeOrName(normalizeCountryDisplay(pickup.country), countries) ||
                  normalizeCountryDisplay(pickup.country) ||
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
        hydrateFromSupplier(s, { replace: true, preserveSameAsRegisteredChoice: false });
        setSaveState("saved");
        setLastSaveError(null);

        try {
          sessionStorage.removeItem(ADDRESS_DRAFT_KEY);
        } catch {}

        return true;
      } catch (e: unknown) {
        const error = e as {
          response?: { data?: { error?: string; message?: string } };
        };
        const message =
          error?.response?.data?.error ||
          error?.response?.data?.message ||
          "Could not save address details.";

        setSaveState("error");
        setLastSaveError(message);
        return false;
      } finally {
        savePromiseRef.current = null;
      }
    })();

    savePromiseRef.current = request;
    return request;
  }, [
    registered,
    countries,
    sameAsRegistered,
    pickup,
    pickupMeta,
    hydrateFromSupplier,
    documentsLocked,
  ]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    if (loading) return;
    if (verifiedSupplier) return;
    if (documentsLocked) return;
    if (!hasUnsavedChanges) return;
    if (saveState === "saving") return;
    if (isContinuing) return;
    if (!currentValidation.valid) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void save();
    }, 2600);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    loading,
    verifiedSupplier,
    documentsLocked,
    hasUnsavedChanges,
    saveState,
    save,
    isContinuing,
    currentValidation.valid,
  ]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const runValidationAndShowErrors = useCallback((): boolean => {
    if (documentsLocked) return true;

    const result = validateForm();
    setFieldErrors(result.errors);

    if (!result.valid) {
      setErr(buildSpecificErrorSummary(result.errors));
      const firstKey = Object.keys(result.errors)[0] as keyof FieldErrors | undefined;
      if (firstKey) scrollToField(firstKey);
      else scrollToTop();
      return false;
    }

    return true;
  }, [documentsLocked, buildSpecificErrorSummary, scrollToField, scrollToTop, validateForm]);

  const navigateToDocuments = useCallback((): void => {
    nav("/supplier/onboarding/documents");
  }, [nav]);

  const saveAndNext = async (): Promise<void> => {
    setErr(null);
    setIsContinuing(true);

    try {
      if (documentsLocked || verifiedSupplier) {
        navigateToDocuments();
        return;
      }

      const valid = runValidationAndShowErrors();
      if (!valid) return;

      if (hasUnsavedChanges || saveState === "saving" || saveState === "error") {
        const ok = await save();
        if (!ok) {
          const fallbackMessage =
            lastSaveError ||
            "Your address looks complete, but it could not be saved to the server, so you cannot continue yet.";
          setErr(
            `Your address looks complete, but it could not be saved to the server, so you cannot continue yet. ${fallbackMessage}`
          );
          scrollToTop();
          return;
        }
      }

      navigateToDocuments();
    } finally {
      setIsContinuing(false);
    }
  };

  const goBack = (): void => {
    nav("/supplier/onboarding");
  };

  const goToBusinessTab = (): void => {
    nav("/supplier/onboarding");
  };

  const goToDocumentsTab = async (): Promise<void> => {
    await saveAndNext();
  };

  const autosaveStatusText =
    documentsLocked
      ? "Address details locked after document submission"
      : isContinuing
      ? "Validating and saving…"
      : saveState === "saving"
      ? "Saving changes…"
      : saveState === "saved" && !hasUnsavedChanges
      ? "All changes saved"
      : saveState === "error"
      ? "Save failed"
      : hasUnsavedChanges
      ? currentValidation.valid
        ? "Unsaved changes"
        : "Complete required fields"
      : "Up to date";

  const stepBase =
    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm transition";
  const stepDone = "border-emerald-200 bg-emerald-50 text-emerald-700";
  const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
  const stepLocked = "border-zinc-100 bg-zinc-50 text-zinc-400";
  const stepClickable = "cursor-pointer hover:bg-zinc-50";
  const stepButtonBase = "w-full text-left";

  const metaFieldClass = (field: PickupMetaFieldKey) =>
    `w-full rounded-2xl border bg-white px-3.5 py-3 text-[16px] text-slate-900 shadow-sm transition placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 md:text-sm ${
      fieldErrors[`pickupMeta.${field}`]
        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200"
        : "border-slate-300"
    } ${
      documentsLocked
        ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600 focus:border-zinc-200 focus:ring-0"
        : ""
    }`;

  const canClickPreviousTab = true;

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
                  Set your registered and pickup address details before continuing to
                  documents.
                </p>
                {draftRestored && !documentsLocked && (
                  <p className="mt-2 text-xs text-emerald-700">
                    Restored your unsaved address draft.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <div className={`${stepBase} ${stepDone}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    1
                  </span>
                  <span>Register</span>
                </div>

                <div className={`${stepBase} ${stepDone}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    2
                  </span>
                  <span>Verify email / phone</span>
                </div>

                <button
                  type="button"
                  onClick={canClickPreviousTab ? goToBusinessTab : undefined}
                  disabled={!canClickPreviousTab}
                  className={`${stepButtonBase} ${stepBase} ${stepDone} ${
                    canClickPreviousTab ? stepClickable : "cursor-not-allowed"
                  }`}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    3
                  </span>
                  <span>Business details</span>
                </button>

                <div className={`${stepBase} ${stepActive}`} aria-current="step">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    4
                  </span>
                  <span>Address details</span>
                </div>

                <button
                  type="button"
                  onClick={() => void goToDocumentsTab()}
                  disabled={isContinuing}
                  className={`${stepButtonBase} ${stepBase} ${
                    canProceedToDocuments || docsDone || verifiedSupplier
                      ? stepDone
                      : stepLocked
                  } ${stepClickable}`}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    5
                  </span>
                  <span>Documents</span>
                </button>

                <div className={`${stepBase} ${stepLocked}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    6
                  </span>
                  <span>Dashboard access</span>
                </div>
              </div>
            </div>

            {documentsLocked && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Documents had already been submitted when this page loaded. Address and
                shipping fields are read-only on this visit.
              </div>
            )}

            {err && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {err}
              </div>
            )}

            {!documentsLocked && saveState === "error" && lastSaveError && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                Save failed: {lastSaveError}
              </div>
            )}

            {!verifiedSupplier &&
              !documentsLocked &&
              !savedRegisteredComplete &&
              missingSavedRegisteredFields.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Registered address is still missing: {missingSavedRegisteredFields.join(", ")}.
                </div>
              )}

            {!verifiedSupplier &&
              !documentsLocked &&
              !savedSameAsRegistered &&
              !savedPickupComplete &&
              missingSavedPickupFields.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Pickup address is still missing: {missingSavedPickupFields.join(", ")}.
                </div>
              )}

            <div className="rounded-[28px] border border-white/70 bg-white/95 p-4 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 md:p-8">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="space-y-4 xl:col-span-2">
                  <AddressFieldsSection
                    sectionKey="registered"
                    title="Registered address"
                    subtitle="This is your business or legal registered address."
                    icon={<Building2Fallback />}
                    value={registered}
                    countries={countries}
                    fieldRefs={fieldRefs.current.registered}
                    errors={fieldErrors}
                    isReadOnly={documentsLocked}
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
                        disabled={documentsLocked}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          if (documentsLocked) return;

                          const checked = e.target.checked;
                          setSameAsRegistered(checked);
                          if (saveState !== "saving") setSaveState("idle");
                          if (err) setErr(null);
                          if (lastSaveError) setLastSaveError(null);

                          setFieldErrors((prev) => {
                            const next = { ...prev };
                            (
                              [
                                "houseNumber",
                                "streetName",
                                "postCode",
                                "town",
                                "city",
                                "state",
                                "country",
                                "lga",
                                "landmark",
                                "directionsNote",
                              ] as AddressFieldKey[]
                            ).forEach((key) => {
                              delete next[`pickup.${key}`];
                            });
                            return next;
                          });

                          if (
                            !checked &&
                            !isAddressMeaningfullyPresent(supplier?.pickupAddress) &&
                            !isAddressMeaningfullyPresent({ ...pickup })
                          ) {
                            setPickup({
                              ...EMPTY_ADDRESS,
                              country: normalizeCountryDisplay(registered.country) || "Nigeria",
                            });
                          }
                        }}
                        className="h-4 w-4 rounded border-zinc-300"
                      />
                      <span className="text-sm font-medium text-zinc-700">
                        Pickup address is the same as registered address
                      </span>
                    </label>

                    {!sameAsRegistered && (
                      <AddressFieldsSection
                        sectionKey="pickup"
                        title="Pickup address details"
                        subtitle="Enter the separate pickup or dispatch location."
                        icon={<Truck className="h-5 w-5 text-zinc-700" />}
                        value={pickup}
                        countries={countries}
                        fieldRefs={fieldRefs.current.pickup}
                        errors={fieldErrors}
                        isReadOnly={documentsLocked}
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
                          ref={fieldRefs.current.pickupMeta.pickupContactName}
                          value={pickupMeta.pickupContactName}
                          onChange={setPickupMetaField("pickupContactName")}
                          disabled={documentsLocked}
                          readOnly={documentsLocked}
                          className={metaFieldClass("pickupContactName")}
                          placeholder="Pickup contact name"
                        />
                        {!documentsLocked && fieldErrors["pickupMeta.pickupContactName"] && (
                          <p className="mt-1.5 text-xs text-rose-600">
                            {fieldErrors["pickupMeta.pickupContactName"]}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                          Pickup contact phone
                        </label>
                        <input
                          ref={fieldRefs.current.pickupMeta.pickupContactPhone}
                          value={pickupMeta.pickupContactPhone}
                          onChange={setPickupMetaField("pickupContactPhone")}
                          disabled={documentsLocked}
                          readOnly={documentsLocked}
                          className={metaFieldClass("pickupContactPhone")}
                          placeholder="Pickup contact phone"
                        />
                        {!documentsLocked && fieldErrors["pickupMeta.pickupContactPhone"] && (
                          <p className="mt-1.5 text-xs text-rose-600">
                            {fieldErrors["pickupMeta.pickupContactPhone"]}
                          </p>
                        )}
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                          Pickup instructions{" "}
                          <span className="text-zinc-400 font-normal">(optional)</span>
                        </label>
                        <textarea
                          ref={fieldRefs.current.pickupMeta.pickupInstructions}
                          value={pickupMeta.pickupInstructions}
                          onChange={setPickupMetaField("pickupInstructions")}
                          disabled={documentsLocked}
                          readOnly={documentsLocked}
                          className={`${metaFieldClass("pickupInstructions")} min-h-[100px] resize-y`}
                          placeholder="Extra pickup notes for riders or logistics teams"
                        />
                        {!documentsLocked && fieldErrors["pickupMeta.pickupInstructions"] && (
                          <p className="mt-1.5 text-xs text-rose-600">
                            {fieldErrors["pickupMeta.pickupInstructions"]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          ref={fieldRefs.current.pickupMeta.shippingEnabled}
                          type="checkbox"
                          checked={pickupMeta.shippingEnabled}
                          onChange={setPickupMetaField("shippingEnabled")}
                          disabled={documentsLocked}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">Shipping enabled</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          ref={fieldRefs.current.pickupMeta.shipsNationwide}
                          type="checkbox"
                          checked={pickupMeta.shipsNationwide}
                          onChange={setPickupMetaField("shipsNationwide")}
                          disabled={documentsLocked}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">Ships nationwide</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          ref={fieldRefs.current.pickupMeta.supportsDoorDelivery}
                          type="checkbox"
                          checked={pickupMeta.supportsDoorDelivery}
                          onChange={setPickupMetaField("supportsDoorDelivery")}
                          disabled={documentsLocked}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">Supports door delivery</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
                        <input
                          ref={fieldRefs.current.pickupMeta.supportsPickupPoint}
                          type="checkbox"
                          checked={pickupMeta.supportsPickupPoint}
                          onChange={setPickupMetaField("supportsPickupPoint")}
                          disabled={documentsLocked}
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

                    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                      <div className="flex items-center justify-between gap-3">
                        <span>Form validation</span>
                        <span className="font-medium">
                          {documentsLocked
                            ? savedAddressDone || draftAddressDone
                              ? "Complete"
                              : "Incomplete"
                            : currentValidation.valid
                            ? "Complete"
                            : "Incomplete"}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span>Server save</span>
                        <span className="font-medium">
                          {documentsLocked
                            ? "Locked"
                            : saveState === "saved" && !hasUnsavedChanges
                            ? "Saved"
                            : saveState === "saving"
                            ? "Saving…"
                            : saveState === "error"
                            ? "Failed"
                            : hasUnsavedChanges
                            ? "Pending"
                            : "Up to date"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                    <h3 className="text-sm font-semibold text-zinc-900">
                      What happens next
                    </h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      After your address changes are valid and saved, continue to upload
                      required supplier documents.
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        void saveAndNext();
                      }}
                      disabled={isContinuing}
                      className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isContinuing ? "Validating and saving…" : "Continue to documents"}
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

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                        : saveState === "saving" || isContinuing
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
                    disabled={isContinuing}
                    className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isContinuing ? "Please wait…" : "Next step"}
                    {!isContinuing && <ArrowRight className="ml-2 h-4 w-4" />}
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