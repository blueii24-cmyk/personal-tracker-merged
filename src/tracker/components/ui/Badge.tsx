import type { ReactNode } from 'react';
import { cn } from '@/tracker/lib/cn';

type Tone = 'neutral' | 'fuel' | 'money' | 'protein' | 'weight' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2',
  fuel: 'bg-fuel-soft text-fuel',
  money: 'bg-money-soft text-money',
  protein: 'bg-protein-soft text-protein',
  weight: 'bg-weight-soft text-weight',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};
export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
