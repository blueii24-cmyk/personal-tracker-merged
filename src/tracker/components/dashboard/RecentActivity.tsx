import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { EmptyState } from '@/tracker/components/ui/EmptyState';
import { ActivityIcon } from '@/tracker/components/history/ActivityIcon';
import { describeActivity, recordLink } from '@/tracker/features/history/presentation';
import { formatTimestamp } from '@/tracker/lib/formatting/dates';
import { cn } from '@/tracker/lib/cn';
import type { ActivityEntry, WeightUnit } from '@/tracker/types/domain';

interface Props {
  entries: readonly ActivityEntry[];
  timezone: string;
  unit: WeightUnit;
  limit?: number;
}

/** A single timeline of meals, spending, income and weigh-ins, newest first. */
export function RecentActivity({ entries, timezone, unit, limit = 8 }: Props) {
  const rows = entries.slice(0, limit);
  if (rows.length === 0) {
    return <EmptyState compact icon={Activity} title="Nothing logged yet" description="Meals, expenses, income and weigh-ins will appear here as you add them." />;
  }
  return (
    <ol className="relative">
      <span aria-hidden className="absolute top-3 bottom-3 left-[17px] w-px bg-line" />
      {rows.map((e) => {
        const v = describeActivity(e, unit);
        return (
          <li key={`${e.kind}-${e.id}`} className="relative">
            <Link to={recordLink(e, timezone)} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-hover">
              <ActivityIcon kind={e.kind} className="relative ring-4 ring-surface" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{v.title}</p>
                <p className="truncate text-xs text-ink-3">{v.detail ? `${v.detail} · ` : ''}{formatTimestamp(e.at, timezone)}</p>
              </div>
              <p className={cn('tnum shrink-0 text-sm font-semibold', v.positive ? 'text-success' : 'text-ink')}>{v.value}</p>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
