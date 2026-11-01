import { useMemo } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/tracker/components/ui/Badge';
import { Button } from '@/tracker/components/ui/Button';
import { CATEGORY_META } from '@/tracker/features/transactions/categories';
import { formatRupees, formatSignedRupees, sumMoney } from '@/tracker/lib/formatting/currency';
import { dateKeyInTz, formatRelativeDay, formatTime } from '@/tracker/lib/formatting/dates';
import { cn } from '@/tracker/lib/cn';
import type { Transaction } from '@/tracker/types/domain';

interface Props {
  transactions: readonly Transaction[];
  timezone: string;
  today: string;
  highlightId?: string | null;
  onEdit: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  /** Group rows under day headings (default). */
  grouped?: boolean;
}

export function TransactionRow({ t, timezone, highlightId, onEdit, onDelete }: { t: Transaction; timezone: string; highlightId?: string | null; onEdit?: () => void; onDelete?: () => void }) {
  const meta = CATEGORY_META[t.category];
  const Icon = meta.icon;
  return (
    <li data-record-id={t.id} className={cn('group flex items-center gap-3 py-3', highlightId === t.id && 'flash-highlight -mx-2 rounded-md px-2')}>
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', t.type === 'income' ? 'bg-success-soft text-success' : 'bg-sunken text-ink-2')}>
        <Icon className="size-[17px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{t.description}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
          <span>{meta.label}</span>
          <span aria-hidden>·</span>
          <span>{formatTime(t.occurredAt, timezone)}</span>
          {t.source === 'ai' && <Badge className="ml-1 py-0">AI</Badge>}
          {t.notes && <span className="truncate italic">· {t.notes}</span>}
        </p>
      </div>
      <p className={cn('tnum shrink-0 text-sm font-semibold', t.type === 'income' ? 'text-success' : 'text-ink')}>{formatSignedRupees(t.amount, t.type)}</p>
      {(onEdit || onDelete) && (
        <div className="-mr-1 flex shrink-0">
          {onEdit && (
            <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${t.description}`}>
              <Pencil className="size-4" aria-hidden />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${t.description}`} className="hover:text-danger">
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function TransactionList({ transactions, timezone, today, highlightId, onEdit, onDelete, grouped = true }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const k = dateKeyInTz(t.occurredAt, timezone);
      const arr = map.get(k);
      if (arr) arr.push(t);
      else map.set(k, [t]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [transactions, timezone]);

  if (!grouped) {
    return (
      <ul className="divide-y divide-line">
        {transactions.map((t) => (
          <TransactionRow key={t.id} t={t} timezone={timezone} highlightId={highlightId} onEdit={() => onEdit(t)} onDelete={() => onDelete(t)} />
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-5">
      {groups.map(([day, list]) => {
        const net = sumMoney(list.map((t) => (t.type === 'expense' ? -t.amount : t.amount)));
        return (
          <section key={day} aria-label={formatRelativeDay(day, today)}>
            <div className="flex items-baseline justify-between border-b border-line pb-1.5">
              <h3 className="text-[13px] font-semibold text-ink">{formatRelativeDay(day, today)}</h3>
              <p className="tnum text-xs text-ink-3">
                Net {net < 0 ? '−' : net > 0 ? '+' : ''}
                {formatRupees(Math.abs(net))}
              </p>
            </div>
            <ul className="divide-y divide-line">
              {list.map((t) => (
                <TransactionRow key={t.id} t={t} timezone={timezone} highlightId={highlightId} onEdit={() => onEdit(t)} onDelete={() => onDelete(t)} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
