// src/pages/admin/AdminCareersJobs.tsx
import React, { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../../api/client";
import { format } from "date-fns";

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
  closingDate?: string | null; // ISO string from API
  createdAt: string;
  updatedAt: string;
};

type JobsListResponse = {
  items: CareersJobRole[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
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

/* ----------------------------- API helpers ----------------------------- */

function buildListQuery(filters: Filters) {
  const params: any = {
    page: filters.page,
    pageSize: filters.pageSize,
  };

  if (filters.search.trim()) params.search = filters.search.trim();
  if (filters.department.trim()) params.department = filters.department.trim();
  if (filters.includeDeleted) params.includeDeleted = "1";

  if (filters.isPublished === "published") params.isPublished = "1";
  else if (filters.isPublished === "unpublished") params.isPublished = "0";

  return params;
}

/* ----------------------------- Component ----------------------------- */

const AdminCareersJobs: React.FC = () => {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [editing, setEditing] = useState<EditingJobState>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const queryKey = useMemo(() => ["admin-careers-jobs", filters], [filters]);

  const jobsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const params = buildListQuery(filters);
      const res = await api.get<JobsListResponse>("/api/admin/careers/jobs", {
        params,
      });
      return res.data;
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
  const { data, isLoading, isError } = jobsQuery;

  /* ----------------------------- Handlers ----------------------------- */

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

  const jobs = data?.items ?? [];

  /* ----------------------------- Render ----------------------------- */

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

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          + New Job
        </button>
      </header>

      {/* Filters */}
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
        </div>
      </section>

      {/* Table */}
      <section className="bg-white rounded-lg shadow-sm">
        {isLoading && (
          <div className="p-6 text-sm text-gray-500">Loading jobs…</div>
        )}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.pageCount > 1 && (
          <div className="px-4 py-3 flex items-center justify-between text-xs text-gray-600 border-t">
            <div>
              Page {data.page} of {data.pageCount} • {data.total} jobs
            </div>
            <div className="space-x-2">
              <button
                type="button"
                disabled={filters.page <= 1}
                onClick={() =>
                  setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))
                }
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={filters.page >= data.pageCount}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(data.pageCount, f.page + 1),
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

      {/* Form Drawer / Modal */}
      {isFormOpen && editing && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/40"
            onClick={closeForm}
            aria-hidden="true"
          />
          {/* Panel */}
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
              {/* Title & Slug */}
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

              {/* Department / Location */}
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

              {/* Employment / Location type */}
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

              {/* Salary */}
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

              {/* Application */}
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

              {/* Publishing */}
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

              {/* Closing date */}
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

              {/* Intro */}
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

              {/* JSON fields */}
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

              {/* Actions */}
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