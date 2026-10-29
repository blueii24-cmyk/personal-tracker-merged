import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, HelpCircle, Scale, UtensilsCrossed, Wallet } from "lucide-react";
import type { ChatActionResult } from "@/types/domain";
import { Badge } from "@/components/ui/Feedback";
import { formatCurrency, formatGrams, formatKcal, relativeDayLabel, formatWeight } from "@/lib/formatting";

export function ActionConfirmationCard({ action }: { action: ChatActionResult }) {
  if (action.kind === "unsupported") {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
        <HelpCircle size={14} className="mt-0.5 shrink-0" />
        <span>No record was saved \u2014 I need a bit more detail to log this.</span>
      </div>
    );
  }

  if (action.kind === "meal-logged" && action.meal) {
    const meal = action.meal;
    return (
      <div className="mt-2 w-full max-w-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3.5 shadow-soft">
        <CardTitle icon={<UtensilsCrossed size={14} />} title={`Meal \u00b7 ${capitalize(meal.type)}`} />
        <ul className="mt-2 flex flex-col gap-1">
          {meal.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span className="truncate pr-2">
                {item.name} <span className="text-[var(--text-tertiary)]">({item.quantity})</span>
              </span>
              <span className="shrink-0">{formatKcal(item.calories)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2.5 text-sm">
          <span className="font-medium text-[var(--text-primary)]">
            ~{formatKcal(meal.totalCalories)} \u00b7 {formatGrams(meal.totalProtein)} protein
          </span>
          <StatusBadge mock={action.mock} />
        </div>
        <ViewLink href="/bulking" label="View in Bulking" />
      </div>
    );
  }

  if ((action.kind === "expense-logged" || action.kind === "income-logged") && action.transaction) {
    const txn = action.transaction;
    const isIncome = txn.type === "income";
    return (
      <div className="mt-2 w-full max-w-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3.5 shadow-soft">
        <CardTitle icon={<Wallet size={14} />} title={isIncome ? "Income" : "Transaction"} />
        <dl className="mt-2 flex flex-col gap-1.5 text-xs">
          <Row label="Category" value={txn.category} />
          <Row
            label="Amount"
            value={`${isIncome ? "+" : "\u2212"}${formatCurrency(txn.amount)}`}
            valueClassName={isIncome ? "text-success-600 dark:text-success-500 font-semibold" : "font-semibold text-[var(--text-primary)]"}
          />
          <Row label="Date" value={relativeDayLabel(`${txn.date}T00:00:00`)} />
        </dl>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2.5">
          <span className="text-xs text-[var(--text-tertiary)]">{txn.description}</span>
          <StatusBadge mock={action.mock} />
        </div>
        <ViewLink href="/budget" label="View in Budget" />
      </div>
    );
  }

  if (action.kind === "weight-logged" && action.weighIn) {
    const w = action.weighIn;
    return (
      <div className="mt-2 w-full max-w-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3.5 shadow-soft">
        <CardTitle icon={<Scale size={14} />} title="Weight check-in" />
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-[var(--text-primary)]">{formatWeight(w.weightKg)}</span>
          <StatusBadge mock={action.mock} />
        </div>
        <ViewLink href="/bulking" label="View in Bulking" />
      </div>
    );
  }

  return null;
}

function CardTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
      {icon}
      {title}
    </div>
  );
}

function Row({ label, value, valueClassName = "text-[var(--text-primary)]" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--text-tertiary)]">{label}</dt>
      <dd className={valueClassName}>{value}</dd>
    </div>
  );
}

function StatusBadge({ mock }: { mock: boolean }) {
  return (
    <Badge tone="success">
      <CheckCircle2 size={12} />
      {mock ? "Saved (demo)" : "Saved"}
    </Badge>
  );
}

function ViewLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
    >
      {label} <ArrowRight size={12} />
    </Link>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
