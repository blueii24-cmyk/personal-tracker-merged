import { Dumbbell, History, LayoutDashboard, MessageSquareText, Settings, Wallet, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  /** Shorter label for the mobile tab bar. */
  shortLabel?: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', shortLabel: 'Home', icon: LayoutDashboard, end: true },
  { to: '/chat', label: 'AI Chat', shortLabel: 'Chat', icon: MessageSquareText },
  { to: '/bulking', label: 'Bulking', icon: Dumbbell },
  { to: '/budget', label: 'Budget', icon: Wallet },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function titleForPath(pathname: string): string {
  const hit = NAV_ITEMS.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  return hit?.label ?? 'Overview';
}
