import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/AppShell";
import { BudgetPageClient } from "@/components/budget/BudgetPageClient";

export const metadata: Metadata = { title: "Budget \u2014 Personal Tracker" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Budget" subtitle="Income, expenses and spending, calculated from your records" />
      <BudgetPageClient />
    </div>
  );
}
