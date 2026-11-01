import { Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/tracker/components/ui/Badge';
import { Button } from '@/tracker/components/ui/Button';
import { groupMealsByType, mealTotals } from '@/tracker/features/meals/calculations';
import { formatTime } from '@/tracker/lib/formatting/dates';
import { formatNumber, formatPortion } from '@/tracker/lib/formatting/nutrition';
import { cn } from '@/tracker/lib/cn';
import type { Meal } from '@/tracker/types/domain';
import { mealTypeLabel } from './MealForm';

interface MealListProps {
  meals: readonly Meal[];
  timezone: string;
  highlightId?: string | null;
  onEdit: (m: Meal) => void;
  onDelete: (m: Meal) => void;
}

/** Meals grouped as breakfast, lunch, dinner, snacks — each with its foods, portions and estimated nutrition. */
export function MealList({ meals, timezone, highlightId, onEdit, onDelete }: MealListProps) {
  const groups = groupMealsByType(meals);
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.type} aria-labelledby={`grp-${g.type}`}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 id={`grp-${g.type}`} className="text-sm font-semibold text-ink">
              {g.type === 'snack' ? 'Snacks' : mealTypeLabel(g.type)}
            </h3>
            <p className="tnum text-xs text-ink-3">
              ~{formatNumber(g.totals.caloriesKcal)} kcal · ~{formatNumber(g.totals.proteinG)} g protein
            </p>
          </div>
          <ul className="space-y-3">
            {g.meals.map((m) => {
              const t = mealTotals(m);
              return (
                <li
                  key={m.id}
                  data-record-id={m.id}
                  className={cn('group rounded-lg bg-sunken p-4', highlightId === m.id && 'flash-highlight')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="tnum text-[13px] font-medium text-ink">{formatTime(m.eatenAt, timezone)}</span>
                      {m.source === 'ai' && <Badge tone="neutral">Logged by AI</Badge>}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => onEdit(m)} aria-label={`Edit ${mealTypeLabel(m.mealType).toLowerCase()} at ${formatTime(m.eatenAt, timezone)}`}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => onDelete(m)} aria-label={`Delete ${mealTypeLabel(m.mealType).toLowerCase()} at ${formatTime(m.eatenAt, timezone)}`} className="hover:text-danger">
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <ul className="mt-2 divide-y divide-line">
                    {m.items.map((i) => (
                      <li key={i.id} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate text-ink">{i.foodName}</p>
                          {formatPortion(i) && <p className="text-xs text-ink-3">{formatPortion(i)}</p>}
                        </div>
                        <p className="tnum text-right text-[13px] text-ink-2">
                          {i.caloriesKcal == null && i.proteinG == null ? (
                            <span className="text-ink-3" title="No nutrition data. Not counted in totals.">
                              No nutrition data
                            </span>
                          ) : (
                            <>
                              {i.isEstimate && '~'}
                              {i.caloriesKcal != null ? `${formatNumber(i.caloriesKcal)} kcal` : '— kcal'}
                              <span className="text-ink-3"> · </span>
                              {i.proteinG != null ? `${Math.round(i.proteinG * 10) / 10} g` : '— g'}
                            </>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {m.notes && <p className="mt-1 text-xs text-ink-3">{m.notes}</p>}
                  <p className="tnum mt-2 border-t border-line pt-2 text-right text-xs text-ink-2">
                    Meal total: <span className="font-medium text-ink">~{formatNumber(t.caloriesKcal)} kcal · ~{Math.round(t.proteinG * 10) / 10} g protein</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
