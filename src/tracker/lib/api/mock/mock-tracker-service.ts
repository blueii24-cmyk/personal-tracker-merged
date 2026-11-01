import { isBackendConfigured } from '@/tracker/config';
import { budgetSummary, filterTransactions, trackedBalance } from '@/tracker/features/transactions/calculations';
import { nutritionTotals, mealsOnDate } from '@/tracker/features/meals/calculations';
import { weightSummary, weighInsInRange } from '@/tracker/features/weigh-ins/calculations';
import { buildActivity } from '@/tracker/features/history/activity';
import { dateKeyInTz, isValidTimezone, monthKeyInTz, todayKey } from '@/tracker/lib/formatting/dates';
import type { AiChatRequest } from '@/tracker/types/api';
import type {
  AiStatus, ChatMessage, ChatSession, DashboardSummary, DateRange, Meal, MealInput, Transaction, TransactionFilters,
  TransactionInput, UserSettings, UserSettingsInput, WeighIn, WeighInInput,
} from '@/tracker/types/domain';
import { TrackerError } from '../errors';
import type { ChatExchange, ChatReply, ExportBundle, RequestOptions, TrackerService, WriteOptions } from '../tracker-service';
import { runDemoAssistant } from './demo-ai';
import { buildSeedDb, type DemoDb } from './seed';

const STORAGE_KEY = 'pt.demo.db.v1';
const LATENCY_MS = 120;
const CHAT_LATENCY_MS = 650;

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const clone = <T>(v: T): T => structuredClone(v);

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new TrackerError('ABORTED', 'The request was cancelled.', { retryable: true }));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new TrackerError('ABORTED', 'The request was cancelled.', { retryable: true }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * DEMO ONLY. Keeps every record in memory and mirrors it to this browser's localStorage so a refresh
 * keeps your demo edits. Nothing here touches Supabase or any server, and none of it is cloud persistence.
 */
export class MockTrackerService implements TrackerService {
  readonly mode = 'demo' as const;
  private db: DemoDb;
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    this.db = this.load();
  }

  /* ---------------------------- persistence ---------------------------- */

  private load(): DemoDb {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoDb;
        if (parsed?.version === 1 && Array.isArray(parsed.meals) && Array.isArray(parsed.transactions) && Array.isArray(parsed.weighIns) && parsed.settings) {
          return { ...parsed, sessions: parsed.sessions ?? [], messages: parsed.messages ?? [], processed: parsed.processed ?? {} };
        }
      }
    } catch {
      /* corrupt or unavailable storage: fall through to a fresh seed */
    }
    return buildSeedDb(this.now());
  }
  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* storage full or blocked: the session still works in memory */
    }
  }
  private async latency(opts?: RequestOptions, ms = LATENCY_MS): Promise<void> {
    await wait(ms, opts?.signal);
  }

  async resetDemoData(): Promise<void> {
    await wait(LATENCY_MS);
    this.db = buildSeedDb(this.now());
    this.persist();
  }

  private get tz(): string {
    return this.db.settings.timezone;
  }

  /* ----------------------------- synchronous core ----------------------------- */

  private insertMeal(input: MealInput, id = uid(), source: Meal['source'] = 'manual'): Meal {
    this.validateMeal(input);
    const meal: Meal = {
      id,
      mealType: input.mealType,
      eatenAt: input.eatenAt,
      notes: input.notes,
      source,
      items: input.items.map((i) => ({ ...i, id: uid() })),
    };
    this.db.meals.push(meal);
    this.persist();
    return meal;
  }
  private insertTransaction(input: TransactionInput, id = uid(), source: Transaction['source'] = 'manual'): Transaction {
    this.validateTransaction(input);
    const tx: Transaction = { ...input, id, currency: 'INR', source };
    this.db.transactions.push(tx);
    this.persist();
    return tx;
  }
  private insertWeighIn(input: WeighInInput, id = uid(), source: WeighIn['source'] = 'manual'): WeighIn {
    this.validateWeighIn(input);
    const w: WeighIn = { ...input, id, source };
    this.db.weighIns.push(w);
    this.persist();
    return w;
  }
  private patchTransaction(id: string, input: TransactionInput): Transaction {
    this.validateTransaction(input);
    const i = this.db.transactions.findIndex((t) => t.id === id);
    if (i < 0) throw new TrackerError('NOT_FOUND', 'That transaction no longer exists.', { retryable: false });
    const next: Transaction = { ...this.db.transactions[i]!, ...input };
    this.db.transactions[i] = next;
    this.persist();
    return next;
  }
  private patchWeighIn(id: string, input: WeighInInput): WeighIn {
    this.validateWeighIn(input);
    const i = this.db.weighIns.findIndex((w) => w.id === id);
    if (i < 0) throw new TrackerError('NOT_FOUND', 'That weight entry no longer exists.', { retryable: false });
    const next: WeighIn = { ...this.db.weighIns[i]!, ...input };
    this.db.weighIns[i] = next;
    this.persist();
    return next;
  }

  /* ------------------------------ validation ------------------------------ */

  private validateMeal(m: MealInput): void {
    if (!m.items.length || m.items.length > 25) throw new TrackerError('VALIDATION', 'A meal needs between 1 and 25 foods.', { retryable: false });
    for (const i of m.items) {
      if (!i.foodName.trim()) throw new TrackerError('VALIDATION', 'Every food needs a name.', { retryable: false });
      if ((i.caloriesKcal != null && i.caloriesKcal < 0) || (i.proteinG != null && i.proteinG < 0)) {
        throw new TrackerError('VALIDATION', 'Calories and protein cannot be negative.', { retryable: false });
      }
    }
  }
  private validateTransaction(t: TransactionInput): void {
    if (!(t.amount > 0) || t.amount > 100_000_000) throw new TrackerError('VALIDATION', 'Enter an amount greater than zero.', { retryable: false });
    if (!t.description.trim()) throw new TrackerError('VALIDATION', 'Add a short description.', { retryable: false });
  }
  private validateWeighIn(w: WeighInInput): void {
    if (!(w.weightKg >= 1 && w.weightKg <= 1000)) throw new TrackerError('VALIDATION', 'Weight must be between 1 and 1000 kg.', { retryable: false });
  }

  /* ------------------------------- dashboard ------------------------------- */

  async getDashboardSummary(opts?: RequestOptions): Promise<DashboardSummary> {
    await this.latency(opts);
    const { settings, meals, transactions, weighIns } = this.db;
    const now = this.now();
    const today = todayKey(this.tz, now);
    const month = monthKeyInTz(now, this.tz);
    return clone({
      generatedAt: now.toISOString(),
      today,
      monthKey: month,
      nutritionToday: nutritionTotals(mealsOnDate(meals, today, this.tz)),
      budget: budgetSummary(transactions, month, settings.monthlyBudget, this.tz),
      trackedBalance: trackedBalance(transactions, settings.openingBalance),
      weight: weightSummary(weighIns),
      recentActivity: buildActivity(meals, transactions, weighIns).slice(0, 12),
    });
  }

  /* --------------------------------- meals --------------------------------- */

  async getMeals(range?: DateRange, opts?: RequestOptions): Promise<Meal[]> {
    await this.latency(opts);
    return clone(
      this.db.meals
        .filter((m) => {
          const k = dateKeyInTz(m.eatenAt, this.tz);
          return (!range?.from || k >= range.from) && (!range?.to || k <= range.to);
        })
        .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt)),
    );
  }
  async createMeal(input: MealInput, opts?: WriteOptions): Promise<Meal> {
    await wait(LATENCY_MS);
    return clone(this.insertMeal(input, uid(), opts?.source ?? 'manual'));
  }
  async updateMeal(id: string, input: MealInput): Promise<Meal> {
    await wait(LATENCY_MS);
    this.validateMeal(input);
    const i = this.db.meals.findIndex((m) => m.id === id);
    if (i < 0) throw new TrackerError('NOT_FOUND', 'That meal no longer exists.', { retryable: false });
    const prev = this.db.meals[i]!;
    const next: Meal = { ...prev, mealType: input.mealType, eatenAt: input.eatenAt, notes: input.notes, items: input.items.map((it) => ({ ...it, id: uid() })) };
    this.db.meals[i] = next;
    this.persist();
    return clone(next);
  }
  async deleteMeal(id: string): Promise<void> {
    await wait(LATENCY_MS);
    const before = this.db.meals.length;
    this.db.meals = this.db.meals.filter((m) => m.id !== id);
    if (this.db.meals.length === before) throw new TrackerError('NOT_FOUND', 'That meal no longer exists.', { retryable: false });
    this.persist();
  }
  async restoreMeal(meal: Meal): Promise<Meal> {
    await wait(LATENCY_MS);
    if (this.db.meals.some((m) => m.id === meal.id)) return clone(meal);
    this.db.meals.push(clone(meal));
    this.persist();
    return clone(meal);
  }

  /* ------------------------------ transactions ------------------------------ */

  async getTransactions(filters: TransactionFilters = {}, opts?: RequestOptions): Promise<Transaction[]> {
    await this.latency(opts);
    return clone(filterTransactions(this.db.transactions, filters, this.tz));
  }
  async createTransaction(input: TransactionInput, opts?: WriteOptions): Promise<Transaction> {
    await wait(LATENCY_MS);
    return clone(this.insertTransaction(input, uid(), opts?.source ?? 'manual'));
  }
  async updateTransaction(id: string, input: TransactionInput): Promise<Transaction> {
    await wait(LATENCY_MS);
    return clone(this.patchTransaction(id, input));
  }
  async deleteTransaction(id: string): Promise<void> {
    await wait(LATENCY_MS);
    const before = this.db.transactions.length;
    this.db.transactions = this.db.transactions.filter((t) => t.id !== id);
    if (this.db.transactions.length === before) throw new TrackerError('NOT_FOUND', 'That transaction no longer exists.', { retryable: false });
    this.persist();
  }
  async restoreTransaction(tx: Transaction): Promise<Transaction> {
    await wait(LATENCY_MS);
    if (!this.db.transactions.some((t) => t.id === tx.id)) {
      this.db.transactions.push(clone(tx));
      this.persist();
    }
    return clone(tx);
  }

  /* -------------------------------- weigh-ins -------------------------------- */

  async getWeighIns(range?: DateRange, opts?: RequestOptions): Promise<WeighIn[]> {
    await this.latency(opts);
    return clone(weighInsInRange(this.db.weighIns, range?.from, range?.to, this.tz));
  }
  async createWeighIn(input: WeighInInput, opts?: WriteOptions): Promise<WeighIn> {
    await wait(LATENCY_MS);
    return clone(this.insertWeighIn(input, uid(), opts?.source ?? 'manual'));
  }
  async updateWeighIn(id: string, input: WeighInInput): Promise<WeighIn> {
    await wait(LATENCY_MS);
    return clone(this.patchWeighIn(id, input));
  }
  async deleteWeighIn(id: string): Promise<void> {
    await wait(LATENCY_MS);
    const before = this.db.weighIns.length;
    this.db.weighIns = this.db.weighIns.filter((w) => w.id !== id);
    if (this.db.weighIns.length === before) throw new TrackerError('NOT_FOUND', 'That weight entry no longer exists.', { retryable: false });
    this.persist();
  }
  async restoreWeighIn(w: WeighIn): Promise<WeighIn> {
    await wait(LATENCY_MS);
    if (!this.db.weighIns.some((x) => x.id === w.id)) {
      this.db.weighIns.push(clone(w));
      this.persist();
    }
    return clone(w);
  }

  /* ----------------------------------- chat ----------------------------------- */

  async getChatSessions(): Promise<ChatSession[]> {
    await wait(LATENCY_MS);
    return clone([...this.db.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
    await wait(LATENCY_MS);
    if (!this.db.sessions.some((s) => s.id === sessionId)) throw new TrackerError('SESSION_NOT_FOUND', "That conversation couldn't be found.", { retryable: false });
    return clone(this.db.messages.filter((m) => m.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  async deleteChatSession(sessionId: string): Promise<void> {
    await wait(LATENCY_MS);
    this.db.sessions = this.db.sessions.filter((s) => s.id !== sessionId);
    this.db.messages = this.db.messages.filter((m) => m.sessionId !== sessionId);
    this.persist();
  }

  async sendChatMessage(input: AiChatRequest, opts?: RequestOptions): Promise<ChatReply> {
    const message = input.message?.trim() ?? '';
    if (!message) throw new TrackerError('INVALID_REQUEST', 'Write a message first.', { retryable: false });
    if (message.length > 4000) throw new TrackerError('INVALID_REQUEST', 'Keep messages under 4,000 characters.', { retryable: false });
    if (!input.clientMessageId) throw new TrackerError('INVALID_REQUEST', 'Missing message id.', { retryable: false });

    // Idempotency: a retried submit with the same clientMessageId returns the stored reply and writes nothing new.
    const done = this.db.processed[input.clientMessageId] as ChatReply | undefined;
    if (done) {
      await wait(LATENCY_MS, opts?.signal);
      return clone(done);
    }
    if (input.sessionId && !this.db.sessions.some((s) => s.id === input.sessionId)) {
      throw new TrackerError('SESSION_NOT_FOUND', "That conversation couldn't be found.", { retryable: false });
    }

    await wait(CHAT_LATENCY_MS, opts?.signal);

    const now = this.now();
    const result = runDemoAssistant(message, {
      now,
      settings: this.db.settings,
      meals: this.db.meals,
      transactions: this.db.transactions,
      weighIns: this.db.weighIns,
      createMeal: (i) => this.insertMeal(i, uid(), 'ai'),
      createTransaction: (i) => this.insertTransaction(i, uid(), 'ai'),
      createWeighIn: (i) => this.insertWeighIn(i, uid(), 'ai'),
      updateTransaction: (id, i) => this.patchTransaction(id, i),
      updateWeighIn: (id, i) => this.patchWeighIn(id, i),
    });

    const actions = result.actions.map((a, i) => ({ ...a, toolCallId: `demo-${uid().slice(0, 8)}-${i + 1}` }));
    return this.commitExchange({
      sessionId: input.sessionId,
      clientMessageId: input.clientMessageId,
      userMessage: message,
      assistantMessage: result.assistantMessage,
      actions,
      dashboardInvalidation: result.invalidation,
      provider: 'demo',
      model: 'demo-assistant',
    });
  }

  async findChatReply(clientMessageId: string): Promise<ChatReply | null> {
    const done = this.db.processed[clientMessageId] as ChatReply | undefined;
    return done ? clone(done) : null;
  }

  async recordChatExchange(x: ChatExchange): Promise<ChatReply> {
    const done = this.db.processed[x.clientMessageId] as ChatReply | undefined;
    if (done) return clone(done);
    if (x.sessionId && !this.db.sessions.some((s) => s.id === x.sessionId)) {
      throw new TrackerError('SESSION_NOT_FOUND', "That conversation couldn't be found.", { retryable: false });
    }
    return this.commitExchange(x);
  }

  /** Shared by the demo assistant and the user's own model: one session, two messages, one idempotency record. */
  private commitExchange(x: ChatExchange | (Omit<ChatExchange, 'provider'> & { provider: 'demo' })): ChatReply {
    const now = this.now();
    let sessionId = x.sessionId;
    const stamp = now.toISOString();
    if (!sessionId) {
      sessionId = uid();
      this.db.sessions.push({ id: sessionId, title: x.userMessage.length > 48 ? `${x.userMessage.slice(0, 45)}…` : x.userMessage, createdAt: stamp, updatedAt: stamp });
    } else {
      const s = this.db.sessions.find((y) => y.id === sessionId);
      if (s) s.updatedAt = stamp;
    }
    const userMessageId = uid();
    const assistantMessageId = uid();
    this.db.messages.push(
      { id: userMessageId, sessionId, role: 'user', content: x.userMessage, createdAt: stamp, status: 'complete', clientMessageId: x.clientMessageId },
      { id: assistantMessageId, sessionId, role: 'assistant', content: x.assistantMessage, createdAt: new Date(now.getTime() + 1).toISOString(), status: 'complete', actions: x.actions },
    );
    const response: ChatReply = {
      sessionId, userMessageId, assistantMessageId, assistantMessage: x.assistantMessage, actions: x.actions,
      dashboardInvalidation: x.dashboardInvalidation, provider: x.provider, model: x.model, persistence: 'demo',
    };
    this.db.processed[x.clientMessageId] = response;
    this.persist();
    return clone(response);
  }

  /* -------------------------------- settings -------------------------------- */

  async getUserSettings(): Promise<UserSettings> {
    await wait(LATENCY_MS);
    return clone(this.db.settings);
  }
  async updateUserSettings(input: UserSettingsInput): Promise<UserSettings> {
    await wait(LATENCY_MS);
    if (input.timezone && !isValidTimezone(input.timezone)) throw new TrackerError('VALIDATION', 'Choose a valid timezone.', { retryable: false });
    this.db.settings = { ...this.db.settings, ...input, currency: 'INR' };
    this.persist();
    return clone(this.db.settings);
  }
  async getAiStatus(): Promise<AiStatus> {
    await wait(LATENCY_MS);
    return {
      mode: 'demo',
      provider: 'demo',
      model: null,
      connection: 'demo',
      detail: isBackendConfigured
        ? 'Backend variables are set, but the Supabase-backed service is not implemented yet, so the app is still running on built-in demo data.'
        : 'Replies come from a built-in rule-based demo assistant. No AI provider is called and nothing leaves your browser.',
    };
  }

  async exportData(): Promise<ExportBundle> {
    await wait(LATENCY_MS);
    return clone({
      exportedAt: this.now().toISOString(),
      meals: this.db.meals,
      transactions: this.db.transactions,
      weighIns: this.db.weighIns,
      settings: this.db.settings,
    });
  }
}
