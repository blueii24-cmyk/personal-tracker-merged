import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { addDays, addMonths, formatMonthLabel, formatRelativeDay, formatWeekdayDate, isDateKey, isMonthKey } from '@/tracker/lib/formatting/dates';
import type { DateKey, MonthKey } from '@/tracker/types/domain';

interface DateStepperProps {
  value: DateKey;
  today: DateKey;
  onChange: (d: DateKey) => void;
}
/** Previous/next day buttons around a native date picker. Future days are allowed only up to today. */
export function DateStepper({ value, today, onChange }: DateStepperProps) {
  const label = formatRelativeDay(value, today);
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Choose day">
      <Button variant="secondary" size="icon" onClick={() => onChange(addDays(value, -1))} aria-label="Previous day">
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <label className="relative flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 sm:min-w-40 sm:flex-none">
        <span className="pointer-events-none truncate">{label === 'Today' || label === 'Yesterday' ? `${label}, ${formatWeekdayDate(value)}` : formatWeekdayDate(value)}</span>
        <input
          type="date"
          value={value}
          max={today}
          onChange={(e) => isDateKey(e.target.value) && onChange(e.target.value)}
          aria-label="Pick a date"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <Button variant="secondary" size="icon" onClick={() => onChange(addDays(value, 1))} disabled={value >= today} aria-label="Next day">
        <ChevronRight className="size-4" aria-hidden />
      </Button>
      {value !== today && (
        <Button variant="ghost" size="md" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
    </div>
  );
}

interface MonthStepperProps {
  value: MonthKey;
  currentMonth: MonthKey;
  onChange: (m: MonthKey) => void;
}
export function MonthStepper({ value, currentMonth, onChange }: MonthStepperProps) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Choose month">
      <Button variant="secondary" size="icon" onClick={() => onChange(addMonths(value, -1))} aria-label="Previous month">
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <label className="relative flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 sm:min-w-40 sm:flex-none">
        <span className="pointer-events-none truncate">{formatMonthLabel(value)}</span>
        <input
          type="month"
          value={value}
          max={currentMonth}
          onChange={(e) => isMonthKey(e.target.value) && onChange(e.target.value)}
          aria-label="Pick a month"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <Button variant="secondary" size="icon" onClick={() => onChange(addMonths(value, 1))} disabled={value >= currentMonth} aria-label="Next month">
        <ChevronRight className="size-4" aria-hidden />
      </Button>
      {value !== currentMonth && (
        <Button variant="ghost" onClick={() => onChange(currentMonth)}>
          This month
        </Button>
      )}
    </div>
  );
}
