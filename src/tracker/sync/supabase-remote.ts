/** `RemoteStore` backed by Supabase tables protected by RLS (see supabase/migrations). */
import type { SupabaseClient } from '@supabase/supabase-js';
import { KIND_ORDER, type Kind } from './entities';
import { SyncError, type PushResult, type RemoteRecord, type RemoteStore } from './engine';
import { fromRow, TABLES, toRow } from './mapping';

const PAGE = 500;
/** Re-read a little before the cursor: a transaction that started earlier can commit after a later one. Replays are idempotent. */
const OVERLAP_MS = 5 * 60_000;

type Row = Record<string, unknown>;
interface PgError { code?: string; message?: string; status?: number }

export function toSyncError(e: PgError): SyncError {
  const code = e.code ?? '';
  const msg = e.message ?? '';
  if (e.status === 401 || e.status === 403 || /^PGRST30/.test(code) || /jwt|not_authenticated|permission denied/i.test(msg) || code === '28000' || code === '42501') {
    return new SyncError('auth', 'Your session has expired.');
  }
  if (/^(23|22)/.test(code)) return new SyncError('record', 'One record was rejected by the server.');
  if (!code && /fetch|network|timeout|load failed|offline/i.test(msg)) return new SyncError('network', "Couldn't reach the server.");
  if (e.status === 0) return new SyncError('network', "Couldn't reach the server.");
  return new SyncError('server', 'The server could not complete the request.');
}

export class SupabaseRemote implements RemoteStore {
  constructor(private readonly sb: SupabaseClient, private readonly userId: string) {}

  private async itemsFor(mealIds: string[]): Promise<Map<string, Row[]>> {
    const out = new Map<string, Row[]>();
    for (let i = 0; i < mealIds.length; i += 100) {
      const { data, error } = await this.sb.from('food_items').select('*').eq('user_id', this.userId).in('meal_id', mealIds.slice(i, i + 100));
      if (error) throw toSyncError(error);
      for (const r of (data ?? []) as Row[]) {
        const k = String(r.meal_id);
        out.set(k, [...(out.get(k) ?? []), r]);
      }
    }
    return out;
  }

  private toRecord(kind: Kind, r: Row, items: Row[]): RemoteRecord {
    return { kind, id: String(r.id), data: fromRow(kind, r, items), deleted: r.deleted_at !== null && r.deleted_at !== undefined, rev: Number(r.rev), updatedAt: new Date(String(r.updated_at)).toISOString() };
  }

  async pull(cursor: string | null): Promise<{ records: RemoteRecord[]; cursor: string | null }> {
    const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null;
    const records: RemoteRecord[] = [];
    let max = cursor;
    for (const kind of KIND_ORDER) {
      for (let from = 0; ; from += PAGE) {
        let q = this.sb.from(TABLES[kind]).select('*').eq('user_id', this.userId).order('server_updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (since) q = q.gte('server_updated_at', since);
        const { data, error } = await q;
        if (error) throw toSyncError(error);
        const rows = (data ?? []) as Row[];
        const items = kind === 'meal' ? await this.itemsFor(rows.map((r) => String(r.id))) : new Map<string, Row[]>();
        for (const r of rows) {
          records.push(this.toRecord(kind, r, items.get(String(r.id)) ?? []));
          const t = new Date(String(r.server_updated_at)).toISOString();
          if (!max || t > max) max = t;
        }
        if (rows.length < PAGE) break;
      }
    }
    return { records, cursor: max };
  }

  async fetchOne(kind: Kind, id: string): Promise<RemoteRecord | null> {
    const { data, error } = await this.sb.from(TABLES[kind]).select('*').eq('user_id', this.userId).eq('id', id).maybeSingle();
    if (error) throw toSyncError(error);
    if (!data) return null;
    const items = kind === 'meal' ? ((await this.itemsFor([id])).get(id) ?? []) : [];
    return this.toRecord(kind, data as Row, items);
  }

  async push(p: { kind: Kind; id: string; data: unknown; deleted: boolean; updatedAt: string; baseRev: number }): Promise<PushResult> {
    const row = toRow(p.kind, p.data, { updatedAt: p.updatedAt, deleted: p.deleted, baseRev: p.baseRev }, this.userId);
    if (p.kind === 'meal') {
      const { data, error } = await this.sb.rpc('pt_upsert_meal', { p: row });
      if (error) return this.fail(error);
      return { status: 'ok', rev: Number(data) };
    }
    const { data, error } = await this.sb.from(TABLES[p.kind]).upsert(row, { onConflict: 'user_id,id' }).select('rev').single();
    if (error) return this.fail(error);
    return { status: 'ok', rev: Number((data as Row).rev) };
  }

  private fail(error: PgError): PushResult {
    if (error.code === '40001') return { status: 'conflict' };
    throw toSyncError(error);
  }
}
