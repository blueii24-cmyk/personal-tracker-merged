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
import type { CalendarEvent, CalendarEventInput, CalendarPrefs } from '@/tracker/types/calendar';
import { SyncedTrackerService } from '@/tracker/sync/synced-service';

export interface RequestOptions {
  signal?: AbortSignal;
}

/** `AiChatResponse` plus the built-in rule-based provider id. */
export type ChatReply = Omit<AiChatResponse, 'provider' | 'model'> & {
  provider: AiProviderId | 'demo';
  model: string;
  /** Where saved records live. Local saves are never labelled as cloud-saved. */
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
  editOfMessageId?: string;
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
  /** Added in format 2. App-created events only (Google copies are re-synced, never backed up). */
  calendarEvents?: CalendarEvent[];
  calendarPrefs?: CalendarPrefs;
}

export interface TrackerService {
  /** `demo` = local app storage. `connected` = local-first storage with account sync. */
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

  /** Events overlapping `range` (all events when omitted). */
  getCalendarEvents(range?: DateRange): Promise<CalendarEvent[]>;
  createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  /** Only app-owned events can be edited; Google copies are read-only here. */
  updateCalendarEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent>;
  deleteCalendarEvent(id: string): Promise<void>;
  restoreCalendarEvent(event: CalendarEvent): Promise<CalendarEvent>;
  getCalendarPrefs(): Promise<CalendarPrefs>;
  updateCalendarPrefs(input: Partial<CalendarPrefs>): Promise<CalendarPrefs>;

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
}

export function createTrackerService(): TrackerService {
  // Always local-first: the synced service reads and writes this device and, only when a Supabase account is signed in,
  // keeps a cloud copy in step. With no Supabase variables or no signed-in user it behaves exactly like the local mock.
  return new SyncedTrackerService();
}
