// src/pages/CareersIndex.tsx
import React, { useState, useMemo, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { format } from "date-fns";

type CareersEmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "TEMPORARY" | "INTERN";
type CareersLocationType = "ONSITE" | "HYBRID" | "REMOTE";

type CareersJobRole = {
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
    introHtml?: string | null;
    closingDate?: string | null;
    createdAt: string;
};

type JobsListResponse = {
    items: CareersJobRole[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
};

type Filters = {
    search: string;
    department: string;
    employmentType: string;
    locationType: string;
    includeClosed: boolean;
    page: number;
    pageSize: number;
};

const DEFAULT_FILTERS: Filters = {
    search: "",
    department: "",
    employmentType: "",
    locationType: "",
    includeClosed: false,
    page: 1,
    pageSize: 20,
};

function buildQuery(filters: Filters) {
    const params: any = {
        page: filters.page,
        pageSize: filters.pageSize,
    };
    if (filters.search.trim()) params.search = filters.search.trim();
    if (filters.department.trim()) params.department = filters.department.trim();
    if (filters.employmentType) params.employmentType = filters.employmentType;
    if (filters.locationType) params.locationType = filters.locationType;
    if (filters.includeClosed) params.includeClosed = "1";
    return params;
}

const CareersIndex: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();

    const [filters, setFilters] = useState<Filters>(() => {
        // hydrate from querystring for nicer shareable URLs
        return {
            ...DEFAULT_FILTERS,
            search: searchParams.get("q") || "",
            department: searchParams.get("dept") || "",
            employmentType: searchParams.get("emp") || "",
            locationType: searchParams.get("locType") || "",
            includeClosed: searchParams.get("closed") === "1",
            page: Number(searchParams.get("page") || 1),
            pageSize: DEFAULT_FILTERS.pageSize,
        };
    });

    function syncUrl(next: Filters) {
        const sp: any = {};
        if (next.search.trim()) sp.q = next.search.trim();
        if (next.department.trim()) sp.dept = next.department.trim();
        if (next.employmentType) sp.emp = next.employmentType;
        if (next.locationType) sp.locType = next.locationType;
        if (next.includeClosed) sp.closed = "1";
        if (next.page > 1) sp.page = String(next.page);
        setSearchParams(sp);
    }

    const queryKey = useMemo(() => ["careers-jobs-public", filters], [filters]);

    const jobsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const params = buildQuery(filters);
            const res = await api.get<JobsListResponse>("/api/careers/jobs", { params });
            return res.data;
        },
    });

    const { data, isLoading, isError } = jobsQuery;
    const jobs = data?.items ?? [];

    function handleFilterSubmit(e: FormEvent) {
        e.preventDefault();
        syncUrl(filters);
    }

    function handlePageChange(page: number) {
        const next = { ...filters, page };
        setFilters(next);
        syncUrl(next);
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">

            <header className="space-y-2 text-center">
                <h1 className="text-3xl font-semibold">Careers</h1>
                <p className="text-sm text-gray-600">
                    Join the team building the future of everyday commerce.
                </p>

                <div className="mt-3">
                    <Link
                        to="/careers/apply"
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-blue-700"
                    >
                        Send a general application
                    </Link>
                </div>
            </header>

      {/* Filters */ }
    <section className="bg-white rounded-lg shadow-sm p-4">
        <form
            onSubmit={handleFilterSubmit}
            className="flex flex-wrap gap-3 items-end text-sm"
        >
            <div className="flex flex-col flex-1 min-w-[160px]">
                <label className="text-xs font-medium text-gray-600">Search</label>
                <input
                    type="text"
                    value={filters.search}
                    onChange={(e) =>
                        setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))
                    }
                    className="mt-1 border rounded px-2 py-1"
                    placeholder="Job title, keyword..."
                />
            </div>

            <div className="flex flex-col min-w-[160px]">
                <label className="text-xs font-medium text-gray-600">
                    Department
                </label>
                <input
                    type="text"
                    value={filters.department}
                    onChange={(e) =>
                        setFilters((f) => ({ ...f, department: e.target.value, page: 1 }))
                    }
                    className="mt-1 border rounded px-2 py-1"
                    placeholder="e.g. Engineering"
                />
            </div>

            <div className="flex flex-col min-w-[140px]">
                <label className="text-xs font-medium text-gray-600">
                    Employment type
                </label>
                <select
                    value={filters.employmentType}
                    onChange={(e) =>
                        setFilters((f) => ({
                            ...f,
                            employmentType: e.target.value,
                            page: 1,
                        }))
                    }
                    className="mt-1 border rounded px-2 py-1"
                >
                    <option value="">Any</option>
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="TEMPORARY">Temporary</option>
                    <option value="INTERN">Intern</option>
                </select>
            </div>

            <div className="flex flex-col min-w-[140px]">
                <label className="text-xs font-medium text-gray-600">
                    Location type
                </label>
                <select
                    value={filters.locationType}
                    onChange={(e) =>
                        setFilters((f) => ({
                            ...f,
                            locationType: e.target.value,
                            page: 1,
                        }))
                    }
                    className="mt-1 border rounded px-2 py-1"
                >
                    <option value="">Any</option>
                    <option value="ONSITE">On-site</option>
                    <option value="HYBRID">Hybrid</option>
                    <option value="REMOTE">Remote</option>
                </select>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                <input
                    type="checkbox"
                    checked={filters.includeClosed}
                    onChange={(e) =>
                        setFilters((f) => ({
                            ...f,
                            includeClosed: e.target.checked,
                            page: 1,
                        }))
                    }
                />
                Include closed roles
            </label>

            <button
                type="submit"
                className="ml-auto px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
            >
                Apply filters
            </button>
        </form>
    </section>

    {/* List */ }
    <section className="space-y-4">
        {isLoading && (
            <div className="text-sm text-gray-500">Loading roles…</div>
        )}
        {isError && !isLoading && (
            <div className="text-sm text-red-600">
                Something went wrong loading roles. Please try again.
            </div>
        )}
        {!isLoading && jobs.length === 0 && (
            <div className="text-sm text-gray-500">
                No roles found right now. Please check back soon.
            </div>
        )}

        <div className="space-y-3">
            {jobs.map((job) => {
                const isClosed =
                    !!job.closingDate &&
                    new Date(job.closingDate).getTime() < Date.now();
                return (
                    <Link
                        key={job.id}
                        to={`/careers/${job.slug}`}
                        className="block bg-white rounded-lg shadow-sm p-4 border border-gray-100 hover:border-blue-200 hover:shadow-md transition"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                                <h2 className="text-base font-semibold text-gray-900">
                                    {job.title}
                                </h2>
                                <div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
                                    {job.department && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100">
                                            {job.department}
                                        </span>
                                    )}
                                    {job.location && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100">
                                            {job.location}
                                        </span>
                                    )}
                                    {job.locationType && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 uppercase tracking-wide">
                                            {job.locationType.toLowerCase()}
                                        </span>
                                    )}
                                    {job.employmentType && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                                            {job.employmentType
                                                .toLowerCase()
                                                .replace("_", " ")}
                                        </span>
                                    )}
                                </div>

                                {job.minSalary != null && (
                                    <div className="text-xs text-gray-700">
                                        <span className="font-medium">
                                            {job.currency || "NGN"}
                                        </span>{" "}
                                        {job.minSalary?.toLocaleString()}{" "}
                                        {job.maxSalary
                                            ? `– ${job.maxSalary.toLocaleString()}`
                                            : "+"}
                                    </div>
                                )}

                                {job.introHtml && (
                                    <div
                                        className="text-xs text-gray-600 mt-1 line-clamp-3"
                                        dangerouslySetInnerHTML={{ __html: job.introHtml }}
                                    />
                                )}
                            </div>

                            <div className="flex flex-col items-end gap-1 text-right">
                                {job.closingDate && (
                                    <div className="text-[11px] text-gray-500">
                                        Closes{" "}
                                        {format(new Date(job.closingDate), "dd MMM yyyy")}
                                    </div>
                                )}
                                {isClosed && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-200 text-[10px] text-gray-700 uppercase">
                                        Closed
                                    </span>
                                )}
                            </div>
                        </div>
                    </Link>
                );
            })}
        </div>

        {/* Pagination */}
        {data && data.pageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-gray-600 pt-2">
                <div>
                    Page {data.page} of {data.pageCount} • {data.total} roles
                </div>
                <div className="space-x-2">
                    <button
                        type="button"
                        disabled={filters.page <= 1}
                        onClick={() => handlePageChange(Math.max(1, filters.page - 1))}
                        className="px-2 py-1 border rounded disabled:opacity-50"
                    >
                        Prev
                    </button>
                    <button
                        type="button"
                        disabled={filters.page >= data.pageCount}
                        onClick={() =>
                            handlePageChange(Math.min(data.pageCount, filters.page + 1))
                        }
                        className="px-2 py-1 border rounded disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            </div>
        )}
    </section>
    </div >
  );
};

export default CareersIndex;