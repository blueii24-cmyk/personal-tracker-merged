import { useEffect, useState } from 'react';
import { cn } from '@/tracker/lib/cn';

interface ProgressBarProps {
  /** 0..1 */
  value: number;
  label: string;
  tone: 'fuel' | 'protein' | 'money' | 'danger';
  className?: string;
  size?: 'sm' | 'md';
}
const fills = { fuel: 'bg-fuel-mark', protein: 'bg-protein-mark', money: 'bg-money-mark', danger: 'bg-danger' };
export function ProgressBar({ value, label, tone, className, size = 'md' }: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setOn(true), 40);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('overflow-hidden rounded-full bg-sunken', size === 'md' ? 'h-2.5' : 'h-1.5', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]', fills[tone])} style={{ width: `${on ? pct : 0}%` }} />
    </div>
  );
}
