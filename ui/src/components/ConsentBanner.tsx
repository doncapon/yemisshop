import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { getConsent, setConsent } from "../utils/consent";

export default function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const c = getConsent();
    if (!c) setOpen(true);
  }, []);

  if (!open) return null;

  async function save(consent: { analytics: boolean; marketing: boolean }) {
    // local first (always)
    setConsent(consent);
    setOpen(false);

    // cookie-auth: try persist; ignore if not logged in / fails
    try {
      await api.post("/api/privacy/consent", consent, { withCredentials: true });
    } catch {
      // ok if it fails; local consent still applied
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      {/* Backdrop blur strip (subtle) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white/90 to-transparent" />

      {/* Sheet */}
      <div className="relative px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-screen-lg overflow-hidden rounded-2xl border bg-white/95 shadow-lg backdrop-blur">
          <div className="p-3 sm:p-4">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900">Cookies & privacy</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                  We use cookies for analytics and (optionally) marketing to improve your experience.
                  You can change this anytime in{" "}
                  <Link className="text-fuchsia-700 hover:underline" to="/privacy">
                    Data &amp; privacy
                  </Link>.
                </p>
              </div>

              {/* Close (optional but nice on mobile) */}
              <button
                type="button"
                onClick={() => save({ analytics: false, marketing: false })}
                className="shrink-0 rounded-full border bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                aria-label="Close and reject optional cookies"
                title="Close"
              >
                Close
              </button>
            </div>

            {/* Buttons */}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2">
              <button
                className="w-full rounded-xl border px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-black/5 active:scale-[0.99]"
                onClick={() => save({ analytics: false, marketing: false })}
              >
                Reject
              </button>

              <button
                className="w-full rounded-xl border px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-black/5 active:scale-[0.99]"
                onClick={() => save({ analytics: true, marketing: false })}
              >
                Accept analytics
              </button>

              <button
                className="w-full rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 active:scale-[0.99]"
                onClick={() => save({ analytics: true, marketing: true })}
              >
                Accept all
              </button>
            </div>

            {/* Tiny note row (optional) */}
            <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              Essential cookies are always on (needed for login, cart, and security).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
