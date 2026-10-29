import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`app-card rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-soft ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-4 pb-0 sm:p-6 sm:pb-0">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-400/10 dark:bg-brand-500/10 dark:text-brand-300">
            {icon}
          </div>
        )}
        <div className="min-w-0 pt-0.5">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] sm:text-base">{title}</h3>
          {subtitle && <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)] sm:text-sm">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`p-4 sm:p-6 ${className}`}>{children}</div>;
}
