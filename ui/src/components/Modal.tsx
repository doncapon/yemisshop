import React from "react";

type ModalProps = {
  isOpen: boolean;
  title: string;
  message?: React.ReactNode;
  onClose: () => void;
};

const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  message,
  onClose,
}) => {
  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onClose();
  };

  const stopPropagation = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-xl shadow-lg max-w-md w-[90%] p-4"
        onClick={stopPropagation} // prevent clicks inside from closing or bubbling
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="font-semibold text-lg text-zinc-900">
            {title}
          </h2>
          <button
            type="button" // ✅ no implicit submit
            onClick={onClose}
            className="ml-2 text-zinc-500 hover:text-zinc-800"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {message && (
          <div className="text-sm text-zinc-700 mb-4">
            {message}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button" // ✅ safe
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-zinc-300 text-sm text-zinc-800 hover:bg-zinc-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
