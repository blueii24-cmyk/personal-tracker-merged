import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/AppShell";
import { SettingsPageClient } from "@/components/settings/SettingsPageClient";

export const metadata: Metadata = { title: "Settings \u2014 Personal Tracker" };

export default function Page() {
  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your profile, targets, budget and preferences" />
      <SettingsPageClient />
    </div>
  );
}
