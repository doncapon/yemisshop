// src/pages/CareerJobDetail.tsx
import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import api from "../api/client";

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

const CareerJobDetail: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();

  const jobQuery = useQuery({
    queryKey: ["careers-job-detail", slug],
    enabled: !!slug,
    queryFn: async () => {
      const res = await api.get<CareersJobRole>(`/api/careers/jobs/${slug}`);
      return res.data;
    },
  });

  const { data: job, isLoading, isError } = jobQuery;

  const isClosed =
    !!job?.closingDate && new Date(job.closingDate).getTime() < Date.now();

  const responsibilities: string[] = Array.isArray(job?.responsibilitiesJson)
    ? job!.responsibilitiesJson
    : [];
  const requirements: string[] = Array.isArray(job?.requirementsJson)
    ? job!.requirementsJson
    : [];
  const benefits: string[] = Array.isArray(job?.benefitsJson)
    ? job!.benefitsJson
    : [];

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="text-sm text-gray-500">Loading role…</div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-3">
        <div className="text-sm text-red-600">
          This role could not be found. It may have been closed or removed.
        </div>
        <Link
          to="/careers"
          className="inline-flex items-center text-sm text-blue-600 hover:underline"
        >
          ← Back to careers
        </Link>
      </div>
    );
  }

  const prettyLocationType = job.locationType
    ? job.locationType.toLowerCase()
    : "";
  const prettyEmployment = job.employmentType
    ? job.employmentType.toLowerCase().replace("_", " ")
    : "";

  const salaryCurrency = job.currency || "NGN";

  const mailtoHref =
    job.applicationEmail &&
    `mailto:${job.applicationEmail}?subject=${encodeURIComponent(
      `${job.title} application`
    )}`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <Link
        to="/careers"
        className="inline-flex items-center text-xs text-blue-600 hover:underline"
      >
        ← Back to all roles
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">{job.title}</h1>

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
              {prettyLocationType}
            </span>
          )}
          {job.employmentType && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700">
              {prettyEmployment}
            </span>
          )}
          {job.closingDate && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-50 text-gray-700">
              Closes {format(new Date(job.closingDate), "dd MMM yyyy")}
            </span>
          )}
          {isClosed && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 uppercase">
              Closed
            </span>
          )}
        </div>

        {job.minSalary != null && (
          <div className="text-sm text-gray-800">
            <span className="font-medium">{salaryCurrency}</span>{" "}
            {job.minSalary.toLocaleString()}{" "}
            {job.maxSalary ? `– ${job.maxSalary.toLocaleString()}` : "+"}{" "}
            <span className="text-xs text-gray-500">per annum</span>
          </div>
        )}

        {job.introHtml && (
          <div
            className="text-sm text-gray-700 mt-2 space-y-2"
            dangerouslySetInnerHTML={{ __html: job.introHtml }}
          />
        )}
      </header>

      {/* Content sections */}
      <main className="space-y-6 text-sm text-gray-800">
        {responsibilities.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-gray-900">
              What you&apos;ll do
            </h2>
            <ul className="list-disc list-inside space-y-1">
              {responsibilities.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {requirements.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-gray-900">
              What you&apos;ll bring
            </h2>
            <ul className="list-disc list-inside space-y-1">
              {requirements.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {benefits.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-gray-900">Benefits</h2>
            <ul className="list-disc list-inside space-y-1">
              {benefits.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {/* Apply section */}
      <section className="pt-4 border-t space-y-3">
        {!isClosed ? (
          <>
            <h2 className="text-sm font-semibold text-gray-900">
              Ready to apply?
            </h2>
            <div className="text-sm text-gray-700 space-y-2">
              {job.applicationUrl ? (
                <a
                  href={job.applicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-blue-700"
                >
                  Apply on external site
                </a>
              ) : job.applicationEmail && mailtoHref ? (
                <a
                  href={mailtoHref}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-blue-700"
                >
                  Apply by email
                </a>
              ) : (
                <span className="text-xs text-gray-500">
                  Application details will be provided by the hiring team.
                </span>
              )}

              {/* General-application fallback */}
              <p className="text-xs text-gray-500">
                Or send a general application via{" "}
                <Link
                  to="/careers/apply"
                  className="text-blue-600 hover:underline"
                >
                  our careers form
                </Link>
                .
              </p>
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-500">
            This role is no longer accepting applications.
          </div>
        )}
      </section>
    </div>
  );
};

export default CareerJobDetail;