import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Badge } from '@/tracker/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { ConfirmDialog } from '@/tracker/components/ui/Dialog';
import { Select } from '@/tracker/components/ui/Input';
import { useToast } from '@/tracker/components/ui/Toast';
import { useAuth } from '@/tracker/features/auth/AuthProvider';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { callGoogle, openConsent, type GoogleCalendarInfo, type GoogleStatus, type GoogleSyncResult } from '@/tracker/lib/google/client';
import { isNative } from '@/tracker/lib/platform/native';

/**
 * Optional Google Calendar connection. Needs a signed-in account (the Google refresh token is stored server-side against
 * that account) and a server with Google credentials. Without either, the in-app calendar still works fully.
 */
export function GoogleCalendarCard({ onSynced }: { onSynced: () => void }) {
  const auth = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect' | 'push' | 'calendar'>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[] | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const refresh = useCallback(async () => {
    if (!auth.user) return;
    try {
      setStatus(await callGoogle<GoogleStatus>('status'));
      setError(null);
    } catch (e) {
      setError(toTrackerError(e).message);
    }
  }, [auth.user]);
  useEffect(() => {
    void refresh();
    // Coming back from the system browser: re-check the connection.
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const te = toTrackerError(e);
      setError(te.message);
      if (te.diagnostic === 'needs_reconsent') void refresh();
    } finally {
      setBusy(null);
    }
  };

  const connect = (write: boolean) => run('connect', async () => {
    const { url } = await callGoogle<{ url: string }>('start', { write, returnTo: isNative() ? 'native' : 'web' });
    await openConsent(url);
  });
  const sync = () => run('sync', async () => {
    const r = await callGoogle<GoogleSyncResult & { rateLimited?: boolean }>('sync');
    await refresh();
    await auth.syncNow();
    onSynced();
    toast({ title: 'Google Calendar synced', description: r.partialFailures ? `${r.partialFailures} event${r.partialFailures === 1 ? '' : 's'} couldn’t be synced. Try again later.` : r.rateLimited ? 'Google asked us to slow down. It will retry.' : `${r.upserted} updated, ${r.removed} removed${r.pushed ? `, ${r.pushed} sent to Google` : ''}.`, tone: r.partialFailures || r.rateLimited ? 'info' : 'success' });
  });
  const loadCalendars = () => run('calendar', async () => setCalendars((await callGoogle<{ calendars: GoogleCalendarInfo[] }>('calendars')).calendars));
  const pickCalendar = (id: string) => run('calendar', async () => {
    await callGoogle('select', { calendarId: id });
    await refresh();
    await callGoogle('sync');
    await auth.syncNow();
    onSynced();
  });
  const setPush = (enabled: boolean) => run('push', async () => {
    const r = await callGoogle<{ ok: boolean; needsConsent?: boolean }>('set-push', { enabled });
    if (r.needsConsent) {
      // Writing needs one more permission. Ask for it now, on its own, only because the user turned this on.
      const { url } = await callGoogle<{ url: string }>('start', { write: true, returnTo: isNative() ? 'native' : 'web' });
      await openConsent(url);
      return;
    }
    await refresh();
  });
  const disconnect = () => run('disconnect', async () => {
    await callGoogle('disconnect', { confirm: true });
    setConfirmOff(false);
    setCalendars(null);
    await refresh();
    await auth.syncNow();
    onSynced();
    toast({ title: 'Google Calendar disconnected', description: 'Access was revoked. Nothing was deleted in Google Calendar.', tone: 'success' });
  });

  const badge = !auth.user ? <Badge tone="neutral">Needs sign-in</Badge> : status?.connected ? <Badge tone={status.status === 'connected' ? 'success' : 'warning'}>{status.status === 'needs_reconsent' ? 'Reconnect needed' : 'Connected'}</Badge> : status && !status.configured ? <Badge tone="neutral">Not set up</Badge> : <Badge tone="neutral">Off</Badge>;

  return (
    <Card>
      <CardHeader as="h2" icon={<CalendarCheck className="size-5" aria-hidden />} title="Google Calendar" description="Optional. See a Google calendar next to your own events." action={badge} />
      <CardBody className="space-y-3 text-sm">
        {!auth.configured ? (
          <p className="text-ink-2">Needs cloud sync, which isn&apos;t set up in this build. The in-app calendar works without it.</p>
        ) : !auth.user ? (
          <p className="text-ink-2">Sign in under Settings → Account &amp; sync first. Google Calendar is connected to your account, separately from signing in, and is entirely optional.</p>
        ) : !status ? (
          <p className="text-ink-3" role="status">{error ?? 'Checking…'}</p>
        ) : !status.configured ? (
          <p className="text-ink-2">Google Calendar isn&apos;t set up on the server yet, so it can&apos;t be connected. Setup steps are in docs/GOOGLE_CALENDAR_SETUP.md.</p>
        ) : !status.connected ? (
          <>
            <p className="text-ink-2">Connecting opens Google in your {isNative() ? 'phone’s browser' : 'browser'}. The app asks only to <strong>see your calendar list and read events</strong>. It never deletes anything in Google Calendar.</p>
            <Button variant="primary" size="sm" onClick={() => void connect(false)} loading={busy === 'connect'}>Connect Google Calendar</Button>
          </>
        ) : (
          <>
            <p className="text-ink-2">{status.email ? `Connected as ${status.email}.` : 'Connected.'} {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}.` : 'Not synced yet.'}</p>
            {status.status === 'needs_reconsent' && <Button size="sm" variant="primary" onClick={() => void connect(status.canWrite === true)} loading={busy === 'connect'}>Reconnect Google Calendar</Button>}
            <div className="space-y-1.5">
              <p className="px-1 text-xs font-medium text-ink-2">Calendar to show</p>
              {calendars ? (
                <Select aria-label="Google calendar" className="h-10" value={status.calendarId ?? ''} onChange={(e) => void pickCalendar(e.target.value)} disabled={busy === 'calendar'}>
                  {!status.calendarId && <option value="">Choose a calendar…</option>}
                  {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? ' (primary)' : ''}</option>)}
                </Select>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">{status.calendarName ?? 'None chosen'}</span>
                  <Button size="sm" variant="ghost" onClick={() => void loadCalendars()} loading={busy === 'calendar'}>Change</Button>
                </div>
              )}
            </div>
            <label className="flex items-start gap-3 rounded-2xl bg-sunken px-4 py-3 text-ink">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={status.pushAppEvents === true} onChange={(e) => void setPush(e.target.checked)} disabled={busy === 'push'} />
              <span>
                <span className="block font-medium">Also add my in-app events to this Google calendar</span>
                <span className="block text-xs text-ink-2">Off by default. Needs one extra permission (create and edit events on calendars you own). Deleting an event here never deletes it in Google.</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void sync()} loading={busy === 'sync'}><RefreshCw className="size-4" aria-hidden />Sync now</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOff(true)}>Disconnect</Button>
            </div>
          </>
        )}
        <div aria-live="polite" className="min-h-4 text-xs text-danger">{error && status ? <span role="alert">{error}</span> : null}</div>
      </CardBody>
      <ConfirmDialog open={confirmOff} tone="primary" title="Disconnect Google Calendar?" description="Google access is revoked and the stored connection is deleted. The Google events shown in this app are removed from here. Nothing is deleted from Google Calendar, and your own events stay." confirmLabel="Disconnect" loading={busy === 'disconnect'} onConfirm={() => void disconnect()} onClose={() => busy !== 'disconnect' && setConfirmOff(false)} />
    </Card>
  );
}
