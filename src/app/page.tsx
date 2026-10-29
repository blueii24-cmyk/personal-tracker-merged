import type { Metadata } from "next";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";

export const metadata: Metadata = { title: "Overview \u2014 Personal Tracker" };

export default function Page() {
  return <DashboardPageClient />;
}
