import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/tracker/lib/cn';

export type RingTone = 'fuel' | 'protein' | 'money' | 'danger';

export interface RingSpec {
  /** 0..1. `null` means there is no target, so the ring stays empty. */
  ratio: number | null;
  tone: RingTone;
  label: string;
}

const strokes: Record<RingTone, string> = {
  fuel: 'stroke-fuel-mark',
  protein: 'stroke-protein-mark',
  money: 'stroke-money-mark',
  danger: 'stroke-danger',
};

interface ActivityRingsProps {
  /** Outermost ring first. */
  rings: RingSpec[];
  size?: number;
  stroke?: number;
  gap?: number;
  /** Shown in the middle of the innermost ring. */
  center?: ReactNode;
  className?: string;
  'aria-label': string;
}

/**
 * Concentric progress rings in the style of activity-tracker apps. The rings sweep in on first paint and
 * re-sweep when their value changes. Rounded caps, tonal tracks, no gradients.
 */
export function ActivityRings({ rings, size = 148, stroke = 12, gap = 5, center, className, 'aria-label': ariaLabel }: ActivityRingsProps) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // One frame at the empty state first, so the sweep is a real transition.
    const id = window.setTimeout(() => setOn(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  const mid = size / 2;
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="group" aria-label={ariaLabel} className="block">
        {rings.map((ring, i) => {
          const r = mid - stroke / 2 - i * (stroke + gap);
          if (r <= 0) return null;
          const c = 2 * Math.PI * r;
          const ratio = ring.ratio == null ? 0 : Math.min(1, Math.max(0, ring.ratio));
          const pct = Math.round(ratio * 100);
          return (
            <g key={ring.label} transform={`rotate(-90 ${mid} ${mid})`}>
              <circle cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} className="stroke-sunken" />
              <circle
                cx={mid}
                cy={mid}
                r={r}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={on ? c * (1 - ratio) : c}
                opacity={ratio === 0 ? 0 : 1}
                className={cn(strokes[ring.tone], 'ring-sweep')}
                style={{ transitionDelay: `${i * 140}ms` }}
                role={ring.ratio == null ? undefined : 'progressbar'}
                aria-label={ring.ratio == null ? undefined : ring.label}
                aria-valuemin={ring.ratio == null ? undefined : 0}
                aria-valuemax={ring.ratio == null ? undefined : 100}
                aria-valuenow={ring.ratio == null ? undefined : pct}
              />
            </g>
          );
        })}
      </svg>
      {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}
