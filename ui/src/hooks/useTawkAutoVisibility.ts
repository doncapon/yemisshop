// src/hooks/useTawkAutoVisibility.ts
import { useEffect, type RefObject } from "react";

function hideTawkWidget() {
  const api = (window as any).Tawk_API;
  if (api && typeof api.hideWidget === "function") api.hideWidget();
}

function showTawkWidget() {
  const api = (window as any).Tawk_API;
  if (api && typeof api.showWidget === "function") api.showWidget();
}

/**
 * Keeps the Tawk.to bubble hidden while the page is scrolled through, and
 * reveals it once `sentinelRef` (e.g. pagination controls at the end of a
 * product grid) scrolls into view. Restores default visibility on unmount
 * so other pages aren't affected. No-ops entirely if Tawk hasn't loaded
 * (widget unconfigured), since hideTawkWidget/showTawkWidget check first.
 */
export default function useTawkAutoVisibility(sentinelRef: RefObject<Element | null>) {
  useEffect(() => {
    hideTawkWidget();

    const api = (window as any).Tawk_API;
    const previousOnLoad = api?.onLoad;
    if (api) {
      api.onLoad = function () {
        previousOnLoad?.();
        hideTawkWidget();
      };
    }

    const node = sentinelRef.current;
    if (!node) {
      return () => {
        showTawkWidget();
        if (api) api.onLoad = previousOnLoad;
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) showTawkWidget();
        else hideTawkWidget();
      },
      { threshold: 0 }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      showTawkWidget();
      if (api) api.onLoad = previousOnLoad;
    };
  }, [sentinelRef]);
}
