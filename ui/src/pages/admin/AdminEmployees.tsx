// src/pages/admin/AdminEmployees.tsx
import React, { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../../api/client";
import { format } from "date-fns";

/* ----------------------------- Types ----------------------------- */

type EmployeeStatus = "ACTIVE" | "PROBATION" | "ON_LEAVE" | "EXITED";
type EmployeePayFrequency = "MONTHLY" | "WEEKLY" | "OTHER";

export type Employee = {
    id: string;
    createdAt: string;
    updatedAt: string;

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

    // Bank / payroll
    bankName?: string | null;
    bankCode?: string | null;
    accountNumber?: string | null;
    accountName?: string | null;
    isPayrollReady: boolean;

    // Document flags
    hasPassportDoc: boolean;
    hasNinSlipDoc: boolean;
    hasTaxDoc: boolean;
};

type EmployeesListResponse = {
    items: Employee[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
};

/* ----------------------------- Filters / UI State ----------------------------- */

type Filters = {
    search: string;
    department: string;
    status: "all" | EmployeeStatus;
    page: number;
    pageSize: number;
};

const DEFAULT_FILTERS: Filters = {
    search: "",
    department: "",
    status: "all",
    page: 1,
    pageSize: 20,
};

type EditingState =
    | { mode: "create"; employee: Partial<Employee> }
    | { mode: "edit"; employee: Employee }
    | null;

/* ----------------------------- Helpers ----------------------------- */

function buildListQuery(filters: Filters) {
    const params: Record<string, string | number> = {
        page: filters.page,
        pageSize: filters.pageSize,
    };

    if (filters.search.trim()) params.search = filters.search.trim();
    if (filters.department.trim()) params.department = filters.department.trim();
    if (filters.status !== "all") params.status = filters.status;

    return params;
}

function normaliseEmployeesResponse(
    data: EmployeesListResponse | Employee[] | undefined,
    filters: Filters
): EmployeesListResponse {
    if (!data) {
        return {
            items: [],
            total: 0,
            page: filters.page,
            pageSize: filters.pageSize,
            pageCount: 1,
            hasNextPage: false,
            hasPrevPage: false,
        };
    }

    if (Array.isArray(data)) {
        const pageCount = Math.max(1, Math.ceil(data.length / filters.pageSize));
        return {
            items: data,
            total: data.length,
            page: filters.page,
            pageSize: filters.pageSize,
            pageCount,
            hasNextPage: filters.page < pageCount,
            hasPrevPage: filters.page > 1,
        };
    }

    return {
        items: Array.isArray(data.items) ? data.items : [],
        total: Number.isFinite(data.total) ? data.total : 0,
        page: Number.isFinite(data.page) ? data.page : filters.page,
        pageSize: Number.isFinite(data.pageSize) ? data.pageSize : filters.pageSize,
        pageCount: Math.max(1, Number.isFinite(data.pageCount) ? data.pageCount : 1),
        hasNextPage:
            typeof data.hasNextPage === "boolean"
                ? data.hasNextPage
                : (Number.isFinite(data.page) ? data.page : filters.page) <
                  Math.max(1, Number.isFinite(data.pageCount) ? data.pageCount : 1),
        hasPrevPage:
            typeof data.hasPrevPage === "boolean"
                ? data.hasPrevPage
                : (Number.isFinite(data.page) ? data.page : filters.page) > 1,
    };
}

function getRangeStart(total: number, page: number, pageSize: number) {
    if (total === 0) return 0;
    return (page - 1) * pageSize + 1;
}

function getRangeEnd(total: number, page: number, pageSize: number) {
    if (total === 0) return 0;
    return Math.min(total, page * pageSize);
}

/* ----------------------------- Component ----------------------------- */

const AdminEmployees: React.FC = () => {
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
    const [searchInput, setSearchInput] = useState(DEFAULT_FILTERS.search);
    const [departmentInput, setDepartmentInput] = useState(DEFAULT_FILTERS.department);

    const [editing, setEditing] = useState<EditingState>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setFilters((prev) => {
                const nextSearch = searchInput.trimStart();
                const nextDepartment = departmentInput.trimStart();

                if (
                    prev.search === nextSearch &&
                    prev.department === nextDepartment
                ) {
                    return prev;
                }

                return {
                    ...prev,
                    search: nextSearch,
                    department: nextDepartment,
                    page: 1,
                };
            });
        }, 350);

        return () => window.clearTimeout(timeout);
    }, [searchInput, departmentInput]);

    const queryKey = useMemo(
        () => [
            "admin-employees",
            filters.search,
            filters.department,
            filters.status,
            filters.page,
            filters.pageSize,
        ],
        [filters]
    );

    const employeesQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const params = buildListQuery(filters);
            const res = await api.get<EmployeesListResponse | Employee[]>("/api/admin/employees", {
                params,
            });
            return res.data;
        },
        placeholderData: keepPreviousData,
    });

    const banksQuery = useQuery({
        queryKey: ["banks"],
        queryFn: async () => {
            const res = await api.get("/api/banks");
            return res.data?.data ?? [];
        },
    });

    const createMutation = useMutation({
        mutationFn: async (payload: any) => {
            const res = await api.post<Employee>("/api/admin/employees", payload);
            return res.data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin-employees"] });
            setIsFormOpen(false);
            setEditing(null);
            setFilters((prev) => ({ ...prev, page: 1 }));
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (payload: any & { id: string }) => {
            const { id, ...data } = payload;
            const res = await api.patch<Employee>(`/api/admin/employees/${id}`, data);
            return res.data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin-employees"] });
            setIsFormOpen(false);
            setEditing(null);
        },
    });

    const togglePayrollMutation = useMutation({
        mutationFn: async (args: { id: string; isPayrollReady: boolean }) => {
            const res = await api.patch<Employee>(`/api/admin/employees/${args.id}`, {
                isPayrollReady: args.isPayrollReady,
            });
            return res.data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin-employees"] });
        },
    });

    const isSaving = createMutation.isPending || updateMutation.isPending;
    const isTogglingPayroll = togglePayrollMutation.isPending;

    const rawData = employeesQuery.data;
    const isLoading = employeesQuery.isLoading;
    const isFetching = employeesQuery.isFetching;
    const isError = employeesQuery.isError;

    const data = normaliseEmployeesResponse(rawData, filters);
    const employees = data.items;
    const page = data.page;
    const pageSize = data.pageSize;
    const total = data.total;
    const pageCount = data.pageCount;
    const hasPrevPage = !!data.hasPrevPage;
    const hasNextPage = !!data.hasNextPage;

    const rangeStart = getRangeStart(total, page, pageSize);
    const rangeEnd = getRangeEnd(total, page, pageSize);

    /* ----------------------------- Handlers ----------------------------- */

    function openCreate() {
        const blank: Partial<Employee> = {
            firstName: "",
            lastName: "",
            emailWork: "",
            emailPersonal: "",
            phone: "",
            jobTitle: "",
            department: "",
            status: "ACTIVE",
            startDate: "",
            baseSalaryNGN: undefined,
            payFrequency: "MONTHLY",
            bankName: "",
            bankCode: "",
            accountNumber: "",
            accountName: "",
            isPayrollReady: false,
            hasPassportDoc: false,
            hasNinSlipDoc: false,
            hasTaxDoc: false,
        };
        setEditing({ mode: "create", employee: blank });
        setIsFormOpen(true);
    }

    function openEdit(employee: Employee) {
        setEditing({ mode: "edit", employee });
        setIsFormOpen(true);
    }

    function closeForm() {
        if (isSaving) return;
        setIsFormOpen(false);
        setEditing(null);
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!editing) return;

        const formData = new FormData(e.currentTarget);

        const startDateRaw = formData.get("startDate")?.toString().trim() || "";
        const startDateIso = startDateRaw
            ? new Date(`${startDateRaw}T00:00:00Z`).toISOString()
            : undefined;

        const baseSalaryStr = formData.get("baseSalaryNGN")?.toString().trim() || "";
        const baseSalaryNGN =
            baseSalaryStr !== "" && !Number.isNaN(Number(baseSalaryStr))
                ? Number(baseSalaryStr)
                : undefined;

        const payload: any = {
            firstName: formData.get("firstName")?.toString().trim(),
            lastName: formData.get("lastName")?.toString().trim(),
            emailWork: formData.get("emailWork")?.toString().trim() || null,
            emailPersonal: formData.get("emailPersonal")?.toString().trim() || null,
            phone: formData.get("phone")?.toString().trim() || null,
            jobTitle: formData.get("jobTitle")?.toString().trim() || null,
            department: formData.get("department")?.toString().trim() || null,
            status: formData.get("status")?.toString().trim() || "ACTIVE",
            startDate: startDateIso ?? null,
            baseSalaryNGN: baseSalaryNGN ?? null,
            payFrequency:
                (formData.get("payFrequency")?.toString().trim() as EmployeePayFrequency | "") || null,
            bankName: formData.get("bankName")?.toString().trim() || null,
            bankCode: formData.get("bankCode")?.toString().trim() || null,
            accountNumber: formData.get("accountNumber")?.toString().trim() || null,
            accountName: formData.get("accountName")?.toString().trim() || null,
            isPayrollReady: formData.get("isPayrollReady") === "on",
        };

        try {
            if (editing.mode === "create") {
                await createMutation.mutateAsync(payload);
            } else {
                await updateMutation.mutateAsync({ id: editing.employee.id, ...payload });
            }
        } catch (err) {
            console.error("Failed to save employee", err);
        }
    }

    function handlePayrollToggle(emp: Employee) {
        togglePayrollMutation.mutate({
            id: emp.id,
            isPayrollReady: !emp.isPayrollReady,
        });
    }

    function goToPage(nextPage: number) {
        setFilters((prev) => ({
            ...prev,
            page: Math.min(Math.max(1, nextPage), Math.max(1, pageCount)),
        }));
    }

    /* ----------------------------- Render ----------------------------- */

    return (
        <div className="p-6 space-y-6">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">Employees</h1>
                    <p className="text-sm text-gray-500">
                        Manage DaySpring staff records and payroll readiness.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
                >
                    + New Employee
                </button>
            </header>

            {/* Filters */}
            <section className="bg-white rounded-lg shadow-sm p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-end text-sm">
                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600">Search</label>
                        <input
                            type="text"
                            className="border rounded px-2 py-1 text-sm"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Name, email, job title..."
                        />
                    </div>

                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600">Department</label>
                        <input
                            type="text"
                            className="border rounded px-2 py-1 text-sm"
                            value={departmentInput}
                            onChange={(e) => setDepartmentInput(e.target.value)}
                            placeholder="e.g. Operations"
                        />
                    </div>

                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600">Status</label>
                        <select
                            className="border rounded px-2 py-1 text-sm"
                            value={filters.status}
                            onChange={(e) =>
                                setFilters((f) => ({
                                    ...f,
                                    status: e.target.value as Filters["status"],
                                    page: 1,
                                }))
                            }
                        >
                            <option value="all">All</option>
                            <option value="ACTIVE">Active</option>
                            <option value="PROBATION">Probation</option>
                            <option value="ON_LEAVE">On leave</option>
                            <option value="EXITED">Exited</option>
                        </select>
                    </div>

                    <div className="flex flex-col">
                        <label className="text-xs font-medium text-gray-600">Rows per page</label>
                        <select
                            className="border rounded px-2 py-1 text-sm"
                            value={filters.pageSize}
                            onChange={(e) =>
                                setFilters((f) => ({
                                    ...f,
                                    pageSize: Number(e.target.value) || 20,
                                    page: 1,
                                }))
                            }
                        >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>
                </div>
            </section>

            {/* Table */}
            <section className="bg-white rounded-lg shadow-sm">
                {isLoading && (
                    <div className="p-6 text-sm text-gray-500">Loading employees…</div>
                )}

                {isError && !isLoading && (
                    <div className="p-6 text-sm text-red-600">
                        Failed to load employees. Please try again.
                    </div>
                )}

                {!isLoading && !isError && employees.length === 0 && (
                    <div className="p-6 text-sm text-gray-500">No employees found.</div>
                )}

                {employees.length > 0 && (
                    <>
                        <div className="flex items-center justify-between px-4 py-3 border-b text-xs text-gray-600">
                            <div>
                                Showing {rangeStart}-{rangeEnd} of {total} employees
                            </div>
                            {isFetching && !isLoading ? (
                                <div className="text-gray-500">Updating…</div>
                            ) : (
                                <div>Page {page} of {pageCount}</div>
                            )}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 border-b">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                                            Name
                                        </th>
                                        <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                                            Job / Dept
                                        </th>
                                        <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                                            Email
                                        </th>
                                        <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                                            Status
                                        </th>
                                        <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                                            Payroll
                                        </th>
                                        <th className="px-3 py-2 text-right font-medium text-xs text-gray-500">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {employees.map((emp) => {
                                        const fullName = `${emp.firstName} ${emp.lastName}`.trim();
                                        const primaryEmail = emp.emailWork || emp.emailPersonal || "—";

                                        return (
                                            <tr
                                                key={emp.id}
                                                className={`border-b last:border-b-0 ${
                                                    emp.status === "EXITED" ? "opacity-60 bg-gray-50" : ""
                                                }`}
                                            >
                                                <td className="px-3 py-2 align-top">
                                                    <div className="font-medium">{fullName || "—"}</div>
                                                    <div className="text-[11px] text-gray-500">
                                                        Joined{" "}
                                                        {emp.startDate
                                                            ? format(new Date(emp.startDate), "dd MMM yyyy")
                                                            : "—"}
                                                    </div>
                                                </td>

                                                <td className="px-3 py-2 align-top text-xs text-gray-700">
                                                    <div>{emp.jobTitle || "—"}</div>
                                                    <div className="text-[11px] text-gray-500">
                                                        {emp.department || "—"}
                                                    </div>
                                                </td>

                                                <td className="px-3 py-2 align-top text-xs text-gray-700">
                                                    {primaryEmail}
                                                </td>

                                                <td className="px-3 py-2 align-top text-xs">
                                                    <span
                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] ${
                                                            emp.status === "ACTIVE"
                                                                ? "bg-emerald-100 text-emerald-800"
                                                                : emp.status === "PROBATION"
                                                                ? "bg-yellow-100 text-yellow-800"
                                                                : emp.status === "ON_LEAVE"
                                                                ? "bg-blue-100 text-blue-800"
                                                                : "bg-gray-200 text-gray-700"
                                                        }`}
                                                    >
                                                        {emp.status.replace("_", " ")}
                                                    </span>
                                                </td>

                                                <td className="px-3 py-2 align-top text-xs">
                                                    <div className="flex flex-col gap-1">
                                                        <button
                                                            type="button"
                                                            disabled={isTogglingPayroll}
                                                            onClick={() => handlePayrollToggle(emp)}
                                                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] ${
                                                                emp.isPayrollReady
                                                                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                                                    : "bg-white border-gray-200 text-gray-600"
                                                            } disabled:opacity-50`}
                                                        >
                                                            {emp.isPayrollReady
                                                                ? "Payroll ready"
                                                                : "Mark payroll ready"}
                                                        </button>

                                                        <div className="text-[10px] text-gray-500">
                                                            Docs:{" "}
                                                            {[
                                                                emp.hasPassportDoc ? "Passport" : null,
                                                                emp.hasNinSlipDoc ? "NIN" : null,
                                                                emp.hasTaxDoc ? "Tax" : null,
                                                            ]
                                                                .filter(Boolean)
                                                                .join(", ") || "None"}
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-3 py-2 align-top text-right text-xs space-x-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(emp)}
                                                        className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            navigate(`/admin/employees/${emp.id}/documents`)
                                                        }
                                                        className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                                                    >
                                                        Documents
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {/* Pagination */}
                {!isLoading && !isError && pageCount > 0 && (
                    <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-gray-600 border-t">
                        <div>
                            {total > 0
                                ? `Showing ${rangeStart}-${rangeEnd} of ${total} employees`
                                : "No employees"}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={!hasPrevPage}
                                onClick={() => goToPage(1)}
                                className="px-2 py-1 border rounded disabled:opacity-50"
                            >
                                First
                            </button>
                            <button
                                type="button"
                                disabled={!hasPrevPage}
                                onClick={() => goToPage(page - 1)}
                                className="px-2 py-1 border rounded disabled:opacity-50"
                            >
                                Prev
                            </button>

                            <span className="px-2">
                                Page {page} of {pageCount}
                            </span>

                            <button
                                type="button"
                                disabled={!hasNextPage}
                                onClick={() => goToPage(page + 1)}
                                className="px-2 py-1 border rounded disabled:opacity-50"
                            >
                                Next
                            </button>
                            <button
                                type="button"
                                disabled={!hasNextPage}
                                onClick={() => goToPage(pageCount)}
                                className="px-2 py-1 border rounded disabled:opacity-50"
                            >
                                Last
                            </button>
                        </div>
                    </div>
                )}
            </section>

            {/* Form Drawer / Modal */}
            {isFormOpen && editing && (
                <div className="fixed inset-0 z-40 flex">
                    <div
                        className="flex-1 bg-black/40"
                        onClick={closeForm}
                        aria-hidden="true"
                    />

                    <div className="w-full max-w-xl bg-white shadow-xl p-6 overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">
                                {editing.mode === "create" ? "New Employee" : "Edit Employee"}
                            </h2>
                            <button
                                type="button"
                                onClick={closeForm}
                                className="text-sm text-gray-500 hover:text-gray-700"
                                disabled={isSaving}
                            >
                                Close
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        First name
                                    </label>
                                    <input
                                        name="firstName"
                                        defaultValue={editing.employee.firstName || ""}
                                        required
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Last name
                                    </label>
                                    <input
                                        name="lastName"
                                        defaultValue={editing.employee.lastName || ""}
                                        required
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Work email
                                    </label>
                                    <input
                                        name="emailWork"
                                        type="email"
                                        defaultValue={editing.employee.emailWork || ""}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Personal email
                                    </label>
                                    <input
                                        name="emailPersonal"
                                        type="email"
                                        defaultValue={editing.employee.emailPersonal || ""}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Phone
                                    </label>
                                    <input
                                        name="phone"
                                        defaultValue={editing.employee.phone || ""}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Job title
                                    </label>
                                    <input
                                        name="jobTitle"
                                        defaultValue={editing.employee.jobTitle || ""}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Department
                                    </label>
                                    <input
                                        name="department"
                                        defaultValue={editing.employee.department || ""}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Status
                                    </label>
                                    <select
                                        name="status"
                                        defaultValue={editing.employee.status || "ACTIVE"}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    >
                                        <option value="ACTIVE">Active</option>
                                        <option value="PROBATION">Probation</option>
                                        <option value="ON_LEAVE">On leave</option>
                                        <option value="EXITED">Exited</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Start date
                                    </label>
                                    <input
                                        name="startDate"
                                        type="date"
                                        defaultValue={
                                            editing.employee.startDate
                                                ? format(new Date(editing.employee.startDate), "yyyy-MM-dd")
                                                : ""
                                        }
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Base salary (NGN)
                                    </label>
                                    <input
                                        name="baseSalaryNGN"
                                        type="number"
                                        min={0}
                                        defaultValue={editing.employee.baseSalaryNGN ?? ""}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600">
                                        Pay frequency
                                    </label>
                                    <select
                                        name="payFrequency"
                                        defaultValue={editing.employee.payFrequency || ""}
                                        className="mt-1 w-full border rounded px-2 py-1"
                                    >
                                        <option value="">—</option>
                                        <option value="MONTHLY">Monthly</option>
                                        <option value="WEEKLY">Weekly</option>
                                        <option value="OTHER">Other</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600">
                                            Bank
                                        </label>

                                        {banksQuery.isLoading && (
                                            <div className="mt-1 text-xs text-gray-500">Loading banks…</div>
                                        )}

                                        {!banksQuery.isLoading && (
                                            <select
                                                name="bankName"
                                                defaultValue={editing.employee.bankName || ""}
                                                onChange={(e) => {
                                                    const selectedName = e.target.value;
                                                    const selectedBank = banksQuery.data?.find(
                                                        (b: any) => b.name === selectedName
                                                    );

                                                    if (selectedBank) {
                                                        const codeInput = document.querySelector(
                                                            "input[name='bankCode']"
                                                        ) as HTMLInputElement | null;

                                                        if (codeInput) codeInput.value = selectedBank.code;
                                                    }
                                                }}
                                                className="mt-1 w-full border rounded px-2 py-1"
                                            >
                                                <option value="">Select bank</option>
                                                {banksQuery.data?.map((bank: any) => (
                                                    <option key={bank.code} value={bank.name}>
                                                        {bank.name}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600">
                                            Bank code
                                        </label>
                                        <input
                                            name="bankCode"
                                            defaultValue={editing.employee.bankCode || ""}
                                            readOnly
                                            className="mt-1 w-full border rounded px-2 py-1 bg-gray-100 text-gray-700"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600">
                                            Account number
                                        </label>
                                        <input
                                            name="accountNumber"
                                            defaultValue={editing.employee.accountNumber || ""}
                                            className="mt-1 w-full border rounded px-2 py-1"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600">
                                            Account name
                                        </label>
                                        <input
                                            name="accountName"
                                            defaultValue={editing.employee.accountName || ""}
                                            className="mt-1 w-full border rounded px-2 py-1"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mt-2">
                                <input
                                    id="isPayrollReady"
                                    name="isPayrollReady"
                                    type="checkbox"
                                    defaultChecked={!!editing.employee.isPayrollReady}
                                    className="h-4 w-4"
                                />
                                <label
                                    htmlFor="isPayrollReady"
                                    className="text-xs font-medium text-gray-600"
                                >
                                    Mark as payroll ready
                                </label>
                            </div>

                            <div className="pt-4 flex items-center justify-between border-t">
                                <button
                                    type="button"
                                    onClick={closeForm}
                                    disabled={isSaving}
                                    className="px-3 py-1.5 border rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-4 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {isSaving
                                        ? editing.mode === "create"
                                            ? "Creating…"
                                            : "Saving…"
                                        : editing.mode === "create"
                                        ? "Create employee"
                                        : "Save changes"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminEmployees;