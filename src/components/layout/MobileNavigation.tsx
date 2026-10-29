"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { APP_NAME, NAV_ITEMS, isActivePath } from "@/lib/navigation";
import { useTrackerStore } from "@/store/TrackerStoreProvider";

const BOTTOM_TABS = NAV_ITEMS.filter((item) =>
  ["/", "/bulking", "/chat", "/budget", "/history"].includes(item.href),
);

export function MobileTopBar() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const { settings } = useTrackerStore();

  return (
    <>
      <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/90 px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[13px] bg-brand-600 text-white shadow-sm">
            <Sparkles size={16} strokeWidth={2.2} />
          </div>
          <div>
            <span className="block text-[15px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">{APP_NAME}</span>
            <span className="block text-[10px] font-medium tracking-wide text-[var(--text-tertiary)]">Your daily system</span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={() => setDrawerOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)]"
        >
          <Menu size={20} />
        </button>
      </header>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/45 backdrop-blur-[2px] animate-fade-in md:hidden"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
        >
          <div className="flex h-full w-80 max-w-[88vw] animate-slide-up flex-col border-l border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 shadow-soft-lg">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {(settings?.displayName ?? "You").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{settings?.displayName ?? "Loading…"}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">Your personal space</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Workspace</p>
            <nav className="flex flex-col gap-1.5">
              {NAV_ITEMS.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`sidebar-link flex items-center gap-3 px-3 py-3 text-sm font-medium ${
                      active
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon size={18} strokeWidth={active ? 2.3 : 1.9} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="mobile-bottom-nav fixed inset-x-3 bottom-3 z-30 flex rounded-2xl border px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {BOTTOM_TABS.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        const isChat = item.href === "/chat";
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold"
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
                isChat
                  ? "bg-brand-600 text-white shadow-sm"
                  : active
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-[var(--text-tertiary)]"
              }`}
            >
              <Icon size={isChat ? 17 : 19} strokeWidth={active && !isChat ? 2.4 : 2} />
            </span>
            <span className={active ? "text-brand-700 dark:text-brand-300" : "text-[var(--text-tertiary)]"}>
              {item.shortLabel ?? item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
