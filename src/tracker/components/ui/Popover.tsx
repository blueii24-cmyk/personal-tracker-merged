import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/tracker/lib/cn';

interface PopoverProps {
  trigger: (a: { open: boolean; toggle: () => void; id: string; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode;
  children: (a: { close: () => void }) => ReactNode;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  className?: string;
}
/** Minimal disclosure popover: closes on outside click and Escape, returns focus to the trigger. */
export function Popover({ trigger, children, align = 'start', side = 'bottom', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o), id, ref: triggerRef })}
      {open && (
        <div
          id={id}
          className={cn(
            'absolute z-40 min-w-56 rounded-2xl bg-surface p-2 shadow-pop ring-1 ring-line',
            side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, tone = 'default', active }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; tone?: 'default' | 'danger'; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-hover',
        tone === 'danger' ? 'text-danger' : 'text-ink',
        active && 'bg-sunken font-medium',
      )}
    >
      {icon && <span className="shrink-0 text-ink-3">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
