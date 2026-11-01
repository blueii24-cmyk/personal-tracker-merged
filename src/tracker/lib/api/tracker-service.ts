/**
 * The data-access boundary. Components talk only to this interface (via the store);
 * a Supabase-backed implementation can replace the mock without touching the UI.
 */
import type { AiChatRequest, AiChatResponse } from '@/tracker/types/api';
import type { AiProviderId } from '@/tracker/lib/ai/provider';
import type {
  AiStatus,
  ChatMessage,
  ChatSession,
  DashboardSummary,
  DateRange,
  Meal,
  MealInput,
  RecordSource,
  Transaction,
  TransactionFilters,
  TransactionInput,
  UserSettings,
  UserSettingsInput,
  WeighIn,
  WeighInInput,
} from '@/tracker/types/domain';
import { MockTrackerService } from './mock/mock-tracker-service';

export interface RequestOptions {
  signal?: AbortSignal;
}

/** `AiChatResponse` plus the demo provider id. A real backend returns a concrete AiProviderId. */
export type ChatReply = Omit<AiChatResponse, 'provider' | 'model'> & {
  provider: AiProviderId | 'demo';
  model: string;
  /** Where saved records live. The UI labels demo saves as "Demo" and never as cloud-saved. */
  persistence: 'demo' | 'cloud';
};

export interface WriteOptions {
  /** Who created the record. The chat engine passes `ai`; forms use the default (`manual`). */
  source?: RecordSource;
}

/** A finished chat turn produced outside the service (by the user's own model) to be stored as one exchange. */
export interface ChatExchange {
  sessionId?: string;
  clientMessageId: string;
  userMessage: string;
  assistantMessage: string;
  actions: AiChatResponse['actions'];
  dashboardInvalidation: AiChatResponse['dashboardInvalidation'];
  provider: AiProviderId;
  model: string;
}

export interface ExportBundle {
  /** Identifies the file as ours when it is chosen again for restore. Absent in exports made by older versions. */
  app?: 'personal-tracker';
  formatVersion?: number;
  exportedAt: string;
  meals: Meal[];
  transactions: Transaction[];
  weighIns: WeighIn[];
  settings: UserSettings;
}

export interface TrackerService {
  /** `demo` = in-browser mock data. `connected` = real persistence. */
  readonly mode: 'demo' | 'connected';

  getDashboardSummary(opts?: RequestOptions): Promise<DashboardSummary>;

  getMeals(range?: DateRange, opts?: RequestOptions): Promise<Meal[]>;
  createMeal(input: MealInput, opts?: WriteOptions): Promise<Meal>;
  updateMeal(id: string, input: MealInput): Promise<Meal>;
  deleteMeal(id: string): Promise<void>;
  /** Re-insert a deleted record with its original id (undo). */
  restoreMeal(meal: Meal): Promise<Meal>;

  getTransactions(filters?: TransactionFilters, opts?: RequestOptions): Promise<Transaction[]>;
  createTransaction(input: TransactionInput, opts?: WriteOptions): Promise<Transaction>;
  updateTransaction(id: string, input: TransactionInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  restoreTransaction(tx: Transaction): Promise<Transaction>;

  getWeighIns(range?: DateRange, opts?: RequestOptions): Promise<WeighIn[]>;
  createWeighIn(input: WeighInInput, opts?: WriteOptions): Promise<WeighIn>;
  updateWeighIn(id: string, input: WeighInInput): Promise<WeighIn>;
  deleteWeighIn(id: string): Promise<void>;
  restoreWeighIn(w: WeighIn): Promise<WeighIn>;

  getChatSessions(): Promise<ChatSession[]>;
  getChatHistory(sessionId: string): Promise<ChatMessage[]>;
  sendChatMessage(input: AiChatRequest, opts?: RequestOptions): Promise<ChatReply>;
  /** The stored reply for a message id that was already handled, so a retry never repeats saved actions. */
  findChatReply(clientMessageId: string): Promise<ChatReply | null>;
  /** Store a turn that was answered by the user's own model. Idempotent on `clientMessageId`. */
  recordChatExchange(exchange: ChatExchange): Promise<ChatReply>;
  deleteChatSession(sessionId: string): Promise<void>;

  getUserSettings(): Promise<UserSettings>;
  updateUserSettings(input: UserSettingsInput): Promise<UserSettings>;
  getAiStatus(): Promise<AiStatus>;

  exportData(): Promise<ExportBundle>;
  /** Restore: replaces meals, transactions, weigh-ins and settings with a validated backup. Chats are kept. */
  importData(bundle: ExportBundle): Promise<{ meals: number; transactions: number; weighIns: number }>;
  /** Permanently deletes every meal, transaction, weigh-in and conversation on this device. Settings are kept. */
  eraseAllData(): Promise<void>;
  /** A one-time message when stored data had to be set aside at startup, or storage is unavailable. */
  takeStorageNotice(): string | null;
  /** Demo only: wipe local demo data and re-seed. Absent on real backends. */
  resetDemoData?(): Promise<void>;
}

export function createTrackerService(): TrackerService {
  // A Supabase-backed implementation will be selected here once auth + client are configured.
  // Until then the app always runs on the clearly-labelled in-browser mock.
  return new MockTrackerService();
}
