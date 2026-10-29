"use client";

import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav, MobileTopBar } from "./MobileNavigation";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--surface)]">
      <Sidebar />
      <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="w-full flex-1 pb-20 md:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">{children}</div>
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--text-secondary)]">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
