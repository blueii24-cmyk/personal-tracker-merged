import { AlertTriangle, Cloud, CloudOff, GitMerge, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/tracker/lib/cn';
import { useAuth } from '@/tracker/features/auth/AuthProvider';
import type { SyncStatus } from '@/tracker/sync/synced-service';

export function syncLabel(s: SyncStatus): { text: string; tone: 'ok' | 'warn' | 'bad' | 'busy' } {
  switch (s.state) {
    case 'syncing': return { text: 'Syncing…', tone: 'busy' };
    case 'synced': return { text: 'Synced', tone: 'ok' };
    case 'pending': return { text: `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync`, tone: 'warn' };
    case 'offline': return { text: s.pending ? `Offline · ${s.pending} saved on this device` : 'Offline · saved on this device', tone: 'warn' };
    case 'conflict': return { text: `${s.conflicts} to review`, tone: 'warn' };
    case 'error': return { text: 'Sync problem', tone: 'bad' };
    default: return { text: 'On this device only', tone: 'warn' };
  }
}

/** Shown in place of the "Local mode" notice while a signed-in account is attached. */
export function SyncNotice({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const { sync, syncNow } = useAuth();
  const { text, tone } = syncLabel(sync);
  const Icon = sync.state === 'syncing' ? Loader2 : sync.state === 'offline' ? CloudOff : sync.state === 'error' ? AlertTriangle : sync.state === 'conflict' ? GitMerge : Cloud;
  const colour = tone === 'ok' ? 'bg-success-soft text-success' : tone === 'bad' ? 'bg-danger-soft text-danger' : tone === 'busy' ? 'bg-primary-container text-on-primary-container' : 'bg-warning-soft text-warning';
  if (collapsed) {
    return (
      <Link to="/settings#account" title={`Cloud sync: ${text}`} className={cn('mx-auto grid size-9 place-items-center rounded-md', colour, className)}>
        <Icon className={cn('size-4', sync.state === 'syncing' && 'animate-spin')} aria-label={`Cloud sync: ${text}`} />
      </Link>
    );
  }
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs', colour, className)} role="status" aria-live="polite">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', sync.state === 'syncing' && 'animate-spin')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p><span className="font-semibold">{text}.</span> {sync.state === 'error' && sync.message ? sync.message : sync.email ? `Account: ${sync.email}` : ''}</p>
        <div className="mt-1 flex gap-3">
          {(sync.state === 'error' || sync.state === 'pending' || sync.state === 'offline') && (
            <button type="button" onClick={syncNow} className="inline-flex items-center gap-1 font-medium underline underline-offset-2"><RefreshCw className="size-3" aria-hidden />Retry now</button>
          )}
          <Link to="/settings#account" className="font-medium underline underline-offset-2">Details</Link>
        </div>
      </div>
    </div>
  );
}
