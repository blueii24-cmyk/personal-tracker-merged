import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';

type Tone = 'success' | 'error' | 'info';
interface ToastInput {
  title: string;
  description?: string;
  tone?: Tone;
  action?: { label: string; onClick: () => void };
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}
interface ToastApi {
  toast: (t: ToastInput) => void;
}
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const iconTone = { success: 'text-success', error: 'text-danger', info: 'text-money' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      const duration = t.duration ?? (t.action ? 7000 : t.tone === 'error' ? 7000 : 4000);
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
      >
        {items.map((t) => {
          const Icon = icons[t.tone ?? 'success'];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-surface px-4 py-3 shadow-pop ring-1 ring-line [animation:toast-in_380ms_var(--ease-spring)]"
            >
              <Icon className={cn('mt-0.5 size-[18px] shrink-0', iconTone[t.tone ?? 'success'])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] text-ink-2">{t.description}</p>}
              </div>
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold text-primary hover:bg-primary-container/60"
                >
                  {t.action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="-mr-1 shrink-0 rounded-full p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
