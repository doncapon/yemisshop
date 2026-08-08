// src/components/TawkToWidget.tsx
import { useEffect } from "react";

const TAWK_SCRIPT_ID = "tawk-to-embed-script";

/**
 * Loads the Tawk.to live-chat widget, entirely opt-in: does nothing until
 * VITE_TAWK_TO_WIDGET_ID is set (format: "PROPERTY_ID/WIDGET_ID", copied
 * directly from your Tawk.to dashboard's embed snippet). Leave it unset
 * and this component is a complete no-op — safe to ship either way.
 */
export default function TawkToWidget() {
  useEffect(() => {
    const widgetId = String(import.meta.env.VITE_TAWK_TO_WIDGET_ID ?? "").trim();
    if (!widgetId) return;
    if (document.getElementById(TAWK_SCRIPT_ID)) return;

    (window as any).Tawk_API = (window as any).Tawk_API || {};
    (window as any).Tawk_LoadStart = new Date();

    const script = document.createElement("script");
    script.id = TAWK_SCRIPT_ID;
    script.async = true;
    script.src = `https://embed.tawk.to/${widgetId}`;
    script.charset = "UTF-8";
    script.setAttribute("crossorigin", "*");

    document.body.appendChild(script);

    return () => {
      script.remove();
      document.getElementById(TAWK_SCRIPT_ID)?.remove();
    };
  }, []);

  return null;
}
