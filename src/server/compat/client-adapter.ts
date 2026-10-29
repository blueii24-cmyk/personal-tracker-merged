import type {
  AiStatus as ServerAiStatus,
  ChatAttachment as ServerChatAttachment,
  ChatMessage as ServerChatMessage,
  Meal as ServerMeal,
  TrackerSnapshot as ServerSnapshot,
  Transaction as ServerTransaction,
  WeighIn as ServerWeighIn,
  UserSettings as ServerSettings,
} from "@/server/compat/domain";
import type { CreatedEntity, TrackerOperation } from "@/server/compat/api";
import type {
  ActivityItem,
  ChatActionResult,
  ChatMessage,
  DashboardSummary,
  ExpenseCategory,
  FoodItem,
  IncomeCategory,
  Meal,
  Transaction,
  UserSettings,
  WeighIn,
} from "@/types/domain";
import type { TrackerOperationInput } from "@/types/api";

export interface ClientSnapshot {
  storage: "database" | "demo";
  today: string;
  generatedAt: string;
  ai: ServerAiStatus;
  settings: UserSettings;
  meals: Meal[];
  transactions: Transaction[];
  weighIns: WeighIn[];
  chatMessages: ChatMessage[];
}

function source(value: string): "manual" | "ai" {
  return value === "manual" ? "manual" : "ai";
}

export function toClientMeal(row: ServerMeal): Meal {
  const items = (row.items ?? []).map((item) => {
    const extended = item as typeof item & { isEstimate?: boolean };
    return { ...item, isEstimate: extended.isEstimate ?? true } as FoodItem;
  });
  return {
    id: row.id,
    type: row.mealType as Meal["type"],
    items,
    totalCalories: items.reduce((sum, item) => sum + item.calories, 0),
    totalProtein: items.reduce((sum, item) => sum + item.protein, 0),
    // The database's date field is the user's selected local calendar day.
    // Noon UTC keeps that day stable in common timezones such as Asia/Kolkata.
    loggedAt: `${row.date}T12:00:00.000Z`,
    note: row.notes ?? undefined,
    source: source(row.source),
  };
}

export function toClientTransaction(row: ServerTransaction): Transaction {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    category: row.category as ExpenseCategory | IncomeCategory,
    description: row.description,
    date: row.date,
    note: row.notes ?? undefined,
    source: source(row.source),
    createdAt: row.createdAt,
  };
}

export function toClientWeighIn(row: ServerWeighIn): WeighIn {
  return {
    id: row.id,
    weightKg: row.weightKg,
    date: row.date,
    note: row.notes ?? undefined,
    source: source(row.source),
  };
}

export function toClientSettings(row: ServerSettings): UserSettings {
  return {
    displayName: row.displayName,
    email: row.email,
    timezone: row.timezone,
    calorieTarget: row.calorieTarget,
    proteinTarget: row.proteinTarget,
    weightUnit: row.weightUnit,
    monthlyBudget: row.monthlyBudget,
    currency: "INR",
    budgetCycleStartDay: 1,
    theme: row.theme,
    aiProvider: row.aiProvider,
    aiModel: row.aiModel,
    aiConnected: false,
  };
}

function actionForAttachment(
  attachment: ServerChatAttachment | null | undefined,
  snapshot: ServerSnapshot,
): ChatActionResult | undefined {
  if (!attachment) return undefined;
  if (attachment.kind === "meal") {
    const row = snapshot.meals.find((item) => item.id === attachment.id);
    if (!row) return undefined;
    return { kind: "meal-logged", title: "Meal logged", mock: snapshot.storage !== "database", meal: toClientMeal(row) };
  }
  if (attachment.kind === "transaction") {
    const row = snapshot.transactions.find((item) => item.id === attachment.id);
    if (!row) return undefined;
    const transaction = toClientTransaction(row);
    return {
      kind: transaction.type === "income" ? "income-logged" : "expense-logged",
      title: transaction.type === "income" ? "Income recorded" : "Expense recorded",
      mock: snapshot.storage !== "database",
      transaction,
    };
  }
  const row = snapshot.weighIns.find((item) => item.id === attachment.id);
  if (!row) return undefined;
  return { kind: "weight-logged", title: "Weight recorded", mock: snapshot.storage !== "database", weighIn: toClientWeighIn(row) };
}

export function toClientChatMessage(row: ServerChatMessage, snapshot: ServerSnapshot): ChatMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    status: "sent",
    action: actionForAttachment(row.attachment, snapshot),
  };
}

export function toClientSnapshot(snapshot: ServerSnapshot): ClientSnapshot {
  return {
    storage: snapshot.storage,
    today: snapshot.today,
    generatedAt: snapshot.generatedAt,
    ai: snapshot.ai,
    settings: toClientSettings(snapshot.settings),
    meals: snapshot.meals.map(toClientMeal),
    transactions: snapshot.transactions.map(toClientTransaction),
    weighIns: snapshot.weighIns.map(toClientWeighIn),
    chatMessages: snapshot.chatMessages.map((message) => toClientChatMessage(message, snapshot)),
  };
}

export function toClientCreated(created: CreatedEntity | null): { kind: "meal" | "transaction" | "weighIn"; record: Meal | Transaction | WeighIn } | null {
  if (!created) return null;
  if (created.kind === "meal") return { kind: "meal", record: toClientMeal(created.record) };
  if (created.kind === "transaction") return { kind: "transaction", record: toClientTransaction(created.record) };
  return { kind: "weighIn", record: toClientWeighIn(created.record) };
}

function safeDate(value: string | undefined, fallback: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return fallback;
}

function safeFoodItems(items: Array<{ name: string; quantity: string; calories: number; protein: number; isEstimate?: boolean }>) {
  return items.map((item) => ({
    name: item.name.trim().slice(0, 100),
    quantity: item.quantity.trim().slice(0, 100),
    calories: item.calories,
    protein: item.protein,
    isEstimate: item.isEstimate ?? true,
  }));
}

/** Translate the public, UI-shaped operation into the legacy store's validated operation. */
export function toServerOperation(
  payload: TrackerOperationInput,
  current: ServerSnapshot,
): TrackerOperation {
  const today = current.today;
  switch (payload.op) {
    case "createMeal": {
      const input = payload.input;
      if (!input || !Array.isArray(input.items) || input.items.length === 0) throw new Error("Invalid input: add at least one food item.");
      return {
        op: "createMeal",
        input: {
          date: safeDate(input.loggedAt, today),
          mealType: input.type,
          title: input.items.map((item) => item.name.trim()).filter(Boolean).join(" · ").slice(0, 120) || "Meal",
          items: safeFoodItems(input.items),
          notes: input.note?.trim().slice(0, 500),
          source: "manual",
        },
      };
    }
    case "updateMeal": {
      if (!payload.id || typeof payload.id !== "string") throw new Error("Invalid input: a meal ID is required.");
      const existing = current.meals.find((item) => item.id === payload.id);
      if (!existing) throw new Error("Meal not found.");
      const input = payload.input;
      const items = input.items ? safeFoodItems(input.items) : existing.items;
      return {
        op: "updateMeal",
        id: payload.id,
        input: {
          date: safeDate(input.loggedAt, existing.date),
          mealType: input.type ?? (existing.mealType as ServerMeal["mealType"]),
          title: input.items ? items.map((item) => item.name).join(" · ").slice(0, 120) : existing.title,
          items,
          notes: input.note === undefined ? existing.notes ?? undefined : input.note?.trim().slice(0, 500),
          source: existing.source as ServerMeal["source"],
        },
      };
    }
    case "deleteMeal":
      return { op: "deleteMeal", id: payload.id };
    case "createTransaction": {
      const input = payload.input;
      if (!input || !Number.isFinite(input.amount) || input.amount <= 0 || typeof input.description !== "string" || !input.description.trim()) throw new Error("Invalid input: enter a positive amount and description.");
      return {
        op: "createTransaction",
        input: {
          type: input.type,
          amount: input.amount,
          category: input.category,
          description: input.description.trim().slice(0, 120),
          date: input.date ?? today,
          notes: input.note?.trim().slice(0, 500),
          source: "manual",
        },
      };
    }
    case "updateTransaction": {
      if (!payload.id || typeof payload.id !== "string") throw new Error("Invalid input: a transaction ID is required.");
      const existing = current.transactions.find((item) => item.id === payload.id);
      if (!existing) throw new Error("Transaction not found.");
      const input = payload.input;
      return {
        op: "updateTransaction",
        id: payload.id,
        input: {
          type: input.type ?? existing.type,
          amount: input.amount ?? existing.amount,
          category: input.category ?? (existing.category as ExpenseCategory | IncomeCategory),
          description: input.description?.trim().slice(0, 120) ?? existing.description,
          date: input.date ?? existing.date,
          notes: input.note === undefined ? existing.notes ?? undefined : input.note?.trim().slice(0, 500),
          source: existing.source as ServerTransaction["source"],
        },
      };
    }
    case "deleteTransaction":
      return { op: "deleteTransaction", id: payload.id };
    case "createWeighIn":
      if (!payload.input || !Number.isFinite(payload.input.weightKg)) throw new Error("Invalid input: enter a valid weight.");
      return {
        op: "saveWeighIn",
        input: {
          date: payload.input.date ?? today,
          weightKg: payload.input.weightKg,
          notes: payload.input.note?.trim().slice(0, 500),
          source: "manual",
        },
      };
    case "deleteWeighIn":
      return { op: "deleteWeighIn", id: payload.id };
    case "updateSettings": {
      const input = payload.input;
      if (!input || typeof input !== "object") throw new Error("Invalid input: settings are required.");
      return {
        op: "updateSettings",
        input: {
          displayName: input.displayName,
          email: input.email,
          timezone: input.timezone,
          calorieTarget: input.calorieTarget,
          proteinTarget: input.proteinTarget,
          weightUnit: input.weightUnit,
          monthlyBudget: input.monthlyBudget,
          currency: input.currency,
          theme: input.theme,
        },
      };
    }
  }
}

export function buildClientSummary(snapshot: ClientSnapshot): DashboardSummary {
  const localDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(0, 10);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const today = localDate(new Date().toISOString());
  const month = today.slice(0, 7);
  const todaysMeals = snapshot.meals.filter((meal) => localDate(meal.loggedAt) === today);
  const expenses = snapshot.transactions.filter((txn) => txn.type === "expense");
  const income = snapshot.transactions.filter((txn) => txn.type === "income");
  const monthTransactions = snapshot.transactions.filter((txn) => txn.date.startsWith(month));
  const monthExpenses = monthTransactions.filter((txn) => txn.type === "expense");
  const categorySpend = new Map<string, number>();
  for (const txn of monthExpenses) categorySpend.set(txn.category, (categorySpend.get(txn.category) ?? 0) + txn.amount);
  const sortedWeights = [...snapshot.weighIns].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sortedWeights.at(-1) ?? null;
  const previous = sortedWeights.at(-2) ?? null;
  const recentMeals = [...snapshot.meals].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt)).slice(0, 5);
  const recentTransactions = [...snapshot.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const activity: ActivityItem[] = [];
  for (const meal of snapshot.meals) activity.push({ id: `meal-${meal.id}`, type: "meal", title: `Logged ${meal.type}`, subtitle: meal.items.map((item) => item.name).join(", "), timestamp: meal.loggedAt, recordId: meal.id });
  for (const txn of snapshot.transactions) activity.push({ id: `tx-${txn.id}`, type: txn.type, title: txn.type === "income" ? `Received ${txn.category}` : `Spent on ${txn.category}`, subtitle: txn.description, timestamp: txn.createdAt, amount: txn.type === "income" ? txn.amount : -txn.amount, recordId: txn.id });
  for (const weight of snapshot.weighIns) activity.push({ id: `weight-${weight.id}`, type: "weight", title: "Weight check-in", subtitle: `${weight.weightKg.toFixed(1)} kg`, timestamp: `${weight.date}T12:00:00.000Z`, recordId: weight.id });
  return {
    date: today,
    caloriesConsumed: todaysMeals.reduce((sum, meal) => sum + meal.totalCalories, 0),
    proteinConsumed: todaysMeals.reduce((sum, meal) => sum + meal.totalProtein, 0),
    calorieTarget: snapshot.settings.calorieTarget,
    proteinTarget: snapshot.settings.proteinTarget,
    latestWeightKg: latest?.weightKg ?? null,
    weightChangeKg: latest && previous ? Number((latest.weightKg - previous.weightKg).toFixed(1)) : null,
    recentMeals,
    weightHistory: sortedWeights,
    availableBalance: income.reduce((sum, txn) => sum + txn.amount, 0) - expenses.reduce((sum, txn) => sum + txn.amount, 0),
    monthlyBudget: snapshot.settings.monthlyBudget,
    spentThisMonth: monthExpenses.reduce((sum, txn) => sum + txn.amount, 0),
    incomeThisMonth: monthTransactions.filter((txn) => txn.type === "income").reduce((sum, txn) => sum + txn.amount, 0),
    recentTransactions,
    categorySpend: [...categorySpend].map(([category, amount]) => ({ category, amount })),
    recentActivity: activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 12),
  };
}
