import type { ReactNode } from 'react';

/** Shared tooltip chrome for Recharts. Text uses ink tokens; the color swatch carries identity. */
export function ChartTooltipBox({ title, rows }: { title: ReactNode; rows: Array<{ label: string; value: ReactNode; color?: string }> }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="tnum flex items-center gap-2 text-ink-2">
          {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-medium text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
