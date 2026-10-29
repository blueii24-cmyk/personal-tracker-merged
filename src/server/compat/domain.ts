/**
 * Shared domain models. These types are storage-agnostic: the same models are
 * returned by the local demo service, the Next.js API routes and (later) a
 * Supabase-backed implementation.
 */

export type ThemePreference = "light" | "dark" | "system";
export type WeightUnit = "kg" | "lb";
export type CurrencyCode = "INR";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type TransactionType = "expense" | "income";
export type RecordSource = "manual" | "assistant" | "seed";

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

export const EXPENSE_CATEGORIES = [
  "Food",
  "Transport",
  "Mobile recharge",
  "College",
  "Shopping",
  "Subscriptions",
  "Entertainment",
  "Other",
] as const;

export const INCOME_CATEGORIES = [
  "Pocket money",
  "Salary",
  "Freelance",
  "Gift",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export interface FoodItem {
  id: string;
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  isEstimate?: boolean;
}

export interface Meal {
  id: string;
  date: string; // YYYY-MM-DD
  mealType: MealType;
  title: string;
  items: FoodItem[];
  notes?: string;
  source: RecordSource;
  createdAt: string;
}

export interface FoodItemInput {
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  isEstimate?: boolean;
}

export interface MealInput {
  date: string;
  mealType: MealType;
  title?: string;
  notes?: string;
  items: FoodItemInput[];
  source?: RecordSource;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  date: string;
  notes?: string;
  source: RecordSource;
  createdAt: string;
}

export interface TransactionInput {
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  date: string;
  notes?: string;
  source?: RecordSource;
}

export interface WeighIn {
  id: string;
  date: string;
  weightKg: number;
  notes?: string;
  source: RecordSource;
  createdAt: string;
}

export interface WeighInInput {
  date: string;
  weightKg: number;
  notes?: string;
  source?: RecordSource;
}

export interface UserSettings {
  displayName: string;
  email: string;
  timezone: string;
  calorieTarget: number;
  proteinTarget: number;
  weightUnit: WeightUnit;
  monthlyBudget: number;
  currency: CurrencyCode;
  theme: ThemePreference;
  aiProvider: string;
  aiModel: string;
}

export type UserSettingsInput = Partial<
  Pick<
    UserSettings,
    | "displayName"
    | "email"
    | "timezone"
    | "calorieTarget"
    | "proteinTarget"
    | "weightUnit"
    | "monthlyBudget"
    | "currency"
    | "theme"
  >
>;

export interface AiStatus {
  mode: "demo" | "connected";
  provider: string;
  model: string;
  configured: boolean;
  note: string;
}

export interface ChatAttachment {
  kind: "meal" | "transaction" | "weighIn";
  id: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  attachment?: ChatAttachment;
  createdAt: string;
}

export interface SendChatMessageInput {
  content: string;
  sessionId: string;
}

export type StorageMode = "database" | "demo";

export interface DateRange {
  from?: string;
  to?: string;
}

export interface TrackerSnapshot {
  storage: StorageMode;
  today: string;
  generatedAt: string;
  ai: AiStatus;
  settings: UserSettings;
  meals: Meal[];
  transactions: Transaction[];
  weighIns: WeighIn[];
  chatMessages: ChatMessage[];
}

/** Derived read models */
export interface NutritionTotals {
  calories: number;
  protein: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
  budget: number;
  budgetRemaining: number;
  budgetUsedPercent: number;
  availableBalance: number;
  transactionCount: number;
}

export interface CategoryTotal {
  category: string;
  amount: number;
  percent: number;
}

export interface WeightSummary {
  current: number | null;
  previous: number | null;
  delta: number | null;
  latestDate: string | null;
  first: number | null;
  totalChange: number | null;
}

export type ActivityType = "meal" | "expense" | "income" | "weight";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  detail: string;
  amount?: number;
  date: string;
  createdAt: string;
  href: string;
}

export interface DashboardSummary {
  date: string;
  nutrition: NutritionTotals;
  settings: UserSettings;
  month: MonthSummary;
  categories: CategoryTotal[];
  weight: WeightSummary;
  activity: ActivityItem[];
}
