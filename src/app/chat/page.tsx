import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/AppShell";
import { ChatPage } from "@/components/chat/ChatPage";

export const metadata: Metadata = { title: "AI Chat \u2014 Personal Tracker" };

export default function Page() {
  return (
    <div>
      <PageHeader title="AI Chat" subtitle="Log meals, expenses, income and weight in plain language" />
      <ChatPage />
    </div>
  );
}
