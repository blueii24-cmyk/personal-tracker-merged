import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}
export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-4 py-8' : 'px-6 py-12', className)}>
      {Icon && (
        <span className="mb-3 grid size-10 place-items-center rounded-full bg-sunken text-ink-3">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}
export function ErrorState({ title = "Couldn't load this", message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-4 text-sm">
      <p className="font-semibold text-danger">{title}</p>
      <p className="mt-0.5 text-ink-2">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md border border-danger/40 px-3 py-1.5 text-[13px] font-medium text-danger hover:bg-danger/10">
          Try again
        </button>
      )}
    </div>
  );
}
