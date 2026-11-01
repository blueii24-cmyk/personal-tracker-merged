import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/tracker/lib/cn';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** CSS width at desktop sizes. On phones dialogs become bottom sheets. */
  width?: string;
  /** Prevent closing via Escape/backdrop (e.g. while saving). */
  locked?: boolean;
}

/** Accessible modal built on the native <dialog>: focus trap, Escape, inert background come for free. */
export function Dialog({ open, ...props }: DialogProps) {
  return open ? <DialogInner {...props} /> : null;
}

function DialogInner({ onClose, title, description, children, footer, width = '32rem', locked }: Omit<DialogProps, 'open'>) {
  const ref = useRef<HTMLDialogElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    lastFocus.current = document.activeElement;
    if (!el.open) el.showModal();
    return () => {
      if (el.open) el.close();
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus();
    };
  }, []);

  const titleId = `dlg-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <dialog
      ref={ref}
      className="pt-dialog"
      style={{ ['--dialog-width' as string]: width }}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current && !locked) onClose();
      }}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={locked} aria-label="Close dialog" className="-mt-1 -mr-2">
            <X className="size-4" aria-hidden />
          </Button>
        </header>
        <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5')}>{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-2 border-t border-line bg-sunken/50 px-5 py-3.5 safe-bottom sm:flex-row sm:justify-end">{footer}</footer>}
      </div>
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}
export function ConfirmDialog({ open, title, description, confirmLabel, tone = 'danger', loading, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="26rem"
      locked={loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{description}</div>
    </Dialog>
  );
}
