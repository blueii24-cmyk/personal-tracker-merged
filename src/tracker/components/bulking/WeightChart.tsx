import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltipBox } from '@/tracker/components/ui/ChartTooltip';
import { EmptyState } from '@/tracker/components/ui/EmptyState';
import { dateKeyInTz, formatDayMonth, formatFullDate } from '@/tracker/lib/formatting/dates';
import { formatWeight, kgToUnit } from '@/tracker/lib/formatting/nutrition';
import type { WeighIn, WeightUnit } from '@/tracker/types/domain';
import { Scale } from 'lucide-react';

interface WeightChartProps {
  weighIns: readonly WeighIn[];
  unit: WeightUnit;
  timezone: string;
  /** Only drawn when the user has configured a target weight. */
  targetKg?: number | null;
  height?: number;
}

/** Round, evenly spaced y-axis ticks (e.g. 47, 47.5, 48) instead of arbitrary fractions. */
function niceAxis(min: number, max: number): { domain: [number, number]; ticks: number[] } {
  const span = Math.max(max - min, 0.5);
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => span / s <= 4) ?? 20;
  const lo = Math.floor((min - step * 0.25) / step) * step;
  const hi = Math.ceil((max + step * 0.25) / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { domain: [lo, hi], ticks };
}

interface Point {
  t: number;
  value: number;
  date: string;
}

/** Plots recorded weigh-ins at their real dates. Missing days are not interpolated. */
export function WeightChart({ weighIns, unit, timezone, targetKg, height = 220 }: WeightChartProps) {
  const data = useMemo<Point[]>(
    () =>
      [...weighIns]
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
        .map((w) => ({ t: new Date(w.recordedAt).getTime(), value: Math.round(kgToUnit(w.weightKg, unit) * 10) / 10, date: dateKeyInTz(w.recordedAt, timezone) })),
    [weighIns, unit, timezone],
  );

  if (data.length === 0) {
    return <EmptyState compact icon={Scale} title="No weight entries yet" description="Log your weight to start the chart." />;
  }

  const values = data.map((d) => d.value);
  const target = targetKg != null ? Math.round(kgToUnit(targetKg, unit) * 10) / 10 : null;
  const all = target != null ? [...values, target] : values;
  const { domain, ticks } = niceAxis(Math.min(...all), Math.max(...all));
  const single = data.length === 1;

  return (
    <div>
      <div style={{ height }} role="img" aria-label={`Weight chart with ${data.length} ${data.length === 1 ? 'reading' : 'readings'}. Latest ${formatWeight(weighIns.at(-1)?.weightKg, unit)}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={single ? ['dataMin - 86400000', 'dataMax + 86400000'] : ['dataMin', 'dataMax']}
              tickFormatter={(t: number) => formatDayMonth(dateKeyInTz(new Date(t), timezone))}
              tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border-strong)' }}
              tickLine={false}
              minTickGap={36}
            />
            <YAxis domain={domain} ticks={ticks} allowDecimals tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: 'var(--border-strong)' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Point | undefined;
                if (!active || !p) return null;
                return <ChartTooltipBox title={formatFullDate(p.date)} rows={[{ label: 'Weight', value: `${p.value} ${unit}`, color: 'var(--weight-mark)' }]} />;
              }}
            />
            {target != null && (
              <ReferenceLine y={target} stroke="var(--ink-3)" strokeDasharray="4 4" label={{ value: 'Target', position: 'insideTopRight', fill: 'var(--ink-3)', fontSize: 11 }} />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--weight-mark)"
              strokeWidth={2}
              dot={{ r: data.length > 24 ? 0 : 3, fill: 'var(--weight-mark)', stroke: 'var(--surface)', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: 'var(--weight-mark)', stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {single && <p className="mt-2 text-center text-xs text-ink-3">One reading so far — a trend needs at least two.</p>}
    </div>
  );
}
