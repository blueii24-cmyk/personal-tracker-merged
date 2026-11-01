import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockTrackerService } from '@/tracker/lib/api/mock/mock-tracker-service';
import { BACKUP_FORMAT_VERSION, migrateDb, parseBackup } from '@/tracker/lib/api/mock/persistence';
import { dateKeyInTz } from '@/tracker/lib/formatting/dates';
import { buildEvent, eventsOnDate, monthGrid, normalizeEvent, trackerItemsOnDate, validateEventInput, weekdayOrder } from './calendar';
import { DEFAULT_CALENDAR_PREFS, type CalendarEventInput } from '@/tracker/types/calendar';
import {
  addDaysKey, allowedReturn, buildAuthUrl, classifyGoogleError, decryptToken, encryptToken, googleCopyTombstone, hasWriteScope, localEventId, pkcePair, toAppEvent, toGoogleBody,
} from '../../../../supabase/functions/_shared/google-core';

class FakeStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
}
let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  (globalThis as unknown as { localStorage: FakeStorage }).localStorage = store;
});
const NOW = new Date('2026-03-10T08:00:00Z');
const TZ = 'Asia/Kolkata';
const input = (o: Partial<CalendarEventInput> = {}): CalendarEventInput => ({ title: 'Dentist', notes: null, location: null, allDay: false, startDate: '2026-03-12', endDate: '2026-03-12', startTime: '10:00', endTime: '11:00', category: 'health', ...o });

describe('month grid and date boundaries', () => {
  it('builds whole weeks and respects the week start', () => {
    const mon = monthGrid('2026-03', 1);
    expect(mon.every((r) => r.length === 7)).toBe(true);
    expect(mon[0]![0]).toBe('2026-02-23'); // 1 March 2026 is a Sunday
    expect(mon.flat()).toContain('2026-03-31');
    const sun = monthGrid('2026-03', 0);
    expect(sun[0]![0]).toBe('2026-03-01');
    expect(monthGrid('2027-02', 1)).toHaveLength(4); // 1 Feb 2027 is a Monday and the month has 28 days
    expect(monthGrid('2026-02', 1)).toHaveLength(5);
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
  it('handles leap day, year ends and month ends', () => {
    expect(monthGrid('2028-02', 1).flat()).toContain('2028-02-29');
    expect(monthGrid('2026-12', 1).flat()).toContain('2027-01-03');
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('places a late-night record on the right local day (timezone-safe)', () => {
    // 23:30 UTC on the 10th is 05:00 on the 11th in India, still the 10th in New York.
    const iso = '2026-03-10T23:30:00Z';
    expect(dateKeyInTz(iso, 'Asia/Kolkata')).toBe('2026-03-11');
    expect(dateKeyInTz(iso, 'America/New_York')).toBe('2026-03-10');
    const src = { meals: [], transactions: [{ id: 't', type: 'expense' as const, amount: 1, currency: 'INR' as const, category: 'food' as const, description: 'x', merchant: null, notes: null, occurredAt: iso, source: 'manual' as const }], weighIns: [] };
    expect(trackerItemsOnDate('2026-03-11', 'Asia/Kolkata', src).transactions).toHaveLength(1);
    expect(trackerItemsOnDate('2026-03-10', 'Asia/Kolkata', src).transactions).toHaveLength(0);
    expect(trackerItemsOnDate('2026-03-10', 'America/New_York', src).transactions).toHaveLength(1);
  });
  it('multi-day and all-day events cover every day they span', () => {
    const e = buildEvent(input({ allDay: true, startDate: '2026-03-30', endDate: '2026-04-02', startTime: null, endTime: null }), 'e1', TZ);
    expect(e.startsAt).toBeNull();
    for (const d of ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']) expect(eventsOnDate([e], d)).toHaveLength(1);
    expect(eventsOnDate([e], '2026-04-03')).toHaveLength(0);
    expect(eventsOnDate([e], '2026-03-29')).toHaveLength(0);
  });
  it('a timed event stored as a UTC instant keeps its local day', () => {
    const e = buildEvent(input({ startDate: '2026-03-12', endDate: '2026-03-12', startTime: '00:30', endTime: '01:30' }), 'e2', TZ);
    expect(e.startsAt).toBe('2026-03-11T19:00:00.000Z'); // 00:30 IST is the previous day in UTC
    expect(e.startDate).toBe('2026-03-12');
  });
});

describe('event validation', () => {
  it('rejects bad input with a plain message', () => {
    expect(validateEventInput(input({ title: '  ' }), TZ)).toMatch(/title/i);
    expect(validateEventInput(input({ endDate: '2026-03-11' }), TZ)).toMatch(/end date/i);
    expect(validateEventInput(input({ endTime: '09:00' }), TZ)).toMatch(/before it starts/i);
    expect(validateEventInput(input({ startTime: null }), TZ)).toMatch(/start time/i);
    expect(validateEventInput(input({ startDate: '2026-02-30' }), TZ)).toMatch(/valid dates/i);
    expect(validateEventInput(input({ allDay: true, endDate: '2028-03-12' }), TZ)).toMatch(/year/i);
    expect(validateEventInput(input(), TZ)).toBeNull();
  });
  it('normalizeEvent refuses broken stored data', () => {
    expect(normalizeEvent({ id: 'x', title: 'a', startDate: '2026-03-02', endDate: '2026-03-01', allDay: true })).toBeNull();
    expect(normalizeEvent({ id: 'x', title: 'a', startDate: '2026-03-01', endDate: '2026-03-01', allDay: false })).toBeNull();
    expect(normalizeEvent({ id: 'x', title: 'a', startDate: '2026-03-01', endDate: '2026-03-01', allDay: true })).toMatchObject({ origin: 'app', category: 'other', readOnly: false });
  });
});

describe('event CRUD, offline persistence, backup and restore', () => {
  it('creates, edits, deletes and restores an event; Google copies are read-only', async () => {
    const s = new MockTrackerService(() => NOW);
    const e = await s.createCalendarEvent(input());
    expect((await s.getCalendarEvents({ from: '2026-03-12', to: '2026-03-12' }))).toHaveLength(1);
    expect(await s.getCalendarEvents({ from: '2026-03-13', to: '2026-03-20' })).toHaveLength(0);
    const edited = await s.updateCalendarEvent(e.id, input({ title: 'Dentist (moved)', startDate: '2026-03-14', endDate: '2026-03-14' }));
    expect(edited.title).toBe('Dentist (moved)');
    await expect(s.createCalendarEvent(input({ title: '' }))).rejects.toMatchObject({ code: 'VALIDATION' });
    await s.deleteCalendarEvent(e.id);
    expect(await s.getCalendarEvents()).toHaveLength(0);
    await s.restoreCalendarEvent(edited);
    expect(await s.getCalendarEvents()).toHaveLength(1);
    // simulate a synced Google copy
    const db = (s as unknown as { db: { calendarEvents: unknown[] } }).db;
    db.calendarEvents.push({ id: 'g-1', title: 'Standup', notes: null, location: null, allDay: true, startDate: '2026-03-12', endDate: '2026-03-12', startsAt: null, endsAt: null, category: 'other', origin: 'google', google: { calendarId: 'c', eventId: 'e', etag: '"1"' }, readOnly: true });
    await expect(s.updateCalendarEvent('g-1', input())).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(s.deleteCalendarEvent('g-1')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('events and preferences persist on the device (offline) across restarts and never touch tracker records', async () => {
    const a = new MockTrackerService(() => NOW);
    const before = { meals: (await a.getMeals()).length, tx: (await a.getTransactions()).length };
    const e = await a.createCalendarEvent(input());
    await a.updateCalendarPrefs({ weekStart: 0, accent: 'fuel', show: { ...DEFAULT_CALENDAR_PREFS.show, meals: false } });
    const b = new MockTrackerService(() => NOW);
    expect((await b.getCalendarEvents()).map((x) => x.id)).toEqual([e.id]);
    expect(await b.getCalendarPrefs()).toMatchObject({ weekStart: 0, accent: 'fuel', show: { meals: false, events: true } });
    expect({ meals: (await b.getMeals()).length, tx: (await b.getTransactions()).length }).toEqual(before);
  });

  it('databases saved before the calendar existed still load', () => {
    const svc = new MockTrackerService(() => NOW);
    const raw = JSON.parse(store.getItem('pt.demo.db.v1')!);
    delete raw.calendarEvents;
    delete raw.calendarPrefs;
    const m = migrateDb(raw);
    expect(m?.db.calendarEvents).toEqual([]);
    expect(svc).toBeTruthy();
  });

  it('exports calendar data (app events only) and restores it; format 1 files still restore', async () => {
    const a = new MockTrackerService(() => NOW);
    const e = await a.createCalendarEvent(input());
    await a.updateCalendarPrefs({ weekStart: 6 });
    (a as unknown as { db: { calendarEvents: unknown[] } }).db.calendarEvents.push({ id: 'g-1', title: 'G', notes: null, location: null, allDay: true, startDate: '2026-03-12', endDate: '2026-03-12', startsAt: null, endsAt: null, category: 'other', origin: 'google', google: { calendarId: 'c', eventId: 'e', etag: null }, readOnly: true });
    const bundle = await a.exportData();
    expect(bundle.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(bundle.calendarEvents!.map((x) => x.id)).toEqual([e.id]); // Google copies are not backed up
    const parsed = parseBackup(JSON.stringify(bundle));
    expect(parsed.ok).toBe(true);
    store.data.clear();
    const b = new MockTrackerService(() => NOW);
    await b.importData((parsed as { ok: true; bundle: typeof bundle }).bundle);
    expect((await b.getCalendarEvents()).map((x) => x.title)).toEqual(['Dentist']);
    expect((await b.getCalendarPrefs()).weekStart).toBe(6);
    // a version-1 file has no calendar section and leaves the calendar alone
    const v1 = { ...bundle, formatVersion: 1 } as Record<string, unknown>;
    delete v1.calendarEvents;
    delete v1.calendarPrefs;
    const p1 = parseBackup(JSON.stringify(v1));
    expect(p1.ok).toBe(true);
    await b.importData((p1 as { ok: true; bundle: typeof bundle }).bundle);
    expect(await b.getCalendarEvents()).toHaveLength(1);
    // damaged calendar sections are rejected, all or nothing
    expect(parseBackup(JSON.stringify({ ...bundle, calendarEvents: [{ id: 'bad' }] })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...bundle, calendarEvents: 'nope' })).ok).toBe(false);
  });
});

describe('theme: the calendar uses design tokens, not raw colours, in both modes', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const files = ['CalendarPage', 'EventDialog', 'CalendarPrefsDialog', 'GoogleCalendarCard'].map((f) => readFileSync(`src/tracker/components/calendar/${f}.tsx`, 'utf8'));
  it('defines every token the calendar uses for both light and dark', () => {
    const light = css.slice(css.indexOf(':root {'), css.indexOf('\n.dark {'));
    const dark = css.slice(css.indexOf('\n.dark {'));
    for (const v of ['--primary', '--fuel-mark', '--protein-mark', '--weight-mark', '--money-mark', '--surface', '--ink', '--ink-2', '--sunken', '--primary-container', '--on-primary-container']) {
      expect(light).toContain(`${v}:`);
      expect(dark).toContain(`${v}:`);
    }
  });
  it('contains no hard-coded colour values or non-token palette classes', () => {
    for (const src of files) {
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/\b(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|red|blue|green|orange|purple)(?:-\d{2,3})?\b/);
    }
  });
});

describe('Google Calendar core (pure parts)', () => {
  it('requests the narrowest scopes, and write access only on request', () => {
    const read = buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x.supabase.co/functions/v1/google-calendar/callback', state: 's', challenge: 'c', write: false });
    const u = new URL(read);
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(read).not.toMatch(/client_secret/);
    const write = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'r', state: 's', challenge: 'c', write: true }));
    expect(write.searchParams.get('scope')).toContain('calendar.events.owned');
    expect(write.searchParams.get('scope')).not.toMatch(/auth\/calendar(\s|$)/); // never the all-powerful scope
    expect(hasWriteScope(write.searchParams.get('scope'))).toBe(true);
    expect(hasWriteScope(u.searchParams.get('scope'))).toBe(false);
  });
  it('PKCE challenge matches the verifier', async () => {
    const { verifier, challenge } = await pkcePair();
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    expect(challenge).toBe(btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  });
  it('encrypts tokens at rest; wrong key or tampering fails', async () => {
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const blob = await encryptToken('1//refresh-token', key);
    expect(blob).not.toContain('refresh-token');
    expect(await decryptToken(blob, key)).toBe('1//refresh-token');
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await expect(decryptToken(blob, other)).rejects.toThrow();
    await expect(decryptToken(`${blob.slice(0, -2)}AA`, key)).rejects.toThrow();
    await expect(encryptToken('x', btoa('short'))).rejects.toThrow();
  });
  it('maps Google events, treating all-day end dates as exclusive and zone-correct timed events', () => {
    expect(toAppEvent({ id: 'a', summary: 'Trip', start: { date: '2026-03-10' }, end: { date: '2026-03-13' }, etag: '"1"' }, TZ)).toMatchObject({ all_day: true, start_date: '2026-03-10', end_date: '2026-03-12', google_etag: '"1"' });
    expect(toAppEvent({ id: 'b', start: { date: '2026-03-10' }, end: { date: '2026-03-11' } }, TZ)).toMatchObject({ title: '(No title)', end_date: '2026-03-10' });
    const t = toAppEvent({ id: 'c', summary: 'Call', start: { dateTime: '2026-03-10T23:30:00Z' }, end: { dateTime: '2026-03-11T00:30:00Z' } }, TZ)!;
    expect(t).toMatchObject({ all_day: false, start_date: '2026-03-11', end_date: '2026-03-11' });
    expect(toAppEvent({ id: 'd', status: 'cancelled', start: { date: '2026-03-10' }, end: { date: '2026-03-11' } }, TZ)).toBeNull();
    expect(toAppEvent({ id: 'e' }, TZ)).toBeNull();
  });
  it('builds Google bodies and ids deterministically (no duplicate copies)', async () => {
    expect(toGoogleBody({ title: 'T', notes: null, location: null, all_day: true, start_date: '2026-03-10', end_date: '2026-03-11', starts_at: null, ends_at: null }, TZ)).toMatchObject({ start: { date: '2026-03-10' }, end: { date: '2026-03-12' } });
    expect(await localEventId('cal', 'ev')).toBe(await localEventId('cal', 'ev'));
    expect(await localEventId('cal', 'ev')).not.toBe(await localEventId('cal2', 'ev'));
  });
  it('tombstones imported copies with their observed revision for conflict-safe sync', () => {
    expect(googleCopyTombstone(17, '2026-11-01T10:00:00.000Z')).toEqual({
      deleted_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      base_rev: 17,
    });
  });
  it('classifies failures so the function can recover', () => {
    expect(classifyGoogleError(410, {}).kind).toBe('sync_token_expired');
    expect(classifyGoogleError(401, {}).kind).toBe('token_revoked');
    expect(classifyGoogleError(400, { error: 'invalid_grant' }).kind).toBe('token_revoked');
    expect(classifyGoogleError(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } })).toEqual({ kind: 'rate_limited', retryable: true });
    expect(classifyGoogleError(429, {}).kind).toBe('rate_limited');
    expect(classifyGoogleError(403, {}).kind).toBe('forbidden');
    expect(classifyGoogleError(503, {}).retryable).toBe(true);
  });
  it('only redirects back to allow-listed origins', () => {
    expect(allowedReturn('https://app.example/calendar', ['https://app.example'])).toBeTruthy();
    expect(allowedReturn('https://evil.example/calendar', ['https://app.example'])).toBeNull();
    expect(allowedReturn('javascript:alert(1)', ['https://app.example'])).toBeNull();
    expect(allowedReturn(null, [])).toBeNull();
  });
});
