// Shared domain types for the Personal Tracker app.
// These types describe the data model that both the mock demo service and a
// future Supabase-backed service must satisfy, so UI components never need to
// change when the real backend is wired up.

export type WeightUnit = "kg" | "lb";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type RecordSource = "manual" | "ai";

export interface FoodItem {
  id: string;
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  isEstimate: boolean;
}

export interface Meal {
  id: string;
  type: MealType;
  items: FoodItem[];
  totalCalories: number;
  totalProtein: number;
  loggedAt: string; // ISO date-time
  note?: string;
  source: RecordSource;
}

export interface WeighIn {
  id: string;
  weightKg: number;
  date: string; // ISO date
  note?: string;
  source: RecordSource;
}

export type TransactionType = "income" | "expense";

export type ExpenseCategory =
  | "Food"
  | "Transport"
  | "Mobile recharge"
  | "College"
  | "Shopping"
  | "Subscriptions"
  | "Entertainment"
  | "Other";

export type IncomeCategory = "Pocket money" | "Salary" | "Freelance" | "Gift" | "Other";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: ExpenseCategory | IncomeCategory;
  description: string;
  date: string; // ISO date
  note?: string;
  source: RecordSource;
  createdAt: string; // ISO date-time
}

export interface UserSettings {
  displayName: string;
  email: string;
  timezone: string;
  calorieTarget: number;
  proteinTarget: number;
  weightUnit: WeightUnit;
  monthlyBudget: number;
  currency: "INR";
  budgetCycleStartDay: number;
  theme: "light" | "dark" | "system";
  aiProvider: string;
  aiModel: string;
  aiConnected: boolean;
}

export type ChatRole = "user" | "assistant";

export type ChatMessageStatus = "sending" | "sent" | "error";

export type ChatActionKind =
  | "meal-logged"
  | "expense-logged"
  | "income-logged"
  | "weight-logged"
  | "info"
  | "unsupported"
  | "error";

export interface ChatActionResult {
  kind: ChatActionKind;
  title: string;
  mock: boolean;
  meal?: Meal;
  transaction?: Transaction;
  weighIn?: WeighIn;
}

export interface ChatMessage {
  id: string;
  sessionId?: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  action?: ChatActionResult;
}

export type ActivityType = "meal" | "expense" | "income" | "weight";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  subtitle: string;
  timestamp: string; // ISO date-time
  amount?: number;
  recordId: string;
}

export interface DashboardSummary {
  date: string;
  caloriesConsumed: number;
  proteinConsumed: number;
  calorieTarget: number;
  proteinTarget: number;
  latestWeightKg: number | null;
  weightChangeKg: number | null;
  recentMeals: Meal[];
  weightHistory: WeighIn[];
  availableBalance: number;
  monthlyBudget: number;
  spentThisMonth: number;
  incomeThisMonth: number;
  recentTransactions: Transaction[];
  categorySpend: { category: string; amount: number }[];
  recentActivity: ActivityItem[];
}
