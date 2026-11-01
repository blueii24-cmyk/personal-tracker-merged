import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Settings2 } from 'lucide-react';
import { PageContainer } from '@/tracker/components/layout/AppShell';
import { PageHeader } from '@/tracker/components/layout/PageHeader';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody } from '@/tracker/components/ui/Card';
import { ConfirmDialog } from '@/tracker/components/ui/Dialog';
import { EmptyState, ErrorState } from '@/tracker/components/ui/EmptyState';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { useToast } from '@/tracker/components/ui/Toast';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { eventsOnDate, monthGrid, trackerItemsOnDate, weekdayOrder } from '@/tracker/features/calendar/calendar';
import { mealTotals } from '@/tracker/features/meals/calculations';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { cn } from '@/tracker/lib/cn';
import { formatRupees } from '@/tracker/lib/formatting/currency';
import { addDays, addMonths, formatMonthLabel, formatTime, formatWeekdayDate, monthKeyOf } from '@/tracker/lib/formatting/dates';
import { formatKcal, formatWeight } from '@/tracker/lib/formatting/nutrition';
import { CALENDAR_CATEGORY_LABELS, DEFAULT_CALENDAR_PREFS, type CalendarEvent, type CalendarEventInput, type CalendarPrefs, type CalendarView } from '@/tracker/types/calendar';
import type { DateKey, MonthKey } from '@/tracker/types/domain';
import { CalendarPrefsDialog, ACCENT_VAR } from './CalendarPrefsDialog';
import { EventDialog } from './EventDialog';
import { GoogleCalendarCard } from './GoogleCalendarCard';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DayInfo { events: CalendarEvent[]; meals: number; spend: number; weight: number }

export default function CalendarPage() {
  const t = useTracker();
  const { toast } = useToast();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_CALENDAR_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [month, setMonth] = useState<MonthKey | null>(null);
  const [selected, setSelected] = useState<DateKey | null>(null);
  const [view, setView] = useState<CalendarView | null>(null);
  const [editing, setEditing] = useState<{ event: CalendarEvent | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [customize, setCustomize] = useState(false);
  const tz = t.timezone;
  const today = t.today;
  const service = t.service;

  const load = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([service.getCalendarEvents(), service.getCalendarPrefs()]);
      setEvents(e);
      setPrefs(p);
      setLoaded(true);
      setLoadError(null);
    } catch (err) {
      setLoadError(toTrackerError(err).message);
    }
  }, [service]);
  // `t.summary` is replaced on every refresh (local edits, sync, resume), so events stay current with the records.
  useEffect(() => {
    void load();
  }, [load, t.summary]);

  const activeMonth = month ?? monthKeyOf(today);
  const activeDate = selected ?? today;
  const activeView = view ?? prefs.defaultView;
  const accent = `var(${ACCENT_VAR[prefs.accent]})`;
  const grid = useMemo(() => monthGrid(activeMonth, prefs.weekStart), [activeMonth, prefs.weekStart]);

  const visibleEvents = useMemo(() => events.filter((e) => (e.origin === 'google' ? prefs.show.google : prefs.show.events)), [events, prefs.show.google, prefs.show.events]);

  const days = useMemo(() => {
    const map = new Map<DateKey, DayInfo>();
    const get = (k: DateKey): DayInfo => map.get(k) ?? (map.set(k, { events: [], meals: 0, spend: 0, weight: 0 }), map.get(k)!);
    const first = grid[0]![0]!;
    const last = grid[grid.length - 1]![6]!;
    for (const e of visibleEvents) {
      for (let d = e.startDate < first ? first : e.startDate, n = 0; d <= e.endDate && d <= last && n < 400; d = addDays(d, 1), n++) get(d).events.push(e);
    }
    for (const k of grid.flat()) {
      const it = trackerItemsOnDate(k, tz, { meals: t.meals, transactions: t.transactions, weighIns: t.weighIns });
      if (prefs.show.meals && it.meals.length) get(k).meals = it.meals.length;
      if (prefs.show.spending && it.transactions.length) get(k).spend = it.transactions.length;
      if (prefs.show.weight && it.weighIns.length) get(k).weight = it.weighIns.length;
    }
    return map;
  }, [grid, visibleEvents, t.meals, t.transactions, t.weighIns, tz, prefs.show]);

  const go = (m: MonthKey) => {
    setMonth(m);
    setSelected(`${m}-01` <= today && today.startsWith(m) ? today : `${m}-01`);
  };
  const goToday = () => {
    setMonth(monthKeyOf(today));
    setSelected(today);
  };
  const pick = (d: DateKey) => {
    setSelected(d);
    if (monthKeyOf(d) !== activeMonth) setMonth(monthKeyOf(d));
  };

  const savePrefs = async (patch: Partial<CalendarPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch, show: { ...p.show, ...(patch.show ?? {}) } }));
    try {
      setPrefs(await service.updateCalendarPrefs(patch));
    } catch (e) {
      toast({ title: "Couldn't save that setting", description: toTrackerError(e).message, tone: 'error' });
      void load();
    }
  };

  const save = async (input: CalendarEventInput) => {
    setSaving(true);
    setFormError(null);
    try {
      const ev = editing?.event;
      if (ev) await service.updateCalendarEvent(ev.id, input);
      else await service.createCalendarEvent(input);
      setEditing(null);
      await load();
      toast({ title: ev ? 'Event updated' : 'Event added', tone: 'success' });
    } catch (e) {
      setFormError(toTrackerError(e).message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    const ev = editing?.event;
    if (!ev) return;
    setSaving(true);
    try {
      await service.deleteCalendarEvent(ev.id);
      setConfirmDelete(false);
      setEditing(null);
      await load();
      toast({ title: 'Event deleted', tone: 'success', action: { label: 'Undo', onClick: () => void service.restoreCalendarEvent(ev).then(load) } });
    } catch (e) {
      setConfirmDelete(false);
      setFormError(toTrackerError(e).message);
    } finally {
      setSaving(false);
    }
  };

  if (loadError && !loaded) return <PageContainer><ErrorState message={loadError} onRetry={() => void load()} /></PageContainer>;
  if (!loaded || t.status !== 'ready') {
    return (
      <PageContainer>
        <div role="status" aria-label="Loading calendar" className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96" />
        </div>
      </PageContainer>
    );
  }

  const dayEvents = eventsOnDate(visibleEvents, activeDate);
  const dayItems = trackerItemsOnDate(activeDate, tz, { meals: t.meals, transactions: t.transactions, weighIns: t.weighIns });
  const shownMeals = prefs.show.meals ? dayItems.meals : [];
  const shownTx = prefs.show.spending ? dayItems.transactions : [];
  const shownWeights = prefs.show.weight ? dayItems.weighIns : [];
  const dayEmpty = !dayEvents.length && !shownMeals.length && !shownTx.length && !shownWeights.length;
  const openNew = () => {
    setFormError(null);
    setEditing({ event: null });
  };

  const eventRow = (e: CalendarEvent) => (
    <li key={e.id}>
      <button type="button" onClick={() => { setFormError(null); setEditing({ event: e }); }} className="flex w-full items-start gap-3 rounded-2xl bg-sunken px-4 py-3 text-left hover:bg-hover">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.origin === 'google' ? 'var(--protein-mark)' : accent }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{e.title}</span>
          <span className="block text-xs text-ink-2">
            {e.allDay ? 'All day' : `${formatTime(e.startsAt!, tz)} – ${formatTime(e.endsAt!, tz)}`}
            {e.origin === 'google' ? ' · Google Calendar' : ` · ${CALENDAR_CATEGORY_LABELS[e.category]}`}
            {e.location ? ` · ${e.location}` : ''}
          </span>
        </span>
      </button>
    </li>
  );

  const dayDetails = (d: DateKey, heading: boolean) => {
    const info = trackerItemsOnDate(d, tz, { meals: t.meals, transactions: t.transactions, weighIns: t.weighIns });
    const ev = eventsOnDate(visibleEvents, d);
    const ml = prefs.show.meals ? info.meals : [];
    const tx = prefs.show.spending ? info.transactions : [];
    const wi = prefs.show.weight ? info.weighIns : [];
    if (!ev.length && !ml.length && !tx.length && !wi.length) return null;
    return (
      <section key={d} className="space-y-2">
        {heading && <h3 className="px-1 text-sm font-medium text-ink"><button type="button" className="hover:underline" onClick={() => pick(d)}>{formatWeekdayDate(d)}</button></h3>}
        {ev.length > 0 && <ul className="space-y-2" aria-label="Events">{ev.map(eventRow)}</ul>}
        {(ml.length > 0 || tx.length > 0 || wi.length > 0) && (
          <ul className="space-y-1.5" aria-label="Tracker records (read-only)">
            {ml.map((m) => (
              <li key={m.id}><Link to={`/bulking?highlight=${m.id}`} className="flex items-center gap-3 rounded-2xl px-4 py-2 text-sm hover:bg-hover"><span className="size-2.5 shrink-0 rounded-full bg-fuel-mark" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink"><span className="capitalize">{m.mealType}</span> · {m.items.map((i) => i.foodName).join(', ')}</span><span className="text-xs text-ink-2 tnum">{formatKcal(mealTotals(m).caloriesKcal)}</span></Link></li>
            ))}
            {tx.map((x) => (
              <li key={x.id}><Link to={`/budget?highlight=${x.id}`} className="flex items-center gap-3 rounded-2xl px-4 py-2 text-sm hover:bg-hover"><span className="size-2.5 shrink-0 rounded-full bg-money-mark" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink">{x.description}</span><span className="text-xs text-ink-2 tnum">{x.type === 'expense' ? '−' : '+'}{formatRupees(x.amount)}</span></Link></li>
            ))}
            {wi.map((w) => (
              <li key={w.id}><Link to={`/bulking?highlight=${w.id}`} className="flex items-center gap-3 rounded-2xl px-4 py-2 text-sm hover:bg-hover"><span className="size-2.5 shrink-0 rounded-full bg-weight-mark" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink">Weigh-in</span><span className="text-xs text-ink-2 tnum">{formatWeight(w.weightKg, t.settings?.weightUnit ?? 'kg')}</span></Link></li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Calendar"
        description="Your own events next to your meals, spending and weigh-ins. Those records are shown here but are edited on their own pages."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setCustomize(true)}><Settings2 className="size-4" aria-hidden />Customize</Button>
            <Button size="sm" onClick={goToday}>Today</Button>
            <Button size="sm" variant="primary" onClick={openNew}><Plus className="size-4" aria-hidden />New event</Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="Previous month" onClick={() => go(addMonths(activeMonth, -1))}><ChevronLeft className="size-5" aria-hidden /></Button>
                <h2 className="min-w-36 text-center text-base font-medium text-ink" aria-live="polite">{formatMonthLabel(activeMonth)}</h2>
                <Button size="icon-sm" variant="ghost" aria-label="Next month" onClick={() => go(addMonths(activeMonth, 1))}><ChevronRight className="size-5" aria-hidden /></Button>
              </div>
              <Segmented<CalendarView> label="Calendar view" size="sm" value={activeView} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} />
            </div>

            {activeView === 'month' ? (
              <div>
                <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-ink-2" aria-hidden>
                  {weekdayOrder(prefs.weekStart).map((w) => <div key={w} className="py-1">{WEEKDAY_SHORT[w]}</div>)}
                </div>
                <div role="grid" aria-label={formatMonthLabel(activeMonth)} className="grid grid-cols-7 gap-1">
                  {grid.flat().map((d) => {
                    const info = days.get(d);
                    const inMonth = monthKeyOf(d) === activeMonth;
                    const isToday = d === today;
                    const isSel = d === activeDate;
                    const label = `${formatWeekdayDate(d)}${isToday ? ', today' : ''}${info ? `: ${[info.events.length && `${info.events.length} event${info.events.length === 1 ? '' : 's'}`, info.meals && `${info.meals} meal${info.meals === 1 ? '' : 's'}`, info.spend && `${info.spend} transaction${info.spend === 1 ? '' : 's'}`, info.weight && 'weigh-in'].filter(Boolean).join(', ')}` : ''}`;
                    return (
                      <button
                        key={d}
                        type="button"
                        role="gridcell"
                        aria-label={label}
                        aria-selected={isSel}
                        aria-current={isToday ? 'date' : undefined}
                        onClick={() => pick(d)}
                        onDoubleClick={() => { pick(d); openNew(); }}
                        className={cn('flex min-h-14 flex-col items-center gap-1 rounded-2xl border-2 px-1 py-1.5 text-sm transition-colors sm:min-h-24 sm:items-stretch sm:px-2', isSel ? 'bg-primary-container text-on-primary-container' : 'hover:bg-hover', inMonth ? 'text-ink' : 'text-ink-3')}
                        style={{ borderColor: isToday ? accent : 'transparent' }}
                      >
                        <span className={cn('tnum text-sm sm:text-[13px]', isToday && 'font-semibold')}>{Number(d.slice(8))}</span>
                        <span className="hidden min-w-0 flex-1 flex-col gap-0.5 text-left sm:flex">
                          {info?.events.slice(0, 2).map((e) => <span key={e.id} className="truncate rounded-md px-1 text-[11px] leading-4" style={{ backgroundColor: `color-mix(in srgb, ${e.origin === 'google' ? 'var(--protein-mark)' : accent} 22%, transparent)` }}>{e.title}</span>)}
                          {info && info.events.length > 2 && <span className="px-1 text-[11px] text-ink-2">+{info.events.length - 2} more</span>}
                        </span>
                        <span className="flex h-2 items-center justify-center gap-1 sm:justify-start" aria-hidden>
                          {info?.events.length ? <span className="size-1.5 rounded-full sm:hidden" style={{ backgroundColor: accent }} /> : null}
                          {info?.meals ? <span className="size-1.5 rounded-full bg-fuel-mark" /> : null}
                          {info?.spend ? <span className="size-1.5 rounded-full bg-money-mark" /> : null}
                          {info?.weight ? <span className="size-1.5 rounded-full bg-weight-mark" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-ink-2" aria-label="Legend">
                  <li className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: accent }} />Events</li>
                  <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-fuel-mark" />Meals</li>
                  <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-money-mark" />Spending</li>
                  <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-weight-mark" />Weigh-ins</li>
                </ul>
              </div>
            ) : (
              <div className="space-y-5">
                {grid.flat().filter((d) => monthKeyOf(d) === activeMonth).map((d) => dayDetails(d, true)).filter(Boolean).length === 0 ? (
                  <EmptyState icon={CalendarDays} title="Nothing this month" description="Add an event, or log meals, spending or weigh-ins, and they show up here." action={<Button size="sm" variant="primary" onClick={openNew}>New event</Button>} compact />
                ) : (
                  grid.flat().filter((d) => monthKeyOf(d) === activeMonth).map((d) => dayDetails(d, true))
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-medium text-ink">{formatWeekdayDate(activeDate)}</h2>
                <Button size="sm" variant="subtle" onClick={openNew}><Plus className="size-4" aria-hidden />Add</Button>
              </div>
              {dayEmpty ? (
                <p className="text-sm text-ink-2">Nothing on this day.</p>
              ) : (
                <>
                  {dayEvents.length > 0 && <ul className="space-y-2" aria-label="Events">{dayEvents.map(eventRow)}</ul>}
                  {(shownMeals.length > 0 || shownTx.length > 0 || shownWeights.length > 0) && (
                    <div className="space-y-1">
                      <p className="px-1 pt-1 text-xs font-medium text-ink-2">From your tracker · read-only</p>
                      <ul className="space-y-1.5">
                        {shownMeals.map((m) => <li key={m.id}><Link to={`/bulking?highlight=${m.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm hover:bg-hover"><span className="size-2.5 shrink-0 rounded-full bg-fuel-mark" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink"><span className="capitalize">{m.mealType}</span> · {m.items.map((i) => i.foodName).join(', ')}</span><span className="text-xs text-ink-2 tnum">{formatKcal(mealTotals(m).caloriesKcal)}</span></Link></li>)}
                        {shownTx.map((x) => <li key={x.id}><Link to={`/budget?highlight=${x.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm hover:bg-hover"><span className="size-2.5 shrink-0 rounded-full bg-money-mark" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink">{x.description}</span><span className="text-xs text-ink-2 tnum">{x.type === 'expense' ? '−' : '+'}{formatRupees(x.amount)}</span></Link></li>)}
                        {shownWeights.map((w) => <li key={w.id}><Link to={`/bulking?highlight=${w.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm hover:bg-hover"><span className="size-2.5 shrink-0 rounded-full bg-weight-mark" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink">Weigh-in</span><span className="text-xs text-ink-2 tnum">{formatWeight(w.weightKg, t.settings?.weightUnit ?? 'kg')}</span></Link></li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
          <GoogleCalendarCard onSynced={() => void t.refresh().catch(() => undefined)} />
        </div>
      </div>

      <EventDialog open={editing !== null} event={editing?.event ?? null} date={activeDate} tz={tz} saving={saving} error={formError} onSave={(i) => void save(i)} onDelete={() => setConfirmDelete(true)} onClose={() => !saving && setEditing(null)} />
      <ConfirmDialog open={confirmDelete} title="Delete this event?" description="Only this event is deleted. Your meals, spending and weigh-ins are not affected, and nothing is deleted from Google Calendar. You can undo right after." confirmLabel="Delete" loading={saving} onConfirm={() => void remove()} onClose={() => !saving && setConfirmDelete(false)} />
      <CalendarPrefsDialog open={customize} prefs={prefs} onChange={(p) => void savePrefs(p)} onClose={() => setCustomize(false)} />
    </PageContainer>
  );
}

