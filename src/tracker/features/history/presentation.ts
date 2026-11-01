import { mealTotals, describeFoodItem } from '@/tracker/features/meals/calculations';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { formatSignedRupees } from '@/tracker/lib/formatting/currency';
import { dateKeyInTz, monthKeyInTz } from '@/tracker/lib/formatting/dates';
import { formatNumber, formatWeight } from '@/tracker/lib/formatting/nutrition';
import type { ActivityEntry, MealType, WeightUnit } from '@/tracker/types/domain';

const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', other: 'Meal' };

export interface ActivityView {
  title: string;
  detail: string;
  /** Right-aligned figure, e.g. "−₹60" or "~594 kcal". */
  value: string;
  positive: boolean;
}

export function describeActivity(e: ActivityEntry, unit: WeightUnit): ActivityView {
  switch (e.kind) {
    case 'meal': {
      const t = mealTotals(e.record);
      const names = e.record.items.map((i) => describeFoodItem(i));
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
      const known = t.unknownCalorieItems < e.record.items.length;
      return { title: MEAL_LABEL[e.record.mealType], detail: shown, value: known ? `~${formatNumber(t.caloriesKcal)} kcal` : 'No nutrition data', positive: false };
    }
    case 'expense':
      return { title: e.record.description, detail: categoryLabel(e.record.category), value: formatSignedRupees(e.record.amount, 'expense'), positive: false };
    case 'income':
      return { title: e.record.description, detail: categoryLabel(e.record.category), value: formatSignedRupees(e.record.amount, 'income'), positive: true };
    case 'weight':
      return { title: 'Weight check-in', detail: e.record.notes ?? '', value: formatWeight(e.record.weightKg, unit), positive: false };
  }
}

/** Where to see (and flash) the record this entry refers to. */
export function recordLink(e: ActivityEntry, tz: string): string {
  const day = dateKeyInTz(e.at, tz);
  if (e.kind === 'meal' || e.kind === 'weight') return `/bulking?date=${day}&highlight=${e.id}`;
  return `/budget?month=${monthKeyInTz(e.at, tz)}&highlight=${e.id}`;
}

export function activityAriaLabel(e: ActivityEntry, unit: WeightUnit): string {
  const v = describeActivity(e, unit);
  return `${v.title}, ${v.value}`;
}

