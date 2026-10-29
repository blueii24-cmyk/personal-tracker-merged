"use client";

import {
  Banknote,
  Bus,
  Clapperboard,
  GraduationCap,
  Pencil,
  Repeat,
  ShoppingBag,
  Smartphone,
  Trash2,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import type { Transaction } from "@/types/domain";
import { EmptyState } from "@/components/ui/Feedback";
import { formatCurrency, formatDateLabel, relativeDayLabel } from "@/lib/formatting";

const CATEGORY_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  Food: UtensilsCrossed,
  Transport: Bus,
  "Mobile recharge": Smartphone,
  College: GraduationCap,
  Shopping: ShoppingBag,
  Subscriptions: Repeat,
  Entertainment: Clapperboard,
  "Pocket money": Wallet,
  Salary: Banknote,
  Freelance: Banknote,
  Gift: Wallet,
  Other: Wallet,
};

export function TransactionList({
  transactions,
  onEdit,
  onDelete,
  emptyMessage = "No transactions found.",
  showRelativeDate = true,
}: {
  transactions: Transaction[];
  onEdit?: (txn: Transaction) => void;
  onDelete?: (txn: Transaction) => void;
  emptyMessage?: string;
  showRelativeDate?: boolean;
}) {
  if (transactions.length === 0) {
    return <EmptyState icon={<Wallet size={20} />} title="Nothing here yet" description={emptyMessage} />;
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
      {transactions.map((txn) => {
        const Icon = CATEGORY_ICONS[txn.category] ?? Wallet;
        const isIncome = txn.type === "income";
        return (
          <li key={txn.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                isIncome
                  ? "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500"
                  : "bg-[var(--surface-sunken)] text-[var(--text-secondary)]"
              }`}
            >
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">{txn.description}</p>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                {txn.category} \u00b7 {showRelativeDate ? relativeDayLabel(`${txn.date}T00:00:00`) : formatDateLabel(txn.date)}
                {txn.source === "ai" && " \u00b7 AI logged"}
              </p>
            </div>
            <span className={`shrink-0 text-sm font-semibold ${isIncome ? "text-success-600 dark:text-success-500" : "text-[var(--text-primary)]"}`}>
              {isIncome ? "+" : "\u2212"}
              {formatCurrency(txn.amount)}
            </span>
            {(onEdit || onDelete) && (
              <div className="flex shrink-0 items-center gap-0.5">
                {onEdit && (
                  <button
                    type="button"
                    aria-label="Edit transaction"
                    onClick={() => onEdit(txn)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    aria-label="Delete transaction"
                    onClick={() => onDelete(txn)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-danger-50 hover:text-danger-500"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
