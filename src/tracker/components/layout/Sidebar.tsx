import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';
import { Brand } from './Brand';
import { AccountMenu } from './AccountMenu';
import { DemoNotice } from './DemoNotice';
import { NAV_ITEMS } from './nav';

const KEY = 'pt.sidebar.collapsed';
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <aside
      aria-label="Primary"
      className={cn('hidden shrink-0 flex-col bg-canvas transition-[width] duration-200 ease-out md:flex', collapsed ? 'w-[76px]' : 'w-64')}
    >
      <div className={cn('flex h-16 items-center', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        {collapsed ? (
          <button onClick={toggle} aria-label="Expand sidebar" aria-expanded={false} title="Expand sidebar" className="group relative rounded-full p-1 hover:bg-hover">
            <span className="group-hover:invisible group-focus-visible:invisible"><Brand /></span>
            <PanelLeftOpen className="absolute inset-0 m-auto size-[18px] text-ink opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
          </button>
        ) : (
          <>
            <Brand />
            <button onClick={toggle} aria-label="Collapse sidebar" aria-expanded className="rounded-full p-2 text-ink-3 hover:bg-hover hover:text-ink">
              <PanelLeftClose className="size-[18px]" aria-hidden />
            </button>
          </>
        )}
      </div>

      <nav aria-label="Main" className={cn('flex-1 space-y-0.5 overflow-y-auto py-2', collapsed ? 'px-2' : 'px-3')}>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'group flex h-12 items-center gap-3 rounded-full text-sm font-medium transition-colors',
                collapsed ? 'justify-center' : 'px-4',
                isActive ? 'bg-primary-container text-on-primary-container' : 'text-ink-2 hover:bg-hover hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('icon-wiggle grid shrink-0 place-items-center', isActive && 'icon-pop')}>
                  <Icon className={cn('size-5', isActive ? 'text-on-primary-container' : 'text-ink-3 group-hover:text-ink')} aria-hidden />
                </span>
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={cn('space-y-2 pb-3', collapsed ? 'px-2' : 'px-3')}>
        <DemoNotice collapsed={collapsed} />
        <div className="pt-2">
          <AccountMenu collapsed={collapsed} />
        </div>
      </div>
    </aside>
  );
}
