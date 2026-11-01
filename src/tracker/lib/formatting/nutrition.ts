import type { FoodItem, NutritionTotals, WeightUnit } from '@/tracker/types/domain';

const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export function formatKcal(kcal: number | null | undefined): string {
  return kcal == null ? 'Unknown' : `${num.format(Math.round(kcal))} kcal`;
}
export function formatGrams(g: number | null | undefined): string {
  return g == null ? 'Unknown' : `${num1.format(Math.round(g * 10) / 10)} g`;
}
export function formatNumber(n: number): string {
  return num.format(Math.round(n));
}
export function formatPortion(item: Pick<FoodItem, 'quantity' | 'unit'>): string {
  if (item.quantity == null) return item.unit ?? '';
  const q = num1.format(item.quantity);
  return item.unit ? `${q} ${item.unit}` : q;
}

/** Notes shown beside daily totals when some values are unknown or estimated. */
export function nutritionCaveat(t: NutritionTotals): string | null {
  const unknown = Math.max(t.unknownCalorieItems, t.unknownProteinItems);
  if (unknown > 0) {
    return `${unknown} ${unknown === 1 ? 'item has' : 'items have'} no nutrition data, so these totals are partial.`;
  }
  if (t.hasEstimates) return 'Estimated values.';
  return null;
}

const KG_PER_LB = 0.45359237;
export function kgToUnit(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}
export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}
/** Same plausible range the demo assistant enforces; catches typos like 5 or 480. */
export const PLAUSIBLE_WEIGHT_KG = { min: 20, max: 300 } as const;

/** Returns a message when a weight entered in `unit` is outside the plausible range, else undefined. */
export function weightRangeError(value: number, unit: WeightUnit): string | undefined {
  const kg = unitToKg(value, unit);
  if (kg >= PLAUSIBLE_WEIGHT_KG.min && kg <= PLAUSIBLE_WEIGHT_KG.max) return undefined;
  const lo = Math.round(kgToUnit(PLAUSIBLE_WEIGHT_KG.min, unit));
  const hi = Math.round(kgToUnit(PLAUSIBLE_WEIGHT_KG.max, unit));
  return `Enter a weight between ${lo} and ${hi} ${unit}. Check for a typo.`;
}

export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null) return '—';
  return `${num1.format(Math.round(kgToUnit(kg, unit) * 10) / 10)} ${unit}`;
}
export function formatWeightChange(kg: number, unit: WeightUnit): string {
  const v = Math.round(kgToUnit(kg, unit) * 10) / 10;
  if (v === 0) return `0 ${unit}`;
  return `${v > 0 ? '+' : '−'}${num1.format(Math.abs(v))} ${unit}`;
}
