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
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/95 px-4 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white">
            <Sparkles size={14} />
          </div>
          <span className="text-[15px] font-semibold text-[var(--text-primary)]">{APP_NAME}</span>
        </div>
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={() => setDrawerOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
        >
          <Menu size={20} />
        </button>
      </header>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/40 animate-fade-in md:hidden"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
        >
          <div className="flex h-full w-72 max-w-[85vw] animate-slide-up flex-col bg-[var(--surface-raised)] p-4 shadow-soft-lg">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {(settings?.displayName ?? "You").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{settings?.displayName ?? "Loading\u2026"}</p>
                  <p className="text-xs text-[var(--text-tertiary)]">Demo account</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setDrawerOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
                    }`}
                  >
                    <Icon size={18} />
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
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {BOTTOM_TABS.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        const isChat = item.href === "/chat";
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                isChat
                  ? "bg-brand-600 text-white"
                  : active
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-[var(--text-tertiary)]"
              }`}
            >
              <Icon size={isChat ? 17 : 19} strokeWidth={active && !isChat ? 2.4 : 2} />
            </span>
            <span className={active ? "text-brand-600 dark:text-brand-400" : "text-[var(--text-tertiary)]"}>
              {item.shortLabel ?? item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
