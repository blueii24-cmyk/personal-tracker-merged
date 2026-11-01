import { Link } from 'react-router-dom';
import { ActivityRings } from '@/tracker/components/ui/ActivityRings';
import { formatRupees } from '@/tracker/lib/formatting/currency';
import type { BudgetSummary } from '@/tracker/types/domain';

/** Spending against the monthly budget. This is a spending limit — not the money in your account. */
export function BudgetProgress({ summary }: { summary: BudgetSummary }) {
  if (summary.monthlyBudget == null || summary.budgetUsedRatio == null) {
    return (
      <div>
        <p className="tnum text-sm text-ink-2">
          Spent <span className="text-lg font-semibold text-ink">{formatRupees(summary.expenses)}</span> this month
        </p>
        <p className="mt-1 text-xs text-ink-3">
          No monthly budget set.{' '}
          <Link to="/settings" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
            Set one in Settings
          </Link>{' '}
          to see how much is left.
        </p>
      </div>
    );
  }
  const over = (summary.budgetRemaining ?? 0) < 0;
  const pct = Math.round(summary.budgetUsedRatio * 100);
  return (
    <div className="flex items-center gap-5">
      <ActivityRings
        size={96}
        stroke={11}
        aria-label="Monthly budget used"
        rings={[{ ratio: summary.budgetUsedRatio, tone: over ? 'danger' : 'money', label: 'Monthly budget used' }]}
        center={<span className={`tnum text-[17px] font-medium ${over ? 'text-danger' : 'text-ink'}`}>{pct}%</span>}
      />
      <div className="min-w-0 flex-1">
        <p className="tnum text-sm text-ink-2">
          <span className="text-lg font-semibold text-ink">{formatRupees(summary.expenses)}</span> of {formatRupees(summary.monthlyBudget)} spent
        </p>
        <p className={`tnum mt-1 text-xs ${over ? 'font-medium text-danger' : 'text-ink-3'}`}>
          {over ? `${formatRupees(-(summary.budgetRemaining ?? 0))} over budget` : `${formatRupees(summary.budgetRemaining ?? 0)} of budget remaining`}
        </p>
      </div>
    </div>
  );
}
