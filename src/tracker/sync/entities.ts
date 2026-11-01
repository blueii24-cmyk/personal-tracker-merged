/**
 * The synced record kinds and the pure helpers that read/write them inside a local database.
 * Everything that is synced is addressed as `kind:id`.
 */
import { normalizeEvent, normalizePrefs } from '@/tracker/features/calendar/calendar';
import {
  normalizeMessage, normalizeMeal, normalizeSession, normalizeSettings, normalizeTransaction, normalizeWeighIn,
} from '@/tracker/lib/api/mock/persistence';
import type { DemoDb } from '@/tracker/lib/api/mock/seed';

export type Kind = 'chatSession' | 'meal' | 'transaction' | 'weighIn' | 'settings' | 'chatMessage' | 'calendarEvent' | 'calendarPrefs';
/** Parents before children, so foreign keys are satisfied when pushing. */
export const KIND_ORDER: Kind[] = ['chatSession', 'meal', 'transaction', 'weighIn', 'settings', 'chatMessage', 'calendarEvent', 'calendarPrefs'];
export const SINGLETON_IDS: Partial<Record<Kind, string>> = { settings: 'settings', calendarPrefs: 'prefs' };

export const keyOf = (kind: Kind, id: string): string => `${kind}:${id}`;
export function parseKey(key: string): { kind: Kind; id: string } {
  const i = key.indexOf(':');
  return { kind: key.slice(0, i) as Kind, id: key.slice(i + 1) };
}

/** JSON with sorted keys, so two equal records always produce the same text. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val,
  );
}

type Message = DemoDb['messages'][number];

/** Validate/normalise a record of any kind. Null means the record is unusable and must be ignored. */
export function canonical(kind: Kind, data: unknown): { data: unknown; json: string } | null {
  let out: unknown;
  switch (kind) {
    case 'meal': out = normalizeMeal(data); break;
    case 'transaction': out = normalizeTransaction(data); break;
    case 'weighIn': out = normalizeWeighIn(data); break;
    case 'settings': out = normalizeSettings(data); break;
    case 'chatSession': out = normalizeSession(data); break;
    case 'chatMessage': out = normalizeMessage(data); break;
    case 'calendarEvent': out = normalizeEvent(data); break;
    case 'calendarPrefs': out = normalizePrefs(data); break;
  }
  return out == null ? null : { data: out, json: stableJson(out) };
}

export interface EntityRef { kind: Kind; id: string; json: string }

/** Every synced record in the database, with its canonical JSON. */
export function snapshotEntities(db: DemoDb): Map<string, EntityRef> {
  const m = new Map<string, EntityRef>();
  const add = (kind: Kind, id: string, rec: unknown) => m.set(keyOf(kind, id), { kind, id, json: stableJson(rec) });
  for (const x of db.meals) add('meal', x.id, x);
  for (const x of db.transactions) add('transaction', x.id, x);
  for (const x of db.weighIns) add('weighIn', x.id, x);
  for (const x of db.sessions) add('chatSession', x.id, x);
  for (const x of db.messages) add('chatMessage', x.id, x);
  for (const x of db.calendarEvents ?? []) add('calendarEvent', x.id, x);
  add('settings', 'settings', db.settings);
  add('calendarPrefs', 'prefs', normalizePrefs(db.calendarPrefs));
  return m;
}

function list(db: DemoDb, kind: Kind): Array<{ id: string }> | null {
  switch (kind) {
    case 'meal': return db.meals;
    case 'transaction': return db.transactions;
    case 'weighIn': return db.weighIns;
    case 'chatSession': return db.sessions;
    case 'chatMessage': return db.messages as Message[];
    case 'calendarEvent': return (db.calendarEvents ??= []);
    default: return null;
  }
}

export function getEntity(db: DemoDb, kind: Kind, id: string): unknown | null {
  if (kind === 'settings') return db.settings;
  if (kind === 'calendarPrefs') return normalizePrefs(db.calendarPrefs);
  return list(db, kind)?.find((x) => x.id === id) ?? null;
}

/** Insert/replace (data) or remove (null) one record. The caller persists. Returns false if the record was rejected as invalid. */
export function applyEntity(db: DemoDb, kind: Kind, id: string, data: unknown | null): boolean {
  if (data === null) {
    const l = list(db, kind);
    if (l) {
      const next = l.filter((x) => x.id !== id);
      switch (kind) {
        case 'meal': db.meals = next as DemoDb['meals']; break;
        case 'transaction': db.transactions = next as DemoDb['transactions']; break;
        case 'weighIn': db.weighIns = next as DemoDb['weighIns']; break;
        case 'chatSession': db.sessions = next as DemoDb['sessions']; break;
        case 'chatMessage': db.messages = next as DemoDb['messages']; break;
        case 'calendarEvent': db.calendarEvents = next as NonNullable<DemoDb['calendarEvents']>; break;
      }
    }
    // A deleted singleton (settings/prefs) is ignored: they always exist locally.
    return true;
  }
  const c = canonical(kind, data);
  if (!c) return false;
  if (kind === 'settings') { db.settings = c.data as DemoDb['settings']; return true; }
  if (kind === 'calendarPrefs') { db.calendarPrefs = c.data as DemoDb['calendarPrefs']; return true; }
  const l = list(db, kind)!;
  const i = l.findIndex((x) => x.id === id);
  if (i >= 0) l[i] = c.data as { id: string };
  else l.push(c.data as { id: string });
  return true;
}
