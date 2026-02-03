import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuthStore } from "../store/auth";
import { getConsent, setConsent } from "../utils/consent";

export default function ConsentBanner() {
  const token = useAuthStore((s: any) => s.token);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const c = getConsent();
    if (!c) setOpen(true);
  }, []);

  if (!open) return null;

  async function save(consent: { analytics: boolean; marketing: boolean }) {
    setConsent(consent);
    setOpen(false);

    // if logged in, persist server-side too
    if (token) {
      try {
        await api.post(
          "/api/privacy/consent",
          consent,
        );
      } catch {
        // ok if it fails; local consent still applied
      }
    }
  }

  return (
    <div className="fixed bottom-3 left-3 right-3 z-50">
      <div className="mx-auto max-w-screen-lg rounded-2xl border bg-white shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
          <div className="text-sm text-zinc-700">
            We use cookies for analytics and (optionally) marketing to improve your experience.
            You can change this anytime in{" "}
            <Link className="text-fuchsia-700 hover:underline" to="/privacy">
              Data & privacy
            </Link>.
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="rounded-full border px-4 py-2 text-sm hover:bg-black/5"
              onClick={() => save({ analytics: true, marketing: false })}
            >
              Accept analytics
            </button>
            <button
              className="rounded-full border px-4 py-2 text-sm hover:bg-black/5"
              onClick={() => save({ analytics: true, marketing: true })}
            >
              Accept all
            </button>
            <button
              className="rounded-full border px-4 py-2 text-sm hover:bg-black/5"
              onClick={() => save({ analytics: false, marketing: false })}
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
