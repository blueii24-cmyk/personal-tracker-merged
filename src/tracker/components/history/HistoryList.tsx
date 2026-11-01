import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { describeActivity, recordLink } from '@/tracker/features/history/presentation';
import { dateKeyInTz, formatLongDate, formatRelativeDay, formatTime } from '@/tracker/lib/formatting/dates';
import { cn } from '@/tracker/lib/cn';
import type { ActivityEntry, WeightUnit } from '@/tracker/types/domain';
import { ActivityIcon } from './ActivityIcon';

interface Props {
  entries: readonly ActivityEntry[];
  timezone: string;
  today: string;
  unit: WeightUnit;
  onEdit: (e: ActivityEntry) => void;
  onDelete: (e: ActivityEntry) => void;
}

export function HistoryList({ entries, timezone, today, unit, onEdit, onDelete }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const e of entries) {
      const k = dateKeyInTz(e.at, timezone);
      const a = map.get(k);
      if (a) a.push(e);
      else map.set(k, [e]);
    }
    return [...map.entries()];
  }, [entries, timezone]);

  return (
    <div className="space-y-6">
      {groups.map(([day, list]) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h2 id={`day-${day}`} className="sticky top-0 z-10 -mx-1 mb-1 flex items-baseline gap-2 bg-surface/95 px-1 py-2 backdrop-blur">
            <span className="text-sm font-semibold text-ink">{formatRelativeDay(day, today)}</span>
            <span className="text-xs text-ink-3">{formatLongDate(day)}</span>
          </h2>
          <ul className="divide-y divide-line">
            {list.map((e) => {
              const v = describeActivity(e, unit);
              const label = `${v.title}${v.detail ? `, ${v.detail}` : ''}`;
              return (
                <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 py-3">
                  <ActivityIcon kind={e.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{v.title}</p>
                    <p className="truncate text-xs text-ink-3">
                      {formatTime(e.at, timezone)}
                      {v.detail ? ` · ${v.detail}` : ''}
                    </p>
                  </div>
                  <p className={cn('tnum shrink-0 text-right text-sm font-semibold', v.positive ? 'text-success' : 'text-ink')}>{v.value}</p>
                  <div className="-mr-1 flex shrink-0">
                    <Link to={recordLink(e, timezone)} aria-label={`Open ${label} in ${e.kind === 'meal' || e.kind === 'weight' ? 'Bulking' : 'Budget'}`} title="Open in context" className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                      <ExternalLink className="size-4" aria-hidden />
                    </Link>
                    <Button variant="ghost" size="icon-sm" onClick={() => onEdit(e)} aria-label={`Edit ${label}`}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => onDelete(e)} aria-label={`Delete ${label}`} className="hover:text-danger">
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
