// src/pages/supplier/SupplierOnboardingDocuments.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    Clock,
    FileBadge2,
    FileText,
    IdCard,
    Landmark,
    ShieldCheck,
    UploadCloud,
    XCircle,
    Info,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";

type SupplierDocumentKind =
    | "BUSINESS_REGISTRATION_CERTIFICATE"
    | "GOVERNMENT_ID"
    | "PROOF_OF_ADDRESS"
    | "TAX_DOCUMENT"
    | "BANK_PROOF"
    | "OTHER";

type SupplierDocStatus = "PENDING" | "APPROVED" | "REJECTED";

type SupplierDocument = {
    id: string;
    supplierId: string;
    kind: SupplierDocumentKind;
    storageKey: string;
    originalFilename: string;
    mimeType?: string | null;
    size?: number | null;
    status?: SupplierDocStatus | null;
    note?: string | null;
    uploadedAt?: string | null;
    reviewedAt?: string | null;
};

type SupplierMe = {
    id: string;
    supplierId?: string;
    name?: string | null;
    businessName?: string | null;
    registrationType?: string | null;
    registrationCountryCode?: string | null;
    status?: string | null;
    kycStatus?: string | null;
};

type SaveState = "idle" | "uploading" | "saved" | "error";

type PendingUpload = {
    file: File | null;
    uploading: boolean;
    error: string | null;
};

type UploadedFileMeta = {
    storageKey: string;
    originalFilename?: string | null;
    mimeType?: string | null;
    size?: number | null;
};

type PersistedJourneyState = {
    contactVerified?: boolean;
    reachedBusiness?: boolean;
    reachedAddress?: boolean;
    reachedDocuments?: boolean;
    reachedDashboard?: boolean;
};

const BASE_DOC_LABELS: Record<SupplierDocumentKind, string> = {
    BUSINESS_REGISTRATION_CERTIFICATE: "Business registration certificate",
    GOVERNMENT_ID: "Government ID",
    PROOF_OF_ADDRESS: "Proof of address",
    TAX_DOCUMENT: "Tax document",
    BANK_PROOF: "Bank proof",
    OTHER: "Other document",
};

const REQUIRED_ALWAYS: SupplierDocumentKind[] = [
    "GOVERNMENT_ID",
    "PROOF_OF_ADDRESS",
];

function isBusinessRegistrationRequired(registrationType?: string | null) {
    return String(registrationType || "").toUpperCase() === "REGISTERED_BUSINESS";
}

function isNigeriaCountryCode(value?: string | null) {
    return String(value || "").trim().toUpperCase() === "NG";
}

function getDocLabel(
    kind: SupplierDocumentKind,
    opts: { isNigerianSeller: boolean }
) {
    if (kind === "GOVERNMENT_ID" && opts.isNigerianSeller) {
        return "NIN / Government ID";
    }

    if (kind === "BUSINESS_REGISTRATION_CERTIFICATE" && opts.isNigerianSeller) {
        return "CAC certificate / document showing RC number";
    }

    return BASE_DOC_LABELS[kind];
}

function getDocHelperText(
    kind: SupplierDocumentKind,
    opts: { isNigerianSeller: boolean }
) {
    if (kind === "GOVERNMENT_ID" && opts.isNigerianSeller) {
        return "Upload your NIN slip, National ID card, or another valid Nigerian government ID.";
    }

    if (kind === "BUSINESS_REGISTRATION_CERTIFICATE" && opts.isNigerianSeller) {
        return "Upload your CAC certificate or another business registration document that clearly shows the RC number.";
    }

    if (kind === "PROOF_OF_ADDRESS") {
        return "Upload a recent utility bill, bank statement, tenancy document, or another valid proof of address.";
    }

    return "Required for onboarding completion.";
}

function humanFileSize(size?: number | null) {
    if (!size || size <= 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let value = size;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function getLatestDoc(docs: SupplierDocument[], kind: SupplierDocumentKind) {
    return docs
        .filter((d) => d.kind === kind)
        .sort(
            (a, b) =>
                new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
        )[0];
}

function normalizeSupplier(raw: unknown): SupplierMe {
    const source = raw as {
        data?: Record<string, unknown>;
    } | null;

    const s = (source?.data ?? source ?? {}) as Record<string, unknown>;

    return {
        id: String(s.id ?? ""),
        supplierId:
            s.supplierId != null && String(s.supplierId).trim()
                ? String(s.supplierId)
                : undefined,
        name: s.name != null ? String(s.name) : null,
        businessName: s.businessName != null ? String(s.businessName) : null,
        registrationType:
            String(s.registrationType ?? "").trim() || null,
        registrationCountryCode:
            String(s.registrationCountryCode ?? "").trim().toUpperCase() || null,
        status: String(s.status ?? "").trim() || null,
        kycStatus: String(s.kycStatus ?? "").trim() || null,
    };
}

function normalizeDocumentsResponse(raw: unknown): SupplierDocument[] {
    const source = raw as
        | {
              data?: {
                  data?: SupplierDocument[];
                  documents?: SupplierDocument[];
              } | SupplierDocument[];
              documents?: SupplierDocument[];
          }
        | SupplierDocument[]
        | null;

    const candidates: unknown[] = [
        source && typeof source === "object" && "data" in source
            ? (source as { data?: unknown }).data &&
              typeof (source as { data?: unknown }).data === "object" &&
              (source as { data?: { data?: SupplierDocument[] } }).data?.data
            : undefined,
        source && typeof source === "object" && "data" in source
            ? (source as { data?: { documents?: SupplierDocument[] } }).data?.documents
            : undefined,
        source && typeof source === "object" && "data" in source
            ? (source as { data?: unknown }).data
            : undefined,
        source && typeof source === "object" && "documents" in source
            ? (source as { documents?: SupplierDocument[] }).documents
            : undefined,
        source,
    ];

    for (const item of candidates) {
        if (Array.isArray(item)) {
            return item as SupplierDocument[];
        }
    }

    return [];
}

function isSupplierApproved(supplier: SupplierMe | null) {
    const status = String(supplier?.status ?? "").trim().toUpperCase();
    const kycStatus = String(supplier?.kycStatus ?? "").trim().toUpperCase();

    const approvedStates = new Set([
        "APPROVED",
        "ACTIVE",
        "VERIFIED",
        "COMPLETED",
        "ENABLED",
    ]);

    return approvedStates.has(status) || approvedStates.has(kycStatus);
}

function statusPillClass(status?: string | null) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED" || s === "ACTIVE" || s === "VERIFIED" || s === "COMPLETED") {
        return "bg-emerald-100 text-emerald-700";
    }
    if (s === "REJECTED") return "bg-rose-100 text-rose-700";
    if (s === "PENDING") return "bg-amber-100 text-amber-700";
    return "bg-zinc-100 text-zinc-700";
}

function extractUploadedFileMeta(payload: unknown): UploadedFileMeta | null {
    const p = payload as
        | {
              data?: {
                  files?: Array<Record<string, unknown>>;
                  file?: Record<string, unknown>;
              } | Array<Record<string, unknown>>;
              files?: Array<Record<string, unknown>>;
              file?: Record<string, unknown>;
          }
        | Array<Record<string, unknown>>
        | null;

    const candidates: Array<Record<string, unknown> | null | undefined> = [
        p && typeof p === "object" && "data" in p && p.data && !Array.isArray(p.data)
            ? p.data.files?.[0]
            : null,
        p && typeof p === "object" && "data" in p && p.data && !Array.isArray(p.data)
            ? p.data.file
            : null,
        p && typeof p === "object" && "files" in p ? p.files?.[0] : null,
        p && typeof p === "object" && "file" in p ? p.file : null,
        p && typeof p === "object" && "data" in p && Array.isArray(p.data)
            ? p.data[0]
            : null,
        Array.isArray(p) ? p[0] : null,
    ];

    for (const candidate of candidates) {
        if (candidate?.storageKey) {
            return {
                storageKey: String(candidate.storageKey),
                originalFilename:
                    (candidate.originalFilename as string | undefined) ??
                    (candidate.filename as string | undefined) ??
                    (candidate.originalName as string | undefined) ??
                    null,
                mimeType:
                    (candidate.mimeType as string | undefined) ??
                    (candidate.mimetype as string | undefined) ??
                    null,
                size:
                    typeof candidate.size === "number"
                        ? candidate.size
                        : candidate.size != null
                          ? Number(candidate.size)
                          : null,
            };
        }
    }

    return null;
}

async function uploadWithFieldName(
    file: File,
    supplierFolder: string,
    fieldName: "file" | "files"
): Promise<UploadedFileMeta | null> {
    const form = new FormData();
    form.append(fieldName, file);
    form.append("folder", supplierFolder);

    const res = await api.post("/api/uploads", form, {
        withCredentials: true,
    });

    return extractUploadedFileMeta(res?.data);
}

function readJourneyState(key: string): PersistedJourneyState {
    if (!key || typeof window === "undefined") return {};
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        return parsed as PersistedJourneyState;
    } catch {
        return {};
    }
}

function writeJourneyState(key: string, patch: PersistedJourneyState) {
    if (!key || typeof window === "undefined") return;
    try {
        const current = readJourneyState(key);
        sessionStorage.setItem(
            key,
            JSON.stringify({
                ...current,
                ...patch,
            })
        );
    } catch {}
}

export default function SupplierOnboardingDocuments() {
    const nav = useNavigate();
    const location = useLocation();

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<SaveState>("idle");

    const [supplier, setSupplier] = useState<SupplierMe | null>(null);
    const [docs, setDocs] = useState<SupplierDocument[]>([]);

    const [pending, setPending] = useState<Record<SupplierDocumentKind, PendingUpload>>({
        BUSINESS_REGISTRATION_CERTIFICATE: { file: null, uploading: false, error: null },
        GOVERNMENT_ID: { file: null, uploading: false, error: null },
        PROOF_OF_ADDRESS: { file: null, uploading: false, error: null },
        TAX_DOCUMENT: { file: null, uploading: false, error: null },
        BANK_PROOF: { file: null, uploading: false, error: null },
        OTHER: { file: null, uploading: false, error: null },
    });

    const inputRefs = useRef<Record<SupplierDocumentKind, HTMLInputElement | null>>({
        BUSINESS_REGISTRATION_CERTIFICATE: null,
        GOVERNMENT_ID: null,
        PROOF_OF_ADDRESS: null,
        TAX_DOCUMENT: null,
        BANK_PROOF: null,
        OTHER: null,
    });

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        const silent = opts?.silent === true;

        try {
            if (!silent) setLoading(true);
            setErr(null);

            const [supplierRes, docsRes] = await Promise.all([
                api.get("/api/supplier/me", { withCredentials: true }),
                api.get("/api/supplier/documents", { withCredentials: true }),
            ]);

            const supplierData = normalizeSupplier(supplierRes.data);
            const docsData = normalizeDocumentsResponse(docsRes.data);

            setSupplier(supplierData);
            setDocs(docsData);
        } catch (e: unknown) {
            const errorObj = e as {
                response?: {
                    data?: {
                        error?: string;
                        message?: string;
                    };
                };
            };

            setErr(
                errorObj?.response?.data?.error ||
                    errorObj?.response?.data?.message ||
                    "Could not load supplier documents."
            );
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load, location.key]);

    const isNigerianSeller = useMemo(() => {
        return isNigeriaCountryCode(supplier?.registrationCountryCode);
    }, [supplier?.registrationCountryCode]);

    const requiredKinds = useMemo(() => {
        const base = [...REQUIRED_ALWAYS];
        if (isBusinessRegistrationRequired(supplier?.registrationType)) {
            base.unshift("BUSINESS_REGISTRATION_CERTIFICATE");
        }
        return base;
    }, [supplier?.registrationType]);

    const requiredDocStates = useMemo(() => {
        return requiredKinds.map((kind) => {
            const latest = getLatestDoc(docs, kind);
            return {
                kind,
                doc: latest,
                status: String(latest?.status || "").toUpperCase() || "MISSING",
            };
        });
    }, [docs, requiredKinds]);

    const progress = useMemo(() => {
        const items = requiredDocStates.map((item) => ({
            kind: item.kind,
            done: item.status === "APPROVED" || item.status === "PENDING",
            rejected: item.status === "REJECTED",
        }));

        const doneCount = items.filter((x) => x.done).length;
        const total = items.length || 1;
        const pct = Math.round((doneCount / total) * 100);

        return {
            items,
            doneCount,
            total,
            pct,
            docsComplete: doneCount === items.length,
            anyRejected: items.some((x) => x.rejected),
        };
    }, [requiredDocStates]);

    const hasPendingSelectedFiles = useMemo(() => {
        return Object.values(pending).some((p) => !!p.file);
    }, [pending]);

    const hasUploadingFiles = useMemo(() => {
        return Object.values(pending).some((p) => p.uploading);
    }, [pending]);

    const hasPendingSelectedRequiredFiles = useMemo(() => {
        return requiredKinds.some((kind) => !!pending[kind]?.file);
    }, [pending, requiredKinds]);

    const hasUploadingRequiredFiles = useMemo(() => {
        return requiredKinds.some((kind) => !!pending[kind]?.uploading);
    }, [pending, requiredKinds]);

    const hasUnsavedChanges = hasPendingSelectedFiles || hasUploadingFiles;

    const approvalReady = useMemo(() => {
        return progress.docsComplete;
    }, [progress.docsComplete]);

    const adminApproved = useMemo(() => {
        return isSupplierApproved(supplier);
    }, [supplier]);

    const canGoToSupplierHome = useMemo(() => {
        return progress.docsComplete && !hasUploadingRequiredFiles;
    }, [progress.docsComplete, hasUploadingRequiredFiles]);

    const canGoToDashboard = useMemo(() => {
        return progress.docsComplete && adminApproved && !hasUploadingRequiredFiles;
    }, [progress.docsComplete, adminApproved, hasUploadingRequiredFiles]);

    const currentStatus = String(supplier?.status || "").toUpperCase();
    const currentKycStatus = String(supplier?.kycStatus || "").toUpperCase();

    const needsResubmission = useMemo(() => {
        return progress.anyRejected || currentKycStatus === "REJECTED";
    }, [progress.anyRejected, currentKycStatus]);

    const isFullyActive = useMemo(() => {
        return currentStatus === "ACTIVE" || (adminApproved && progress.docsComplete);
    }, [currentStatus, adminApproved, progress.docsComplete]);

    const isAwaitingFinalApproval = useMemo(() => {
        return approvalReady && !isFullyActive && !needsResubmission;
    }, [approvalReady, isFullyActive, needsResubmission]);

    const isApprovalPending = useMemo(() => {
        return approvalReady && !adminApproved && !isFullyActive && !needsResubmission;
    }, [approvalReady, adminApproved, isFullyActive, needsResubmission]);

    const optionalDocs = useMemo(() => {
        return docs
            .filter((d) => d.kind === "OTHER")
            .sort(
                (a, b) =>
                    new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
            );
    }, [docs]);

    const journeyKey = useMemo(() => {
        const keyId = String(supplier?.supplierId || supplier?.id || "").trim();
        return keyId ? `supplier:verify-contact:journey:${keyId}` : "";
    }, [supplier?.id, supplier?.supplierId]);

    useEffect(() => {
        if (!journeyKey) return;

        const patch: PersistedJourneyState = {
            reachedDocuments: true,
        };

        if (progress.docsComplete) {
            patch.reachedDashboard = true;
        }

        writeJourneyState(journeyKey, patch);
    }, [journeyKey, progress.docsComplete]);

    const buildSupplierHomeState = useCallback(() => {
        return {
            fromOnboardingDocuments: true,
            documentsSubmitted: progress.docsComplete,
            docsComplete: progress.docsComplete,
            reachedDocuments: true,
            reachedDashboard: progress.docsComplete,
            supplierStatus: supplier?.status || "",
            kycStatus: supplier?.kycStatus || "",
        };
    }, [progress.docsComplete, supplier?.kycStatus, supplier?.status]);

    const onPickFile =
        (kind: SupplierDocumentKind) =>
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0] || null;

            setPending((s) => ({
                ...s,
                [kind]: {
                    ...s[kind],
                    file,
                    uploading: false,
                    error: file && file.size <= 0 ? "The selected file is empty." : null,
                },
            }));

            setSaveState("idle");
            setErr(null);
        };

    const clearPendingFile = useCallback((kind: SupplierDocumentKind) => {
        setPending((s) => ({
            ...s,
            [kind]: {
                ...s[kind],
                file: null,
                uploading: false,
                error: null,
            },
        }));

        const input = inputRefs.current[kind];
        if (input) input.value = "";
    }, []);

    const uploadDoc = async (kind: SupplierDocumentKind) => {
        const picked = pending[kind]?.file;

        if (!picked) {
            setPending((s) => ({
                ...s,
                [kind]: { ...s[kind], error: "Please choose a file first." },
            }));
            return;
        }

        if (picked.size <= 0) {
            setPending((s) => ({
                ...s,
                [kind]: { ...s[kind], error: "The selected file is empty." },
            }));
            return;
        }

        try {
            setSaveState("uploading");
            setErr(null);

            setPending((s) => ({
                ...s,
                [kind]: { ...s[kind], uploading: true, error: null },
            }));

            const supplierId = supplier?.supplierId || supplier?.id || "unknown";
            const folder = `supplier-docs/${supplierId}`;

            let uploaded: UploadedFileMeta | null = null;

            try {
                uploaded = await uploadWithFieldName(picked, folder, "file");
            } catch {
                uploaded = null;
            }

            if (!uploaded?.storageKey) {
                uploaded = await uploadWithFieldName(picked, folder, "files");
            }

            if (!uploaded?.storageKey) {
                throw new Error(
                    "Upload succeeded but no storage key was returned by /api/uploads."
                );
            }

            await api.post(
                "/api/supplier/documents",
                {
                    kind,
                    storageKey: uploaded.storageKey,
                    originalFilename: uploaded.originalFilename || picked.name,
                    mimeType: uploaded.mimeType || picked.type || null,
                    size: uploaded.size ?? picked.size ?? null,
                },
                { withCredentials: true }
            );

            clearPendingFile(kind);
            setSaveState("saved");
            await load({ silent: true });
        } catch (e: unknown) {
            const errorObj = e as {
                message?: string;
                response?: {
                    data?: {
                        error?: string;
                        message?: string;
                    };
                };
            };

            const msg =
                errorObj?.response?.data?.error ||
                errorObj?.response?.data?.message ||
                errorObj?.message ||
                "Could not upload document.";

            setPending((s) => ({
                ...s,
                [kind]: { ...s[kind], uploading: false, error: msg },
            }));
            setSaveState("error");
            setErr(msg);
        }
    };

    const goBack = () => nav("/supplier/onboarding/address");
    const goToAddressDetails = () => nav("/supplier/onboarding/address");

    const goToSupplierHome = () =>
        nav("/supplier", {
            state: buildSupplierHomeState(),
        });

    const goToDashboard = () =>
        nav("/supplier", {
            state: buildSupplierHomeState(),
        });

    const goToNextStep = () => {
        if (canGoToDashboard) {
            nav("/supplier", { state: buildSupplierHomeState() });
            return;
        }

        if (canGoToSupplierHome) {
            nav("/supplier", { state: buildSupplierHomeState() });
        }
    };

    const goToSupplierHomeAfterDocs = () => {
        if (hasUploadingRequiredFiles) {
            setErr("A required document is still uploading. Please wait for the upload to finish before continuing.");
            return;
        }

        if (!progress.docsComplete) {
            setErr("Please upload all required documents before continuing.");
            return;
        }

        if (journeyKey) {
            writeJourneyState(journeyKey, {
                reachedDocuments: true,
                reachedDashboard: true,
            });
        }

        nav("/supplier", {
            state: buildSupplierHomeState(),
        });
    };

    const stepBase =
        "flex w-full items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm transition";
    const stepDone = "border-emerald-200 bg-emerald-50 text-emerald-700";
    const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
    const stepPending = "border-amber-200 bg-amber-50 text-amber-700";
    const stepRejected = "border-rose-200 bg-rose-50 text-rose-700";
    const stepLocked = "border-zinc-100 bg-zinc-50 text-zinc-400";
    const stepClickable = "cursor-pointer hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800";

    const label = "block text-sm font-semibold text-slate-800 mb-1.5";
    const input =
        "w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] md:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm file:mr-3 file:rounded-xl file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700";
    const card =
        "rounded-[28px] border border-white/70 bg-white/95 backdrop-blur shadow-[0_16px_50px_rgba(15,23,42,0.08)] p-4 sm:p-6 md:p-8";
    const panel = "rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm";
    const primaryBtn =
        "inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60 disabled:cursor-not-allowed";
    const secondaryBtn =
        "inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-60 disabled:cursor-not-allowed";

    const docIcon = (kind: SupplierDocumentKind) => {
        if (kind === "GOVERNMENT_ID") return <IdCard className="h-5 w-5 text-zinc-700" />;
        if (kind === "PROOF_OF_ADDRESS") return <Landmark className="h-5 w-5 text-zinc-700" />;
        if (kind === "BUSINESS_REGISTRATION_CERTIFICATE") {
            return <FileBadge2 className="h-5 w-5 text-zinc-700" />;
        }
        return <FileText className="h-5 w-5 text-zinc-700" />;
    };

    const stepCircleClass = (active = false) =>
        `inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
            active ? "border-current" : "border-current/80"
        }`;

    const canGoPrevTab = true;
    const canGoNextTab = canGoToSupplierHome || canGoToDashboard;

    const renderStepHeader = () => {
        const finalApprovalStepClass = needsResubmission
            ? stepRejected
            : canGoToDashboard
              ? stepDone
              : isApprovalPending || isAwaitingFinalApproval || canGoToSupplierHome
                ? stepPending
                : stepLocked;

        const finalStepLabel = canGoToDashboard ? "Dashboard access" : "Final approval";

        return (
            <div className="space-y-4">
                <div className="text-center">
                    <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">
                        {needsResubmission
                            ? "Update your supplier documents"
                            : isAwaitingFinalApproval
                              ? "Your documents are under review"
                              : "Upload your supplier documents"}
                    </h1>
                    <p className="mt-2 text-sm text-zinc-600">
                        {needsResubmission
                            ? "One or more required documents need to be replaced before onboarding can continue."
                            : isAwaitingFinalApproval
                              ? "Your required documents have been submitted. Your account may still be under review, but supplier home should now be available."
                              : "Complete document upload to finish onboarding and unlock supplier access."}
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                    <div className={`${stepBase} ${stepDone}`}>
                        <span className={stepCircleClass()}>1</span>
                        <span>Register</span>
                    </div>

                    <div className={`${stepBase} ${stepDone}`}>
                        <span className={stepCircleClass()}>2</span>
                        <span>Verify email / phone</span>
                    </div>

                    <div className={`${stepBase} ${stepDone}`}>
                        <span className={stepCircleClass()}>3</span>
                        <span>Business details</span>
                    </div>

                    <button
                        type="button"
                        onClick={canGoPrevTab ? goToAddressDetails : undefined}
                        disabled={!canGoPrevTab}
                        className={`${stepBase} ${stepDone} ${
                            canGoPrevTab ? stepClickable : ""
                        } text-left`}
                    >
                        <span className={stepCircleClass()}>4</span>
                        <span>Address details</span>
                    </button>

                    <div className={`${stepBase} ${stepActive}`}>
                        <span className={stepCircleClass(true)}>5</span>
                        <span>Documents</span>
                    </div>

                    <button
                        type="button"
                        onClick={canGoNextTab ? goToNextStep : undefined}
                        disabled={!canGoNextTab}
                        className={`${stepBase} ${finalApprovalStepClass} ${
                            canGoNextTab ? stepClickable : ""
                        } text-left`}
                    >
                        <span className={stepCircleClass()}>6</span>
                        <span>{finalStepLabel}</span>
                    </button>
                </div>
            </div>
        );
    };

    return (
        <SiteLayout>
            <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
                <div className="px-3 py-6 sm:px-4 sm:py-10">
                    <div className="mx-auto w-full max-w-6xl space-y-6">
                        {renderStepHeader()}

                        {err && (
                            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                {err}
                            </div>
                        )}

                        {hasUploadingFiles && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                A file upload is still in progress. Please wait for it to finish before continuing.
                            </div>
                        )}

                        {!hasUploadingFiles && hasPendingSelectedRequiredFiles && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                You have selected required files that are not uploaded yet. They will not count until you click upload.
                            </div>
                        )}

                        {!hasUploadingFiles && !hasPendingSelectedRequiredFiles && hasUnsavedChanges && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                                You have some extra selected files that are not uploaded yet. You can still continue to supplier home if your required documents are complete.
                            </div>
                        )}

                        {!loading && isAwaitingFinalApproval && !needsResubmission && (
                            <div className={`${card} max-w-3xl mx-auto`}>
                                <div className="flex flex-col items-center text-center">
                                    <div className="rounded-full bg-emerald-100 p-4">
                                        <ShieldCheck className="h-8 w-8 text-emerald-700" />
                                    </div>

                                    <h2 className="mt-5 text-2xl font-semibold text-zinc-900">
                                        Documents submitted
                                    </h2>

                                    <p className="mt-3 max-w-2xl text-sm text-zinc-600">
                                        All required documents have been submitted. Your supplier account may still be under admin review, but supplier home should already be available. Full dashboard access will unlock after approval.
                                    </p>

                                    <div className="mt-6 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
                                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                                            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                                Documents
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-zinc-900">
                                                {progress.doneCount} of {progress.total} complete
                                            </div>
                                        </div>

                                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                                            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                                KYC status
                                            </div>
                                            <div className="mt-2">
                                                <span
                                                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(
                                                        supplier?.kycStatus
                                                    )}`}
                                                >
                                                    {supplier?.kycStatus || "—"}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                                            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                                Account status
                                            </div>
                                            <div className="mt-2">
                                                <span
                                                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(
                                                        supplier?.status
                                                    )}`}
                                                >
                                                    {supplier?.status || "—"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                        Full dashboard access will unlock once final approval is completed.
                                    </div>

                                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                                        <button type="button" onClick={() => void load()} className={secondaryBtn}>
                                            Refresh status
                                        </button>

                                        <button
                                            type="button"
                                            onClick={goToSupplierHomeAfterDocs}
                                            className={primaryBtn}
                                        >
                                            Go to supplier home
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {!loading && !isAwaitingFinalApproval && (
                            <div className={`${card} space-y-5`}>
                                {approvalReady && !adminApproved && !needsResubmission && (
                                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800">
                                        <div>
                                            All required documents have been submitted. You can now go to your supplier home while your profile is under review. Full dashboard access will be enabled after admin approval.
                                        </div>

                                        <div className="mt-3">
                                            <button
                                                type="button"
                                                onClick={goToSupplierHomeAfterDocs}
                                                className={secondaryBtn}
                                            >
                                                Go to supplier home
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {needsResubmission && (
                                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                                        <div className="flex items-start gap-2">
                                            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                            <div>
                                                One or more required documents were rejected. Please replace the affected file(s) below and upload again.
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                                    <div className="space-y-4 xl:col-span-2">
                                        {requiredKinds.map((kind) => {
                                            const existing = getLatestDoc(docs, kind);
                                            const pendingState = pending[kind];
                                            const labelText = getDocLabel(kind, { isNigerianSeller });
                                            const helperText = getDocHelperText(kind, { isNigerianSeller });
                                            const isApprovedRequiredDoc =
                                                !!existing && existing.status === "APPROVED";

                                            return (
                                                <div key={kind} className={panel}>
                                                    <div className="mb-4 flex items-start gap-3">
                                                        <div className="rounded-xl bg-zinc-100 p-3">{docIcon(kind)}</div>

                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div>
                                                                    <h2 className="text-base font-semibold text-zinc-900">
                                                                        {labelText}
                                                                    </h2>
                                                                    <p className="mt-1 text-sm text-zinc-600">{helperText}</p>
                                                                </div>

                                                                <div
                                                                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                                                        existing?.status === "APPROVED"
                                                                            ? "bg-emerald-100 text-emerald-700"
                                                                            : existing?.status === "PENDING"
                                                                              ? "bg-amber-100 text-amber-700"
                                                                              : existing?.status === "REJECTED"
                                                                                ? "bg-rose-100 text-rose-700"
                                                                                : "bg-zinc-100 text-zinc-700"
                                                                    }`}
                                                                >
                                                                    {existing?.status || "Not uploaded"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {existing && (
                                                        <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                                            <div className="flex flex-col gap-1 text-sm text-zinc-700">
                                                                <span className="font-medium text-zinc-900">
                                                                    {existing.originalFilename}
                                                                </span>
                                                                <span>Size: {humanFileSize(existing.size)}</span>
                                                                <span>
                                                                    Uploaded:{" "}
                                                                    {existing.uploadedAt
                                                                        ? new Date(existing.uploadedAt).toLocaleString()
                                                                        : "—"}
                                                                </span>
                                                                {existing.note ? (
                                                                    <span className="text-rose-700">Note: {existing.note}</span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {isApprovedRequiredDoc && (
                                                        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800">
                                                            <div className="flex items-start gap-2">
                                                                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                                                                <div>
                                                                    Uploading a replacement for this required document will submit the new file for admin review. It should not be treated as immediately approved.
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className={label}>Choose file</label>
                                                            <input
                                                                ref={(el) => {
                                                                    inputRefs.current[kind] = el;
                                                                }}
                                                                type="file"
                                                                onClick={(e) => {
                                                                    (e.currentTarget as HTMLInputElement).value = "";
                                                                }}
                                                                onChange={onPickFile(kind)}
                                                                className={input}
                                                                accept=".pdf,.png,.jpg,.jpeg,.webp"
                                                            />
                                                            {pendingState?.file && (
                                                                <div className="mt-2 text-xs text-zinc-600">
                                                                    Selected: {pendingState.file.name} ({humanFileSize(pendingState.file.size)})
                                                                </div>
                                                            )}
                                                        </div>

                                                        {pendingState?.error && (
                                                            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                                                {pendingState.error}
                                                            </div>
                                                        )}

                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => void uploadDoc(kind)}
                                                                disabled={!pendingState?.file || pendingState?.uploading}
                                                                className={primaryBtn}
                                                            >
                                                                <UploadCloud className="mr-2 h-4 w-4" />
                                                                {pendingState?.uploading
                                                                    ? "Uploading…"
                                                                    : existing
                                                                      ? "Replace file"
                                                                      : "Upload file"}
                                                            </button>

                                                            {pendingState?.file && !pendingState?.uploading && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => clearPendingFile(kind)}
                                                                    className={secondaryBtn}
                                                                >
                                                                    Clear
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <div className={panel}>
                                            <div className="mb-4 flex items-start gap-3">
                                                <div className="rounded-xl bg-zinc-100 p-3">
                                                    <FileText className="h-5 w-5 text-zinc-700" />
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <h2 className="text-base font-semibold text-zinc-900">
                                                                Optional documents
                                                            </h2>
                                                            <p className="mt-1 text-sm text-zinc-600">
                                                                Add any extra supporting files if needed.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {optionalDocs.length > 0 && (
                                                <div className="mb-4 space-y-3">
                                                    {optionalDocs.map((doc) => (
                                                        <div
                                                            key={doc.id}
                                                            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3"
                                                        >
                                                            <div className="flex flex-col gap-1 text-sm text-zinc-700">
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <span className="font-medium text-zinc-900">
                                                                        {doc.originalFilename}
                                                                    </span>

                                                                    <span
                                                                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                                                            doc.status === "APPROVED"
                                                                                ? "bg-emerald-100 text-emerald-700"
                                                                                : doc.status === "PENDING"
                                                                                  ? "bg-amber-100 text-amber-700"
                                                                                  : doc.status === "REJECTED"
                                                                                    ? "bg-rose-100 text-rose-700"
                                                                                    : "bg-zinc-100 text-zinc-700"
                                                                        }`}
                                                                    >
                                                                        {doc.status || "Uploaded"}
                                                                    </span>
                                                                </div>

                                                                <span>Size: {humanFileSize(doc.size)}</span>
                                                                <span>
                                                                    Uploaded:{" "}
                                                                    {doc.uploadedAt
                                                                        ? new Date(doc.uploadedAt).toLocaleString()
                                                                        : "—"}
                                                                </span>

                                                                {doc.note ? (
                                                                    <span className="text-rose-700">Note: {doc.note}</span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div>
                                                <label className={label}>Upload other document</label>
                                                <input
                                                    ref={(el) => {
                                                        inputRefs.current.OTHER = el;
                                                    }}
                                                    type="file"
                                                    onClick={(e) => {
                                                        (e.currentTarget as HTMLInputElement).value = "";
                                                    }}
                                                    onChange={onPickFile("OTHER")}
                                                    className={input}
                                                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                                                />
                                                {pending.OTHER.file && (
                                                    <div className="mt-2 text-xs text-zinc-600">
                                                        Selected: {pending.OTHER.file.name} ({humanFileSize(pending.OTHER.file.size)})
                                                    </div>
                                                )}
                                            </div>

                                            {pending.OTHER.error && (
                                                <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                                    {pending.OTHER.error}
                                                </div>
                                            )}

                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void uploadDoc("OTHER")}
                                                    disabled={!pending.OTHER.file || pending.OTHER.uploading}
                                                    className={secondaryBtn}
                                                >
                                                    {pending.OTHER.uploading ? "Uploading…" : "Upload optional file"}
                                                </button>

                                                {pending.OTHER.file && !pending.OTHER.uploading && (
                                                    <button
                                                        type="button"
                                                        onClick={() => clearPendingFile("OTHER")}
                                                        className={secondaryBtn}
                                                    >
                                                        Clear
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className={panel}>
                                            <h2 className="text-base font-semibold text-zinc-900">
                                                Document progress
                                            </h2>
                                            <p className="mt-1 text-sm text-zinc-600">
                                                Required supplier documents must be uploaded before supplier home can be unlocked.
                                            </p>

                                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-200">
                                                <div
                                                    className="h-full rounded-full bg-zinc-900 transition-all"
                                                    style={{ width: `${progress.pct}%` }}
                                                />
                                            </div>

                                            <p className="mt-2 text-sm text-zinc-700">
                                                {progress.doneCount} of {progress.total} required documents completed
                                            </p>

                                            <div className="mt-4 space-y-2">
                                                {requiredDocStates.map((item) => (
                                                    <div
                                                        key={item.kind}
                                                        className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2"
                                                    >
                                                        <span className="text-sm text-zinc-700">
                                                            {getDocLabel(item.kind, { isNigerianSeller })}
                                                        </span>
                                                        <span
                                                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                                                item.status === "APPROVED"
                                                                    ? "bg-emerald-100 text-emerald-700"
                                                                    : item.status === "REJECTED"
                                                                      ? "bg-rose-100 text-rose-700"
                                                                      : item.status === "PENDING"
                                                                        ? "bg-amber-100 text-amber-700"
                                                                        : "bg-zinc-100 text-zinc-700"
                                                            }`}
                                                        >
                                                            {item.status === "MISSING" ? "Pending" : item.status}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className={panel}>
                                            <h3 className="text-sm font-semibold text-zinc-900">
                                                Current supplier status
                                            </h3>
                                            <div className="mt-3 space-y-2 text-sm text-zinc-700">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span>Supplier status</span>
                                                    <span
                                                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(
                                                            supplier?.status
                                                        )}`}
                                                    >
                                                        {supplier?.status || "—"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    <span>KYC status</span>
                                                    <span
                                                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(
                                                            supplier?.kycStatus
                                                        )}`}
                                                    >
                                                        {supplier?.kycStatus || "—"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    <span>Registration type</span>
                                                    <span className="font-medium text-right break-words">
                                                        {supplier?.registrationType || "—"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className={panel}>
                                            <h3 className="text-sm font-semibold text-zinc-900">
                                                Dashboard access
                                            </h3>
                                            <p className="mt-1 text-sm text-zinc-600">
                                                Supplier home is available once required documents are submitted. Full dashboard access is enabled after admin approval.
                                            </p>

                                            <button
                                                type="button"
                                                onClick={goToSupplierHomeAfterDocs}
                                                disabled={!canGoToSupplierHome}
                                                className={`${secondaryBtn} mt-4 w-full`}
                                            >
                                                Go to supplier home
                                            </button>

                                            <button
                                                type="button"
                                                onClick={goToDashboard}
                                                disabled={!canGoToDashboard}
                                                className={`${primaryBtn} mt-3 w-full`}
                                            >
                                                Go to dashboard
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <button type="button" onClick={goBack} className={secondaryBtn}>
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Back
                                    </button>

                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void load()}
                                            disabled={loading || saveState === "uploading"}
                                            className={secondaryBtn}
                                        >
                                            Refresh
                                        </button>

                                        <button
                                            type="button"
                                            onClick={goToSupplierHomeAfterDocs}
                                            disabled={!canGoToSupplierHome}
                                            className={primaryBtn}
                                        >
                                            Go to supplier home
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {loading && (
                            <div className="text-center text-sm text-zinc-500">
                                Loading document details…
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </SiteLayout>
    );
}