import { FlaskConical } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';
import { useTracker } from '@/tracker/features/store/TrackerProvider';

/** Always-visible reminder that records are demo data stored only in this browser. */
export function DemoNotice({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const { service } = useTracker();
  if (service.mode !== 'demo') return null;
  if (collapsed) {
    return (
      <div title="Demo mode: data is stored only in this browser" className={cn('mx-auto grid size-9 place-items-center rounded-md bg-warning-soft text-warning', className)}>
        <FlaskConical className="size-4" aria-label="Demo mode: data is stored only in this browser" />
      </div>
    );
  }
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning', className)}>
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Demo mode.</span> Records are sample data kept only in this browser — nothing is saved to the cloud.
      </p>
    </div>
  );
}
