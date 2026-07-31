// src/hooks/useTawkAutoVisibility.ts
import { useEffect, type RefObject } from "react";

function isTawkReady() {
  const api = (window as any).Tawk_API;
  return !!(api && typeof api.hideWidget === "function" && typeof api.showWidget === "function");
}

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
 * reveals it once `sentinelRef` (e.g. the site Footer) scrolls into view.
 * Polls for Tawk's readiness rather than relying on Tawk_API.onLoad, since
 * the widget script may swap in a new Tawk_API object once it finishes
 * loading, silently dropping any callback attached to the earlier stub.
 * Restores default visibility on unmount so other pages aren't affected.
 *
 * Pass `enabled={false}` (e.g. on the Catalog/homepage) to opt a page out
 * of the hide-until-footer behavior — the widget stays shown there instead,
 * including forcing it visible if a prior page had left it hidden.
 */
export default function useTawkAutoVisibility(
  sentinelRef: RefObject<Element | null>,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) {
      showTawkWidget();
      const pollId = window.setInterval(() => {
        if (isTawkReady()) {
          showTawkWidget();
          window.clearInterval(pollId);
        }
      }, 200);
      return () => window.clearInterval(pollId);
    }

    let desiredVisible = false;

    const applyVisibility = () => {
      if (!isTawkReady()) return;
      if (desiredVisible) showTawkWidget();
      else hideTawkWidget();
    };

    const pollId = window.setInterval(() => {
      if (isTawkReady()) {
        applyVisibility();
        window.clearInterval(pollId);
      }
    }, 200);

    const node = sentinelRef.current;
    let observer: IntersectionObserver | null = null;
    if (node) {
      observer = new IntersectionObserver(
        ([entry]) => {
          desiredVisible = entry.isIntersecting;
          applyVisibility();
        },
        { threshold: 0 }
      );
      observer.observe(node);
    }

    return () => {
      window.clearInterval(pollId);
      observer?.disconnect();
      showTawkWidget();
    };
  }, [sentinelRef, enabled]);
}
