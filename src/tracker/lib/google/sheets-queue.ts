/** Local-only, account-scoped outbox primitive. Not connected to the tracker service yet. */
export type SheetsCategory = 'meal' | 'transaction' | 'weight' | 'calendar' | 'health';
export interface SheetsChange {
  category: SheetsCategory;
  id: string;
  version: number;
  operation: 'upsert' | 'delete';
  /** Only explicit export fields, never OAuth credentials or chat messages. */
  fields: Array<string | number | boolean | null>;
  failed: boolean;
}
interface QueueState { version: 1; counter: number; changes: SheetsChange[]; lastSuccess: string | null }
const CATEGORIES: readonly SheetsCategory[] = ['meal', 'transaction', 'weight', 'calendar', 'health'];

/** A storage error is surfaced to the caller; corrupt data is never silently replaced. */
export class SheetsQueue {
  private state: QueueState;
  private busy: Promise<void> | null = null;
  private readonly key: string;
  constructor(private readonly storage: Storage, accountId: string) {
    if (!accountId) throw new Error('An account partition is required.');
    this.key = `pt.sheets.queue.v1.${encodeURIComponent(accountId)}`;
    const raw = storage.getItem(this.key);
    if (raw === null) {
      this.state = { version: 1, counter: 0, changes: [], lastSuccess: null };
      return;
    }
    let state: QueueState;
    try { state = JSON.parse(raw); } catch { throw new Error('Sheets queue is unreadable; it has not been changed.'); }
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.counter) || state.counter < 0 || !Array.isArray(state.changes) ||
      !(state.lastSuccess === null || typeof state.lastSuccess === 'string') || state.changes.some((c) => !c || !CATEGORIES.includes(c.category) || typeof c.id !== 'string' || !c.id ||
        !Number.isSafeInteger(c.version) || c.version < 1 || c.version > state.counter || !['upsert', 'delete'].includes(c.operation) || typeof c.failed !== 'boolean' || !Array.isArray(c.fields) ||
        c.fields.some((v) => v !== null && typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v))))) {
      throw new Error('Sheets queue has an unsupported format; it has not been changed.');
    }
    this.state = state;
  }

  private save(next: QueueState) {
    this.storage.setItem(this.key, JSON.stringify(next));
    this.state = next; // only commit memory after persistence succeeds
  }
  status() {
    return { pending: this.state.changes.filter((x) => !x.failed).length, failed: this.state.changes.filter((x) => x.failed).length, lastSuccess: this.state.lastSuccess };
  }
  enqueue(category: SheetsCategory, id: string, operation: 'upsert' | 'delete', fields: SheetsChange['fields']) {
    if (!CATEGORIES.includes(category) || !id || !['upsert', 'delete'].includes(operation) || !Array.isArray(fields) ||
      fields.some((v) => v !== null && typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v)))) throw new Error('Invalid Sheets change.');
    const version = this.state.counter + 1;
    if (!Number.isSafeInteger(version)) throw new Error('Sheets queue version exhausted.');
    const changes = this.state.changes.filter((c) => c.category !== category || c.id !== id);
    changes.push({ category, id, operation, fields: [...fields], version, failed: false });
    this.save({ ...this.state, counter: version, changes });
  }
  /** Serial execution per instance; a newer local edit is never acknowledged by an older in-flight request. */
  flush(send: (change: SheetsChange) => Promise<void>, now: () => Date = () => new Date()): Promise<void> {
    if (this.busy) return this.busy;
    const run = async () => {
      // Snapshot versions so a failing or newly edited item is not retried endlessly in one run.
      const initial = this.state.changes.map(({ category, id, version }) => ({ category, id, version }));
      for (const ref of initial) {
        const item = this.state.changes.find((c) => c.category === ref.category && c.id === ref.id && c.version === ref.version);
        if (!item) continue;
        let success = false;
        try { await send({ ...item, fields: [...item.fields] }); success = true; } catch { /* record only a generic failure */ }
        const stillCurrent = this.state.changes.some((c) => c.category === ref.category && c.id === ref.id && c.version === ref.version);
        if (!stillCurrent) continue;
        const changes = success ? this.state.changes.filter((c) => c !== item) : this.state.changes.map((c) => c === item ? { ...c, failed: true } : c);
        this.save({ ...this.state, changes, lastSuccess: success ? now().toISOString() : this.state.lastSuccess });
      }
    };
    this.busy = run().finally(() => { this.busy = null; });
    return this.busy;
  }
}
