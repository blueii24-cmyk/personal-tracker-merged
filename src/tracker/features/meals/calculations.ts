import { dateKeyInTz } from '@/tracker/lib/formatting/dates';
import type { DateKey, FoodItem, Meal, MealType, NutritionTotals } from '@/tracker/types/domain';
import { MEAL_TYPES } from '@/tracker/types/domain';

export function mealsOnDate(meals: readonly Meal[], date: DateKey, tz: string): Meal[] {
  return meals
    .filter((m) => dateKeyInTz(m.eatenAt, tz) === date)
    .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt));
}

/** Water is a normal meal item so it retains existing IDs, sync, edit, undo and backups.
 * Count only explicit plain water with a known metric volume; never infer from other drinks. */
export function waterIntakeMl(item: Pick<FoodItem, 'foodName' | 'quantity' | 'unit'>): number {
  if (item.foodName.trim().toLowerCase() !== 'water' || item.quantity == null || !Number.isFinite(item.quantity) || item.quantity <= 0) return 0;
  const unit = item.unit?.trim().toLowerCase();
  if (unit === 'ml' || unit === 'millilitre' || unit === 'millilitres' || unit === 'milliliter' || unit === 'milliliters') return item.quantity;
  if (unit === 'l' || unit === 'litre' || unit === 'litres' || unit === 'liter' || unit === 'liters') return item.quantity * 1000;
  return 0;
}

/** Sum known calories/protein. Unknown (null) values are excluded and counted, never treated as zero. */
export function nutritionTotals(meals: readonly Meal[]): NutritionTotals {
  let kcal10 = 0;
  let protein10 = 0;
  let water10 = 0;
  let itemCount = 0;
  let unknownCalorieItems = 0;
  let unknownProteinItems = 0;
  let hasEstimates = false;
  for (const meal of meals) {
    for (const item of meal.items) {
      itemCount += 1;
      water10 += Math.round(waterIntakeMl(item) * 10);
      if (item.caloriesKcal == null) unknownCalorieItems += 1;
      else kcal10 += Math.round(item.caloriesKcal * 10);
      if (item.proteinG == null) unknownProteinItems += 1;
      else protein10 += Math.round(item.proteinG * 10);
      if (item.isEstimate && (item.caloriesKcal != null || item.proteinG != null)) hasEstimates = true;
    }
  }
  return {
    mealCount: meals.length,
    itemCount,
    caloriesKcal: kcal10 / 10,
    proteinG: protein10 / 10,
    waterMl: water10 / 10,
    unknownCalorieItems,
    unknownProteinItems,
    hasEstimates,
  };
}

export function mealTotals(meal: Meal): NutritionTotals {
  return nutritionTotals([meal]);
}

export function groupMealsByType(meals: readonly Meal[]): Array<{ type: MealType; meals: Meal[]; totals: NutritionTotals }> {
  return MEAL_TYPES.map((type) => {
    const group = meals.filter((m) => m.mealType === type);
    return { type, meals: group, totals: nutritionTotals(group) };
  }).filter((g) => g.meals.length > 0);
}

export interface Progress {
  consumed: number;
  target: number | null;
  /** target − consumed; negative when over. `null` without a target. */
  remaining: number | null;
  /** 0..1 clamped, for bar width. */
  ratio: number;
  over: boolean;
}
export function progressOf(consumed: number, target: number | null): Progress {
  if (target == null || target <= 0) return { consumed, target: null, remaining: null, ratio: 0, over: false };
  return {
    consumed,
    target,
    remaining: Math.round((target - consumed) * 10) / 10,
    ratio: Math.min(1, Math.max(0, consumed / target)),
    over: consumed > target,
  };
}

export function describeFoodItem(item: Pick<FoodItem, 'foodName' | 'quantity' | 'unit'>): string {
  const qty = item.quantity != null ? `${item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(1)}${item.unit ? ` ${item.unit}` : ''} ` : '';
  return `${qty}${item.foodName}`.trim();
}

export function dailyNutrition(
  meals: readonly Meal[],
  dates: readonly DateKey[],
  tz: string,
): Array<{ date: DateKey; totals: NutritionTotals }> {
  const byDate = new Map<DateKey, Meal[]>();
  for (const m of meals) {
    const k = dateKeyInTz(m.eatenAt, tz);
    const arr = byDate.get(k);
    if (arr) arr.push(m);
    else byDate.set(k, [m]);
  }
  return dates.map((date) => ({ date, totals: nutritionTotals(byDate.get(date) ?? []) }));
}
