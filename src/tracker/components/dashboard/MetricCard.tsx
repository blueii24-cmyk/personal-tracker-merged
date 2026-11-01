import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';

type Tone = 'fuel' | 'protein' | 'money' | 'weight' | 'neutral' | 'danger' | 'success';
const iconTone: Record<Tone, string> = {
  fuel: 'bg-fuel-soft text-fuel',
  protein: 'bg-protein-soft text-protein',
  money: 'bg-money-soft text-money',
  weight: 'bg-weight-soft text-weight',
  neutral: 'bg-sunken text-ink-2',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
};

interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** Secondary line under the value. */
  detail?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
  /** Use inside a card: a tonal fill instead of white, so it reads against the card. */
  tonal?: boolean;
}

/** Compact metric: a small label, a single prominent figure, and one line of context. */
export function MetricCard({ label, value, detail, icon: Icon, tone = 'neutral', children, className, tonal }: MetricCardProps) {
  return (
    <div className={cn('flex min-w-0 flex-col rounded-lg p-4', tonal ? 'bg-sunken' : 'bg-surface', className)}>
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        {Icon && (
          <span className={cn('icon-pop-slow icon-wiggle grid size-7 shrink-0 place-items-center rounded-full', iconTone[tone])}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
      <p className="tnum mt-2 truncate text-[24px] leading-none font-medium tracking-tight text-ink sm:text-[28px]">{value}</p>
      {detail && <p className="mt-1.5 text-xs text-ink-3">{detail}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
