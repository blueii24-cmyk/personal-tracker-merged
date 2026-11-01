import type { DateKey, IsoDateTime, MonthKey } from '@/tracker/types/domain';

/* All calendar logic is done in the user's timezone (profiles.timezone), never the browser's. */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, opts: Intl.DateTimeFormatOptions, key: string): Intl.DateTimeFormat {
  const k = `${tz}|${key}`;
  let f = dtfCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts });
    dtfCache.set(k, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}
function partsInTz(input: Date | IsoDateTime, tz: string): Parts {
  const d = typeof input === 'string' ? new Date(input) : input;
  const out: Record<string, number> = {};
  for (const p of dtf(
    tz,
    { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
    'parts',
  ).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { year: out.year ?? 1970, month: out.month ?? 1, day: out.day ?? 1, hour: out.hour ?? 0, minute: out.minute ?? 0 };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function dateKeyInTz(input: Date | IsoDateTime, tz: string): DateKey {
  const p = partsInTz(input, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
export function monthKeyOf(dateKey: DateKey): MonthKey {
  return dateKey.slice(0, 7);
}
export function monthKeyInTz(input: Date | IsoDateTime, tz: string): MonthKey {
  return monthKeyOf(dateKeyInTz(input, tz));
}
export function timeKeyInTz(input: Date | IsoDateTime, tz: string): string {
  const p = partsInTz(input, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
export function hourInTz(input: Date | IsoDateTime, tz: string): number {
  return partsInTz(input, tz).hour;
}
export function todayKey(tz: string, now: Date = new Date()): DateKey {
  return dateKeyInTz(now, tz);
}

/* ----- date-key arithmetic (pure calendar math, timezone independent) ----- */

function keyToUtc(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}
function utcToKey(d: Date): DateKey {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function addDays(key: DateKey, n: number): DateKey {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
}
export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function monthRange(month: MonthKey): { from: DateKey; to: DateKey } {
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` };
}
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((keyToUtc(a).getTime() - keyToUtc(b).getTime()) / 86_400_000);
}
export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to && out.length < 4000; k = addDays(k, 1)) out.push(k);
  return out;
}
export function isDateKey(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(keyToUtc(s).getTime()) && utcToKey(keyToUtc(s)) === s;
}
export function isMonthKey(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/* ----- zone-aware conversion ----- */

function offsetMs(utcMs: number, tz: string): number {
  const p = partsInTz(new Date(utcMs), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(utcMs / 60_000) * 60_000;
}
/** Convert a wall-clock date + `HH:mm` in `tz` to an ISO instant. */
export function zonedToIso(dateKey: DateKey, time: string, tz: string): IsoDateTime {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let result = guess - offsetMs(guess, tz);
  result = guess - offsetMs(result, tz);
  return new Date(result).toISOString();
}

/* ----- display ----- */

export function formatTime(iso: IsoDateTime, tz: string): string {
  return dtf(tz, { hour: 'numeric', minute: '2-digit', hour12: true }, 'time').format(new Date(iso)).replace(/\s/g, ' ').toLowerCase();
}
export function formatDayMonth(key: DateKey): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(keyToUtc(key));
}
export function formatWeekdayDate(key: DateKey): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(keyToUtc(key));
}
export function formatLongDate(key: DateKey): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(keyToUtc(key));
}
export function formatFullDate(key: DateKey): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(keyToUtc(key));
}
export function formatMonthLabel(month: MonthKey): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(keyToUtc(`${month}-01`));
}
export function formatMonthShort(month: MonthKey): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(keyToUtc(`${month}-01`));
}

/** "Today", "Yesterday", or "Mon, 27 Oct". */
export function formatRelativeDay(key: DateKey, today: DateKey): string {
  const d = diffDays(key, today);
  if (d === 0) return 'Today';
  if (d === -1) return 'Yesterday';
  if (d === 1) return 'Tomorrow';
  return formatWeekdayDate(key);
}
/** Same as formatRelativeDay but safe to use mid-sentence: only "Today"/"Yesterday" are lowercased. */
export function formatRelativeDayInline(key: DateKey, today: DateKey): string {
  const d = formatRelativeDay(key, today);
  return d === 'Today' || d === 'Yesterday' || d === 'Tomorrow' ? d.toLowerCase() : d;
}
/** "Today, 2:30 pm" / "Yesterday, 8:10 am" / "27 Oct, 8:10 pm". */
export function formatTimestamp(iso: IsoDateTime, tz: string, now: Date = new Date()): string {
  const key = dateKeyInTz(iso, tz);
  const today = todayKey(tz, now);
  const diff = diffDays(key, today);
  const time = formatTime(iso, tz);
  if (diff === 0) return `Today, ${time}`;
  if (diff === -1) return `Yesterday, ${time}`;
  return `${formatDayMonth(key)}, ${time}`;
}

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
] as const;
