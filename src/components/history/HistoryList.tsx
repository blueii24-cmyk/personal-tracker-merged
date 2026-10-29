"use client";

import Link from "next/link";
import { Banknote, Pencil, Scale, Trash2, UtensilsCrossed, Wallet } from "lucide-react";
import type { ComponentType } from "react";
import { EmptyState } from "@/components/ui/Feedback";
import { Badge } from "@/components/ui/Feedback";
import { formatCurrency, formatDateTime } from "@/lib/formatting";

export type EntryType = "meal" | "expense" | "income" | "weight";
export type EntryTypeFilter = EntryType | "all";

export interface HistoryEntry {
  id: string;
  type: EntryType;
  title: string;
  subtitle: string;
  category?: string;
  amount?: number;
  timestamp: string;
  date: string;
  href: string;
  editable: boolean;
}

const TYPE_ICON: Record<EntryType, ComponentType<{ size?: number; className?: string }>> = {
  meal: UtensilsCrossed,
  expense: Wallet,
  income: Banknote,
  weight: Scale,
};

const TYPE_STYLE: Record<EntryType, string> = {
  meal: "bg-warning-50 text-warning-500 dark:bg-warning-500/10",
  expense: "bg-[var(--surface-sunken)] text-[var(--text-secondary)]",
  income: "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500",
  weight: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400",
};

export function HistoryList({
  entries,
  onEdit,
  onDelete,
}: {
  entries: HistoryEntry[];
  onEdit: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No records match your filters"
        description="Try adjusting the search, date range or category filters above."
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
      {entries.map((entry) => {
        const Icon = TYPE_ICON[entry.type];
        return (
          <li key={entry.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TYPE_STYLE[entry.type]}`}>
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={entry.href} className="truncate text-sm font-medium text-[var(--text-primary)] hover:underline">
                  {entry.title}
                </Link>
                {entry.category && <Badge>{entry.category}</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{entry.subtitle}</p>
              <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{formatDateTime(entry.timestamp)}</p>
            </div>
            {typeof entry.amount === "number" && (
              <span
                className={`shrink-0 text-sm font-semibold ${
                  entry.amount >= 0 ? "text-success-600 dark:text-success-500" : "text-[var(--text-primary)]"
                }`}
              >
                {entry.amount >= 0 ? "+" : "\u2212"}
                {formatCurrency(Math.abs(entry.amount))}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              {entry.editable && (
                <button
                  type="button"
                  aria-label="Edit record"
                  onClick={() => onEdit(entry)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                >
                  <Pencil size={14} />
                </button>
              )}
              <button
                type="button"
                aria-label="Delete record"
                onClick={() => onDelete(entry)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-danger-50 hover:text-danger-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}


