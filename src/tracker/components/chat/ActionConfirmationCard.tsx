import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleSlash, ExternalLink, Pencil, Scale, Utensils, ReceiptIndianRupee, HandCoins } from 'lucide-react';
import { Badge } from '@/tracker/components/ui/Badge';
import { Button } from '@/tracker/components/ui/Button';
import { MealForm, mealTypeLabel } from '@/tracker/components/bulking/MealForm';
import { WeighInEditDialog } from '@/tracker/components/bulking/WeightCheckIn';
import { TransactionForm } from '@/tracker/components/budget/TransactionForm';
import { describeFoodItem, mealTotals } from '@/tracker/features/meals/calculations';
import { categoryLabel } from '@/tracker/features/transactions/categories';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { formatRupees, formatSignedRupees } from '@/tracker/lib/formatting/currency';
import { dateKeyInTz, formatRelativeDay, formatTime, monthKeyInTz } from '@/tracker/lib/formatting/dates';
import { formatNumber, formatWeight } from '@/tracker/lib/formatting/nutrition';
import type { ActionPayload, AiActionResult, Meal, Transaction, WeighIn } from '@/tracker/types/domain';

function payloadOf(a: AiActionResult): ActionPayload | null {
  const d = a.data as { kind?: string } | undefined;
  return d && typeof d.kind === 'string' ? (a.data as unknown as ActionPayload) : null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="tnum min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

function Shell({ icon, title, status, children, footer }: { icon: ReactNode; title: string; status: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mt-3 w-full max-w-md overflow-hidden rounded-[24px] bg-surface ring-1 ring-line">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <span className="grid size-7 place-items-center rounded-md bg-sunken text-ink-2">{icon}</span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{title}</p>
        {status}
      </div>
      <div className="px-3.5 py-2">{children}</div>
      {footer && <div className="flex items-center gap-2 border-t border-line bg-sunken/40 px-2.5 py-2">{footer}</div>}
    </div>
  );
}

const SavedStatus = ({ updated }: { updated?: boolean }) => (
  <span className="flex items-center gap-1.5">
    <Badge tone="success" icon={<CheckCircle2 className="icon-pop-slow size-3" aria-hidden />}>
      {updated ? 'Updated' : 'Saved'}
    </Badge>
    <Badge tone="neutral" className="cursor-help" icon={undefined}>
      <span title="Local mode: this record is stored only in local app storage, not in the cloud.">Local</span>
    </Badge>
  </span>
);

const Gone = ({ what }: { what: string }) => (
  <p className="mt-2 flex items-center gap-2 text-xs text-ink-3">
    <CircleSlash className="size-3.5" aria-hidden />
    This {what} was deleted after it was saved.
  </p>
);

/** A compact, structured receipt for one assistant action. It reads the *live* record from the shared store. */
export function ActionConfirmationCard({ action }: { action: AiActionResult }) {
  const t = useTracker();
  const [edit, setEdit] = useState(false);
  const payload = payloadOf(action);
  const tz = t.timezone;
  const unit = t.settings?.weightUnit ?? 'kg';

  if (action.status !== 'succeeded') {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-ink-3">
        <CircleSlash className="size-3.5 shrink-0" aria-hidden />
        No changes were made{action.summary ? ` · ${action.summary}` : ''}
      </p>
    );
  }
  if (!payload || payload.kind === 'summary') {
    return <p className="mt-2 text-xs text-ink-3">Calculated from your saved records{action.summary ? ` · ${action.summary}` : ''}</p>;
  }

  if (payload.kind === 'transaction') {
    const tx: Transaction | undefined = t.transactions.find((x) => x.id === payload.transactionId);
    const Icon = tx?.type === 'income' ? HandCoins : ReceiptIndianRupee;
    return (
      <Shell
        icon={<Icon className="size-4" aria-hidden />}
        title={tx ? (tx.type === 'income' ? 'Income' : 'Expense') : 'Transaction'}
        status={tx ? <SavedStatus updated={payload.operation === 'updated'} /> : null}
        footer={
          tx && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
                <Pencil className="size-3.5" aria-hidden />
                Edit
              </Button>
              <Link to={`/budget?month=${monthKeyInTz(tx.occurredAt, tz)}&highlight=${tx.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
                <ExternalLink className="size-3.5" aria-hidden />
                View in Budget
              </Link>
            </>
          )
        }
      >
        {tx ? (
          <dl className="divide-y divide-line">
            <Row label="Description">{tx.description}</Row>
            <Row label="Category">{categoryLabel(tx.category)}</Row>
            <Row label="Amount">
              {payload.previousAmount != null && <span className="mr-2 text-ink-3 line-through">{formatRupees(payload.previousAmount)}</span>}
              <span className={tx.type === 'income' ? 'text-success' : undefined}>{formatSignedRupees(tx.amount, tx.type)}</span>
            </Row>
            <Row label="Date">{formatRelativeDay(dateKeyInTz(tx.occurredAt, tz), t.today)}</Row>
          </dl>
        ) : (
          <Gone what="transaction" />
        )}
        {tx && <TransactionForm open={edit} onClose={() => setEdit(false)} transaction={tx} />}
      </Shell>
    );
  }

  if (payload.kind === 'meal') {
    const meal: Meal | undefined = t.meals.find((x) => x.id === payload.mealId);
    const totals = meal ? mealTotals(meal) : null;
    return (
      <Shell
        icon={<Utensils className="size-4" aria-hidden />}
        title={meal ? mealTypeLabel(meal.mealType) : 'Meal'}
        status={meal ? <SavedStatus updated={payload.operation === 'updated'} /> : null}
        footer={
          meal && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
                <Pencil className="size-3.5" aria-hidden />
                Edit
              </Button>
              <Link to={`/bulking?date=${dateKeyInTz(meal.eatenAt, tz)}&highlight=${meal.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
                <ExternalLink className="size-3.5" aria-hidden />
                View in Bulking
              </Link>
            </>
          )
        }
      >
        {meal && totals ? (
          <>
            <ul className="divide-y divide-line">
              {meal.items.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate text-ink">{describeFoodItem(i)}</span>
                  <span className="tnum shrink-0 text-xs text-ink-2">
                    {i.caloriesKcal == null ? <span className="text-ink-3">no estimate</span> : `~${formatNumber(i.caloriesKcal)} kcal · ${Math.round((i.proteinG ?? 0) * 10) / 10} g`}
                  </span>
                </li>
              ))}
            </ul>
            <div className="tnum flex items-center justify-between border-t border-line py-2 text-sm">
              <span className="flex items-center gap-1.5 text-ink-3">
                Total <Badge tone="fuel">Estimated</Badge>
              </span>
              <span className="font-semibold text-ink">
                ~{formatNumber(totals.caloriesKcal)} kcal · ~{Math.round(totals.proteinG * 10) / 10} g protein
              </span>
            </div>
            <p className="pb-1 text-xs text-ink-3">
              {formatRelativeDay(dateKeyInTz(meal.eatenAt, tz), t.today)}, {formatTime(meal.eatenAt, tz)}
            </p>
          </>
        ) : (
          <Gone what="meal" />
        )}
        {meal && <MealForm open={edit} onClose={() => setEdit(false)} meal={meal} defaultDate={dateKeyInTz(meal.eatenAt, tz)} />}
      </Shell>
    );
  }

  const w: WeighIn | undefined = t.weighIns.find((x) => x.id === payload.weighInId);
  return (
    <Shell
      icon={<Scale className="size-4" aria-hidden />}
      title="Weight"
      status={w ? <SavedStatus updated={payload.operation === 'updated'} /> : null}
      footer={
        w && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Button>
            <Link to={`/bulking?date=${dateKeyInTz(w.recordedAt, tz)}&highlight=${w.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
              <ExternalLink className="size-3.5" aria-hidden />
              View in Bulking
            </Link>
          </>
        )
      }
    >
      {w ? (
        <dl className="divide-y divide-line">
          <Row label="Weight">{formatWeight(w.weightKg, unit)}</Row>
          <Row label="Date">{formatRelativeDay(dateKeyInTz(w.recordedAt, tz), t.today)}</Row>
        </dl>
      ) : (
        <Gone what="weight entry" />
      )}
      <WeighInEditDialog weighIn={edit ? (w ?? null) : null} onClose={() => setEdit(false)} />
    </Shell>
  );
}
