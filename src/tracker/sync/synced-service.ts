/**
 * Local-first service with optional cloud sync.
 *
 * Without a signed-in account this IS the local service: same storage key, same sample data, same behaviour.
 * With an account, records live in a per-account partition on this device (so another user can never see them), every
 * change is tracked per record, and `SyncEngine` keeps the cloud copy in step in both directions. Local reads and writes
 * never wait for the network.
 */
import { GUEST_STORAGE_KEY, MockTrackerService } from '@/tracker/lib/api/mock/mock-tracker-service';
import { migrateDb } from '@/tracker/lib/api/mock/persistence';
import { buildSeedDb, DEMO_SETTINGS, type DemoDb } from '@/tracker/lib/api/mock/seed';
import { TrackerError } from '@/tracker/lib/api/errors';
import type { TrackerService } from '@/tracker/lib/api/tracker-service';
import { applyEntity, canonical, keyOf, snapshotEntities, type EntityRef } from './entities';
import { emptySyncState, SyncEngine, SyncError, type ConflictEntry, type RemoteStore, type SyncState } from './engine';
import { planMerge, previewMerge, totalOf, countsOf, type MergePreview } from './merge-guest';

export type SyncState_ = 'local-only' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error' | 'conflict';
export interface SyncStatus {
  state: SyncState_;
  signedIn: boolean;
  email: string | null;
  /** Changes on this device not yet confirmed by the cloud. */
  pending: number;
  conflicts: number;
  lastSyncedAt: string | null;
  message: string | null;
}
export type SyncListener = (status: SyncStatus, dataChanged: boolean) => void;

export interface MergeResult {
  added: number;
  identical: number;
  /** Records with the same id but different content: the cloud version was kept and the device version saved as a conflict entry. */
  differing: number;
  skippedSample: number;
  /** The cloud has confirmed everything (nothing left pending). Only then is it safe to treat the cloud as holding the data. */
  confirmed: boolean;
  backupKey: string;
}

export interface SyncCapable {
  attachAccount(user: { id: string; email: string }, remote: RemoteStore): Promise<void>;
  detachAccount(): void;
  syncNow(): Promise<void>;
  getSyncStatus(): SyncStatus;
  subscribeSync(fn: SyncListener): () => void;
  getConflicts(): ConflictEntry[];
  resolveConflict(id: string, action: 'restore' | 'dismiss'): void;
  needsMergePrompt(): boolean;
  markMergePromptDone(): void;
  previewGuestMerge(includeSample: boolean): MergePreview | null;
  mergeGuest(opts: { includeSample: boolean }): Promise<MergeResult>;
}
export function isSyncCapable(s: TrackerService): s is TrackerService & SyncCapable {
  return typeof (s as Partial<SyncCapable>).attachAccount === 'function';
}

interface Account { id: string; email: string; engine: SyncEngine; remote: RemoteStore }
export interface SyncedOptions { now?: () => Date; keyPrefix?: string; autoSync?: boolean }

const SYNC_DEBOUNCE_MS = 1500;

function emptyAccountDb(now: Date, email: string): DemoDb {
  const seed = buildSeedDb(now);
  return {
    ...seed,
    meals: [], transactions: [], weighIns: [], sessions: [], messages: [], calendarEvents: [], processed: {},
    settings: {
      ...DEMO_SETTINGS,
      displayName: email.split('@')[0] ?? 'You',
      email,
      openingBalance: 0,
      dailyCalorieTarget: null,
      dailyProteinTargetG: null,
      monthlyBudget: null,
      targetWeightKg: null,
    },
  };
}

export class SyncedTrackerService extends MockTrackerService implements SyncCapable {
  private acct: Account | null = null;
  private snap: Map<string, EntityRef> = new Map();
  private applying = false;
  private busy: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<SyncListener>();
  private lastError: string | null = null;
  private offline = false;
  private syncingNow = false;
  private readonly prefix: string;
  private readonly autoSync: boolean;

  constructor(opts: SyncedOptions = {}) {
    super(opts.now, `${opts.keyPrefix ?? ''}${GUEST_STORAGE_KEY}`);
    this.prefix = opts.keyPrefix ?? '';
    this.autoSync = opts.autoSync ?? true;
  }

  /** `connected` only while a signed-in account is attached. A configured-but-signed-out app is still local. */
  get mode(): 'demo' | 'connected' {
    return this.acct ? 'connected' : 'demo';
  }
  protected loadFresh(): DemoDb {
    return this.acct ? emptyAccountDb(this.now(), this.acct.email) : super.loadFresh();
  }
  protected persistenceLabel(): 'demo' | 'cloud' {
    return this.acct ? 'cloud' : 'demo';
  }
  private get guestKey(): string {
    return `${this.prefix}${GUEST_STORAGE_KEY}`;
  }
  private stateKey(id: string): string {
    return `${this.prefix}pt.sync.${id}.v1`;
  }

  /* ----------------------------- account lifecycle ----------------------------- */

  async attachAccount(user: { id: string; email: string }, remote: RemoteStore): Promise<void> {
    if (this.acct?.id === user.id) {
      this.acct.remote = remote; // token refresh etc.
      return;
    }
    this.detachAccount();
    const state = this.loadState(user.id);
    const engine = new SyncEngine(
      {
        db: () => this.db,
        apply: (changes) => {
          if (this.acct?.id !== user.id) return;
          this.applying = true;
          try {
            for (const c of changes) applyEntity(this.db, c.kind, c.id, c.data);
            this.persist();
          } finally {
            this.applying = false;
            this.snap = snapshotEntities(this.db);
          }
        },
      },
      remote,
      state,
      (s) => this.saveState(user.id, s),
      this.now,
    );
    this.acct = { id: user.id, email: user.email, engine, remote };
    this.applying = true;
    try {
      this.reloadFrom(`${this.prefix}pt.acct.${user.id}.db.v1`);
    } finally {
      this.applying = false;
    }
    this.snap = snapshotEntities(this.db);
    engine.reconcile(this.snap);
    this.lastError = null;
    this.offline = false;
    this.emit(true);
  }

  detachAccount(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.acct) return;
    this.acct = null;
    this.applying = true;
    try {
      this.reloadFrom(this.guestKey);
    } finally {
      this.applying = false;
    }
    this.snap = new Map();
    this.lastError = null;
    this.offline = false;
    this.emit(true);
  }

  private loadState(id: string): SyncState {
    try {
      const raw = localStorage.getItem(this.stateKey(id));
      if (raw) {
        const p = JSON.parse(raw) as SyncState;
        if (p && p.v === 1 && p.meta && typeof p.meta === 'object') return { ...emptySyncState(), ...p, conflicts: Array.isArray(p.conflicts) ? p.conflicts : [] };
      }
    } catch {
      /* start with a clean state: reconcile() re-queues anything that isn't confirmed */
    }
    return emptySyncState();
  }
  private saveState(id: string, s: SyncState): void {
    try {
      localStorage.setItem(this.stateKey(id), JSON.stringify(s));
    } catch {
      /* the data itself is already saved; reconcile() rebuilds the queue on the next launch */
    }
  }

  /* --------------------------------- tracking --------------------------------- */

  protected onPersisted(): void {
    if (!this.acct || this.applying) return;
    const next = snapshotEntities(this.db);
    this.acct.engine.trackChanges(this.snap, next);
    this.snap = next;
    this.scheduleSync(SYNC_DEBOUNCE_MS);
    this.emit(false);
  }

  private scheduleSync(delay: number): void {
    if (!this.autoSync || !this.acct) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  /* ----------------------------------- sync ----------------------------------- */

  async syncNow(): Promise<void> {
    const acct = this.acct;
    if (!acct) return;
    if (this.busy) {
      this.again = true;
      return this.busy;
    }
    this.busy = (async () => {
      do {
        this.again = false;
        this.syncingNow = true;
        this.emit(false);
        let changed = false;
        try {
          const r = await acct.engine.sync();
          changed = r.pulled > 0;
          this.offline = false;
          this.lastError = r.failed > 0 ? `${r.failed} item${r.failed === 1 ? '' : 's'} couldn't be saved to your account. They are still on this device.` : null;
        } catch (e) {
          if (e instanceof SyncError && e.kind === 'network') {
            this.offline = true;
            this.lastError = null;
          } else if (e instanceof SyncError && e.kind === 'auth') {
            this.lastError = 'Your session has expired. Sign in again to keep syncing. Your records are safe on this device.';
          } else if (e instanceof TrackerError) {
            this.lastError = e.message;
          } else {
            this.lastError = "Couldn't sync right now. Your records are safe on this device and it will retry.";
          }
        }
        this.syncingNow = false;
        this.emit(changed);
      } while (this.again && this.acct === acct && !this.offline);
    })().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  getSyncStatus(): SyncStatus {
    const a = this.acct;
    if (!a) return { state: 'local-only', signedIn: false, email: null, pending: 0, conflicts: 0, lastSyncedAt: null, message: null };
    const pending = a.engine.pending();
    const conflicts = a.engine.state.conflicts.length;
    const offline = this.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
    const state: SyncState_ = this.syncingNow ? 'syncing' : this.lastError ? 'error' : offline ? 'offline' : pending > 0 ? 'pending' : conflicts > 0 ? 'conflict' : 'synced';
    return { state, signedIn: true, email: a.email, pending, conflicts, lastSyncedAt: a.engine.state.lastSyncedAt, message: this.lastError };
  }
  subscribeSync(fn: SyncListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(dataChanged: boolean): void {
    const s = this.getSyncStatus();
    for (const l of this.listeners) l(s, dataChanged);
  }

  /* -------------------------------- conflicts -------------------------------- */

  getConflicts(): ConflictEntry[] {
    return this.acct ? [...this.acct.engine.state.conflicts] : [];
  }
  /** `restore` re-applies the version that lost as a NEW edit (so it syncs like any change); `dismiss` forgets it. */
  resolveConflict(id: string, action: 'restore' | 'dismiss'): void {
    const a = this.acct;
    if (!a) return;
    if (action === 'dismiss') {
      a.engine.dismissConflict(id);
      this.emit(false);
      return;
    }
    const t = a.engine.takeConflictVersion(id);
    if (!t) return;
    if (t.data !== null && !canonical(t.kind, t.data)) throw new TrackerError('VALIDATION', "That saved version can't be restored.", { retryable: false });
    applyEntity(this.db, t.kind, t.entityId, t.data);
    this.persist(); // tracked: becomes a pending change with a fresh timestamp
    this.emit(true);
  }

  /* ------------------------------ guest → account merge ------------------------------ */

  private readGuest(): { db: DemoDb; raw: string } | null {
    try {
      const raw = localStorage.getItem(this.guestKey);
      if (!raw) return null;
      const m = migrateDb(JSON.parse(raw));
      return m ? { db: m.db, raw } : null;
    } catch {
      return null;
    }
  }
  needsMergePrompt(): boolean {
    const a = this.acct;
    if (!a || a.engine.state.mergePromptDone) return false;
    const g = this.readGuest();
    return !!g && totalOf(countsOf(g.db)) > 0;
  }
  markMergePromptDone(): void {
    if (!this.acct) return;
    this.acct.engine.state.mergePromptDone = true;
    this.saveState(this.acct.id, this.acct.engine.state);
  }
  private mergeOpts(includeSample: boolean) {
    const m = this.acct!.engine.state.meta;
    return { includeSample, accountHasCloudSettings: (m[keyOf('settings', 'settings')]?.rev ?? 0) > 0, accountHasCloudPrefs: (m[keyOf('calendarPrefs', 'prefs')]?.rev ?? 0) > 0 };
  }
  previewGuestMerge(includeSample: boolean): MergePreview | null {
    if (!this.acct) return null;
    const g = this.readGuest();
    return g ? previewMerge(g.db, this.db, this.mergeOpts(includeSample)) : null;
  }

  async mergeGuest(opts: { includeSample: boolean }): Promise<MergeResult> {
    const a = this.acct;
    if (!a) throw new TrackerError('UNAUTHENTICATED', 'Sign in to merge your on-device records into your account.', { retryable: false });
    const g = this.readGuest();
    if (!g) return { added: 0, identical: 0, differing: 0, skippedSample: 0, confirmed: true, backupKey: '' };
    // 1. Safety copy first. If it can't be written, nothing is merged.
    const backupKey = `${this.prefix}pt.merge.backup.${a.id}.${Date.now()}`;
    try {
      localStorage.setItem(backupKey, g.raw);
    } catch {
      throw new TrackerError('STORAGE_FAILED', "Couldn't make a safety copy of your on-device records, so nothing was merged. Free up some space and try again.", { retryable: true });
    }
    // 2. Add what the account lacks, as ordinary tracked changes. The guest copy itself is never modified.
    const plan = planMerge(g.db, this.db, this.mergeOpts(opts.includeSample));
    for (const x of plan.add) applyEntity(this.db, x.kind, x.id, x.data);
    this.persist(); // all-or-nothing; rolls back and throws if the device refuses
    for (const d of plan.differing) a.engine.recordConflict(d.kind, d.id, 'cloud', 'same id on this device and in your account, with different content', d.guestJson);
    a.engine.state.mergePromptDone = true;
    this.saveState(a.id, a.engine.state);
    this.emit(true);
    // 3. Upload, then confirm.
    await this.syncNow();
    const confirmed = a.engine.pending() === 0 && !this.lastError && !this.offline;
    return { added: plan.add.length, identical: plan.identical, differing: plan.differing.length, skippedSample: plan.skippedSample, confirmed, backupKey };
  }
}
