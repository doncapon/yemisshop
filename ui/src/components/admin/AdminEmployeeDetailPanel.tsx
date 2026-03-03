// src/components/admin/AdminEmployeeDetailPanel.tsx
import React, { useState } from "react";
import {
  User,
  Mail,
  Phone,
  Building2,
  Banknote,
  ShieldCheck,
  FileText,
  X,
  CheckCircle2,
} from "lucide-react";

/**
 * Local copies of the types – these should structurally match the ones
 * in src/pages/admin/AdminEmployees.tsx
 */

type EmployeeStatus = "ACTIVE" | "ON_LEAVE" | "PROBATION" | "EXITED";
type EmployeePayFrequency = "MONTHLY" | "WEEKLY" | "OTHER";

type EmployeeLite = {
  id: string;
  createdAt: string;

  // Personal
  firstName: string;
  lastName: string;
  emailWork?: string | null;
  emailPersonal?: string | null;
  phone?: string | null;

  // Employment
  jobTitle?: string | null;
  department?: string | null;
  status: EmployeeStatus;
  startDate?: string | null;

  // Compensation
  baseSalaryNGN?: number | null;
  payFrequency?: EmployeePayFrequency | null;

  // Bank
  bankName?: string | null;
  bankCode?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  isPayrollReady?: boolean | null;

  // Docs flags (from backend summary)
  hasPassportDoc?: boolean | null;
  hasNinSlipDoc?: boolean | null;
  hasTaxDoc?: boolean | null;
};

type StatusLabelMap = Record<EmployeeStatus, string>;
type StatusClassMap = Record<EmployeeStatus, string>;
type PayFreqLabelMap = Record<EmployeePayFrequency, string>;

type Props = {
  employee: EmployeeLite | null;

  localStatus: EmployeeStatus | null;
  setLocalStatus: (v: EmployeeStatus | null) => void;

  localBaseSalary: string;
  setLocalBaseSalary: (v: string) => void;

  localPayFrequency: EmployeePayFrequency | "";
  setLocalPayFrequency: (v: EmployeePayFrequency | "") => void;

  localBankName: string;
  setLocalBankName: (v: string) => void;

  localBankCode: string;
  setLocalBankCode: (v: string) => void;

  localAccountNumber: string;
  setLocalAccountNumber: (v: string) => void;

  localAccountName: string;
  setLocalAccountName: (v: string) => void;

  localPayrollReady: boolean;
  setLocalPayrollReady: (v: boolean) => void;

  statusLabelMap: StatusLabelMap;
  statusClassMap: StatusClassMap;
  payFreqLabelMap: PayFreqLabelMap;

  onClearSelection: () => void;
  onSave: () => void;

  saveIsPending: boolean;
  saveIsSuccess: boolean;
  saveIsError: boolean;
};

type DetailTab = "OVERVIEW" | "PAYROLL" | "DOCS" | "HISTORY";

export default function AdminEmployeeDetailPanel(props: Props) {
  const {
    employee,
    localStatus,
    setLocalStatus,
    localBaseSalary,
    setLocalBaseSalary,
    localPayFrequency,
    setLocalPayFrequency,
    localBankName,
    setLocalBankName,
    localBankCode,
    setLocalBankCode,
    localAccountNumber,
    setLocalAccountNumber,
    localAccountName,
    setLocalAccountName,
    localPayrollReady,
    setLocalPayrollReady,
    statusLabelMap,
    statusClassMap,
    payFreqLabelMap,
    onClearSelection,
    onSave,
    saveIsPending,
    saveIsSuccess,
    saveIsError,
  } = props;

  const [activeTab, setActiveTab] = useState<DetailTab>("OVERVIEW");

  if (!employee) {
    return (
      <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-center text-[11px] sm:text-xs text-ink-soft gap-2">
          <User size={18} className="text-zinc-400" />
          <p>Select an employee to view details.</p>
        </div>
      </div>
    );
  }

  const emp = employee;
  const fullName = `${emp.firstName} ${emp.lastName}`.trim();
  const effectiveStatus: EmployeeStatus = localStatus ?? emp.status;

  const maskedAccountNumber =
    localAccountNumber || emp.accountNumber
      ? `****${(localAccountNumber || emp.accountNumber || "").slice(-4)}`
      : "Not set";

  const hasPassport = Boolean(emp.hasPassportDoc);
  const hasNinSlip = Boolean(emp.hasNinSlipDoc);
  const hasTaxDoc = Boolean(emp.hasTaxDoc);

  const startDateLabel = emp.startDate
    ? new Date(emp.startDate).toLocaleDateString()
    : "Not set";

  return (
    <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-semibold text-ink">
              {fullName || "Unnamed employee"}
            </h2>
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex items-center justify-center rounded-full border bg-surface px-1.5 py-1 text-[10px] text-ink-soft hover:bg-black/5"
            >
              <X size={12} />
            </button>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-ink-soft mt-0.5">
            <Mail size={11} className="text-zinc-400" />
            <span className="truncate">
              {emp.emailWork || emp.emailPersonal || "No email"}
            </span>
          </div>
          {emp.phone && (
            <div className="flex items-center gap-1 text-[10px] text-ink-soft mt-0.5">
              <Phone size={11} className="text-zinc-400" />
              <span className="truncate">{emp.phone}</span>
            </div>
          )}
          {(emp.jobTitle || emp.department) && (
            <div className="mt-1 text-[10px] text-ink-soft flex items-center gap-1">
              <Building2 size={11} className="text-zinc-400" />
              <span>
                {emp.jobTitle || "No title"}{" "}
                {emp.department ? (
                  <span className="text-zinc-400">({emp.department})</span>
                ) : null}
              </span>
            </div>
          )}
          <p className="mt-1 text-[9px] text-zinc-400">
            Start date: <span className="font-medium">{startDateLabel}</span>
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] ${statusClassMap[effectiveStatus]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current/60" />
          {statusLabelMap[effectiveStatus]}
        </span>
      </div>

      {/* Tabs */}
      <div className="mb-3 border-b border-slate-100">
        <div className="flex gap-1.5 text-[10px] sm:text-[11px]">
          {[
            { id: "OVERVIEW" as DetailTab, label: "Overview" },
            { id: "PAYROLL" as DetailTab, label: "Payroll & Bank" },
            { id: "DOCS" as DetailTab, label: "ID & Tax docs" },
            { id: "HISTORY" as DetailTab, label: "History" },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1.5 rounded-t-xl border border-b-0 ${
                  isActive
                    ? "bg-surface text-ink border-slate-200"
                    : "bg-transparent text-ink-soft border-transparent hover:bg-surface/60"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
        {/* OVERVIEW TAB */}
        {activeTab === "OVERVIEW" && (
          <div className="space-y-3">
            {/* Employment status */}
            <div className="space-y-1">
              <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                Employment status
              </label>
              <select
                value={effectiveStatus}
                onChange={(e) => setLocalStatus(e.target.value as EmployeeStatus)}
                className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
              >
                <option value="ACTIVE">Active</option>
                <option value="PROBATION">Probation</option>
                <option value="ON_LEAVE">On leave</option>
                <option value="EXITED">Exited</option>
              </select>
            </div>

            {/* High-level summary */}
            <div className="rounded-xl border border-slate-100 bg-surface px-2.5 py-2 text-[10px] sm:text-[11px] text-ink-soft space-y-1.5">
              <p>
                <span className="font-medium text-ink">Current salary:</span>{" "}
                {typeof emp.baseSalaryNGN === "number"
                  ? `₦${emp.baseSalaryNGN.toLocaleString("en-NG")}`
                  : "Not set"}
              </p>
              <p>
                <span className="font-medium text-ink">Pay frequency:</span>{" "}
                {emp.payFrequency
                  ? payFreqLabelMap[emp.payFrequency]
                  : "Not set"}
              </p>
              <p>
                <span className="font-medium text-ink">Payroll ready:</span>{" "}
                {emp.isPayrollReady ? "Yes" : "No"}
              </p>
            </div>
          </div>
        )}

        {/* PAYROLL & BANK TAB */}
        {activeTab === "PAYROLL" && (
          <div className="space-y-3">
            {/* Salary */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                  Base salary (NGN)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-zinc-400">
                    ₦
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={localBaseSalary}
                    onChange={(e) => setLocalBaseSalary(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white pl-5 pr-2 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                  Pay frequency
                </label>
                <select
                  value={localPayFrequency}
                  onChange={(e) =>
                    setLocalPayFrequency(e.target.value as EmployeePayFrequency | "")
                  }
                  className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                >
                  <option value="">Not set</option>
                  <option value="MONTHLY">{payFreqLabelMap.MONTHLY}</option>
                  <option value="WEEKLY">{payFreqLabelMap.WEEKLY}</option>
                  <option value="OTHER">{payFreqLabelMap.OTHER}</option>
                </select>
              </div>
            </div>

            {/* Bank / Payroll */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-ink">
                  <Banknote size={12} className="text-zinc-400" />
                  Payroll / bank details
                </span>
                <label className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-ink-soft cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3 w-3 rounded border-slate-300"
                    checked={localPayrollReady}
                    onChange={(e) => setLocalPayrollReady(e.target.checked)}
                  />
                  <span>Payroll ready</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Bank name
                  </label>
                  <input
                    type="text"
                    value={localBankName}
                    onChange={(e) => setLocalBankName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Bank code
                  </label>
                  <input
                    type="text"
                    value={localBankCode}
                    onChange={(e) => setLocalBankCode(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Account number
                  </label>
                  <input
                    type="text"
                    value={localAccountNumber}
                    onChange={(e) => setLocalAccountNumber(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                  <p className="mt-0.5 text-[9px] text-zinc-400">
                    Displayed as: {maskedAccountNumber}
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Account name
                  </label>
                  <input
                    type="text"
                    value={localAccountName}
                    onChange={(e) => setLocalAccountName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DOCS TAB */}
        {activeTab === "DOCS" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-ink">
                <FileText size={12} className="text-zinc-400" />
                Identity & tax documents
              </span>
              <a
                href={`/admin/employees/${emp.id}/documents`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] sm:text-[11px] text-primary-600 hover:text-primary-700 underline"
              >
                Open documents workspace
              </a>
            </div>

            <div className="grid grid-cols-1 gap-1.5 text-[10px] sm:text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span>Passport / National ID</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[2px] ${
                    hasPassport
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                  }`}
                >
                  <ShieldCheck size={11} />
                  {hasPassport ? "Uploaded" : "Missing"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span>NIN slip</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[2px] ${
                    hasNinSlip
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                  }`}
                >
                  <ShieldCheck size={11} />
                  {hasNinSlip ? "Uploaded" : "Missing"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span>Tax document (PAYE, TIN etc.)</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[2px] ${
                    hasTaxDoc
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                  }`}
                >
                  <ShieldCheck size={11} />
                  {hasTaxDoc ? "Uploaded" : "Missing"}
                </span>
              </div>
            </div>

            <p className="text-[9px] text-zinc-400">
              Only store files in secure storage (encrypted), and avoid showing full BVN / NIN
              values directly in the UI.
            </p>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === "HISTORY" && (
          <div className="space-y-2 text-[10px] sm:text-[11px] text-ink-soft">
            <p className="font-medium text-ink">Change history</p>
            <p>
              In future, this tab can show salary changes, status changes, and document updates
              for this employee (e.g. pulled from an <code>EmployeeEvent</code> table).
            </p>
            <p>For now, you can keep using HR notes or external records for detailed history.</p>
          </div>
        )}
      </div>

      {/* Save row */}
      <div className="mt-2 flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
        {saveIsSuccess && (
          <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-emerald-700">
            <CheckCircle2 size={13} />
            Saved
          </span>
        )}
        {saveIsError && (
          <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-rose-700">
            Failed to save. Try again.
          </span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saveIsPending}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-primary-600 px-3 py-1.5 text-[11px] sm:text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {saveIsPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}