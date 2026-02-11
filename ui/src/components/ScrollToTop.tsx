// src/components/ScrollToTop.tsx
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    const state = (location.state ?? {}) as { preserveScroll?: boolean; scrollToId?: string };

    // ✅ explicit exception: keep current scroll
    if (state.preserveScroll) return;

    const targetId =
      state.scrollToId ||
      (location.hash ? decodeURIComponent(location.hash.slice(1)) : "");

    requestAnimationFrame(() => {
      if (targetId) {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: "auto", block: "start" });
          return;
        }
        // if id not found, fall back to top
      }

      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [location.key]); // key changes on every navigation

  return null;
}
