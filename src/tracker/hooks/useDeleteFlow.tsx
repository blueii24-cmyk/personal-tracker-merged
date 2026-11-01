import { useCallback, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/tracker/components/ui/Dialog';
import { useToast } from '@/tracker/components/ui/Toast';
import { toTrackerError } from '@/tracker/lib/api/errors';

interface Pending {
  title: string;
  description: ReactNode;
  run: () => Promise<() => Promise<void>>;
  doneTitle: string;
}

/** Confirm → delete → toast with Undo. One dialog instance per page. */
export function useDeleteFlow() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const ask = useCallback((p: Pending) => setPending(p), []);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const undo = await pending.run();
      setPending(null);
      toast({
        title: pending.doneTitle,
        tone: 'success',
        action: {
          label: 'Undo',
          onClick: () => {
            undo().then(
              () => toast({ title: 'Restored', tone: 'success' }),
              (e) => toast({ title: "Couldn't restore", description: toTrackerError(e).message, tone: 'error' }),
            );
          },
        },
      });
    } catch (e) {
      setPending(null);
      toast({ title: "Couldn't delete", description: toTrackerError(e).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ''}
      description={pending?.description}
      confirmLabel="Delete"
      loading={busy}
      onConfirm={confirm}
      onClose={() => !busy && setPending(null)}
    />
  );
  return { ask, dialog };
}
