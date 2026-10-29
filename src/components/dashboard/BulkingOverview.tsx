"use client";

import Link from "next/link";
import { useState } from "react";
import { Flame, Plus, Scale, TrendingDown, TrendingUp, UtensilsCrossed } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { NutritionProgress } from "@/components/bulking/NutritionProgress";
import { WeightChart } from "@/components/bulking/WeightChart";
import { MealList } from "@/components/bulking/MealList";
import { MealForm } from "@/components/bulking/MealForm";
import { WeighInForm } from "@/components/bulking/WeighInForm";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { formatWeight } from "@/lib/formatting";

export function BulkingOverview() {
  const { summary, summaryLoading, settings } = useTrackerStore();
  const [mealFormOpen, setMealFormOpen] = useState(false);
  const [weighInOpen, setWeighInOpen] = useState(false);

  const weightUnit = settings?.weightUnit ?? "kg";

  return (
    <Card>
      <CardHeader
        icon={<UtensilsCrossed size={18} />}
        title="Bulking overview"
        subtitle="Nutrition estimates based on what you've logged today"
        action={
          <Button size="sm" onClick={() => setMealFormOpen(true)}>
            <Plus size={14} /> Log meal
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-5">
        {summaryLoading || !summary ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <NutritionProgress
              caloriesConsumed={summary.caloriesConsumed}
              calorieTarget={summary.calorieTarget}
              proteinConsumed={summary.proteinConsumed}
              proteinTarget={summary.proteinTarget}
            />

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-secondary)]">
                  <Scale size={16} />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-tertiary)]">Current weight</p>
                  <p className="text-base font-semibold text-[var(--text-primary)]">
                    {summary.latestWeightKg ? formatWeight(summary.latestWeightKg, weightUnit) : "Not logged"}
                  </p>
                </div>
              </div>
              {summary.weightChangeKg !== null && (
                <div
                  className={`flex items-center gap-1 text-sm font-medium ${
                    summary.weightChangeKg > 0 ? "text-success-600 dark:text-success-500" : summary.weightChangeKg < 0 ? "text-danger-500" : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {summary.weightChangeKg > 0 ? <TrendingUp size={15} /> : summary.weightChangeKg < 0 ? <TrendingDown size={15} /> : null}
                  {summary.weightChangeKg === 0
                    ? "No change"
                    : `${summary.weightChangeKg > 0 ? "+" : ""}${summary.weightChangeKg.toFixed(1)} kg since last check-in`}
                </div>
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => setWeighInOpen(true)}>
                <Flame size={14} /> Log weight
              </Button>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">Weight trend</p>
              <WeightChart weighIns={summary.weightHistory} unit={weightUnit} />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--text-primary)]">Recent meals</p>
                <Link href="/bulking" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                  View all
                </Link>
              </div>
              <MealList meals={summary.recentMeals} />
            </div>
          </>
        )}
      </CardBody>

      <MealForm open={mealFormOpen} onClose={() => setMealFormOpen(false)} />
      <WeighInForm open={weighInOpen} onClose={() => setWeighInOpen(false)} />
    </Card>
  );
}
