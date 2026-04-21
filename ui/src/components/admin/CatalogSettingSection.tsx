// CatalogSettingsSection.tsx
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import api from "../../api/client";

import { useModal } from "../ModalProvider";
import StatusDot from "../StatusDot";

import AdminProductAttributes from "./AdminProductAttributes";
import { VariantsSection } from "./VariantSection";
import { AttributeForm } from "./AttributeForm";
import AdminCatalogRequestsSection from "./AdminCatalogRequestsSection";

/* =========================
   Types
========================= */
type BankVerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | null;

type SupplierAddress = {
  id?: string | null;
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
  isValidated?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  validatedAt?: string | null;
  validationSource?: string | null;
};

type AdminSupplier = {
  id: string;
  name: string;
  type: "PHYSICAL" | "ONLINE";
  status: string;
  contactEmail?: string | null;
  whatsappPhone?: string | null;

  apiBaseUrl?: string | null;
  apiAuthType?: "NONE" | "BEARER" | "BASIC" | null;
  apiKey?: string | null;

  payoutMethod?: "SPLIT" | "TRANSFER" | null;
  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  isPayoutEnabled?: boolean | null;

  bankVerificationStatus?: BankVerificationStatus;
  bankVerificationNote?: string | null;
  bankVerificationRequestedAt?: string | null;
  bankVerifiedAt?: string | null;

  userId?: string | null;
  supplierId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  registrationType?: string | null;
  businessName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;

  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  postalCode?: string | null;
  zipCode?: string | null;
  country?: string | null;

  notes?: string | null;
  kycStatus?: string | null;
  verificationStatus?: string | null;
  verifiedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  isActive?: boolean | null;
  isDeleted?: boolean | null;

  registeredAddress?: SupplierAddress | null;
  pickupAddress?: SupplierAddress | null;

  productOffers?: number;
  variantOffers?: number;
  purchaseOrders?: number;
  chosenOrderItems?: number;
  deletable?: boolean;

  [key: string]: any;
};

type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  position?: number | null;
  isActive: boolean;
};

type AdminBrand = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  isActive: boolean;
};

type AdminAttribute = any;

/* =========================
   Helpers
========================= */
function useDebouncedValue<T>(value: T, delayMs = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function displayValue(v: any) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function maskSecret(v?: string | null) {
  const s = String(v || "").trim();
  if (!s) return "—";
  if (s.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

function firstNonEmpty(...values: any[]) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function buildAddressLine1(addr?: SupplierAddress | null) {
  if (!addr) return null;
  return firstNonEmpty(
    [addr.houseNumber, addr.streetName].filter(Boolean).join(" ").trim(),
    addr.streetName,
    addr.houseNumber
  );
}

function buildAddressLine2(addr?: SupplierAddress | null) {
  if (!addr) return null;
  return firstNonEmpty(addr.landmark, addr.directionsNote, addr.lga, addr.town);
}

/* =========================
   Small, typing-safe forms
========================= */
function CategoryForm({
  onCreate,
  categories,
}: {
  onCreate: (payload: { name: string; slug: string; parentId: string | null; isActive: boolean }) => void;
  categories: Array<{ id: string; name: string }>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const submit = useCallback(() => {
    if (!name.trim() || !slug.trim()) return;
    onCreate({ name: name.trim(), slug: slug.trim(), parentId, isActive });
    setName("");
    setSlug("");
    setParentId(null);
    setIsActive(true);
  }, [name, slug, parentId, isActive, onCreate]);

  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <input
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border rounded-lg px-3 py-2"
      />
      <input
        placeholder="Slug"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="border rounded-lg px-3 py-2"
      />
      <select
        value={parentId ?? ""}
        onChange={(e) => setParentId(e.target.value || null)}
        className="border rounded-lg px-3 py-2 col-span-2"
      >
        <option value="">No parent</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        <span className="text-sm">Active</span>
      </label>
      <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
        Add
      </button>
    </div>
  );
}

function BrandForm({
  onCreate,
}: {
  onCreate: (payload: { name: string; slug: string; logoUrl?: string; isActive: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [isActive, setIsActive] = useState(true);

  const submit = useCallback(() => {
    if (!name.trim() || !slug.trim()) return;
    onCreate({ name: name.trim(), slug: slug.trim(), logoUrl: logoUrl.trim() || undefined, isActive });
    setName("");
    setSlug("");
    setLogoUrl("");
    setIsActive(true);
  }, [name, slug, logoUrl, isActive, onCreate]);

  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <input
        placeholder="Name"
        className="border rounded-lg px-3 py-2"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        placeholder="Slug"
        className="border rounded-lg px-3 py-2"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
      />
      <input
        placeholder="Logo URL (optional)"
        className="border rounded-lg px-3 py-2 col-span-2"
        value={logoUrl}
        onChange={(e) => setLogoUrl(e.target.value)}
      />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        <span className="text-sm">Active</span>
      </label>
      <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
        Add
      </button>
    </div>
  );
}

/* =========================
   Supplier View (read-only)
========================= */
function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: any;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-ink-soft mb-1">{label}</label>
      <div
        className={`w-full border rounded-lg px-3 py-2 bg-zinc-50 text-sm min-h-[42px] flex items-center ${mono ? "font-mono" : ""
          }`}
      >
        {displayValue(value)}
      </div>
    </div>
  );
}

function SupplierViewPanel({
  supplier,
  onClose,
  isSuperAdmin,
}: {
  supplier: AdminSupplier | null;
  onClose: () => void;
  isSuperAdmin?: boolean;
}) {
  if (!supplier) return null;

  const registeredAddress = supplier.registeredAddress ?? null;
  const pickupAddress = supplier.pickupAddress ?? null;

  const registeredAddressLine1 =
    firstNonEmpty(
      supplier.addressLine1,
      buildAddressLine1(registeredAddress)
    ) ?? "—";

  const registeredAddressLine2 =
    firstNonEmpty(
      supplier.addressLine2,
      buildAddressLine2(registeredAddress)
    ) ?? "—";

  const registeredCity =
    firstNonEmpty(
      supplier.city,
      registeredAddress?.city,
      registeredAddress?.town
    ) ?? "—";

  const registeredState =
    firstNonEmpty(
      supplier.state,
      registeredAddress?.state
    ) ?? "—";

  const registeredPostcode =
    firstNonEmpty(
      supplier.postcode,
      supplier.postalCode,
      supplier.zipCode,
      registeredAddress?.postCode
    ) ?? "—";

  const registeredCountry =
    firstNonEmpty(
      supplier.country,
      registeredAddress?.country
    ) ?? "—";

  const pickupAddressLine1 =
    firstNonEmpty(buildAddressLine1(pickupAddress)) ?? "—";

  const pickupAddressLine2 =
    firstNonEmpty(buildAddressLine2(pickupAddress)) ?? "—";

  const pickupCity =
    firstNonEmpty(pickupAddress?.city, pickupAddress?.town) ?? "—";

  const pickupState =
    firstNonEmpty(pickupAddress?.state) ?? "—";

  const pickupPostcode =
    firstNonEmpty(pickupAddress?.postCode) ?? "—";

  const pickupCountry =
    firstNonEmpty(pickupAddress?.country) ?? "—";

  const hiddenKeys = new Set([
    "id",
    "name",
    "type",
    "status",
    "contactEmail",
    "whatsappPhone",
    "apiBaseUrl",
    "apiAuthType",
    "apiKey",
    "payoutMethod",
    "bankCountry",
    "bankCode",
    "bankName",
    "accountNumber",
    "accountName",
    "isPayoutEnabled",
    "bankVerificationStatus",
    "bankVerificationNote",
    "bankVerificationRequestedAt",
    "bankVerifiedAt",
    "userId",
    "supplierId",
    "createdAt",
    "updatedAt",
    "registrationType",
    "businessName",
    "firstName",
    "lastName",
    "phone",
    "email",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "postcode",
    "postalCode",
    "zipCode",
    "country",
    "notes",
    "kycStatus",
    "verificationStatus",
    "verifiedAt",
    "approvedAt",
    "rejectedAt",
    "rejectionReason",
    "isActive",
    "isDeleted",
    "registeredAddress",
    "pickupAddress",
  ]);

  const extraEntries = Object.entries(supplier || {}).filter(([k, v]) => {
    if (hiddenKeys.has(k)) return false;
    if (typeof v === "function") return false;
    return true;
  });

  return (
    <div className="rounded-2xl border bg-white/95 p-4 md:p-6 mb-4 w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-ink font-semibold">View Supplier</h4>
          <p className="text-xs text-zinc-500">
            Read-only supplier profile for onboarding, review and verification checks.
          </p>
        </div>

        <button className="text-sm text-zinc-600 hover:underline" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Supplier Name" value={supplier.name} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Type" value={supplier.type} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Status" value={supplier.status} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Contact Email" value={supplier.contactEmail ?? supplier.email} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="WhatsApp / Phone" value={supplier.whatsappPhone ?? supplier.phone} />
        </div>

        <div className="col-span-12 md:col-span-4">
          <ReadOnlyField label="Supplier ID" value={supplier.id} mono />
        </div>

        <div className="col-span-12 md:col-span-4">
          <ReadOnlyField label="Linked User ID" value={supplier.userId} mono />
        </div>

        <div className="col-span-12 md:col-span-4">
          <ReadOnlyField label="Registration Type" value={supplier.registrationType} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Business Name" value={supplier.businessName} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="First Name" value={supplier.firstName} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Last Name" value={supplier.lastName} />
        </div>

        <div className="col-span-12 md:col-span-4">
          <ReadOnlyField label="KYC Status" value={supplier.kycStatus} />
        </div>

        <div className="col-span-12 md:col-span-4">
          <ReadOnlyField label="Verification Status" value={supplier.verificationStatus} />
        </div>

        <div className="col-span-12 md:col-span-4">
          <ReadOnlyField label="Bank Verification Status" value={supplier.bankVerificationStatus || "UNVERIFIED"} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Bank Verification Note" value={supplier.bankVerificationNote} />
        </div>

        <div className="col-span-12 md:col-span-3">
          <ReadOnlyField label="Bank Verification Requested At" value={formatDateTime(supplier.bankVerificationRequestedAt)} />
        </div>

        <div className="col-span-12 md:col-span-3">
          <ReadOnlyField label="Bank Verified At" value={formatDateTime(supplier.bankVerifiedAt)} />
        </div>

        <div className="col-span-6 md:col-span-4">
          <ReadOnlyField label="Payout Method" value={supplier.payoutMethod} />
        </div>

        <div className="col-span-6 md:col-span-4">
          <ReadOnlyField label="Payout Enabled" value={supplier.isPayoutEnabled} />
        </div>

        <div className="col-span-12 md:col-span-4">
          <ReadOnlyField label="Bank Country" value={supplier.bankCountry} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Bank Name" value={supplier.bankName} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Bank Code" value={supplier.bankCode} mono />
        </div>

        {isSuperAdmin && (
          <div className="col-span-12 md:col-span-6">
            <ReadOnlyField label="Account Number" value={supplier.accountNumber} mono />
          </div>
        )}

        <div className={isSuperAdmin ? "col-span-12 md:col-span-6" : "col-span-12"}>
          <ReadOnlyField label="Account Name" value={supplier.accountName} />
        </div>

        {isSuperAdmin && (
          <>
            <div className="col-span-12 md:col-span-4">
              <ReadOnlyField label="API Base URL" value={supplier.apiBaseUrl} />
            </div>

            <div className="col-span-6 md:col-span-4">
              <ReadOnlyField label="API Auth Type" value={supplier.apiAuthType} />
            </div>

            <div className="col-span-6 md:col-span-4">
              <ReadOnlyField label="API Key / Token" value={maskSecret(supplier.apiKey)} mono />
            </div>
          </>
        )}

        {/* Registered address */}
        <div className="col-span-12 mt-2">
          <div className="text-sm font-semibold text-zinc-800">Registered Address</div>
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Address Line 1" value={registeredAddressLine1} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Address Line 2" value={registeredAddressLine2} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="City" value={registeredCity} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="State" value={registeredState} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Postcode" value={registeredPostcode} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Country" value={registeredCountry} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Town" value={registeredAddress?.town} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="LGA" value={registeredAddress?.lga} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Landmark" value={registeredAddress?.landmark} />
        </div>

        <div className="col-span-12">
          <label className="block text-xs text-ink-soft mb-1">Registered Address Directions</label>
          <div className="w-full border rounded-lg px-3 py-2 bg-zinc-50 text-sm min-h-[60px] whitespace-pre-wrap">
            {displayValue(registeredAddress?.directionsNote)}
          </div>
        </div>

        {/* Pickup address */}
        <div className="col-span-12 mt-2">
          <div className="text-sm font-semibold text-zinc-800">Pickup Address</div>
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Pickup Address Line 1" value={pickupAddressLine1} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Pickup Address Line 2" value={pickupAddressLine2} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Pickup City" value={pickupCity} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Pickup State" value={pickupState} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Pickup Postcode" value={pickupPostcode} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Pickup Country" value={pickupCountry} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Pickup Town" value={pickupAddress?.town} />
        </div>

        <div className="col-span-6 md:col-span-3">
          <ReadOnlyField label="Pickup LGA" value={pickupAddress?.lga} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Pickup Landmark" value={pickupAddress?.landmark} />
        </div>

        <div className="col-span-12">
          <label className="block text-xs text-ink-soft mb-1">Pickup Address Directions</label>
          <div className="w-full border rounded-lg px-3 py-2 bg-zinc-50 text-sm min-h-[60px] whitespace-pre-wrap">
            {displayValue(pickupAddress?.directionsNote)}
          </div>
        </div>

        <div className="col-span-12 md:col-span-3">
          <ReadOnlyField label="Created At" value={formatDateTime(supplier.createdAt)} />
        </div>

        <div className="col-span-12 md:col-span-3">
          <ReadOnlyField label="Updated At" value={formatDateTime(supplier.updatedAt)} />
        </div>

        <div className="col-span-12 md:col-span-3">
          <ReadOnlyField label="Verified At" value={formatDateTime(supplier.verifiedAt)} />
        </div>

        <div className="col-span-12 md:col-span-3">
          <ReadOnlyField label="Approved At" value={formatDateTime(supplier.approvedAt)} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Rejected At" value={formatDateTime(supplier.rejectedAt)} />
        </div>

        <div className="col-span-12 md:col-span-6">
          <ReadOnlyField label="Rejection Reason" value={supplier.rejectionReason} />
        </div>

        <div className="col-span-12">
          <label className="block text-xs text-ink-soft mb-1">Notes</label>
          <div className="w-full border rounded-lg px-3 py-2 bg-zinc-50 text-sm min-h-[80px] whitespace-pre-wrap">
            {displayValue(supplier.notes)}
          </div>
        </div>

        {extraEntries.length > 0 && (
          <div className="col-span-12">
            <label className="block text-xs text-ink-soft mb-1">Additional supplier data</label>
            <pre className="w-full border rounded-lg px-3 py-3 bg-zinc-50 text-xs overflow-auto whitespace-pre-wrap">
              {JSON.stringify(Object.fromEntries(extraEntries), null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================
   Suppliers Section (memoized)
========================= */
const SuppliersSection = React.memo(function SuppliersSection(props: {
  canEdit: boolean;
  suppliers: AdminSupplier[];

  viewingSupplier: AdminSupplier | null;
  setViewingSupplier: (v: AdminSupplier | null) => void;

  deleteSupplier: any;

  qc: ReturnType<typeof useQueryClient>;
}) {
  const {
    canEdit,
    suppliers,
    viewingSupplier,
    setViewingSupplier,
    deleteSupplier,
  } = props;

  const [supplierSearch, setSupplierSearch] = useState("");
  const debouncedSearch = useDebouncedValue(supplierSearch, 150);
  const normalizedSupplierSearch = (debouncedSearch || "").trim().toLowerCase();

  const filteredSuppliers = useMemo(() => {
    const items = suppliers ?? [];
    if (!normalizedSupplierSearch) return items;

    const needle = normalizedSupplierSearch;
    return items.filter((s) => {
      const hay = [
        s.name,
        s.contactEmail,
        s.whatsappPhone,
        s.type,
        s.status,
        s.bankName,
        s.bankCode,
        s.accountNumber,
        s.accountName,
        s.payoutMethod,
        s.registrationType,
        s.businessName,
        s.kycStatus,
        s.verificationStatus,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [suppliers, normalizedSupplierSearch]);

  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPageSize, setSupplierPageSize] = useState(25);

  useEffect(() => setSupplierPage(1), [normalizedSupplierSearch]);

  const totalSuppliers = filteredSuppliers.length;
  const totalPages = Math.max(1, Math.ceil(totalSuppliers / supplierPageSize));

  useEffect(() => {
    setSupplierPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const pagedSuppliers = useMemo(() => {
    const start = (supplierPage - 1) * supplierPageSize;
    return filteredSuppliers.slice(start, start + supplierPageSize);
  }, [filteredSuppliers, supplierPage, supplierPageSize]);

  return (
    <div style={{ overflowAnchor: "none" } as any}>
      {viewingSupplier && (
        <SupplierViewPanel
          supplier={viewingSupplier}
          onClose={() => setViewingSupplier(null)}
          isSuperAdmin={canEdit}
        />
      )}

      <div className="mb-3 flex flex-col md:flex-row md:flex-nowrap md:items-center gap-2">
        <input
          value={supplierSearch}
          onChange={(e) => setSupplierSearch(e.target.value)}
          placeholder="Search suppliers (name, email, phone, bank, acct no...)"
          className="w-full border rounded-lg px-3 py-2"
        />
        <div className="text-xs text-zinc-600 whitespace-nowrap">
          Showing <span className="font-medium">{filteredSuppliers.length}</span> of{" "}
          <span className="font-medium">{suppliers.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setSupplierSearch("")}
          className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5 md:ml-auto"
          style={{ visibility: supplierSearch.trim() ? "visible" : "hidden" }}
        >
          Clear
        </button>
      </div>

      <div className="mb-3 flex flex-col md:flex-row md:flex-nowrap md:items-center gap-2">
        <div className="text-xs text-zinc-600">
          Showing{" "}
          <span className="font-medium">
            {totalSuppliers === 0 ? 0 : (supplierPage - 1) * supplierPageSize + 1}
          </span>{" "}
          to <span className="font-medium">{Math.min(supplierPage * supplierPageSize, totalSuppliers)}</span> of{" "}
          <span className="font-medium">{totalSuppliers}</span>
        </div>

        <div className="md:ml-auto flex items-center gap-2">
          <label className="text-xs text-zinc-600">Per page</label>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={supplierPageSize}
            onChange={(e) => {
              setSupplierPageSize(Number(e.target.value) || 25);
              setSupplierPage(1);
            }}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50"
            disabled={supplierPage <= 1}
            onClick={() => setSupplierPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>

          <div className="text-sm text-zinc-700">
            Page <span className="font-medium">{supplierPage}</span> / <span className="font-medium">{totalPages}</span>
          </div>

          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50"
            disabled={supplierPage >= totalPages}
            onClick={() => setSupplierPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      <div className="border rounded-xl overflow-auto max-h-[520px]" style={{ overflowAnchor: "none" } as any}>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Bank</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {pagedSuppliers.map((s) => {
              const status = (s.bankVerificationStatus || "UNVERIFIED") as BankVerificationStatus;

              const hasCoreBank = !!s.bankCode && !!s.accountNumber;
              const deletable =
                s.deletable === true ||
                (
                  Number(s.productOffers ?? 0) === 0 &&
                  Number(s.variantOffers ?? 0) === 0 &&
                  Number(s.purchaseOrders ?? 0) === 0 &&
                  Number(s.chosenOrderItems ?? 0) === 0
                );

              const deleteReason = !deletable
                ? `Cannot delete: linked records exist (product offers: ${Number(s.productOffers ?? 0)}, variant offers: ${Number(s.variantOffers ?? 0)}, purchase orders: ${Number(s.purchaseOrders ?? 0)}, chosen order items: ${Number(s.chosenOrderItems ?? 0)})`
                : "Delete unused supplier";

              const missingReason = !hasCoreBank
                ? "Missing bankCode/accountNumber (bankCode often not persisted if supplier /me schema doesn't include it)."
                : undefined;

              return (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2">{s.type}</td>
                  <td className="px-3 py-2">
                    <StatusDot label={s.status || "INACTIVE"} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusDot label={(status || "UNVERIFIED") as any} />
                    {s.bankVerificationNote ? (
                      <div className="text-[11px] text-zinc-500 mt-1 max-w-[240px] truncate" title={s.bankVerificationNote}>
                        {s.bankVerificationNote}
                      </div>
                    ) : null}
                    {!hasCoreBank && (
                      <div className="text-[11px] text-amber-700 mt-1" title={missingReason}>
                        Missing bankCode/account number
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          const { data } = await api.get<{ data: AdminSupplier }>(`/api/admin/suppliers/${s.id}`, {
                            withCredentials: true,
                          });
                          setViewingSupplier(data.data);
                        }}
                        className="px-2 py-1 rounded border"
                        title="View supplier"
                      >
                        View
                      </button>

                      {canEdit && (
                        <>
                          <button
                            type="button"
                            disabled={!deletable || deleteSupplier.isPending}
                            onClick={() => {
                              if (!deletable) return;

                              const ok = window.confirm(
                                "Delete this supplier permanently? This only works when the supplier has no linked offers, purchase orders, or chosen order items."
                              );
                              if (!ok) return;

                              deleteSupplier.mutate(s.id);
                            }}
                            className={`px-2 py-1 rounded ${deletable
                              ? "bg-rose-600 text-white hover:bg-rose-700"
                              : "bg-zinc-200 text-zinc-500 cursor-not-allowed"
                              }`}
                            title={deleteReason}
                          >
                            {deletable ? "Delete" : "In use"}
                          </button>
                          {!deletable && (
                            <div className="text-[11px] text-zinc-500 mt-1">
                              Offers: {Number(s.productOffers ?? 0) + Number(s.variantOffers ?? 0)} •
                              POs: {Number(s.purchaseOrders ?? 0)} •
                              Order items: {Number(s.chosenOrderItems ?? 0)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </td>

                </tr>
              );
            })}

            {pagedSuppliers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                  No suppliers match your search
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});

/* =========================
   Main Section
========================= */
export function CatalogSettingsSection(props: {
  token?: string | null;
  canEdit: boolean;

  categoriesQ: any;
  brandsQ: any;
  attributesQ: any;
  usageQ: any;

  createCategory: any;
  updateCategory: any;
  deleteCategory: any;

  createBrand: any;
  updateBrand: any;
  deleteBrand: any;

  createAttribute: any;
  updateAttribute: any;
  deleteAttribute: any;

  createAttrValue: any;
  updateAttrValue: any;
  deleteAttrValue: any;

  suppliersQ: any;
  createSupplier: any;
  updateSupplier: any;
  deleteSupplier: any;
}) {
  const {
    canEdit,

    categoriesQ,
    brandsQ,
    attributesQ,
    usageQ,

    createCategory,
    updateCategory,
    deleteCategory,

    createBrand,
    updateBrand,
    deleteBrand,

    createAttribute,
    updateAttribute,
    deleteAttribute,

    createAttrValue,
    updateAttrValue,
    deleteAttrValue,

    suppliersQ,
    deleteSupplier,
  } = props;

  const qc = useQueryClient();
  const { openModal } = useModal();

  const categoryUsage: Record<string, number> = usageQ.data?.categories || {};
  const attributeUsage: Record<string, number> = usageQ.data?.attributes || {};
  const brandUsage: Record<string, number> = usageQ.data?.brands || {};

  const [viewingSupplier, setViewingSupplier] = useState<AdminSupplier | null>(null);

  function SectionCard({
    title,
    subtitle,
    right,
    children,
    className,
    disableAnchor,
  }: {
    title: string;
    subtitle?: string;
    right?: ReactNode;
    children: ReactNode;
    className?: string;
    disableAnchor?: boolean;
  }) {
    return (
      <div
        className={`rounded-2xl border bg-white shadow-sm overflow-visible ${className ?? ""}`}
        style={disableAnchor ? ({ overflowAnchor: "none" } as any) : undefined}
      >
        <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="text-ink font-semibold">{title}</h3>
            {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
          </div>
          {right}
        </div>
        <div className="p-4 md:p-5">{children}</div>
      </div>
    );
  }

  const stopHashNav = (evt: React.SyntheticEvent) => {
    const el = (evt.target as HTMLElement)?.closest?.('a[href="#"],a[href=""]');
    if (el) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };
  const stopKeyBubblingFromInputs = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      e.stopPropagation();
    }
  };

  const AttributeValueAdder = React.memo(function AttributeValueAdder({
    attributeId,
    onCreate,
  }: {
    attributeId: string;
    onCreate: (vars: { attributeId: string; name: string; code?: string }) => void;
  }) {
    const [name, setName] = useState("");
    const [code, setCode] = useState("");

    const submit = () => {
      const n = name.trim();
      if (!n) return;
      onCreate({ attributeId, name: n, code: code.trim() || undefined });
      setName("");
      setCode("");
    };

    return (
      <div
        role="form"
        className="grid grid-cols-3 gap-2"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <input
          type="text"
          autoComplete="off"
          placeholder="Value name"
          className="border rounded-lg px-3 py-2 col-span-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          autoComplete="off"
          placeholder="Code (optional)"
          className="border rounded-lg px-3 py-2"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <div className="col-span-3 justify-self-end">
          <button type="button" onClick={submit} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">
            Add value
          </button>
        </div>
      </div>
    );
  });

  return (
    <div
      className="grid grid-cols-1 xl:grid-cols-3 gap-6"
      onClickCapture={stopHashNav}
      onMouseDownCapture={stopHashNav}
      onKeyDownCapture={stopKeyBubblingFromInputs}
      style={{ overflowAnchor: "none" } as any}
    >
      {/* Suppliers */}
      <SectionCard
        className="xl:col-span-3"
        disableAnchor
        title="Suppliers"
        subtitle="View supplier onboarding and verification details"
      >
        <SuppliersSection
          canEdit={canEdit}
          suppliers={(suppliersQ.data ?? []) as AdminSupplier[]}
          viewingSupplier={viewingSupplier}
          setViewingSupplier={setViewingSupplier}
          deleteSupplier={deleteSupplier}
          qc={qc}
        />
      </SectionCard>

      <SectionCard
        title="Categories"
        subtitle="Organize your catalog hierarchy"
        right={
          <button
            type="button"
            onClick={async () => {
              try {
                await api.post("/api/admin/catalog/backfill", null, { withCredentials: true });
                qc.invalidateQueries({ queryKey: ["admin", "categories"] });
                qc.invalidateQueries({ queryKey: ["admin", "brands"] });
                qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
                qc.invalidateQueries({ queryKey: ["admin", "catalog", "usage"] });
              } catch (e: any) {
                openModal({ title: "Backfill", message: e?.response?.data?.error || "Failed to backfill" });
              }
            }}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
          >
            Backfill & Relink
          </button>
        }
      >
        {canEdit && (
          <CategoryForm categories={categoriesQ.data ?? []} onCreate={(payload) => createCategory.mutate(payload)} />
        )}

        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Slug</th>
                <th className="text-left px-3 py-2">Parent</th>
                <th className="text-left px-3 py-2">In use</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(categoriesQ.data ?? []).map((c: AdminCategory) => {
                const used = categoryUsage[c.id] || 0;
                return (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">{c.slug}</td>
                    <td className="px-3 py-2">
                      {(categoriesQ.data ?? []).find((x: AdminCategory) => x.id === c.parentId)?.name || "—"}
                    </td>
                    <td className="px-3 py-2">{used}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => updateCategory.mutate({ id: c.id, isActive: !c.isActive })}
                            className="px-2 py-1 rounded border"
                          >
                            {c.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            onClick={() => used === 0 && deleteCategory.mutate(c.id)}
                            className={`px-2 py-1 rounded ${used === 0 ? "bg-rose-600 text-white" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                              }`}
                            disabled={used > 0}
                            title={used > 0 ? "Cannot delete: category is in use" : "Delete category"}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(categoriesQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                    No categories
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Brands */}
      <SectionCard title="Brands" subtitle="Manage brand metadata">
        {canEdit && <BrandForm onCreate={(payload) => createBrand.mutate(payload)} />}
        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Slug</th>
                <th className="text-left px-3 py-2">Active</th>
                <th className="text-left px-3 py-2">In use</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(brandsQ.data ?? []).map((b: AdminBrand) => {
                const used = brandUsage[b.id] || 0;
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2">{b.name}</td>
                    <td className="px-3 py-2">{b.slug}</td>
                    <td className="px-3 py-2">
                      <StatusDot label={b.isActive ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td className="px-3 py-2">{used}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => updateBrand.mutate({ id: b.id, isActive: !b.isActive })}
                            className="px-2 py-1 rounded border"
                          >
                            {b.isActive ? "Disable" : "Enable"}
                          </button>

                          <button
                            type="button"
                            onClick={() => used === 0 && deleteBrand.mutate(b.id)}
                            className={`px-2 py-1 rounded ${used === 0 ? "bg-rose-600 text-white" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                              }`}
                            disabled={used > 0}
                            title={used > 0 ? "Cannot delete: brand is in use" : "Delete brand"}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(brandsQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                    No brands
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Catalog Requests */}
      <SectionCard title="Catalog requests" subtitle="Approve/reject supplier requests for new categories, brands and attributes">
        <AdminCatalogRequestsSection />
      </SectionCard>

      {/* Attributes & Values */}
      <SectionCard title="Attributes" subtitle="Define attribute schema & options">
        {canEdit && <AttributeForm onCreate={(payload) => createAttribute.mutate(payload)} />}

        <div className="grid gap-3">
          {(attributesQ.data ?? []).map((a: AdminAttribute) => {
            const used = attributeUsage[a.id] || 0;

            return (
              <div key={a.id} className="border rounded-xl">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {a.name} <span className="text-xs text-zinc-500">({a.type})</span>
                    </div>
                    <div className="text-xs flex items-center gap-2">
                      <StatusDot label={a.isActive ? "ACTIVE" : "INACTIVE"} />
                      <span className="text-zinc-500">In use: {used}</span>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateAttribute.mutate({ id: a.id, isActive: !a.isActive })}
                        className="px-2 py-1 rounded border"
                      >
                        {a.isActive ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => used === 0 && deleteAttribute.mutate(a.id)}
                        className={`px-2 py-1 rounded ${used === 0 ? "bg-rose-600 text-white" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                          }`}
                        disabled={used > 0}
                        title={used > 0 ? "Cannot delete: attribute is in use" : "Delete attribute"}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                <div className="border-t p-3">
                  <div className="text-xs text-ink-soft mb-2">Values</div>

                  {(a.values ?? []).length === 0 && <div className="text-xs text-zinc-500 mb-2">No values</div>}

                  <div className="flex flex-wrap gap-2 mb-3">
                    {(a.values ?? []).map((v: any) => (
                      <div key={v.id} className="px-2 py-1 rounded border bg-white inline-flex items-center gap-2">
                        <span className="text-sm">{v.name}</span>
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => updateAttrValue.mutate({ attributeId: a.id, id: v.id, isActive: !v.isActive })}
                            >
                              {v.isActive ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              className="text-xs text-rose-600 underline"
                              onClick={() => deleteAttrValue.mutate({ attributeId: a.id, id: v.id })}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  {canEdit && (
                    <AttributeValueAdder
                      attributeId={a.id}
                      onCreate={(vars) =>
                        createAttrValue.mutate(vars, {
                          onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "attributes"] }),
                        })
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}

          {(attributesQ.data ?? []).length === 0 && (
            <div className="text-center text-zinc-500 text-sm py-4">No attributes</div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
          <div className="xl:col-span-3">
            <AdminProductAttributes />
          </div>
        </div>
      </SectionCard>

      {/* Variants Section */}
      <VariantsSection />
    </div>
  );
}