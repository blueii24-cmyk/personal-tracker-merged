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
      className={`app-sidebar sticky top-0 hidden h-screen shrink-0 flex-col border-r transition-[width] duration-200 md:flex ${
        collapsed ? "w-[76px]" : "w-[264px]"
      }`}
    >
      <div className={`flex h-[76px] items-center gap-3 border-b px-4 ${collapsed ? "justify-center" : ""}`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-brand-500 text-white shadow-[0_5px_18px_-7px_rgba(79,190,119,0.8)]">
          <Sparkles size={18} strokeWidth={2.2} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <span className="block truncate text-[15px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">{APP_NAME}</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Your daily system</span>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-6">
        {!collapsed && <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Workspace</p>}
        <ul className="flex flex-col gap-1.5">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`sidebar-link flex items-center gap-3 px-3 py-3 text-sm font-medium ${
                    active ? "sidebar-link-active" : "sidebar-link-inactive"
                  } ${collapsed ? "justify-center" : ""}`}
                >
                  <Icon size={18} strokeWidth={active ? 2.4 : 1.9} className="shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-400" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t p-3">
        <Link
          href="/settings"
          className={`flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.055] ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-300/20 bg-brand-500/15 text-sm font-semibold text-brand-300">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">{settings?.displayName ?? "Loading…"}</p>
              <p className="truncate text-xs text-[var(--text-tertiary)]">Personal space · Settings</p>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-white/[0.055] hover:text-[var(--text-primary)]"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!collapsed && <span>Collapse sidebar</span>}
        </button>
      </div>
    </aside>
  );
}
