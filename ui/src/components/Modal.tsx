// src/components/Modal.tsx
import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ModalSize = "sm" | "md" | "lg";

function sizeClass(size: ModalSize | undefined) {
  if (size === "sm") return "max-w-md";
  if (size === "lg") return "max-w-3xl";
  return "max-w-xl";
}

export type ModalProps = {
  isOpen: boolean;

  title?: React.ReactNode;
  message?: React.ReactNode;

  /** ✅ NEW: actions/footer area */
  footer?: React.ReactNode;

  /** append a default Close button even when footer exists */
  showCloseInFooter?: boolean;

  /** hide the top-right X */
  hideX?: boolean;

  /** label for the Close button */
  closeText?: string;

  /** block closing by clicking backdrop */
  disableOverlayClose?: boolean;

  /** max width */
  size?: ModalSize;

  /** close handler (X, backdrop, Close button) */
  onClose: () => void;
};

const Modal: React.FC<ModalProps> = ({
  isOpen,
  title = "Notice",
  message,
  footer,
  showCloseInFooter = false,
  hideX = false,
  closeText = "Close",
  disableOverlayClose = false,
  onClose,
}) => {
  if (!isOpen) return null;

  const node = document.getElementById("modal-root") ?? document.body;

  const content = (
    // inside ModalProvider render when modal.open === true

    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="min-h-full px-4 py-6 flex items-center justify-center"
        onMouseDown={(e) => {
          // overlay click closes (only if allowed)
          if (!disableOverlayClose && e.target === e.currentTarget) onClose();
        }}
      >
        <div className="absolute inset-0 bg-black/40" />

        <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-4 py-3 border-b flex items-start justify-between gap-3 shrink-0">
            <div className="text-sm font-semibold">{title}</div>

            {!hideX && (
              <button
                className="text-xs text-ink-soft px-2 py-1 rounded-lg hover:bg-black/5"
                onClick={onClose}
                type="button"
              >
                Close
              </button>
            )}
          </div>

          {/* Body (SCROLLS) */}
          <div className="px-4 py-4 overflow-y-auto">
            {message}
          </div>

          {/* Footer (always visible) */}
          {(footer || showCloseInFooter) && (
            <div className="px-4 py-3 border-t bg-white shrink-0">
              <div className="flex items-center justify-end gap-2">
                {footer}
                {showCloseInFooter && (
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md border bg-white hover:bg-black/5 text-sm"
                    onClick={onClose}
                  >
                    {closeText || "Close"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

  );

  return createPortal(content, node);
};

export default Modal;
