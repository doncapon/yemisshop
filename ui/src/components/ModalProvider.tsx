// src/components/ModalProvider.tsx
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import Modal, { type ModalSize } from "./Modal";

export type OpenModalOptions = {
  title?: React.ReactNode;
  message?: React.ReactNode;

  /** ✅ NEW: custom footer actions */
  footer?: React.ReactNode;

  /** If true and footer exists, append Close button too */
  showCloseInFooter?: boolean;

  /** Hide top-right X */
  hideX?: boolean;

  /** Close button label */
  closeText?: string;

  /** If true, clicking the overlay will NOT close the modal */
  disableOverlayClose?: boolean;

  /** If true, pressing ESC will NOT close the modal */
  disableEscClose?: boolean;

  size?: ModalSize;

  /** Optional callback when closed */
  onClose?: () => void;
};

type ModalState = OpenModalOptions & {
  isOpen: boolean;
};

type ModalContextValue = {
  openModal: (opts: OpenModalOptions) => void;
  closeModal: () => void;
  isOpen: boolean;
};

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within <ModalProvider />");
  return ctx;
}

export default function ModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ModalState>({
    isOpen: false,
    title: "Notice",
    message: null,
    footer: undefined,
    showCloseInFooter: false,
    hideX: false,
    closeText: "Close",
    disableOverlayClose: false,
    disableEscClose: false,
    size: "md",
    onClose: undefined,
  });

  const closeModal = useCallback(() => {
    setState((s) => {
      if (s.onClose) {
        try {
          s.onClose();
        } catch {
          // swallow
        }
      }
      return { ...s, isOpen: false };
    });
  }, []);

  const openModal = useCallback((opts: OpenModalOptions) => {
    setState({
      isOpen: true,
      title: opts.title ?? "Notice",
      message: opts.message ?? null,
      footer: opts.footer,
      showCloseInFooter: opts.showCloseInFooter ?? false,
      hideX: opts.hideX ?? false,
      closeText: opts.closeText ?? "Close",
      disableOverlayClose: opts.disableOverlayClose ?? false,
      disableEscClose: opts.disableEscClose ?? false,
      size: opts.size ?? "md",
      onClose: opts.onClose,
    });
  }, []);

  const value = useMemo(
    () => ({
      openModal,
      closeModal,
      isOpen: state.isOpen,
    }),
    [openModal, closeModal, state.isOpen]
  );

  // ESC to close
  React.useEffect(() => {
    if (!state.isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !state.disableEscClose) closeModal();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.isOpen, state.disableEscClose, closeModal]);

  return (
    <ModalContext.Provider value={value}>
      {children}

      <Modal
        isOpen={state.isOpen}
        title={state.title}
        message={state.message}
        footer={state.footer}
        showCloseInFooter={state.showCloseInFooter}
        hideX={state.hideX}
        closeText={state.closeText}
        disableOverlayClose={state.disableOverlayClose}
        size={state.size}
        onClose={closeModal}
      />
    </ModalContext.Provider>
  );
}
