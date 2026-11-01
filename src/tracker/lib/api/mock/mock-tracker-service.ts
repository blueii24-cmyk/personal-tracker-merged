import { budgetSummary, filterTransactions, trackedBalance } from '@/tracker/features/transactions/calculations';
import { nutritionTotals, mealsOnDate } from '@/tracker/features/meals/calculations';
import { weightSummary, weighInsInRange } from '@/tracker/features/weigh-ins/calculations';
import { buildActivity } from '@/tracker/features/history/activity';
import { roundMoney } from '@/tracker/lib/formatting/currency';
import { dateKeyInTz, isValidTimezone, monthKeyInTz, todayKey } from '@/tracker/lib/formatting/dates';
import type { AiChatRequest } from '@/tracker/types/api';
import { buildEvent, normalizePrefs, validateEventInput } from '@/tracker/features/calendar/calendar';
import type { CalendarEvent, CalendarEventInput, CalendarPrefs } from '@/tracker/types/calendar';
import type {
  AiStatus, ChatMessage, ChatSession, DashboardSummary, DateRange, Meal, MealInput, Transaction, TransactionFilters,
  TransactionInput, UserSettings, UserSettingsInput, WeighIn, WeighInInput,
} from '@/tracker/types/domain';
import { TrackerError } from '../errors';
import type { ChatExchange, ChatReply, ExportBundle, RequestOptions, TrackerService, WriteOptions } from '../tracker-service';
import { runDemoAssistant } from './demo-ai';
import { migrateDb, pruneProcessed, BACKUP_APP, BACKUP_FORMAT_VERSION } from './persistence';
import { buildSeedDb, type DemoDb } from './seed';

export const GUEST_STORAGE_KEY = 'pt.demo.db.v1';
const STORAGE_KEY = GUEST_STORAGE_KEY;
const PROBE_KEY = 'pt.probe';
function localStorage_has(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}
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
 * Keeps every record in memory and mirrors it to this device's localStorage (the Android app's WebView storage,
 * which survives restarts and app updates). Nothing here touches Supabase or any server, and none of it is cloud persistence.
 * Writes are all-or-nothing: a failed save rolls back and throws.
 */
export class MockTrackerService implements TrackerService {
  get mode(): 'demo' | 'connected' {
    return 'demo';
  }
  protected db: DemoDb;
  protected lastGood: string;
  protected memoryOnly = false;
  protected notice: string | null = null;
  protected readonly now: () => Date;
  protected storageKey: string;

  constructor(now: () => Date = () => new Date(), storageKey: string = STORAGE_KEY) {
    this.now = now;
    this.storageKey = storageKey;
    this.db = this.load();
    this.lastGood = JSON.stringify(this.db);
    // A first launch saves its starting data straight away so it doesn't change on every restart.
    if (!localStorage_has(this.storageKey)) {
      try {
        this.persist();
      } catch {
        /* reported on the first real write */
      }
    }
  }

  /* ---------------------------- persistence ---------------------------- */

  /**
   * Reads the saved database. Anything unreadable (damaged, or written by a newer app version) is copied to a
   * separate key BEFORE anything can overwrite it, so a bad read never silently destroys records.
   */
  protected load(): DemoDb {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.storageKey);
      // Prove writes work now, so a blocked or full store is reported up front instead of failing silently later.
      localStorage.setItem(PROBE_KEY, '1');
      localStorage.removeItem(PROBE_KEY);
    } catch {
      this.memoryOnly = true;
      this.notice = "This device wouldn't let the app store data, so changes will be lost when you close it. Export a backup from Settings if you want to keep them.";
    }
    if (raw) {
      let parsed: ReturnType<typeof migrateDb> = null;
      try {
        parsed = migrateDb(JSON.parse(raw));
      } catch {
        parsed = null;
      }
      if (parsed) {
        if (parsed.dropped > 0) {
          this.setAside(raw);
          this.notice = `${parsed.dropped} damaged record${parsed.dropped === 1 ? ' was' : 's were'} skipped when loading. A copy of the original data was kept on this device.`;
        }
        return parsed.db;
      }
      this.setAside(raw);
      this.notice = "Your saved data couldn't be read, so the app started fresh. A copy of the original was kept on this device.";
    }
    return this.loadFresh();
  }
  /** What a partition with nothing saved starts with. The guest partition starts with the sample data. */
  protected loadFresh(): DemoDb {
    return buildSeedDb(this.now());
  }
  /** Switch to another storage partition (a different account, or back to the guest data). */
  protected reloadFrom(key: string): void {
    this.storageKey = key;
    this.notice = null;
    this.memoryOnly = false;
    this.db = this.load();
    this.lastGood = JSON.stringify(this.db);
    if (!localStorage_has(key)) {
      try {
        this.persist();
      } catch {
        /* reported on the first real write */
      }
    }
  }
  /** Called after every successful save with the JSON before and after. The synced service uses it to track changes. */
  protected onPersisted(_prev: string, _next: string): void {}
  private setAside(raw: string): void {
    try {
      localStorage.setItem(`${this.storageKey}.unreadable.${Date.now()}`, raw);
    } catch {
      /* nothing more can be done */
    }
  }
  /**
   * Saves the whole database. If the device refuses, the change is rolled back and the caller gets an error,
   * so the screen never shows a record that wasn't saved.
   */
  protected persist(): void {
    this.db.processed = pruneProcessed(this.db.processed);
    const json = JSON.stringify(this.db);
    if (!this.memoryOnly) {
      try {
        localStorage.setItem(this.storageKey, json);
      } catch {
        this.db = JSON.parse(this.lastGood) as DemoDb;
        throw new TrackerError('STORAGE_FAILED', "Couldn't save to this device. Free up some storage space and try again.", { retryable: true });
      }
    }
    const prev = this.lastGood;
    this.lastGood = json;
    if (prev !== json) this.onPersisted(prev, json);
  }
  takeStorageNotice(): string | null {
    const n = this.notice;
    this.notice = null;
    return n;
  }
  private async latency(opts?: RequestOptions, ms = LATENCY_MS): Promise<void> {
    await wait(ms, opts?.signal);
  }

  async resetDemoData(): Promise<void> {
    await wait(LATENCY_MS);
    this.db = buildSeedDb(this.now());
    this.persist();
  }

  protected get tz(): string {
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
    const tx: Transaction = { ...input, amount: roundMoney(input.amount), id, currency: 'INR', source };
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
    const next: Transaction = { ...this.db.transactions[i]!, ...input, amount: roundMoney(input.amount) };
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
    if (Number.isNaN(Date.parse(m.eatenAt))) throw new TrackerError('VALIDATION', 'Choose a valid date and time.', { retryable: false });
    for (const i of m.items) {
      if (!i.foodName.trim()) throw new TrackerError('VALIDATION', 'Every food needs a name.', { retryable: false });
      const bad = (v: number | null, max: number) => v != null && !(Number.isFinite(v) && v >= 0 && v <= max);
      if (bad(i.caloriesKcal, 100_000) || bad(i.proteinG, 10_000) || bad(i.quantity, 1_000_000)) {
        throw new TrackerError('VALIDATION', 'Calories, protein and quantity must be real numbers that are not negative.', { retryable: false });
      }
    }
  }
  private validateTransaction(t: TransactionInput): void {
    if (!Number.isFinite(t.amount) || !(t.amount >= 0.01) || t.amount > 100_000_000) throw new TrackerError('VALIDATION', 'Enter an amount of at least ₹0.01.', { retryable: false });
    if (Number.isNaN(Date.parse(t.occurredAt))) throw new TrackerError('VALIDATION', 'Choose a valid date and time.', { retryable: false });
    if (!t.description.trim()) throw new TrackerError('VALIDATION', 'Add a short description.', { retryable: false });
  }
  private validateWeighIn(w: WeighInInput): void {
    if (!(w.weightKg >= 1 && w.weightKg <= 1000)) throw new TrackerError('VALIDATION', 'Weight must be between 1 and 1000 kg.', { retryable: false });
    if (Number.isNaN(Date.parse(w.recordedAt))) throw new TrackerError('VALIDATION', 'Choose a valid date and time.', { retryable: false });
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

  protected persistenceLabel(): 'demo' | 'cloud' {
    return 'demo';
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
      dashboardInvalidation: x.dashboardInvalidation, provider: x.provider, model: x.model, persistence: this.persistenceLabel(),
    };
    this.db.processed[x.clientMessageId] = response;
    this.persist();
    return clone(response);
  }

  /* -------------------------------- calendar -------------------------------- */

  private get events(): CalendarEvent[] {
    return (this.db.calendarEvents ??= []);
  }
  async getCalendarEvents(range?: DateRange): Promise<CalendarEvent[]> {
    await wait(LATENCY_MS);
    return clone(
      this.events
        .filter((e) => (!range?.from || e.endDate >= range.from) && (!range?.to || e.startDate <= range.to))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.id.localeCompare(b.id)),
    );
  }
  async createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    await wait(LATENCY_MS);
    const problem = validateEventInput(input, this.tz);
    if (problem) throw new TrackerError('VALIDATION', problem, { retryable: false });
    const event = buildEvent(input, uid(), this.tz);
    this.events.push(event);
    this.persist();
    return clone(event);
  }
  async updateCalendarEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent> {
    await wait(LATENCY_MS);
    const i = this.events.findIndex((e) => e.id === id);
    if (i < 0) throw new TrackerError('NOT_FOUND', 'That event no longer exists.', { retryable: false });
    const prev = this.events[i]!;
    if (prev.origin === 'google' || prev.readOnly) throw new TrackerError('VALIDATION', "This event comes from Google Calendar, so it can't be edited here. Edit it in Google Calendar.", { retryable: false });
    const problem = validateEventInput(input, this.tz);
    if (problem) throw new TrackerError('VALIDATION', problem, { retryable: false });
    const next = buildEvent(input, id, this.tz, prev);
    this.events[i] = next;
    this.persist();
    return clone(next);
  }
  async deleteCalendarEvent(id: string): Promise<void> {
    await wait(LATENCY_MS);
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new TrackerError('NOT_FOUND', 'That event no longer exists.', { retryable: false });
    // Deleting here never deletes anything in Google Calendar, so copies of Google events can't be removed from this screen.
    if (e.origin === 'google' || e.readOnly) throw new TrackerError('VALIDATION', "This event comes from Google Calendar, so it can't be deleted here. Delete it in Google Calendar.", { retryable: false });
    this.db.calendarEvents = this.events.filter((x) => x.id !== id);
    this.persist();
  }
  async restoreCalendarEvent(event: CalendarEvent): Promise<CalendarEvent> {
    await wait(LATENCY_MS);
    if (!this.events.some((e) => e.id === event.id)) {
      this.events.push(clone(event));
      this.persist();
    }
    return clone(event);
  }
  async getCalendarPrefs(): Promise<CalendarPrefs> {
    await wait(LATENCY_MS);
    return normalizePrefs(this.db.calendarPrefs);
  }
  async updateCalendarPrefs(input: Partial<CalendarPrefs>): Promise<CalendarPrefs> {
    await wait(LATENCY_MS);
    const cur = normalizePrefs(this.db.calendarPrefs);
    this.db.calendarPrefs = normalizePrefs({ ...cur, ...input, show: { ...cur.show, ...(input.show ?? {}) } });
    this.persist();
    return clone(this.db.calendarPrefs);
  }

  /* -------------------------------- settings -------------------------------- */

  async getUserSettings(): Promise<UserSettings> {
    await wait(LATENCY_MS);
    return clone(this.db.settings);
  }
  async updateUserSettings(input: UserSettingsInput): Promise<UserSettings> {
    await wait(LATENCY_MS);
    if (input.timezone && !isValidTimezone(input.timezone)) throw new TrackerError('VALIDATION', 'Choose a valid timezone.', { retryable: false });
    for (const v of [input.dailyCalorieTarget, input.dailyProteinTargetG, input.monthlyBudget, input.targetWeightKg, input.openingBalance]) {
      if (v != null && !Number.isFinite(v)) throw new TrackerError('VALIDATION', 'Targets and balances must be real numbers.', { retryable: false });
    }
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
      detail: 'Replies come from a built-in rule-based demo assistant. No AI provider is called and nothing leaves your device.',
    };
  }

  async exportData(): Promise<ExportBundle> {
    await wait(LATENCY_MS);
    return clone({
      app: BACKUP_APP,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: this.now().toISOString(),
      meals: this.db.meals,
      transactions: this.db.transactions,
      weighIns: this.db.weighIns,
      settings: this.db.settings,
      calendarEvents: this.events.filter((e) => e.origin === 'app'),
      calendarPrefs: normalizePrefs(this.db.calendarPrefs),
    });
  }

  async importData(bundle: ExportBundle): Promise<{ meals: number; transactions: number; weighIns: number }> {
    await wait(LATENCY_MS);
    this.db.meals = clone(bundle.meals);
    this.db.transactions = clone(bundle.transactions);
    this.db.weighIns = clone(bundle.weighIns);
    this.db.settings = { ...bundle.settings, currency: 'INR' };
    // Calendar parts are replaced only when the file has them (format 1 backups leave the calendar alone).
    // Synced Google copies are kept; they are re-created from Google, never from a backup.
    if (bundle.calendarEvents) this.db.calendarEvents = [...this.events.filter((e) => e.origin === 'google'), ...clone(bundle.calendarEvents)];
    if (bundle.calendarPrefs) this.db.calendarPrefs = clone(bundle.calendarPrefs);
    this.persist();
    return { meals: bundle.meals.length, transactions: bundle.transactions.length, weighIns: bundle.weighIns.length };
  }

  async eraseAllData(): Promise<void> {
    await wait(LATENCY_MS);
    this.db.meals = [];
    this.db.transactions = [];
    this.db.weighIns = [];
    this.db.sessions = [];
    this.db.messages = [];
    this.db.processed = {};
    this.persist();
  }
}
