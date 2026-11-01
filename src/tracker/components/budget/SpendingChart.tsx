import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PieChart } from 'lucide-react';
import { ChartTooltipBox } from '@/tracker/components/ui/ChartTooltip';
import { EmptyState } from '@/tracker/components/ui/EmptyState';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { formatCompactRupees, formatRupees } from '@/tracker/lib/formatting/currency';
import type { CategoryTotal } from '@/tracker/types/domain';

/** Expense categories ranked by amount. One hue: the bar length (not color) carries the comparison. */
export function SpendingChart({ data, compact }: { data: readonly CategoryTotal[]; compact?: boolean }) {
  if (data.length === 0) {
    return <EmptyState compact icon={PieChart} title="No spending recorded" description="Expenses you add will be broken down by category here." />;
  }
  const total = data.reduce((a, d) => a + d.amount, 0);
  const rows = data.map((d) => ({ ...d, name: categoryLabel(d.category), share: total ? Math.round((d.amount / total) * 100) : 0 }));
  const rowH = compact ? 34 : 40;
  return (
    <div>
      <div style={{ height: rows.length * rowH + 12 }} role="img" aria-label={`Spending by category: ${rows.map((r) => `${r.name} ${formatRupees(r.amount)}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap="28%">
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="name" width={compact ? 96 : 112} tick={{ fill: 'var(--ink-2)', fontSize: 12.5 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'var(--hover)' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <ChartTooltipBox
                    title={p.name}
                    rows={[
                      { label: 'Spent', value: formatRupees(p.amount), color: 'var(--money-mark)' },
                      { label: 'Share', value: `${p.share}%` },
                      { label: 'Entries', value: String(p.count) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="amount" fill="var(--money-mark)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="amount" position="right" formatter={(v: unknown) => formatCompactRupees(Number(v))} style={{ fill: 'var(--ink)', fontSize: 12, fontWeight: 500 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
