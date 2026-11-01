import { Check } from 'lucide-react';
import { Dialog } from '@/tracker/components/ui/Dialog';
import { Button } from '@/tracker/components/ui/Button';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { cn } from '@/tracker/lib/cn';
import { CALENDAR_ACCENTS, type CalendarAccent, type CalendarPrefs, type CalendarView, type WeekStart } from '@/tracker/types/calendar';

export const ACCENT_VAR: Record<CalendarAccent, string> = { primary: '--primary', fuel: '--fuel-mark', protein: '--protein-mark', weight: '--weight-mark' };
const ACCENT_LABEL: Record<CalendarAccent, string> = { primary: 'Blue', fuel: 'Orange', protein: 'Green', weight: 'Purple' };
const SHOW_LABEL: Array<[keyof CalendarPrefs['show'], string]> = [['events', 'My events'], ['google', 'Google Calendar events'], ['meals', 'Meals'], ['spending', 'Spending'], ['weight', 'Weigh-ins']];

export function CalendarPrefsDialog({ open, prefs, onChange, onClose }: { open: boolean; prefs: CalendarPrefs; onChange: (p: Partial<CalendarPrefs>) => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Customize calendar" description="Saved with your account and on this device." footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="space-y-5 text-sm">
        <div className="space-y-2">
          <p className="px-1 text-[13px] font-medium text-ink-2">Week starts on</p>
          <Segmented<`${WeekStart}`> label="Week starts on" value={`${prefs.weekStart}`} onChange={(v) => onChange({ weekStart: Number(v) as WeekStart })} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }, { value: '6', label: 'Saturday' }]} />
        </div>
        <div className="space-y-2">
          <p className="px-1 text-[13px] font-medium text-ink-2">Opens in</p>
          <Segmented<CalendarView> label="Default view" value={prefs.defaultView} onChange={(v) => onChange({ defaultView: v })} options={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} />
        </div>
        <fieldset className="space-y-1">
          <legend className="px-1 pb-1 text-[13px] font-medium text-ink-2">Show on the calendar</legend>
          {SHOW_LABEL.map(([k, label]) => (
            <label key={k} className="flex items-center gap-3 rounded-xl px-2 py-2 text-ink hover:bg-hover">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={prefs.show[k]} onChange={(e) => onChange({ show: { ...prefs.show, [k]: e.target.checked } })} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          <p className="px-1 text-[13px] font-medium text-ink-2">Accent for today and your events</p>
          <div role="radiogroup" aria-label="Accent colour" className="flex gap-3">
            {CALENDAR_ACCENTS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={prefs.accent === a} aria-label={ACCENT_LABEL[a]} title={ACCENT_LABEL[a]} onClick={() => onChange({ accent: a })} className={cn('grid size-10 place-items-center rounded-full border-2 transition-shadow', prefs.accent === a ? 'border-ink' : 'border-transparent hover:border-line-strong')} style={{ backgroundColor: `var(${ACCENT_VAR[a]})` }}>
                {prefs.accent === a && <Check className="size-4 text-on-ink" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
