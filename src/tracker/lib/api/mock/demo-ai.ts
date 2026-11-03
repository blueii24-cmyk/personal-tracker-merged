/**
 * Deterministic stand-in for the real AI backend. It only understands a handful of phrasings and
 * will ask (or decline) rather than invent amounts or nutrition. It never talks to a network.
 * Answers about totals are calculated from saved records, not from conversational memory.
 */
import { categoryTotals, budgetSummary, trackedBalance, transactionsInMonth } from '@/tracker/features/transactions/calculations';
import { mealsOnDate, nutritionTotals, progressOf } from '@/tracker/features/meals/calculations';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { weightSummary } from '@/tracker/features/weigh-ins/calculations';
import {
  addDays, dateKeyInTz, formatDayMonth, formatLongDate, formatMonthLabel, formatRelativeDayInline, formatTime, hourInTz,
  monthKeyInTz, todayKey, zonedToIso,
} from '@/tracker/lib/formatting/dates';
import { formatRupees } from '@/tracker/lib/formatting/currency';
import { formatGrams, formatKcal, formatNumber, formatWeight, nutritionCaveat, unitToKg } from '@/tracker/lib/formatting/nutrition';
import { TrackerError } from '@/tracker/lib/api/errors';
import type { AiActionResult } from '@/tracker/types/api';
import type {
  ActionPayload, DateKey, ExpenseCategory, IncomeCategory, Meal, MealInput, MealType, NutritionTotals, Transaction,
  TransactionCategory, TransactionInput, TransactionType, UserSettings, WeighIn, WeighInInput,
} from '@/tracker/types/domain';
import { parseFoodSegment, toFoodItem } from './food-database';

type Invalidation = Array<'nutrition' | 'finance' | 'weight' | 'history'>;
export type DemoAction = Omit<AiActionResult, 'toolCallId'>;

export interface DemoAiContext {
  now: Date;
  settings: UserSettings;
  meals: readonly Meal[];
  transactions: readonly Transaction[];
  weighIns: readonly WeighIn[];
  createMeal(input: MealInput): Meal;
  createTransaction(input: TransactionInput): Transaction;
  createWeighIn(input: WeighInInput): WeighIn;
  updateTransaction(id: string, input: TransactionInput): Transaction;
  updateWeighIn(id: string, input: WeighInInput): WeighIn;
}

export interface DemoAiResult {
  assistantMessage: string;
  actions: DemoAction[];
  invalidation: Invalidation;
}

const reply = (assistantMessage: string, actions: DemoAction[] = [], invalidation: Invalidation = []): DemoAiResult => ({
  assistantMessage, actions, invalidation,
});

/* ------------------------------ text helpers ------------------------------ */

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

interface DateRef { key: DateKey; explicit: boolean; matched: string | null }
function resolveDate(text: string, today: DateKey): DateRef {
  const t = text.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\bday before yesterday\b/))) return { key: addDays(today, -2), explicit: true, matched: m[0] };
  if ((m = t.match(/\b(yesterday|last night)(?:'s)?\b/))) return { key: addDays(today, -1), explicit: true, matched: m[0] };
  if ((m = t.match(/\b(\d{1,2}) days? ago\b/))) return { key: addDays(today, -Number(m[1])), explicit: true, matched: m[0] };
  if ((m = t.match(/\b(today|tonight|this morning|this afternoon|this evening)(?:'s)?\b/))) return { key: today, explicit: true, matched: m[0] };
  return { key: today, explicit: false, matched: null };
}

const DEFAULT_TIMES: Record<MealType, string> = { breakfast: '08:30', lunch: '13:00', snack: '17:00', dinner: '20:30', other: '12:00' };
function instantFor(date: DateRef, today: DateKey, now: Date, tz: string, fallbackTime = '12:00'): string {
  if (date.key === today) return now.toISOString();
  return zonedToIso(date.key, fallbackTime, tz);
}

interface Amount { value: number; matched: string }
function parseAmount(text: string): Amount | null {
  const num = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k\\b)?';
  const patterns = [
    new RegExp(`(?:₹|rs\\.?\\s*|inr\\s*)\\s*${num}`, 'i'),
    new RegExp(`${num}\\s*(?:rupees?|rs\\b\\.?|inr\\b|₹)`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const v = Number(m[1]!.replace(/,/g, '')) * (m[2] ? 1000 : 1);
      if (Number.isFinite(v)) return { value: Math.round(v * 100) / 100, matched: m[0] };
    }
  }
  // Bare number right after a money verb: "spent 60 on bus"
  const bare = text.match(/\b(?:spent|paid|received|got|earned|bought|cost)\s+(\d[\d,]*(?:\.\d+)?)\b(?!\s*(?:kg|kgs|lb|lbs|g|ml|%|eggs?|bananas?))/i);
  if (bare) return { value: Number(bare[1]!.replace(/,/g, '')), matched: bare[1]! };
  return null;
}

const EXPENSE_KEYWORDS: Array<[RegExp, ExpenseCategory]> = [
  [/\b(bus|auto|metro|train|uber|ola|cab|taxi|travel(?:l?ing|led)?|commute|fare|petrol|fuel|rickshaw|ticket to)\b/, 'transport'],
  [/\b(recharge|recharged|data pack|prepaid|postpaid|sim)\b/, 'mobile_recharge'],
  [/\b(college|tuition|exam|stationery|notebook|books?|printouts?|xerox|photocopy|lab|library|semester)\b/, 'college'],
  [/\b(netflix|spotify|prime|hotstar|youtube premium|subscription|subscribed|icloud|membership)\b/, 'subscriptions'],
  [/\b(movie|cinema|game|games|gaming|concert|outing|party)\b/, 'entertainment'],
  [/\b(shirt|t-shirt|jeans|shoes|clothes|clothing|shopping|amazon|flipkart|myntra|bag|watch)\b/, 'shopping'],
  [/\b(medicine|medicines|doctor|clinic|pharmacy|hospital|gym|checkup)\b/, 'health'],
  [/\b(food|lunch|dinner|breakfast|snacks?|tea|chai|coffee|canteen|biryani|pizza|burger|juice|groceries|grocery|restaurant|cafe|samosa|meal)\b/, 'food'],
];
const INCOME_KEYWORDS: Array<[RegExp, IncomeCategory]> = [
  [/\b(pocket money|allowance)\b/, 'pocket_money'],
  [/\b(salary|stipend|paycheck|wages?)\b/, 'salary'],
  [/\b(gift|gifted|birthday|eidi)\b/, 'gift'],
  [/\b(refund|refunded|cashback|reimburse\w*)\b/, 'refund'],
];

function inferCategory(text: string, type: TransactionType): TransactionCategory | null {
  const t = text.toLowerCase();
  const list = (type === 'expense' ? EXPENSE_KEYWORDS : INCOME_KEYWORDS) as Array<[RegExp, TransactionCategory]>;
  for (const [re, cat] of list) if (re.test(t)) return cat;
  return null;
}

function describeTransaction(text: string, amount: Amount, fallback: string): string {
  let d = text.replace(amount.matched, ' ');
  d = d.replace(/\b(day before yesterday|yesterday(?:'s)?|last night|today(?:'s)?|tonight|this (?:morning|afternoon|evening)|\d{1,2} days? ago)\b/gi, ' ');
  d = d.replace(/^(?:\s*(?:i|we|just|have|had|ve|'ve|also|please|log|add|record|note|that)\b)+/gi, ' ');
  d = d.replace(/^\s*(?:spent|spend|paid|pay|bought|buy|purchased|received|receive|got|earned|credited|recorded)\b/gi, ' ');
  d = d.replace(/^\s*(?:on|for|towards|from|as|in|at)\b/gi, ' ');
  d = d.replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  d = d.replace(/^(?:on|for|towards|from|as|in|at|to)\s+/i, '').trim();
  return d ? cap(d).slice(0, 100) : fallback;
}

/* ---------------------------------- main ---------------------------------- */

export function runDemoAssistant(rawMessage: string, ctx: DemoAiContext): DemoAiResult {
  const message = norm(rawMessage);
  const lower = message.toLowerCase();
  const tz = ctx.settings.timezone;
  const today = todayKey(tz, ctx.now);

  if (/simulate (?:an? )?error/.test(lower)) {
    throw new TrackerError('PROVIDER_UNAVAILABLE', 'The assistant is temporarily unavailable. Nothing was saved.', { retryable: true });
  }

  const isQuestion = /^(how|what|what's|whats|show|tell|give|summari[sz]e|summary|review|total|list|do i|did i|have i|am i|is my|are my|where|can you tell)\b/.test(lower) || lower.endsWith('?');
  const isCorrection = /\b(correct|change|update|fix|edit|modify|amend|set)\b/.test(lower) && /\d/.test(lower) && !isQuestion;
  const isDelete = /\b(delete|remove|erase|undo|cancel)\b/.test(lower) && !isQuestion;

  if (/^(hi|hello|hey|hii|yo|good (?:morning|afternoon|evening))\b[\s!.]*$/.test(lower) || /\b(what can you do|help|how do (?:i|you) use)\b/.test(lower)) {
    return reply(HELP_TEXT);
  }
  if (isDelete) {
    return reply("I can't delete records from chat yet. Open History, find the entry and use Delete — it asks you to confirm first, and you can undo straight afterwards.");
  }
  if (isCorrection) return handleCorrection(message, ctx, today);
  if (isQuestion) return handleQuestion(message, ctx, today);

  const amount = parseAmount(message);
  const hasWeightWord = /\bweigh(?:t|ed|s|ing)?\b/.test(lower);
  const incomeVerb = /\b(received|receive|got|earned|credited|salary|pocket money|allowance|income|stipend|refund(?:ed)?|gifted|cashback)\b/.test(lower);
  const expenseVerb = /\b(spent|spend|paid|pay|bought|buy|purchased|cost|costs|recharged|expense)\b/.test(lower);

  if (hasWeightWord) return handleWeight(message, ctx, today);
  if (incomeVerb && !expenseVerb) return handleTransaction('income', message, amount, ctx, today);
  if (expenseVerb || (amount && !incomeVerb && /\b(for|on)\b/.test(lower))) return handleTransaction('expense', message, amount, ctx, today);

  const eatsVerb = /\b(ate|eaten|eat|had|have|drank|drink|drunk|consumed|having|eating)\b/.test(lower);
  const mealWord = /\b(breakfast|lunch|dinner|snack|brunch)\b/.test(lower);
  if (eatsVerb || mealWord) return handleMeal(message, ctx, today);

  return reply(
    "I'm not sure what you'd like me to do with that. I can log a meal, an expense or income, or your weight, and answer questions about your totals. Try \"I had two rotis and a bowl of dal\", \"I spent ₹60 on bus fare\" or \"My weight is 48.2 kg\".",
  );
}

const HELP_TEXT =
  "I can log what you eat, what you spend or receive, and your weight, then answer questions from your saved records. For example: \"I ate three eggs and a glass of milk\", \"I spent ₹60 travelling to college\", \"I received ₹2,000 pocket money\", \"My weight is 48.2 kg today\", \"How much protein have I eaten today?\" or \"Correct yesterday's travel expense to ₹30\". This built-in assistant uses on-device rules, so it understands a limited set of phrasings.";

/* --------------------------------- meals --------------------------------- */

function handleMeal(message: string, ctx: DemoAiContext, today: DateKey): DemoAiResult {
  const tz = ctx.settings.timezone;
  const lower = message.toLowerCase();
  const date = resolveDate(message, today);
  const typeMatch = lower.match(/\b(breakfast|lunch|dinner|snacks?|brunch)\b/);
  let mealType: MealType | null = typeMatch ? ((typeMatch[1] === 'brunch' ? 'breakfast' : typeMatch[1]!.replace(/s$/, '')) as MealType) : null;
  let inferred = false;
  if (!mealType) {
    const h = date.key === today ? hourInTz(ctx.now, tz) : 12;
    mealType = h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 18 ? 'snack' : 'dinner';
    inferred = true;
  }

  let body = lower
    .replace(/\b(for|at|during|as my|as)\s+(breakfast|lunch|dinner|snacks?|brunch)\b/g, ' ')
    .replace(/\b(breakfast|lunch|dinner|snacks?|brunch)\b[:\-]?/g, ' ')
    .replace(/\b(day before yesterday|yesterday(?:'s)?|last night|today|tonight|this (?:morning|afternoon|evening)|\d{1,2} days? ago)\b/g, ' ')
    .replace(/\b(please|log|add|record)\b/g, ' ');
  body = body.replace(/\s+/g, ' ').trim();

  const segments = body.split(/\s*(?:,|;|&|\+|\band\b|\bwith\b|\balong with\b|\bplus\b)\s*/).map((s) => s.trim()).filter(Boolean);
  const parsed = segments
    .map((s) => parseFoodSegment(s))
    .filter((p): p is NonNullable<typeof p> => p !== null && !/^(?:i|we|it|that|some|of|the)$/.test(p.phrase));

  if (parsed.length === 0) {
    return reply("What did you eat? Tell me the foods and portions, for example \"two rotis, a bowl of dal and a glass of milk\". I haven't logged anything yet.", [
      { toolName: 'log_meal', status: 'needs_clarification', summary: 'No foods found in the message' },
    ]);
  }
  const known = parsed.filter((p) => p.food);
  if (known.length === 0) {
    const names = parsed.map((p) => `"${p.phrase}"`).join(', ');
    return reply(
      `I don't have a reliable nutrition estimate for ${names}, so I haven't logged it. Tell me the calories and protein (for example from the label), or add it manually from the Bulking page.`,
      [{ toolName: 'log_meal', status: 'needs_clarification', summary: 'No nutrition estimate available' }],
    );
  }

  const items = parsed.map((p) => toFoodItem(p));
  const eatenAt = instantFor(date, today, ctx.now, tz, DEFAULT_TIMES[mealType]);
  const meal = ctx.createMeal({ mealType, eatenAt, notes: null, items });
  const totals = nutritionTotals([meal]);

  const unknown = items.filter((i) => i.caloriesKcal == null);
  const assumed = parsed.filter((p) => p.food && p.assumedPortion).map((p) => p.food!.name.toLowerCase());
  const when = date.explicit && date.key !== today ? ` for ${formatRelativeDayInline(date.key, today)}` : '';
  const itemText = items.map((i) => `${i.foodName.toLowerCase()}${i.quantity != null ? ` (${trimNum(i.quantity)}${i.unit ? ` ${i.unit}` : ''})` : ''}`).join(', ');

  let text = `Done — I've logged ${mealType}${when}: ${itemText}. That's about ${formatKcal(totals.caloriesKcal)} and ${formatGrams(totals.proteinG)} protein. These are estimates, not measured values.`;
  if (inferred) text += ` You didn't say which meal it was, so I filed it as ${mealType} based on the time.`;
  if (assumed.length) text += ` I assumed one standard serving of ${assumed.join(' and ')}.`;
  if (unknown.length) text += ` I couldn't estimate ${unknown.map((u) => u.foodName.toLowerCase()).join(' or ')}, so ${unknown.length === 1 ? 'it is' : 'they are'} saved without nutrition values and left out of the totals.`;

  const payload: ActionPayload = { kind: 'meal', operation: 'created', mealId: meal.id };
  return reply(text, [
    {
      toolName: 'log_meal',
      status: 'succeeded',
      summary: `${cap(mealType)} · ${items.length} ${items.length === 1 ? 'item' : 'items'} · ~${formatNumber(totals.caloriesKcal)} kcal`,
      recordIds: [meal.id],
      data: payload as unknown as Record<string, unknown>,
    },
  ], ['nutrition', 'history']);
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/* ------------------------------ transactions ------------------------------ */

function handleTransaction(type: TransactionType, message: string, amount: Amount | null, ctx: DemoAiContext, today: DateKey): DemoAiResult {
  const tz = ctx.settings.timezone;
  const tool = 'add_money_transaction';
  const verb = type === 'expense' ? 'spent' : 'received';
  if (!amount) {
    return reply(
      `How much did you ${verb === 'spent' ? 'spend' : 'receive'}? I need an amount before I can record this, and I haven't saved anything yet.`,
      [{ toolName: tool, status: 'needs_clarification', summary: 'Amount missing' }],
    );
  }
  if (amount.value <= 0 || amount.value > 100_000_000) {
    return reply('That amount looks off. Give me a positive amount below ₹10 crore and I\'ll record it.', [
      { toolName: tool, status: 'rejected', summary: 'Amount out of range' },
    ]);
  }
  const category = inferCategory(message, type) ?? 'other';
  const date = resolveDate(message, today);
  const description = describeTransaction(message, amount, categoryLabel(category));
  const occurredAt = instantFor(date, today, ctx.now, tz);
  const tx = ctx.createTransaction({ type, amount: amount.value, category, description, merchant: null, notes: null, occurredAt });

  const when = date.key === today ? '' : ` for ${formatRelativeDayInline(date.key, today)}`;
  const text =
    type === 'expense'
      ? `Done! I've recorded your ${categoryLabel(category).toLowerCase()} expense of ${formatRupees(tx.amount)}${when}.`
      : `Done! I've recorded ${formatRupees(tx.amount)} of income (${categoryLabel(category).toLowerCase()})${when}.`;
  const note = category === 'other' ? ' I couldn\'t tell the category from your message, so I used "Other" — you can change it from the card.' : '';
  const payload: ActionPayload = { kind: 'transaction', operation: 'created', transactionId: tx.id };
  return reply(text + note, [
    {
      toolName: tool,
      status: 'succeeded',
      summary: `${cap(type)} · ${categoryLabel(category)} · ${formatRupees(tx.amount)}`,
      recordIds: [tx.id],
      data: payload as unknown as Record<string, unknown>,
    },
  ], ['finance', 'history']);
}

/* --------------------------------- weight --------------------------------- */

function handleWeight(message: string, ctx: DemoAiContext, today: DateKey): DemoAiResult {
  const tz = ctx.settings.timezone;
  const tool = 'log_weight';
  const m = message.match(/(\d{1,3}(?:\.\d+)?)\s*(kgs?|kilograms?|kilos?|lbs?|pounds?)\b/i) ?? null;
  const bare = message.match(/\b(\d{1,3}(?:\.\d+)?)\b/);
  if (!m) {
    if (!bare) {
      return reply("What's your weight? Tell me the number and the unit, for example \"My weight is 48.2 kg\". I haven't saved anything.", [
        { toolName: tool, status: 'needs_clarification', summary: 'Weight missing' },
      ]);
    }
    return reply(`Is ${bare[1]} in kg or lb? I haven't saved anything yet.`, [
      { toolName: tool, status: 'needs_clarification', summary: 'Weight unit unclear' },
    ]);
  }
  const value = Number(m[1]);
  const isLb = /^(lb|pound)/i.test(m[2]!);
  const kg = Math.round(unitToKg(value, isLb ? 'lb' : 'kg') * 100) / 100;
  if (kg < 20 || kg > 300) {
    return reply(`${value} ${isLb ? 'lb' : 'kg'} looks unusual, so I haven't saved it. Check the number and send it again.`, [
      { toolName: tool, status: 'rejected', summary: 'Weight outside the expected range' },
    ]);
  }
  const date = resolveDate(message, today);
  const w = ctx.createWeighIn({ weightKg: kg, recordedAt: instantFor(date, today, ctx.now, tz, '07:00'), notes: null });
  const summary = weightSummary(ctx.weighIns.concat(w));
  const unit = ctx.settings.weightUnit;
  let text = `Done! I've logged your weight as ${formatWeight(kg, unit)}${isLb ? ` (converted from ${value} lb)` : ''}.`;
  if (summary.changeKg != null && summary.previous) {
    const diff = Math.abs(summary.changeKg);
    text += diff < 0.05 ? ' That is the same as your previous reading.' : ` That's ${formatWeight(diff, unit)} ${summary.changeKg > 0 ? 'up' : 'down'} from your previous reading.`;
  }
  const payload: ActionPayload = { kind: 'weigh_in', operation: 'created', weighInId: w.id };
  return reply(text, [
    { toolName: tool, status: 'succeeded', summary: `Weight · ${formatWeight(kg, unit)}`, recordIds: [w.id], data: payload as unknown as Record<string, unknown> },
  ], ['weight', 'history']);
}

/* ------------------------------- corrections ------------------------------ */

function handleCorrection(message: string, ctx: DemoAiContext, today: DateKey): DemoAiResult {
  const tz = ctx.settings.timezone;
  const lower = message.toLowerCase();

  if (/\b(breakfast|lunch|dinner|snack|meal|ate|calories|protein)\b/.test(lower) && !/\b(expense|spent|₹|rs)\b/.test(lower)) {
    return reply("I can't change meals from chat yet. Open the Bulking page, pick the day and use Edit on the meal — you can fix foods, portions and nutrition there.", [
      { toolName: 'update_meal', status: 'rejected', summary: 'Meal edits are not available in chat' },
    ]);
  }

  const date = resolveDate(message, today);
  const toMatch = message.match(/\b(?:to|as)\s+(?:₹|rs\.?\s*|inr\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(kg|kgs|lb|lbs))?/i);

  if (/\bweigh(?:t|ed)?\b/.test(lower)) {
    if (!toMatch) {
      return reply('What should the weight be changed to? For example "Correct today\'s weight to 48.0 kg".', [
        { toolName: 'update_weight', status: 'needs_clarification', summary: 'New weight missing' },
      ]);
    }
    const isLb = /lb/i.test(toMatch[2] ?? '');
    const kg = Math.round(unitToKg(Number(toMatch[1]), isLb ? 'lb' : 'kg') * 100) / 100;
    if (kg < 20 || kg > 300) {
      return reply("That weight looks unusual, so I haven't changed anything.", [{ toolName: 'update_weight', status: 'rejected', summary: 'Weight outside the expected range' }]);
    }
    const key = date.explicit ? date.key : today;
    const candidates = ctx.weighIns.filter((w) => dateKeyInTz(w.recordedAt, tz) === key);
    if (candidates.length !== 1) {
      return reply(
        candidates.length === 0
          ? `I couldn't find a weight entry for ${formatRelativeDayInline(key, today)}. Log it first, or tell me which day to correct.`
          : `There are ${candidates.length} weight entries on ${formatRelativeDayInline(key, today)}. Edit the right one from the Bulking page.`,
        [{ toolName: 'update_weight', status: 'needs_clarification', summary: candidates.length === 0 ? 'No matching weight entry' : 'Several matching weight entries' }],
      );
    }
    const target = candidates[0]!;
    const updated = ctx.updateWeighIn(target.id, { weightKg: kg, recordedAt: target.recordedAt, notes: target.notes });
    const payload: ActionPayload = { kind: 'weigh_in', operation: 'updated', weighInId: updated.id };
    return reply(`Done — I've changed ${formatRelativeDayInline(key, today)}'s weight from ${formatWeight(target.weightKg, ctx.settings.weightUnit)} to ${formatWeight(kg, ctx.settings.weightUnit)}.`, [
      { toolName: 'update_weight', status: 'succeeded', summary: `Weight · ${formatWeight(kg, ctx.settings.weightUnit)}`, recordIds: [updated.id], data: payload as unknown as Record<string, unknown> },
    ], ['weight', 'history']);
  }

  // Transactions
  if (!toMatch) {
    return reply('What should the new amount be? For example "Correct yesterday\'s travel expense to ₹30". I haven\'t changed anything.', [
      { toolName: 'update_transaction', status: 'needs_clarification', summary: 'New amount missing' },
    ]);
  }
  const newAmount = Number(toMatch[1]!.replace(/,/g, ''));
  if (!(newAmount > 0)) {
    return reply('The new amount has to be more than zero. I haven\'t changed anything.', [{ toolName: 'update_transaction', status: 'rejected', summary: 'Invalid amount' }]);
  }
  const type: TransactionType | null = /\bincome|received|pocket money|salary\b/.test(lower) ? 'income' : /\bexpense|spent|spend|paid|fare|bill\b/.test(lower) ? 'expense' : null;
  const subject = lower.slice(0, toMatch.index ?? lower.length);
  const category = inferCategory(subject, type ?? 'expense') ?? (type === 'income' ? inferCategory(subject, 'income') : null);
  const windowStart = date.explicit ? date.key : addDays(today, -30);
  let candidates = ctx.transactions
    .filter((t) => {
      const k = dateKeyInTz(t.occurredAt, tz);
      if (date.explicit ? k !== date.key : k < windowStart) return false;
      if (type && t.type !== type) return false;
      if (category && t.category !== category) return false;
      return true;
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  // Narrow by specific words in the request ("uber", "netflix") when they appear in a description.
  const generic = new Set(['correct', 'change', 'update', 'fix', 'edit', 'modify', 'amend', 'set', 'the', 'my', 'expense', 'income', 'payment', 'yesterday', 'today', 'yesterday\'s', 'today\'s', 'for', 'of', 'last', 'night', 'ago', 'days', 'day', 'before']);
  const words = subject.split(/[^a-z0-9']+/).filter((w) => w.length >= 3 && !generic.has(w));
  const narrowed = candidates.filter((t) => words.some((w) => `${t.description} ${t.merchant ?? ''}`.toLowerCase().includes(w)));
  if (narrowed.length > 0 && narrowed.length < candidates.length) candidates = narrowed;

  const what = [category ? categoryLabel(category).toLowerCase() : null, type ?? 'transaction'].filter(Boolean).join(' ');
  const whenText = date.explicit ? formatRelativeDayInline(date.key, today) : 'the last 30 days';
  if (candidates.length === 0) {
    return reply(`I couldn't find a ${what} for ${whenText}, so I haven't changed anything. Check the History page, or tell me the day and category.`, [
      { toolName: 'update_transaction', status: 'needs_clarification', summary: 'No matching transaction' },
    ]);
  }
  if (candidates.length > 1) {
    const list = candidates.slice(0, 4).map((t) => `${t.description} ${formatRupees(t.amount)} (${formatDayMonth(dateKeyInTz(t.occurredAt, tz))}, ${formatTime(t.occurredAt, tz)})`).join('; ');
    return reply(`I found ${candidates.length} matching entries: ${list}. Which one should I change? Add the day or the description, or edit it from History. I haven't changed anything yet.`, [
      { toolName: 'update_transaction', status: 'needs_clarification', summary: `${candidates.length} possible matches` },
    ]);
  }
  const target = candidates[0]!;
  const updated = ctx.updateTransaction(target.id, {
    type: target.type, amount: newAmount, category: target.category, description: target.description,
    merchant: target.merchant, notes: target.notes, occurredAt: target.occurredAt,
  });
  const payload: ActionPayload = { kind: 'transaction', operation: 'updated', transactionId: updated.id, previousAmount: target.amount };
  return reply(`Done — I've changed "${target.description}" from ${formatRupees(target.amount)} to ${formatRupees(updated.amount)}.`, [
    {
      toolName: 'update_transaction', status: 'succeeded',
      summary: `${cap(updated.type)} · ${categoryLabel(updated.category)} · ${formatRupees(target.amount)} → ${formatRupees(updated.amount)}`,
      recordIds: [updated.id], data: payload as unknown as Record<string, unknown>,
    },
  ], ['finance', 'history']);
}

/* -------------------------------- questions -------------------------------- */

function handleQuestion(message: string, ctx: DemoAiContext, today: DateKey): DemoAiResult {
  const lower = message.toLowerCase();
  const tz = ctx.settings.timezone;
  const date = resolveDate(message, today);
  const money = /\b(money|spend|spent|spending|budget|balance|expense|expenses|income|left|₹|rupees?|cost|pocket)\b/.test(lower);
  const food = /\b(protein|calorie|calories|kcal|eat|ate|eaten|food|meal|meals|nutrition|bulk|diet)\b/.test(lower);
  const weight = /\bweigh(?:t|ed)?\b/.test(lower);
  const dayWide = /\b(summari[sz]e|summary|recap|overview)\b/.test(lower) && /\b(day|today|yesterday)\b/.test(lower);
  const review = /\b(review|analy[sz]e|breakdown|where did)\b/.test(lower) && money;

  if (dayWide) return answerDay(ctx, date.explicit ? date.key : today, today);
  if (review) return answerSpendingReview(ctx);
  if (weight && !money && !food) return answerWeight(ctx);
  if (money && !food) return answerMoney(lower, ctx, today);
  if (food && !money) return answerNutrition(lower, ctx, today, date);
  if (money && food) return answerDay(ctx, date.explicit ? date.key : today, today);
  void tz;
  return reply('I can answer questions about your meals, spending, balance and weight. Try "How much protein have I eaten today?", "How much money do I have left this month?" or "Summarise my day".');
}

const summaryAction = (domain: 'nutrition' | 'finance' | 'weight' | 'all', summary: string): DemoAction => ({
  toolName: 'get_summary',
  status: 'succeeded',
  summary,
  data: { kind: 'summary', domain } as unknown as Record<string, unknown>,
});

function nutritionSentence(t: NutritionTotals, s: UserSettings, label: string): string {
  if (t.mealCount === 0) return `You haven't logged any meals ${label}.`;
  let text = `${cap(label)} you've had about ${formatKcal(t.caloriesKcal)} and ${formatGrams(t.proteinG)} protein across ${t.mealCount} ${t.mealCount === 1 ? 'meal' : 'meals'} (estimated).`;
  const cal = progressOf(t.caloriesKcal, s.dailyCalorieTarget);
  const pro = progressOf(t.proteinG, s.dailyProteinTargetG);
  const bits: string[] = [];
  if (pro.remaining != null) bits.push(pro.remaining >= 0 ? `${formatGrams(pro.remaining)} of protein to go` : `${formatGrams(-pro.remaining)} over your protein target`);
  if (cal.remaining != null) bits.push(cal.remaining >= 0 ? `${formatKcal(cal.remaining)} left` : `${formatKcal(-cal.remaining)} over your calorie target`);
  if (bits.length) text += ` Against your targets: ${bits.join(', ')}.`;
  else text += ' You haven\'t set daily targets yet — add them in Settings if you want a comparison.';
  const caveat = nutritionCaveat(t);
  if (caveat && caveat !== 'Estimated values.') text += ` ${caveat}`;
  return text;
}

function answerNutrition(lower: string, ctx: DemoAiContext, today: DateKey, date: DateRef): DemoAiResult {
  const tz = ctx.settings.timezone;
  let key = date.explicit ? date.key : today;
  let label = key === today ? 'today' : key === addDays(today, -1) ? 'yesterday' : `on ${formatDayMonth(key)}`;
  if (/\b(this week|last 7 days|past week|week)\b/.test(lower)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
    const meals = days.flatMap((d) => mealsOnDate(ctx.meals, d, tz));
    const t = nutritionTotals(meals);
    const logged = new Set(meals.map((m) => dateKeyInTz(m.eatenAt, tz))).size;
    if (!logged) return reply("You haven't logged any meals in the last 7 days.", [summaryAction('nutrition', 'Last 7 days · no meals')]);
    return reply(
      `Over the last 7 days (${logged} ${logged === 1 ? 'day' : 'days'} with meals logged) you averaged about ${formatKcal(t.caloriesKcal / logged)} and ${formatGrams(t.proteinG / logged)} protein per logged day. These are estimates.`,
      [summaryAction('nutrition', 'Last 7 days · calculated from saved meals')],
    );
  }
  key = key > today ? today : key;
  const t = nutritionTotals(mealsOnDate(ctx.meals, key, tz));
  label = key === today ? 'today' : label;
  return reply(nutritionSentence(t, ctx.settings, label), [summaryAction('nutrition', `${cap(label)} · calculated from saved meals`)]);
}

function answerMoney(lower: string, ctx: DemoAiContext, today: DateKey): DemoAiResult {
  const tz = ctx.settings.timezone;
  const month = monthKeyInTz(ctx.now, tz);
  const s = budgetSummary(ctx.transactions, month, ctx.settings.monthlyBudget, tz);
  const tracked = trackedBalance(ctx.transactions, ctx.settings.openingBalance);
  const monthName = formatMonthLabel(month);
  void today;

  const catHit = (Object.keys(CATEGORY_WORDS) as TransactionCategory[]).find((c) => CATEGORY_WORDS[c]!.test(lower));
  if (catHit && /\b(spend|spent|spending|cost)\b/.test(lower)) {
    const row = s.byCategory.find((c) => c.category === catHit);
    const amt = row?.amount ?? 0;
    return reply(
      row ? `You've spent ${formatRupees(amt)} on ${categoryLabel(catHit).toLowerCase()} in ${monthName} across ${row.count} ${row.count === 1 ? 'entry' : 'entries'}.` : `You haven't recorded any ${categoryLabel(catHit).toLowerCase()} spending in ${monthName}.`,
      [summaryAction('finance', `${categoryLabel(catHit)} · ${monthName}`)],
    );
  }
  if (/\b(income|received|earned)\b/.test(lower) && !/\bleft\b/.test(lower)) {
    return reply(`You've recorded ${formatRupees(s.income)} of income in ${monthName}.`, [summaryAction('finance', `Income · ${monthName}`)]);
  }
  if (/\b(balance)\b/.test(lower) && !/\bbudget\b/.test(lower)) {
    return reply(`Your tracked balance is ${formatRupees(tracked)}. That's your opening balance of ${formatRupees(ctx.settings.openingBalance)} plus everything you've recorded as income, minus everything recorded as spending — it may not match your real bank balance.`, [summaryAction('finance', 'Tracked balance')]);
  }
  if (s.monthlyBudget == null) {
    return reply(
      `You haven't set a monthly budget, so there's nothing to measure against. You've spent ${formatRupees(s.expenses)} in ${monthName}, and your tracked balance is ${formatRupees(tracked)}. Set a budget in Settings to see what's left.`,
      [summaryAction('finance', `Spending · ${monthName}`)],
    );
  }
  const left = s.budgetRemaining ?? 0;
  const lead = left >= 0 ? `You have ${formatRupees(left)} left in your ${monthName} budget` : `You're ${formatRupees(-left)} over your ${monthName} budget`;
  return reply(
    `${lead} — you've spent ${formatRupees(s.expenses)} of ${formatRupees(s.monthlyBudget)}. Separately, your tracked balance is ${formatRupees(tracked)} (opening balance + recorded income − recorded spending), which may differ from your bank.`,
    [summaryAction('finance', `Budget · ${monthName}`)],
  );
}

const CATEGORY_WORDS: Partial<Record<TransactionCategory, RegExp>> = {
  food: /\b(food|eating out|snacks?|canteen|groceries)\b/,
  transport: /\b(transport|travel|travelling|commute|bus|fare)\b/,
  mobile_recharge: /\b(recharge|mobile)\b/,
  college: /\b(college|stationery|books)\b/,
  shopping: /\b(shopping|clothes)\b/,
  subscriptions: /\b(subscriptions?)\b/,
  entertainment: /\b(entertainment|movies?)\b/,
  health: /\b(health|medicine)\b/,
};

function answerSpendingReview(ctx: DemoAiContext): DemoAiResult {
  const tz = ctx.settings.timezone;
  const month = monthKeyInTz(ctx.now, tz);
  const monthName = formatMonthLabel(month);
  const inMonth = transactionsInMonth(ctx.transactions, month, tz);
  const s = budgetSummary(ctx.transactions, month, ctx.settings.monthlyBudget, tz);
  if (s.expenses === 0) return reply(`You haven't recorded any spending in ${monthName} yet.`, [summaryAction('finance', `Spending · ${monthName}`)]);
  const top = categoryTotals(inMonth).slice(0, 3).map((c) => `${categoryLabel(c.category).toLowerCase()} ${formatRupees(c.amount)} (${Math.round((c.amount / s.expenses) * 100)}%)`);
  const biggest = inMonth.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
  let text = `In ${monthName} you've spent ${formatRupees(s.expenses)}. The biggest categories are ${top.join(', ')}.`;
  if (biggest) text += ` Your largest single expense was ${biggest.description.toLowerCase()} at ${formatRupees(biggest.amount)}.`;
  if (s.monthlyBudget != null && s.budgetRemaining != null) {
    text += s.budgetRemaining >= 0 ? ` That's ${Math.round((s.budgetUsedRatio ?? 0) * 100)}% of your ${formatRupees(s.monthlyBudget)} budget, with ${formatRupees(s.budgetRemaining)} left.` : ` That's ${formatRupees(-s.budgetRemaining)} over your ${formatRupees(s.monthlyBudget)} budget.`;
  }
  return reply(text, [summaryAction('finance', `Spending review · ${monthName}`)]);
}

function answerWeight(ctx: DemoAiContext): DemoAiResult {
  const s = weightSummary(ctx.weighIns);
  const unit = ctx.settings.weightUnit;
  const tz = ctx.settings.timezone;
  if (!s.latest) return reply("You haven't logged your weight yet. Tell me, for example, \"My weight is 48.2 kg today\".", [summaryAction('weight', 'No weight entries')]);
  let text = `Your latest weight is ${formatWeight(s.latest.weightKg, unit)}, logged ${formatRelativeDayInline(dateKeyInTz(s.latest.recordedAt, tz), todayKey(tz, ctx.now))}.`;
  if (s.changeKg != null) text += ` That's ${s.changeKg === 0 ? 'unchanged' : `${formatWeight(Math.abs(s.changeKg), unit)} ${s.changeKg > 0 ? 'up' : 'down'}`} from the reading before it.`;
  else text += ' With only one reading there is no trend yet.';
  return reply(text, [summaryAction('weight', 'Weight · latest readings')]);
}

function answerDay(ctx: DemoAiContext, key: DateKey, today: DateKey): DemoAiResult {
  const tz = ctx.settings.timezone;
  const label = key === today ? 'today' : formatRelativeDayInline(key, today);
  const meals = mealsOnDate(ctx.meals, key, tz);
  const spent = ctx.transactions.filter((t) => dateKeyInTz(t.occurredAt, tz) === key);
  const exp = spent.filter((t) => t.type === 'expense').reduce((a, t) => a + Math.round(t.amount * 100), 0) / 100;
  const inc = spent.filter((t) => t.type === 'income').reduce((a, t) => a + Math.round(t.amount * 100), 0) / 100;
  const w = ctx.weighIns.find((x) => dateKeyInTz(x.recordedAt, tz) === key);
  const parts: string[] = [];
  parts.push(meals.length ? nutritionSentence(nutritionTotals(meals), ctx.settings, label) : `No meals logged ${label}.`);
  parts.push(spent.length ? `Money: ${formatRupees(exp)} spent${inc ? ` and ${formatRupees(inc)} received` : ''} across ${spent.length} ${spent.length === 1 ? 'entry' : 'entries'}.` : `No spending or income recorded ${label}.`);
  if (w) parts.push(`Weight: ${formatWeight(w.weightKg, ctx.settings.weightUnit)}.`);
  return reply(`Here's ${label === 'today' ? 'your day so far' : label} (${formatLongDate(key)}). ${parts.join(' ')}`, [summaryAction('all', `Day summary · ${formatDayMonth(key)}`)]);
}
