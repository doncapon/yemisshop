import React, { useEffect } from "react";

export interface ModalProps {
  isOpen: boolean;
  title: string;
  message?: React.ReactNode;
  onClose: () => void;
}

const Modal: React.FC<ModalProps> = ({ isOpen, title, message, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true">
      <div className="modal-panel relative">
        <button className="modal-close" aria-label="Close modal" onClick={onClose}>✕</button>
        <h2 className="modal-title">{title}</h2>
        {message ? <p className="modal-message">{message}</p> : null}
        <div className="modal-actions">
          <button className="modal-btn ghost" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
