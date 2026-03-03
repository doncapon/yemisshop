// src/pages/admin/AdminCareersConfig.tsx
import React, { type FormEvent, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";

/* ----------------------------- Types ----------------------------- */

type CareersLocationType = "ONSITE" | "HYBRID" | "REMOTE";

type CareersSettings = {
  id: number;
  isCareersEnabled: boolean;
  allowOpenApplications: boolean;
  careersEmail?: string | null;
  careersInboxLabel?: string | null;
  defaultLocation?: string | null;
  defaultLocationType?: CareersLocationType | null;
  careersIntroHtml?: string | null;
  careersFooterHtml?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ----------------------------- Config ----------------------------- */

// Cookie-mode (same as the rest of your app)
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

/* ----------------------------- Component ----------------------------- */

const AdminCareersConfig: React.FC = () => {
  const queryClient = useQueryClient();

  const [formState, setFormState] = useState<CareersSettings | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["admin-careers-settings"],
    queryFn: async () => {
      const res = await api.get<CareersSettings>("/api/admin/careers/settings", AXIOS_COOKIE_CFG);
      return res.data;
    },
  });

  const { data, isLoading, isError } = settingsQuery;

  const {
    mutateAsync: saveSettings,
    isPending,
  } = useMutation({
    mutationFn: async (payload: Partial<CareersSettings>) => {
      const res = await api.patch<CareersSettings>(
        "/api/admin/careers/settings",
        payload,
        AXIOS_COOKIE_CFG
      );
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-careers-settings"], data);
      setFormState(data);
      setSaveError(null);
      setSaveMessage("Settings saved.");
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save careers settings. Please try again.";
      setSaveMessage(null);
      setSaveError(msg);
    },
  });

  // Single source of truth for "saving" state
  const isSaving = isPending;

  useEffect(() => {
    if (data && !formState) {
      setFormState(data);
    }
  }, [data, formState]);

  function handleChange<K extends keyof CareersSettings>(key: K, value: CareersSettings[K]) {
    setFormState((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaveMessage(null);
    setSaveError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formState) return;

    const payload: Partial<CareersSettings> = {
      isCareersEnabled: formState.isCareersEnabled,
      allowOpenApplications: formState.allowOpenApplications,
      careersEmail: formState.careersEmail || null,
      careersInboxLabel: formState.careersInboxLabel || null,
      defaultLocation: formState.defaultLocation || null,
      defaultLocationType: formState.defaultLocationType || null,
      careersIntroHtml: formState.careersIntroHtml || null,
      careersFooterHtml: formState.careersFooterHtml || null,
      seoTitle: formState.seoTitle || null,
      seoDescription: formState.seoDescription || null,
    };

    try {
      await saveSettings(payload);
    } catch {
      // error is handled in onError
    }
  }

  if (isLoading || !formState) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Careers – Settings</h1>
        <div className="text-sm text-gray-500">Loading settings…</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Careers – Settings</h1>
        <div className="text-sm text-red-600">
          Failed to load careers settings. Please try again.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Careers – Settings</h1>
        <p className="text-sm text-gray-500">
          Control global careers configuration and default content.
        </p>
      </header>

      {/* Feedback banners */}
      {saveMessage && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {saveMessage}
        </div>
      )}
      {saveError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {saveError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 text-sm">
        {/* Toggles */}
        <section className="bg-white rounded-lg shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-800">Feature toggles</h2>

          <label className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-gray-700">
                Enable careers on site
              </div>
              <div className="text-[11px] text-gray-500">
                If disabled, the careers page can be hidden from navigation.
              </div>
            </div>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={formState.isCareersEnabled}
              onChange={(e) => handleChange("isCareersEnabled", e.target.checked)}
            />
          </label>

          <label className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-gray-700">
                Allow open applications
              </div>
              <div className="text-[11px] text-gray-500">
                When enabled, candidates can submit a general application even if no job
                fits.
              </div>
            </div>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={formState.allowOpenApplications}
              onChange={(e) =>
                handleChange("allowOpenApplications", e.target.checked)
              }
            />
          </label>
        </section>

        {/* Contact / defaults */}
        <section className="bg-white rounded-lg shadow-sm p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Contact & defaults</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600">
                Careers email
              </label>
              <input
                type="email"
                value={formState.careersEmail || ""}
                onChange={(e) => handleChange("careersEmail", e.target.value)}
                className="mt-1 w-full border rounded px-2 py-1 text-xs sm:text-sm"
                placeholder="careers@yourcompany.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">
                Inbox label (who receives applications)
              </label>
              <input
                type="text"
                value={formState.careersInboxLabel || ""}
                onChange={(e) => handleChange("careersInboxLabel", e.target.value)}
                className="mt-1 w-full border rounded px-2 py-1 text-xs sm:text-sm"
                placeholder="People & Culture Team"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600">
                Default location
              </label>
              <input
                type="text"
                value={formState.defaultLocation || ""}
                onChange={(e) => handleChange("defaultLocation", e.target.value)}
                className="mt-1 w-full border rounded px-2 py-1 text-xs sm:text-sm"
                placeholder="Lagos, Remote, UK…"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">
                Default location type
              </label>
              <select
                value={formState.defaultLocationType || ""}
                onChange={(e) =>
                  handleChange(
                    "defaultLocationType",
                    (e.target.value || null) as CareersLocationType | null
                  )
                }
                className="mt-1 w-full border rounded px-2 py-1 text-xs sm:text-sm"
              >
                <option value="">—</option>
                <option value="ONSITE">On-site</option>
                <option value="HYBRID">Hybrid</option>
                <option value="REMOTE">Remote</option>
              </select>
            </div>
          </div>
        </section>

        {/* Copy / SEO */}
        <section className="bg-white rounded-lg shadow-sm p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Copy & SEO</h2>

          <div>
            <label className="block text-xs font-medium text-gray-600">
              Careers intro (HTML)
            </label>
            <textarea
              rows={3}
              value={formState.careersIntroHtml || ""}
              onChange={(e) => handleChange("careersIntroHtml", e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1 font-mono text-[11px]"
              placeholder="<p>Come build the future of commerce with us.</p>"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600">
              Careers footer (HTML)
            </label>
            <textarea
              rows={3}
              value={formState.careersFooterHtml || ""}
              onChange={(e) => handleChange("careersFooterHtml", e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1 font-mono text-[11px]"
              placeholder="<p>We are an equal opportunity employer…</p>"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600">
                SEO title
              </label>
              <input
                type="text"
                value={formState.seoTitle || ""}
                onChange={(e) => handleChange("seoTitle", e.target.value)}
                className="mt-1 w-full border rounded px-2 py-1 text-xs sm:text-sm"
                placeholder="Careers at DaySpring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">
                SEO description
              </label>
              <textarea
                rows={2}
                value={formState.seoDescription || ""}
                onChange={(e) => handleChange("seoDescription", e.target.value)}
                className="mt-1 w-full border rounded px-2 py-1 text-[11px] sm:text-xs"
                placeholder="Join the team building the most trusted marketplace for everyday essentials…"
              />
            </div>
          </div>
        </section>

        {/* Actions */}
        <section className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              if (data) {
                setFormState(data);
                setSaveMessage(null);
                setSaveError(null);
              }
            }}
            disabled={isSaving}
            className="px-3 py-1.5 border rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save settings"}
          </button>
        </section>
      </form>
    </div>
  );
};

export default AdminCareersConfig;