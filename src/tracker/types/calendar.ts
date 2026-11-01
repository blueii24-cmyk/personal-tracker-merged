import type { DateKey, IsoDateTime } from './domain';

export const CALENDAR_CATEGORIES = ['personal', 'health', 'work', 'study', 'other'] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];
export const CALENDAR_CATEGORY_LABELS: Record<CalendarCategory, string> = { personal: 'Personal', health: 'Health', work: 'Work', study: 'Study', other: 'Other' };

/** Where an event came from. `app` events are edited here; `google` events are read-only copies of a Google Calendar event. */
export type CalendarOrigin = 'app' | 'google';

export interface GoogleEventRef {
  calendarId: string;
  eventId: string;
  etag: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  allDay: boolean;
  /** First and last day (inclusive) in the user's timezone. For timed events these are derived from startsAt/endsAt. */
  startDate: DateKey;
  endDate: DateKey;
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  category: CalendarCategory;
  origin: CalendarOrigin;
  google: GoogleEventRef | null;
  readOnly: boolean;
}

/** What the form collects. Times are wall-clock `HH:MM` in the user's timezone, so DST and zone changes are handled in one place. */
export interface CalendarEventInput {
  title: string;
  notes: string | null;
  location: string | null;
  allDay: boolean;
  startDate: DateKey;
  endDate: DateKey;
  startTime: string | null;
  endTime: string | null;
  category: CalendarCategory;
}

export const CALENDAR_ACCENTS = ['primary', 'fuel', 'protein', 'weight'] as const;
export type CalendarAccent = (typeof CALENDAR_ACCENTS)[number];
export type CalendarView = 'month' | 'agenda';
export type WeekStart = 0 | 1 | 6;

export interface CalendarPrefs {
  weekStart: WeekStart;
  defaultView: CalendarView;
  /** Which kinds of things appear on the calendar. */
  show: { events: boolean; meals: boolean; spending: boolean; weight: boolean; google: boolean };
  accent: CalendarAccent;
}

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  weekStart: 1,
  defaultView: 'month',
  show: { events: true, meals: true, spending: true, weight: true, google: true },
  accent: 'primary',
};
