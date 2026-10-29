import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/AppShell";
import { HistoryPageClient } from "@/components/history/HistoryPageClient";

export const metadata: Metadata = { title: "History \u2014 Personal Tracker" };

export default function Page() {
  return (
    <div>
      <PageHeader title="History" subtitle="Search and review every meal, transaction and check-in" />
      <HistoryPageClient />
    </div>
  );
}
