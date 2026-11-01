import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, Dumbbell, Minus, Plus, Scale, Utensils } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { EmptyState } from '@/tracker/components/ui/EmptyState';
import { NutritionProgress } from '@/tracker/components/bulking/NutritionProgress';
import { WeightChart } from '@/tracker/components/bulking/WeightChart';
import { mealTotals, describeFoodItem } from '@/tracker/features/meals/calculations';
import { weighInsInRange } from '@/tracker/features/weigh-ins/calculations';
import { addDays, dateKeyInTz, formatRelativeDay, formatRelativeDayInline, formatTime } from '@/tracker/lib/formatting/dates';
import { formatNumber, formatWeight, formatWeightChange } from '@/tracker/lib/formatting/nutrition';
import type { DashboardSummary, Meal, UserSettings, WeighIn } from '@/tracker/types/domain';
import { mealTypeLabel } from '@/tracker/components/bulking/MealForm';
import { MetricCard } from './MetricCard';

interface Props {
  summary: DashboardSummary;
  settings: UserSettings;
  meals: readonly Meal[];
  weighIns: readonly WeighIn[];
  today: string;
  onLogMeal: () => void;
}

export function BulkingOverview({ summary, settings, meals, weighIns, today, onLogMeal }: Props) {
  const tz = settings.timezone;
  const unit = settings.weightUnit;
  const w = summary.weight;
  const recentMeals = useMemo(() => [...meals].sort((a, b) => b.eatenAt.localeCompare(a.eatenAt)).slice(0, 3), [meals]);
  const chartData = useMemo(() => weighInsInRange(weighIns, addDays(today, -29), undefined, tz), [weighIns, today, tz]);
  const ChangeIcon = w.changeKg == null || w.changeKg === 0 ? Minus : w.changeKg > 0 ? ArrowUp : ArrowDown;

  return (
    <Card className="flex flex-col">
      <CardHeader
        as="h2"
        title={<span id="bulking-overview">Bulking</span>}
        description="Today against your own targets"
        icon={<Dumbbell className="size-[18px] text-fuel" aria-hidden />}
        action={
          <Link to="/bulking" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
            Open <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-5">
        <NutritionProgress totals={summary.nutritionToday} calorieTarget={settings.dailyCalorieTarget} proteinTarget={settings.dailyProteinTargetG} />

        <div className="grid grid-cols-2 gap-3">
          <MetricCard tonal label="Current weight" icon={Scale} tone="weight" value={formatWeight(w.latest?.weightKg, unit)} detail={w.latest ? `Logged ${formatRelativeDayInline(dateKeyInTz(w.latest.recordedAt, tz), today)}` : 'No weigh-ins yet'} />
          <MetricCard tonal
            label="Latest change"
            icon={ChangeIcon}
            tone="weight"
            value={w.changeKg == null ? '—' : formatWeightChange(w.changeKg, unit)}
            detail={w.changeKg == null ? (w.count === 1 ? 'Needs a second reading' : 'Needs two readings') : 'Since previous weigh-in'}
          />
        </div>

        <div>
          <h3 className="mb-2 text-[13px] font-medium text-ink">Weight, last 30 days</h3>
          <WeightChart weighIns={chartData} unit={unit} timezone={tz} targetKg={settings.targetWeightKg} height={170} />
        </div>

        <div>
          <h3 className="mb-1 text-[13px] font-medium text-ink">Recent meals</h3>
          {recentMeals.length === 0 ? (
            <EmptyState compact icon={Utensils} title="No meals logged yet" />
          ) : (
            <ul className="divide-y divide-line">
              {recentMeals.map((m) => (
                <li key={m.id}>
                  <Link to={`/bulking?date=${dateKeyInTz(m.eatenAt, tz)}&highlight=${m.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-hover">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{mealTypeLabel(m.mealType)}</p>
                      <p className="truncate text-xs text-ink-3">
                        {m.items.map(describeFoodItem).join(', ')} · {formatRelativeDay(dateKeyInTz(m.eatenAt, tz), today)}, {formatTime(m.eatenAt, tz)}
                      </p>
                    </div>
                    <p className="tnum shrink-0 text-[13px] text-ink-2">~{formatNumber(mealTotals(m).caloriesKcal)} kcal</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button variant="primary" className="mt-auto w-full" onClick={onLogMeal}>
          <Plus className="size-4" aria-hidden />
          Log a meal
        </Button>
      </CardBody>
    </Card>
  );
}
