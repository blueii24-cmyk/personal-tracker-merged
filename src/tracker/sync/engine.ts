/**
 * Two-way sync between the on-device database and a remote store.
 *
 *  - Local writes are tracked per record (`trackChanges`): changed/new records become `dirty`, deleted ones become tombstones.
 *  - `sync()` first PULLS (cloud → device), resolving any record changed on both sides with `resolveConflict`, then PUSHES
 *    dirty records with the revision they were based on. The store refuses a write based on an old revision, so an older
 *    offline copy can never overwrite a newer cloud record: it is reconciled here instead.
 *  - Every step is idempotent: replaying a pull or retrying a push after a lost response converges to the same state.
 *  - The engine knows nothing about React, Supabase or localStorage; those are injected.
 */
import { applyEntity, canonical, getEntity, KIND_ORDER, keyOf, parseKey, SINGLETON_IDS, stableJson, type EntityRef, type Kind } from './entities';
import { resolveConflict } from './resolve';
import type { DemoDb } from '@/tracker/lib/api/mock/seed';
import { isLegacySeedId } from '@/tracker/lib/api/mock/legacy-records';

export interface RemoteRecord {
  kind: Kind;
  id: string;
  /** The record as the domain type, or null for a record that only exists as a tombstone with no content. */
  data: unknown | null;
  deleted: boolean;
  rev: number;
  updatedAt: string;
}
export type PushResult = { status: 'ok'; rev: number } | { status: 'conflict' };
export interface RemoteStore {
  pull(cursor: string | null): Promise<{ records: RemoteRecord[]; cursor: string | null }>;
  fetchOne(kind: Kind, id: string): Promise<RemoteRecord | null>;
  push(p: { kind: Kind; id: string; data: unknown; deleted: boolean; updatedAt: string; baseRev: number }): Promise<PushResult>;
}

export class SyncError extends Error {
  /** `record` = this one record can't be stored (constraint/validation); the rest of the sync continues. */
  readonly kind: 'network' | 'auth' | 'server' | 'record';
  constructor(kind: 'network' | 'auth' | 'server' | 'record', message: string) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
  }
}

export interface Meta {
  /** Last cloud revision this device has seen for the record (0 = never synced). */
  rev: number;
  dirty: boolean;
  deleted: boolean;
  /** When the local copy last changed (device clock). */
  updatedAt: string;
  /** Canonical JSON of the version both sides last agreed on. Used to push tombstones and to detect drift. */
  syncedJson: string | null;
}
export interface ConflictEntry {
  id: string;
  key: string;
  kind: Kind;
  at: string;
  /** Which version was kept. The other one is in `otherJson` and can be restored. */
  keptVersion: 'device' | 'cloud';
  reason: string;
  otherJson: string | null;
}
export interface SyncState {
  v: 1;
  meta: Record<string, Meta>;
  cursor: string | null;
  conflicts: ConflictEntry[];
  lastSyncedAt: string | null;
  /** Set once the sign-in merge prompt for this account has been answered. */
  mergePromptDone?: boolean;
}
export const emptySyncState = (): SyncState => ({ v: 1, meta: {}, cursor: null, conflicts: [], lastSyncedAt: null });
export const MAX_CONFLICTS = 50;

/** What the engine needs from the local database. `apply` must NOT mark records dirty. */
export interface LocalAccess {
  db(): DemoDb;
  apply(changes: Array<{ kind: Kind; id: string; data: unknown | null }>): void;
}

export interface SyncResult { pulled: number; pushed: number; conflicts: number; rejected: number; failed: number }

export class SyncEngine {
  constructor(
    private readonly local: LocalAccess,
    private readonly remote: RemoteStore,
    readonly state: SyncState,
    private readonly save: (s: SyncState) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private stamp(): string {
    return this.now().toISOString();
  }

  pending(): number {
    return Object.values(this.state.meta).filter((m) => m.dirty).length;
  }

  /** Record what changed between two snapshots of the local database. */
  trackChanges(prev: Map<string, EntityRef>, next: Map<string, EntityRef>): void {
    const at = this.stamp();
    for (const [key, n] of next) {
      const p = prev.get(key);
      if (p && p.json === n.json) continue;
      const m = this.state.meta[key] ?? { rev: 0, dirty: false, deleted: false, updatedAt: at, syncedJson: null };
      m.dirty = true;
      m.deleted = false;
      m.updatedAt = at;
      this.state.meta[key] = m;
    }
    for (const key of prev.keys()) {
      if (next.has(key)) continue;
      const m = this.state.meta[key];
      if (!m || m.rev === 0) {
        delete this.state.meta[key]; // never reached the cloud: nothing to delete there
        continue;
      }
      m.dirty = true;
      m.deleted = true;
      m.updatedAt = at;
    }
    this.save(this.state);
  }

  /**
   * Safety net at start-up: anything in the database that has no matching sync record (or has drifted from the synced
   * version) is queued, so a crash between a save and its bookkeeping cannot leave a change that never uploads.
   * Settings and calendar preferences without history are left alone: they are defaults, not user edits.
   */
  reconcile(snapshot: Map<string, EntityRef>): void {
    const at = this.stamp();
    for (const [key, e] of snapshot) {
      const m = this.state.meta[key];
      // Never introduce an exact legacy seed as a new cloud record. A known
      // cloud revision is allowed through so cleanup can sync its tombstone.
      if (isLegacySeedId(e.id) && (!m || m.rev === 0)) {
        if (m) delete this.state.meta[key];
        continue;
      }
      if (!m) {
        if (SINGLETON_IDS[e.kind]) continue;
        this.state.meta[key] = { rev: 0, dirty: true, deleted: false, updatedAt: at, syncedJson: null };
      } else if (!m.dirty && !m.deleted && m.syncedJson !== e.json) {
        m.dirty = true;
        m.updatedAt = at;
      }
    }
    for (const [key, m] of Object.entries(this.state.meta)) {
      if (!snapshot.has(key) && !m.deleted && !m.dirty && !SINGLETON_IDS[parseKey(key).kind]) {
        m.dirty = true;
        m.deleted = true;
        m.updatedAt = at;
      }
    }
    this.save(this.state);
  }

  recordConflict(kind: Kind, id: string, keptVersion: 'device' | 'cloud', reason: string, otherJson: string | null): void {
    this.state.conflicts.unshift({ id: `${keyOf(kind, id)}@${this.stamp()}`, key: keyOf(kind, id), kind, at: this.stamp(), keptVersion, reason, otherJson });
    this.state.conflicts.length = Math.min(this.state.conflicts.length, MAX_CONFLICTS);
  }

  /** Fold one cloud record into the device. Queues local application in `out` and returns whether it was a real conflict. */
  private integrate(r: RemoteRecord, out: Array<{ kind: Kind; id: string; data: unknown | null }>): { conflict: boolean; rejected: boolean } {
    const key = keyOf(r.kind, r.id);
    const m = this.state.meta[key];
    if (m && m.rev >= r.rev) return { conflict: false, rejected: false }; // already seen (our own write, or a replayed page)
    const remoteJson = r.deleted ? null : (canonical(r.kind, r.data)?.json ?? undefined);
    if (remoteJson === undefined) return { conflict: false, rejected: true }; // unusable record: ignore, never crash the sync
    const remoteData = r.deleted ? null : canonical(r.kind, r.data)!.data;
    if (!m || !m.dirty) {
      out.push({ kind: r.kind, id: r.id, data: remoteData });
      this.state.meta[key] = { rev: r.rev, dirty: false, deleted: r.deleted, updatedAt: r.updatedAt, syncedJson: remoteJson };
      return { conflict: false, rejected: false };
    }
    const cur = getEntity(this.local.db(), r.kind, r.id);
    const localJson = m.deleted || cur == null ? null : stableJson(cur);
    const res = resolveConflict({ json: localJson, updatedAt: m.updatedAt }, { json: remoteJson, updatedAt: r.updatedAt });
    m.rev = r.rev; // this cloud revision has now been seen
    if (res.action === 'same') {
      m.dirty = false;
      m.deleted = r.deleted;
      m.syncedJson = remoteJson;
      return { conflict: false, rejected: false };
    }
    if (res.action === 'keep-local') {
      this.recordConflict(r.kind, r.id, 'device', res.reason, remoteJson);
      return { conflict: true, rejected: false }; // stays dirty; the next push carries the new base revision
    }
    this.recordConflict(r.kind, r.id, 'cloud', res.reason, localJson);
    out.push({ kind: r.kind, id: r.id, data: remoteData });
    m.dirty = false;
    m.deleted = r.deleted;
    m.updatedAt = r.updatedAt;
    m.syncedJson = remoteJson;
    return { conflict: true, rejected: false };
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, rejected: 0, failed: 0 };

    // ---- 1. pull
    const { records, cursor } = await this.remote.pull(this.state.cursor);
    const applyNow: Array<{ kind: Kind; id: string; data: unknown | null }> = [];
    for (const r of records) {
      const x = this.integrate(r, applyNow);
      if (x.conflict) result.conflicts++;
      if (x.rejected) result.rejected++;
    }
    if (applyNow.length) this.local.apply(applyNow);
    result.pulled = applyNow.length;
    if (cursor) this.state.cursor = cursor;
    this.save(this.state);

    // ---- 2. push (parents first)
    const dirty = Object.entries(this.state.meta)
      .filter(([, m]) => m.dirty)
      .sort(([a], [b]) => KIND_ORDER.indexOf(parseKey(a).kind) - KIND_ORDER.indexOf(parseKey(b).kind));
    for (const [key] of dirty) {
      try {
        if (await this.pushOne(key, result)) result.pushed++;
      } catch (e) {
        if (e instanceof SyncError && e.kind === 'record') result.failed++;
        else throw e;
      }
    }
    this.state.lastSyncedAt = this.stamp();
    this.save(this.state);
    return result;
  }

  private async pushOne(key: string, result: SyncResult, retried = false): Promise<boolean> {
    const m = this.state.meta[key];
    if (!m || !m.dirty) return false;
    const { kind, id } = parseKey(key);
    if (!m.deleted && m.rev === 0 && isLegacySeedId(id)) {
      // Defense in depth: even an old/corrupt queue cannot upload known seeds.
      delete this.state.meta[key];
      this.save(this.state);
      return false;
    }
    const cur = m.deleted ? null : getEntity(this.local.db(), kind, id);
    if (!m.deleted && cur == null) {
      // Changed since it was queued and now gone: treat as a delete (reconcile covers the rest).
      m.deleted = true;
    }
    const content = m.deleted ? (m.syncedJson ? (JSON.parse(m.syncedJson) as unknown) : null) : cur;
    if (m.deleted && content === null) {
      delete this.state.meta[key]; // a delete of something the cloud never had
      return false;
    }
    const sentJson = m.deleted ? m.syncedJson : stableJson(cur);
    const wasDeleted = m.deleted;
    const res = await this.remote.push({ kind, id, data: content, deleted: wasDeleted, updatedAt: m.updatedAt, baseRev: m.rev });
    if (res.status === 'ok') {
      m.rev = res.rev;
      m.syncedJson = sentJson;
      const e = getEntity(this.local.db(), kind, id);
      const nowJson = e == null ? null : stableJson(e);
      // If the record changed again while the request was in flight, it stays queued for the next push.
      m.dirty = wasDeleted ? nowJson !== null : nowJson !== sentJson;
      m.deleted = nowJson === null;
      this.save(this.state);
      return true;
    }
    // Conflict: the cloud has a newer revision than the one this change was based on.
    const remote = await this.remote.fetchOne(kind, id);
    if (!remote) {
      m.rev = 0; // cloud row vanished (e.g. reset on the server): re-create it
      this.save(this.state);
      return retried ? false : this.pushOne(key, result, true);
    }
    const out: Array<{ kind: Kind; id: string; data: unknown | null }> = [];
    if (remote.rev <= m.rev) {
      m.rev = remote.rev; // the cloud was reset behind us: adopt its revision so the retry is accepted
      this.save(this.state);
      return retried ? false : this.pushOne(key, result, true);
    }
    const x = this.integrate(remote, out);
    if (x.conflict) result.conflicts++;
    if (out.length) {
      this.local.apply(out);
      result.pulled += out.length;
    }
    this.save(this.state);
    if (this.state.meta[key]?.dirty && !retried) return this.pushOne(key, result, true);
    return false;
  }

  /** Dismiss a conflict entry (the kept version stays; the other one is discarded). */
  dismissConflict(id: string): void {
    this.state.conflicts = this.state.conflicts.filter((c) => c.id !== id);
    this.save(this.state);
  }
  /** Applies a conflict's other version through `apply` so the caller can persist it as a normal tracked edit. */
  takeConflictVersion(id: string): { kind: Kind; entityId: string; data: unknown | null } | null {
    const c = this.state.conflicts.find((x) => x.id === id);
    if (!c) return null;
    const { kind, id: entityId } = parseKey(c.key);
    this.state.conflicts = this.state.conflicts.filter((x) => x.id !== id);
    this.save(this.state);
    return { kind, entityId, data: c.otherJson === null ? null : (JSON.parse(c.otherJson) as unknown) };
  }
}

export { applyEntity };
