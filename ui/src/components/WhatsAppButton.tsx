// src/components/WhatsAppButton.tsx

/**
 * Floating "chat on WhatsApp" button, entirely opt-in: does nothing until
 * VITE_WHATSAPP_NUMBER is set (digits only, with country code, e.g.
 * "2348012345678" — no "+", spaces, or leading zeros after the country
 * code). Leave it unset and this component is a complete no-op — safe to
 * ship either way.
 *
 * Positioned bottom-left so it never overlaps the Tawk.to bubble, which
 * defaults to bottom-right.
 */
export default function WhatsAppButton() {
  const rawNumber = String(import.meta.env.VITE_WHATSAPP_NUMBER ?? "").trim();
  const number = rawNumber.replace(/[^\d]/g, "");
  if (!number) return null;

  // Note: an unset Docker build ARG becomes an empty string, not undefined,
  // so this must fall back on falsy-ness (||), not nullish-ness (??).
  const message = String(
    import.meta.env.VITE_WHATSAPP_MESSAGE ||
      "Hi! I have a question about DaySpring House."
  ).trim();

  const href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      title="Chat with us on WhatsApp"
      className="fixed bottom-5 left-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition hover:scale-105 hover:bg-[#20bd5a] focus:outline-none focus:ring-4 focus:ring-[#25D366]/30"
    >
      <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden="true">
        <path d="M16.001 3C9.373 3 4 8.373 4 15c0 2.379.694 4.6 1.885 6.463L4 29l7.727-1.85A11.94 11.94 0 0016 27c6.627 0 12-5.373 12-12S22.628 3 16.001 3zm0 21.75c-1.914 0-3.7-.55-5.207-1.5l-.373-.223-4.585 1.098 1.13-4.47-.244-.386A9.71 9.71 0 016.25 15c0-5.376 4.375-9.75 9.751-9.75S25.75 9.624 25.75 15 21.377 24.75 16.001 24.75z" />
        <path d="M21.61 17.86c-.303-.152-1.792-.885-2.07-.986-.278-.101-.48-.152-.682.152-.202.303-.783.986-.96 1.188-.177.202-.353.227-.656.076-.303-.152-1.278-.471-2.435-1.503-.9-.803-1.508-1.795-1.685-2.098-.177-.303-.019-.467.133-.618.137-.136.303-.353.454-.53.152-.177.202-.303.303-.505.101-.202.05-.379-.025-.53-.076-.152-.682-1.645-.934-2.253-.246-.591-.497-.511-.682-.52l-.581-.01c-.202 0-.53.076-.808.379-.278.303-1.06 1.036-1.06 2.528s1.086 2.933 1.237 3.135c.152.202 2.137 3.263 5.178 4.575.724.313 1.288.5 1.728.64.726.231 1.386.198 1.908.12.582-.087 1.792-.732 2.045-1.44.253-.708.253-1.315.177-1.44-.076-.126-.278-.202-.581-.354z" />
      </svg>
    </a>
  );
}
