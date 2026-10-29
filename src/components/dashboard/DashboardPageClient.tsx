"use client";

import Link from "next/link";
import { ArrowUpRight, MessageCircle, Sparkles } from "lucide-react";
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
    <div className="flex flex-col gap-7 animate-fade-in">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-eyebrow">
            <span className="dashboard-eyebrow-dot" />
            YOUR DAY <span aria-hidden="true">/</span> {formatDateLabel(todayISODate())}
          </p>
          <h1 className="dashboard-heading">
            {getGreeting()}
            {settings?.displayName ? <span>, {settings.displayName.split(" ")[0]}.</span> : <span>.</span>}
          </h1>
          <p className="dashboard-lede">
            {summary
              ? `You've logged about ${Math.round(summary.caloriesConsumed).toLocaleString()} kcal today. Keep your nutrition, weight, and spending moving in the right direction.`
              : "Your meals, weight, and spending — all in one calm, clear place."}
          </p>
        </div>
        <Link href="/chat" className="dashboard-primary-action">
          <MessageCircle size={17} />
          <span>Log with AI</span>
          <ArrowUpRight size={16} />
        </Link>
      </section>

      {summaryError && !summary ? (
        <ErrorState title="Couldn't load your dashboard" description={summaryError} onRetry={refreshSummary} />
      ) : (
        <>
          <div className="flex items-end justify-between gap-4 px-1">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.035em] text-[var(--text-primary)] sm:text-xl">Your overview</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Nutrition and money, side by side.</p>
            </div>
            <span className="mb-0.5 hidden items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-700 dark:border-brand-400/15 dark:bg-brand-500/10 dark:text-brand-300 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Live snapshot
            </span>
          </div>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
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
    <Link href="/chat" className="ai-quick-entry group">
      <div className="ai-quick-entry-icon">
        <Sparkles size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-[-0.015em] text-[var(--text-primary)]">Just say what happened</p>
        <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
          “I ate 2 eggs and a banana” or “I spent ₹60 on travel” — write it naturally and let your tracker do the busywork.
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 transition-transform group-hover:translate-x-0.5 dark:text-brand-300">
        Try it <ArrowUpRight size={16} />
      </span>
    </Link>
  );
}
