// src/components/admin/AdminEmployeeSummaryPanel.tsx
import React from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import {
  User,
  Mail,
  Phone,
  Briefcase,
  Banknote,
  ShieldCheck,
  IdCard,
  AlertCircle,
  FileText,
  CheckCircle2,
} from "lucide-react";

/* ===================== Types ===================== */

type EmployeeStatus =
  | "ACTIVE"
  | "ONBOARDING"
  | "ON_LEAVE"
  | "SUSPENDED"
  | "TERMINATED"
  | string;

type EmployeeDetail = {
  id: string;
  code?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  hireDate?: string | null;
  roleTitle?: string | null;
  department?: string | null;
  managerName?: string | null;
  employmentStatus: EmployeeStatus;
  baseSalaryAmount?: number | null;
  baseSalaryCurrency?: string | null;
  paySchedule?: string | null; // e.g. "MONTHLY"
  locationCity?: string | null;
  locationCountry?: string | null;
};

type EmployeeBankAccount = {
  id: string;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  bvn?: string | null;
};

type EmployeeKyc = {
  id: string;
  nin?: string | null;
  bvn?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  residentialAddress?: string | null;
};

type EmployeeDocumentKind =
  | "PASSPORT"
  | "NIN_SLIP"
  | "TAX_CERT"
  | "CONTRACT"
  | "OFFER_LETTER"
  | "OTHER";

type EmployeeDocumentLite = {
  id: string;
  kind: EmployeeDocumentKind;
  storageKey: string;
  originalFilename: string;
  mimeType?: string | null;
  size?: number | null;
  createdAt: string;
};

type DocumentsResponse = {
  items: EmployeeDocumentLite[];
};

type Props = {
  employeeId: string | null;
};

/* ===================== Helpers ===================== */

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  ONBOARDING: "Onboarding",
  ON_LEAVE: "On leave",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800 border-emerald-200",
  ONBOARDING: "bg-amber-50 text-amber-800 border-amber-200",
  ON_LEAVE: "bg-sky-50 text-sky-800 border-sky-200",
  SUSPENDED: "bg-rose-50 text-rose-800 border-rose-200",
  TERMINATED: "bg-rose-50 text-rose-800 border-rose-200",
};

function statusLabel(status: EmployeeStatus): string {
  return STATUS_LABEL[status] ?? status ?? "Unknown";
}

function statusClass(status: EmployeeStatus): string {
  return (
    STATUS_BADGE_CLASS[status] ??
    "bg-slate-50 text-slate-800 border-slate-200"
  );
}

function maskNumber(value?: string | null, visibleDigits = 4): string {
  if (!value) return "Not set";
  const trimmed = value.replace(/\s+/g, "");
  const last = trimmed.slice(-visibleDigits);
  return `••••••${last}`;
}

function formatCurrency(
  amount?: number | null,
  currency?: string | null
): string {
  if (amount == null) return "Not set";
  const cur = currency || "NGN";
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${cur} ${amount.toFixed(2)}`;
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "Not set";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

/* ===================== Component ===================== */

export default function AdminEmployeeSummaryPanel({ employeeId }: Props) {
  const enabled = !!employeeId;

  const {
    data: employee,
    isLoading: isEmployeeLoading,
    isError: isEmployeeError,
  } = useQuery<EmployeeDetail>({
    queryKey: ["admin-employee", employeeId],
    queryFn: async () => {
      const { data } = await api.get<{ item: EmployeeDetail }>(
        `/api/admin/employees/${employeeId}`
      );
      return data.item;
    },
    enabled,
  });

  const { data: bank, isLoading: isBankLoading } =
    useQuery<EmployeeBankAccount | null>({
      queryKey: ["admin-employee-bank", employeeId],
      queryFn: async () => {
        const { data } = await api.get<{ item: EmployeeBankAccount | null }>(
          `/api/admin/employees/${employeeId}/bank`
        );
        return data.item ?? null;
      },
      enabled,
    });

  const { data: kyc, isLoading: isKycLoading } = useQuery<EmployeeKyc | null>({
    queryKey: ["admin-employee-kyc", employeeId],
    queryFn: async () => {
      const { data } = await api.get<{ item: EmployeeKyc | null }>(
        `/api/admin/employees/${employeeId}/kyc`
      );
      return data.item ?? null;
    },
    enabled,
  });

  const { data: docsRes, isLoading: isDocsLoading } =
    useQuery<DocumentsResponse>({
      queryKey: ["admin-employee-docs", employeeId],
      queryFn: async () => {
        const { data } = await api.get<DocumentsResponse>(
          `/api/admin/employees/${employeeId}/documents`
        );
        return data;
      },
      enabled,
    });

  const docs = docsRes?.items ?? [];
  const hasPassport = docs.some((d) => d.kind === "PASSPORT");
  const hasNinSlip = docs.some((d) => d.kind === "NIN_SLIP");
  const hasTaxDoc = docs.some((d) => d.kind === "TAX_CERT");
  const hasContract = docs.some(
    (d) => d.kind === "CONTRACT" || d.kind === "OFFER_LETTER"
  );

  const isLoadingAll =
    isEmployeeLoading || isBankLoading || isKycLoading || isDocsLoading;

  if (!employeeId) {
    return (
      <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-center text-[11px] sm:text-xs text-ink-soft gap-2">
          <User size={18} className="text-zinc-400" />
          <p>Select an employee to view details.</p>
        </div>
      </div>
    );
  }

  if (isEmployeeError) {
    return (
      <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-center text-[11px] sm:text-xs text-rose-700 gap-2">
          <AlertCircle size={18} className="text-rose-500" />
          <p>Could not load employee. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-semibold text-ink">
              {employee
                ? `${employee.firstName} ${employee.lastName}`.trim()
                : "Employee"}
            </h2>
            {employee?.code && (
              <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-[2px] text-[10px]">
                {employee.code}
              </span>
            )}
          </div>
          <div className="flex items-center flex-wrap gap-1 text-[10px] text-ink-soft mt-0.5">
            {employee?.email && (
              <span className="inline-flex items-center gap-1">
                <Mail size={11} className="text-zinc-400" />
                <span className="truncate">{employee.email}</span>
              </span>
            )}
            {employee?.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} className="text-zinc-400" />
                <span>{employee.phone}</span>
              </span>
            )}
          </div>
        </div>
        {employee && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] ${statusClass(
              employee.employmentStatus
            )}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current/60" />
            {statusLabel(employee.employmentStatus)}
          </span>
        )}
      </div>

      {isLoadingAll && (
        <div className="text-[11px] text-ink-soft mt-1">Loading details…</div>
      )}

      {/* Job & payroll */}
      <div className="rounded-xl border border-slate-200 bg-surface px-2.5 py-2.5 text-[11px] sm:text-xs text-ink space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 font-medium text-ink">
            <Briefcase size={13} className="text-zinc-400" />
            Job & payroll
          </div>
          {employee?.hireDate && (
            <span className="text-[10px] text-ink-soft">
              Hired: {formatDate(employee.hireDate)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-soft">Role</span>
            <span className="font-medium">
              {employee?.roleTitle || "Not set"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-soft">Department</span>
            <span>{employee?.department || "Not set"}</span>
          </div>
          {employee?.managerName && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">Manager</span>
              <span>{employee.managerName}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-soft">Base salary</span>
            <span className="font-medium">
              {formatCurrency(
                employee?.baseSalaryAmount ?? null,
                employee?.baseSalaryCurrency ?? undefined
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-soft">Pay schedule</span>
            <span>{employee?.paySchedule || "Not set"}</span>
          </div>
        </div>
      </div>

      {/* Bank & payments */}
      <div className="rounded-xl border border-slate-200 bg-surface px-2.5 py-2.5 text-[11px] sm:text-xs text-ink space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 font-medium text-ink">
            <Banknote size={13} className="text-zinc-400" />
            Bank & payments
          </div>
          {bank ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700">
              <CheckCircle2 size={12} />
              Bank details set
            </span>
          ) : (
            <span className="text-[10px] text-ink-soft">No bank on file</span>
          )}
        </div>
        {bank ? (
          <div className="grid grid-cols-1 gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">Bank</span>
              <span className="font-medium">
                {bank.bankName || "Not set"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">Account name</span>
              <span>{bank.accountName || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">Account number</span>
              <span>{maskNumber(bank.accountNumber)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">BVN</span>
              <span>{maskNumber(bank.bvn || kyc?.bvn || undefined)}</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-ink-soft">
            Capture the bank details and BVN before you process any salary or
            benefits.
          </p>
        )}
      </div>

      {/* Identity & compliance */}
      <div className="rounded-xl border border-slate-200 bg-surface px-2.5 py-2.5 text-[11px] sm:text-xs text-ink space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 font-medium text-ink">
            <IdCard size={13} className="text-zinc-400" />
            Identity & compliance
          </div>
          {kyc ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700">
              <ShieldCheck size={12} />
              KYC captured
            </span>
          ) : (
            <span className="text-[10px] text-ink-soft">No KYC on file</span>
          )}
        </div>
        {kyc ? (
          <div className="grid grid-cols-1 gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">NIN</span>
              <span>{maskNumber(kyc.nin)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">BVN</span>
              <span>{maskNumber(kyc.bvn || bank?.bvn)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">Date of birth</span>
              <span>{formatDate(kyc.dateOfBirth)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">Nationality</span>
              <span>{kyc.nationality || "Not set"}</span>
            </div>
            {kyc.residentialAddress && (
              <div className="flex items-start gap-2">
                <span className="text-ink-soft mt-[1px]">Address</span>
                <span className="flex-1">{kyc.residentialAddress}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-ink-soft">
            Capture at least NIN, BVN and date of birth to meet basic KYC
            requirements in Nigeria.
          </p>
        )}
      </div>

      {/* Documents */}
      <div className="rounded-xl border border-slate-200 bg-surface px-2.5 py-2.5 text-[11px] sm:text-xs text-ink space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 font-medium text-ink">
            <FileText size={13} className="text-zinc-400" />
            Documents
          </div>
          <span className="text-[10px] text-ink-soft">
            {docs.length} file{docs.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <DocFlag label="Passport" ok={hasPassport} />
          <DocFlag label="NIN slip" ok={hasNinSlip} />
          <DocFlag label="Tax document" ok={hasTaxDoc} />
          <DocFlag label="Contract / Offer" ok={hasContract} />
        </div>

        {docs.length > 0 && (
          <div className="mt-2 space-y-1 max-h-28 overflow-auto pr-1">
            {docs.slice(0, 5).map((d) => {
              const href = `/uploads/${encodeURIComponent(d.storageKey)}`;
              return (
                <a
                  key={d.id}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 text-[10px] text-ink-soft hover:text-primary-700 hover:underline"
                >
                  <span className="inline-flex items-center gap-1">
                    <FileText size={11} className="text-zinc-400" />
                    <span className="truncate">{d.originalFilename}</span>
                  </span>
                  <span>
                    {Math.round((d.size ?? 0) / 1024) || 0}
                    {" KB"}
                  </span>
                </a>
              );
            })}
            {docs.length > 5 && (
              <div className="text-[10px] text-ink-soft">
                + {docs.length - 5} more… (see full documents tab)
              </div>
            )}
          </div>
        )}

        {docs.length === 0 && (
          <p className="text-[11px] text-ink-soft">
            No documents uploaded yet. Use the employee “Documents” tab to add
            passport, NIN slip, tax or contract files.
          </p>
        )}
      </div>
    </div>
  );
}

/* Small sub-component for the document flags */
function DocFlag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-white text-slate-500"
      }`}
    >
      {ok ? (
        <CheckCircle2 size={11} className="text-emerald-500" />
      ) : (
        <AlertCircle size={11} className="text-slate-400" />
      )}
      {label}
    </span>
  );
}