// src/components/toastBus.ts
import type React from "react";

export type ToastBusPayload = {
  title?: string;
  message: React.ReactNode;
  duration?: number;
};

export type ToastBusPatch = Partial<ToastBusPayload>;

export type ToastBusApi = {
  push: (t: ToastBusPayload) => string; // returns toastId
  remove: (id: string) => void;
  update: (id: string, patch: ToastBusPatch) => void;
};

let api: ToastBusApi | null = null;

export function registerToastApi(next: ToastBusApi) {
  api = next;
}

export function unregisterToastApi(next?: ToastBusApi) {
  if (!next || api === next) api = null;
}

export function getToastApi(): ToastBusApi | null {
  return api;
}
