"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Plus, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { BudgetProgress } from "@/components/budget/BudgetProgress";
import { SpendingChart } from "@/components/budget/SpendingChart";
import { TransactionList } from "@/components/budget/TransactionList";
import { TransactionForm } from "@/components/budget/TransactionForm";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { formatCurrency } from "@/lib/formatting";
import type { TransactionType } from "@/types/domain";

export function BudgetOverview() {
  const { summary, summaryLoading } = useTrackerStore();
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<TransactionType>("expense");

  const openForm = (type: TransactionType) => {
    setFormType(type);
    setFormOpen(true);
  };

  return (
    <Card>
      <CardHeader
        icon={<Wallet size={18} />}
        title="Budget overview"
        subtitle="Calculated live from your recorded transactions"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => openForm("income")}>
              <ArrowUpCircle size={14} /> Income
            </Button>
            <Button size="sm" onClick={() => openForm("expense")}>
              <Plus size={14} /> Expense
            </Button>
          </div>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs text-[var(--text-tertiary)]">Available balance</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-primary)]">{formatCurrency(summary.availableBalance)}</p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs text-[var(--text-tertiary)]">Monthly budget</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-primary)]">{formatCurrency(summary.monthlyBudget)}</p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs text-[var(--text-tertiary)]">Spent this month</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-primary)]">{formatCurrency(summary.spentThisMonth)}</p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs text-[var(--text-tertiary)]">Income this month</p>
                <p className="mt-1 flex items-center gap-1 text-base font-semibold text-success-600 dark:text-success-500">
                  <ArrowDownCircle size={14} className="rotate-180" />
                  {formatCurrency(summary.incomeThisMonth)}
                </p>
              </div>
            </div>

            <BudgetProgress spent={summary.spentThisMonth} budget={summary.monthlyBudget} />

            <div>
              <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">Spending by category</p>
              <SpendingChart data={summary.categorySpend} />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--text-primary)]">Recent transactions</p>
                <Link href="/budget" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                  View all
                </Link>
              </div>
              <TransactionList transactions={summary.recentTransactions} />
            </div>
          </>
        )}
      </CardBody>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} defaultType={formType} />
    </Card>
  );
}
