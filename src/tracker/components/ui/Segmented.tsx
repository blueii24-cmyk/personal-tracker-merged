import type { ReactNode } from 'react';
import { cn } from '@/tracker/lib/cn';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; ariaLabel?: string }>;
  label: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}
export function Segmented<T extends string>({ value, onChange, options, label, className, size = 'md', disabled = false }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-full bg-sunken p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors',
              size === 'md' ? 'h-8 px-3.5 text-[13px]' : 'h-6 px-2.5 text-xs',
              active ? 'bg-primary-container text-on-primary-container' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
