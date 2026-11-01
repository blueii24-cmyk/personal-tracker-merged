import { Link } from 'react-router-dom';
import { ActivityRings } from '@/tracker/components/ui/ActivityRings';
import { cn } from '@/tracker/lib/cn';
import { progressOf } from '@/tracker/features/meals/calculations';
import { formatNumber, nutritionCaveat } from '@/tracker/lib/formatting/nutrition';
import type { NutritionTotals } from '@/tracker/types/domain';

interface RowProps {
  label: string;
  unit: string;
  consumed: number;
  target: number | null;
  tone: 'fuel' | 'protein';
  /** Shown with "~" when the figure is an estimate. */
  estimate: boolean;
}

const dots = { fuel: 'bg-fuel-mark', protein: 'bg-protein-mark' };

function ProgressRow({ label, unit, consumed, target, tone, estimate }: RowProps) {
  const p = progressOf(consumed, target);
  const approx = estimate ? '~' : '';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
          <span className={cn('size-2.5 rounded-full', dots[tone])} aria-hidden />
          {label}
        </span>
        <span className="tnum text-sm text-ink-2">
          <span className="text-lg font-semibold text-ink">
            {approx}
            {formatNumber(consumed)}
          </span>
          {target != null ? ` / ${formatNumber(target)} ${unit}` : ` ${unit}`}
        </span>
      </div>
      <p className="tnum mt-1 pl-[18px] text-xs text-ink-3">
        {p.remaining == null ? (
          <>
            No daily target set. <Link to="/settings" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">Set one in Settings</Link>
          </>
        ) : p.remaining >= 0 ? (
          `${formatNumber(p.remaining)} ${unit} remaining`
        ) : (
          `${formatNumber(-p.remaining)} ${unit} over target`
        )}
      </p>
    </div>
  );
}

interface NutritionProgressProps {
  totals: NutritionTotals;
  calorieTarget: number | null;
  proteinTarget: number | null;
}

/** Calories and protein against the user's own targets. Unknown values are excluded, never counted as zero. */
export function NutritionProgress({ totals, calorieTarget, proteinTarget }: NutritionProgressProps) {
  const caveat = nutritionCaveat(totals);
  const cal = progressOf(totals.caloriesKcal, calorieTarget);
  const pro = progressOf(totals.proteinG, proteinTarget);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-7">
        <ActivityRings
          className="justify-self-center sm:justify-self-start"
          aria-label="Today's calories and protein against your targets"
          rings={[
            { ratio: calorieTarget == null ? null : cal.ratio, tone: 'fuel', label: 'Calories progress' },
            { ratio: proteinTarget == null ? null : pro.ratio, tone: 'protein', label: 'Protein progress' },
          ]}
          center={
            <span className="tnum leading-none">
              <span className="block text-[19px] font-medium text-ink">
                {totals.hasEstimates ? '~' : ''}
                {formatNumber(totals.caloriesKcal)}
              </span>
              <span className="mt-1 block text-[11px] text-ink-3">kcal</span>
            </span>
          }
        />
        <div className="space-y-4">
          <ProgressRow label="Calories" unit="kcal" consumed={totals.caloriesKcal} target={calorieTarget} tone="fuel" estimate={totals.hasEstimates} />
          <ProgressRow label="Protein" unit="g" consumed={totals.proteinG} target={proteinTarget} tone="protein" estimate={totals.hasEstimates} />
        </div>
      </div>
      {caveat && <p className="text-xs text-ink-3">{caveat === 'Estimated values.' ? '~ Nutrition figures are estimates.' : `~ Estimates. ${caveat}`}</p>}
    </div>
  );
}
