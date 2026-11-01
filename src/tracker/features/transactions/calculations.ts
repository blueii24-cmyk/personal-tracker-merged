import { addDays, dateKeyInTz, eachDay, monthKeyInTz, monthRange } from '@/tracker/lib/formatting/dates';
import { fromPaise, roundMoney, sumMoney, toPaise } from '@/tracker/lib/formatting/currency';
import { categoryLabel } from './categories';
import type {
  BudgetSummary,
  CategoryTotal,
  DateKey,
  MonthKey,
  Transaction,
  TransactionCategory,
  TransactionFilters,
} from '@/tracker/types/domain';

export function transactionsInMonth(txs: readonly Transaction[], month: MonthKey, tz: string): Transaction[] {
  return txs.filter((t) => monthKeyInTz(t.occurredAt, tz) === month);
}

export function totalByType(txs: readonly Transaction[], type: Transaction['type']): number {
  return sumMoney(txs.filter((t) => t.type === type).map((t) => t.amount));
}

export function categoryTotals(txs: readonly Transaction[]): CategoryTotal[] {
  const map = new Map<TransactionCategory, { paise: number; count: number }>();
  for (const t of txs) {
    if (t.type !== 'expense') continue;
    const cur = map.get(t.category) ?? { paise: 0, count: 0 };
    cur.paise += toPaise(t.amount);
    cur.count += 1;
    map.set(t.category, cur);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, amount: fromPaise(v.paise), count: v.count }))
    .sort((a, b) => b.amount - a.amount || categoryLabel(a.category).localeCompare(categoryLabel(b.category)));
}

/** Monthly spend vs budget. Only expense rows in the user's local calendar month count as spending. */
export function budgetSummary(
  txs: readonly Transaction[],
  month: MonthKey,
  monthlyBudget: number | null,
  tz: string,
): BudgetSummary {
  const inMonth = transactionsInMonth(txs, month, tz);
  const income = totalByType(inMonth, 'income');
  const expenses = totalByType(inMonth, 'expense');
  const hasBudget = monthlyBudget != null && monthlyBudget > 0;
  return {
    monthKey: month,
    income,
    expenses,
    net: roundMoney(income - expenses),
    monthlyBudget: monthlyBudget ?? null,
    budgetRemaining: monthlyBudget != null ? roundMoney(monthlyBudget - expenses) : null,
    budgetUsedRatio: hasBudget ? expenses / monthlyBudget : null,
    byCategory: categoryTotals(inMonth),
  };
}

/** Opening balance + every recorded income − every recorded expense ("as tracked", not a bank balance). */
export function trackedBalance(txs: readonly Transaction[], openingBalance: number): number {
  const income = totalByType(txs, 'income');
  const expenses = totalByType(txs, 'expense');
  return roundMoney(openingBalance + income - expenses);
}

export function dailySpending(
  txs: readonly Transaction[],
  from: DateKey,
  to: DateKey,
  tz: string,
): Array<{ date: DateKey; amount: number }> {
  const byDay = new Map<DateKey, number>();
  for (const t of txs) {
    if (t.type !== 'expense') continue;
    const k = dateKeyInTz(t.occurredAt, tz);
    byDay.set(k, (byDay.get(k) ?? 0) + toPaise(t.amount));
  }
  return eachDay(from, to).map((date) => ({ date, amount: fromPaise(byDay.get(date) ?? 0) }));
}

export function monthDailySpending(txs: readonly Transaction[], month: MonthKey, tz: string) {
  const { from, to } = monthRange(month);
  return dailySpending(txs, from, to, tz);
}

export function lastNDaysRange(today: DateKey, n: number): { from: DateKey; to: DateKey } {
  return { from: addDays(today, -(n - 1)), to: today };
}

/** Shared filter used by the Budget page, History and the service layer. */
export function filterTransactions(txs: readonly Transaction[], filters: TransactionFilters, tz: string): Transaction[] {
  const q = filters.search?.trim().toLowerCase();
  return txs
    .filter((t) => {
      if (filters.type && filters.type !== 'all' && t.type !== filters.type) return false;
      if (filters.category && filters.category !== 'all' && t.category !== filters.category) return false;
      if (filters.range?.from || filters.range?.to) {
        const k = dateKeyInTz(t.occurredAt, tz);
        if (filters.range.from && k < filters.range.from) return false;
        if (filters.range.to && k > filters.range.to) return false;
      }
      if (q) {
        const hay = `${t.description} ${t.merchant ?? ''} ${t.notes ?? ''} ${categoryLabel(t.category)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
