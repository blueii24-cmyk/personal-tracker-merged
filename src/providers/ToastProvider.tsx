"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-success-500/30",
  error: "border-danger-500/30",
  info: "border-brand-500/30",
};

const VARIANT_ICON = {
  success: CheckCircle2,
  error: TriangleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = `toast_${counter.current}`;
      setToasts((prev) => [...prev, { ...options, id }]);
      window.setTimeout(() => dismiss(id), options.durationMs ?? 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
        {toasts.map((toast) => {
          const Icon = VARIANT_ICON[toast.variant ?? "info"];
          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto animate-slide-up w-full max-w-sm rounded-xl border bg-[var(--surface-raised)] p-4 shadow-soft-lg ${VARIANT_STYLES[toast.variant ?? "info"]}`}
            >
              <div className="flex items-start gap-3">
                <Icon
                  size={18}
                  className={
                    toast.variant === "success"
                      ? "mt-0.5 shrink-0 text-success-500"
                      : toast.variant === "error"
                        ? "mt-0.5 shrink-0 text-danger-500"
                        : "mt-0.5 shrink-0 text-brand-500"
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{toast.description}</p>
                  )}
                  {toast.actionLabel && toast.onAction && (
                    <button
                      type="button"
                      onClick={() => {
                        toast.onAction?.();
                        dismiss(toast.id);
                      }}
                      className="mt-2 text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
                    >
                      {toast.actionLabel}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
