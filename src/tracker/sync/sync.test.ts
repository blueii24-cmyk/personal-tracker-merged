import { beforeEach, describe, expect, it } from 'vitest';
import { SyncError, type PushResult, type RemoteRecord, type RemoteStore } from './engine';
import type { Kind } from './entities';
import { fromRow, toRow } from './mapping';
import { resolveConflict } from './resolve';
import { SyncedTrackerService } from './synced-service';
import { buildEmptyDb, buildSeedDb } from '@/tracker/lib/api/mock/seed';
import { planMerge } from './merge-guest';
import type { Meal, Transaction } from '@/tracker/types/domain';

class FakeStorage {
  data = new Map<string, string>();
  failLegacyBackup = false;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.failLegacyBackup && k.includes('.legacy-backup.')) throw new DOMException('quota', 'QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string) { this.data.delete(k); }
}

interface Row { data: unknown; deleted: boolean; rev: number; updatedAt: string; ts: number }
/** Mimics the SQL guard: a write must carry the revision it was based on (0 for a new row), per user. */
class FakeCloud {
  users = new Map<string, Map<string, Row>>();
  clock = 0;
  online = true;
  dropNextResponse = false;
  pushes = 0;
  rows(uid: string) { if (!this.users.has(uid)) this.users.set(uid, new Map()); return this.users.get(uid)!; }
  remote(uid: string): RemoteStore {
    const cloud = this;
    const guard = () => { if (!cloud.online) throw new SyncError('network', 'offline'); };
    const rec = (k: string, r: Row): RemoteRecord => { const i = k.indexOf(':'); return { kind: k.slice(0, i) as Kind, id: k.slice(i + 1), data: r.data, deleted: r.deleted, rev: r.rev, updatedAt: r.updatedAt }; };
    return {
      async pull(cursor) {
        guard();
        const since = cursor ? Number(cursor) : 0;
        const out: RemoteRecord[] = [];
        let max = since;
        for (const [k, r] of cloud.rows(uid)) if (r.ts >= since) { out.push(rec(k, r)); max = Math.max(max, r.ts); }
        return { records: out, cursor: String(max) };
      },
      async fetchOne(kind, id) { guard(); const r = cloud.rows(uid).get(`${kind}:${id}`); return r ? rec(`${kind}:${id}`, r) : null; },
      async push(p): Promise<PushResult> {
        guard();
        cloud.pushes++;
        const key = `${p.kind}:${p.id}`;
        const cur = cloud.rows(uid).get(key);
        if ((cur?.rev ?? 0) !== p.baseRev) return { status: 'conflict' };
        const rev = (cur?.rev ?? 0) + 1;
        cloud.rows(uid).set(key, { data: p.data, deleted: p.deleted, rev, updatedAt: p.updatedAt, ts: ++cloud.clock });
        if (cloud.dropNextResponse) { cloud.dropNextResponse = false; throw new SyncError('network', 'response lost'); }
        return { status: 'ok', rev };
      },
    };
  }
  live(uid: string, kind: Kind) { return [...this.rows(uid)].filter(([k, r]) => k.startsWith(`${kind}:`) && !r.deleted).map(([, r]) => r.data); }
}

let store: FakeStorage;
let cloud: FakeCloud;
let t = Date.parse('2026-03-10T08:00:00Z');
const clock = () => new Date(t);
const tick = (ms = 60_000) => { t += ms; };
beforeEach(() => {
  store = new FakeStorage();
  (globalThis as unknown as { localStorage: FakeStorage }).localStorage = store;
  cloud = new FakeCloud();
  t = Date.parse('2026-03-10T08:00:00Z');
});

const dev = (prefix: string) => new SyncedTrackerService({ now: clock, keyPrefix: prefix, autoSync: false });
const U1 = { id: 'user-1', email: 'one@example.com' };
const U2 = { id: 'user-2', email: 'two@example.com' };
const sign = async (s: SyncedTrackerService, u = U1) => { await s.attachAccount(u, cloud.remote(u.id)); };
const tx = (over: Partial<Transaction> = {}) => ({ type: 'expense' as const, amount: 120.5, category: 'food' as const, description: 'Lunch', merchant: null, notes: null, occurredAt: '2026-03-10T06:00:00Z', ...over });
const meal = { mealType: 'lunch' as const, eatenAt: '2026-03-10T06:30:00Z', notes: null, items: [{ foodName: 'Rice', quantity: 2, unit: 'cup', caloriesKcal: null, proteinG: 4, isEstimate: true, nutritionSource: 'ai_estimate' as const }] };

describe('local-only mode (no account)', () => {
  it('behaves exactly like the empty local service: local mode, no sync status', async () => {
    const s = dev('');
    expect(s.mode).toBe('demo');
    expect(await s.getMeals()).toHaveLength(0);
    expect(s.getSyncStatus().state).toBe('local-only');
    await s.createTransaction(tx());
    await s.syncNow();
    expect(cloud.pushes).toBe(0);
  });
});

describe('account partitions', () => {
  it('keeps guest data, shows a clean account, and never leaks between users', async () => {
    const s = dev('');
    await s.createMeal(meal);
    const guestMeals = (await s.getMeals()).length;
    await sign(s, U1);
    expect(s.mode).toBe('connected');
    expect(await s.getMeals()).toHaveLength(0); // guest records stay out until the user merges
    await s.createTransaction(tx({ description: 'Private to user one' }));
    await sign(s, U2);
    expect(await s.getTransactions()).toHaveLength(0);
    await sign(s, U1);
    expect((await s.getTransactions()).map((x) => x.description)).toEqual(['Private to user one']);
    s.detachAccount();
    expect(s.mode).toBe('demo');
    expect((await s.getMeals()).length).toBe(guestMeals); // guest data preserved
    expect((await s.getTransactions()).some((x) => x.description === 'Private to user one')).toBe(false);
  });
});

describe('legacy seed safety cleanup', () => {
  it('backs up before idempotent local cleanup and preserves unknown demo-prefixed records', async () => {
    const seeded = buildSeedDb(new Date(t));
    const custom = { ...seeded.transactions[0]!, id: 'demo-tx-custom', description: 'Real custom id' };
    seeded.transactions.push(custom);
    store.setItem('c.pt.demo.db.v1', JSON.stringify(seeded));
    const s = dev('c.');
    expect(await s.getMeals()).toHaveLength(0);
    expect(await s.getWeighIns()).toHaveLength(0);
    expect(await s.getTransactions()).toEqual([custom]);
    const backups = [...store.data.keys()].filter((k) => k.includes('.legacy-backup.'));
    expect(backups).toHaveLength(1);
    expect(store.getItem(backups[0]!)).toContain('demo-meal-1');
    dev('c.');
    expect([...store.data.keys()].filter((k) => k.includes('.legacy-backup.'))).toHaveLength(1);
  });

  it('leaves the active dataset unchanged when the safety copy cannot be written', async () => {
    const seeded = buildSeedDb(new Date(t));
    store.setItem('c.pt.demo.db.v1', JSON.stringify(seeded));
    store.failLegacyBackup = true;
    const s = dev('c.');
    expect(await s.getTransactions()).toHaveLength(seeded.transactions.length);
    expect(store.getItem('c.pt.demo.db.v1')).toBe(JSON.stringify(seeded));
    expect(s.takeStorageNotice()).toMatch(/safety copy/i);
  });

  it('never uploads known seeds from an old account queue when backup fails', async () => {
    const seeded = buildSeedDb(new Date(t));
    store.setItem(`c.pt.acct.${U1.id}.db.v1`, JSON.stringify(seeded));
    store.failLegacyBackup = true;
    const s = dev('c.');
    await sign(s);
    await s.syncNow();
    expect(cloud.live(U1.id, 'meal')).toHaveLength(0);
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(0);
    expect(cloud.live(U1.id, 'weighIn')).toHaveLength(0);
  });

  it('tombstones known cloud seeds but keeps legitimate cloud records', async () => {
    const s = dev('c.');
    await sign(s);
    const seeded = buildSeedDb(new Date(t));
    const known = seeded.transactions[0]!;
    const custom = { ...known, id: 'demo-tx-custom', description: 'Legitimate cloud record' };
    for (const record of [known, custom]) {
      cloud.rows(U1.id).set(`transaction:${record.id}`, { data: record, deleted: false, rev: 1, updatedAt: record.occurredAt, ts: ++cloud.clock });
    }
    await s.syncNow();
    expect(cloud.rows(U1.id).get(`transaction:${known.id}`)!.deleted).toBe(true);
    expect(cloud.rows(U1.id).get(`transaction:${custom.id}`)!.deleted).toBe(false);
    expect((await s.getTransactions()).map((x) => x.id)).toEqual([custom.id]);
    expect([...store.data.keys()].some((k) => k.includes('.legacy-backup.'))).toBe(true);
  });
});

describe('offline writes, reconnect and idempotency', () => {
  it('queues offline, shows pending/offline, then uploads once and converges', async () => {
    const s = dev('a.');
    await sign(s);
    cloud.online = false;
    await s.createTransaction(tx());
    await s.createMeal(meal);
    await s.syncNow();
    expect(s.getSyncStatus()).toMatchObject({ state: 'offline', pending: 2 });
    expect(await s.getTransactions()).toHaveLength(1); // local stays usable
    cloud.online = true;
    await s.syncNow();
    expect(s.getSyncStatus()).toMatchObject({ state: 'synced', pending: 0 });
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(1);
    expect((cloud.live(U1.id, 'meal')[0] as Meal).items[0]!.caloriesKcal).toBeNull(); // unknown stays unknown
    const before = cloud.pushes;
    await s.syncNow();
    expect(cloud.pushes).toBe(before); // nothing left to send
  });

  it('survives a lost response without duplicating or losing the record', async () => {
    const s = dev('a.');
    await sign(s);
    await s.createTransaction(tx());
    cloud.dropNextResponse = true;
    await s.syncNow();
    expect(s.getSyncStatus().state).toBe('offline');
    await s.syncNow(); // retry: the cloud already has it, contents match → reconciled, not duplicated
    expect(s.getSyncStatus()).toMatchObject({ state: 'synced', pending: 0, conflicts: 0 });
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(1);
  });

  it('re-queues anything unconfirmed after a restart (crash safety)', async () => {
    const s = dev('a.');
    await sign(s);
    await s.createTransaction(tx());
    // simulate: the app was killed before the sync state was saved
    store.removeItem(`a.pt.sync.${U1.id}.v1`);
    const s2 = dev('a.');
    await sign(s2);
    await s2.syncNow();
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(1);
  });
});

describe('two devices, deletes and conflicts', () => {
  it('propagates creates, edits and deletes in both directions', async () => {
    const d1 = dev('d1.');
    const d2 = dev('d2.');
    await sign(d1); await sign(d2);
    const created = await d1.createTransaction(tx());
    await d1.syncNow(); await d2.syncNow();
    expect((await d2.getTransactions()).map((x) => x.id)).toEqual([created.id]);
    tick();
    await d2.updateTransaction(created.id, tx({ amount: 99.99 }));
    await d2.syncNow(); await d1.syncNow();
    expect((await d1.getTransactions())[0]!.amount).toBe(99.99);
    tick();
    await d1.deleteTransaction(created.id);
    await d1.syncNow(); await d2.syncNow();
    expect(await d2.getTransactions()).toHaveLength(0);
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(0);
    expect(cloud.rows(U1.id).get(`transaction:${created.id}`)!.deleted).toBe(true); // tombstone, not a hard delete
  });

  it('an older offline edit never silently overwrites a newer cloud record; both versions are kept', async () => {
    const d1 = dev('d1.');
    const d2 = dev('d2.');
    await sign(d1); await sign(d2);
    const a = await d1.createTransaction(tx());
    await d1.syncNow(); await d2.syncNow();
    tick();
    await d1.updateTransaction(a.id, tx({ amount: 10 })); // older edit, made offline
    tick();
    await d2.updateTransaction(a.id, tx({ amount: 20 })); // newer edit
    await d2.syncNow();
    await d1.syncNow(); // d1's older edit meets the newer cloud one
    expect((await d1.getTransactions())[0]!.amount).toBe(20);
    expect((cloud.live(U1.id, 'transaction')[0] as Transaction).amount).toBe(20);
    const c = d1.getConflicts();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ keptVersion: 'cloud', reason: 'newer-remote' });
    expect(JSON.parse(c[0]!.otherJson!).amount).toBe(10); // the losing version is still there
    // restoring it is a normal new edit that syncs everywhere
    tick();
    d1.resolveConflict(c[0]!.id, 'restore');
    await d1.syncNow(); await d2.syncNow();
    expect((await d2.getTransactions())[0]!.amount).toBe(10);
    expect(d1.getConflicts()).toHaveLength(0);
  });

  it('a newer local edit wins over an older cloud edit and the old cloud version is kept', async () => {
    const d1 = dev('d1.');
    const d2 = dev('d2.');
    await sign(d1); await sign(d2);
    const a = await d1.createTransaction(tx());
    await d1.syncNow(); await d2.syncNow();
    tick();
    await d2.updateTransaction(a.id, tx({ amount: 20 }));
    await d2.syncNow();
    tick();
    await d1.updateTransaction(a.id, tx({ amount: 10 }));
    await d1.syncNow();
    expect((cloud.live(U1.id, 'transaction')[0] as Transaction).amount).toBe(10);
    expect(d1.getConflicts()[0]).toMatchObject({ keptVersion: 'device' });
    await d2.syncNow();
    expect((await d2.getTransactions())[0]!.amount).toBe(10);
  });

  it('edit beats delete in both directions', async () => {
    const d1 = dev('d1.');
    const d2 = dev('d2.');
    await sign(d1); await sign(d2);
    const a = await d1.createTransaction(tx());
    await d1.syncNow(); await d2.syncNow();
    tick();
    await d1.deleteTransaction(a.id);
    tick();
    await d2.updateTransaction(a.id, tx({ amount: 77 }));
    await d1.syncNow();
    await d2.syncNow();
    await d1.syncNow();
    expect((await d1.getTransactions()).map((x) => x.amount)).toEqual([77]);
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(1);
  });

  it('resolveConflict is deterministic', () => {
    const l = { json: '{"a":1}', updatedAt: '2026-01-02T00:00:00Z' };
    const r = { json: '{"a":2}', updatedAt: '2026-01-01T00:00:00Z' };
    expect(resolveConflict(l, r)).toEqual({ action: 'keep-local', reason: 'newer-local' });
    expect(resolveConflict(r, l)).toEqual({ action: 'take-remote', reason: 'newer-remote' });
    expect(resolveConflict({ ...l, updatedAt: r.updatedAt }, r)).toEqual({ action: 'take-remote', reason: 'tie-cloud-wins' });
    expect(resolveConflict(l, { ...l })).toEqual({ action: 'same' });
    expect(resolveConflict({ json: null, updatedAt: 'x' }, r)).toEqual({ action: 'take-remote', reason: 'edit-vs-delete' });
  });
});

describe('guest → account merge', () => {
  const setup = async () => {
    const guest = dev('d.');
    const mine = await guest.createTransaction(tx({ description: 'My real lunch' }));
    const mealMine = await guest.createMeal(meal);
    return { guest, mine, mealMine };
  };

  it('previews both sides and backs up first', async () => {
    const { guest } = await setup();
    await sign(guest);
    // the cloud already has one of the user's own records
    cloud.rows(U1.id).set('transaction:cloud-only', { data: { id: 'cloud-only', type: 'income', amount: 500, currency: 'INR', category: 'salary', description: 'Cloud income', merchant: null, notes: null, occurredAt: '2026-03-01T00:00:00Z', source: 'manual' }, deleted: false, rev: 1, updatedAt: '2026-03-01T00:00:00Z', ts: ++cloud.clock });
    await guest.syncNow();
    expect(guest.needsMergePrompt()).toBe(true);
    const p = guest.previewGuestMerge()!;
    expect(p.local.transactions).toBe(1);
    expect(p.cloud.transactions).toBe(1);
    expect(p.legacy.transactions).toBe(0);
    expect(p.willAdd).toBe(2); // my transaction + my meal
    const r = await guest.mergeGuest();
    expect(r).toMatchObject({ added: 2, confirmed: true });
    expect(store.getItem(r.backupKey)).toBeTruthy();
    const ids = (await guest.getTransactions()).map((x) => x.description);
    expect(ids).toContain('My real lunch');
    expect(ids).toContain('Cloud income'); // cloud-only kept
    expect(ids.some((d) => d !== 'My real lunch' && d !== 'Cloud income')).toBe(false);
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(2);
    expect(guest.needsMergePrompt()).toBe(false);
  });

  it('is repeatable: running it again adds nothing and duplicates nothing', async () => {
    const { guest } = await setup();
    await sign(guest);
    await guest.mergeGuest();
    const counts = [cloud.live(U1.id, 'transaction').length, cloud.live(U1.id, 'meal').length];
    const again = await guest.mergeGuest();
    expect(again.added).toBe(0);
    expect(again.identical).toBe(2);
    expect([cloud.live(U1.id, 'transaction').length, cloud.live(U1.id, 'meal').length]).toEqual(counts);
  });

  it('never includes exact legacy seed records in merge planning', () => {
    const seeded = buildSeedDb(new Date('2026-03-10T08:00:00Z'));
    const expected = seeded.meals.length + seeded.transactions.length + seeded.weighIns.length;
    const plan = planMerge(seeded, buildEmptyDb(), { accountHasCloudSettings: false, accountHasCloudPrefs: false });
    expect(plan.skippedLegacy).toBe(expected);
    expect(plan.add.filter((x) => ['meal', 'transaction', 'weighIn'].includes(x.kind))).toHaveLength(0);
  });

  it('keeps the cloud record and saves the device version when the same id differs', async () => {
    const { guest, mine } = await setup();
    await sign(guest);
    cloud.rows(U1.id).set(`transaction:${mine.id}`, { data: { ...mine, amount: 1, description: 'Edited elsewhere' }, deleted: false, rev: 3, updatedAt: '2026-03-09T00:00:00Z', ts: ++cloud.clock });
    await guest.syncNow();
    const r = await guest.mergeGuest();
    expect(r.differing).toBe(1);
    expect((await guest.getTransactions()).find((x) => x.id === mine.id)!.description).toBe('Edited elsewhere');
    expect(JSON.parse(guest.getConflicts()[0]!.otherJson!).description).toBe('My real lunch');
  });

  it("doesn't confirm (and doesn't claim success) when the network is down", async () => {
    const { guest } = await setup();
    await sign(guest);
    cloud.online = false;
    const r = await guest.mergeGuest();
    expect(r.confirmed).toBe(false);
    // the on-device guest copy is untouched, and the merge finishes on the next sync
    cloud.online = true;
    await guest.syncNow();
    expect(cloud.live(U1.id, 'transaction')).toHaveLength(1);
  });
});

describe('row mapping', () => {
  it('round-trips each record kind, with paise and nullable nutrition preserved', () => {
    const db = buildSeedDb(new Date('2026-03-10T08:00:00Z'));
    const m = { updatedAt: '2026-03-10T08:00:00Z', deleted: false, baseRev: 0 };
    const t = { ...db.transactions[0]!, amount: 10.05 };
    const trow = toRow('transaction', t, m, 'u');
    expect(trow.amount_paise).toBe(1005);
    expect(fromRow('transaction', { ...trow, rev: 1 })).toMatchObject({ amount: 10.05, currency: 'INR' });
    const meal0 = { ...db.meals[0]!, items: [{ ...db.meals[0]!.items[0]!, caloriesKcal: null, proteinG: null }] };
    const mrow = toRow('meal', meal0, m, 'u') as { items: Array<Record<string, unknown>> };
    expect(mrow.items[0]!.calories_kcal).toBeNull();
    const back = fromRow('meal', { ...mrow, rev: 1, eaten_at: meal0.eatenAt }, mrow.items.map((i, n) => ({ ...i, position: n }))) as Meal;
    expect(back.items[0]!.caloriesKcal).toBeNull();
    expect(back.items[0]!.proteinG).toBeNull();
    const srow = toRow('settings', db.settings, m, 'u');
    expect(srow).not.toHaveProperty('apiKey');
    expect(JSON.stringify(srow)).not.toMatch(/api.?key/i);
  });
});
