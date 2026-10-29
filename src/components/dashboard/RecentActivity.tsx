import { Banknote, Scale, UtensilsCrossed, Wallet } from "lucide-react";
import type { ComponentType } from "react";
import type { ActivityItem, ActivityType } from "@/types/domain";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { formatCurrency, formatRelativeTime } from "@/lib/formatting";
import { History } from "lucide-react";

const TYPE_ICON: Record<ActivityType, ComponentType<{ size?: number; className?: string }>> = {
  meal: UtensilsCrossed,
  expense: Wallet,
  income: Banknote,
  weight: Scale,
};

const TYPE_STYLE: Record<ActivityType, string> = {
  meal: "bg-warning-50 text-warning-500 dark:bg-warning-500/10",
  expense: "bg-[var(--surface-sunken)] text-[var(--text-secondary)]",
  income: "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500",
  weight: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400",
};

export function RecentActivity({ items, loading = false }: { items: ActivityItem[]; loading?: boolean }) {
  return (
    <Card>
      <CardHeader icon={<History size={18} />} title="Recent activity" subtitle="Everything you've logged, in one timeline" />
      <CardBody>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : items.length === 0 ? (
          <EmptyState title="No activity yet" description="Log a meal, expense or weigh-in to see it appear here." />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {items.map((item) => {
              const Icon = TYPE_ICON[item.type];
              return (
                <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TYPE_STYLE[item.type]}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">{item.subtitle}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {typeof item.amount === "number" && (
                      <p className={`text-sm font-semibold ${item.amount >= 0 ? "text-success-600 dark:text-success-500" : "text-[var(--text-primary)]"}`}>
                        {item.amount >= 0 ? "+" : "\u2212"}
                        {formatCurrency(Math.abs(item.amount))}
                      </p>
                    )}
                    <p className="text-xs text-[var(--text-tertiary)]">{formatRelativeTime(item.timestamp)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
