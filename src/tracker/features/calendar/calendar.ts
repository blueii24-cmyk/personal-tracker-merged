/** Pure calendar helpers: grid building, event validation and per-day lookups. No storage, no React. */
import { addDays, dateKeyInTz, daysInMonth, isDateKey, zonedToIso } from '@/tracker/lib/formatting/dates';
import type { DateKey, Meal, MonthKey, Transaction, WeighIn } from '@/tracker/types/domain';
import {
  CALENDAR_ACCENTS, CALENDAR_CATEGORIES, DEFAULT_CALENDAR_PREFS,
  type CalendarEvent, type CalendarEventInput, type CalendarPrefs, type WeekStart,
} from '@/tracker/types/calendar';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_EVENT_DAYS = 366;

export const weekdayOf = (key: DateKey): number => new Date(`${key}T00:00:00Z`).getUTCDay();

/** Rows of 7 date keys that cover the month, starting on `weekStart`. Always whole weeks (4–6 rows). */
export function monthGrid(month: MonthKey, weekStart: WeekStart): DateKey[][] {
  const first = `${month}-01`;
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const total = Math.ceil((lead + daysInMonth(month)) / 7) * 7;
  const rows: DateKey[][] = [];
  let cursor = addDays(first, -lead);
  for (let r = 0; r < total / 7; r++) {
    const row: DateKey[] = [];
    for (let c = 0; c < 7; c++) {
      row.push(cursor);
      cursor = addDays(cursor, 1);
    }
    rows.push(row);
  }
  return rows;
}

/** Weekday indexes (0=Sun) in display order. */
export const weekdayOrder = (weekStart: WeekStart): number[] => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

export const eventCoversDate = (e: Pick<CalendarEvent, 'startDate' | 'endDate'>, date: DateKey): boolean => e.startDate <= date && date <= e.endDate;

export function eventsOnDate(events: CalendarEvent[], date: DateKey): CalendarEvent[] {
  return events
    .filter((e) => eventCoversDate(e, date))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.title.localeCompare(b.title));
}

export interface DayItems { meals: Meal[]; transactions: Transaction[]; weighIns: WeighIn[] }

/** Tracker records that fall on a date in the user's timezone (read-only; the calendar never edits them). */
export function trackerItemsOnDate(date: DateKey, tz: string, src: { meals: Meal[]; transactions: Transaction[]; weighIns: WeighIn[] }): DayItems {
  return {
    meals: src.meals.filter((m) => dateKeyInTz(m.eatenAt, tz) === date),
    transactions: src.transactions.filter((t) => dateKeyInTz(t.occurredAt, tz) === date),
    weighIns: src.weighIns.filter((w) => dateKeyInTz(w.recordedAt, tz) === date),
  };
}

/** Normalises and validates the form input. Returns the problem to show, or null when the input is fine. */
export function validateEventInput(i: CalendarEventInput, tz: string): string | null {
  const title = i.title.trim();
  if (!title) return 'Give the event a title.';
  if (title.length > 200) return 'Keep the title under 200 characters.';
  if ((i.notes ?? '').length > 4000) return 'Keep notes under 4,000 characters.';
  if ((i.location ?? '').length > 300) return 'Keep the location under 300 characters.';
  if (!CALENDAR_CATEGORIES.includes(i.category)) return 'Choose a category.';
  if (!isDateKey(i.startDate) || !isDateKey(i.endDate)) return 'Choose valid dates.';
  if (i.endDate < i.startDate) return 'The end date is before the start date.';
  const span = (Date.parse(`${i.endDate}T00:00:00Z`) - Date.parse(`${i.startDate}T00:00:00Z`)) / 86_400_000;
  if (span > MAX_EVENT_DAYS) return 'Events can last at most a year.';
  if (!i.allDay) {
    if (!i.startTime || !TIME.test(i.startTime)) return 'Choose a start time.';
    if (!i.endTime || !TIME.test(i.endTime)) return 'Choose an end time.';
    const s = Date.parse(zonedToIso(i.startDate, i.startTime, tz));
    const e = Date.parse(zonedToIso(i.endDate, i.endTime, tz));
    if (Number.isNaN(s) || Number.isNaN(e)) return 'Choose a valid time.';
    if (e < s) return 'The event ends before it starts.';
  }
  return null;
}

/** Builds the stored event. Timed events become UTC instants so they stay correct if the device timezone changes. */
export function buildEvent(i: CalendarEventInput, id: string, tz: string, keep?: Pick<CalendarEvent, 'origin' | 'google' | 'readOnly'>): CalendarEvent {
  const startsAt = i.allDay ? null : zonedToIso(i.startDate, i.startTime!, tz);
  const endsAt = i.allDay ? null : zonedToIso(i.endDate, i.endTime!, tz);
  return {
    id,
    title: i.title.trim(),
    notes: i.notes?.trim() ? i.notes.trim() : null,
    location: i.location?.trim() ? i.location.trim() : null,
    allDay: i.allDay,
    startDate: startsAt ? dateKeyInTz(startsAt, tz) : i.startDate,
    endDate: endsAt ? dateKeyInTz(endsAt, tz) : i.endDate,
    startsAt,
    endsAt,
    category: i.category,
    origin: keep?.origin ?? 'app',
    google: keep?.google ?? null,
    readOnly: keep?.readOnly ?? false,
  };
}

/** Accepts anything stored or imported and returns a safe event, or null if it is unusable. */
export function normalizeEvent(raw: unknown): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  if (typeof r.id !== 'string' || !r.id || typeof r.title !== 'string' || !r.title.trim()) return null;
  if (typeof r.startDate !== 'string' || typeof r.endDate !== 'string' || !isDateKey(r.startDate) || !isDateKey(r.endDate) || r.endDate < r.startDate) return null;
  const iso = (v: unknown): string | null => (typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v)) ? v : null);
  const allDay = r.allDay === true;
  const startsAt = iso(r.startsAt);
  const endsAt = iso(r.endsAt);
  if (!allDay && (!startsAt || !endsAt)) return null;
  const g = r.google && typeof r.google === 'object' ? (r.google as Record<string, unknown>) : null;
  const origin = r.origin === 'google' ? 'google' : 'app';
  return {
    id: r.id,
    title: r.title.trim().slice(0, 200),
    notes: str(r.notes),
    location: str(r.location),
    allDay,
    startDate: r.startDate,
    endDate: r.endDate,
    startsAt: allDay ? null : startsAt,
    endsAt: allDay ? null : endsAt,
    category: CALENDAR_CATEGORIES.includes(r.category as never) ? (r.category as CalendarEvent['category']) : 'other',
    origin,
    google: g && typeof g.calendarId === 'string' && typeof g.eventId === 'string' ? { calendarId: g.calendarId, eventId: g.eventId, etag: str(g.etag) } : null,
    readOnly: origin === 'google' ? r.readOnly !== false : false,
  };
}

export function normalizePrefs(raw: unknown): CalendarPrefs {
  const d = DEFAULT_CALENDAR_PREFS;
  if (!raw || typeof raw !== 'object') return { ...d, show: { ...d.show } };
  const r = raw as Record<string, unknown>;
  const show = r.show && typeof r.show === 'object' ? (r.show as Record<string, unknown>) : {};
  const flag = (k: keyof CalendarPrefs['show']) => (typeof show[k] === 'boolean' ? (show[k] as boolean) : d.show[k]);
  return {
    weekStart: r.weekStart === 0 || r.weekStart === 1 || r.weekStart === 6 ? r.weekStart : d.weekStart,
    defaultView: r.defaultView === 'agenda' ? 'agenda' : 'month',
    show: { events: flag('events'), meals: flag('meals'), spending: flag('spending'), weight: flag('weight'), google: flag('google') },
    accent: CALENDAR_ACCENTS.includes(r.accent as never) ? (r.accent as CalendarPrefs['accent']) : d.accent,
  };
}
