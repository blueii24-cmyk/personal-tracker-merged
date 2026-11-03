import { cn } from '@/tracker/lib/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn('icon-pop grid shrink-0 place-items-center bg-primary-container text-on-primary-container', className ?? 'size-8 rounded-xl')} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-5" fill="none">
        <path d="M6 21 12 15l4.5 4L25 9.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="25" cy="9.5" r="2.6" fill="var(--fuel-mark)" />
      </svg>
    </span>
  );
}

export function Brand({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark />
      {!markOnly && <span className="truncate text-[17px] font-semibold tracking-tight text-ink">Personal Tracker</span>}
    </span>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-primary-container text-[13px] font-semibold text-on-primary-container', className)}>
      {initials}
    </span>
  );
}
