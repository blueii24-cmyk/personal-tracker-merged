import { useMemo } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltipBox } from '@/tracker/components/ui/ChartTooltip';
import { dailyNutrition } from '@/tracker/features/meals/calculations';
import { addDays, eachDay, formatRelativeDay, formatWeekdayDate } from '@/tracker/lib/formatting/dates';
import { formatNumber } from '@/tracker/lib/formatting/nutrition';
import type { DateKey, Meal } from '@/tracker/types/domain';

interface Props {
  meals: readonly Meal[];
  /** Last day of the 7-day window. */
  endDate: DateKey;
  today: DateKey;
  selected: DateKey;
  timezone: string;
  calorieTarget: number | null;
  onSelect: (d: DateKey) => void;
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const toUtc = (k: DateKey) => new Date(`${k}T00:00:00Z`);

/** Seven days of estimated calories. Click or tab to a bar to jump to that day. */
export function CalorieHistoryChart({ meals, endDate, today, selected, timezone, calorieTarget, onSelect }: Props) {
  const days = useMemo(() => eachDay(addDays(endDate, -6), endDate), [endDate]);
  const data = useMemo(
    () =>
      dailyNutrition(meals, days, timezone).map(({ date, totals }) => ({
        date,
        label: WEEKDAY.format(toUtc(date)),
        kcal: Math.round(totals.caloriesKcal),
        protein: Math.round(totals.proteinG * 10) / 10,
        logged: totals.mealCount > 0,
      })),
    [meals, days, timezone],
  );
  const loggedDays = data.filter((d) => d.logged);
  const avgKcal = loggedDays.length ? Math.round(loggedDays.reduce((a, d) => a + d.kcal, 0) / loggedDays.length) : null;
  const avgProtein = loggedDays.length ? Math.round(loggedDays.reduce((a, d) => a + d.protein, 0) / loggedDays.length) : null;

  return (
    <div>
      <div className="h-44" role="img" aria-label={`Estimated calories for the 7 days ending ${formatRelativeDay(endDate, today)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
            <XAxis dataKey="label" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickCount={4} />
            <Tooltip
              cursor={{ fill: 'var(--hover)' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <ChartTooltipBox
                    title={formatWeekdayDate(p.date)}
                    rows={
                      p.logged
                        ? [
                            { label: 'Calories (est.)', value: `${formatNumber(p.kcal)} kcal`, color: 'var(--fuel-mark)' },
                            { label: 'Protein (est.)', value: `${p.protein} g`, color: 'var(--protein-mark)' },
                          ]
                        : [{ label: 'Meals', value: 'None logged' }]
                    }
                  />
                );
              }}
            />
            {calorieTarget != null && <ReferenceLine y={calorieTarget} stroke="var(--ink-3)" strokeDasharray="4 4" />}
            <Bar dataKey="kcal" radius={[4, 4, 0, 0]} onClick={(d) => onSelect((d as unknown as { date: DateKey }).date)} cursor="pointer" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.date} fill="var(--fuel-mark)" fillOpacity={d.date === selected ? 1 : 0.4} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Jump to day">
        {data.map((d) => (
          <button
            key={d.date}
            onClick={() => onSelect(d.date)}
            aria-pressed={d.date === selected}
            aria-label={`${formatWeekdayDate(d.date)}: ${d.logged ? `${formatNumber(d.kcal)} kcal estimated` : 'no meals logged'}`}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${d.date === selected ? 'bg-primary text-on-primary' : 'bg-sunken text-ink-2 hover:bg-hover'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <p className="tnum mt-3 text-xs text-ink-3">
        {avgKcal == null
          ? 'No meals logged in this 7-day window.'
          : `Average on the ${loggedDays.length} ${loggedDays.length === 1 ? 'day' : 'days'} with meals: ~${formatNumber(avgKcal)} kcal, ~${avgProtein} g protein.`}
        {calorieTarget != null && ' Dashed line is your calorie target.'}
      </p>
    </div>
  );
}
