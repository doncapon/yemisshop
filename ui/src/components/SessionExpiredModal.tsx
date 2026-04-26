import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { performLogout } from "../utils/logout";

export default function SessionExpiredModal() {
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const navigate = useNavigate();

  // Catch 401s fired by the axios interceptor in client.ts.
  // Only trigger the modal when a user is actually logged in — guests
  // naturally get 401s from /api/auth/me during bootstrap.
  useEffect(() => {
    const handler = () => {
      const { user, markSessionExpired } = useAuthStore.getState();
      if (user) markSessionExpired();
    };
    window.addEventListener("auth:session-expired", handler);
    return () => window.removeEventListener("auth:session-expired", handler);
  }, []);

  if (!sessionExpired) return null;

  const handleSignIn = () => {
    void performLogout("/login", navigate);
  };

  const handleDismiss = () => {
    useAuthStore.getState().clear();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl text-center">
        {/* Lock icon */}
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7 text-amber-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2
          id="session-expired-title"
          className="text-lg font-semibold text-zinc-900"
        >
          Session ended
        </h2>
        <p className="mt-2 mb-6 text-sm text-zinc-500 leading-relaxed">
          For your security, you've been signed out due to inactivity. Please
          sign in again to continue.
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={handleSignIn}
            className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 focus:outline-none focus:ring-4 focus:ring-zinc-300"
          >
            Sign in again
          </button>
          <button
            onClick={handleDismiss}
            className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-600 transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-200"
          >
            Continue browsing
          </button>
        </div>
      </div>
    </div>
  );
}
