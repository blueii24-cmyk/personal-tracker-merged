import { useMemo, useState } from 'react';
import { History as HistoryIcon, SearchX } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody } from '@/tracker/components/ui/Card';
import { EmptyState, ErrorState } from '@/tracker/components/ui/EmptyState';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { PageContainer } from '@/tracker/components/layout/AppShell';
import { PageHeader } from '@/tracker/components/layout/PageHeader';
import { MealForm } from '@/tracker/components/bulking/MealForm';
import { WeighInEditDialog } from '@/tracker/components/bulking/WeightCheckIn';
import { TransactionForm } from '@/tracker/components/budget/TransactionForm';
import { buildActivity, EMPTY_ACTIVITY_FILTERS, filterActivity, hasActiveFilters, type ActivityFilters } from '@/tracker/features/history/activity';
import { describeActivity } from '@/tracker/features/history/presentation';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { useDeleteFlow } from '@/tracker/hooks/useDeleteFlow';
import { formatFullDate, dateKeyInTz, formatTime } from '@/tracker/lib/formatting/dates';
import type { ActivityEntry } from '@/tracker/types/domain';
import { HistoryFilters } from './HistoryFilters';
import { HistoryList } from './HistoryList';

const PAGE = 40;

export default function HistoryPage() {
  const t = useTracker();
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<ActivityEntry | null>(null);
  const del = useDeleteFlow();

  const all = useMemo(() => buildActivity(t.meals, t.transactions, t.weighIns), [t.meals, t.transactions, t.weighIns]);
  const filtered = useMemo(() => filterActivity(all, filters, t.timezone), [all, filters, t.timezone]);
  const change = (f: ActivityFilters) => {
    setFilters(f);
    setLimit(PAGE);
  };

  if (t.status === 'error') return <PageContainer><ErrorState message={t.error?.message ?? 'Something went wrong.'} onRetry={() => void t.refresh().catch(() => undefined)} /></PageContainer>;
  if (t.status !== 'ready' || !t.settings) {
    return (
      <PageContainer>
        <div role="status" aria-label="Loading history" className="space-y-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      </PageContainer>
    );
  }
  const unit = t.settings.weightUnit;
  const tz = t.timezone;

  const ask = (e: ActivityEntry) => {
    const v = describeActivity(e, unit);
    const when = `${formatFullDate(dateKeyInTz(e.at, tz))}, ${formatTime(e.at, tz)}`;
    del.ask({
      title: `Delete this ${e.kind === 'weight' ? 'weight entry' : e.kind}?`,
      description: `${v.title} (${v.value}) from ${when} will be removed from your records and totals. You can undo right after.`,
      doneTitle: `${e.kind === 'weight' ? 'Weight entry' : e.kind === 'meal' ? 'Meal' : 'Transaction'} deleted`,
      run: () => (e.kind === 'meal' ? t.deleteMeal(e.id) : e.kind === 'weight' ? t.deleteWeighIn(e.id) : t.deleteTransaction(e.id)),
    });
  };

  const visible = filtered.slice(0, limit);
  return (
    <PageContainer>
      <PageHeader title="History" description="Every meal, expense, income and weigh-in in one place. Filter it, correct it, or jump to where it lives." />

      <Card className="mb-5">
        <CardBody>
          <HistoryFilters filters={filters} onChange={change} shown={filtered.length} total={all.length} />
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {all.length === 0 ? (
            <EmptyState icon={HistoryIcon} title="No records yet" description="Log a meal, an expense or your weight, or tell the assistant, and it will show up here." />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Nothing matches these filters"
              description={hasActiveFilters(filters) ? 'Try widening the date range, or clear a filter.' : undefined}
              action={<Button onClick={() => change(EMPTY_ACTIVITY_FILTERS)}>Clear filters</Button>}
            />
          ) : (
            <>
              <HistoryList entries={visible} timezone={tz} today={t.today} unit={unit} onEdit={setEditing} onDelete={ask} />
              {filtered.length > limit && (
                <div className="mt-5 flex justify-center">
                  <Button onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <MealForm open={editing?.kind === 'meal'} onClose={() => setEditing(null)} meal={editing?.kind === 'meal' ? editing.record : undefined} defaultDate={t.today} />
      <TransactionForm open={editing?.kind === 'expense' || editing?.kind === 'income'} onClose={() => setEditing(null)} transaction={editing?.kind === 'expense' || editing?.kind === 'income' ? editing.record : undefined} />
      <WeighInEditDialog weighIn={editing?.kind === 'weight' ? editing.record : null} onClose={() => setEditing(null)} />
      {del.dialog}
    </PageContainer>
  );
}
