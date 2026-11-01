import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Landmark, Plus, Receipt, Wallet } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { EmptyState } from '@/tracker/components/ui/EmptyState';
import { BudgetProgress } from '@/tracker/components/budget/BudgetProgress';
import { SpendingChart } from '@/tracker/components/budget/SpendingChart';
import { TransactionRow } from '@/tracker/components/budget/TransactionList';
import { formatRupees } from '@/tracker/lib/formatting/currency';
import { formatMonthLabel } from '@/tracker/lib/formatting/dates';
import type { DashboardSummary, Transaction, UserSettings } from '@/tracker/types/domain';
import { MetricCard } from './MetricCard';

interface Props {
  summary: DashboardSummary;
  settings: UserSettings;
  transactions: readonly Transaction[];
  onAdd: (type: 'expense' | 'income') => void;
  onEdit: (t: Transaction) => void;
}

export function BudgetOverview({ summary, settings, transactions, onAdd, onEdit }: Props) {
  const b = summary.budget;
  const recent = transactions.slice(0, 4);
  return (
    <Card className="flex flex-col">
      <CardHeader
        as="h2"
        title="Budget"
        description={formatMonthLabel(b.monthKey)}
        icon={<Wallet className="size-[18px] text-money" aria-hidden />}
        action={
          <Link to="/budget" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
            Open <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard tonal label="Tracked balance" icon={Landmark} tone="neutral" value={formatRupees(summary.trackedBalance)} detail="All recorded entries. May differ from your bank." />
          <MetricCard tonal label="Income this month" icon={ArrowDownLeft} tone="success" value={formatRupees(b.income)} detail="Received so far" />
        </div>

        <div className="grid grid-cols-3 divide-x divide-line/70 rounded-lg bg-sunken text-center">
          {[
            { label: 'Monthly budget', value: b.monthlyBudget == null ? '—' : formatRupees(b.monthlyBudget) },
            { label: 'Spent', value: formatRupees(b.expenses) },
            { label: 'Left', value: b.budgetRemaining == null ? '—' : formatRupees(b.budgetRemaining), danger: (b.budgetRemaining ?? 0) < 0 },
          ].map((s) => (
            <div key={s.label} className="min-w-0 px-2 py-3">
              <p className="text-xs text-ink-3">{s.label}</p>
              <p className={`tnum mt-0.5 truncate text-base font-semibold ${s.danger ? 'text-danger' : 'text-ink'}`}>{s.value}</p>
            </div>
          ))}
        </div>
        <BudgetProgress summary={b} />

        <div>
          <h3 className="mb-2 text-[13px] font-medium text-ink">Spending by category</h3>
          <SpendingChart data={b.byCategory.slice(0, 5)} compact />
        </div>

        <div>
          <h3 className="mb-0.5 text-[13px] font-medium text-ink">Recent transactions</h3>
          {recent.length === 0 ? (
            <EmptyState compact icon={Receipt} title="No transactions yet" />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((t) => (
                <TransactionRow key={t.id} t={t} timezone={settings.timezone} onEdit={() => onEdit(t)} />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => onAdd('expense')}>
            <ArrowUpRight className="size-4" aria-hidden />
            Add expense
          </Button>
          <Button onClick={() => onAdd('income')}>
            <Plus className="size-4" aria-hidden />
            Add income
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
