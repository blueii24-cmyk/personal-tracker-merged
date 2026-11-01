import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dateKeyInTz, daysInMonth, monthKeyInTz, zonedToIso } from '@/tracker/lib/formatting/dates';
import { formatRupees, formatSignedRupees, sumMoney } from '@/tracker/lib/formatting/currency';
import { budgetSummary, trackedBalance } from './transactions/calculations';
import { nutritionTotals } from './meals/calculations';
import { filterActivity, buildActivity, EMPTY_ACTIVITY_FILTERS } from './history/activity';
import type { Meal, Transaction } from '@/tracker/types/domain';

const TZ = 'Asia/Kolkata';
const tx = (id: string, type: Transaction['type'], amount: number, occurredAt: string, category: Transaction['category'] = 'food'): Transaction => ({
  id, type, amount, currency: 'INR', category, description: id, merchant: null, notes: null, occurredAt, source: 'manual',
});

describe('dates in user timezone', () => {
  it('uses the profile timezone at midnight boundaries', () => {
    // 2026-10-31T19:00Z is 2026-11-01 00:30 in IST
    expect(dateKeyInTz('2026-10-31T19:00:00Z', TZ)).toBe('2026-11-01');
    expect(monthKeyInTz('2026-10-31T19:00:00Z', TZ)).toBe('2026-11');
    expect(dateKeyInTz('2026-10-31T19:00:00Z', 'UTC')).toBe('2026-10-31');
  });
  it('round-trips wall-clock time through zonedToIso', () => {
    const iso = zonedToIso('2026-10-30', '07:15', TZ);
    expect(iso).toBe('2026-10-30T01:45:00.000Z');
    expect(zonedToIso('2026-03-08', '12:00', 'America/New_York')).toBe('2026-03-08T16:00:00.000Z');
  });
  it('does calendar arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(daysInMonth('2028-02')).toBe(29);
  });
});

describe('money', () => {
  it('formats with Indian grouping and true minus', () => {
    expect(formatRupees(125000)).toBe('₹1,25,000');
    expect(formatRupees(60.5)).toBe('₹60.50');
    expect(formatSignedRupees(60, 'expense')).toBe('−₹60');
    expect(formatSignedRupees(2000, 'income')).toBe('+₹2,000');
  });
  it('sums without float drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });
});

describe('budget calculations', () => {
  const txs = [
    tx('a', 'expense', 60, '2026-10-05T04:00:00Z'),
    tx('b', 'income', 2000, '2026-10-06T04:00:00Z', 'pocket_money'),
    tx('c', 'expense', 40.5, '2026-09-30T20:00:00Z'), // 2026-10-01 01:30 IST => October
    tx('d', 'expense', 100, '2026-09-20T04:00:00Z'),
  ];
  it('counts only expenses in the local month against the budget', () => {
    const s = budgetSummary(txs, '2026-10', 1000, TZ);
    expect(s.expenses).toBe(100.5);
    expect(s.income).toBe(2000);
    expect(s.budgetRemaining).toBe(899.5);
  });
  it('tracked balance = opening + income − expenses (all time)', () => {
    expect(trackedBalance(txs, 500)).toBe(500 + 2000 - 200.5);
  });
  it('returns null remaining without a budget', () => {
    expect(budgetSummary(txs, '2026-10', null, TZ).budgetRemaining).toBeNull();
  });
});

describe('nutrition', () => {
  const meal: Meal = {
    id: 'm', mealType: 'lunch', eatenAt: '2026-10-30T06:00:00Z', notes: null, source: 'manual',
    items: [
      { id: '1', foodName: 'egg', quantity: 2, unit: null, caloriesKcal: 156, proteinG: 12.6, isEstimate: true, nutritionSource: 'ai_estimate' },
      { id: '2', foodName: 'mystery', quantity: null, unit: null, caloriesKcal: null, proteinG: null, isEstimate: true, nutritionSource: 'unknown' },
    ],
  };
  it('does not treat unknown values as zero', () => {
    const t = nutritionTotals([meal]);
    expect(t.caloriesKcal).toBe(156);
    expect(t.unknownCalorieItems).toBe(1);
  });
});

describe('history filters', () => {
  it('filters by kind and search', () => {
    const entries = buildActivity([], [tx('bus fare', 'expense', 60, '2026-10-05T04:00:00Z', 'transport')], []);
    expect(filterActivity(entries, { ...EMPTY_ACTIVITY_FILTERS, search: 'bus' }, TZ)).toHaveLength(1);
    expect(filterActivity(entries, { ...EMPTY_ACTIVITY_FILTERS, kinds: new Set(['income']) }, TZ)).toHaveLength(0);
  });
});
