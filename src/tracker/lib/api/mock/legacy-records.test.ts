import { describe, expect, it } from 'vitest';
import { buildEmptyDb, buildSeedDb } from './seed';
import { isLegacySeedId, withoutLegacySeedRecords } from './legacy-records';

describe('legacy seed cleanup', () => {
  it('starts a real first run empty with neutral settings', () => {
    const db = buildEmptyDb();
    expect(db.meals).toEqual([]);
    expect(db.transactions).toEqual([]);
    expect(db.weighIns).toEqual([]);
    expect(db.sessions).toEqual([]);
    expect(db.messages).toEqual([]);
    expect(db.settings).toMatchObject({ email: '', openingBalance: 0, dailyCalorieTarget: null, dailyProteinTargetG: null, monthlyBudget: null });
  });

  it('matches only exact record ids produced by the old seed generator', () => {
    expect(isLegacySeedId('demo-meal-1')).toBe(true);
    expect(isLegacySeedId('demo-tx-22')).toBe(true);
    expect(isLegacySeedId('demo-weight-3')).toBe(true);
    for (const id of ['demo-tx-custom', 'demo-meal-0', 'demo-weight-01', 'demo-chat-1', 'user-demo-tx-1']) expect(isLegacySeedId(id)).toBe(false);
  });

  it('backs out only known records and preserves every other partition and unknown demo-prefixed id', () => {
    const db = buildSeedDb(new Date('2026-03-10T08:00:00Z'));
    const custom = { ...db.transactions[0]!, id: 'demo-tx-custom', description: 'A real imported record' };
    db.transactions.push(custom);
    db.sessions.push({ id: 'demo-session-user', title: 'Keep me', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' });
    db.messages.push({ id: 'demo-message-user', sessionId: 'demo-session-user', role: 'assistant', content: 'Keep this too', createdAt: '2026-03-01T00:00:00Z', status: 'complete', actions: [{ toolCallId: 'demo-tool-1', toolName: 'get_summary', status: 'succeeded', summary: 'A receipt, not a seed' }] });
    const expected = db.meals.length + db.transactions.length - 1 + db.weighIns.length;
    const cleaned = withoutLegacySeedRecords(db);
    expect(cleaned.removed).toBe(expected);
    expect(cleaned.db.meals).toHaveLength(0);
    expect(cleaned.db.weighIns).toHaveLength(0);
    expect(cleaned.db.transactions).toEqual([custom]);
    expect(cleaned.db.sessions).toEqual(db.sessions);
    expect(cleaned.db.messages).toEqual(db.messages);
    expect(cleaned.db.settings).toEqual(db.settings);
    expect(withoutLegacySeedRecords(cleaned.db)).toEqual({ db: cleaned.db, removed: 0 });
  });
});
