"use client";

import { useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "info" | "success" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, kind: ToastKind = "info", ms = 3500) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, kind, message }];
  emit();
  setTimeout(() => dismiss(id), ms);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const EMPTY: Toast[] = [];

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => EMPTY,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pop-in pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] shadow-pop"
        >
          {t.kind === "success" ? (
            <CheckCircle2 size={16} className="shrink-0 text-accent" />
          ) : t.kind === "error" ? (
            <AlertCircle size={16} className="shrink-0 text-danger" />
          ) : (
            <Info size={16} className="shrink-0 text-info" />
          )}
          <span className="min-w-0 flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-fg-faint hover:text-fg" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
