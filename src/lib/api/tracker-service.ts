// Mock "tracker" data service.
//
// This is a clearly-named DEMO implementation: it keeps realistic, seeded
// data in memory for the lifetime of the browser tab and simulates network
// latency + typed errors. Nothing here is persisted to a database or to
// Supabase. A future `supabase-tracker-service.ts` can implement the exact
// same `TrackerService` interface (see src/types/api.ts) so the UI never has
// to change when real persistence is wired up.

import type {
  ActivityItem,
  DashboardSummary,
  ExpenseCategory,
  Meal,
  MealType,
  Transaction,
  UserSettings,
  WeighIn,
} from "@/types/domain";
import type {
  CreateMealInput,
  CreateTransactionInput,
  CreateWeighInInput,
  DateRange,
  TrackerService,
  TransactionFilters,
  UpdateMealInput,
  UpdateTransactionInput,
} from "@/types/api";
import { ApiError } from "@/types/api";
import { BACKEND_MODE, generateId, simulateLatency } from "./client";
import { HttpTrackerService } from "./http-tracker-service";
import { toISODate } from "@/lib/formatting";

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toISODate(d);
}

function daysAgoISODateTime(days: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

let meals: Meal[] = [
  {
    id: "meal_seed_1",
    type: "breakfast",
    items: [
      { id: "fi_1", name: "Eggs", quantity: "3 boiled", calories: 234, protein: 18.9, isEstimate: true },
      { id: "fi_2", name: "Banana", quantity: "2 medium", calories: 210, protein: 2.6, isEstimate: true },
      { id: "fi_3", name: "Milk", quantity: "1 glass (250ml)", calories: 150, protein: 8, isEstimate: true },
    ],
    totalCalories: 594,
    totalProtein: 29.5,
    loggedAt: daysAgoISODateTime(0, 8, 15),
    source: "ai",
  },
  {
    id: "meal_seed_2",
    type: "lunch",
    items: [
      { id: "fi_4", name: "Chicken breast", quantity: "150 g grilled", calories: 248, protein: 46.5, isEstimate: true },
      { id: "fi_5", name: "Rice", quantity: "1 cup cooked", calories: 206, protein: 4.3, isEstimate: true },
      { id: "fi_6", name: "Mixed vegetables", quantity: "1 bowl", calories: 95, protein: 3.1, isEstimate: true },
    ],
    totalCalories: 549,
    totalProtein: 53.9,
    loggedAt: daysAgoISODateTime(0, 13, 30),
    source: "manual",
  },
  {
    id: "meal_seed_3",
    type: "snack",
    items: [{ id: "fi_7", name: "Greek yoghurt", quantity: "1 cup", calories: 150, protein: 17, isEstimate: true }],
    totalCalories: 150,
    totalProtein: 17,
    loggedAt: daysAgoISODateTime(1, 17, 0),
    source: "manual",
  },
  {
    id: "meal_seed_4",
    type: "dinner",
    items: [
      { id: "fi_8", name: "Paneer", quantity: "150 g", calories: 356, protein: 25.2, isEstimate: true },
      { id: "fi_9", name: "Roti", quantity: "3 pieces", calories: 240, protein: 7.5, isEstimate: true },
    ],
    totalCalories: 596,
    totalProtein: 32.7,
    loggedAt: daysAgoISODateTime(1, 20, 15),
    source: "manual",
  },
];

let weighIns: WeighIn[] = [
  { id: "wi_1", weightKg: 46.8, date: daysAgoISO(28), source: "manual" },
  { id: "wi_2", weightKg: 47.1, date: daysAgoISO(21), source: "manual" },
  { id: "wi_3", weightKg: 47.4, date: daysAgoISO(14), source: "manual" },
  { id: "wi_4", weightKg: 47.9, date: daysAgoISO(7), source: "manual" },
  { id: "wi_5", weightKg: 48.0, date: daysAgoISO(3), source: "ai" },
  { id: "wi_6", weightKg: 48.2, date: daysAgoISO(0), source: "ai" },
];

let transactions: Transaction[] = [
  {
    id: "txn_1",
    type: "income",
    amount: 2000,
    category: "Pocket money",
    description: "Monthly pocket money",
    date: daysAgoISO(12),
    source: "ai",
    createdAt: daysAgoISODateTime(12, 9, 0),
  },
  {
    id: "txn_2",
    type: "expense",
    amount: 60,
    category: "Transport",
    description: "Travel to college",
    date: daysAgoISO(0),
    source: "ai",
    createdAt: daysAgoISODateTime(0, 8, 40),
  },
  {
    id: "txn_3",
    type: "expense",
    amount: 350,
    category: "Food",
    description: "Groceries",
    date: daysAgoISO(1),
    source: "manual",
    createdAt: daysAgoISODateTime(1, 19, 10),
  },
  {
    id: "txn_4",
    type: "expense",
    amount: 199,
    category: "Subscriptions",
    description: "Music subscription",
    date: daysAgoISO(2),
    source: "manual",
    createdAt: daysAgoISODateTime(2, 11, 0),
  },
  {
    id: "txn_5",
    type: "expense",
    amount: 120,
    category: "Mobile recharge",
    description: "Prepaid recharge",
    date: daysAgoISO(4),
    source: "manual",
    createdAt: daysAgoISODateTime(4, 18, 0),
  },
  {
    id: "txn_6",
    type: "expense",
    amount: 540,
    category: "College",
    description: "Printing & stationery",
    date: daysAgoISO(6),
    source: "manual",
    createdAt: daysAgoISODateTime(6, 15, 20),
  },
  {
    id: "txn_7",
    type: "expense",
    amount: 899,
    category: "Shopping",
    description: "New t-shirt",
    date: daysAgoISO(9),
    source: "manual",
    createdAt: daysAgoISODateTime(9, 17, 45),
  },
  {
    id: "txn_8",
    type: "income",
    amount: 1500,
    category: "Freelance",
    description: "Freelance design gig",
    date: daysAgoISO(18),
    source: "manual",
    createdAt: daysAgoISODateTime(18, 10, 0),
  },
  {
    id: "txn_9",
    type: "expense",
    amount: 250,
    category: "Entertainment",
    description: "Movie night",
    date: daysAgoISO(10),
    source: "manual",
    createdAt: daysAgoISODateTime(10, 21, 0),
  },
];

let userSettings: UserSettings = {
  displayName: "Arjun",
  email: "arjun@example.com",
  timezone: "Asia/Kolkata",
  calorieTarget: 2800,
  proteinTarget: 140,
  weightUnit: "kg",
  monthlyBudget: 6000,
  currency: "INR",
  budgetCycleStartDay: 1,
  theme: "system",
  aiProvider: "Not connected",
  aiModel: "Not connected",
  aiConnected: false,
};

let chatHistory: Record<string, Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string; status: "sent"; action?: unknown }>> = {};

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

function mealsInRange(range?: DateRange): Meal[] {
  if (!range) return [...meals];
  return meals.filter((m) => {
    const d = toISODate(new Date(m.loggedAt));
    return d >= range.from && d <= range.to;
  });
}

function weighInsInRange(range?: DateRange): WeighIn[] {
  if (!range) return [...weighIns];
  return weighIns.filter((w) => w.date >= range.from && w.date <= range.to);
}

function currentMonthRange(): DateRange {
  const now = new Date();
  const from = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { from, to };
}

function buildActivityFeed(limit = 12): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const meal of meals) {
    items.push({
      id: `activity_meal_${meal.id}`,
      type: "meal",
      title: `Logged ${meal.type}`,
      subtitle: `${meal.items.map((i) => i.name).join(", ")} \u00b7 ~${Math.round(meal.totalCalories)} kcal`,
      timestamp: meal.loggedAt,
      recordId: meal.id,
    });
  }

  for (const txn of transactions) {
    items.push({
      id: `activity_txn_${txn.id}`,
      type: txn.type === "income" ? "income" : "expense",
      title: txn.type === "income" ? `Received ${txn.category}` : `Spent on ${txn.category}`,
      subtitle: txn.description,
      timestamp: txn.createdAt,
      amount: txn.type === "income" ? txn.amount : -txn.amount,
      recordId: txn.id,
    });
  }

  for (const w of weighIns) {
    items.push({
      id: `activity_weight_${w.id}`,
      type: "weight",
      title: "Weight check-in",
      subtitle: `${w.weightKg.toFixed(1)} kg`,
      timestamp: new Date(`${w.date}T12:00:00`).toISOString(),
      recordId: w.id,
    });
  }

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function computeDashboardSummary(): DashboardSummary {
  const todayRange: DateRange = { from: toISODate(new Date()), to: toISODate(new Date()) };
  const monthRange = currentMonthRange();

  const todaysMeals = mealsInRange(todayRange);
  const caloriesConsumed = sum(todaysMeals.map((m) => m.totalCalories));
  const proteinConsumed = sum(todaysMeals.map((m) => m.totalProtein));

  const sortedWeighIns = [...weighIns].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sortedWeighIns[sortedWeighIns.length - 1] ?? null;
  const previous = sortedWeighIns[sortedWeighIns.length - 2] ?? null;

  const monthTxns = transactions.filter((t) => t.date >= monthRange.from && t.date <= monthRange.to);
  const spentThisMonth = sum(monthTxns.filter((t) => t.type === "expense").map((t) => t.amount));
  const incomeThisMonth = sum(monthTxns.filter((t) => t.type === "income").map((t) => t.amount));
  const availableBalance = sum(transactions.map((t) => (t.type === "income" ? t.amount : -t.amount)));

  const categoryTotals = new Map<string, number>();
  for (const t of monthTxns.filter((t) => t.type === "expense")) {
    categoryTotals.set(t.category, (categoryTotals.get(t.category) ?? 0) + t.amount);
  }

  return {
    date: toISODate(new Date()),
    caloriesConsumed,
    proteinConsumed,
    calorieTarget: userSettings.calorieTarget,
    proteinTarget: userSettings.proteinTarget,
    latestWeightKg: latest ? latest.weightKg : null,
    weightChangeKg: latest && previous ? Number((latest.weightKg - previous.weightKg).toFixed(1)) : null,
    recentMeals: [...meals].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt)).slice(0, 5),
    weightHistory: sortedWeighIns,
    availableBalance,
    monthlyBudget: userSettings.monthlyBudget,
    spentThisMonth,
    incomeThisMonth,
    recentTransactions: [...transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    categorySpend: Array.from(categoryTotals.entries()).map(([category, amount]) => ({ category, amount })),
    recentActivity: buildActivityFeed(),
  };
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

const demoTrackerService: TrackerService = {
  async getDashboardSummary() {
    await simulateLatency();
    return computeDashboardSummary();
  },

  async getMeals(range) {
    await simulateLatency();
    return mealsInRange(range).sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  },

  async createMeal(input: CreateMealInput) {
    await simulateLatency();
    if (!input.items.length) {
      throw new ApiError("A meal needs at least one food item.", "VALIDATION_ERROR");
    }
    const items = input.items.map((item) => ({ ...item, id: generateId("fi") }));
    const meal: Meal = {
      id: generateId("meal"),
      type: input.type,
      items,
      totalCalories: sum(items.map((i) => i.calories)),
      totalProtein: sum(items.map((i) => i.protein)),
      loggedAt: input.loggedAt ?? new Date().toISOString(),
      note: input.note,
      source: "manual",
    };
    meals = [meal, ...meals];
    return meal;
  },

  async updateMeal(id: string, input: UpdateMealInput) {
    await simulateLatency();
    const index = meals.findIndex((m) => m.id === id);
    if (index === -1) throw new ApiError("Meal not found.", "NOT_FOUND");
    const existing = meals[index];
    const items = input.items
      ? input.items.map((item) => ({ ...item, id: generateId("fi") }))
      : existing.items;
    const updated: Meal = {
      ...existing,
      type: input.type ?? existing.type,
      items,
      totalCalories: sum(items.map((i) => i.calories)),
      totalProtein: sum(items.map((i) => i.protein)),
      loggedAt: input.loggedAt ?? existing.loggedAt,
      note: input.note ?? existing.note,
    };
    meals = [...meals.slice(0, index), updated, ...meals.slice(index + 1)];
    return updated;
  },

  async deleteMeal(id: string) {
    await simulateLatency();
    const exists = meals.some((m) => m.id === id);
    if (!exists) throw new ApiError("Meal not found.", "NOT_FOUND");
    meals = meals.filter((m) => m.id !== id);
  },

  async getTransactions(filters?: TransactionFilters) {
    await simulateLatency();
    let result = [...transactions];
    if (filters?.type && filters.type !== "all") {
      result = result.filter((t) => t.type === filters.type);
    }
    if (filters?.category && filters.category !== "all") {
      result = result.filter((t) => t.category === filters.category);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t) => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q),
      );
    }
    if (filters?.from) {
      result = result.filter((t) => t.date >= filters.from!);
    }
    if (filters?.to) {
      result = result.filter((t) => t.date <= filters.to!);
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createTransaction(input: CreateTransactionInput) {
    await simulateLatency();
    if (input.amount <= 0) {
      throw new ApiError("Amount must be greater than zero.", "VALIDATION_ERROR");
    }
    const txn: Transaction = {
      id: generateId("txn"),
      type: input.type,
      amount: input.amount,
      category: input.category,
      description: input.description || input.category,
      date: input.date ?? toISODate(new Date()),
      note: input.note,
      source: "manual",
      createdAt: new Date().toISOString(),
    };
    transactions = [txn, ...transactions];
    return txn;
  },

  async updateTransaction(id: string, input: UpdateTransactionInput) {
    await simulateLatency();
    const index = transactions.findIndex((t) => t.id === id);
    if (index === -1) throw new ApiError("Transaction not found.", "NOT_FOUND");
    const existing = transactions[index];
    const updated: Transaction = {
      ...existing,
      ...input,
      amount: input.amount ?? existing.amount,
    };
    transactions = [...transactions.slice(0, index), updated, ...transactions.slice(index + 1)];
    return updated;
  },

  async deleteTransaction(id: string) {
    await simulateLatency();
    const exists = transactions.some((t) => t.id === id);
    if (!exists) throw new ApiError("Transaction not found.", "NOT_FOUND");
    transactions = transactions.filter((t) => t.id !== id);
  },

  async getWeighIns(range) {
    await simulateLatency();
    return weighInsInRange(range).sort((a, b) => a.date.localeCompare(b.date));
  },

  async createWeighIn(input: CreateWeighInInput) {
    await simulateLatency();
    if (input.weightKg <= 0 || input.weightKg > 400) {
      throw new ApiError("Enter a realistic weight value.", "VALIDATION_ERROR");
    }
    const date = input.date ?? toISODate(new Date());
    const existingIndex = weighIns.findIndex((w) => w.date === date);
    const weighIn: WeighIn = {
      id: existingIndex >= 0 ? weighIns[existingIndex].id : generateId("wi"),
      weightKg: input.weightKg,
      date,
      note: input.note,
      source: "manual",
    };
    if (existingIndex >= 0) {
      weighIns = [...weighIns.slice(0, existingIndex), weighIn, ...weighIns.slice(existingIndex + 1)];
    } else {
      weighIns = [...weighIns, weighIn];
    }
    return weighIn;
  },

  async deleteWeighIn(id: string) {
    await simulateLatency();
    const exists = weighIns.some((w) => w.id === id);
    if (!exists) throw new ApiError("Weigh-in not found.", "NOT_FOUND");
    weighIns = weighIns.filter((w) => w.id !== id);
  },

  async getChatHistory(sessionId: string) {
    await simulateLatency();
    return (chatHistory[sessionId] ?? []) as never;
  },

  async sendChatMessage() {
    // The chat flow is orchestrated by the chat-engine + TrackerStoreProvider
    // so that it can read/write the same in-memory records as the rest of
    // the app. This placeholder keeps the TrackerService interface honest
    // for a future `POST /functions/v1/ai-chat` backed implementation.
    throw new ApiError(
      "sendChatMessage must be called through the AI chat engine in demo mode.",
      "BACKEND_UNAVAILABLE",
    );
  },

  async getUserSettings() {
    await simulateLatency();
    return { ...userSettings };
  },

  async updateUserSettings(input: Partial<UserSettings>) {
    await simulateLatency();
    userSettings = { ...userSettings, ...input };
    return { ...userSettings };
  },
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Food",
  "Transport",
  "Mobile recharge",
  "College",
  "Shopping",
  "Subscriptions",
  "Entertainment",
  "Other",
];

export const INCOME_CATEGORIES = ["Pocket money", "Salary", "Freelance", "Gift", "Other"] as const;

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

// Internal mutation helpers used by the chat engine so it shares the exact
// same in-memory arrays as the rest of the demo service.
export const __internal = {
  addMeal(meal: Meal) {
    meals = [meal, ...meals];
  },
  addTransaction(txn: Transaction) {
    transactions = [txn, ...transactions];
  },
  upsertTodayWeighIn(weighIn: WeighIn) {
    const index = weighIns.findIndex((w) => w.date === weighIn.date);
    if (index >= 0) {
      weighIns = [...weighIns.slice(0, index), weighIn, ...weighIns.slice(index + 1)];
    } else {
      weighIns = [...weighIns, weighIn];
    }
  },
  updateTransactionByDescriptionAndDate(matcher: (t: Transaction) => boolean, newAmount: number) {
    const index = transactions.findIndex(matcher);
    if (index === -1) return null;
    const updated = { ...transactions[index], amount: newAmount };
    transactions = [...transactions.slice(0, index), updated, ...transactions.slice(index + 1)];
    return updated;
  },
  getTransactions: () => transactions,
  getMeals: () => meals,
  getWeighIns: () => weighIns,
  getSettings: () => userSettings,
};


/** Select the storage adapter once. Demo mode is the safe default. */
export const trackerService: TrackerService = BACKEND_MODE === "live"
  ? new HttpTrackerService()
  : demoTrackerService;
