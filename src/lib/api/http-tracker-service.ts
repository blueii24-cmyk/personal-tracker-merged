import type {
  ActivityItem,
  ChatActionResult,
  ChatMessage,
  DashboardSummary,
  ExpenseCategory,
  IncomeCategory,
  Meal,
  Transaction,
  UserSettings,
  WeighIn,
} from "@/types/domain";
import type {
  CreateMealInput,
  CreateTransactionInput,
  CreateWeighInInput,
  DateRange,
  ServerChatResult,
  TrackerService,
  TrackerOperationInput,
  TransactionFilters,
  UpdateMealInput,
  UpdateTransactionInput,
} from "@/types/api";
import { ApiError } from "@/types/api";
import type { ClientSnapshot } from "@/server/compat/client-adapter";

interface MutationResponse {
  snapshot: ClientSnapshot;
  created: { kind: "meal" | "transaction" | "weighIn"; record: Meal | Transaction | WeighIn } | null;
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json() as { error?: { message?: string; code?: string } };
    const code = body.error?.code === "validation" ? "VALIDATION_ERROR"
      : body.error?.code === "not_found" ? "NOT_FOUND"
      : body.error?.code === "unavailable" ? "BACKEND_UNAVAILABLE" : "UNKNOWN";
    return new ApiError(body.error?.message ?? `Request failed (${response.status}).`, code);
  } catch {
    return new ApiError(`Request failed (${response.status}).`, "UNKNOWN");
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("The tracker API could not be reached.", "BACKEND_UNAVAILABLE");
  }
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function isoLocalDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function summaryFrom(snapshot: ClientSnapshot): DashboardSummary {
  const today = isoLocalDate(new Date());
  const month = today.slice(0, 7);
  const todaysMeals = snapshot.meals.filter((meal) => isoLocalDate(meal.loggedAt) === today);
  const monthTxns = snapshot.transactions.filter((txn) => txn.date.startsWith(month));
  const monthExpenses = monthTxns.filter((txn) => txn.type === "expense");
  const monthIncome = monthTxns.filter((txn) => txn.type === "income");
  const sortedWeights = [...snapshot.weighIns].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sortedWeights.at(-1) ?? null;
  const previous = sortedWeights.at(-2) ?? null;
  const spendByCategory = new Map<string, number>();
  for (const txn of monthExpenses) spendByCategory.set(txn.category, (spendByCategory.get(txn.category) ?? 0) + txn.amount);
  const recentMeals = [...snapshot.meals].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt)).slice(0, 5);
  const recentTransactions = [...snapshot.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const recentActivity: ActivityItem[] = [
    ...snapshot.meals.map((meal) => ({ id: `meal-${meal.id}`, type: "meal" as const, title: `Logged ${meal.type}`, subtitle: meal.items.map((item) => item.name).join(", "), timestamp: meal.loggedAt, recordId: meal.id })),
    ...snapshot.transactions.map((txn) => ({ id: `txn-${txn.id}`, type: txn.type, title: txn.type === "income" ? `Received ${txn.category}` : `Spent on ${txn.category}`, subtitle: txn.description, timestamp: txn.createdAt, amount: txn.type === "income" ? txn.amount : -txn.amount, recordId: txn.id })),
    ...snapshot.weighIns.map((weighIn) => ({ id: `weight-${weighIn.id}`, type: "weight" as const, title: "Weight check-in", subtitle: `${weighIn.weightKg.toFixed(1)} kg`, timestamp: `${weighIn.date}T12:00:00.000Z`, recordId: weighIn.id })),
  ];
  return {
    date: today,
    caloriesConsumed: sum(todaysMeals.map((meal) => meal.totalCalories)),
    proteinConsumed: sum(todaysMeals.map((meal) => meal.totalProtein)),
    calorieTarget: snapshot.settings.calorieTarget,
    proteinTarget: snapshot.settings.proteinTarget,
    latestWeightKg: latest?.weightKg ?? null,
    weightChangeKg: latest && previous ? Number((latest.weightKg - previous.weightKg).toFixed(1)) : null,
    recentMeals,
    weightHistory: sortedWeights,
    availableBalance: sum(snapshot.transactions.filter((txn) => txn.type === "income").map((txn) => txn.amount)) - sum(snapshot.transactions.filter((txn) => txn.type === "expense").map((txn) => txn.amount)),
    monthlyBudget: snapshot.settings.monthlyBudget,
    spentThisMonth: sum(monthExpenses.map((txn) => txn.amount)),
    incomeThisMonth: sum(monthIncome.map((txn) => txn.amount)),
    recentTransactions,
    categorySpend: [...spendByCategory].map(([category, amount]) => ({ category, amount })),
    recentActivity: recentActivity.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 12),
  };
}

export class HttpTrackerService implements TrackerService {
  private getSnapshot() { return requestJson<ClientSnapshot>("/api/state"); }

  private mutate(operation: TrackerOperationInput) {
    return requestJson<MutationResponse>("/api/tracker", { method: "POST", body: JSON.stringify(operation) });
  }

  async getDashboardSummary() { return summaryFrom(await this.getSnapshot()); }

  async getMeals(range?: DateRange) {
    const data = (await this.getSnapshot()).meals;
    return data.filter((meal) => {
      const date = isoLocalDate(meal.loggedAt);
      return (!range?.from || date >= range.from) && (!range?.to || date <= range.to);
    }).sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  }

  async createMeal(input: CreateMealInput) {
    const result = await this.mutate({ op: "createMeal", input });
    if (result.created?.kind !== "meal") throw new ApiError("Meal was not returned after saving.");
    return result.created.record as Meal;
  }

  async updateMeal(id: string, input: UpdateMealInput) {
    const result = await this.mutate({ op: "updateMeal", id, input });
    if (result.created?.kind !== "meal") throw new ApiError("Updated meal was not returned.");
    return result.created.record as Meal;
  }

  async deleteMeal(id: string) { await this.mutate({ op: "deleteMeal", id }); }

  async getTransactions(filters?: TransactionFilters) {
    return (await this.getSnapshot()).transactions.filter((txn) => {
      if (filters?.type && filters.type !== "all" && txn.type !== filters.type) return false;
      if (filters?.category && filters.category !== "all" && txn.category !== filters.category) return false;
      if (filters?.month && !txn.date.startsWith(filters.month)) return false;
      if (filters?.from && txn.date < filters.from) return false;
      if (filters?.to && txn.date > filters.to) return false;
      if (filters?.search && !`${txn.description} ${txn.category} ${txn.note ?? ""}`.toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createTransaction(input: CreateTransactionInput) {
    const result = await this.mutate({ op: "createTransaction", input });
    if (result.created?.kind !== "transaction") throw new ApiError("Transaction was not returned after saving.");
    return result.created.record as Transaction;
  }

  async updateTransaction(id: string, input: UpdateTransactionInput) {
    const result = await this.mutate({ op: "updateTransaction", id, input });
    if (result.created?.kind !== "transaction") throw new ApiError("Updated transaction was not returned.");
    return result.created.record as Transaction;
  }

  async deleteTransaction(id: string) { await this.mutate({ op: "deleteTransaction", id }); }

  async getWeighIns(range?: DateRange) {
    return (await this.getSnapshot()).weighIns.filter((weight) => (!range?.from || weight.date >= range.from) && (!range?.to || weight.date <= range.to)).sort((a, b) => a.date.localeCompare(b.date));
  }

  async createWeighIn(input: CreateWeighInInput) {
    const result = await this.mutate({ op: "createWeighIn", input });
    if (result.created?.kind !== "weighIn") throw new ApiError("Weight check-in was not returned after saving.");
    return result.created.record as WeighIn;
  }

  async deleteWeighIn(id: string) { await this.mutate({ op: "deleteWeighIn", id }); }

  async getUserSettings() { return (await this.getSnapshot()).settings; }

  async updateUserSettings(input: Partial<UserSettings>) {
    return (await this.mutate({ op: "updateSettings", input })).snapshot.settings;
  }

  async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
    return (await this.getSnapshot()).chatMessages.filter((message) => !message.sessionId || message.sessionId === sessionId);
  }

  async sendChatMessage(input: { content: string; sessionId: string }): Promise<ServerChatResult> {
    return requestJson<ServerChatResult>("/api/chat", { method: "POST", body: JSON.stringify(input) });
  }
}

// Keep these aliases handy for future API adapters without exposing provider logic to UI components.
export type TrackerCategory = ExpenseCategory | IncomeCategory;
