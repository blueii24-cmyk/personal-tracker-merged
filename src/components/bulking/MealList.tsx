"use client";

import { Coffee, Moon, Pencil, Soup, Sun, Trash2, UtensilsCrossed } from "lucide-react";
import type { ComponentType } from "react";
import type { Meal, MealType } from "@/types/domain";
import { EmptyState } from "@/components/ui/Feedback";
import { Badge } from "@/components/ui/Feedback";
import { formatGrams, formatKcal, formatTime } from "@/lib/formatting";

const MEAL_ICONS: Record<MealType, ComponentType<{ size?: number; className?: string }>> = {
  breakfast: Coffee,
  lunch: Sun,
  dinner: Moon,
  snack: Soup,
};

export function MealList({
  meals,
  onEdit,
  onDelete,
  emptyMessage = "No meals logged yet. Use the AI chat or the log meal button to add one.",
}: {
  meals: Meal[];
  onEdit?: (meal: Meal) => void;
  onDelete?: (meal: Meal) => void;
  emptyMessage?: string;
}) {
  if (meals.length === 0) {
    return <EmptyState icon={<UtensilsCrossed size={20} />} title="No meals yet" description={emptyMessage} />;
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
      {meals.map((meal) => {
        const Icon = MEAL_ICONS[meal.type];
        return (
          <li key={meal.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-secondary)]">
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-medium capitalize text-[var(--text-primary)]">{meal.type}</p>
                <span className="text-xs text-[var(--text-tertiary)]">{formatTime(meal.loggedAt)}</span>
                {meal.source === "ai" && <Badge tone="brand">AI logged</Badge>}
              </div>
              <p className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
                {meal.items.map((i) => `${i.name} (${i.quantity})`).join(", ")}
              </p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                ~{formatKcal(meal.totalCalories)} \u00b7 {formatGrams(meal.totalProtein)} protein
              </p>
            </div>
            {(onEdit || onDelete) && (
              <div className="flex shrink-0 items-center gap-1">
                {onEdit && (
                  <button
                    type="button"
                    aria-label="Edit meal"
                    onClick={() => onEdit(meal)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    aria-label="Delete meal"
                    onClick={() => onDelete(meal)}
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
