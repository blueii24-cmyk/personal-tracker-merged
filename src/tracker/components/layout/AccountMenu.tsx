import { ChevronsUpDown, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Popover } from '@/tracker/components/ui/Popover';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { useTheme, type ThemePreference } from '@/tracker/features/theme/ThemeProvider';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { cn } from '@/tracker/lib/cn';
import { Avatar } from './Brand';

export function ThemeSegmented({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <Segmented<ThemePreference>
      label="Theme"
      className={className}
      size="sm"
      value={preference}
      onChange={setPreference}
      options={[
        { value: 'light', label: <Sun className="size-3.5" aria-hidden />, ariaLabel: 'Light' },
        { value: 'dark', label: <Moon className="size-3.5" aria-hidden />, ariaLabel: 'Dark' },
        { value: 'system', label: <Monitor className="size-3.5" aria-hidden />, ariaLabel: 'System' },
      ]}
    />
  );
}

export function AccountMenu({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { settings } = useTracker();
  const name = settings?.displayName ?? 'Account';
  return (
    <Popover
      side="top"
      className={cn(collapsed ? 'left-0' : 'left-0 w-full min-w-60')}
      trigger={({ toggle, open, id, ref }) => (
        <button
          ref={ref}
          onClick={toggle}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label={`Account menu for ${name}`}
          className={cn('flex w-full items-center gap-2.5 rounded-full p-2 pr-3 text-left transition-colors hover:bg-hover', collapsed && 'justify-center')}
        >
          <Avatar name={name} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{name}</span>
                <span className="block truncate text-xs text-ink-3">Demo account</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-ink-3" aria-hidden />
            </>
          )}
        </button>
      )}
    >
      {({ close }) => (
        <div className="space-y-1">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="truncate text-xs text-ink-3">{settings?.email}</p>
          </div>
          <div className="flex items-center justify-between gap-3 border-y border-line px-2.5 py-2.5">
            <span className="text-[13px] text-ink-2">Appearance</span>
            <ThemeSegmented />
          </div>
          <Link
            to="/settings"
            onClick={() => {
              close();
              onNavigate?.();
            }}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink hover:bg-hover"
          >
            <Settings className="size-4 text-ink-3" aria-hidden />
            Settings
          </Link>
          <p className="px-2.5 pt-1 pb-1.5 text-xs text-ink-3">Sign-in isn&apos;t set up yet. This is a local demo account.</p>
        </div>
      )}
    </Popover>
  );
}
