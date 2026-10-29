// Typed service contracts for the data-access boundary. The current
// implementation (see src/lib/api/tracker-service.ts) is an in-memory demo
// service. A future Supabase-backed implementation can satisfy the same
// interfaces without any UI changes.

import type {
  ChatMessage,
  DashboardSummary,
  ExpenseCategory,
  FoodItem,
  IncomeCategory,
  Meal,
  MealType,
  Transaction,
  TransactionType,
  UserSettings,
  WeighIn,
} from "./domain";

export type ApiErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "BACKEND_UNAVAILABLE"
  | "UNKNOWN";

export class ApiError extends Error {
  code: ApiErrorCode;

  constructor(message: string, code: ApiErrorCode = "UNKNOWN") {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export interface DateRange {
  from: string; // ISO date, inclusive
  to: string; // ISO date, inclusive
}

export interface CreateMealInput {
  type: MealType;
  items: Array<Pick<FoodItem, "name" | "quantity" | "calories" | "protein" | "isEstimate">>;
  loggedAt?: string;
  note?: string;
}

export type UpdateMealInput = Partial<CreateMealInput>;

export interface CreateWeighInInput {
  weightKg: number;
  date?: string;
  note?: string;
}

export interface TransactionFilters {
  type?: TransactionType | "all";
  category?: ExpenseCategory | IncomeCategory | "all";
  search?: string;
  month?: string;
  from?: string;
  to?: string;
}

export interface CreateTransactionInput {
  type: TransactionType;
  amount: number;
  category: ExpenseCategory | IncomeCategory;
  description: string;
  date?: string;
  note?: string;
}

export type UpdateTransactionInput = Partial<CreateTransactionInput>;

export interface SendChatMessageInput {
  sessionId: string;
  content: string;
}

export interface SendChatMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export interface ServerChatResult {
  reply: string;
  action?: import("./domain").ChatActionResult;
}

/** UI-shaped operations sent to the private Next.js API adapter. */
export type TrackerOperationInput =
  | { op: "createMeal"; input: CreateMealInput }
  | { op: "updateMeal"; id: string; input: UpdateMealInput }
  | { op: "deleteMeal"; id: string }
  | { op: "createTransaction"; input: CreateTransactionInput }
  | { op: "updateTransaction"; id: string; input: UpdateTransactionInput }
  | { op: "deleteTransaction"; id: string }
  | { op: "createWeighIn"; input: CreateWeighInInput }
  | { op: "deleteWeighIn"; id: string }
  | { op: "updateSettings"; input: Partial<UserSettings> };

/**
 * Provider-agnostic service contract. A Supabase + edge-function backed
 * implementation can be swapped in without touching any component.
 */
export interface TrackerService {
  getDashboardSummary(): Promise<DashboardSummary>;

  getMeals(range?: DateRange): Promise<Meal[]>;
  createMeal(input: CreateMealInput): Promise<Meal>;
  updateMeal(id: string, input: UpdateMealInput): Promise<Meal>;
  deleteMeal(id: string): Promise<void>;

  getTransactions(filters?: TransactionFilters): Promise<Transaction[]>;
  createTransaction(input: CreateTransactionInput): Promise<Transaction>;
  updateTransaction(id: string, input: UpdateTransactionInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;

  getWeighIns(range?: DateRange): Promise<WeighIn[]>;
  createWeighIn(input: CreateWeighInInput): Promise<WeighIn>;
  deleteWeighIn(id: string): Promise<void>;

  getChatHistory(sessionId: string): Promise<ChatMessage[]>;
  sendChatMessage(input: SendChatMessageInput): Promise<ServerChatResult>;

  getUserSettings(): Promise<UserSettings>;
  updateUserSettings(input: Partial<UserSettings>): Promise<UserSettings>;

}
