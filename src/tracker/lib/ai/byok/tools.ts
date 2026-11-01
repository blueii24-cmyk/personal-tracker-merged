import { z } from 'zod';
import { categoryTotals, filterTransactions, lastNDaysRange, totalByType, trackedBalance, budgetSummary } from '@/tracker/features/transactions/calculations';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { nutritionTotals } from '@/tracker/features/meals/calculations';
import { changeAcross, weighInsInRange, weightSummary } from '@/tracker/features/weigh-ins/calculations';
import { TrackerError } from '@/tracker/lib/api/errors';
import type { TrackerService } from '@/tracker/lib/api/tracker-service';
import { formatRupees } from '@/tracker/lib/formatting/currency';
import { addDays, dateKeyInTz, diffDays, isDateKey, monthKeyInTz, monthRange, todayKey } from '@/tracker/lib/formatting/dates';
import { formatNumber, formatWeight } from '@/tracker/lib/formatting/nutrition';
import type { AiActionStatus } from '@/tracker/types/api';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, MEAL_TYPES,
  type ActionPayload, type DateKey, type FoodItemInput, type Meal, type MealInput, type Transaction, type TransactionCategory,
  type TransactionInput, type UserSettings, type WeighIn,
} from '@/tracker/types/domain';
import { INVALID_ARGS } from './http';

export const WEIGHT_MIN_KG = 20;
export const WEIGHT_MAX_KG = 300;

export interface ToolEnv {
  service: TrackerService;
  settings: UserSettings;
  now: Date;
}

export type Invalidation = 'nutrition' | 'finance' | 'weight' | 'history';

export interface ToolOutcome {
  status: AiActionStatus;
  /** Short line shown on the action card. */
  summary: string;
  /** What the model is told. Always an object so every provider can carry it. */
  modelContent: Record<string, unknown>;
  recordIds?: string[];
  payload?: ActionPayload;
  write: boolean;
  invalidation: Invalidation[];
}

/* ------------------------------ arg schemas ------------------------------ */

/** Models sometimes send numbers as strings; accept clean numeric strings and nothing else. */
const num = z.preprocess((v) => (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : v), z.number({ error: 'must be a number' }).finite());
const text = (max: number) => z.string().trim().max(max);
const isoStamp = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), 'must be an ISO-8601 timestamp with a UTC offset, e.g. 2026-10-31T13:00:00+05:30');
const dateKey = z.string().refine(isDateKey, 'must be a date like 2026-10-31');
const money = num.refine((n) => n > 0, 'must be greater than zero').refine((n) => n <= 100_000_000, 'is too large').refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'can have at most two decimal places');
const allCategories = z.enum([...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])] as [TransactionCategory, ...TransactionCategory[]]);
const id = z.string().trim().min(1).max(100);

const mealItem = z.object({
  food_name: text(200).min(1),
  quantity: num.refine((n) => n > 0, 'must be greater than zero').nullish(),
  unit: text(40).nullish(),
  calories_kcal: num.refine((n) => n >= 0 && n <= 5000, 'must be between 0 and 5000').nullish(),
  protein_g: num.refine((n) => n >= 0 && n <= 500, 'must be between 0 and 500').nullish(),
});

export const SCHEMAS = {
  log_meal: z.object({ meal_type: z.enum(MEAL_TYPES), eaten_at: isoStamp.nullish(), notes: text(500).nullish(), items: z.array(mealItem).min(1).max(25) }),
  add_money_transaction: z.object({
    transaction_type: z.enum(['income', 'expense']),
    amount: money,
    currency: z.literal('INR').nullish(),
    category: allCategories,
    description: text(500).min(1),
    merchant: text(200).nullish(),
    occurred_at: isoStamp.nullish(),
  }),
  log_weight: z.object({ weight_kg: num, recorded_at: isoStamp.nullish(), notes: text(500).nullish() }),
  get_summary: z.object({
    domain: z.enum(['all', 'nutrition', 'finance', 'weight']),
    period: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'last_7_days', 'last_30_days', 'custom']),
    start_date: dateKey.nullish(),
    end_date: dateKey.nullish(),
  }),
  search_entries: z.object({
    domain: z.enum(['meals', 'transactions', 'weight']),
    query: text(200).min(1),
    start_date: dateKey.nullish(),
    end_date: dateKey.nullish(),
    limit: num.refine((n) => Number.isInteger(n) && n >= 1 && n <= 10, 'must be a whole number from 1 to 10').nullish(),
  }),
  update_transaction: z.object({
    id,
    changes: z
      .object({
        transaction_type: z.enum(['income', 'expense']).nullish(),
        amount: money.nullish(),
        category: allCategories.nullish(),
        description: text(500).min(1).nullish(),
        merchant: text(200).nullish(),
        occurred_at: isoStamp.nullish(),
      })
      .refine((c) => Object.values(c).some((v) => v != null), 'must change at least one field'),
  }),
  update_meal: z.object({
    id,
    changes: z
      .object({ meal_type: z.enum(MEAL_TYPES).nullish(), eaten_at: isoStamp.nullish(), notes: text(500).nullish() })
      .refine((c) => Object.values(c).some((v) => v != null), 'must change at least one field'),
  }),
  update_weight: z.object({
    id,
    changes: z
      .object({ weight_kg: num.nullish(), recorded_at: isoStamp.nullish(), notes: text(500).nullish() })
      .refine((c) => Object.values(c).some((v) => v != null), 'must change at least one field'),
  }),
} as const;

export type ToolName = keyof typeof SCHEMAS;
export const isToolName = (n: string): n is ToolName => Object.hasOwn(SCHEMAS, n);
const WRITE_TOOLS = new Set<string>(['log_meal', 'add_money_transaction', 'log_weight', 'update_transaction', 'update_meal', 'update_weight']);
export const isWriteTool = (n: string) => WRITE_TOOLS.has(n);

/* -------------------------------- helpers -------------------------------- */

const reject = (summary: string, modelContent: Record<string, unknown> = {}, status: AiActionStatus = 'rejected'): ToolOutcome => ({
  status, summary, modelContent: { ok: false, error: summary, ...modelContent }, write: false, invalidation: [],
});

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Returns an error if the instant is implausible (future, or more than ~13 months back). */
function whenError(iso: string, now: Date): string | null {
  const t = Date.parse(iso);
  if (t > now.getTime() + 10 * 60_000) return `${iso} is in the future. Only log things that already happened.`;
  if (t < now.getTime() - 400 * 86_400_000) return `${iso} is more than a year ago. Check the date with the user.`;
  return null;
}
const instant = (iso: string | null | undefined, now: Date) => (iso ? new Date(iso).toISOString() : now.toISOString());

function categoryFits(type: 'income' | 'expense', c: TransactionCategory): boolean {
  return (type === 'expense' ? (EXPENSE_CATEGORIES as readonly string[]) : (INCOME_CATEGORIES as readonly string[])).includes(c);
}
const categoryHelp = (type: 'income' | 'expense') => ({ valid_categories: type === 'expense' ? [...EXPENSE_CATEGORIES] : [...INCOME_CATEGORIES] });

function mealToModel(m: Meal, tz: string) {
  const t = nutritionTotals([m]);
  return {
    id: m.id,
    meal_type: m.mealType,
    date: dateKeyInTz(m.eatenAt, tz),
    eaten_at: m.eatenAt,
    items: m.items.map((i) => ({ food: i.foodName, quantity: i.quantity, unit: i.unit, kcal: i.caloriesKcal, protein_g: i.proteinG })),
    known_kcal: t.caloriesKcal,
    known_protein_g: round1(t.proteinG),
    items_without_calories: t.unknownCalorieItems,
    notes: m.notes,
  };
}
const txToModel = (t: Transaction, tz: string) => ({
  id: t.id, type: t.type, amount_inr: t.amount, category: t.category, description: t.description, merchant: t.merchant, date: dateKeyInTz(t.occurredAt, tz), occurred_at: t.occurredAt,
});
const weighInToModel = (w: WeighIn, tz: string) => ({ id: w.id, weight_kg: w.weightKg, date: dateKeyInTz(w.recordedAt, tz), recorded_at: w.recordedAt, notes: w.notes });

const mealToInput = (m: Meal): MealInput => ({
  mealType: m.mealType, eatenAt: m.eatenAt, notes: m.notes, items: m.items.map(({ id: _id, ...rest }): FoodItemInput => rest),
});

/* ------------------------------- executors ------------------------------- */

async function logMeal(a: z.infer<typeof SCHEMAS.log_meal>, env: ToolEnv): Promise<ToolOutcome> {
  const eatenAt = instant(a.eaten_at, env.now);
  const bad = a.eaten_at ? whenError(a.eaten_at, env.now) : null;
  if (bad) return reject(bad);
  const items: FoodItemInput[] = a.items.map((i) => {
    const kcal = i.calories_kcal ?? null;
    const pro = i.protein_g ?? null;
    const known = kcal != null || pro != null;
    return {
      foodName: i.food_name, quantity: i.quantity ?? null, unit: i.unit?.trim() || null,
      caloriesKcal: kcal == null ? null : Math.round(kcal), proteinG: pro == null ? null : round1(pro),
      isEstimate: known, nutritionSource: known ? 'ai_estimate' : 'unknown',
    };
  });
  const meal = await env.service.createMeal({ mealType: a.meal_type, eatenAt, notes: a.notes?.trim() || null, items }, { source: 'ai' });
  const totals = nutritionTotals([meal]);
  const kcalText = totals.unknownCalorieItems === meal.items.length ? 'nutrition unknown' : `~${formatNumber(totals.caloriesKcal)} kcal`;
  return {
    status: 'succeeded',
    summary: `${cap(meal.mealType)} · ${meal.items.length} ${meal.items.length === 1 ? 'item' : 'items'} · ${kcalText}`,
    modelContent: { ok: true, saved: mealToModel(meal, env.settings.timezone), note: 'Nutrition values are estimates. Items without numbers are stored as unknown, not zero.' },
    recordIds: [meal.id],
    payload: { kind: 'meal', operation: 'created', mealId: meal.id },
    write: true,
    invalidation: ['nutrition', 'history'],
  };
}

async function addTransaction(a: z.infer<typeof SCHEMAS.add_money_transaction>, env: ToolEnv): Promise<ToolOutcome> {
  if (!categoryFits(a.transaction_type, a.category)) {
    return reject(`"${a.category}" is not a ${a.transaction_type} category.`, categoryHelp(a.transaction_type));
  }
  const bad = a.occurred_at ? whenError(a.occurred_at, env.now) : null;
  if (bad) return reject(bad);
  const input: TransactionInput = {
    type: a.transaction_type, amount: Math.round(a.amount * 100) / 100, category: a.category, description: a.description,
    merchant: a.merchant?.trim() || null, notes: null, occurredAt: instant(a.occurred_at, env.now),
  };
  const tx = await env.service.createTransaction(input, { source: 'ai' });
  return {
    status: 'succeeded',
    summary: `${cap(tx.type)} · ${formatRupees(tx.amount)} · ${categoryLabel(tx.category)}`,
    modelContent: { ok: true, saved: txToModel(tx, env.settings.timezone) },
    recordIds: [tx.id],
    payload: { kind: 'transaction', operation: 'created', transactionId: tx.id },
    write: true,
    invalidation: ['finance', 'history'],
  };
}

function weightProblem(kg: number): string | null {
  return kg >= WEIGHT_MIN_KG && kg <= WEIGHT_MAX_KG ? null : `${kg} kg is outside ${WEIGHT_MIN_KG}–${WEIGHT_MAX_KG} kg. Ask the user to confirm the number and the unit.`;
}

async function logWeight(a: z.infer<typeof SCHEMAS.log_weight>, env: ToolEnv): Promise<ToolOutcome> {
  const problem = weightProblem(a.weight_kg) ?? (a.recorded_at ? whenError(a.recorded_at, env.now) : null);
  if (problem) return reject(problem, {}, 'needs_clarification');
  const w = await env.service.createWeighIn({ weightKg: Math.round(a.weight_kg * 100) / 100, recordedAt: instant(a.recorded_at, env.now), notes: a.notes?.trim() || null }, { source: 'ai' });
  return {
    status: 'succeeded',
    summary: `Weight · ${formatWeight(w.weightKg, env.settings.weightUnit)}`,
    modelContent: { ok: true, saved: weighInToModel(w, env.settings.timezone) },
    recordIds: [w.id],
    payload: { kind: 'weigh_in', operation: 'created', weighInId: w.id },
    write: true,
    invalidation: ['weight', 'history'],
  };
}

function periodRange(a: z.infer<typeof SCHEMAS.get_summary>, today: DateKey, tz: string, now: Date): { from: DateKey; to: DateKey; label: string } | string {
  switch (a.period) {
    case 'today': return { from: today, to: today, label: 'today' };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y, label: 'yesterday' }; }
    case 'last_7_days': return { ...lastNDaysRange(today, 7), label: 'the last 7 days' };
    case 'last_30_days': return { ...lastNDaysRange(today, 30), label: 'the last 30 days' };
    case 'this_month': { const r = monthRange(monthKeyInTz(now, tz)); return { from: r.from, to: today, label: 'this month so far' }; }
    case 'this_week': {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      return { from: addDays(today, -((dow + 6) % 7)), to: today, label: 'this week (Monday to today)' };
    }
    case 'custom': {
      if (!a.start_date || !a.end_date) return 'period "custom" needs both start_date and end_date.';
      if (a.start_date > a.end_date) return 'start_date must not be after end_date.';
      if (diffDays(a.end_date, a.start_date) > 366) return 'The date range is limited to one year.';
      return { from: a.start_date, to: a.end_date, label: `${a.start_date} to ${a.end_date}` };
    }
  }
}

async function getSummary(a: z.infer<typeof SCHEMAS.get_summary>, env: ToolEnv): Promise<ToolOutcome> {
  const tz = env.settings.timezone;
  const today = todayKey(tz, env.now);
  const r = periodRange(a, today, tz, env.now);
  if (typeof r === 'string') return reject(r);
  const range = { from: r.from, to: r.to };
  const days = diffDays(r.to, r.from) + 1;
  const out: Record<string, unknown> = { ok: true, period: r.label, from: r.from, to: r.to, days };
  const s = env.settings;

  if (a.domain === 'all' || a.domain === 'nutrition') {
    const meals = await env.service.getMeals(range);
    const t = nutritionTotals(meals);
    out.nutrition = {
      meals: t.mealCount, known_kcal: Math.round(t.caloriesKcal), known_protein_g: round1(t.proteinG),
      items_without_calories: t.unknownCalorieItems, items_without_protein: t.unknownProteinItems, values_are_estimates: t.hasEstimates,
      ...(days > 1 ? { avg_kcal_per_day_with_meals: meals.length ? Math.round(t.caloriesKcal / new Set(meals.map((m) => dateKeyInTz(m.eatenAt, tz))).size) : null } : {}),
      target_kcal: s.dailyCalorieTarget, target_protein_g: s.dailyProteinTargetG,
      ...(days === 1 && s.dailyCalorieTarget != null ? { kcal_remaining_vs_target: Math.round(s.dailyCalorieTarget - t.caloriesKcal) } : {}),
      ...(days === 1 && s.dailyProteinTargetG != null ? { protein_g_remaining_vs_target: round1(s.dailyProteinTargetG - t.proteinG) } : {}),
    };
  }
  if (a.domain === 'all' || a.domain === 'finance') {
    const [inRange, everything] = await Promise.all([env.service.getTransactions({ range }), env.service.getTransactions()]);
    const income = totalByType(inRange, 'income');
    const expenses = totalByType(inRange, 'expense');
    const fin: Record<string, unknown> = {
      income_inr: income, expenses_inr: expenses, net_inr: Math.round((income - expenses) * 100) / 100, transactions: inRange.length,
      top_expense_categories: categoryTotals(inRange).slice(0, 5).map((c) => ({ category: c.category, amount_inr: c.amount, count: c.count })),
      tracked_balance_inr: trackedBalance(everything, s.openingBalance),
      tracked_balance_note: 'Opening balance + all recorded income - all recorded expenses. Not a bank balance.',
    };
    if (a.period === 'this_month') {
      const b = budgetSummary(everything, monthKeyInTz(env.now, tz), s.monthlyBudget, tz);
      fin.monthly_budget_inr = b.monthlyBudget;
      fin.budget_remaining_inr = b.budgetRemaining;
    }
    out.finance = fin;
  }
  if (a.domain === 'all' || a.domain === 'weight') {
    const [inRange, all] = await Promise.all([env.service.getWeighIns(range), env.service.getWeighIns()]);
    const latest = weightSummary(all).latest;
    out.weight = {
      readings_in_period: inRange.length,
      change_in_period_kg: changeAcross(inRange),
      latest_overall: latest ? { weight_kg: latest.weightKg, date: dateKeyInTz(latest.recordedAt, tz) } : null,
      target_weight_kg: s.targetWeightKg,
    };
  }
  return {
    status: 'succeeded', summary: `${cap(a.domain)} · ${r.label}`, modelContent: out, write: false, invalidation: [],
    payload: { kind: 'summary', domain: a.domain },
  };
}

const WILDCARD = new Set(['all', '*', 'any', 'everything', 'recent', 'latest']);
function matcher(query: string): (hay: string) => number {
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}₹.]+/u).filter((t) => t.length > 0);
  if (!tokens.length || tokens.every((t) => WILDCARD.has(t))) return () => 1;
  const real = tokens.filter((t) => !WILDCARD.has(t));
  return (hay) => {
    const h = hay.toLowerCase();
    return real.filter((t) => h.includes(t)).length;
  };
}

async function searchEntries(a: z.infer<typeof SCHEMAS.search_entries>, env: ToolEnv): Promise<ToolOutcome> {
  const tz = env.settings.timezone;
  const range = { from: a.start_date ?? undefined, to: a.end_date ?? undefined };
  const limit = a.limit ?? 5;
  const score = matcher(a.query);
  let results: unknown[] = [];
  let total = 0;

  if (a.domain === 'meals') {
    const meals = await env.service.getMeals(range);
    const hits = meals
      .map((m) => ({ m, s: score(`${m.mealType} ${m.notes ?? ''} ${m.items.map((i) => i.foodName).join(' ')}`) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || y.m.eatenAt.localeCompare(x.m.eatenAt));
    total = hits.length;
    results = hits.slice(0, limit).map((x) => mealToModel(x.m, tz));
  } else if (a.domain === 'transactions') {
    const txs = filterTransactions(await env.service.getTransactions({ range }), {}, tz);
    const hits = txs
      .map((t) => ({ t, s: score(`${t.description} ${t.merchant ?? ''} ${t.notes ?? ''} ${categoryLabel(t.category)} ${t.category} ${t.type} ${t.amount}`) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || y.t.occurredAt.localeCompare(x.t.occurredAt));
    total = hits.length;
    results = hits.slice(0, limit).map((x) => txToModel(x.t, tz));
  } else {
    const ws = weighInsInRange(await env.service.getWeighIns(), range.from, range.to, tz)
      .map((w) => ({ w, s: score(`${w.notes ?? ''} ${w.weightKg} ${dateKeyInTz(w.recordedAt, tz)}`) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.w.recordedAt.localeCompare(x.w.recordedAt));
    total = ws.length;
    results = ws.slice(0, limit).map((x) => weighInToModel(x.w, tz));
  }
  return {
    status: 'succeeded', summary: `Searched ${a.domain} · ${total} found`,
    modelContent: { ok: true, domain: a.domain, total_matches: total, returned: results.length, results, ...(total === 0 ? { hint: 'Nothing matched. Try a shorter query or a wider date range, or ask the user.' } : {}) },
    write: false, invalidation: [],
  };
}

async function updateTransaction(a: z.infer<typeof SCHEMAS.update_transaction>, env: ToolEnv): Promise<ToolOutcome> {
  const prev = (await env.service.getTransactions()).find((t) => t.id === a.id);
  if (!prev) return reject('No transaction with that id. Use search_entries to find the exact id first.');
  const c = a.changes;
  const type = c.transaction_type ?? prev.type;
  const category = c.category ?? prev.category;
  if (!categoryFits(type, category)) {
    return reject(`"${category}" is not a ${type} category. Send a matching category in the same change.`, categoryHelp(type));
  }
  const bad = c.occurred_at ? whenError(c.occurred_at, env.now) : null;
  if (bad) return reject(bad);
  const next: TransactionInput = {
    type, category, amount: c.amount != null ? Math.round(c.amount * 100) / 100 : prev.amount, description: c.description ?? prev.description,
    merchant: c.merchant !== undefined && c.merchant !== null ? c.merchant.trim() || null : prev.merchant, notes: prev.notes, occurredAt: c.occurred_at ? new Date(c.occurred_at).toISOString() : prev.occurredAt,
  };
  const tx = await env.service.updateTransaction(prev.id, next);
  const amountChanged = tx.amount !== prev.amount;
  return {
    status: 'succeeded',
    summary: amountChanged ? `Updated · ${formatRupees(tx.amount)} (was ${formatRupees(prev.amount)})` : `Updated · ${tx.description}`,
    modelContent: { ok: true, before: txToModel(prev, env.settings.timezone), after: txToModel(tx, env.settings.timezone) },
    recordIds: [tx.id],
    payload: { kind: 'transaction', operation: 'updated', transactionId: tx.id, ...(amountChanged ? { previousAmount: prev.amount } : {}) },
    write: true,
    invalidation: ['finance', 'history'],
  };
}

async function updateMeal(a: z.infer<typeof SCHEMAS.update_meal>, env: ToolEnv): Promise<ToolOutcome> {
  const prev = (await env.service.getMeals()).find((m) => m.id === a.id);
  if (!prev) return reject('No meal with that id. Use search_entries to find the exact id first.');
  const c = a.changes;
  const bad = c.eaten_at ? whenError(c.eaten_at, env.now) : null;
  if (bad) return reject(bad);
  const input: MealInput = {
    ...mealToInput(prev),
    mealType: c.meal_type ?? prev.mealType,
    eatenAt: c.eaten_at ? new Date(c.eaten_at).toISOString() : prev.eatenAt,
    notes: c.notes != null ? c.notes.trim() || null : prev.notes,
  };
  const meal = await env.service.updateMeal(prev.id, input);
  return {
    status: 'succeeded', summary: `Updated · ${cap(meal.mealType)}`,
    modelContent: { ok: true, before: mealToModel(prev, env.settings.timezone), after: mealToModel(meal, env.settings.timezone), note: 'Food items were not changed. The user can edit foods in History.' },
    recordIds: [meal.id], payload: { kind: 'meal', operation: 'updated', mealId: meal.id }, write: true, invalidation: ['nutrition', 'history'],
  };
}

async function updateWeight(a: z.infer<typeof SCHEMAS.update_weight>, env: ToolEnv): Promise<ToolOutcome> {
  const prev = (await env.service.getWeighIns()).find((w) => w.id === a.id);
  if (!prev) return reject('No weight entry with that id. Use search_entries to find the exact id first.');
  const c = a.changes;
  const kg = c.weight_kg ?? prev.weightKg;
  const problem = (c.weight_kg != null ? weightProblem(kg) : null) ?? (c.recorded_at ? whenError(c.recorded_at, env.now) : null);
  if (problem) return reject(problem, {}, 'needs_clarification');
  const w = await env.service.updateWeighIn(prev.id, {
    weightKg: Math.round(kg * 100) / 100, recordedAt: c.recorded_at ? new Date(c.recorded_at).toISOString() : prev.recordedAt, notes: c.notes != null ? c.notes.trim() || null : prev.notes,
  });
  return {
    status: 'succeeded', summary: `Updated · ${formatWeight(w.weightKg, env.settings.weightUnit)}`,
    modelContent: { ok: true, before: weighInToModel(prev, env.settings.timezone), after: weighInToModel(w, env.settings.timezone) },
    recordIds: [w.id], payload: { kind: 'weigh_in', operation: 'updated', weighInId: w.id }, write: true, invalidation: ['weight', 'history'],
  };
}

/* ------------------------------- dispatcher ------------------------------- */

function issuesText(e: z.ZodError): string[] {
  return e.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`);
}

/** Validate the model's arguments independently, then run the tool. Never throws: every failure becomes a result the model can read. */
export async function executeTool(name: string, rawArgs: Record<string, unknown>, env: ToolEnv): Promise<ToolOutcome> {
  if (!isToolName(name)) return reject(`Unknown tool "${name}". Available tools: ${Object.keys(SCHEMAS).join(', ')}.`);
  if (INVALID_ARGS in rawArgs) return reject(String(rawArgs[INVALID_ARGS]), { hint: 'Send the arguments again as a valid JSON object.' });
  const parsed = SCHEMAS[name].safeParse(rawArgs);
  if (!parsed.success) {
    const issues = issuesText(parsed.error);
    return reject(`Invalid arguments — ${issues[0]}`, { issues }, 'needs_clarification');
  }
  try {
    switch (name) {
      case 'log_meal': return await logMeal(parsed.data as z.infer<typeof SCHEMAS.log_meal>, env);
      case 'add_money_transaction': return await addTransaction(parsed.data as z.infer<typeof SCHEMAS.add_money_transaction>, env);
      case 'log_weight': return await logWeight(parsed.data as z.infer<typeof SCHEMAS.log_weight>, env);
      case 'get_summary': return await getSummary(parsed.data as z.infer<typeof SCHEMAS.get_summary>, env);
      case 'search_entries': return await searchEntries(parsed.data as z.infer<typeof SCHEMAS.search_entries>, env);
      case 'update_transaction': return await updateTransaction(parsed.data as z.infer<typeof SCHEMAS.update_transaction>, env);
      case 'update_meal': return await updateMeal(parsed.data as z.infer<typeof SCHEMAS.update_meal>, env);
      case 'update_weight': return await updateWeight(parsed.data as z.infer<typeof SCHEMAS.update_weight>, env);
    }
  } catch (e) {
    if (e instanceof TrackerError && e.code === 'ABORTED') throw e;
    const message = e instanceof TrackerError ? e.message : 'The app could not save that.';
    return { status: 'failed', summary: message, modelContent: { ok: false, error: message }, write: false, invalidation: [] };
  }
}
