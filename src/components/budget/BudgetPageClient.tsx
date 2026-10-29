"use client";

import { useMemo, useState } from "react";
import { ArrowUpCircle, ChevronLeft, ChevronRight, Plus, Search, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/FormControls";
import { Skeleton } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { BudgetProgress } from "./BudgetProgress";
import { SpendingChart } from "./SpendingChart";
import { TransactionList } from "./TransactionList";
import { TransactionForm } from "./TransactionForm";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { useToast } from "@/providers/ToastProvider";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/api/tracker-service";
import { endOfMonthISO, formatCurrency, monthLabel, startOfMonthISO } from "@/lib/formatting";
import type { Transaction, TransactionType } from "@/types/domain";

export function BudgetPageClient() {
  const { transactions, transactionsLoading, settings, createTransaction, deleteTransaction } = useTrackerStore();
  const { showToast } = useToast();

  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<TransactionType>("expense");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const monthFrom = startOfMonthISO(cursor.year, cursor.month);
  const monthTo = endOfMonthISO(cursor.year, cursor.month);
  const isCurrentMonth = cursor.year === now.getFullYear() && cursor.month === now.getMonth();

  const monthTransactions = useMemo(
    () => transactions.filter((t) => t.date >= monthFrom && t.date <= monthTo),
    [transactions, monthFrom, monthTo],
  );

  const spent = monthTransactions.filter((t) => t.type === "expense").reduce((a, b) => a + b.amount, 0);
  const income = monthTransactions.filter((t) => t.type === "income").reduce((a, b) => a + b.amount, 0);
  const availableBalance = transactions.reduce((a, t) => a + (t.type === "income" ? t.amount : -t.amount), 0);

  const categorySpend = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of monthTransactions.filter((t) => t.type === "expense")) {
      totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
    }
    return Array.from(totals.entries()).map(([category, amount]) => ({ category, amount }));
  }, [monthTransactions]);

  const filteredList = useMemo(() => {
    return monthTransactions.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (search && !(`${t.description} ${t.category}`.toLowerCase().includes(search.toLowerCase()))) return false;
      return true;
    });
  }, [monthTransactions, typeFilter, categoryFilter, search]);

  const openAdd = (type: TransactionType) => {
    setEditing(null);
    setFormType(type);
    setFormOpen(true);
  };

  const openEdit = (txn: Transaction) => {
    setEditing(txn);
    setFormType(txn.type);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingTxn) return;
    const snapshot = deletingTxn;
    try {
      await deleteTransaction(snapshot.id);
      setDeletingTxn(null);
      showToast({
        title: "Transaction deleted",
        variant: "success",
        actionLabel: "Undo",
        onAction: async () => {
          await createTransaction({
            type: snapshot.type,
            amount: snapshot.amount,
            category: snapshot.category,
            description: snapshot.description,
            date: snapshot.date,
            note: snapshot.note,
          });
          showToast({ title: "Transaction restored", variant: "success" });
        },
      });
    } catch (err) {
      showToast({ title: "Couldn't delete transaction", description: err instanceof Error ? err.message : undefined, variant: "error" });
    }
  };

  const allCategories = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES.filter((c) => !(EXPENSE_CATEGORIES as readonly string[]).includes(c))];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          icon={<Wallet size={18} />}
          title="Monthly summary"
          action={
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))}>
                <ChevronLeft size={16} />
              </Button>
              <span className="min-w-[9rem] text-center text-sm font-medium text-[var(--text-primary)]">
                {monthLabel(cursor.year, cursor.month)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Next month"
                disabled={isCurrentMonth}
                onClick={() => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          }
        />
        <CardBody className="flex flex-col gap-5">
          {transactionsLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Available balance" value={formatCurrency(availableBalance)} />
                <Metric label="Monthly budget" value={formatCurrency(settings?.monthlyBudget ?? 0)} />
                <Metric label="Spent this month" value={formatCurrency(spent)} />
                <Metric label="Income this month" value={formatCurrency(income)} positive />
              </div>
              <BudgetProgress spent={spent} budget={settings?.monthlyBudget ?? 0} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => openAdd("income")}>
                  <ArrowUpCircle size={14} /> Add income
                </Button>
                <Button size="sm" onClick={() => openAdd("expense")}>
                  <Plus size={14} /> Add expense
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Spending by category" subtitle={monthLabel(cursor.year, cursor.month)} />
        <CardBody>{transactionsLoading ? <Skeleton className="h-40 w-full" /> : <SpendingChart data={categorySpend} />}</CardBody>
      </Card>

      <Card>
        <CardHeader title="Transactions" subtitle="Search and filter your records" />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description or category"
                className="pl-9"
                aria-label="Search transactions"
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as "all" | TransactionType)}
              className="sm:w-40"
              aria-label="Filter by type"
            >
              <option value="all">All types</option>
              <option value="expense">Expenses</option>
              <option value="income">Income</option>
            </Select>
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="sm:w-48"
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          {transactionsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <TransactionList
              transactions={filteredList}
              onEdit={openEdit}
              onDelete={setDeletingTxn}
              emptyMessage="No transactions match your filters for this month."
            />
          )}
        </CardBody>
      </Card>

      <TransactionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        transactionToEdit={editing}
        defaultType={formType}
      />
      <ConfirmDialog
        open={!!deletingTxn}
        onClose={() => setDeletingTxn(null)}
        onConfirm={handleDelete}
        title="Delete this transaction?"
        description="You can undo this immediately after deleting, or redo it manually later."
      />
    </div>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3">
      <p className="text-xs text-[var(--text-tertiary)]">{label}</p>
      <p className={`mt-1 text-base font-semibold ${positive ? "text-success-600 dark:text-success-500" : "text-[var(--text-primary)]"}`}>
        {value}
      </p>
    </div>
  );
}
