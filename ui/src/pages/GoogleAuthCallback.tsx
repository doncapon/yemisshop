import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { mergeGuestCartIntoUserCart, useAuthStore } from "../store/auth";
import SiteLayout from "../layouts/SiteLayout";

function pickProfile(raw: any) {
  return raw?.data?.user ?? raw?.data?.data ?? raw?.data ?? raw?.user ?? raw ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in.",
  token_exchange_failed: "Could not complete sign-in with Google. Please try again.",
  userinfo_failed: "Could not retrieve your Google account details. Please try again.",
  missing_code: "Sign-in was incomplete. Please try again.",
};

export default function GoogleAuthCallback() {
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const setNeedsVerification = useAuthStore((s) => s.setNeedsVerification);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const error = searchParams.get("error");
    if (error) {
      setErrorMsg(ERROR_MESSAGES[error] ?? "Google sign-in failed. Please try again.");
      return;
    }

    const returnTo = searchParams.get("returnTo") || "/";
    const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";

    async function hydrate() {
      try {
        const res = await api.get("/api/auth/me", { withCredentials: true });
        const raw = pickProfile(res.data);
        if (!raw?.id) throw new Error("no profile");

        setUser(raw);
        setNeedsVerification(false);

        try {
          mergeGuestCartIntoUserCart(String(raw.id));
        } catch {}

        queueMicrotask(() => window.dispatchEvent(new Event("cart:updated")));

        nav(safe, { replace: true });
      } catch {
        setErrorMsg("Sign-in succeeded but we couldn't load your profile. Please log in manually.");
      }
    }

    hydrate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (errorMsg) {
    return (
      <SiteLayout>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-12">
          <div className="w-full max-w-sm rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
            <p className="text-sm font-medium text-rose-700">{errorMsg}</p>
            <a
              href="/login"
              className="mt-4 inline-block rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700"
            >
              Back to login
            </a>
          </div>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-fuchsia-600 border-t-transparent" />
        <p className="text-sm text-zinc-600">Signing you in with Google…</p>
      </div>
    </SiteLayout>
  );
}
