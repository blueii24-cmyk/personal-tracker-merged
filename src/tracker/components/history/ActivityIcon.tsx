import { HandCoins, ReceiptIndianRupee, Scale, Utensils, type LucideIcon } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';
import type { ActivityKind } from '@/tracker/types/domain';

export const ACTIVITY_META: Record<ActivityKind, { label: string; icon: LucideIcon; tone: string }> = {
  meal: { label: 'Meal', icon: Utensils, tone: 'bg-fuel-soft text-fuel' },
  expense: { label: 'Expense', icon: ReceiptIndianRupee, tone: 'bg-money-soft text-money' },
  income: { label: 'Income', icon: HandCoins, tone: 'bg-success-soft text-success' },
  weight: { label: 'Weight', icon: Scale, tone: 'bg-weight-soft text-weight' },
};

export function ActivityIcon({ kind, className }: { kind: ActivityKind; className?: string }) {
  const { icon: Icon, tone, label } = ACTIVITY_META[kind];
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', tone, className)} title={label}>
      <Icon className="size-[17px]" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
