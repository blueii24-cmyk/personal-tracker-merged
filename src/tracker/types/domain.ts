/**
 * Shared domain types. The local-first Supabase mapping lives in
 * supabase/migrations/20261101000000_tracker_sync.sql (camelCase here, snake_case there).
 * The synced service keeps the same local domain shape whether online, offline, or signed out.
 */
import type { AiActionResult } from './api';
import type { AiProviderId } from '../lib/ai/provider';

export type { AiActionResult };

/** ISO-8601 timestamp (UTC instant). */
export type IsoDateTime = string;
/** Calendar date in the user's timezone, `YYYY-MM-DD`. */
export type DateKey = string;
/** Calendar month in the user's timezone, `YYYY-MM`. */
export type MonthKey = string;

export type RecordSource = 'manual' | 'ai';

/* ------------------------------ Nutrition ------------------------------ */

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export type NutritionSource = 'ai_estimate' | 'label' | 'verified_database' | 'user_entered' | 'unknown';

export interface FoodItem {
  id: string;
  foodName: string;
  quantity: number | null;
  unit: string | null;
  /** `null` means unknown — never treat as zero. */
  caloriesKcal: number | null;
  proteinG: number | null;
  isEstimate: boolean;
  nutritionSource: NutritionSource;
}

export interface Meal {
  id: string;
  mealType: MealType;
  eatenAt: IsoDateTime;
  notes: string | null;
  source: RecordSource;
  items: FoodItem[];
}

export type FoodItemInput = Omit<FoodItem, 'id'>;
export interface MealInput {
  mealType: MealType;
  eatenAt: IsoDateTime;
  notes: string | null;
  items: FoodItemInput[];
}

/* ------------------------------- Finance ------------------------------- */

export const EXPENSE_CATEGORIES = [
  'food',
  'transport',
  'mobile_recharge',
  'college',
  'shopping',
  'subscriptions',
  'entertainment',
  'health',
  'other',
] as const;
export const INCOME_CATEGORIES = ['pocket_money', 'salary', 'gift', 'refund', 'other'] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type TransactionCategory = ExpenseCategory | IncomeCategory;
export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Always positive; `type` carries the sign. Rupees (INR), max two decimals. */
  amount: number;
  currency: 'INR';
  category: TransactionCategory;
  description: string;
  merchant: string | null;
  /** Optional free-text note; included in local backups and Supabase sync. */
  notes: string | null;
  occurredAt: IsoDateTime;
  source: RecordSource;
}

export type TransactionInput = Omit<Transaction, 'id' | 'source' | 'currency'>;

/* -------------------------------- Weight ------------------------------- */

export interface WeighIn {
  id: string;
  weightKg: number;
  recordedAt: IsoDateTime;
  notes: string | null;
  source: RecordSource;
}
export type WeighInInput = Omit<WeighIn, 'id' | 'source'>;

/* ------------------------------- Settings ------------------------------ */

export type WeightUnit = 'kg' | 'lb';

/**
 * Settings shape used by the UI and local store. Supabase sync maps it to one `user_settings` row;
 * AI credentials remain outside this shape and are never synchronized.
 */
export interface UserSettings {
  displayName: string;
  email: string;
  timezone: string;
  currency: 'INR';
  /** Cash balance when tracking started. Zero if unknown. */
  openingBalance: number;
  /** `null` = the user has not set a target; the UI must not invent one. */
  dailyCalorieTarget: number | null;
  dailyProteinTargetG: number | null;
  monthlyBudget: number | null;
  targetWeightKg: number | null;
  weightUnit: WeightUnit;
  preferredAiProvider: AiProviderId | 'demo';
  preferredAiModel: string | null;
}
export type UserSettingsInput = Partial<UserSettings>;

export interface AiStatus {
  mode: 'demo' | 'connected';
  provider: AiProviderId | 'demo';
  model: string | null;
  connection: 'demo' | 'connected' | 'unreachable' | 'not_configured';
  detail: string;
}

/* ------------------------------ Filters ------------------------------- */

export interface DateRange {
  from?: DateKey;
  to?: DateKey;
}

export interface TransactionFilters {
  range?: DateRange;
  type?: TransactionType | 'all';
  category?: TransactionCategory | 'all';
  search?: string;
}

/* ------------------------------ Summaries ------------------------------ */

export interface NutritionTotals {
  mealCount: number;
  itemCount: number;
  caloriesKcal: number;
  proteinG: number;
  /** Items whose calories/protein are unknown (excluded from the totals). */
  unknownCalorieItems: number;
  unknownProteinItems: number;
  /** True when any contributing value is an estimate. */
  hasEstimates: boolean;
}

export interface CategoryTotal {
  category: TransactionCategory;
  amount: number;
  count: number;
}

export interface BudgetSummary {
  monthKey: MonthKey;
  income: number;
  expenses: number;
  /** Income minus expenses for the month. */
  net: number;
  monthlyBudget: number | null;
  /** Budget minus this month's expenses; may be negative. `null` without a budget. */
  budgetRemaining: number | null;
  /** Expenses / budget; may exceed 1. `null` without a (non-zero) budget. */
  budgetUsedRatio: number | null;
  byCategory: CategoryTotal[];
}

export interface WeightSummary {
  latest: WeighIn | null;
  previous: WeighIn | null;
  /** latest − previous, in kg. `null` with fewer than two readings. */
  changeKg: number | null;
  count: number;
}

export type ActivityKind = 'meal' | 'expense' | 'income' | 'weight';

export type ActivityEntry =
  | { kind: 'meal'; id: string; at: IsoDateTime; record: Meal }
  | { kind: 'expense' | 'income'; id: string; at: IsoDateTime; record: Transaction }
  | { kind: 'weight'; id: string; at: IsoDateTime; record: WeighIn };

export interface DashboardSummary {
  generatedAt: IsoDateTime;
  today: DateKey;
  monthKey: MonthKey;
  nutritionToday: NutritionTotals;
  budget: BudgetSummary;
  /** Opening balance + all recorded income − all recorded expenses ("as tracked"). */
  trackedBalance: number;
  weight: WeightSummary;
  recentActivity: ActivityEntry[];
}

/* -------------------------------- Chat --------------------------------- */

export interface ChatSession {
  id: string;
  title: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ChatMessageStatus = 'sending' | 'streaming' | 'complete' | 'error';

export interface ChatErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt: IsoDateTime;
  status: ChatMessageStatus;
  /** Present on user messages; reused when retrying so the backend can de-duplicate. */
  clientMessageId?: string;
  /** Original message retained in this conversation when this turn is a correction. */
  editOfMessageId?: string;
  /** Present on assistant messages. */
  actions?: AiActionResult[];
  /** Receipts from the original turn, not actions performed by a regenerated answer. */
  preservedActions?: AiActionResult[];
  error?: ChatErrorInfo;
}

/** Records an AI action refers to, carried in `AiActionResult.data`. */
export type ActionPayload =
  | { kind: 'meal'; operation: 'created' | 'updated'; mealId: string }
  | { kind: 'transaction'; operation: 'created' | 'updated'; transactionId: string; previousAmount?: number }
  | { kind: 'weigh_in'; operation: 'created' | 'updated'; weighInId: string }
  | { kind: 'summary'; domain: 'nutrition' | 'finance' | 'weight' | 'all' };
