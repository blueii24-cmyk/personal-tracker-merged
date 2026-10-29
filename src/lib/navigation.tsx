import { CircleUserRound, LayoutGrid, MessageCircle, Settings, UtensilsCrossed, Wallet, History } from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  shortLabel?: string;
}

export const APP_NAME = "Personal Tracker";

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/chat", label: "AI Chat", icon: MessageCircle, shortLabel: "Chat" },
  { href: "/bulking", label: "Bulking", icon: UtensilsCrossed },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const PROFILE_NAV_ICON = CircleUserRound;

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
