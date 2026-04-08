// src/pages/admin/AdminCareersJobs.tsx
import React, { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../../api/client";
import { format } from "date-fns";
import { useAuthStore } from "../../store/auth";

/* ----------------------------- Types ----------------------------- */

type CareersEmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "TEMPORARY" | "INTERN";
type CareersLocationType = "ONSITE" | "HYBRID" | "REMOTE";

export type CareersJobRole = {
  id: string;
  slug: string;
  title: string;
  department?: string | null;
  location?: string | null;
  employmentType?: CareersEmploymentType | null;
  locationType?: CareersLocationType | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  isPublished: boolean;
  isDeleted: boolean;
  sortOrder: number;
  applicationEmail?: string | null;
  applicationUrl?: string | null;
  introHtml?: string | null;
  responsibilitiesJson?: any | null;
  requirementsJson?: any | null;
  benefitsJson?: any | null;
  closingDate?: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobsListResponse = {
  rows: CareersJobRole[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

/* ----------------------------- Filters / UI State ----------------------------- */

type Filters = {
  search: string;
  department: string;
  isPublished: "all" | "published" | "unpublished";
  includeDeleted: boolean;
  page: number;
  pageSize: number;
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  department: "",
  isPublished: "all",
  includeDeleted: false,
  page: 1,
  pageSize: 20,
};

type EditingJobState =
  | { mode: "create"; job: Partial<CareersJobRole> }
  | { mode: "edit"; job: CareersJobRole }
  | null;

/* ----------------------------- Helpers ----------------------------- */

function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function buildListQuery(filters: Filters) {
  const params: Record<string, string | number | boolean> = {
    page: filters.page,
    pageSize: filters.pageSize,
  };

  if (filters.search.trim()) params.q = filters.search.trim();

  if (filters.isPublished === "published") params.isPublished = "true";
  else if (filters.isPublished === "unpublished") params.isPublished = "false";

  if (filters.includeDeleted) params.isDeleted = "true";
  else params.isDeleted = "false";

  return params;
}

function normalizeJobsResponse(raw: any, fallbackPage: number, fallbackPageSize: number): JobsListResponse {
  const root = raw?.data ?? raw ?? {};
  const payload = root?.data ?? root ?? {};

  const rawRows = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root?.items)
          ? root.items
          : [];

  const total = Math.max(0, toInt(payload?.total ?? root?.total, rawRows.length));
  const pageSize = Math.max(1, toInt(payload?.pageSize ?? root?.pageSize, fallbackPageSize));
  const page = Math.max(1, toInt(payload?.page ?? root?.page, fallbackPage));
  const totalPages = Math.max(
    1,
    toInt(payload?.totalPages ?? root?.pageCount ?? root?.totalPages, Math.ceil(total / pageSize) || 1)
  );

  return {
    rows: rawRows as CareersJobRole[],
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: Boolean(payload?.hasNextPage ?? root?.hasNextPage ?? page < totalPages),
    hasPrevPage: Boolean(payload?.hasPrevPage ?? root?.hasPrevPage ?? page > 1),
  };
}

/* ----------------------------- Component ----------------------------- */

const AdminCareersJobs: React.FC = () => {
  const queryClient = useQueryClient();
  const isSuperAdmin = useAuthStore((s) => s.user?.role === "SUPER_ADMIN");

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [editing, setEditing] = useState<EditingJobState>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const queryKey = useMemo(() => ["admin-careers-jobs", filters], [filters]);

  const jobsQuery = useQuery({
    queryKey,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = buildListQuery(filters);
      const res = await api.get("/api/admin/careers/jobs", { params });
      return normalizeJobsResponse(res.data, filters.page, filters.pageSize);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await api.post("/api/admin/careers/jobs", payload);
      return res.data as CareersJobRole;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-careers-jobs"] });
      setIsFormOpen(false);
      setEditing(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: any & { id: string }) => {
      const { id, ...data } = payload;
      const res = await api.patch(`/api/admin/careers/jobs/${id}`, data);
      return res.data as CareersJobRole;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-careers-jobs"] });
      setIsFormOpen(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/api/admin/careers/jobs/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-careers-jobs"] });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const { data, isLoading, isError, isFetching } = jobsQuery;

  function openCreate() {
    const blank: Partial<CareersJobRole> = {
      title: "",
      slug: "",
      department: "",
      location: "",
      employmentType: undefined,
      locationType: undefined,
      minSalary: undefined,
      maxSalary: undefined,
      currency: "NGN",
      isPublished: false,
      sortOrder: 0,
      applicationEmail: "",
      applicationUrl: "",
      introHtml: "",
      responsibilitiesJson: "",
      requirementsJson: "",
      benefitsJson: "",
      closingDate: "",
    };
    setEditing({ mode: "create", job: blank });
    setIsFormOpen(true);
  }

  function openEdit(job: CareersJobRole) {
    setEditing({ mode: "edit", job });
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

    const payload: any = {
      title: formData.get("title")?.toString().trim(),
      slug: formData.get("slug")?.toString().trim(),
      department: formData.get("department")?.toString().trim() || null,
      location: formData.get("location")?.toString().trim() || null,
      employmentType: formData.get("employmentType") || undefined,
      locationType: formData.get("locationType") || undefined,
      minSalary: formData.get("minSalary") || undefined,
      maxSalary: formData.get("maxSalary") || undefined,
      currency: formData.get("currency")?.toString().trim() || null,
      isPublished: formData.get("isPublished") === "on",
      sortOrder: formData.get("sortOrder") || undefined,
      applicationEmail: formData.get("applicationEmail")?.toString().trim() || null,
      applicationUrl: formData.get("applicationUrl")?.toString().trim() || null,
      introHtml: formData.get("introHtml")?.toString() || null,
      responsibilitiesJson: formData.get("responsibilitiesJson")?.toString() || undefined,
      requirementsJson: formData.get("requirementsJson")?.toString() || undefined,
      benefitsJson: formData.get("benefitsJson")?.toString() || undefined,
      closingDate: formData.get("closingDate")?.toString().trim() || undefined,
    };

    if (!payload.responsibilitiesJson) delete payload.responsibilitiesJson;
    if (!payload.requirementsJson) delete payload.requirementsJson;
    if (!payload.benefitsJson) delete payload.benefitsJson;
    if (!payload.closingDate) delete payload.closingDate;

    try {
      if (editing.mode === "create") {
        await createMutation.mutateAsync(payload);
      } else {
        await updateMutation.mutateAsync({ id: editing.job.id, ...payload });
      }
    } catch (err) {
      console.error("Failed to save job", err);
    }
  }

  function handleDelete(id: string) {
    if (!window.confirm("Are you sure you want to archive this job?")) return;
    deleteMutation.mutate(id);
  }

  const jobs = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? filters.page;
  const pageSize = data?.pageSize ?? filters.pageSize;
  const totalPages = data?.totalPages ?? 1;
  const hasPrevPage = data?.hasPrevPage ?? false;
  const hasNextPage = data?.hasNextPage ?? false;
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = total === 0 ? 0 : Math.min(page * pageSize, total);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            to="/admin"
            className="inline-flex items-center px-2.5 py-1.5 rounded-md border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Back to admin
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">Careers – Job Roles</h1>
            <p className="text-sm text-gray-500">
              Manage job roles shown on the public careers page.
            </p>
          </div>
        </div>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            + New Job
          </button>
        )}
      </header>

      <section className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600">Search</label>
            <input
              type="text"
              className="border rounded px-2 py-1 text-sm"
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))
              }
              placeholder="Title, slug, department..."
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600">Department</label>
            <input
              type="text"
              className="border rounded px-2 py-1 text-sm"
              value={filters.department}
              onChange={(e) =>
                setFilters((f) => ({ ...f, department: e.target.value, page: 1 }))
              }
              placeholder="e.g. Engineering"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600">Published</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={filters.isPublished}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  isPublished: e.target.value as Filters["isPublished"],
                  page: 1,
                }))
              }
            >
              <option value="all">All</option>
              <option value="published">Published</option>
              <option value="unpublished">Unpublished</option>
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600">Page size</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={filters.pageSize}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  pageSize: toInt(e.target.value, 20),
                  page: 1,
                }))
              }
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              checked={filters.includeDeleted}
              onChange={(e) =>
                setFilters((f) => ({ ...f, includeDeleted: e.target.checked, page: 1 }))
              }
            />
            Include archived
          </label>

          <div className="ml-auto text-xs text-gray-500">
            {isFetching ? "Refreshing…" : total > 0 ? `Showing ${startItem}-${endItem} of ${total}` : "No jobs"}
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow-sm">
        {isLoading && <div className="p-6 text-sm text-gray-500">Loading jobs…</div>}
        {isError && !isLoading && (
          <div className="p-6 text-sm text-red-600">
            Failed to load jobs. Please try again.
          </div>
        )}
        {!isLoading && jobs.length === 0 && (
          <div className="p-6 text-sm text-gray-500">No jobs found.</div>
        )}

        {jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                    Title
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                    Department
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                    Location
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                    Published
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-500">
                    Closing
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-xs text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className={`border-b last:border-b-0 ${
                      job.isDeleted ? "opacity-60 bg-gray-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{job.title}</div>
                      <div className="text-xs text-gray-500">{job.slug}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-700">
                      {job.department || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-700">
                      {job.location || "—"}
                      {job.locationType && (
                        <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-gray-100 text-[10px] uppercase tracking-wide text-gray-600">
                          {job.locationType.toLowerCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      {job.isPublished ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-100 text-green-800">
                          Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                          Draft
                        </span>
                      )}
                      {job.isDeleted && (
                        <div className="text-[10px] text-red-600 mt-0.5">
                          Archived
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-700">
                      {job.closingDate
                        ? format(new Date(job.closingDate), "yyyy-MM-dd")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-right text-xs space-x-2">
                      {isSuperAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(job)}
                            className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          {!job.isDeleted && (
                            <button
                              type="button"
                              onClick={() => handleDelete(job.id)}
                              disabled={isDeleting}
                              className="px-2 py-1 rounded border border-red-200 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Archive
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && totalPages > 1 && (
          <div className="px-4 py-3 flex items-center justify-between text-xs text-gray-600 border-t">
            <div>
              Page {page} of {totalPages} • {total} jobs
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!hasPrevPage}
                onClick={() =>
                  setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))
                }
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={!hasNextPage}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(totalPages, f.page + 1),
                  }))
                }
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

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
                {editing.mode === "create" ? "New Job Role" : "Edit Job Role"}
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
                    Title
                  </label>
                  <input
                    name="title"
                    defaultValue={editing.job.title || ""}
                    required
                    className="mt-1 w-full border rounded px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Slug
                  </label>
                  <input
                    name="slug"
                    defaultValue={editing.job.slug || ""}
                    required
                    className="mt-1 w-full border rounded px-2 py-1"
                    placeholder="software-engineer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Department
                  </label>
                  <input
                    name="department"
                    defaultValue={editing.job.department || ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                    placeholder="Engineering, People, Finance..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Location
                  </label>
                  <input
                    name="location"
                    defaultValue={editing.job.location || ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                    placeholder="Lagos, Remote, UK..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Employment type
                  </label>
                  <select
                    name="employmentType"
                    defaultValue={editing.job.employmentType || ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                  >
                    <option value="">—</option>
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="TEMPORARY">Temporary</option>
                    <option value="INTERN">Intern</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Location type
                  </label>
                  <select
                    name="locationType"
                    defaultValue={editing.job.locationType || ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                  >
                    <option value="">—</option>
                    <option value="ONSITE">On-site</option>
                    <option value="HYBRID">Hybrid</option>
                    <option value="REMOTE">Remote</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Min salary
                  </label>
                  <input
                    name="minSalary"
                    type="number"
                    min={0}
                    defaultValue={editing.job.minSalary ?? ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Max salary
                  </label>
                  <input
                    name="maxSalary"
                    type="number"
                    min={0}
                    defaultValue={editing.job.maxSalary ?? ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Currency
                  </label>
                  <input
                    name="currency"
                    defaultValue={editing.job.currency || "NGN"}
                    className="mt-1 w-full border rounded px-2 py-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Application email
                  </label>
                  <input
                    name="applicationEmail"
                    defaultValue={editing.job.applicationEmail || ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Application URL
                  </label>
                  <input
                    name="applicationUrl"
                    defaultValue={editing.job.applicationUrl || ""}
                    className="mt-1 w-full border rounded px-2 py-1"
                    placeholder="https://…"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-2 mt-2">
                  <input
                    id="isPublished"
                    name="isPublished"
                    type="checkbox"
                    defaultChecked={!!editing.job.isPublished}
                    className="h-4 w-4"
                  />
                  <label
                    htmlFor="isPublished"
                    className="text-xs font-medium text-gray-600"
                  >
                    Published (visible on site)
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Sort order
                  </label>
                  <input
                    name="sortOrder"
                    type="number"
                    defaultValue={editing.job.sortOrder ?? 0}
                    className="mt-1 w-full border rounded px-2 py-1"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600">
                  Closing date
                </label>
                <input
                  name="closingDate"
                  type="date"
                  defaultValue={
                    editing.job.closingDate
                      ? format(new Date(editing.job.closingDate), "yyyy-MM-dd")
                      : ""
                  }
                  className="mt-1 w-full border rounded px-2 py-1"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600">
                  Intro / teaser (HTML allowed)
                </label>
                <textarea
                  name="introHtml"
                  rows={3}
                  defaultValue={editing.job.introHtml || ""}
                  className="mt-1 w-full border rounded px-2 py-1 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Responsibilities JSON
                  </label>
                  <textarea
                    name="responsibilitiesJson"
                    rows={4}
                    defaultValue={
                      editing.job.responsibilitiesJson
                        ? JSON.stringify(editing.job.responsibilitiesJson, null, 2)
                        : ""
                    }
                    className="mt-1 w-full border rounded px-2 py-1 font-mono text-[11px]"
                    placeholder='e.g. ["Own X", "Deliver Y"]'
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Requirements JSON
                  </label>
                  <textarea
                    name="requirementsJson"
                    rows={4}
                    defaultValue={
                      editing.job.requirementsJson
                        ? JSON.stringify(editing.job.requirementsJson, null, 2)
                        : ""
                    }
                    className="mt-1 w-full border rounded px-2 py-1 font-mono text-[11px]"
                    placeholder='e.g. ["3+ years in...", "Experience with..."]'
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Benefits JSON
                  </label>
                  <textarea
                    name="benefitsJson"
                    rows={4}
                    defaultValue={
                      editing.job.benefitsJson
                        ? JSON.stringify(editing.job.benefitsJson, null, 2)
                        : ""
                    }
                    className="mt-1 w-full border rounded px-2 py-1 font-mono text-[11px]"
                    placeholder='e.g. ["Health insurance", "Remote budget"]'
                  />
                </div>
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
                      ? "Create job"
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

export default AdminCareersJobs;