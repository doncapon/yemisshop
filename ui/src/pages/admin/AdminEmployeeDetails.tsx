// src/pages/admin/AdminEmployeeDetails.tsx
import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../api/client";
import { format } from "date-fns";

/* ----------------------------- Types ----------------------------- */

type EmployeeStatus = "ACTIVE" | "PROBATION" | "ON_LEAVE" | "EXITED";
type EmployeePayFrequency = "MONTHLY" | "WEEKLY" | "OTHER";

type Employee = {
  id: string;
  createdAt: string;
  updatedAt: string;

  firstName: string;
  lastName: string;
  emailWork?: string | null;
  emailPersonal?: string | null;
  phone?: string | null;

  jobTitle?: string | null;
  department?: string | null;
  status: EmployeeStatus;
  startDate?: string | null;

  baseSalaryNGN?: number | null;
  payFrequency?: EmployeePayFrequency | null;

  bankName?: string | null;
  bankCode?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  isPayrollReady: boolean;

  hasPassportDoc: boolean;
  hasNinSlipDoc: boolean;
  hasTaxDoc: boolean;
};

type TabKey = "profile" | "payroll" | "documents" | "activity";

/* ----------------------------- Component ----------------------------- */

const AdminEmployeeDetails: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  const query = useQuery({
    queryKey: ["admin-employee", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await api.get<Employee>(`/api/admin/employees/${employeeId}`);
      return res.data;
    },
  });

  const emp = query.data;

  if (query.isLoading) {
    return (
      <div className="p-6">
        <button
          className="mb-4 text-sm px-3 py-1 rounded border hover:bg-gray-50"
          onClick={() => navigate("/admin/employees")}
        >
          ← Back to Employees
        </button>
        <div className="text-gray-600 text-sm">Loading employee…</div>
      </div>
    );
  }

  if (query.isError || !emp) {
    return (
      <div className="p-6 space-y-3">
        <button
          className="text-sm px-3 py-1 rounded border hover:bg-gray-50"
          onClick={() => navigate("/admin/employees")}
        >
          ← Back to Employees
        </button>
        <div className="text-red-600 text-sm">
          Failed to load employee record.
        </div>
      </div>
    );
  }

  const fullName = `${emp.firstName} ${emp.lastName}`.trim();

  /* ----------------------------- Tab content ----------------------------- */

  const profileTab = (
    <section className="space-y-4">
      {/* Personal info */}
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Personal Information
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs font-medium text-gray-600">
              Work email
            </div>
            <div className="text-gray-800">{emp.emailWork || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">
              Personal email
            </div>
            <div className="text-gray-800">{emp.emailPersonal || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">Phone</div>
            <div className="text-gray-800">{emp.phone || "—"}</div>
          </div>
        </div>
      </div>

      {/* Employment */}
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Employment</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs font-medium text-gray-600">
              Job title
            </div>
            <div className="text-gray-800">{emp.jobTitle || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">
              Department
            </div>
            <div className="text-gray-800">{emp.department || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">Status</div>
            <div className="mt-0.5">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                  emp.status === "ACTIVE"
                    ? "bg-emerald-50 text-emerald-800"
                    : emp.status === "PROBATION"
                    ? "bg-amber-50 text-amber-800"
                    : emp.status === "ON_LEAVE"
                    ? "bg-sky-50 text-sky-800"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {emp.status}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">
              Start date
            </div>
            <div className="text-gray-800">
              {emp.startDate
                ? format(new Date(emp.startDate), "dd MMM yyyy")
                : "—"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const payrollTab = (
    <section className="space-y-4">
      {/* Compensation */}
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Compensation
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs font-medium text-gray-600">
              Base salary (NGN)
            </div>
            <div className="text-gray-800">
              {emp.baseSalaryNGN != null
                ? emp.baseSalaryNGN.toLocaleString()
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">
              Pay frequency
            </div>
            <div className="text-gray-800">{emp.payFrequency || "—"}</div>
          </div>
        </div>
      </div>

      {/* Bank details */}
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Bank / Payroll
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs font-medium text-gray-600">
              Bank name
            </div>
            <div className="text-gray-800">{emp.bankName || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">
              Bank code
            </div>
            <div className="text-gray-800">{emp.bankCode || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">
              Account number
            </div>
            <div className="text-gray-800">
              {emp.accountNumber || "—"}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600">
              Account name
            </div>
            <div className="text-gray-800">
              {emp.accountName || "—"}
            </div>
          </div>
        </div>

        <div className="pt-2 text-sm">
          <span className="text-xs font-medium text-gray-600">
            Payroll ready
          </span>
          <div className="mt-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                emp.isPayrollReady
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {emp.isPayrollReady ? "Yes" : "No"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );

  const documentsTab = (
    <section className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Document summary
        </h2>

        <ul className="text-sm text-gray-800 space-y-1.5">
          <li>
            <span className="font-medium">Passport:</span>{" "}
            {emp.hasPassportDoc ? (
              <span className="text-emerald-700 font-medium">Uploaded</span>
            ) : (
              <span className="text-gray-500">Not uploaded</span>
            )}
          </li>
          <li>
            <span className="font-medium">NIN slip:</span>{" "}
            {emp.hasNinSlipDoc ? (
              <span className="text-emerald-700 font-medium">Uploaded</span>
            ) : (
              <span className="text-gray-500">Not uploaded</span>
            )}
          </li>
          <li>
            <span className="font-medium">Tax doc:</span>{" "}
            {emp.hasTaxDoc ? (
              <span className="text-emerald-700 font-medium">Uploaded</span>
            ) : (
              <span className="text-gray-500">Not uploaded</span>
            )}
          </li>
        </ul>

        <div className="pt-3">
          <button
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
            onClick={() =>
              navigate(`/admin/employees/${emp.id}/documents`)
            }
          >
            Open full documents page →
          </button>
        </div>

        <p className="text-xs text-gray-500 pt-1">
          Uploads and detailed document management are handled on the
          dedicated documents page.
        </p>
      </div>
    </section>
  );

  const activityTab = (
    <section className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Activity (coming soon)
        </h2>
        <p className="text-sm text-gray-700">
          You can extend this tab later to show HR / admin activity:
        </p>
        <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
          <li>Changes to status (e.g. Probation → Active, Active → Exited)</li>
          <li>Salary / bank detail updates</li>
          <li>Document uploads / removals</li>
          <li>Notes from HR or line manager</li>
        </ul>
        <p className="text-xs text-gray-500">
          When you add an <code>EmployeeActivity</code> model, you can
          query it here by <code>employeeId</code> and render a timeline.
        </p>
      </div>
    </section>
  );

  let tabContent: React.ReactNode;
  switch (activeTab) {
    case "profile":
      tabContent = profileTab;
      break;
    case "payroll":
      tabContent = payrollTab;
      break;
    case "documents":
      tabContent = documentsTab;
      break;
    case "activity":
      tabContent = activityTab;
      break;
    default:
      tabContent = profileTab;
  }

  /* ----------------------------- Render ----------------------------- */

  return (
    <div className="p-6 space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          className="text-xs sm:text-sm px-3 py-1.5 rounded border hover:bg-gray-50"
          onClick={() => navigate("/admin/employees")}
        >
          ← Back to Employees
        </button>

        <div className="text-xs text-gray-500 text-right">
          <div>
            Created:{" "}
            {format(new Date(emp.createdAt), "dd MMM yyyy HH:mm")}
          </div>
          <div>
            Updated:{" "}
            {format(new Date(emp.updatedAt), "dd MMM yyyy HH:mm")}
          </div>
        </div>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-900">
          {fullName}
        </h1>
        <p className="text-sm text-gray-500">
          Employee ID: {emp.id}
        </p>
      </header>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-3 text-sm">
          {(
            [
              ["profile", "Profile"],
              ["payroll", "Payroll"],
              ["documents", "Documents"],
              ["activity", "Activity"],
            ] as [TabKey, string][]
          ).map(([key, label]) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={
                  "px-3 py-2 border-b-2 text-sm transition " +
                  (isActive
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300")
                }
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {tabContent}
    </div>
  );
};

export default AdminEmployeeDetails;