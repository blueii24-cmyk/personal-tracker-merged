import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltipBox } from '@/tracker/components/ui/ChartTooltip';
import { formatCompactRupees, formatRupees } from '@/tracker/lib/formatting/currency';
import { formatWeekdayDate } from '@/tracker/lib/formatting/dates';
import type { DateKey } from '@/tracker/types/domain';

export function DailySpendChart({ data }: { data: ReadonlyArray<{ date: DateKey; amount: number }> }) {
  const total = data.reduce((a, d) => a + d.amount, 0);
  const rows = data.map((d) => ({ ...d, day: Number(d.date.slice(8, 10)) }));
  return (
    <div className="h-44" role="img" aria-label={`Daily spending this month, ${formatRupees(total)} in total`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="18%">
          <XAxis dataKey="day" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={46} tickCount={4} tickFormatter={(v: number) => formatCompactRupees(v)} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !p) return null;
              return <ChartTooltipBox title={formatWeekdayDate(p.date)} rows={[{ label: 'Spent', value: formatRupees(p.amount), color: 'var(--money-mark)' }]} />;
            }}
          />
          <Bar dataKey="amount" fill="var(--money-mark)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
