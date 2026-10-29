"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_NAME, NAV_ITEMS, isActivePath } from "@/lib/navigation";
import { useTrackerStore } from "@/store/TrackerStoreProvider";

const STORAGE_KEY = "personal-tracker-sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const { settings } = useTrackerStore();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Local storage hydration intentionally updates state after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setCollapsed(stored === "1");
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const initials = (settings?.displayName ?? "You")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-raised)] transition-[width] duration-200 md:flex ${
        collapsed ? "w-[76px]" : "w-64"
      }`}
    >
      <div className="flex h-16 items-center gap-2.5 border-b border-[var(--border-subtle)] px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Sparkles size={16} />
        </div>
        {!collapsed && <span className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{APP_NAME}</span>}
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon size={18} strokeWidth={active ? 2.3 : 2} className="shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-[var(--border-subtle)] p-3">
        <Link
          href="/settings"
          className={`flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--surface-sunken)] ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">{settings?.displayName ?? "Loading\u2026"}</p>
              <p className="truncate text-xs text-[var(--text-tertiary)]">View settings</p>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
