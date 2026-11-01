import { Search, X } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Field, Input, Select } from '@/tracker/components/ui/Input';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { hasActiveFilters, type ActivityFilters } from '@/tracker/features/history/activity';
import { cn } from '@/tracker/lib/cn';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MEAL_TYPES } from '@/tracker/types/domain';
import type { ActivityKind, TransactionCategory } from '@/tracker/types/domain';
import { ACTIVITY_META } from './ActivityIcon';

const KINDS: ActivityKind[] = ['meal', 'expense', 'income', 'weight'];
const KIND_PLURAL: Record<ActivityKind, string> = { meal: 'Meals', expense: 'Expenses', income: 'Income', weight: 'Weight' };
const MONEY_CATEGORIES: TransactionCategory[] = [...new Set<TransactionCategory>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Props {
  filters: ActivityFilters;
  onChange: (f: ActivityFilters) => void;
  shown: number;
  total: number;
}

export function HistoryFilters({ filters, onChange, shown, total }: Props) {
  const set = (patch: Partial<ActivityFilters>) => onChange({ ...filters, ...patch });
  const toggleKind = (k: ActivityKind) => {
    const cur = new Set(filters.kinds ?? KINDS);
    if (cur.has(k)) cur.delete(k);
    else cur.add(k);
    // Selecting everything (or nothing) means "no kind filter".
    set({ kinds: cur.size === 0 || cur.size === KINDS.length ? null : cur, category: 'all' });
  };
  const active = hasActiveFilters(filters);
  const kinds = filters.kinds;
  const showMeal = !kinds || kinds.has('meal');
  const showMoney = !kinds || kinds.has('expense') || kinds.has('income');

  return (
    <form role="search" aria-label="Filter history" onSubmit={(e) => e.preventDefault()} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
        <Field label="Search">
          {({ id }) => (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input id={id} type="search" value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Foods, descriptions, categories, notes" className="pl-9" />
            </div>
          )}
        </Field>
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={filters.category} onChange={(e) => set({ category: e.target.value })} disabled={!showMeal && !showMoney}>
              <option value="all">All categories</option>
              {showMeal && (
                <optgroup label="Meal type">
                  {MEAL_TYPES.map((m) => (
                    <option key={m} value={`meal:${m}`}>
                      {cap(m)}
                    </option>
                  ))}
                </optgroup>
              )}
              {showMoney && (
                <optgroup label="Money category">
                  {MONEY_CATEGORIES.map((c) => (
                    <option key={c} value={`tx:${c}`}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-[14rem_14rem_1fr]">
        <Field label="From">{({ id }) => <Input id={id} type="date" value={filters.range.from ?? ''} max={filters.range.to || undefined} onChange={(e) => set({ range: { ...filters.range, from: e.target.value || undefined } })} />}</Field>
        <Field label="To">{({ id }) => <Input id={id} type="date" value={filters.range.to ?? ''} min={filters.range.from || undefined} onChange={(e) => set({ range: { ...filters.range, to: e.target.value || undefined } })} />}</Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Entry type" className="flex flex-wrap gap-2">
          {KINDS.map((k) => {
            const on = !kinds || kinds.has(k);
            const { icon: Icon } = ACTIVITY_META[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={kinds ? kinds.has(k) : false}
                onClick={() => toggleKind(k)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
                  kinds && on ? 'border-transparent bg-primary-container text-on-primary-container' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {KIND_PLURAL[k]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <p className="tnum text-[13px] text-ink-3" aria-live="polite">
            {active ? `${shown} of ${total} entries` : `${total} entries`}
          </p>
          {active && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ kinds: null, category: 'all', search: '', range: {} })}>
              <X className="size-3.5" aria-hidden />
              Clear
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
