import { ProgressBar } from "@/components/ui/Feedback";
import { clampPercent, formatCurrency } from "@/lib/formatting";

export function BudgetProgress({ spent, budget }: { spent: number; budget: number }) {
  const percent = clampPercent((spent / Math.max(budget, 1)) * 100);
  const tone = percent >= 100 ? "danger" : percent >= 80 ? "warning" : "brand";
  const remaining = budget - spent;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-[var(--text-primary)]">Spending progress</span>
        <span className="text-xs text-[var(--text-tertiary)]">{Math.round(percent)}% used</span>
      </div>
      <div className="mt-2">
        <ProgressBar value={percent} tone={tone} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>{formatCurrency(spent)} spent</span>
        <span className={remaining < 0 ? "font-medium text-danger-500" : ""}>
          {remaining < 0 ? `${formatCurrency(Math.abs(remaining))} over budget` : `${formatCurrency(remaining)} left`}
        </span>
      </div>
    </div>
  );
}
