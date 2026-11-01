import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { ErrorState } from '@/tracker/components/ui/EmptyState';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { PageContainer } from '@/tracker/components/layout/AppShell';
import { MealForm } from '@/tracker/components/bulking/MealForm';
import { TransactionForm } from '@/tracker/components/budget/TransactionForm';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { filterTransactions } from '@/tracker/features/transactions/calculations';
import { formatRupees } from '@/tracker/lib/formatting/currency';
import { formatLongDate, formatMonthLabel, greetingFor, hourInTz } from '@/tracker/lib/formatting/dates';
import { formatNumber } from '@/tracker/lib/formatting/nutrition';
import type { DashboardSummary, Transaction, TransactionType, UserSettings } from '@/tracker/types/domain';
import { AiQuickPanel } from './AiQuickPanel';
import { BudgetOverview } from './BudgetOverview';
import { BulkingOverview } from './BulkingOverview';
import { RecentActivity } from './RecentActivity';

/** One sentence that answers "how am I doing today?" in plain words. */
function daySentence(s: DashboardSummary, settings: UserSettings): string {
  const n = s.nutritionToday;
  const eaten =
    n.mealCount === 0
      ? 'No meals logged yet today'
      : settings.dailyCalorieTarget
        ? `About ${formatNumber(n.caloriesKcal)} of ${formatNumber(settings.dailyCalorieTarget)} kcal eaten today`
        : `About ${formatNumber(n.caloriesKcal)} kcal eaten today`;
  const b = s.budget;
  const money =
    b.budgetRemaining == null
      ? `${formatRupees(b.expenses)} spent in ${formatMonthLabel(b.monthKey).split(' ')[0]}`
      : b.budgetRemaining >= 0
        ? `${formatRupees(b.budgetRemaining)} left in ${formatMonthLabel(b.monthKey).split(' ')[0]}'s budget`
        : `${formatRupees(-b.budgetRemaining)} over ${formatMonthLabel(b.monthKey).split(' ')[0]}'s budget`;
  return `${eaten}, and ${money}.`;
}

export default function OverviewPage() {
  const t = useTracker();
  const [mealOpen, setMealOpen] = useState(false);
  const [txDialog, setTxDialog] = useState<{ type?: TransactionType; transaction?: Transaction } | null>(null);

  const recentTx = useMemo(() => filterTransactions(t.transactions, {}, t.timezone), [t.transactions, t.timezone]);

  if (t.status === 'error') return <PageContainer><ErrorState message={t.error?.message ?? 'Something went wrong.'} onRetry={() => void t.refresh().catch(() => undefined)} /></PageContainer>;
  if (t.status !== 'ready' || !t.settings || !t.summary) return <OverviewSkeleton />;
  const { settings, summary } = t;
  const hour = hourInTz(new Date(), settings.timezone);

  return (
    <PageContainer>
      <header className="mb-5">
        <p className="text-sm text-ink-3">{formatLongDate(t.today)}</p>
        <h1 className="display mt-1 text-[32px] leading-[1.1] text-ink sm:text-[42px]">
          {greetingFor(hour)}, {settings.displayName}
        </h1>
        <p className="display tnum mt-3 max-w-3xl text-[19px] leading-snug text-ink-2 sm:text-[22px]">{daySentence(summary, settings)}</p>
      </header>

      <AiQuickPanel className="mb-5" />

      <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
        <BulkingOverview summary={summary} settings={settings} meals={t.meals} weighIns={t.weighIns} today={t.today} onLogMeal={() => setMealOpen(true)} />
        <BudgetOverview summary={summary} settings={settings} transactions={recentTx} onAdd={(type) => setTxDialog({ type })} onEdit={(tx) => setTxDialog({ transaction: tx })} />
      </div>

      <Card className="mt-5">
        <CardHeader
          as="h2"
          title="Recent activity"
          description="Meals, spending, income and weigh-ins in one timeline"
          action={
            <Link to="/history">
              <Button variant="ghost" size="sm">
                See all
              </Button>
            </Link>
          }
        />
        <CardBody>
          <RecentActivity entries={summary.recentActivity} timezone={settings.timezone} unit={settings.weightUnit} />
        </CardBody>
      </Card>

      <MealForm open={mealOpen} onClose={() => setMealOpen(false)} defaultDate={t.today} />
      <TransactionForm open={txDialog !== null} onClose={() => setTxDialog(null)} transaction={txDialog?.transaction} initialType={txDialog?.type} />
    </PageContainer>
  );
}

function OverviewSkeleton() {
  return (
    <PageContainer>
      <div role="status" aria-label="Loading overview" className="space-y-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-6 w-[32rem] max-w-full" />
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Skeleton className="h-[34rem]" />
          <Skeleton className="h-[34rem]" />
        </div>
      </div>
    </PageContainer>
  );
}
