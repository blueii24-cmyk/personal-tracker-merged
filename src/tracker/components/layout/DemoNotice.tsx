import { FlaskConical } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { isNative } from '@/tracker/lib/platform/native';

/** Always-visible reminder that records are demo data stored only in this browser. */
export function DemoNotice({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const { service } = useTracker();
  if (service.mode !== 'demo') return null;
  const where = isNative() ? 'on this device' : 'in this browser';
  if (collapsed) {
    return (
      <div title={`Local mode: data is stored only ${where}`} className={cn('mx-auto grid size-9 place-items-center rounded-md bg-warning-soft text-warning', className)}>
        <FlaskConical className="size-4" aria-label={`Local mode: data is stored only ${where}`} />
      </div>
    );
  }
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning', className)}>
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Local mode.</span> Records start as sample data and are kept only {where} — nothing is saved to the cloud. Export a backup in Settings.
      </p>
    </div>
  );
}
