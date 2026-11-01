/**
 * Merging the on-device (guest) data into a signed-in account. Pure planning only; the service applies the plan.
 * "Merge" = keep both sides: add what the cloud lacks, skip what is identical (same stable id), never overwrite a cloud
 * record that differs (the guest version is kept as a visible conflict entry), and never touch the guest copy.
 */
import { normalizePrefs } from '@/tracker/features/calendar/calendar';
import { DEFAULT_CALENDAR_PREFS } from '@/tracker/types/calendar';
import { DEMO_SETTINGS, type DemoDb } from '@/tracker/lib/api/mock/seed';
import { getEntity, keyOf, snapshotEntities, stableJson, type Kind } from './entities';

/** Sample records are created by the app with a `demo-` id, so they can be told apart reliably. */
export const isSampleId = (id: string): boolean => id.startsWith('demo-');

export interface Counts { meals: number; transactions: number; weighIns: number; chats: number; calendarEvents: number }
export const countsOf = (db: DemoDb): Counts => ({
  meals: db.meals.length, transactions: db.transactions.length, weighIns: db.weighIns.length, chats: db.sessions.length, calendarEvents: (db.calendarEvents ?? []).filter((e) => e.origin === 'app').length,
});
export const totalOf = (c: Counts): number => c.meals + c.transactions + c.weighIns + c.chats + c.calendarEvents;

export interface MergePlan {
  add: Array<{ kind: Kind; id: string; data: unknown }>;
  identical: number;
  differing: Array<{ kind: Kind; id: string; guestJson: string }>;
  skippedSample: number;
}

const MERGE_KINDS: Kind[] = ['chatSession', 'meal', 'transaction', 'weighIn', 'chatMessage', 'calendarEvent'];

export function planMerge(guest: DemoDb, account: DemoDb, opts: { includeSample: boolean; accountHasCloudSettings: boolean; accountHasCloudPrefs: boolean }): MergePlan {
  const plan: MergePlan = { add: [], identical: 0, differing: [], skippedSample: 0 };
  const have = snapshotEntities(account);
  const sampleSessions = new Set(guest.sessions.filter((s) => isSampleId(s.id)).map((s) => s.id));
  for (const [key, e] of snapshotEntities(guest)) {
    if (!MERGE_KINDS.includes(e.kind)) continue;
    if (e.kind === 'calendarEvent' && (getEntity(guest, 'calendarEvent', e.id) as { origin?: string }).origin === 'google') continue; // Google copies are re-synced, not merged
    const sample = isSampleId(e.id) || (e.kind === 'chatMessage' && sampleSessions.has((getEntity(guest, 'chatMessage', e.id) as { sessionId: string }).sessionId));
    if (sample && !opts.includeSample) {
      plan.skippedSample++;
      continue;
    }
    const mine = have.get(key);
    if (!mine) plan.add.push({ kind: e.kind, id: e.id, data: getEntity(guest, e.kind, e.id)! });
    else if (mine.json === e.json) plan.identical++;
    else plan.differing.push({ kind: e.kind, id: e.id, guestJson: e.json });
  }
  // Settings and calendar preferences: the cloud copy wins whenever it exists. Otherwise the guest values are used if the
  // user actually changed them (sample settings only when asked for).
  const userSettings = stableJson(guest.settings) !== stableJson(DEMO_SETTINGS);
  if (!opts.accountHasCloudSettings && (userSettings || opts.includeSample)) {
    plan.add.push({ kind: 'settings', id: 'settings', data: { ...guest.settings, email: account.settings.email } });
  }
  const guestPrefs = normalizePrefs(guest.calendarPrefs);
  if (!opts.accountHasCloudPrefs && stableJson(guestPrefs) !== stableJson(DEFAULT_CALENDAR_PREFS)) {
    plan.add.push({ kind: 'calendarPrefs', id: 'prefs', data: guestPrefs });
  }
  return plan;
}

export interface MergePreview {
  local: Counts;
  cloud: Counts;
  /** Guest records that are the app's sample data. */
  sample: Counts;
  /** What a merge would do with the current choice. */
  willAdd: number;
  identical: number;
  differing: number;
  skippedSample: number;
}

export function previewMerge(guest: DemoDb, account: DemoDb, opts: { includeSample: boolean; accountHasCloudSettings: boolean; accountHasCloudPrefs: boolean }): MergePreview {
  const plan = planMerge(guest, account, opts);
  const sampleDb = {
    ...guest,
    meals: guest.meals.filter((x) => isSampleId(x.id)),
    transactions: guest.transactions.filter((x) => isSampleId(x.id)),
    weighIns: guest.weighIns.filter((x) => isSampleId(x.id)),
    sessions: guest.sessions.filter((x) => isSampleId(x.id)),
    calendarEvents: (guest.calendarEvents ?? []).filter((x) => isSampleId(x.id)),
  };
  return {
    local: countsOf(guest),
    cloud: countsOf(account),
    sample: countsOf(sampleDb),
    willAdd: plan.add.filter((a) => a.kind !== 'settings' && a.kind !== 'calendarPrefs').length,
    identical: plan.identical,
    differing: plan.differing.length,
    skippedSample: plan.skippedSample,
  };
}

export { keyOf };
