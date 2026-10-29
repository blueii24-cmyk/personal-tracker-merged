import type { ReactNode } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[var(--surface-sunken)] ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-strong)] px-6 py-10 text-center">
      {icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-tertiary)]">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        {description && <p className="mt-1 max-w-xs text-sm text-[var(--text-secondary)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-danger-500/20 bg-danger-50 px-6 py-10 text-center dark:bg-danger-500/5">
      <p className="text-sm font-semibold text-danger-600">{title}</p>
      {description && <p className="max-w-xs text-sm text-[var(--text-secondary)]">{description}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-danger-500/30 px-3 py-1.5 text-sm font-medium text-danger-600 hover:bg-danger-500/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}

type BadgeTone = "neutral" | "success" | "danger" | "warning" | "brand";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-[var(--surface-sunken)] text-[var(--text-secondary)]",
  success: "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500",
  danger: "bg-danger-50 text-danger-600 dark:bg-danger-500/10 dark:text-danger-500",
  warning: "bg-warning-50 text-warning-500 dark:bg-warning-500/10",
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  size = "md",
}: {
  value: number;
  tone?: "brand" | "success" | "danger" | "warning";
  size?: "sm" | "md";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const toneClass = {
    brand: "bg-brand-500",
    success: "bg-success-500",
    danger: "bg-danger-500",
    warning: "bg-warning-500",
  }[tone];
  const heightClass = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full overflow-hidden rounded-full bg-[var(--surface-sunken)] ${heightClass}`}
    >
      <div
        className={`h-full rounded-full ${toneClass} transition-[width] duration-500 ease-out`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
