import { TrackerError } from '@/tracker/lib/api/errors';
import { dateKeyInTz, isDateKey, zonedToIso } from '@/tracker/lib/formatting/dates';
import type { DateKey, MealInput } from '@/tracker/types/domain';

/** Store water as an ordinary, editable meal item. No separate storage or sync queue. */
export function waterMealInput(waterMl: number, date: DateKey, timezone: string, now: Date): MealInput {
  if (!Number.isFinite(waterMl) || waterMl <= 0 || waterMl > 100_000) {
    throw new TrackerError('VALIDATION', 'Water must be between 0 and 100,000 ml.', { retryable: false });
  }
  const today = dateKeyInTz(now.toISOString(), timezone);
  if (!isDateKey(date) || date > today) throw new TrackerError('VALIDATION', 'Choose today or an earlier date.', { retryable: false });
  return {
    mealType: 'other', eatenAt: date === today ? now.toISOString() : zonedToIso(date, '12:00', timezone), notes: null,
    items: [{ foodName: 'Water', quantity: waterMl, unit: 'ml', caloriesKcal: 0, proteinG: 0, isEstimate: false, nutritionSource: 'user_entered' }],
  };
}
