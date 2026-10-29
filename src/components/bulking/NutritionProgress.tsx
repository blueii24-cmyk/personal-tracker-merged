import { Flame, Drumstick } from "lucide-react";
import { ProgressBar } from "@/components/ui/Feedback";
import { clampPercent, formatGrams, formatKcal } from "@/lib/formatting";

export function NutritionProgress({
  caloriesConsumed,
  calorieTarget,
  proteinConsumed,
  proteinTarget,
}: {
  caloriesConsumed: number;
  calorieTarget: number;
  proteinConsumed: number;
  proteinTarget: number;
}) {
  const calorieRemaining = Math.max(calorieTarget - caloriesConsumed, 0);
  const proteinRemaining = Math.max(proteinTarget - proteinConsumed, 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Flame size={16} className="text-warning-500" />
            Calories
          </div>
          <span className="text-xs text-[var(--text-tertiary)]">estimate</span>
        </div>
        <p className="mt-2 text-xl font-semibold text-[var(--text-primary)]">
          {formatKcal(caloriesConsumed)}
          <span className="text-sm font-normal text-[var(--text-tertiary)]"> / {formatKcal(calorieTarget)}</span>
        </p>
        <div className="mt-3">
          <ProgressBar value={clampPercent((caloriesConsumed / Math.max(calorieTarget, 1)) * 100)} tone="warning" />
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">{formatKcal(calorieRemaining)} remaining today</p>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Drumstick size={16} className="text-brand-500" />
            Protein
          </div>
          <span className="text-xs text-[var(--text-tertiary)]">estimate</span>
        </div>
        <p className="mt-2 text-xl font-semibold text-[var(--text-primary)]">
          {formatGrams(proteinConsumed)}
          <span className="text-sm font-normal text-[var(--text-tertiary)]"> / {formatGrams(proteinTarget)}</span>
        </p>
        <div className="mt-3">
          <ProgressBar value={clampPercent((proteinConsumed / Math.max(proteinTarget, 1)) * 100)} tone="brand" />
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">{formatGrams(proteinRemaining)} remaining today</p>
      </div>
    </div>
  );
}
