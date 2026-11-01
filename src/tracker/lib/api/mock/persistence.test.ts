import { describe, expect, it, beforeEach } from 'vitest';
import { buildSeedDb } from './seed';
import { BACKUP_FORMAT_VERSION, migrateDb, parseBackup, pruneProcessed } from './persistence';
import { MockTrackerService } from './mock-tracker-service';

/** A tiny localStorage with an optional "storage full" switch. */
class FakeStorage {
  data = new Map<string, string>();
  full = false;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.full && k !== 'pt.probe') throw new DOMException('quota', 'QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string) { this.data.delete(k); }
}
let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  (globalThis as unknown as { localStorage: FakeStorage }).localStorage = store;
});

const NOW = new Date('2026-03-10T08:00:00Z');
const tx = { type: 'expense' as const, amount: 120.5, category: 'food' as const, description: 'Lunch', merchant: null, notes: null, occurredAt: NOW.toISOString() };

describe('migrateDb', () => {
  it('accepts a healthy database unchanged', () => {
    const seed = buildSeedDb(NOW);
    const r = migrateDb(JSON.parse(JSON.stringify(seed)));
    expect(r?.dropped).toBe(0);
    expect(r?.db.meals).toHaveLength(seed.meals.length);
    expect(r?.db.transactions).toHaveLength(seed.transactions.length);
  });
  it('refuses data written by a newer app version instead of reading it', () => {
    expect(migrateDb({ ...buildSeedDb(NOW), version: 2 })).toBeNull();
  });
  it('refuses things that are not a database', () => {
    expect(migrateDb(null)).toBeNull();
    expect(migrateDb({ version: 1, meals: 'x' })).toBeNull();
  });
  it('drops only the damaged records and counts them', () => {
    const raw = JSON.parse(JSON.stringify(buildSeedDb(NOW)));
    raw.transactions.push({ id: 'bad1', type: 'expense', amount: Number.NaN, occurredAt: NOW.toISOString() });
    raw.transactions.push({ id: 'bad2', type: 'expense', amount: -5, occurredAt: NOW.toISOString() });
    raw.meals.push({ id: 'badm', mealType: 'lunch', eatenAt: 'not a date', items: [] });
    const r = migrateDb(raw)!;
    expect(r.dropped).toBe(3);
    expect(r.db.transactions.some((t) => t.id.startsWith('bad'))).toBe(false);
  });
});

describe('parseBackup', () => {
  const good = () => {
    const s = buildSeedDb(NOW);
    return { exportedAt: NOW.toISOString(), meals: s.meals, transactions: s.transactions, weighIns: s.weighIns, settings: s.settings };
  };
  it('accepts an export from before backups had a format version', () => {
    const r = parseBackup(JSON.stringify(good()));
    expect(r.ok).toBe(true);
  });
  it('rejects non-JSON, foreign and newer files', () => {
    expect(parseBackup('{oops').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...good(), app: 'other' })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...good(), formatVersion: BACKUP_FORMAT_VERSION + 1 })).ok).toBe(false);
  });
  it('restores completely or not at all: one bad record rejects the file', () => {
    const b = good();
    (b.transactions as unknown[]).push({ id: 'x', type: 'expense', amount: 'lots', occurredAt: NOW.toISOString() });
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Transaction #\d+/);
  });
});

describe('pruneProcessed', () => {
  it('keeps the newest entries', () => {
    const p = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(pruneProcessed(p, 2))).toEqual(['k3', 'k4']);
  });
});

describe('MockTrackerService storage safety', () => {
  it('rolls back and reports an error when the device refuses a save (no silent data loss, no phantom record)', async () => {
    const svc = new MockTrackerService(() => NOW);
    const before = (await svc.getTransactions()).length;
    store.full = true;
    await expect(svc.createTransaction(tx)).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    expect((await svc.getTransactions()).length).toBe(before);
    store.full = false;
    await svc.createTransaction(tx);
    expect((await svc.getTransactions()).length).toBe(before + 1);
  });

  it('keeps a copy of unreadable stored data instead of overwriting it', async () => {
    store.setItem('pt.demo.db.v1', '{"version":1,"meals":[');
    const svc = new MockTrackerService(() => NOW);
    expect(svc.takeStorageNotice()).toMatch(/couldn't be read/);
    expect(svc.takeStorageNotice()).toBeNull(); // shown once
    const copies = [...store.data.keys()].filter((k) => k.startsWith('pt.demo.db.v1.unreadable.'));
    expect(copies).toHaveLength(1);
    expect(store.getItem(copies[0]!)).toBe('{"version":1,"meals":[');
  });

  it('does not touch data from a newer app version', async () => {
    const future = JSON.stringify({ ...buildSeedDb(NOW), version: 2 });
    store.setItem('pt.demo.db.v1', future);
    new MockTrackerService(() => NOW);
    expect([...store.data.values()]).toContain(future);
  });

  it('persists across a restart', async () => {
    const a = new MockTrackerService(() => NOW);
    const created = await a.createTransaction(tx);
    const b = new MockTrackerService(() => NOW);
    expect((await b.getTransactions()).some((t) => t.id === created.id)).toBe(true);
  });

  it('stores money to the paisa and rejects non-numbers', async () => {
    const svc = new MockTrackerService(() => NOW);
    const t = await svc.createTransaction({ ...tx, amount: 10.005 });
    expect(Number.isInteger(Math.round(t.amount * 100))).toBe(true);
    await expect(svc.createTransaction({ ...tx, amount: Number.NaN })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.createTransaction({ ...tx, amount: 0 })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.createMeal({ mealType: 'lunch', eatenAt: NOW.toISOString(), notes: null, items: [{ foodName: 'Rice', quantity: 1, unit: 'cup', caloriesKcal: Number.NaN, proteinG: 4, isEstimate: false, nutritionSource: 'user_entered' }] })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('exports and restores everything, and erases on request', async () => {
    const svc = new MockTrackerService(() => NOW);
    await svc.createTransaction({ ...tx, description: 'Unique backup test' });
    const exported = await svc.exportData();
    const parsed = parseBackup(JSON.stringify(exported));
    expect(parsed.ok).toBe(true);

    await svc.eraseAllData();
    expect(await svc.getTransactions()).toHaveLength(0);
    expect(await svc.getMeals()).toHaveLength(0);

    if (parsed.ok) await svc.importData(parsed.bundle);
    const restored = await svc.getTransactions();
    expect(restored).toHaveLength(exported.transactions.length);
    expect(restored.some((t) => t.description === 'Unique backup test')).toBe(true);
    expect((await svc.getMeals()).length).toBe(exported.meals.length);
  });
});
