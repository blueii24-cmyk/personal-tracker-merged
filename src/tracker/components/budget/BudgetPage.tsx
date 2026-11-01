import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Landmark, Plus, PiggyBank, Receipt, Search, X } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { EmptyState, ErrorState } from '@/tracker/components/ui/EmptyState';
import { Field, Input, Select } from '@/tracker/components/ui/Input';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { MonthStepper } from '@/tracker/components/ui/Steppers';
import { PageContainer } from '@/tracker/components/layout/AppShell';
import { PageHeader } from '@/tracker/components/layout/PageHeader';
import { MetricCard } from '@/tracker/components/dashboard/MetricCard';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/tracker/types/domain';
import type { Transaction, TransactionCategory, TransactionType } from '@/tracker/types/domain';
import { budgetSummary, filterTransactions, monthDailySpending, trackedBalance } from '@/tracker/features/transactions/calculations';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { useDeleteFlow } from '@/tracker/hooks/useDeleteFlow';
import { useHighlight } from '@/tracker/hooks/useHighlight';
import { formatRupees } from '@/tracker/lib/formatting/currency';
import { formatMonthLabel, formatTimestamp, isMonthKey, monthKeyOf, monthRange } from '@/tracker/lib/formatting/dates';
import { BudgetProgress } from './BudgetProgress';
import { DailySpendChart } from './DailySpendChart';
import { SpendingChart } from './SpendingChart';
import { TransactionForm } from './TransactionForm';
import { TransactionList } from './TransactionList';

const ALL_CATEGORIES: TransactionCategory[] = [...new Set<TransactionCategory>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];

export default function BudgetPage() {
  const t = useTracker();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{ type?: TransactionType; transaction?: Transaction } | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionType | 'all'>('all');
  const [category, setCategory] = useState<TransactionCategory | 'all'>('all');
  const del = useDeleteFlow();

  const ready = t.status === 'ready' && t.settings !== null;
  const highlight = useHighlight(ready);
  const currentMonth = monthKeyOf(t.today);
  const monthParam = params.get('month');
  const month = monthParam && isMonthKey(monthParam) && monthParam <= currentMonth ? monthParam : currentMonth;
  const setMonth = (m: string) =>
    setParams(
      (p) => {
        if (m === currentMonth) p.delete('month');
        else p.set('month', m);
        return p;
      },
      { replace: true },
    );

  const tz = t.timezone;
  const settings = t.settings;
  const summary = useMemo(() => (settings ? budgetSummary(t.transactions, month, settings.monthlyBudget, tz) : null), [t.transactions, month, settings, tz]);
  const daily = useMemo(() => monthDailySpending(t.transactions, month, tz), [t.transactions, month, tz]);
  const filtered = useMemo(() => filterTransactions(t.transactions, { range: monthRange(month), type: typeFilter, category, search }, tz), [t.transactions, month, typeFilter, category, search, tz]);
  const monthCount = useMemo(() => filterTransactions(t.transactions, { range: monthRange(month) }, tz).length, [t.transactions, month, tz]);

  if (t.status === 'error') return <PageContainer><ErrorState message={t.error?.message ?? 'Something went wrong.'} onRetry={() => void t.refresh().catch(() => undefined)} /></PageContainer>;
  if (!ready || !settings || !summary) return <BudgetSkeleton />;

  const balance = trackedBalance(t.transactions, settings.openingBalance);
  const hasFilters = search.trim() !== '' || typeFilter !== 'all' || category !== 'all';
  const clearFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setCategory('all');
  };

  return (
    <PageContainer>
      <PageHeader
        title="Budget"
        description="Money in, money out, and how much of this month's budget is left."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog({ type: 'income' })}>
              <ArrowDownLeft className="size-4" aria-hidden />
              Add income
            </Button>
            <Button variant="primary" onClick={() => setDialog({ type: 'expense' })}>
              <Plus className="size-4" aria-hidden />
              Add expense
            </Button>
          </>
        }
      />
      <div className="mb-5">
        <MonthStepper value={month} currentMonth={currentMonth} onChange={setMonth} />
      </div>

      <section aria-label={`Summary for ${formatMonthLabel(month)}`} className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Income" icon={ArrowDownLeft} tone="success" value={formatRupees(summary.income)} detail={`Received in ${formatMonthLabel(month)}`} />
        <MetricCard label="Spent" icon={ArrowUpRight} tone="money" value={formatRupees(summary.expenses)} detail={`${monthCount ? 'Total expenses' : 'No entries'} this month`} />
        <MetricCard
          label="Budget remaining"
          icon={PiggyBank}
          tone={summary.budgetRemaining != null && summary.budgetRemaining < 0 ? 'danger' : 'money'}
          value={summary.budgetRemaining == null ? '—' : formatRupees(summary.budgetRemaining)}
          detail={summary.monthlyBudget == null ? 'No budget set' : `of ${formatRupees(summary.monthlyBudget)} monthly budget`}
        />
        <MetricCard label="Tracked balance" icon={Landmark} tone="neutral" value={formatRupees(balance)} detail="Opening balance + all income − all spending. May differ from your bank." />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader as="h2" title="Monthly budget" description="A spending limit, separate from your balance" />
            <CardBody>
              <BudgetProgress summary={summary} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader as="h2" title="Spending by category" description={formatMonthLabel(month)} />
            <CardBody>
              <SpendingChart data={summary.byCategory} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader as="h2" title="Spending by day" description={formatMonthLabel(month)} />
            <CardBody>{summary.expenses > 0 ? <DailySpendChart data={daily} /> : <EmptyState compact icon={Receipt} title="Nothing spent this month" />}</CardBody>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader as="h2" title="Transactions" description={`${filtered.length} of ${monthCount} in ${formatMonthLabel(month)}`} />
          <CardBody>
            <form role="search" aria-label="Filter transactions" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_9rem_11rem]" onSubmit={(e) => e.preventDefault()}>
              <Field label="Search" className="col-span-2 sm:col-span-1">
                {({ id }) => (
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                    <Input id={id} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description, category, note" className="pl-9" />
                  </div>
                )}
              </Field>
              <Field label="Type">
                {({ id }) => (
                  <Select id={id} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TransactionType | 'all')}>
                    <option value="all">All</option>
                    <option value="expense">Expenses</option>
                    <option value="income">Income</option>
                  </Select>
                )}
              </Field>
              <Field label="Category">
                {({ id }) => (
                  <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as TransactionCategory | 'all')}>
                    <option value="all">All categories</option>
                    {ALL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </form>

            {filtered.length === 0 ? (
              hasFilters ? (
                <EmptyState
                  compact
                  icon={Search}
                  title="No transactions match these filters"
                  description="Try a different search or clear the filters."
                  action={
                    <Button onClick={clearFilters}>
                      <X className="size-4" aria-hidden />
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  compact
                  icon={Receipt}
                  title={`No transactions in ${formatMonthLabel(month)}`}
                  description="Add one here, or tell the assistant, for example “I spent ₹60 on bus fare”."
                  action={
                    <Button variant="primary" onClick={() => setDialog({ type: 'expense' })}>
                      <Plus className="size-4" aria-hidden />
                      Add expense
                    </Button>
                  }
                />
              )
            ) : (
              <TransactionList
                transactions={filtered}
                timezone={tz}
                today={t.today}
                highlightId={highlight}
                onEdit={(tx) => setDialog({ transaction: tx })}
                onDelete={(tx) =>
                  del.ask({
                    title: 'Delete this transaction?',
                    description: `“${tx.description}” (${formatRupees(tx.amount)}, ${formatTimestamp(tx.occurredAt, tz)}) will be removed from your totals. You can undo right after.`,
                    doneTitle: 'Transaction deleted',
                    run: () => t.deleteTransaction(tx.id),
                  })
                }
              />
            )}
          </CardBody>
        </Card>
      </div>

      <TransactionForm open={dialog !== null} onClose={() => setDialog(null)} transaction={dialog?.transaction} initialType={dialog?.type} defaultDate={month === currentMonth ? t.today : monthRange(month).to} />
      {del.dialog}
    </PageContainer>
  );
}

function BudgetSkeleton() {
  return (
    <PageContainer>
      <div role="status" aria-label="Loading budget" className="space-y-5">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    </PageContainer>
  );
}
