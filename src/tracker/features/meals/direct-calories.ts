import { addDays, isDateKey, todayKey, zonedToIso } from '@/tracker/lib/formatting/dates';
import type { DateKey, MealInput } from '@/tracker/types/domain';

/** A single, explicit calorie-only add; never replace an existing day's total. */
export type DirectCalorieRequest =
  | { kind: 'add'; calories: number; date: DateKey; input: MealInput; message: string }
  | { kind: 'clarify'; message: string };

export const formatDirectCalories = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const numericWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

/** Recognize only an explicit standalone add command; other chat remains with the assistant. */
export function directCalorieRequest(message: string, now: Date, timezone: string): DirectCalorieRequest | null {
  const match = message.trim().match(/^(?:(?:please|kindly|can you|could you|would you|i want to)\s+)*(?:add|log|record|track)\s+(?:(?:my|the)\s+)?(-?\d[\d,]*(?:\.\d+)?)\s*(?:kcal|cal(?:orie)?s?|kilocalories?)\b(.*)$/i);
  if (!match) return null;
  const tail = match[2]!.trim().replace(/[.!?]+$/, '').trim();
  // Do not intercept mixed actions or calorie amounts attributed to a named food.
  if (/\b(?:and|also|plus|with|of)\b/i.test(tail)) return null;
  const amount = Number(match[1]!.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 20_000 || Math.abs(amount * 10 - Math.round(amount * 10)) > 1e-6) {
    return { kind: 'clarify', message: 'Please provide a calorie amount greater than zero and at most 20,000 kcal, with at most one decimal place.' };
  }
  const dateText = tail.replace(/^(?:for|on)\s+/i, '').toLowerCase();
  const today = todayKey(timezone, now);
  let date: DateKey | undefined;
  if (!dateText || dateText === 'today') date = today;
  else if (dateText === 'yesterday') date = addDays(today, -1);
  else if (dateText === 'day before yesterday') date = addDays(today, -2);
  else {
    const relative = dateText.match(/^(\d+|one|two|three|four|five|six|seven)\s+days?\s+ago$/);
    const iso = dateText.match(/^\d{4}-\d{2}-\d{2}$/);
    const local = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const weekday = dateText.match(/^(last\s+|previous\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
    if (relative) {
      const days = numericWords[relative[1]!] ?? Number(relative[1]);
      if (Number.isSafeInteger(days) && days >= 0 && days <= 36500) date = addDays(today, -days);
    } else if (iso && isDateKey(iso[0])) date = iso[0];
    else if (local) {
      const key = `${local[3]}-${local[2]!.padStart(2, '0')}-${local[1]!.padStart(2, '0')}`;
      if (isDateKey(key)) date = key;
    } else if (weekday) {
      const day = new Date(`${today}T12:00:00Z`).getUTCDay();
      let ago = (day - weekdays.indexOf(weekday[2]!) + 7) % 7;
      if (weekday[1] && ago === 0) ago = 7;
      date = addDays(today, -ago);
    }
  }
  if (!date) return { kind: 'clarify', message: 'Which day? Use today, yesterday, a weekday, or a date such as 2026-10-29.' };
  if (date > today) return { kind: 'clarify', message: 'Please choose today or an earlier day.' };
  return {
    kind: 'add', calories: amount, date,
    input: {
      mealType: 'other', eatenAt: date === today ? now.toISOString() : zonedToIso(date, '12:00', timezone), notes: null,
      items: [{ foodName: 'Calories (user-entered)', quantity: null, unit: null, caloriesKcal: amount, proteinG: null, isEstimate: false, nutritionSource: 'user_entered' }],
    },
    message: `Added ${formatDirectCalories(amount)} kcal for ${date}.`,
  };
}
