"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Scale, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { NutritionProgress } from "./NutritionProgress";
import { WeightChart } from "./WeightChart";
import { MealList } from "./MealList";
import { MealForm } from "./MealForm";
import { WeighInForm } from "./WeighInForm";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { useToast } from "@/providers/ToastProvider";
import { MEAL_TYPES } from "@/lib/api/tracker-service";
import { formatDateLabel, formatWeight, relativeDayLabel, toISODate, todayISODate } from "@/lib/formatting";
import type { Meal } from "@/types/domain";

export function BulkingPageClient() {
  const { meals, mealsLoading, weighIns, weighInsLoading, settings, deleteMeal } = useTrackerStore();
  const { showToast } = useToast();

  const [selectedDate, setSelectedDate] = useState(todayISODate());
  const [mealFormOpen, setMealFormOpen] = useState(false);
  const [weighInOpen, setWeighInOpen] = useState(false);
  const [mealToEdit, setMealToEdit] = useState<Meal | null>(null);
  const [mealToDelete, setMealToDelete] = useState<Meal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const mealsForDate = useMemo(
    () => meals.filter((m) => toISODate(new Date(m.loggedAt)) === selectedDate),
    [meals, selectedDate],
  );

  const totals = useMemo(
    () => ({
      calories: mealsForDate.reduce((a, m) => a + m.totalCalories, 0),
      protein: mealsForDate.reduce((a, m) => a + m.totalProtein, 0),
    }),
    [mealsForDate],
  );

  const shiftDate = (days: number) => {
    const next = new Date(`${selectedDate}T12:00:00`);
    next.setDate(next.getDate() + days);
    const iso = toISODate(next);
    if (iso > todayISODate()) return;
    setSelectedDate(iso);
  };

  const openEdit = (meal: Meal) => {
    setMealToEdit(meal);
    setMealFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!mealToDelete) return;
    setDeleting(true);
    try {
      await deleteMeal(mealToDelete.id);
      showToast({ title: "Meal deleted", variant: "success" });
      setMealToDelete(null);
    } catch (err) {
      showToast({ title: "Couldn't delete meal", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const calorieTarget = settings?.calorieTarget ?? 0;
  const proteinTarget = settings?.proteinTarget ?? 0;
  const weightUnit = settings?.weightUnit ?? "kg";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Daily nutrition"
          subtitle="Estimates based on your logged meals for the selected day"
          action={
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Previous day" onClick={() => shiftDate(-1)}>
                <ChevronLeft size={16} />
              </Button>
              <span className="min-w-[7.5rem] text-center text-sm font-medium text-[var(--text-primary)]">
                {relativeDayLabel(`${selectedDate}T00:00:00`)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Next day"
                disabled={selectedDate >= todayISODate()}
                onClick={() => shiftDate(1)}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          }
        />
        <CardBody className="flex flex-col gap-5">
          {calorieTarget === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-3 text-sm text-[var(--text-secondary)]">
              You haven&apos;t set calorie or protein targets yet.{" "}
              <Link href="/settings" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                Configure them in Settings
              </Link>
              .
            </div>
          )}
          <NutritionProgress
            caloriesConsumed={totals.calories}
            calorieTarget={calorieTarget || 1}
            proteinConsumed={totals.protein}
            proteinTarget={proteinTarget || 1}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setMealToEdit(null); setMealFormOpen(true); }}>
              <Plus size={14} /> Log meal
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Meal log" subtitle={formatDateLabel(selectedDate)} />
        <CardBody className="flex flex-col gap-5">
          {mealsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : mealsForDate.length === 0 ? (
            <EmptyState title="No meals logged on this day" description="Use the AI chat or the log meal button above." />
          ) : (
            MEAL_TYPES.map((type) => {
              const typeMeals = mealsForDate.filter((m) => m.type === type);
              if (typeMeals.length === 0) return null;
              return (
                <div key={type}>
                  <p className="mb-2 text-sm font-semibold capitalize text-[var(--text-primary)]">{type}</p>
                  <MealList meals={typeMeals} onEdit={openEdit} onDelete={setMealToDelete} />
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<Scale size={18} />}
          title="Weight history"
          subtitle="Logged check-ins over time"
          action={
            <Button size="sm" variant="outline" onClick={() => setWeighInOpen(true)}>
              <Plus size={14} /> Check in
            </Button>
          }
        />
        <CardBody>
          {weighInsLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <>
              <WeightChart weighIns={weighIns} unit={weightUnit} />
              {weighIns.length > 0 && (
                <p className="mt-3 text-sm text-[var(--text-secondary)]">
                  Latest: {formatWeight(weighIns[weighIns.length - 1].weightKg, weightUnit)} on{" "}
                  {formatDateLabel(weighIns[weighIns.length - 1].date)}
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)]">
        <SettingsIcon size={13} />
        <span>
          Targets and weight unit are configured in{" "}
          <Link href="/settings" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Settings
          </Link>
          .
        </span>
      </div>

      <MealForm
        open={mealFormOpen}
        onClose={() => {
          setMealFormOpen(false);
          setMealToEdit(null);
        }}
        mealToEdit={mealToEdit}
      />
      <WeighInForm open={weighInOpen} onClose={() => setWeighInOpen(false)} />
      <ConfirmDialog
        open={!!mealToDelete}
        onClose={() => setMealToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete this meal?"
        description="This will permanently remove the meal and its nutrition estimates. This action cannot be undone."
      />
    </div>
  );
}
