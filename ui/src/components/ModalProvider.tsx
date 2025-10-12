import React, { createContext, useCallback, useContext, useState } from "react";
import Modal from "./Modal";

type OpenArgs = { title: string; message?: React.ReactNode };

type ModalContextValue = {
  openModal: (args: OpenArgs) => void;
  closeModal: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

export const useModal = () => {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within <ModalProvider>");
  return ctx;
};

export const ModalProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [message, setMessage] = useState<React.ReactNode>("");

  const openModal = useCallback(({ title, message }: OpenArgs) => {
    setTitle(title);
    setMessage(message ?? "");
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => setIsOpen(false), []);

  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      {/* Render one modal at the root so routes/pages can trigger it */}
      <Modal isOpen={isOpen} title={title} message={message} onClose={closeModal} />
    </ModalContext.Provider>
  );
};
