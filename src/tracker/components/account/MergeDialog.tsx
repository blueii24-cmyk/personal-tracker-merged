import { useMemo, useState } from 'react';
import { Dialog } from '@/tracker/components/ui/Dialog';
import { Button } from '@/tracker/components/ui/Button';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { totalOf, type Counts } from '@/tracker/sync/merge-guest';
import type { MergeResult, SyncCapable } from '@/tracker/sync/synced-service';

const ROWS: Array<[keyof Counts, string]> = [['meals', 'Meals'], ['transactions', 'Transactions'], ['weighIns', 'Weigh-ins'], ['chats', 'Chats'], ['calendarEvents', 'Calendar events']];

export function MergeDialog({ open, service, onClose, onMerged }: { open: boolean; service: SyncCapable; onClose: () => void; onMerged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  // Recomputed on every render while open so the account side reflects what has just been downloaded.
  const preview = useMemo(() => (open ? service.previewGuestMerge() : null), [open, service]);

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await service.mergeGuest());
      onMerged();
    } catch (e) {
      setError(toTrackerError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    setResult(null);
    onClose();
  };
  const keepSeparate = () => {
    service.markMergePromptDone();
    close();
  };

  return (
    <Dialog
      open={open && (preview !== null || result !== null)}
      onClose={close}
      locked={busy}
      title={result ? 'Merge finished' : 'Combine your records?'}
      description={result ? undefined : 'You have records on this device and an account in the cloud. Merging keeps both: nothing on either side is deleted or overwritten.'}
      footer={
        result ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={keepSeparate} disabled={busy}>Keep separate</Button>
            <Button variant="ghost" onClick={close} disabled={busy}>Not now</Button>
            <Button variant="primary" onClick={() => void merge()} loading={busy} disabled={!preview}>Merge into my account</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm text-ink-2" role="status">
          <p>
            Added {result.added} record{result.added === 1 ? '' : 's'} to your account{result.identical ? `, ${result.identical} were already there` : ''}.
            {result.skippedLegacy ? ` ${result.skippedLegacy} older built-in record${result.skippedLegacy === 1 ? ' was' : 's were'} left out.` : ''}
          </p>
          {result.differing > 0 && <p>{result.differing} record{result.differing === 1 ? ' exists' : 's exist'} in both places with different content. Your account&apos;s version was kept and this device&apos;s version is saved under Settings → Account → Needs review.</p>}
          <p className={result.confirmed ? 'text-success' : 'text-warning'}>
            {result.confirmed ? 'Your account has confirmed everything.' : 'Saved on this device. It will finish uploading when you are back online, and nothing has been removed.'}
          </p>
          <p>A safety copy of this device&apos;s records was made before merging. The on-device copy is still there if you sign out.</p>
        </div>
      ) : preview ? (
        <div className="space-y-4 text-sm">
          <div className="overflow-hidden rounded-2xl bg-sunken">
            <table className="w-full text-left">
              <thead className="text-xs text-ink-3">
                <tr><th className="px-4 py-2 font-medium">&nbsp;</th><th className="px-4 py-2 font-medium">This device</th><th className="px-4 py-2 font-medium">Your account</th></tr>
              </thead>
              <tbody className="text-ink">
                {ROWS.map(([k, label]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="px-4 py-2 text-ink-2">{label}</td>
                    <td className="px-4 py-2 tnum">{preview.local[k]}</td>
                    <td className="px-4 py-2 tnum">{preview.cloud[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalOf(preview.legacy) > 0 && (
            <div className="rounded-2xl bg-warning-soft px-4 py-3 text-warning">
              <span className="block font-medium">{totalOf(preview.legacy)} records on this device were created by an earlier app version.</span>
              <span className="block text-xs">Those built-in records are always left out. Your own records are included.</span>
            </div>
          )}
          <p className="text-ink-2">
            This will add {preview.willAdd} record{preview.willAdd === 1 ? '' : 's'} to your account.
            {preview.identical > 0 && ` ${preview.identical} identical record${preview.identical === 1 ? ' is' : 's are'} skipped, so nothing is duplicated.`}
            {preview.differing > 0 && ` ${preview.differing} differ${preview.differing === 1 ? 's' : ''} from the account copy; the account copy is kept and yours is saved for review.`}
          </p>
          <p className="text-xs text-ink-3">A safety copy of this device&apos;s records is saved first. Nothing on this device is deleted.</p>
          {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
      ) : null}
    </Dialog>
  );
}
