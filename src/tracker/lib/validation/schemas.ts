import { z } from 'zod';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MEAL_TYPES } from '@/tracker/types/domain';
import { isDateKey, isValidTimezone } from '@/tracker/lib/formatting/dates';

/** Collapse zod issues to `{ field: message }` for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

const dateKey = z.string().refine(isDateKey, 'Choose a valid date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid time');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((s) => (s === '' ? null : s));

/** Positive money with at most two decimals. */
export const moneyAmount = z
  .number({ error: 'Enter an amount' })
  .positive('Amount must be greater than zero')
  .max(100_000_000, 'Amount is too large')
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most two decimal places');

export const transactionFormSchema = z
  .object({
    type: z.enum(['income', 'expense']),
    amount: moneyAmount,
    category: z.enum([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES] as [string, ...string[]]),
    description: z.string().trim().min(1, 'Add a short description').max(500, 'Keep this under 500 characters'),
    date: dateKey,
    time,
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = v.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    if (!allowed.includes(v.category)) ctx.addIssue({ code: 'custom', path: ['category'], message: `Choose a ${v.type} category` });
  });

const optionalNumber = (label: string, max: number, opts: { positive?: boolean } = {}) =>
  z
    .number({ error: `${label} must be a number` })
    .min(0, `${label} can't be negative`)
    .max(max, `${label} looks too large`)
    .nullable()
    .refine((n) => !opts.positive || n === null || n > 0, `${label} must be greater than zero`);

export const foodItemFormSchema = z.object({
  foodName: z.string().trim().min(1, 'Name the food').max(200),
  quantity: z.number({ error: 'Quantity must be a number' }).positive('Quantity must be greater than zero').max(100_000).nullable(),
  unit: optionalText(40),
  caloriesKcal: optionalNumber('Calories', 20_000),
  proteinG: optionalNumber('Protein', 1_000),
});

export const mealFormSchema = z.object({
  mealType: z.enum(MEAL_TYPES),
  date: dateKey,
  time,
  notes: optionalText(500),
  items: z.array(foodItemFormSchema).min(1, 'Add at least one food').max(25, 'A meal can hold up to 25 foods'),
});

export const weighInFormSchema = z.object({
  value: z.number({ error: 'Enter your weight' }).positive('Weight must be greater than zero').max(2_000, 'That weight looks too high'),
  date: dateKey,
  time,
  notes: optionalText(500),
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Add a display name').max(60, 'Keep this under 60 characters'),
  timezone: z.string().refine(isValidTimezone, 'Choose a valid timezone'),
});

export const bulkingSettingsSchema = z.object({
  dailyCalorieTarget: z
    .number({ error: 'Calories must be a number' })
    .int('Use a whole number')
    .min(1, 'Must be at least 1')
    .max(20_000, 'Must be 20,000 or less')
    .nullable(),
  dailyProteinTargetG: z.number({ error: 'Protein must be a number' }).min(0).max(1_000, 'Must be 1,000 g or less').nullable(),
  targetWeightKg: z.number({ error: 'Weight must be a number' }).min(1).max(1_000).nullable(),
  weightUnit: z.enum(['kg', 'lb']),
});

export const budgetSettingsSchema = z.object({
  monthlyBudget: z.number({ error: 'Budget must be a number' }).min(0, "Budget can't be negative").max(100_000_000).nullable(),
  openingBalance: z.number({ error: 'Balance must be a number' }).min(0, "Opening balance can't be negative").max(100_000_000),
});
