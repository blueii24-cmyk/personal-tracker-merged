import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2, Utensils } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { EmptyState, ErrorState } from '@/tracker/components/ui/EmptyState';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { DateStepper } from '@/tracker/components/ui/Steppers';
import { PageContainer } from '@/tracker/components/layout/AppShell';
import { PageHeader } from '@/tracker/components/layout/PageHeader';
import { mealsOnDate, nutritionTotals } from '@/tracker/features/meals/calculations';
import { changeAcross, sortWeighIns, weighInsInRange } from '@/tracker/features/weigh-ins/calculations';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { useDeleteFlow } from '@/tracker/hooks/useDeleteFlow';
import { useHighlight } from '@/tracker/hooks/useHighlight';
import { addDays, dateKeyInTz, formatFullDate, formatRelativeDay, formatRelativeDayInline, formatTime, isDateKey } from '@/tracker/lib/formatting/dates';
import { formatWeight, formatWeightChange } from '@/tracker/lib/formatting/nutrition';
import { cn } from '@/tracker/lib/cn';
import type { Meal, WeighIn } from '@/tracker/types/domain';
import { CalorieHistoryChart } from './CalorieHistoryChart';
import { MealForm, mealTypeLabel } from './MealForm';
import { MealList } from './MealList';
import { NutritionProgress } from './NutritionProgress';
import { WeighInEditDialog, WeightCheckIn } from './WeightCheckIn';
import { WeightChart } from './WeightChart';

type Range = '30' | '90' | 'all';

export default function BulkingPage() {
  const t = useTracker();
  const [params, setParams] = useSearchParams();
  const [mealDialog, setMealDialog] = useState<{ meal?: Meal } | null>(null);
  const [editWeighIn, setEditWeighIn] = useState<WeighIn | null>(null);
  const [range, setRange] = useState<Range>('90');
  const [showAllWeights, setShowAllWeights] = useState(false);
  const del = useDeleteFlow();

  const ready = t.status === 'ready' && t.settings !== null;
  const highlight = useHighlight(ready);

  const dateParam = params.get('date');
  const selected = dateParam && isDateKey(dateParam) && dateParam <= t.today ? dateParam : t.today;
  const setSelected = (d: string) =>
    setParams(
      (p) => {
        if (d === t.today) p.delete('date');
        else p.set('date', d);
        return p;
      },
      { replace: true },
    );

  const tz = t.timezone;
  const dayMeals = useMemo(() => mealsOnDate(t.meals, selected, tz), [t.meals, selected, tz]);
  const totals = useMemo(() => nutritionTotals(dayMeals), [dayMeals]);
  const weightsShown = useMemo(() => {
    if (range === 'all') return sortWeighIns(t.weighIns);
    return weighInsInRange(t.weighIns, addDays(t.today, -(Number(range) - 1)), undefined, tz);
  }, [t.weighIns, range, t.today, tz]);

  if (t.status === 'error') return <PageContainer><ErrorState message={t.error?.message ?? 'Something went wrong.'} onRetry={() => void t.refresh().catch(() => undefined)} /></PageContainer>;
  if (!ready || !t.settings) return <BulkingSkeleton />;
  const s = t.settings;
  const unit = s.weightUnit;
  const entries = [...t.weighIns].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const visibleEntries = showAllWeights ? entries : entries.slice(0, 5);
  const change = changeAcross(weightsShown);

  return (
    <PageContainer>
      <PageHeader
        title="Bulking"
        description="Log what you eat, check your numbers against your own targets, and follow your weight."
        actions={
          <Button variant="primary" onClick={() => setMealDialog({})}>
            <Plus className="size-4" aria-hidden />
            Log meal
          </Button>
        }
      />
      <div className="mb-5">
        <DateStepper value={selected} today={t.today} onChange={setSelected} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader as="h2" title={`${formatRelativeDay(selected, t.today)}'s nutrition`} description={formatFullDate(selected)} />
            <CardBody>
              <NutritionProgress totals={totals} calorieTarget={s.dailyCalorieTarget} proteinTarget={s.dailyProteinTargetG} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              as="h2"
              title="Meal log"
              description={dayMeals.length ? `${dayMeals.length} ${dayMeals.length === 1 ? 'meal' : 'meals'} · estimates are marked with ~` : undefined}
              action={
                dayMeals.length > 0 ? (
                  <Button size="sm" onClick={() => setMealDialog({})}>
                    <Plus className="size-4" aria-hidden />
                    Add
                  </Button>
                ) : undefined
              }
            />
            <CardBody>
              {dayMeals.length === 0 ? (
                <EmptyState
                  compact
                  icon={Utensils}
                  title={`No meals logged ${selected === t.today ? 'today' : `for ${formatRelativeDayInline(selected, t.today)}`}`}
                  description="Add one with the form, or tell the assistant what you ate and it will log it for you."
                  action={
                    <>
                      <Button variant="primary" onClick={() => setMealDialog({})}>
                        <Plus className="size-4" aria-hidden />
                        Log meal
                      </Button>
                      <Link to="/chat" className="inline-flex h-10 items-center rounded-full border border-line-strong px-5 text-sm font-medium text-primary hover:bg-primary-container/60">
                        Ask the assistant
                      </Link>
                    </>
                  }
                />
              ) : (
                <MealList
                  meals={dayMeals}
                  timezone={tz}
                  highlightId={highlight}
                  onEdit={(meal) => setMealDialog({ meal })}
                  onDelete={(meal) =>
                    del.ask({
                      title: 'Delete this meal?',
                      description: `${mealTypeLabel(meal.mealType)} at ${formatTime(meal.eatenAt, tz)} with ${meal.items.length} ${meal.items.length === 1 ? 'food' : 'foods'} will be removed from your totals. You can undo right after.`,
                      doneTitle: 'Meal deleted',
                      run: () => t.deleteMeal(meal.id),
                    })
                  }
                />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader as="h2" title="Last 7 days" description="Estimated calories per day" />
            <CardBody>
              <CalorieHistoryChart meals={t.meals} endDate={selected} today={t.today} selected={selected} timezone={tz} calorieTarget={s.dailyCalorieTarget} onSelect={setSelected} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              as="h2"
              title="Weight"
              description={
                t.weighIns.length ? `Latest ${formatWeight(entries[0]?.weightKg, unit)} · ${formatRelativeDayInline(dateKeyInTz(entries[0]!.recordedAt, tz), t.today)}` : 'No entries yet'
              }
              action={
                <Segmented<Range>
                  label="Chart range"
                  size="sm"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: '30', label: '30d' },
                    { value: '90', label: '90d' },
                    { value: 'all', label: 'All' },
                  ]}
                />
              }
            />
            <CardBody className="space-y-5">
              <WeightCheckIn defaultDate={t.today} />
              <WeightChart weighIns={weightsShown} unit={unit} timezone={tz} targetKg={s.targetWeightKg} />
              {change != null && (
                <p className="tnum text-xs text-ink-3">
                  Across this range: <span className="font-medium text-ink-2">{formatWeightChange(change, unit)}</span> between the first and last reading.
                </p>
              )}
              {entries.length > 0 && (
                <div>
                  <h3 className="mb-1 text-[13px] font-medium text-ink">Entries</h3>
                  <ul className="divide-y divide-line">
                    {visibleEntries.map((w) => (
                      <li key={w.id} data-record-id={w.id} className={cn('flex items-center justify-between gap-2 py-2', highlight === w.id && 'flash-highlight rounded-md px-2')}>
                        <div className="min-w-0">
                          <p className="tnum text-sm font-medium text-ink">{formatWeight(w.weightKg, unit)}</p>
                          <p className="text-xs text-ink-3">
                            {formatRelativeDay(dateKeyInTz(w.recordedAt, tz), t.today)}, {formatTime(w.recordedAt, tz)}
                          </p>
                        </div>
                        <div className="flex">
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit weight from ${formatRelativeDay(dateKeyInTz(w.recordedAt, tz), t.today)}`} onClick={() => setEditWeighIn(w)}>
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-danger"
                            aria-label={`Delete weight from ${formatRelativeDay(dateKeyInTz(w.recordedAt, tz), t.today)}`}
                            onClick={() =>
                              del.ask({
                                title: 'Delete this weight entry?',
                                description: `${formatWeight(w.weightKg, unit)} on ${formatFullDate(dateKeyInTz(w.recordedAt, tz))} will be removed. You can undo right after.`,
                                doneTitle: 'Weight entry deleted',
                                run: () => t.deleteWeighIn(w.id),
                              })
                            }
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {entries.length > 5 && (
                    <Button variant="ghost" size="sm" className="mt-1" onClick={() => setShowAllWeights((v) => !v)}>
                      {showAllWeights ? 'Show fewer' : `Show all ${entries.length}`}
                    </Button>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <MealForm open={mealDialog !== null} onClose={() => setMealDialog(null)} meal={mealDialog?.meal} defaultDate={selected} />
      <WeighInEditDialog weighIn={editWeighIn} onClose={() => setEditWeighIn(null)} />
      {del.dialog}
    </PageContainer>
  );
}

function BulkingSkeleton() {
  return (
    <PageContainer>
      <div role="status" aria-label="Loading bulking data" className="space-y-5">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.45fr_1fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    </PageContainer>
  );
}
