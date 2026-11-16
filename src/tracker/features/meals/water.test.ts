import { describe, expect, it } from 'vitest';
import { mealsOnDate, nutritionTotals, progressOf, waterIntakeMl } from './calculations';
import { waterMealInput } from './water';
import { bulkingSettingsSchema } from '@/tracker/lib/validation/schemas';
import { normalizeMeal, normalizeSettings, parseBackup } from '@/tracker/lib/api/mock/persistence';
import { buildEmptyDb } from '@/tracker/lib/api/mock/seed';
import type { Meal } from '@/tracker/types/domain';

const now = new Date('2026-10-31T19:00:00Z');
const meal = (amount: number, date: string): Meal => ({ ...waterMealInput(amount, date, 'Asia/Kolkata', now), id: date, source: 'manual', items: [{ ...waterMealInput(amount, date, 'Asia/Kolkata', now).items[0]!, id: `${date}-water` }] });

describe('water intake', () => {
  it('uses the local date, including a timezone day boundary and earlier days', () => {
    const today = meal(250, '2026-11-01');
    const yesterday = meal(500, '2026-10-31');
    expect(today.eatenAt).toBe(now.toISOString());
    expect(nutritionTotals(mealsOnDate([today, yesterday], '2026-11-01', 'Asia/Kolkata')).waterMl).toBe(250);
    expect(nutritionTotals(mealsOnDate([today, yesterday], '2026-10-31', 'Asia/Kolkata')).waterMl).toBe(500);
    expect(() => waterMealInput(250, '2026-11-02', 'Asia/Kolkata', now)).toThrow();
  });
  it('counts only explicit plain water volumes and leaves calories/protein intact', () => {
    expect(waterIntakeMl({ foodName: 'Water', quantity: 1.5, unit: 'L' })).toBe(1500);
    expect(waterIntakeMl({ foodName: 'Water', quantity: 1, unit: 'glass' })).toBe(0);
    expect(waterIntakeMl({ foodName: 'Coconut water', quantity: 250, unit: 'ml' })).toBe(0);
    const totals = nutritionTotals([meal(250, '2026-11-01'), meal(500, '2026-11-01')]);
    expect(totals).toMatchObject({ waterMl: 750, caloriesKcal: 0, proteinG: 0, unknownCalorieItems: 0 });
    expect(progressOf(totals.waterMl, null).remaining).toBeNull();
    expect(progressOf(totals.waterMl, 500)).toMatchObject({ remaining: -250, ratio: 1 });
    for (const invalid of [NaN, Infinity, -1, 0, 100001]) expect(() => waterMealInput(invalid, '2026-11-01', 'Asia/Kolkata', now)).toThrow();
  });
  it('loads old data and retains water and targets through backup normalization', () => {
    const db = buildEmptyDb();
    expect(normalizeSettings({}).dailyWaterTargetMl ?? null).toBeNull();
    db.settings.dailyWaterTargetMl = 2000;
    db.meals = [meal(500, '2026-11-01')];
    const parsed = parseBackup(JSON.stringify({ ...db, exportedAt: now.toISOString() }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.bundle.settings.dailyWaterTargetMl).toBe(2000);
      expect(nutritionTotals(parsed.bundle.meals).waterMl).toBe(500);
      expect(normalizeMeal(parsed.bundle.meals[0])?.id).toBe(db.meals[0]!.id);
    }
  });
  it('validates targets without inventing one', () => {
    const base = { dailyCalorieTarget: null, dailyProteinTargetG: null, targetWeightKg: null, weightUnit: 'kg' };
    expect(bulkingSettingsSchema.safeParse({ ...base, dailyWaterTargetMl: null }).success).toBe(true);
    expect(bulkingSettingsSchema.safeParse({ ...base, dailyWaterTargetMl: 2000 }).success).toBe(true);
    for (const n of [-1, 0, 100001, Infinity, NaN]) expect(bulkingSettingsSchema.safeParse({ ...base, dailyWaterTargetMl: n }).success).toBe(false);
  });
});
