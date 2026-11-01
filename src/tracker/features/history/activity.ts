import { dateKeyInTz } from '@/tracker/lib/formatting/dates';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { describeFoodItem } from '@/tracker/features/meals/calculations';
import type { ActivityEntry, ActivityKind, DateRange, Meal, Transaction, WeighIn } from '@/tracker/types/domain';

export function buildActivity(meals: readonly Meal[], txs: readonly Transaction[], weighIns: readonly WeighIn[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    ...meals.map((m): ActivityEntry => ({ kind: 'meal', id: m.id, at: m.eatenAt, record: m })),
    ...txs.map((t): ActivityEntry => ({ kind: t.type, id: t.id, at: t.occurredAt, record: t }) as ActivityEntry),
    ...weighIns.map((w): ActivityEntry => ({ kind: 'weight', id: w.id, at: w.recordedAt, record: w })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

export interface ActivityFilters {
  kinds: ReadonlySet<ActivityKind> | null; // null = all
  /** meal type, transaction category, or 'all' */
  category: string;
  search: string;
  range: DateRange;
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = { kinds: null, category: 'all', search: '', range: {} };

/** Category filter values are prefixed so meal type "other" and money category "other" stay distinct. */
export function activityCategory(e: ActivityEntry): string | null {
  if (e.kind === 'meal') return `meal:${e.record.mealType}`;
  if (e.kind === 'weight') return null;
  return `tx:${e.record.category}`;
}

export function activitySearchText(e: ActivityEntry): string {
  switch (e.kind) {
    case 'meal':
      return `${e.record.mealType} ${e.record.notes ?? ''} ${e.record.items.map(describeFoodItem).join(' ')}`;
    case 'weight':
      return `weight ${e.record.weightKg} ${e.record.notes ?? ''}`;
    default:
      return `${e.record.description} ${e.record.merchant ?? ''} ${e.record.notes ?? ''} ${categoryLabel(e.record.category)}`;
  }
}

export function filterActivity(entries: readonly ActivityEntry[], f: ActivityFilters, tz: string): ActivityEntry[] {
  const q = f.search.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.kinds && !f.kinds.has(e.kind)) return false;
    if (f.category !== 'all' && activityCategory(e) !== f.category) return false;
    if (f.range.from || f.range.to) {
      const k = dateKeyInTz(e.at, tz);
      if (f.range.from && k < f.range.from) return false;
      if (f.range.to && k > f.range.to) return false;
    }
    if (q && !activitySearchText(e).toLowerCase().includes(q)) return false;
    return true;
  });
}

export function hasActiveFilters(f: ActivityFilters): boolean {
  return Boolean(f.kinds) || f.category !== 'all' || f.search.trim() !== '' || Boolean(f.range.from) || Boolean(f.range.to);
}
