import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { cn } from '@/tracker/lib/cn';
import { Brand } from './Brand';
import { AccountMenu, ThemeSegmented } from './AccountMenu';
import { DemoNotice } from './DemoNotice';
import { NAV_ITEMS, titleForPath } from './nav';

/** Compact top bar with a drawer for every destination. */
export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 bg-canvas/90 px-2 backdrop-blur md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open navigation menu" aria-haspopup="dialog">
          <Menu className="size-5" aria-hidden />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xl font-normal text-ink">{titleForPath(pathname)}</p>
        <ThemeSegmented className="mr-1" />
      </header>
      <MobileDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="pt-drawer md:hidden"
      aria-label="Navigation"
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center justify-between px-4">
          <Brand />
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close navigation menu">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) => cn('flex h-14 items-center gap-3 rounded-full px-4 text-[15px] font-medium', isActive ? 'bg-primary-container text-on-primary-container' : 'text-ink-2 hover:bg-hover')}
            >
              {({ isActive }) => (
                <>
                  <span className={cn('grid place-items-center', isActive && 'icon-pop')}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 px-3 safe-bottom">
          <DemoNotice />
          <div className="pt-2">
            <AccountMenu onNavigate={onClose} />
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** Bottom tab bar. Chat sits in the middle so the assistant is one tap away from every main screen. */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/chat')) return null; // the chat composer needs the space and the keyboard

  const tabs = [NAV_ITEMS[0]!, NAV_ITEMS[2]!, NAV_ITEMS[1]!, NAV_ITEMS[3]!, NAV_ITEMS[4]!];
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 rounded-t-[28px] bg-sunken pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5 items-end px-1">
        {tabs.map(({ to, label, shortLabel, icon: Icon, end }) => {
          const isChat = to === '/chat';
          return (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn('flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium', isActive && !isChat ? 'text-ink' : 'text-ink-2')
                }
              >
                {({ isActive }) =>
                  isChat ? (
                    <>
                      <span className="-mt-6 grid size-14 place-items-center press icon-pop-slow rounded-[18px] bg-primary text-on-primary shadow-pop">
                        <Icon className="size-6" aria-hidden />
                      </span>
                      <span className="text-ink">{shortLabel ?? label}</span>
                    </>
                  ) : (
                    <>
                      <span className="relative grid h-8 w-16 place-items-center">
                        {isActive && <span className="pill-in absolute inset-0 rounded-full bg-primary-container" aria-hidden />}
                        <Icon className={cn('relative size-5', isActive ? 'icon-pop text-on-primary-container' : 'text-ink-2')} aria-hidden />
                      </span>
                      <span className={cn(isActive && 'font-semibold')}>{shortLabel ?? label}</span>
                    </>
                  )
                }
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

