"use client";

import { useMemo, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { HistoryFilters, type HistoryFilterState } from "./HistoryFilters";
import { HistoryList, type HistoryEntry } from "./HistoryList";
import { MealForm } from "@/components/bulking/MealForm";
import { TransactionForm } from "@/components/budget/TransactionForm";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { useToast } from "@/providers/ToastProvider";
import { formatGrams, formatKcal, formatWeight, toISODate } from "@/lib/formatting";
import type { Meal, Transaction } from "@/types/domain";

const DEFAULT_FILTERS: HistoryFilterState = { search: "", entryType: "all", category: "all", from: "", to: "" };

export function HistoryPageClient() {
  const {
    meals,
    mealsLoading,
    transactions,
    transactionsLoading,
    weighIns,
    weighInsLoading,
    deleteMeal,
    deleteTransaction,
    deleteWeighIn,
    settings,
  } = useTrackerStore();
  const { showToast } = useToast();

  const [filters, setFilters] = useState<HistoryFilterState>(DEFAULT_FILTERS);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loading = mealsLoading || transactionsLoading || weighInsLoading;

  const entries: HistoryEntry[] = useMemo(() => {
    const weightUnit = settings?.weightUnit ?? "kg";
    const mealEntries: HistoryEntry[] = meals.map((m) => ({
      id: `meal_${m.id}`,
      type: "meal",
      title: `${m.type.charAt(0).toUpperCase()}${m.type.slice(1)}`,
      subtitle: `${m.items.map((i) => i.name).join(", ")} \u00b7 ~${formatKcal(m.totalCalories)} \u00b7 ${formatGrams(m.totalProtein)} protein`,
      timestamp: m.loggedAt,
      date: toISODate(new Date(m.loggedAt)),
      href: "/bulking",
      editable: true,
    }));

    const txnEntries: HistoryEntry[] = transactions.map((t) => ({
      id: `txn_${t.id}`,
      type: t.type === "income" ? "income" : "expense",
      title: t.description,
      subtitle: t.note ?? t.category,
      category: t.category,
      amount: t.type === "income" ? t.amount : -t.amount,
      timestamp: t.createdAt,
      date: t.date,
      href: "/budget",
      editable: true,
    }));

    const weightEntries: HistoryEntry[] = weighIns.map((w) => ({
      id: `weight_${w.id}`,
      type: "weight",
      title: "Weight check-in",
      subtitle: formatWeight(w.weightKg, weightUnit),
      timestamp: `${w.date}T12:00:00`,
      date: w.date,
      href: "/bulking",
      editable: false,
    }));

    return [...mealEntries, ...txnEntries, ...weightEntries]
      .filter((entry) => {
        if (filters.entryType !== "all" && entry.type !== filters.entryType) return false;
        if (filters.category !== "all" && entry.category !== filters.category) return false;
        if (filters.from && entry.date < filters.from) return false;
        if (filters.to && entry.date > filters.to) return false;
        if (filters.search) {
          const q = filters.search.toLowerCase();
          if (!(`${entry.title} ${entry.subtitle}`.toLowerCase().includes(q))) return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [meals, transactions, weighIns, filters, settings]);

  const handleEdit = (entry: HistoryEntry) => {
    if (entry.type === "meal") {
      const id = entry.id.replace("meal_", "");
      const meal = meals.find((m) => m.id === id) ?? null;
      setEditingMeal(meal);
    } else if (entry.type === "expense" || entry.type === "income") {
      const id = entry.id.replace("txn_", "");
      const txn = transactions.find((t) => t.id === id) ?? null;
      setEditingTxn(txn);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.type === "meal") {
        await deleteMeal(pendingDelete.id.replace("meal_", ""));
      } else if (pendingDelete.type === "expense" || pendingDelete.type === "income") {
        await deleteTransaction(pendingDelete.id.replace("txn_", ""));
      } else {
        await deleteWeighIn(pendingDelete.id.replace("weight_", ""));
      }
      showToast({ title: "Record deleted", variant: "success" });
      setPendingDelete(null);
    } catch (err) {
      showToast({ title: "Couldn't delete record", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader icon={<HistoryIcon size={18} />} title="Filter records" />
        <CardBody>
          <HistoryFilters value={filters} onChange={setFilters} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="All records" subtitle={`${entries.length} matching ${entries.length === 1 ? "record" : "records"}`} />
        <CardBody>
          {loading ? <Skeleton className="h-64 w-full" /> : <HistoryList entries={entries} onEdit={handleEdit} onDelete={setPendingDelete} />}
        </CardBody>
      </Card>

      <MealForm open={!!editingMeal} onClose={() => setEditingMeal(null)} mealToEdit={editingMeal} />
      <TransactionForm open={!!editingTxn} onClose={() => setEditingTxn(null)} transactionToEdit={editingTxn} />
      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete this record?"
        description="This action is permanent and cannot be undone from here."
      />
    </div>
  );
}
