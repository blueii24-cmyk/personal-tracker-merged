import type { ReactNode } from "react";
import { ProgressBar } from "@/components/ui/Feedback";

export function MetricCard({
  label,
  value,
  helpText,
  icon,
  progress,
  progressTone = "brand",
  trend,
}: {
  label: string;
  value: string;
  helpText?: string;
  icon: ReactNode;
  progress?: number;
  progressTone?: "brand" | "success" | "warning" | "danger";
  trend?: { label: string; positive?: boolean | null };
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-secondary)]">
          {icon}
        </div>
      </div>
      <p className="mt-2 text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">{value}</p>
      {helpText && <p className="mt-1 text-xs text-[var(--text-secondary)]">{helpText}</p>}
      {trend && (
        <p
          className={`mt-1 text-xs font-medium ${
            trend.positive === null || trend.positive === undefined
              ? "text-[var(--text-tertiary)]"
              : trend.positive
                ? "text-success-600 dark:text-success-500"
                : "text-danger-500"
          }`}
        >
          {trend.label}
        </p>
      )}
      {typeof progress === "number" && (
        <div className="mt-3">
          <ProgressBar value={progress} tone={progressTone} size="sm" />
        </div>
      )}
    </div>
  );
}
