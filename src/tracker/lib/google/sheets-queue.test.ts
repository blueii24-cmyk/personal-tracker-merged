import { describe, expect, it, vi } from 'vitest';
import { SheetsQueue } from './sheets-queue';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; }, clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
  };
}

describe('Sheets outbox primitive', () => {
  it('persists offline changes across restart and isolates accounts', async () => {
    const store = memory();
    const first = new SheetsQueue(store, 'user-a');
    first.enqueue('meal', 'm1', 'upsert', ['m1', 'rice']);
    expect(new SheetsQueue(store, 'user-b').status().pending).toBe(0);
    const resumed = new SheetsQueue(store, 'user-a');
    const send = vi.fn(async () => undefined);
    await resumed.flush(send, () => new Date('2026-01-01T00:00:00Z'));
    expect(send).toHaveBeenCalledOnce();
    expect(new SheetsQueue(store, 'user-a').status()).toEqual({ pending: 0, failed: 0, lastSuccess: '2026-01-01T00:00:00.000Z' });
  });
  it('retains failure without sensitive error text and retries', async () => {
    const store = memory(); const q = new SheetsQueue(store, 'u');
    q.enqueue('weight', 'w', 'upsert', ['w', 70]);
    await q.flush(async () => { throw new Error('secret'); });
    expect(q.status()).toMatchObject({ failed: 1, lastSuccess: null });
    expect(store.getItem(store.key(0)!)).not.toContain('secret');
    await new SheetsQueue(store, 'u').flush(async () => undefined);
    expect(new SheetsQueue(store, 'u').status().failed).toBe(0);
  });
  it('coalesces edits and deletes without losing an in-flight newer change', async () => {
    const q = new SheetsQueue(memory(), 'u');
    q.enqueue('transaction', 't', 'upsert', ['t', 1]);
    let finish!: () => void;
    const sending = q.flush(() => new Promise<void>((resolve) => { finish = resolve; }));
    q.enqueue('transaction', 't', 'delete', ['t', 'deleted']);
    finish(); await sending;
    expect(q.status()).toMatchObject({ pending: 1, lastSuccess: null });
    const send = vi.fn(async (_change: import('./sheets-queue').SheetsChange) => undefined);
    await q.flush(send);
    expect(send.mock.calls[0][0]).toMatchObject({ operation: 'delete', fields: ['t', 'deleted'] });
  });
  it('does not replace corrupt queue data', () => {
    const store = memory(); store.setItem('pt.sheets.queue.v1.u', '{broken');
    expect(() => new SheetsQueue(store, 'u')).toThrow('unreadable');
    expect(store.getItem('pt.sheets.queue.v1.u')).toBe('{broken');
  });
  it('reports storage failures without claiming a queued record exists', () => {
    const store = memory(); const q = new SheetsQueue(store, 'u');
    store.setItem = () => { throw new Error('full'); };
    expect(() => q.enqueue('calendar', 'c', 'upsert', ['c'])).toThrow('full');
    expect(q.status().pending).toBe(0);
  });
});
