"use client";

import Link from "next/link";
import { MessageCircle, Sparkles } from "lucide-react";
import { ErrorState } from "@/components/ui/Feedback";
import { BulkingOverview } from "./BulkingOverview";
import { BudgetOverview } from "./BudgetOverview";
import { RecentActivity } from "./RecentActivity";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { formatDateLabel, todayISODate } from "@/lib/formatting";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Winding down";
}

export function DashboardPageClient() {
  const { summary, summaryLoading, summaryError, refreshSummary, settings } = useTrackerStore();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="text-sm text-[var(--text-tertiary)]">{formatDateLabel(todayISODate())}</p>
          <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">
            {getGreeting()}
            {settings ? `, ${settings.displayName}` : ""}
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-[var(--text-secondary)]">
            {summary
              ? `You've logged ~${Math.round(summary.caloriesConsumed)} kcal and spent ${summary.recentTransactions.length ? "some" : "nothing"} today. Here's where things stand.`
              : "Here's a quick look at your day."}
          </p>
        </div>
        <Link
          href="/chat"
          className="flex items-center gap-2 self-start rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 sm:self-auto"
        >
          <MessageCircle size={16} />
          Ask the assistant
        </Link>
      </div>

      {summaryError && !summary ? (
        <ErrorState title="Couldn't load your dashboard" description={summaryError} onRetry={refreshSummary} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <BulkingOverview />
            <BudgetOverview />
          </div>

          <RecentActivity items={summary?.recentActivity ?? []} loading={summaryLoading && !summary} />

          <AiPanel />
        </>
      )}
    </div>
  );
}

function AiPanel() {
  return (
    <Link
      href="/chat"
      className="group flex items-center gap-4 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-500/5 sm:p-5"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
        <Sparkles size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Log something naturally</p>
        <p className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
          Try \u201cI ate 2 eggs and a banana\u201d or \u201cI spent \u20b960 on travel\u201d \u2014 the assistant updates your dashboard instantly.
        </p>
      </div>
      <span className="shrink-0 text-sm font-medium text-brand-600 group-hover:underline dark:text-brand-400">Open chat</span>
    </Link>
  );
}
