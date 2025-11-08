import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AdminProductAttributes from "./AdminProductAttributes";
import { VariantsSection } from "./VariantSection";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useModal } from "../ModalProvider";
import React from "react";
import api from "../../api/client";
import StatusDot from "../StatusDot";
import { useAuthStore } from "../../store/auth";
import { AttributeForm } from "./AttributeForm";

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
};

type SupplierFormValues = {
  name: string;
  type: "PHYSICAL" | "ONLINE";
  status?: string;
  contactEmail?: string | null;
  whatsappPhone?: string | null;
  apiBaseUrl?: string | null;
  apiAuthType?: "NONE" | "BEARER" | "BASIC" | "" | null;
  apiKey?: string | null;
  payoutMethod?: "SPLIT" | "TRANSFER" | "" | null;
  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  isPayoutEnabled?: boolean | null;
};

/* ---------------- Small, typing-safe form components ---------------- */

function CategoryForm({
  onCreate,
  categories,
}: {
  onCreate: (payload: {
    name: string;
    slug: string;
    parentId: string | null;
    isActive: boolean;
  }) => void;
  categories: Array<{ id: string; name: string }>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const submit = useCallback(() => {
    if (!name.trim() || !slug.trim()) return;
    onCreate({
      name: name.trim(),
      slug: slug.trim(),
      parentId,
      isActive,
    });
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
        onChange={(e) =>
          setParentId(e.target.value || null)
        }
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
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) =>
            setIsActive(e.target.checked)
          }
        />
        <span className="text-sm">Active</span>
      </label>
      <button
        onClick={submit}
        className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white"
      >
        Add
      </button>
    </div>
  );
}

function BrandForm({
  onCreate,
}: {
  onCreate: (payload: {
    name: string;
    slug: string;
    logoUrl?: string;
    isActive: boolean;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [isActive, setIsActive] = useState(true);

  const submit = useCallback(() => {
    if (!name.trim() || !slug.trim()) return;
    onCreate({
      name: name.trim(),
      slug: slug.trim(),
      logoUrl: logoUrl.trim() || undefined,
      isActive,
    });
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
        onChange={(e) =>
          setLogoUrl(e.target.value)
        }
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) =>
            setIsActive(e.target.checked)
          }
        />
        <span className="text-sm">Active</span>
      </label>
      <button
        onClick={submit}
        className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white"
      >
        Add
      </button>
    </div>
  );
}

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

type BankOption = {
  country: string;
  code: string;
  name: string;
};

const FALLBACK_BANKS: BankOption[] = [
  { country: "NG", code: "044", name: "Access Bank" },
  { country: "NG", code: "011", name: "First Bank of Nigeria" },
  { country: "NG", code: "058", name: "Guaranty Trust Bank" },
  { country: "NG", code: "221", name: "Stanbic IBTC Bank" },
  { country: "NG", code: "232", name: "Sterling Bank" },
  { country: "NG", code: "033", name: "United Bank for Africa" },
  { country: "NG", code: "035", name: "Wema Bank" },
];

function SupplierForm({
  editing,
  onCancelEdit,
  onCreate,
  onUpdate,
}: {
  editing: AdminSupplier | null;
  onCancelEdit: () => void;
  onCreate: (payload: SupplierFormValues) => void;
  onUpdate: (
    payload: SupplierFormValues & { id: string }
  ) => void;
}) {
  const { token } = useAuthStore();

  const banksQ = useQuery({
    queryKey: ["admin", "banks"],
    queryFn: async () => {
      const { data } = await api.get<{
        data: BankOption[];
      }>("/api/admin/banks", {
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : undefined,
      });
      return Array.isArray(data?.data) &&
        data.data.length > 0
        ? data.data
        : FALLBACK_BANKS;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const banks = banksQ.data ?? FALLBACK_BANKS;

  const [values, setValues] =
    useState<SupplierFormValues>({
      name: "",
      type: "PHYSICAL",
      status: "ACTIVE",
      contactEmail: "",
      whatsappPhone: "",
      apiBaseUrl: "",
      apiAuthType: "NONE",
      apiKey: "",
      payoutMethod: "",
      bankCountry: "NG",
      bankCode: "",
      bankName: "",
      accountNumber: "",
      accountName: "",
      isPayoutEnabled: false,
    });

  useEffect(() => {
    if (!editing) return;
    setValues({
      name: editing.name ?? "",
      type: editing.type ?? "PHYSICAL",
      status: editing.status ?? "ACTIVE",
      contactEmail: editing.contactEmail ?? "",
      whatsappPhone: editing.whatsappPhone ?? "",
      apiBaseUrl: editing.apiBaseUrl ?? "",
      apiAuthType: editing.apiAuthType ?? "NONE",
      apiKey: editing.apiKey ?? "",
      payoutMethod: editing.payoutMethod ?? "",
      bankCountry: editing.bankCountry ?? "NG",
      bankCode: editing.bankCode ?? "",
      bankName: editing.bankName ?? "",
      accountNumber:
        editing.accountNumber ?? "",
      accountName: editing.accountName ?? "",
      isPayoutEnabled:
        !!editing.isPayoutEnabled,
    });
  }, [editing]);

  const countryBanks = useMemo(
    () =>
      banks.filter(
        (b) =>
          (values.bankCountry || "NG") ===
          b.country
      ),
    [banks, values.bankCountry]
  );

  function setBankByName(name: string) {
    const match = countryBanks.find(
      (b) => b.name === name
    );
    setValues((v) => ({
      ...v,
      bankName: name || "",
      bankCode: match?.code || "",
    }));
  }
  function setBankByCode(code: string) {
    const match = countryBanks.find(
      (b) => b.code === code
    );
    setValues((v) => ({
      ...v,
      bankCode: code || "",
      bankName: match?.name || "",
    }));
  }

  function submit() {
    if (!values.name.trim()) {
      alert("Supplier name is required");
      return;
    }
    if (editing)
      onUpdate({ id: editing.id, ...values });
    else onCreate(values);
  }

  return (
    <div className="rounded-2xl border bg-white/95 p-4 md:p-6 mb-4 w-full">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-ink font-semibold">
          {editing
            ? "Edit Supplier"
            : "Add Supplier"}
        </h4>
        {editing && (
          <button
            className="text-sm text-zinc-600 hover:underline"
            onClick={onCancelEdit}
          >
            Cancel edit
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* fields unchanged */}
        {/* ... */}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 justify-end">
        {editing && (
          <button
            className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5"
            onClick={onCancelEdit}
          >
            Cancel
          </button>
        )}
        <button
          className="px-3 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90"
          onClick={submit}
        >
          {editing
            ? "Update Supplier"
            : "Add Supplier"}
        </button>
      </div>
    </div>
  );
}

type AdminAttribute = any;

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
    createSupplier,
    updateSupplier,
    deleteSupplier,
  } = props;

  const categoryUsage: Record<string, number> =
    usageQ.data?.categories || {};
  const attributeUsage: Record<string, number> =
    usageQ.data?.attributes || {};
  const brandUsage: Record<string, number> =
    usageQ.data?.brands || {};

  const [editingSupplier, setEditingSupplier] =
    useState<AdminSupplier | null>(null);

  const qc = useQueryClient();
  const { openModal } = useModal();

  function SectionCard({
    title,
    subtitle,
    right,
    children,
  }: {
    title: string;
    subtitle?: string;
    right?: ReactNode;
    children: ReactNode;
  }) {
    return (
      <div className="rounded-2xl border bg-white shadow-sm overflow-visible">
        <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="text-ink font-semibold">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-ink-soft">
                {subtitle}
              </p>
            )}
          </div>
          {right}
        </div>
        <div className="p-4 md:p-5">
          {children}
        </div>
      </div>
    );
  }

  const stopHashNav = (evt: React.SyntheticEvent) => {
    const el = (evt.target as HTMLElement)?.closest?.(
      'a[href="#"],a[href=""]'
    );
    if (el) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };
  const stopKeyBubblingFromInputs = (
    e: React.KeyboardEvent
  ) => {
    const t = e.target as HTMLElement;
    const tag = t.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    ) {
      e.stopPropagation();
    }
  };

  const AttributeValueAdder = React.memo(
    function AttributeValueAdder({
      attributeId,
      onCreate,
    }: {
      attributeId: string;
      onCreate: (vars: {
        attributeId: string;
        name: string;
        code?: string;
      }) => void;
    }) {
      const [name, setName] =
        useState("");
      const [code, setCode] =
        useState("");

      const submit = () => {
        const n = name.trim();
        if (!n) return;
        onCreate({
          attributeId,
          name: n,
          code: code.trim() || undefined,
        });
        setName("");
        setCode("");
      };

      return (
        <div
          role="form"
          className="grid grid-cols-3 gap-2"
          onClick={(e) =>
            e.stopPropagation()
          }
          onMouseDown={(e) =>
            e.stopPropagation()
          }
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
            onChange={(e) =>
              setName(e.target.value)
            }
          />
          <input
            type="text"
            autoComplete="off"
            placeholder="Code (optional)"
            className="border rounded-lg px-3 py-2"
            value={code}
            onChange={(e) =>
              setCode(e.target.value)
            }
          />
          <div className="col-span-3 justify-self-end">
            <button
              type="button"
              onClick={submit}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
            >
              Add value
            </button>
          </div>
        </div>
      );
    }
  );

  return (
    <div
      className="grid grid-cols-1 xl:grid-cols-3 gap-6"
      onClickCapture={stopHashNav}
      onMouseDownCapture={stopHashNav}
      onKeyDownCapture={stopKeyBubblingFromInputs}
    >
      {/* Categories, Brands, Suppliers ... unchanged above */}

      {/* Attributes & Values */}
      <SectionCard
        title="Attributes"
        subtitle="Define attribute schema & options"
      >
        {canEdit && (
          <AttributeForm
            onCreate={(payload) =>
              createAttribute.mutate(
                payload
              )
            }
          />
        )}

        <div className="grid gap-3">
          {(attributesQ.data ?? []).map(
            (a: AdminAttribute) => {
              const used =
                attributeUsage[a.id] ||
                0;

              return (
                <div
                  key={a.id}
                  className="border rounded-xl"
                >
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {a.name}{" "}
                        <span className="text-xs text-zinc-500">
                          ({a.type})
                        </span>
                      </div>
                      <div className="text-xs flex items-center gap-2">
                        <StatusDot
                          label={
                            a.isActive
                              ? "ACTIVE"
                              : "INACTIVE"
                          }
                        />
                        <span className="text-zinc-500">
                          In use: {used}
                        </span>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateAttribute.mutate(
                              {
                                id: a.id,
                                isActive:
                                  !a.isActive,
                              }
                            )
                          }
                          className="px-2 py-1 rounded border"
                        >
                          {a.isActive
                            ? "Disable"
                            : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            used === 0 &&
                            deleteAttribute.mutate(
                              a.id
                            )
                          }
                          className={`px-2 py-1 rounded ${
                            used === 0
                              ? "bg-rose-600 text-white"
                              : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                          }`}
                          disabled={used > 0}
                          title={
                            used > 0
                              ? "Cannot delete: attribute is in use"
                              : "Delete attribute"
                          }
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="border-t p-3">
                    <div className="text-xs text-ink-soft mb-2">
                      Values
                    </div>

                    {(a.values ?? [])
                      .length === 0 && (
                      <div className="text-xs text-zinc-500 mb-2">
                        No values
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 mb-3">
                      {(a.values ?? []).map(
                        (
                          v: any,
                          index: number
                        ) => {
                          const key =
                            v.id ??
                            v.code ??
                            `${a.id}-val-${index}`;
                          return (
                            <div
                              key={key}
                              className="px-2 py-1 rounded border bg-white inline-flex items-center gap-2"
                            >
                              <span className="text-sm">
                                {v.name}
                              </span>
                              {canEdit && (
                                <>
                                  <button
                                    type="button"
                                    className="text-xs underline"
                                    onClick={() =>
                                      updateAttrValue.mutate(
                                        {
                                          attributeId:
                                            a.id,
                                          id: v.id,
                                          isActive:
                                            !v.isActive,
                                        }
                                      )
                                    }
                                  >
                                    {v.isActive
                                      ? "Disable"
                                      : "Enable"}
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs text-rose-600 underline"
                                    onClick={() =>
                                      deleteAttrValue.mutate(
                                        {
                                          attributeId:
                                            a.id,
                                          id: v.id,
                                        }
                                      )
                                    }
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        }
                      )}
                    </div>

                    {canEdit && (
                      <AttributeValueAdder
                        attributeId={a.id}
                        onCreate={(vars) =>
                          createAttrValue.mutate(
                            vars,
                            {
                              onSuccess:
                                () =>
                                  qc.invalidateQueries(
                                    {
                                      queryKey:
                                        [
                                          "admin",
                                          "attributes",
                                        ],
                                    }
                                  ),
                            }
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              );
            }
          )}
          {(attributesQ.data ?? []).length ===
            0 && (
            <div className="text-center text-zinc-500 text-sm py-4">
              No attributes
            </div>
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
