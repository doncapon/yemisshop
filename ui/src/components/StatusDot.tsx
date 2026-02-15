// src/components/StatusDot.tsx
import React from "react";

function niceLabel(s: string) {
  return String(s || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function colorFor(status: string) {
  const s = String(status || "").toUpperCase();
  if (["PAID", "SUCCESS", "COMPLETED", "DELIVERED"].includes(s)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["FAILED", "CANCELLED", "CANCELED"].includes(s)) return "bg-rose-50 text-rose-700 border-rose-200";
  if (["HELD"].includes(s)) return "bg-zinc-50 text-zinc-700 border-zinc-200";
  if (["APPROVED"].includes(s)) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

export default function StatusDot({ label }: { label?: string | null }) {
  const raw = String(label || "—");
  const text = niceLabel(raw);

  return (
    <span
      className={[
        // ✅ critical: allow it to shrink + cap width on tiny screens
        "min-w-0 max-w-[120px] sm:max-w-none shrink",
        // ✅ smaller font on mobile
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-[10px] sm:text-[11px] font-semibold",
        // ✅ prevent long text from pushing layout
        "truncate",
        colorFor(raw),
      ].join(" ")}
      title={text}
    >
      {/* tiny dot */}
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      <span className="truncate">{text}</span>
    </span>
  );
}
