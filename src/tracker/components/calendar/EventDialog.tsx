import { useState, type FormEvent } from 'react';
import { Dialog } from '@/tracker/components/ui/Dialog';
import { Button } from '@/tracker/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/tracker/components/ui/Input';
import { validateEventInput } from '@/tracker/features/calendar/calendar';
import { dateKeyInTz, formatFullDate, timeKeyInTz } from '@/tracker/lib/formatting/dates';
import { CALENDAR_CATEGORIES, CALENDAR_CATEGORY_LABELS, type CalendarCategory, type CalendarEvent, type CalendarEventInput } from '@/tracker/types/calendar';

interface Props {
  open: boolean;
  event: CalendarEvent | null;
  date: string;
  tz: string;
  saving: boolean;
  error: string | null;
  onSave: (input: CalendarEventInput) => void;
  onDelete: () => void;
  onClose: () => void;
}

const blank = (date: string): CalendarEventInput => ({ title: '', notes: null, location: null, allDay: false, startDate: date, endDate: date, startTime: '09:00', endTime: '10:00', category: 'personal' });

function fromEvent(e: CalendarEvent, tz: string): CalendarEventInput {
  return {
    title: e.title, notes: e.notes, location: e.location, allDay: e.allDay, category: e.category,
    startDate: e.startsAt ? dateKeyInTz(e.startsAt, tz) : e.startDate,
    endDate: e.endsAt ? dateKeyInTz(e.endsAt, tz) : e.endDate,
    startTime: e.startsAt ? timeKeyInTz(e.startsAt, tz) : '09:00',
    endTime: e.endsAt ? timeKeyInTz(e.endsAt, tz) : '10:00',
  };
}

function EventFormBody({ event, date, tz, error, onSave }: Pick<Props, 'event' | 'date' | 'tz' | 'error' | 'onSave'>) {
  const [f, setF] = useState<CalendarEventInput>(() => (event ? fromEvent(event, tz) : blank(date)));
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof CalendarEventInput>(k: K, v: CalendarEventInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const p = validateEventInput(f, tz);
    setProblem(p);
    if (!p) onSave(f);
  };
  return (
    <form id="event-form" onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Title">{(a) => <Input id={a.id} className="h-11" maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus aria-invalid={a.invalid} />}</Field>
      <label className="flex items-center gap-3 px-1 text-sm text-ink">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={f.allDay} onChange={(e) => set('allDay', e.target.checked)} />
        All day
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">{(a) => <Input id={a.id} type="date" className="h-11" value={f.startDate} onChange={(e) => { set('startDate', e.target.value); if (e.target.value > f.endDate) set('endDate', e.target.value); }} />}</Field>
        {!f.allDay && <Field label="Start time">{(a) => <Input id={a.id} type="time" className="h-11" value={f.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} />}</Field>}
        <Field label="Ends">{(a) => <Input id={a.id} type="date" className="h-11" value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.target.value)} />}</Field>
        {!f.allDay && <Field label="End time">{(a) => <Input id={a.id} type="time" className="h-11" value={f.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} />}</Field>}
      </div>
      <Field label="Category">
        {(a) => (
          <Select id={a.id} className="h-11" value={f.category} onChange={(e) => set('category', e.target.value as CalendarCategory)}>
            {CALENDAR_CATEGORIES.map((c) => <option key={c} value={c}>{CALENDAR_CATEGORY_LABELS[c]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Location" optional>{(a) => <Input id={a.id} className="h-11" maxLength={300} value={f.location ?? ''} onChange={(e) => set('location', e.target.value || null)} />}</Field>
      <Field label="Notes" optional>{(a) => <Textarea id={a.id} rows={3} maxLength={4000} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} className="py-3" />}</Field>
      <p aria-live="polite" className="min-h-5 text-sm text-danger" role={problem || error ? 'alert' : undefined}>{problem ?? error}</p>
    </form>
  );
}

export function EventDialog({ open, event, date, tz, saving, error, onSave, onDelete, onClose }: Props) {
  const readOnly = Boolean(event && (event.origin === 'google' || event.readOnly));
  if (readOnly && event) {
    return (
      <Dialog open={open} onClose={onClose} title={event.title} description="From Google Calendar. It can only be changed in Google Calendar." footer={<Button onClick={onClose}>Close</Button>}>
        <dl className="space-y-2 text-sm">
          <div><dt className="text-xs text-ink-3">When</dt><dd className="text-ink">{event.allDay ? `${formatFullDate(event.startDate)}${event.endDate !== event.startDate ? ` – ${formatFullDate(event.endDate)}` : ''} · all day` : `${formatFullDate(dateKeyInTz(event.startsAt!, tz))}, ${timeKeyInTz(event.startsAt!, tz)}–${timeKeyInTz(event.endsAt!, tz)}`}</dd></div>
          {event.location && <div><dt className="text-xs text-ink-3">Where</dt><dd className="text-ink">{event.location}</dd></div>}
          {event.notes && <div><dt className="text-xs text-ink-3">Notes</dt><dd className="whitespace-pre-wrap text-ink">{event.notes}</dd></div>}
        </dl>
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={saving}
      title={event ? 'Edit event' : 'New event'}
      description="Your own events. They never change your meals, spending or weigh-ins."
      footer={
        <>
          {event && <Button variant="ghost" className="mr-auto text-danger" onClick={onDelete} disabled={saving}>Delete</Button>}
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" type="submit" form="event-form" loading={saving}>Save</Button>
        </>
      }
    >
      {open && <EventFormBody key={event?.id ?? `new-${date}`} event={event} date={date} tz={tz} error={error} onSave={onSave} />}
    </Dialog>
  );
}
