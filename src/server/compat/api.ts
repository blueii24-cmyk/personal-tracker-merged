import type {
  ChatAttachment,
  ChatMessage,
  DashboardSummary,
  DateRange,
  Meal,
  MealInput,
  TrackerSnapshot,
  Transaction,
  TransactionInput,
  UserSettings,
  UserSettingsInput,
  WeighIn,
  WeighInInput,
} from "@/server/compat/domain";

export type TrackerOperation =
  | { op: "createMeal"; input: MealInput }
  | { op: "updateMeal"; id: string; input: MealInput }
  | { op: "deleteMeal"; id: string }
  | { op: "createTransaction"; input: TransactionInput }
  | { op: "updateTransaction"; id: string; input: TransactionInput }
  | { op: "deleteTransaction"; id: string }
  | { op: "saveWeighIn"; input: WeighInInput }
  | { op: "deleteWeighIn"; id: string }
  | { op: "updateSettings"; input: UserSettingsInput }
  | { op: "clearChat"; sessionId: string }
  | { op: "resetDemoData" };

export type CreatedEntity =
  | { kind: "meal"; record: Meal }
  | { kind: "transaction"; record: Transaction }
  | { kind: "weighIn"; record: WeighIn };

export interface MutationResult {
  snapshot: TrackerSnapshot;
  created: CreatedEntity | null;
}

export interface ChatResult {
  snapshot: TrackerSnapshot;
  attachment: ChatAttachment | null;
}

export interface TransactionFilters {
  type?: "expense" | "income";
  category?: string;
  month?: string;
  search?: string;
  range?: DateRange;
}

export interface SendChatMessageOptions {
  signal?: AbortSignal;
}

export type ServiceErrorCode =
  | "network"
  | "validation"
  | "not_found"
  | "server"
  | "cancelled"
  | "unavailable";

export class TrackerServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "TrackerServiceError";
    this.code = code;
  }
}

/**
 * Storage boundary for the whole app. A Supabase-backed implementation can be
 * dropped in later without touching any UI component.
 */
export interface TrackerService {
  getSnapshot(): Promise<TrackerSnapshot>;
  getDashboardSummary(): Promise<DashboardSummary>;

  getMeals(range?: DateRange): Promise<Meal[]>;
  createMeal(input: MealInput): Promise<MutationResult>;
  updateMeal(id: string, input: MealInput): Promise<MutationResult>;
  deleteMeal(id: string): Promise<MutationResult>;

  getTransactions(filters?: TransactionFilters): Promise<Transaction[]>;
  createTransaction(input: TransactionInput): Promise<MutationResult>;
  updateTransaction(id: string, input: TransactionInput): Promise<MutationResult>;
  deleteTransaction(id: string): Promise<MutationResult>;

  getWeighIns(range?: DateRange): Promise<WeighIn[]>;
  saveWeighIn(input: WeighInInput): Promise<MutationResult>;
  deleteWeighIn(id: string): Promise<MutationResult>;

  getChatHistory(sessionId: string): Promise<ChatMessage[]>;
  sendChatMessage(
    input: { content: string; sessionId: string },
    options?: SendChatMessageOptions,
  ): Promise<ChatResult>;

  getUserSettings(): Promise<UserSettings>;
  updateUserSettings(input: UserSettingsInput): Promise<MutationResult>;

  clearChat(sessionId: string): Promise<MutationResult>;
  resetDemoData(): Promise<MutationResult>;
}
