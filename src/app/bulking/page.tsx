import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/AppShell";
import { BulkingPageClient } from "@/components/bulking/BulkingPageClient";

export const metadata: Metadata = { title: "Bulking \u2014 Personal Tracker" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Bulking" subtitle="Track meals, nutrition estimates and body weight" />
      <BulkingPageClient />
    </div>
  );
}
